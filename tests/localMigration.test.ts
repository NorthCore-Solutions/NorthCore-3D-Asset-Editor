import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import inventory from '../src/animation/migration/legacy-inventory.json';
import fixtures from './fixtures/legacy-migration-cases.json';
import { prepareLocalLegacyMigration, resumeLocalLegacyMigration, readCompletedLocalMigration, readLocalMigrationArchive, readLocalMigrationJournal, openCompletedLocalMigration, MIGRATION_PREFIX, prepareExternalLegacyMigration, migrationIdentity, listLegacyMigrationData } from '../src/animation/migration/localMigration';
import type { MigrationJournal } from '../src/animation/migration/localMigration';
import { createSessionClient } from '../src/animation/storage';
import type { SessionStorage } from '../src/animation/storage';
import type { Definition } from '../src/animation/legacy';
import type { ResourceSet } from '../src/animation/migration/legacyAudit';
import { canonicalJson } from '../src/animation/contentHash';
import { convertLegacyArchive } from '../src/animation/migration/legacyConverter';
import { parseRasterDocument, restoreSession, serializeSession } from '../src/animation/files';
import { AnimationStore } from '../src/animation/store';

class MemoryStorage implements SessionStorage {
  entries = new Map<string, string>();
  history: Map<string, string>[] = [];
  reject: ((draft: Map<string, string>) => Error | null) | null = null;
  after: ((saved: Map<string, string>) => void | Promise<void>) | null = null;
  private tail: Promise<void> = Promise.resolve();
  async run<T>(change: (entries: Map<string, string>) => T): Promise<T> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try {
      const draft = new Map(this.entries), result = change(draft), failure = this.reject?.(draft);
      if (failure) throw failure;
      this.entries = draft; this.history.push(new Map(draft));
      await this.after?.(draft);
      return result;
    } finally { unlock(); }
  }
}
const resources: ResourceSet = new Map<string, string | Uint8Array>([
  ...inventory.assets.map((asset) => [asset.path, new Uint8Array(readFileSync(asset.path))] as const),
  [inventory.presets.path, readFileSync(inventory.presets.path, 'utf8')] as const,
]);
const key = 'example.finoanim.json';
function definition(lossy = false): Definition {
  const pixels = lossy ? [{ x: 1, y: 1, rgba: 0x12345601 }] :
    Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), rgba: 0x12345601 }));
  return { version: 2, faceRigVersion: 2, id: 'original', name: 'Original', basePose: 'fino_standing_neutral.png',
    frames: [{ durationMs: 37, ops: [], layers: [{ id: 'p', name: 'Pixels', kind: 'pixels', pixels }] }] };
}
let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); storage.entries.set(key, JSON.stringify(definition(), null, 2) + '\r\n'); });
const journals = (entries: Map<string, string>) => [...entries].filter(([k]) => k.startsWith(`${MIGRATION_PREFIX}journal:`)).map(([, value]) => JSON.parse(value) as MigrationJournal);
const targets = () => [...storage.entries.keys()].filter((k) => k.endsWith('.raster128.json'));
const blobs = () => [...storage.entries.keys()].filter((k) => k.startsWith(`${MIGRATION_PREFIX}blob:`));
const prepare = (signal?: AbortSignal) => prepareLocalLegacyMigration(key, undefined, resources, inventory, { storage, signal });

it('identity lookup skips unrelated semantics across pages without hydrating their archives', async () => {
  const saved = await (await prepare()).commit();
  for (let i = 0; i < 70; i++) {
    const id = i.toString(16).padStart(64, '0');
    storage.entries.set(`${MIGRATION_PREFIX}journal:${id}`, JSON.stringify({ ...saved.journal, id,
      archiveId: 'e'.repeat(64), resourceSemanticsSha256: '0'.repeat(64) }));
  }
  // The deliberately unavailable archive belongs to a different known semantic identity.
  const repeated = await prepare(); expect(repeated.id).toBe(saved.journal.id);
  expect((await repeated.commit()).json).toBe(saved.json);
});

