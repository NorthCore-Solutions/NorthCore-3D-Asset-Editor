import { expect, it, vi } from 'vitest';
import { GlobalTemplateLibrary, applyGlobalTemplate, saveGlobalSelection, exportGlobalLibrary, importGlobalLibrary } from '../src/animation/globalTemplateLibrary';
import type { GlobalLibraryStorage } from '../src/animation/globalTemplateLibrary';
import { emptyGlobalLibrary, parseGlobalLibrary } from '../src/animation/globalTemplateFormat';
import type { GlobalTemplate } from '../src/animation/globalTemplateFormat';
import { prepareLegacyTemplates, prepareArchivedLegacyTemplates, migrateLegacyTemplates } from '../src/animation/migration/legacyTemplates';
import { AnimationStore } from '../src/animation/store';
import { restoreSession, serializeSession } from '../src/animation/files';
import { canonicalJson } from '../src/animation/contentHash';
import { rectMask } from '../src/animation/raster';
import { readFileSync } from 'node:fs';
import inventory from '../src/animation/migration/legacy-inventory.json';
import { prepareLocalLegacyMigration } from '../src/animation/migration/localMigration';
import type { SessionStorage } from '../src/animation/storage';

const platform = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../src/platform/nativeFileDialog', () => ({ saveBlobAs: platform.save }));