it('exact migration archives all originals, publishes a valid V2 target and completes only after the target is stored', async () => {
  const original = storage.entries.get(key), plan = await prepare();
  expect(plan.previews).toHaveLength(1); expect(storage.entries.size).toBe(1);
  const saved = await plan.commit();
  expect(saved.journal.status).toBe('completed'); expect(saved.journal.route).toBe('exact');
  expect(saved.journal.approval).toBe('not-required'); expect(storage.entries.get(key)).toBe(original);
  expect(saved.journal.targetKey).not.toBe(key); expect(parseRasterDocument(saved.json).state.metadata.id).toBe(saved.journal.targetId);
  expect(plan.previews).toHaveLength(0);
  for (const state of storage.history) for (const journal of journals(state)) {
    if (journal.status === 'completed') expect(state.get(journal.targetKey)).toBe(saved.json);
    else expect(state.has(journal.targetKey)).toBe(false);
  }
  expect(storage.history.flatMap(journals).map((j) => j.status)).toEqual(expect.arrayContaining(['prepared', 'stored', 'completed']));
  const { archive, inventory: capturedInventory } = await readLocalMigrationArchive(saved.journal.archiveId, storage);
  expect(archive.original.definition!.json).toBe(original);
  expect(archive.resources.every((ref) => ref.original !== null)).toBe(true);
  expect(capturedInventory).toEqual(inventory);
  const offline = await convertLegacyArchive(archive, new Map(), capturedInventory);
  expect(offline.document.frames).toEqual((JSON.parse(saved.json) as { frames: unknown }).frames);
  offline.previews.length = 0;
});

it('lossy without bound approval writes nothing; a matching explicit approval succeeds', async () => {
  storage.entries.set(key, JSON.stringify(definition(true)));
  let plan = await prepare();
  await expect(plan.commit()).rejects.toMatchObject({ code: 'approval-required' });
  expect(storage.entries.size).toBe(1); expect(plan.previews).toHaveLength(0);
  plan = await prepare(); const report = plan.report;
  await expect(plan.commit({ approval: { archiveId: 'different', conversionSha256: report.conversionSha256 } })).rejects.toMatchObject({ code: 'approval-required' });
  plan = await prepare();
  const saved = await plan.commit({ approval: { archiveId: plan.report.source.archiveId, conversionSha256: plan.report.conversionSha256 } });
  expect(saved.journal.route).toBe('lossy'); expect(saved.journal.approval).toBe('approved');
  expect(saved.journal.approvedConversionSha256).toBe(saved.journal.conversionSha256);
});

it('blocked input cannot create an archive/journal/target', async () => {
  const d = definition(); d.frames[0]!.ops = [{ type: 'unknown' }]; storage.entries.set(key, JSON.stringify(d));
  await expect(prepare()).rejects.toMatchObject({ route: 'blockiert' });
  expect(storage.entries.size).toBe(1);
});

it('lossy retry retains exactly the approval durably saved before its partial failure', async () => {
  storage.entries.set(key, JSON.stringify(definition(true)));
  const plan = await prepare();
  storage.reject = (draft) => journals(draft).some((j) => j.status === 'stored') ? Error('Controlled write failure') : null;
  await expect(plan.commit({ approval: { archiveId: plan.report.source.archiveId, conversionSha256: plan.report.conversionSha256 } })).rejects.toThrow('Controlled write failure');
  storage.reject = null;
  const saved = await (await resumeLocalLegacyMigration(plan.id, { storage })).commit();
  expect(saved.journal.approval).toBe('approved');
  expect(saved.journal.approvedConversionSha256).toBe(saved.journal.conversionSha256);
  expect(targets()).toHaveLength(1);
});

it('a changed library invalidates a captured plan rather than archiving a stale snapshot as current', async () => {
  const plan = await prepare();
  const library = JSON.stringify(fixtures.templateLibrary);
  storage.entries.set(inventory.persistence.libraryKey, library);
  await expect(plan.commit()).rejects.toMatchObject({ code: 'source-changed' });
  expect(storage.entries.get(inventory.persistence.libraryKey)).toBe(library);
  expect(targets()).toHaveLength(0); expect(journals(storage.entries)).toHaveLength(0);
});