it('native batch imports reject corrupt receipt hashes before changing the library', async () => {
  const disk = memory(), lib = new GlobalTemplateLibrary(disk.persistence);
  const plan = await prepareLegacyTemplates(legacy(), 'local');
  await expect(lib.importTemplates(plan.entries.map((entry) => entry.template!), {
    sourceKey: plan.sourceKey, sourceSha256: '0'.repeat(64), originalJson: plan.originalJson,
    reportSha256: plan.reportSha256, route: 'exact', lossyApproved: false,
  })).rejects.toThrow('Prüfsumme');
  expect(lib.templates).toEqual([]);
  expect(lib.dirty).toBe(false);
  expect(disk.writes).toEqual([]);
});
function deferred<T>() { let resolve!: (v: T) => void; return { promise: new Promise<T>((r) => { resolve = r; }), resolve }; }
const template = (id = 'native', name = 'Native'): GlobalTemplate => ({ id, name, width: 3, height: 2, origin: { x: 4, y: 5 }, pixels: [[1, 0x12345601]] });
function memory(initial?: string) {
  let json = initial;
  const writes: string[] = [];
  const persistence: GlobalLibraryStorage = { read: vi.fn(() => Promise.resolve(json)), write: vi.fn((value: string) => { writes.push(value); json = value; return Promise.resolve(); }) };
  return { persistence, writes, get json() { return json; } };
}
function legacy(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, templates: [{ id: 'legacy', name: 'Legacy', width: 24, height: 16, originX: 16, originY: 24,
    pixels: Array.from({ length: 64 }, (_, i) => ({ x: 8 + i % 8, y: Math.floor(i / 8), rgba: 0x12345601 })), ...overrides }] });
}
it('automatic writes are sequential, retain each immutable snapshot and stay pending until the latest completes', async () => {
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()], writes: string[] = [];
  let running = 0, maximum = 0;
  const lib = new GlobalTemplateLibrary({ read: () => Promise.resolve(undefined), write: async (json) => {
    const i = writes.length; writes.push(json); running++; maximum = Math.max(maximum, running); await gates[i]!.promise; running--;
  } });
  await lib.load(); lib.add(template()); lib.rename('native', 'Renamed'); lib.remove('native');
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(lib.dirty).toBe(true); expect(lib.status).toBe('pending');
  gates[0]!.resolve(); await vi.waitFor(() => expect(writes).toHaveLength(2)); expect(lib.dirty).toBe(true);
  gates[1]!.resolve(); await vi.waitFor(() => expect(writes).toHaveLength(3)); gates[2]!.resolve(); await lib.settled();
  expect(maximum).toBe(1); expect(writes.map((s) => parseGlobalLibrary(s).templates.map((t) => t.name))).toEqual([['Native'], ['Renamed'], []]);
  expect(lib.dirty).toBe(false); expect(lib.status).toBe('saved');
});
it('write errors remain dirty and visible; retry persists the latest value without extra concurrent writes', async () => {
  const disk = memory(); let failed = true;
  const lib = new GlobalTemplateLibrary({ read: disk.persistence.read, write: async (json) => { if (failed) throw Error('Quota exceeded'); await disk.persistence.write(json); } });
  await lib.load(); lib.add(template()); await lib.settled();
  expect(lib.status).toBe('failed'); expect(lib.error).toBe('Quota exceeded'); expect(lib.dirty).toBe(true);
  failed = false; await lib.retry();
  expect(lib.status).toBe('saved'); expect(lib.error).toBeNull(); expect(lib.dirty).toBe(false);
  expect(parseGlobalLibrary(disk.json!).templates[0]!.name).toBe('Native');
});
it('late initial load rebases local additions, renames and deletions without losing stored entries', async () => {
  const gate = deferred<string | undefined>(), disk = memory();
  const lib = new GlobalTemplateLibrary({ read: () => gate.promise, write: disk.persistence.write });
  const loading = lib.load(); lib.add(template('local', 'Local')); lib.rename('local', 'Edited while loading');
  lib.add(template('removed', 'Removed')); lib.remove('removed');
  expect(disk.writes).toHaveLength(0);
  gate.resolve(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('old', 'Stored')] }));
  await loading; await lib.settled();
  expect(lib.templates.map((t) => t.name)).toEqual(['Stored', 'Edited while loading']);
  expect(disk.writes).toHaveLength(1); expect(lib.dirty).toBe(false);
});
it('failed initial read never overwrites unknown persisted data and can retry with buffered edits', async () => {
  let failed = true; const disk = memory(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('old', 'Stored')] }));
  const lib = new GlobalTemplateLibrary({ read: () => failed ? Promise.reject(Error('Read failed')) : Promise.resolve(disk.json), write: disk.persistence.write });
  lib.add(template()); await lib.settled();
  expect(lib.status).toBe('failed'); expect(lib.dirty).toBe(true); expect(disk.writes).toHaveLength(0);
  failed = false; await lib.retry(); await lib.settled();
  expect(lib.templates).toHaveLength(2); expect(lib.dirty).toBe(false);
});
it('late initial ID collisions rebase subsequent local rename/delete onto the right templates', async () => {
  const gate = deferred<string | undefined>(), disk = memory();
  const lib = new GlobalTemplateLibrary({ read: () => gate.promise, write: disk.persistence.write });
  lib.add(template()); lib.add(template()); lib.rename('native', 'Local renamed'); lib.remove('native (2)');
  gate.resolve(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('native', 'Stored')] }));
  await lib.settled();
  expect(lib.templates.map((t) => [t.id, t.name])).toEqual([['native', 'Stored'], ['native (2)', 'Local renamed']]);
});
it('a validated explicit backup can repair corrupt storage without bypassing validation', async () => {
  const disk = memory('{'), lib = new GlobalTemplateLibrary(disk.persistence);
  await lib.load(); expect(lib.status).toBe('failed'); expect(disk.writes).toHaveLength(0);
  await lib.importJson(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template()] })); await lib.settled();
  expect(lib.status).toBe('saved'); expect(lib.dirty).toBe(false); expect(parseGlobalLibrary(disk.json!).templates).toHaveLength(1);
});
it('global changes and delayed writes survive document Neu/Laden without altering document baseline or frame history', async () => {
  const gate = deferred<void>(), lib = new GlobalTemplateLibrary({ read: () => Promise.resolve(undefined), write: () => gate.promise });
  const store = new AnimationStore(), original = serializeSession(store), baseline = store.captureContent();
  await lib.load(); lib.add(template());
  expect(store.dirty).toBe(false); expect(store.past).toHaveLength(0); expect(store.captureContent()).toEqual(baseline);
  store.newAnimation('Other', 'empty', false); restoreSession(store, original);
  const session = store.captureContent(); gate.resolve(); await lib.settled();
  expect(store.captureContent()).toEqual(session); expect(store.dirty).toBe(false); expect(store.past).toHaveLength(0);
  expect(lib.templates).toHaveLength(1); expect(lib.dirty).toBe(false);
});
it('saving a global selection preserves its transparent bounds and never adds document collections/history', async () => {
  const disk = memory(), lib = new GlobalTemplateLibrary(disk.persistence), store = new AnimationStore();
  store.newAnimation('Selection', 'empty', false); store.pixels(store.editable!, new Map([[5 * 128 + 5, 0x12345600]]));
  store.setSelection(rectMask({ x: 4, y: 4 }, { x: 7, y: 6 })); store.markSaved(store.captureContent());
  const history = store.past.length; expect(saveGlobalSelection(store, lib, 'Selection')).toBe(true); await lib.settled();
  expect(lib.templates[0]).toMatchObject({ width: 4, height: 3, origin: { x: 4, y: 4 }, pixels: [[129, 0x12345600]] });
  expect(store.past).toHaveLength(history); expect(store.dirty).toBe(false); expect(store.templates).toEqual([]);
});
it('applying a global template retains holes and padded borders with one normal pixel commit', () => {
  const store = new AnimationStore(); store.newAnimation('Apply', 'empty', false); const before = store.past.length;
  applyGlobalTemplate(store, template(), { x: 10, y: 20, width: 3, height: 2 });
  expect(store.layer!.pixels).toEqual(new Map([[20 * 128 + 11, 0x12345601]]));
  expect(store.selectionBounds()).toEqual({ x: 10, y: 20, width: 3, height: 2 }); expect(store.past).toHaveLength(before + 1);
  store.undo(); expect(store.layer!.pixels.size).toBe(0);
});
it('backup roundtrip preserves all native data, provenance, original JSON and receipts without changing document state', async () => {
  const disk = memory(), lib = new GlobalTemplateLibrary(disk.persistence); await lib.load(); lib.add(template());
  const plan = await prepareLegacyTemplates(legacy(), 'local'); await migrateLegacyTemplates(lib, plan);
  const json = lib.exportJson(), restored = new GlobalTemplateLibrary(memory().persistence);
  await importGlobalLibrary(restored, { text: () => Promise.resolve(json) }); await restored.settled();
  expect(parseGlobalLibrary(restored.exportJson())).toEqual(parseGlobalLibrary(json));
  platform.save.mockResolvedValueOnce(null); await exportGlobalLibrary(lib);
  const [blob, name] = platform.save.mock.calls.at(-1)! as [Blob, string];
  expect(await blob.text()).toBe(json); expect(name).toBe('Raster-Vorlagen.raster128-library.json'); expect(lib.dirty).toBe(false);
});
it.each(['{', JSON.stringify({ ...emptyGlobalLibrary(), version: 2 }), JSON.stringify({ ...emptyGlobalLibrary(), templates: [template(), template()] })])('invalid backup is rejected before mutation: %s', async (json) => {
  const lib = new GlobalTemplateLibrary(memory().persistence); await lib.load(); lib.add(template()); await lib.settled(); const before = lib.exportJson();
  await expect(lib.importJson(json)).rejects.toThrow(); expect(lib.exportJson()).toBe(before); expect(lib.dirty).toBe(false);
});
it('file read failure preserves the library; explicit empty backup during loading replaces only global data', async () => {
  const lib = new GlobalTemplateLibrary(memory(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template()] })).persistence);
  await expect(importGlobalLibrary(lib, { text: () => Promise.reject(Error('Read failed')) })).rejects.toThrow('Read failed');
  await lib.importJson(JSON.stringify(emptyGlobalLibrary())); await lib.settled(); expect(lib.templates).toEqual([]); expect(lib.dirty).toBe(false);
});
it('exact Legacy conversion preserves spacing, native origin and exact low-alpha/transparent-RGB channels', async () => {
  const raw = legacy({ pixels: Array.from({ length: 64 }, (_, i) => ({ x: 8 + i % 8, y: Math.floor(i / 8), rgba: 0x12345600 })) });
  const plan = await prepareLegacyTemplates(raw, 'legacy-source');
  expect(plan.route).toBe('exact'); expect(plan.originalJson).toBe(raw);
  expect(plan.entries[0]!.template).toMatchObject({ width: 3, height: 2, origin: { x: 2, y: 3 }, pixels: [[1, 0x12345600]],
    provenance: { originalOrigin: { x: 16, y: 24 }, originalSize: { width: 24, height: 16 }, sourceSha256: plan.sourceSha256 } });
  expect(await prepareLegacyTemplates(raw, 'legacy-source')).toEqual(plan);
});
it('lossy conversion samples local 8×8 phase deterministically; origin rounding and partial blocks require approval', async () => {
  const plan = await prepareLegacyTemplates(legacy({ originX: -3, width: 9, height: 1, pixels: [{ x: 0, y: 0, rgba: 0x12345601 }, { x: 8, y: 0, rgba: 0x87654321 }] }), 'legacy-source');
  expect(plan.route).toBe('lossy'); expect(plan.entries[0]!.template).toMatchObject({ width: 2, height: 1, origin: { x: -1, y: 3 }, pixels: [[0, 0x12345601], [1, 0x87654321]] });
  const disk = memory(), lib = new GlobalTemplateLibrary(disk.persistence);
  await expect(migrateLegacyTemplates(lib, plan)).rejects.toThrow('Freigabe'); expect(disk.writes).toEqual([]);
  await expect(migrateLegacyTemplates(lib, plan, { sourceSha256: plan.sourceSha256, reportSha256: '0'.repeat(64) })).rejects.toThrow('Freigabe');
  await migrateLegacyTemplates(lib, plan, { sourceSha256: plan.sourceSha256, reportSha256: plan.reportSha256 }); expect(lib.templates).toHaveLength(1);
});
it.each([
  { pixels: [{ x: 100, y: 0, rgba: 1 }] }, { future: true },
  { pixels: [{ x: 0, y: 0, rgba: 1 }, { x: 0, y: 0, rgba: 2 }] }, { originX: 0.5 },
])('invalid or ambiguous Legacy templates remain blocked: %o', async (overrides) => {
  const plan = await prepareLegacyTemplates(legacy(overrides), 'legacy-source'), lib = new GlobalTemplateLibrary(memory().persistence);
  expect(plan.route).toBe('blocked'); await expect(migrateLegacyTemplates(lib, plan)).rejects.toThrow('Blockierte'); expect(lib.templates).toEqual([]);
});
it('ID/name collisions preserve existing data; duplicate legacy IDs block rather than silently merge', async () => {
  const lib = new GlobalTemplateLibrary(memory().persistence); await lib.load(); lib.add(template('legacy', 'Legacy')); await lib.settled();
  const plan = await prepareLegacyTemplates(legacy(), 'legacy-source'); await migrateLegacyTemplates(lib, plan);
  expect(lib.templates.map((t) => [t.id, t.name])).toEqual([['legacy', 'Legacy'], ['legacy (2)', 'Legacy (2)']]);
  const raw = JSON.parse(legacy()) as { version: number; templates: unknown[] }; raw.templates.push(raw.templates[0]);
  expect((await prepareLegacyTemplates(JSON.stringify(raw), 'legacy-source')).route).toBe('blocked');
});
it('repeated and concurrent migration uses a durable source receipt, even after deletion; changed source is new', async () => {
  const disk = memory(), lib = new GlobalTemplateLibrary(disk.persistence), plan = await prepareLegacyTemplates(legacy(), 'local');
  await Promise.all([migrateLegacyTemplates(lib, plan), migrateLegacyTemplates(lib, plan)]); expect(lib.templates).toHaveLength(1);
  lib.remove(lib.templates[0]!.id); await lib.settled();
  const reloaded = new GlobalTemplateLibrary(memory(disk.json).persistence);
  expect(await migrateLegacyTemplates(reloaded, await prepareLegacyTemplates(legacy(), 'another-archive'))).toBe('existing'); expect(reloaded.templates).toEqual([]);
  await migrateLegacyTemplates(reloaded, await prepareLegacyTemplates(legacy({ name: 'Changed' }), 'local')); expect(reloaded.templates).toHaveLength(1);
});
it('failed migration does not claim success; receipt retry persists once with retained approval', async () => {
  let failed = true; const disk = memory();
  const lib = new GlobalTemplateLibrary({ read: disk.persistence.read, write: async (json) => { if (failed) throw Error('Write failed'); await disk.persistence.write(json); } });
  const plan = await prepareLegacyTemplates(legacy(), 'local');
  await expect(migrateLegacyTemplates(lib, plan)).rejects.toThrow('Write failed'); expect(lib.dirty).toBe(true); expect(disk.json).toBeUndefined();
  failed = false; expect(await migrateLegacyTemplates(lib, plan)).toBe('existing'); expect(lib.dirty).toBe(false); expect(lib.templates).toHaveLength(1);
});
it('modified review targets cannot bypass revalidation or approval', async () => {
  const plan = await prepareLegacyTemplates(legacy(), 'local'); plan.entries[0]!.template!.pixels[0]![1] = 999;
  const lib = new GlobalTemplateLibrary(memory().persistence);
  await expect(migrateLegacyTemplates(lib, plan)).rejects.toThrow('Prüfbericht'); expect(lib.templates).toEqual([]);
});
it('corrupt original receipt checksum is rejected before replacing current global data', async () => {
  const lib = new GlobalTemplateLibrary(memory().persistence); await migrateLegacyTemplates(lib, await prepareLegacyTemplates(legacy(), 'local'));
  const before = lib.exportJson(), changed = parseGlobalLibrary(before); changed.migrations[0]!.originalJson += ' ';
  await expect(lib.importJson(JSON.stringify(changed))).rejects.toThrow('Prüfsumme'); expect(lib.exportJson()).toBe(before);
});
it('lossy retry retains approval saved in the pending receipt, without allowing new unapproved sources', async () => {
  const disk = memory(); let failed = true;
  const lib = new GlobalTemplateLibrary({ read: disk.persistence.read, write: (json) => failed ? Promise.reject(Error('Write failed')) : disk.persistence.write(json) });
  const plan = await prepareLegacyTemplates(legacy({ originX: -3 }), 'local');
  await expect(migrateLegacyTemplates(lib, plan, { sourceSha256: plan.sourceSha256, reportSha256: plan.reportSha256 })).rejects.toThrow('Write failed');
  failed = false; expect(await migrateLegacyTemplates(lib, plan)).toBe('existing'); expect(lib.dirty).toBe(false);
  await expect(migrateLegacyTemplates(lib, await prepareLegacyTemplates(legacy({ originX: -5 }), 'local'))).rejects.toThrow('Freigabe');
});
it('a permanent step-6 archive supplies templates without changing that archive or the legacy library', async () => {
  const key = 'archived.finoanim.json', original = legacy();
  const definition = JSON.stringify({ version: 2, faceRigVersion: 2, id: 'archived', name: 'Archived', basePose: 'fino_standing_neutral.png',
    frames: [{ durationMs: 1, ops: [], layers: [{ id: 'pixels', name: 'Pixels', kind: 'pixels', pixels: [] }] }] });
  const entries = new Map([[key, definition], ['__legacy_templates', original]]);
  const disk: SessionStorage = { run: (change) => Promise.resolve(change(entries)) };
  const resources = new Map<string, string | Uint8Array>([
    ...inventory.assets.map((asset) => [asset.path, new Uint8Array(readFileSync(asset.path))] as const),
    [inventory.presets.path, readFileSync(inventory.presets.path, 'utf8')],
  ]);
  const saved = await (await prepareLocalLegacyMigration(key, undefined, resources, inventory, { storage: disk })).commit();
  const snapshot = new Map(entries), plan = await prepareArchivedLegacyTemplates(saved.journal.archiveId, disk);
  const lib = new GlobalTemplateLibrary(memory().persistence); await migrateLegacyTemplates(lib, plan);
  expect(lib.templates[0]!.provenance!.archiveId).toBe(saved.journal.archiveId);
  expect(entries).toEqual(snapshot); expect(plan.originalJson).toBe(original);
});
it('archive migration fails safely for missing archive, retaining the existing permanent-archive contract', async () => {
  await expect(prepareArchivedLegacyTemplates('0'.repeat(64), { run: (change) => Promise.resolve(change(new Map())) })).rejects.toThrow('Originalarchiv fehlt');
});
it('export cancellation/failure never marks pending library data saved', async () => {
  const gate = deferred<void>(), lib = new GlobalTemplateLibrary({ read: () => Promise.resolve(undefined), write: () => gate.promise });
  await lib.load(); lib.add(template());
  platform.save.mockResolvedValueOnce(null); await exportGlobalLibrary(lib); expect(lib.dirty).toBe(true);
  platform.save.mockRejectedValueOnce(Error('Export failed')); await expect(exportGlobalLibrary(lib)).rejects.toThrow('Export failed'); expect(lib.dirty).toBe(true);
  gate.resolve(); await lib.settled();
});
it('backup export waits for initial data and includes buffered local edits', async () => {
  const gate = deferred<string | undefined>(), lib = new GlobalTemplateLibrary({ read: () => gate.promise, write: () => Promise.resolve() });
  const before = platform.save.mock.calls.length; lib.add(template('local', 'Local'));
  platform.save.mockResolvedValueOnce(null); const exportTask = exportGlobalLibrary(lib);
  expect(platform.save.mock.calls).toHaveLength(before);
  gate.resolve(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('stored', 'Stored')] }));
  await exportTask;
  const blob = platform.save.mock.calls.at(-1)![0] as Blob;
  expect(parseGlobalLibrary(await blob.text()).templates.map((t) => t.name)).toEqual(['Stored', 'Local']);
});
it('failed initial read cannot produce a misleading empty backup', async () => {
  const lib = new GlobalTemplateLibrary({ read: () => Promise.reject(Error('Read unavailable')), write: () => Promise.resolve() });
  const before = platform.save.mock.calls.length;
  await expect(exportGlobalLibrary(lib)).rejects.toThrow('Read unavailable'); expect(platform.save.mock.calls).toHaveLength(before);
});
it('document templates still serialize and restore independently of global collections', async () => {
  const store = new AnimationStore(); store.templates = [{ id: 'document', name: 'Document', pixels: new Map([[129, 0xffffffff]]), bounds: { x: 1, y: 1, width: 1, height: 1 } }];
  store.resetSavedContent(); const original = serializeSession(store), lib = new GlobalTemplateLibrary(memory().persistence);
  lib.add(template()); await lib.settled(); const other = new AnimationStore(); restoreSession(other, original);
  expect(canonicalJson(JSON.parse(serializeSession(other)))).toBe(canonicalJson(JSON.parse(original)));
  expect(other.templates.map((t) => t.name)).toEqual(['Document']); expect(lib.templates.map((t) => t.name)).toEqual(['Native']);
});