it('repeated commit of the same busy plan cannot interfere with its pending write', async () => {
  const plan = await prepare();
  let release!: () => void, reached!: () => void;
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  storage.after = async (saved) => {
    if (journals(saved).some((j) => j.status === 'prepared')) {
      reached(); await new Promise<void>((resolve) => { release = resolve; });
    }
  };
  const first = plan.commit(); await waiting;
  await expect(plan.commit()).rejects.toMatchObject({ code: 'busy' });
  expect(plan.previews).toHaveLength(1);
  release(); const saved = await first;
  expect(saved.journal.status).toBe('completed'); expect(targets()).toHaveLength(1);
  expect(plan.previews).toHaveLength(0);
});

it('identical repeated migration reuses its target, archive and journal; changed source is a new revision', async () => {
  const first = await (await prepare()).commit(); const size = storage.entries.size;
  const repeated = await (await prepare()).commit();
  expect(repeated).toEqual(first); expect(targets()).toHaveLength(1); expect(storage.entries.size).toBe(size);
  const blobCount = blobs().length;
  const d = definition(); d.name = 'Changed'; storage.entries.set(key, JSON.stringify(d));
  const changed = await (await prepare()).commit();
  expect(changed.journal.id).not.toBe(first.journal.id); expect(changed.journal.targetId).not.toBe(first.journal.targetId);
  expect(targets()).toHaveLength(2); expect(blobs()).toHaveLength(blobCount);
});

it.each(['name', 'id'])('%s collisions preserve the existing unrelated document', async (kind) => {
  const plan = await prepare(), id = plan.targetId;
  const store = new AnimationStore(); store.setDocumentMetadata({ id });
  const occupied = kind === 'name' ? `Raster-Migration ${id}.raster128.json` : 'Other';
  const json = kind === 'name' ? 'unrelated bytes' : serializeSession(store);
  storage.entries.set(occupied, json);
  await expect(plan.commit()).rejects.toMatchObject({ code: 'collision' });
  expect(storage.entries.get(occupied)).toBe(json); expect(plan.previews).toHaveLength(0);
});

it.each(['stored', 'completed'])('quota failure at %s does not publish; archived data permits offline resume', async (stage) => {
  const original = storage.entries.get(key), plan = await prepare(), id = plan.id;
  storage.reject = (draft) => journals(draft).some((j) => j.status === stage) ? new DOMException('Quota controlled', 'QuotaExceededError') : null;
  await expect(plan.commit()).rejects.toThrow('Quota controlled');
  expect(plan.previews).toHaveLength(0); expect(targets()).toHaveLength(0); expect(storage.entries.get(key)).toBe(original);
  expect((await readLocalMigrationJournal(id, storage))!.status).toBe('failed');
  await expect(readCompletedLocalMigration(id, storage)).rejects.toMatchObject({ code: 'not-completed' });
  storage.reject = null;
  const retry = await resumeLocalLegacyMigration(id, { storage });
  const saved = await retry.commit();
  expect(saved.journal.attempts).toBe(2); expect(saved.journal.status).toBe('completed'); expect(targets()).toHaveLength(1);
});

it('archive transaction failure rolls back archive/blob/journal and never touches the source', async () => {
  const plan = await prepare(), original = storage.entries.get(key);
  storage.reject = (draft) => journals(draft).some((j) => j.status === 'prepared') ? Error('Archive write failed') : null;
  await expect(plan.commit()).rejects.toThrow('Archive write failed');
  expect(storage.entries).toEqual(new Map([[key, original!]])); expect(plan.previews).toHaveLength(0);
});

it('abort after durable archive leaves a recoverable journal, no target, and releases previews', async () => {
  const controller = new AbortController(), plan = await prepare(controller.signal);
  storage.after = (saved) => { if (journals(saved).some((j) => j.status === 'prepared')) controller.abort(); };
  await expect(plan.commit({ signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
  expect(targets()).toHaveLength(0); expect(plan.previews).toHaveLength(0);
  expect((await readLocalMigrationJournal(plan.id, storage))!.status).toBe('failed');
  storage.after = null;
  expect((await (await resumeLocalLegacyMigration(plan.id, { storage })).commit()).journal.status).toBe('completed');
});

it('a persistent quota failure leaves the last durable recoverable state, never a false completed record', async () => {
  const plan = await prepare(); let failAll = false;
  storage.reject = () => failAll ? Error('Storage unavailable') : null;
  storage.after = (saved) => { if (journals(saved).some((j) => j.status === 'prepared')) failAll = true; };
  await expect(plan.commit()).rejects.toThrow('Storage unavailable');
  expect(journals(storage.entries)[0]!.status).toBe('prepared'); expect(targets()).toHaveLength(0);
  failAll = false; storage.after = null;
  expect((await (await resumeLocalLegacyMigration(plan.id, { storage })).commit()).journal.status).toBe('completed');
});

it.each(['before-commit', 'after-archive'])('source changes %s invalidate the captured migration without overwriting either source', async (phase) => {
  const plan = await prepare(), changed = JSON.stringify({ ...definition(), name: 'Updated during migration' });
  if (phase === 'before-commit') storage.entries.set(key, changed);
  else storage.after = (saved) => { if (journals(saved).some((j) => j.status === 'prepared')) storage.entries.set(key, changed); };
  await expect(plan.commit()).rejects.toMatchObject({ code: 'source-changed' });
  expect(storage.entries.get(key)).toBe(changed); expect(targets()).toHaveLength(0); expect(plan.previews).toHaveLength(0);
});

it('Legacy library is durably archived only and remains byte-identical in local storage', async () => {
  const json = JSON.stringify(fixtures.templateLibrary, null, 2);
  storage.entries.set(inventory.persistence.libraryKey, json);
  const saved = await (await prepare()).commit();
  expect(saved.journal.libraryDisposition).toBe('archived-only');
  const { archive } = await readLocalMigrationArchive(saved.journal.archiveId, storage);
  expect(archive.original.library!.json).toBe(json); expect(storage.entries.get(inventory.persistence.libraryKey)).toBe(json);
  const parsed = parseRasterDocument(saved.json); expect(parsed.templates).toEqual([]); expect(parsed.faces).toEqual([]);
});

it('concurrent identical plans use one target; an obsolete attempt cannot downgrade completed journal state', async () => {
  const a = await prepare(), b = await prepare();
  const results = await Promise.allSettled([a.commit(), b.commit()]);
  expect(results.some((r) => r.status === 'fulfilled')).toBe(true); expect(targets()).toHaveLength(1);
  const completed = await readCompletedLocalMigration(a.id, storage);
  expect(completed.journal.status).toBe('completed');
  expect(a.previews).toHaveLength(0); expect(b.previews).toHaveLength(0);
});

it('late migration writes after Neu/Laden do not affect the editor; explicit opening is session guarded', async () => {
  const plan = await prepare(), store = new AnimationStore(); const original = serializeSession(store);
  let release!: () => void, reached!: () => void;
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  let delayed = false;
  storage.after = async (saved) => {
    if (!delayed && journals(saved).some((j) => j.status === 'prepared')) {
      delayed = true; reached(); await new Promise<void>((resolve) => { release = resolve; });
    }
  };
  const migrating = plan.commit(); await waiting;
  store.newAnimation('New session', 'empty', false); const active = store.state;
  release(); const saved = await migrating; expect(store.state).toBe(active);
  storage.after = null;
  let resumeRead!: () => void;
  let holdRead = true;
  const delayedStorage: SessionStorage = { async run<T>(change: (entries: Map<string, string>) => T) {
    const result = await storage.run(change); if (holdRead) { holdRead = false; await new Promise<void>((resolve) => { resumeRead = resolve; }); } return result;
  } };
  const opening = openCompletedLocalMigration(store, plan.id, delayedStorage);
  while (!resumeRead) await new Promise((resolve) => setTimeout(resolve, 0));
  restoreSession(store, original); const loaded = store.state; resumeRead();
  expect(await opening).toBe('stale'); expect(store.state).toBe(loaded);
  expect(await openCompletedLocalMigration(store, plan.id, storage)).toBe('opened');
  expect(store.state.metadata.id).toBe(saved.journal.targetId); expect(store.dirty).toBe(false);
});

it('disposing a preview-only plan writes nothing and drops all RGBA references held by the plan', async () => {
  const plan = await prepare(), previews = plan.previews;
  expect(previews.length).toBe(1); plan.dispose(); expect(previews.length).toBe(0); expect(plan.previews).toHaveLength(0);
  await expect(plan.commit()).rejects.toMatchObject({ code: 'disposed' }); expect(storage.entries.size).toBe(1);
});

it('edited target or resource payloads are not silently opened or resumed', async () => {
  const saved = await (await prepare()).commit();
  storage.entries.set(saved.journal.targetKey, '{}');
  await expect(readCompletedLocalMigration(saved.journal.id, storage)).rejects.toThrow();
  const blob = blobs()[0]!; storage.entries.set(blob, JSON.stringify({ blobVersion: 1, sha256: '0'.repeat(64), base64: '' }));
  await expect(readLocalMigrationArchive(saved.journal.archiveId, storage)).rejects.toMatchObject({ code: 'archive-integrity' });
});

it('archive IDs and content-addressed payloads stay unchanged across offline rehydration', async () => {
  const saved = await (await prepare()).commit(); const before = new Map(storage.entries);
  const { archive } = await readLocalMigrationArchive(saved.journal.archiveId, storage);
  expect(archive.archiveId).toBe(saved.journal.archiveId); expect(storage.entries).toEqual(before);
  expect(canonicalJson(archive.assessment)).toContain('inventorySha256');
});

it('external content works with an arbitrary filename, is archived byte-for-byte and never creates a Legacy session', async () => {
  const json = JSON.stringify(definition());
  const plan = await prepareExternalLegacyMigration({ definitionJson: json, source: { kind: 'file', name: 'payload.txt' } }, resources, inventory, { storage });
  const saved = await plan.commit();
  expect(saved.journal.sourceKind).toBe('file');
  expect(storage.entries.has('payload.txt')).toBe(false);
  expect((await readLocalMigrationArchive(saved.journal.archiveId, storage)).archive.original.definition!.json).toBe(json);
  const again = await prepareExternalLegacyMigration({ definitionJson: json, source: { kind: 'file', name: 'renamed.json' } }, resources, inventory, { storage });
  expect((await again.commit()).journal.id).toBe(saved.journal.id);
  expect(targets()).toHaveLength(1);
});

it('inventory documentation/fixture/source-location changes reuse the original archive and completed migration', async () => {
  const first = await (await prepare()).commit(), count = storage.entries.size;
  const changed = structuredClone(inventory);
  changed.status = 'documentation changed';
  changed.references.dartGoldens.sha256 = 'b'.repeat(64);
  changed.structures.LegacyTemplate.source = 'different-file.ts';
  const second = await (await prepareLocalLegacyMigration(key, undefined, resources, changed, { storage })).commit();
  expect(second).toEqual(first); expect(storage.entries.size).toBe(count);
  const saved = await readLocalMigrationArchive(first.journal.archiveId, storage);
  expect(saved.inventory).toEqual(inventory);
});

it('source identity excludes resources and semantics; resource and policy changes are independent migration identities', async () => {
  const saved = await (await prepare()).commit(), { archive } = await readLocalMigrationArchive(saved.journal.archiveId, storage);
  const a = await migrationIdentity(archive), b = await migrationIdentity(archive, { migrationVersion: 1, converterVersion: '1', policyVersion: 2 });
  expect(a.sourceIdentitySha256).toBe(b.sourceIdentitySha256); expect(a.id).not.toBe(b.id);
  const different = structuredClone(archive); different.assessment.references[0]!.actualSha256 = 'c'.repeat(64);
  const c = await migrationIdentity(different);
  expect(c.sourceIdentitySha256).toBe(a.sourceIdentitySha256); expect(c.resourceSemanticsSha256).not.toBe(a.resourceSemanticsSha256);
  const defaults = structuredClone(archive); defaults.assessment.resolved.frames[0]!.implicitLayers = !defaults.assessment.resolved.frames[0]!.implicitLayers;
  expect((await migrationIdentity(defaults)).id).not.toBe(a.id);
  const next = await prepareLocalLegacyMigration(key, undefined, resources, inventory, { storage,
    semantics: { migrationVersion: 1, converterVersion: '1', policyVersion: 2 } });
  const result = await next.commit(); expect(result.journal.id).not.toBe(saved.journal.id);
  expect(result.journal.policyVersion).toBe(2); expect(result.journal.converterVersion).toBe('1');
  expect(targets()).toHaveLength(2);
  await expect(prepareLocalLegacyMigration(key, undefined, resources, inventory, { storage,
    semantics: { migrationVersion: 1, converterVersion: 'future', policyVersion: 1 } })).rejects.toMatchObject({ code: 'converter-version' });
});

it('older journals without separate identity fields remain discoverable and resumable', async () => {
  const saved = await (await prepare()).commit();
  const old = { ...saved.journal };
  delete old.sourceKind; delete old.sourceIdentitySha256; delete old.resourceSemanticsSha256; delete old.policyVersion;
  storage.entries.set(`${MIGRATION_PREFIX}journal:${old.id}`, JSON.stringify(old));
  const plan = await prepare(); expect((await plan.commit()).journal.id).toBe(old.id);
  const resumed = await resumeLocalLegacyMigration(old.id, { storage }); expect((await resumed.commit()).journal.id).toBe(old.id);
});

it('discovery distinguishes unmigrated/currently changed local sources, completed targets and durable archives', async () => {
  expect((await listLegacyMigrationData(storage)).sources).toEqual([key]);
  const saved = await (await prepare()).commit();
  const data = await listLegacyMigrationData(storage);
  expect(data.sources).toEqual([]); expect(data.archives).toEqual([saved.journal.archiveId]);
  expect(data.journals[0]!.status).toBe('completed');
  storage.entries.set(key, JSON.stringify({ ...definition(), name: 'New source state' }));
  expect((await listLegacyMigrationData(storage)).sources).toEqual([key]);
});

it('two independent clients cannot supersede a concurrent prepared migration or duplicate its immutable archive/target', async () => {
  const original = storage.entries.get(key)!;
  const a = createSessionClient(storage), b = createSessionClient(storage);
  try {
    const plans = await Promise.all([
      prepareLocalLegacyMigration(key, undefined, resources, inventory, { storage: a }),
      prepareLocalLegacyMigration(key, undefined, resources, inventory, { storage: b }),
    ]);
    const results = await Promise.allSettled(plans.map((plan) => plan.commit()));
    const successful = results.filter((result) => result.status === 'fulfilled');
    expect(successful.length).toBeGreaterThan(0);
    for (const result of results) if (result.status === 'rejected') expect(result.reason as unknown).toMatchObject({ code: 'superseded' });
    const completed = await readCompletedLocalMigration(plans[0].id, a);
    expect(completed.journal.status).toBe('completed'); expect(completed.journal.attempts).toBe(1);
    expect([...storage.entries.keys()].filter((k) => k.startsWith(`${MIGRATION_PREFIX}archive:`))).toHaveLength(1);
    expect((await a.query({ kind: 'raster' })).items.filter((meta) => meta.key.endsWith('.raster128.json'))).toHaveLength(1);
    const archiveValues = storage.history.map((entries) => entries.get(`${MIGRATION_PREFIX}archive:${completed.journal.archiveId}`)).filter((value) => value !== undefined);
    expect(new Set(archiveValues).size).toBe(1); expect(storage.entries.get(key)).toBe(original);
    const restarted = createSessionClient(storage);
    try {
      expect((await readCompletedLocalMigration(plans[0].id, restarted)).json).toBe(completed.json);
      expect((await readLocalMigrationArchive(completed.journal.archiveId, restarted)).archive.original.definition!.json).toBe(original);
      expect((await (await resumeLocalLegacyMigration(plans[0].id, { storage: restarted })).commit()).json).toBe(completed.json);
    } finally { restarted.close(); }
  } finally { a.close(); b.close(); }
});
