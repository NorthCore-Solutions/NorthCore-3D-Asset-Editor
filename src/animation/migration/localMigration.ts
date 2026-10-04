import { parseRasterDocument, restoreSession } from '../files';
import type { AnimationStore } from '../store';
import { canonicalJson, sha256 } from '../contentHash';
import { createLegacyOriginalArchive } from './legacyAudit';
import type { LegacyInput, LegacyInventory, OriginalArchive, ResourceSet } from './legacyAudit';
import { convertLegacyArchive, LegacyConversionBlockedError } from './legacyConverter';
import type { ConversionReport, LegacyConversion } from './legacyConverter';
import { localSessionStorage, readStorageKeys, hasStorageKey, queryStorage, ensureDocumentCatalog } from '../storage';
import type { StorageQuery } from '../storageCatalog';
import { preparedMetadata } from '../storageCatalog';
import type { SessionStorage } from '../storage';

export const MIGRATION_PREFIX = '__migration_v1:';
const journalKey = (id: string) => `${MIGRATION_PREFIX}journal:${id}`;
const archiveKey = (id: string) => `${MIGRATION_PREFIX}archive:${id}`;
const blobKey = (hash: string) => `${MIGRATION_PREFIX}blob:${hash}`;
const stageKey = (id: string) => `${MIGRATION_PREFIX}stage:${id}`;
const identityKey = (id: string) => `${MIGRATION_PREFIX}document-id:${id}`;
export type MigrationSemantics = { migrationVersion: number; converterVersion: string; policyVersion: number };
export const CURRENT_MIGRATION_SEMANTICS: MigrationSemantics = Object.freeze({ migrationVersion: 1, converterVersion: '1', policyVersion: 1 });
export type MigrationJournal = {
  journalVersion: 1; migrationVersion: number; converterVersion: string;
  sourceKind?: 'file' | 'local'; sourceIdentitySha256?: string; resourceSemanticsSha256?: string; policyVersion?: number;
  scope: 'rendered-animation'; libraryDisposition: 'archived-only' | 'absent';
  id: string; sourceKey: string; sourceSha256: string; libraryKey: string; librarySha256: string | null;
  archiveId: string; conversionSha256: string;
  targetId: string; targetKey: string; targetSha256: string | null;
  route: 'exact' | 'lossy'; approval: 'not-required' | 'approved';
  approvedConversionSha256: string | null;
  status: 'prepared' | 'stored' | 'completed' | 'failed';
  revision: number; attempts: number; error: { name: string; message: string; code: string } | null;
};
type StoredArchive = Omit<OriginalArchive, 'resources'> & {
  storageVersion: 1; inventorySha256: string;
  resources: (Omit<OriginalArchive['resources'][number], 'original'> & { encoding: 'text' | 'bytes'; blobSha256: string })[];
};
export type LossyApproval = { archiveId: string; conversionSha256: string };
export class LocalMigrationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'LocalMigrationError'; }
}
function fail(code: string, message: string): never { throw new LocalMigrationError(code, message); }
function cancelled(signal?: AbortSignal) { if (signal?.aborted) fail('aborted', 'Migration abgebrochen.'); }
function readJournal(raw: string | undefined): MigrationJournal | null {
  if (raw === undefined) return null;
  const journal = JSON.parse(raw) as MigrationJournal;
  if (journal.journalVersion !== 1 || !Number.isSafeInteger(journal.migrationVersion) || journal.migrationVersion < 1 || typeof journal.converterVersion !== 'string' || !journal.converterVersion || journal.scope !== 'rendered-animation')
    fail('journal-version', 'Unbekannte Migrationsjournal-Version.');
  const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if ((journal.sourceKind !== undefined && !['file', 'local'].includes(journal.sourceKind)) ||
    (journal.sourceIdentitySha256 !== undefined && !hash(journal.sourceIdentitySha256)) ||
    (journal.resourceSemanticsSha256 !== undefined && !hash(journal.resourceSemanticsSha256)) ||
    (journal.policyVersion !== undefined && (!Number.isSafeInteger(journal.policyVersion) || journal.policyVersion < 1)) ||
    !hash(journal.id) || !hash(journal.sourceSha256) || !hash(journal.archiveId) || !hash(journal.conversionSha256) ||
    typeof journal.sourceKey !== 'string' || !journal.sourceKey || (journal.sourceKind !== 'file' && !journal.sourceKey.endsWith('.finoanim.json')) || typeof journal.libraryKey !== 'string' ||
    typeof journal.targetId !== 'string' || !journal.targetId || journal.targetKey !== `Raster-Migration ${journal.targetId}.raster128.json` ||
    !['prepared', 'stored', 'completed', 'failed'].includes(journal.status) || !['exact', 'lossy'].includes(journal.route) ||
    !Number.isSafeInteger(journal.revision) || journal.revision < 1 || !Number.isSafeInteger(journal.attempts) || journal.attempts < 1 ||
    (journal.librarySha256 !== null && !hash(journal.librarySha256)) || (journal.targetSha256 !== null && !hash(journal.targetSha256)) ||
    (journal.status === 'completed' && journal.targetSha256 === null) ||
    (journal.route === 'lossy' ? journal.approval !== 'approved' || journal.approvedConversionSha256 !== journal.conversionSha256 : journal.approval !== 'not-required'))
    fail('journal-integrity', 'Ungültige Migrationsjournal-Daten.');
  return journal;
}
function binary(value: string | Uint8Array) { return typeof value === 'string' ? new TextEncoder().encode(value) : value; }
function base64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
function unbase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
function immutable(entries: Map<string, string>, key: string, value: string) {
  if (entries.has(key) && entries.get(key) !== value) fail('collision', `Belegter unveränderlicher Schlüssel: ${key}`);
  entries.set(key, value);
}
function sourceUnchanged(entries: Map<string, string>, archive: OriginalArchive, libraryKey: string) {
  if (archive.original.source.kind === 'file') return;
  if (entries.get(archive.original.source.name) !== archive.original.definition!.json ||
    (entries.get(libraryKey) ?? null) !== (archive.original.library?.json ?? null))
    fail('source-changed', 'Legacy-Quelle oder Bibliothek wurde seit der Erfassung geändert.');
}
function assertIdentityAvailable(entries: Map<string, string>, journal: MigrationJournal) {
  if (entries.has(journal.targetKey) ||
    (entries.has(identityKey(journal.targetId)) && entries.get(identityKey(journal.targetId)) !== journal.id))
    fail('collision', 'Zielname oder Dokument-ID ist bereits belegt.');
  for (const [key, value] of entries) {
    if (key.startsWith('__') || key.endsWith('.finoanim.json')) continue;
    let doc: { version?: number; metadata?: { id?: string } };
    try { doc = JSON.parse(value) as typeof doc; } catch { continue; }
    if (doc?.version === 2 && doc.metadata?.id === journal.targetId) fail('collision', 'Dokument-ID gehört bereits einer anderen Sitzung.');
  }
}

async function archivePayloads(archive: OriginalArchive, inventory: LegacyInventory) {
  const blobs = new Map<string, string>();
  const encode = async (value: string | Uint8Array) => {
    const hash = await sha256(value);
    blobs.set(blobKey(hash), JSON.stringify({ blobVersion: 1, sha256: hash, base64: base64(binary(value)) }));
    return hash;
  };
  const manifest: StoredArchive = { ...archive, storageVersion: 1,
    inventorySha256: await encode(canonicalJson(inventory)), resources: [] };
  for (const resource of archive.resources) {
    const { original, ...reference } = resource;
    if (!original) fail('archive-incomplete', 'Originalarchiv enthält nur Ressourcenreferenzen.');
    const value = 'text' in original ? original.text : new Uint8Array(original.bytes);
    manifest.resources.push({ ...reference, encoding: 'text' in original ? 'text' : 'bytes', blobSha256: await encode(value) });
  }
  return { blobs, json: canonicalJson(manifest) };
}

/** Read-only rehydration, including the original inventory: shipped assets are not needed. */
export async function readLocalMigrationArchive(id: string, storage: SessionStorage = localSessionStorage) {
  const raw = (await readStorageKeys(storage, [archiveKey(id)])).get(archiveKey(id));
  if (!raw) fail('archive-missing', 'Originalarchiv fehlt.');
  const manifest = JSON.parse(raw) as StoredArchive;
  if (manifest.storageVersion !== 1 || manifest.archiveVersion !== 1 || manifest.archiveId !== id) fail('archive-version', 'Ungültiges Archivformat.');
  if (!(await storage.metadata?.(archiveKey(id)))?.detailsKnown)
    await storage.enrich?.(archiveKey(id), raw, await preparedMetadata(archiveKey(id), raw));
  const hashes = [...new Set([manifest.inventorySha256, ...manifest.resources.map((ref) => ref.blobSha256)])];
  const rows = await readStorageKeys(storage, hashes.map(blobKey));
  const snapshot = { manifest, blobs: new Map(hashes.map((hash) => [hash, rows.get(blobKey(hash))])) };
  const decode = async (hash: string) => {
    const raw = snapshot.blobs.get(hash);
    if (!raw) fail('archive-incomplete', 'Archivressource fehlt.');
    const blob = JSON.parse(raw) as { blobVersion: number; sha256: string; base64: string };
    const bytes = unbase64(blob.base64);
    if (blob.blobVersion !== 1 || blob.sha256 !== hash || await sha256(bytes) !== hash) fail('archive-integrity', 'Archivressource hat eine ungültige Prüfsumme.');
    return bytes;
  };
  const { storageVersion: _storage, inventorySha256, resources, ...original } = snapshot.manifest;
  if (_storage !== 1) fail('archive-version', 'Ungültige Archivversion.');
  const inventory = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await decode(inventorySha256))) as LegacyInventory;
  const archive: OriginalArchive = { ...original, resources: [] };
  for (const resource of resources) {
    const { encoding, blobSha256, ...ref } = resource, bytes = await decode(blobSha256);
    if (blobSha256 !== ref.actualSha256 || (encoding !== 'text' && encoding !== 'bytes')) fail('archive-integrity', 'Archivreferenz ist inkonsistent.');
    archive.resources.push({ ...ref, original: encoding === 'text' ? { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } : { bytes: [...bytes] } });
  }
  if (canonicalJson(archive.resources.map(({ original, ...ref }) => { if (!original) fail('archive-incomplete', 'Archivpayload fehlt.'); return ref; })) !== canonicalJson(archive.assessment.references))
    fail('archive-integrity', 'Archivressourcen stimmen nicht mit dem ursprünglichen Audit überein.');
  if (await sha256(canonicalJson({ archiveVersion: 1, original: archive.original, assessment: archive.assessment })) !== id ||
    inventorySha256 !== archive.assessment.inventorySha256 ||
    await sha256(archive.original.definition!.json) !== archive.original.definition!.sha256 ||
    (archive.original.library && await sha256(archive.original.library.json) !== archive.original.library.sha256))
    fail('archive-integrity', 'Originalarchiv ist inkonsistent.');
  return { archive, inventory };
}

export async function readLocalMigrationJournal(id: string, storage: SessionStorage = localSessionStorage) {
  return readJournal((await readStorageKeys(storage, [journalKey(id)])).get(journalKey(id)));
}
/** Only atomically published targets are readable/openable through this API. */
export async function readCompletedLocalMigration(id: string, storage: SessionStorage = localSessionStorage) {
  const journal = await readLocalMigrationJournal(id, storage);
  if (!journal || journal.status !== 'completed') fail('not-completed', 'Migration ist noch nicht vollständig gespeichert.');
  const rows = await readStorageKeys(storage, [journalKey(id), journal.targetKey]);
  const current = readJournal(rows.get(journalKey(id))), json = rows.get(journal.targetKey);
  if (!current || current.status !== 'completed' || current.revision !== journal.revision) fail('not-completed', 'Migrationsjournal wurde inzwischen geändert.');
  if (!json || !await hasStorageKey(storage, archiveKey(journal.archiveId))) fail('target-missing', 'Migriertes Ziel oder Originalarchiv fehlt.');
  const saved = { journal: current, json };
  const parsed = parseRasterDocument(saved.json);
  if (await sha256(saved.json) !== saved.journal.targetSha256 || parsed.state.metadata.id !== saved.journal.targetId ||
    parsed.state.metadata.provenance?.archiveId !== saved.journal.archiveId) fail('target-integrity', 'Migriertes Ziel wurde außerhalb der Migration verändert.');
  return saved;
}
export async function openCompletedLocalMigration(store: AnimationStore, id: string, storage: SessionStorage = localSessionStorage) {
  const session = store.captureContent(), saved = await readCompletedLocalMigration(id, storage);
  if (!store.isCurrentSession(session)) return 'stale';
  restoreSession(store, saved.json);
  return 'opened';
}

class LocalLegacyMigration {
  private disposed = false;
  private busy = false;
  constructor(readonly id: string, private archive: OriginalArchive | null, private inventory: LegacyInventory | null,
    private conversion: LegacyConversion | null, private storage: SessionStorage,
    private semantics: MigrationSemantics, private sourceIdentitySha256: string, private resourceSemanticsSha256: string) {}
  get report(): ConversionReport { if (!this.conversion) fail('disposed', 'Migrationsplan wurde freigegeben.'); return structuredClone(this.conversion.report); }
  get targetId() { if (!this.conversion) fail('disposed', 'Migrationsplan wurde freigegeben.'); return this.conversion.document.metadata.id; }
  get previews(): readonly LegacyConversion['previews'][number][] { return this.conversion?.previews ?? []; }
  dispose() { this.disposed = true; if (this.conversion) this.conversion.previews.length = 0; this.archive = null; this.inventory = null; this.conversion = null; }
  async commit(options: { approval?: LossyApproval; signal?: AbortSignal } = {}) {
    if (this.busy) fail('busy', 'Dieser Migrationsplan wird bereits gespeichert.');
    if (!this.archive || !this.inventory || !this.conversion || this.disposed) fail('disposed', 'Migrationsplan wurde freigegeben.');
    this.busy = true;
    const archive = this.archive, inventory = this.inventory, conversion = this.conversion;
    let ownedRevision: number | null = null;
    const check = () => { cancelled(options.signal); if (this.disposed) fail('aborted', 'Migration abgebrochen.'); };
    try {
      check();
      const sourceKeys = archive.original.source.kind === 'local' ? [archive.original.source.name, inventory.persistence.libraryKey] : [];
      const existing = await this.storage.run((entries) => { check(); sourceUnchanged(entries, archive, inventory.persistence.libraryKey); return readJournal(entries.get(journalKey(this.id))); }, [...sourceKeys, journalKey(this.id)]);
      if (existing?.status === 'completed') return await readCompletedLocalMigration(this.id, this.storage);
      const lossy = conversion.report.route === 'gerastert verlustbehaftet';
      const approved = !lossy || (options.approval?.archiveId === archive.archiveId && options.approval.conversionSha256 === conversion.report.conversionSha256);
      if (!approved && !(existing?.approval === 'approved' && existing.approvedConversionSha256 === conversion.report.conversionSha256))
        fail('approval-required', 'Verlustbehaftete Rasterisierung benötigt eine ausdrückliche, an diesen Bericht gebundene Freigabe.');
      const payloads = await archivePayloads(archive, inventory); check();
      await ensureDocumentCatalog(this.storage); check();
      const targetId = existing?.targetId ?? conversion.document.metadata.id;
      const targetKey = existing?.targetKey ?? `Raster-Migration ${targetId}.raster128.json`;
      let journal = await this.storage.run((entries) => {
        check(); sourceUnchanged(entries, archive, inventory.persistence.libraryKey);
        const prior = readJournal(entries.get(journalKey(this.id)));
        if (prior?.status === 'completed') return prior;
        if ((prior?.revision ?? null) !== (existing?.revision ?? null)) fail('superseded', 'Ein anderer Tab hat diesen Migrationslauf inzwischen geändert. Erneut prüfen oder wiederaufnehmen.');
        if (prior && prior.archiveId !== archive.archiveId) fail('superseded', 'Archiv eines bestehenden Laufs verwenden; erneut vorbereiten.');
        const next: MigrationJournal = {
          journalVersion: 1, ...this.semantics, scope: 'rendered-animation',
          sourceKind: archive.original.source.kind, sourceIdentitySha256: this.sourceIdentitySha256, resourceSemanticsSha256: this.resourceSemanticsSha256,
          libraryDisposition: archive.original.library ? 'archived-only' : 'absent', id: this.id,
          sourceKey: archive.original.source.name, sourceSha256: archive.original.definition!.sha256,
          libraryKey: inventory.persistence.libraryKey, librarySha256: archive.original.library?.sha256 ?? null,
          archiveId: archive.archiveId, conversionSha256: conversion.report.conversionSha256,
          targetId: prior?.targetId ?? conversion.document.metadata.id,
          targetKey: prior?.targetKey ?? `Raster-Migration ${conversion.document.metadata.id}.raster128.json`,
          targetSha256: prior?.targetSha256 ?? null, route: lossy ? 'lossy' : 'exact',
          approval: lossy ? 'approved' : 'not-required', approvedConversionSha256: lossy ? conversion.report.conversionSha256 : null,
          status: 'prepared', revision: (prior?.revision ?? 0) + 1, attempts: (prior?.attempts ?? 0) + 1, error: null,
        };
        assertIdentityAvailable(entries, next);
        for (const [key, value] of payloads.blobs) immutable(entries, key, value);
        immutable(entries, archiveKey(archive.archiveId), payloads.json);
        immutable(entries, identityKey(next.targetId), this.id);
        entries.set(journalKey(this.id), JSON.stringify(next));
        return next;
      }, [...sourceKeys, journalKey(this.id), archiveKey(archive.archiveId), identityKey(targetId), targetKey, ...payloads.blobs.keys()], targetId);
      if (journal.status === 'completed') return await readCompletedLocalMigration(this.id, this.storage);
      ownedRevision = journal.revision; check();
      const doc = structuredClone(conversion.document); doc.metadata = { ...doc.metadata, id: journal.targetId };
      const json = JSON.stringify(doc); parseRasterDocument(json);
      const hash = await sha256(json); check();
      journal = await this.storage.run((entries) => {
        check(); sourceUnchanged(entries, archive, inventory.persistence.libraryKey);
        const current = readJournal(entries.get(journalKey(this.id)));
        if (!current || current.revision !== ownedRevision) fail('superseded', 'Ein anderer Migrationslauf hat diesen Versuch ersetzt.');
        immutable(entries, stageKey(this.id), json);
        const next: MigrationJournal = { ...current, targetSha256: hash, status: 'stored', revision: current.revision + 1 };
        entries.set(journalKey(this.id), JSON.stringify(next)); return next;
      }, [...sourceKeys, journalKey(this.id), stageKey(this.id)]);
      ownedRevision = journal.revision; check();
      await this.storage.run((entries) => {
        check(); sourceUnchanged(entries, archive, inventory.persistence.libraryKey);
        const current = readJournal(entries.get(journalKey(this.id)));
        if (!current || current.revision !== ownedRevision || current.status !== 'stored') fail('superseded', 'Migrationslauf wurde ersetzt.');
        assertIdentityAvailable(entries, current);
        if (entries.get(stageKey(this.id)) !== json || !entries.has(archiveKey(current.archiveId))) fail('target-integrity', 'Vorbereitete Daten fehlen.');
        entries.set(current.targetKey, json);
        entries.set(journalKey(this.id), JSON.stringify({ ...current, status: 'completed', revision: current.revision + 1 }));
        entries.delete(stageKey(this.id));
      }, [...sourceKeys, journalKey(this.id), stageKey(this.id), archiveKey(journal.archiveId), journal.targetKey, identityKey(journal.targetId)], journal.targetId);
      return await readCompletedLocalMigration(this.id, this.storage);
    } catch (caught) {
      const error = caught instanceof Error && caught.name === 'StorageIdentityCollision' ? new LocalMigrationError('collision', caught.message) : caught;
      if (ownedRevision !== null) {
        try {
          await this.storage.run((entries) => {
            const current = readJournal(entries.get(journalKey(this.id)));
            if (!current || current.revision !== ownedRevision || current.status === 'completed') return;
            entries.set(journalKey(this.id), JSON.stringify({ ...current, status: 'failed', revision: current.revision + 1,
              error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), code: error instanceof LocalMigrationError ? error.code : 'write-failed' } }));
          }, [journalKey(this.id)]);
        } catch { /* A persistent quota/write failure cannot itself be journaled; prepared/stored remains recoverable. */ }
      }
      throw error;
    } finally { this.busy = false; this.dispose(); }
  }
}

export async function migrationIdentity(archive: OriginalArchive, semantics = CURRENT_MIGRATION_SEMANTICS) {
  if (!Number.isSafeInteger(semantics.migrationVersion) || semantics.migrationVersion < 1 ||
    !semantics.converterVersion || !Number.isSafeInteger(semantics.policyVersion) || semantics.policyVersion < 1)
    fail('semantics-version', 'Ungültige Konvertierungs-/Semantikversion.');
  const sourceIdentitySha256 = await sha256(canonicalJson({ kind: archive.original.source.kind,
    key: archive.original.source.kind === 'local' ? archive.original.source.name : null,
    definition: archive.original.definition!.sha256, library: archive.original.library?.sha256 ?? null }));
  const resourceSemanticsSha256 = await sha256(canonicalJson({
    rigVersion: archive.assessment.resolved.rigVersion, addonRoot: archive.assessment.resolved.addonRoot,
    resolvedFrames: archive.assessment.resolved.frames,
    resources: archive.assessment.references.map((r) => [r.path, r.actualSha256]).sort(([a], [b]) => a! < b! ? -1 : a! > b! ? 1 : 0),
  }));
  const id = await sha256(canonicalJson({ sourceIdentitySha256, resourceSemanticsSha256, ...semantics }));
  return { id, sourceIdentitySha256, resourceSemanticsSha256 };
}
async function makePlan(archive: OriginalArchive, inventory: LegacyInventory, storage: SessionStorage, signal?: AbortSignal,
  semantics = CURRENT_MIGRATION_SEMANTICS, retainedId?: string) {
  cancelled(signal);
  if (semantics.converterVersion !== CURRENT_MIGRATION_SEMANTICS.converterVersion) fail('converter-version', 'Konverterversion wird von diesem Build nicht unterstützt.');
  const identity = await migrationIdentity(archive, semantics);
  const conversion = await convertLegacyArchive(archive, new Map(), inventory);
  try {
    cancelled(signal);
    return new LocalLegacyMigration(retainedId ?? identity.id, archive, inventory, conversion, storage,
      structuredClone(semantics), identity.sourceIdentitySha256, identity.resourceSemanticsSha256);
  } catch (error) { conversion.previews.length = 0; throw error; }
}
async function prepareArchive(archive: OriginalArchive, inventory: LegacyInventory, storage: SessionStorage,
  options: { signal?: AbortSignal; semantics?: MigrationSemantics }) {
  if (!archive.assessment.complete || archive.assessment.route === 'blockiert') throw new LegacyConversionBlockedError('audit-blocked', 'Blockierte Inhalte werden nicht migriert.', archive.assessment);
  const semantics = structuredClone(options.semantics ?? CURRENT_MIGRATION_SEMANTICS), identity = await migrationIdentity(archive, semantics);
  // Reuse immutable archived resources/report even when nonsemantic inventory metadata changed.
  let after: string | undefined;
  do {
    const page = await queryStorage(storage, { kind: 'journal', sourceSha256: archive.original.definition!.sha256, after });
    for (const meta of page.items) {
      const journal = readJournal(meta.summary);
      if (!journal || journal.librarySha256 !== (archive.original.library?.sha256 ?? null) ||
        (journal.sourceKind ?? 'local') !== archive.original.source.kind ||
        (archive.original.source.kind !== 'file' && journal.sourceKey !== archive.original.source.name) ||
        journal.migrationVersion !== semantics.migrationVersion || journal.converterVersion !== semantics.converterVersion ||
        (journal.policyVersion ?? 1) !== semantics.policyVersion ||
        (journal.sourceIdentitySha256 && journal.sourceIdentitySha256 !== identity.sourceIdentitySha256) ||
        (journal.resourceSemanticsSha256 && journal.resourceSemanticsSha256 !== identity.resourceSemanticsSha256)) continue;
      // Only a possible identity match needs its archive payload. Historical journals without these
      // hashes still use the full integrity-checked fallback; matching metadata is never sufficient proof.
      const saved = await readLocalMigrationArchive(journal.archiveId, storage);
      const prior = await migrationIdentity(saved.archive, semantics);
      if (prior.sourceIdentitySha256 === identity.sourceIdentitySha256 && prior.resourceSemanticsSha256 === identity.resourceSemanticsSha256)
        return makePlan(saved.archive, saved.inventory, storage, options.signal, semantics, journal.id);
    }
    after = page.next;
  } while (after !== undefined);
  return makePlan(archive, inventory, storage, options.signal, semantics);
}
/** External originals are captured in the archive, never installed as mutable local authoring sessions. */
export async function prepareExternalLegacyMigration(input: LegacyInput, resources: ResourceSet, inventory: LegacyInventory,
  options: { storage?: SessionStorage; signal?: AbortSignal; semantics?: MigrationSemantics } = {}) {
  if (input.source.kind !== 'file' || typeof input.source.name !== 'string' || !input.source.name.trim() || !input.definitionJson) fail('source-format', 'Externe Legacy-Definition fehlt.');
  const storage = options.storage ?? localSessionStorage, known = structuredClone(inventory);
  const signal = options.signal, semantics = structuredClone(options.semantics ?? CURRENT_MIGRATION_SEMANTICS);
  cancelled(signal);
  const archive = await createLegacyOriginalArchive(input, resources, known, true);
  return prepareArchive(archive, known, storage, { signal, semantics });
}
export async function prepareLocalLegacyMigration(sourceKey: string, context: LegacyInput['context'], resources: ResourceSet, inventory: LegacyInventory,
  options: { storage?: SessionStorage; signal?: AbortSignal; semantics?: MigrationSemantics } = {}) {
  if (!sourceKey.endsWith('.finoanim.json') || sourceKey.startsWith(MIGRATION_PREFIX)) fail('source-key', 'Kein lokaler Legacy-Definitionskey.');
  const storage = options.storage ?? localSessionStorage, known = structuredClone(inventory), capturedContext = structuredClone(context);
  const signal = options.signal, semantics = structuredClone(options.semantics ?? CURRENT_MIGRATION_SEMANTICS);
  const files = new Map([...resources].map(([key, value]) => [key, typeof value === 'string' ? value : new Uint8Array(value)] as const));
  cancelled(options.signal);
  const input = await storage.run((entries): LegacyInput => {
    const definitionJson = entries.get(sourceKey);
    if (definitionJson === undefined) fail('source-missing', 'Lokale Legacy-Definition fehlt.');
    return { definitionJson, source: { kind: 'local', name: sourceKey }, ...(capturedContext ? { context: capturedContext } : {}),
      ...(entries.has(known.persistence.libraryKey) ? { libraryJson: entries.get(known.persistence.libraryKey)! } : {}) };
  }, [sourceKey, known.persistence.libraryKey]);
  await storage.enrich?.(sourceKey, input.definitionJson!, await preparedMetadata(sourceKey, input.definitionJson!));
  if (input.libraryJson !== undefined) await storage.enrich?.(known.persistence.libraryKey, input.libraryJson, await preparedMetadata(known.persistence.libraryKey, input.libraryJson));
  const archive = await createLegacyOriginalArchive(input, files, known, true);
  return prepareArchive(archive, known, storage, { signal, semantics });
}
export async function resumeLocalLegacyMigration(id: string, options: { storage?: SessionStorage; signal?: AbortSignal } = {}) {
  const storage = options.storage ?? localSessionStorage, journal = await readLocalMigrationJournal(id, storage);
  if (!journal) fail('journal-missing', 'Migrationsjournal fehlt.');
  const { archive, inventory } = await readLocalMigrationArchive(journal.archiveId, storage);
  const plan = await makePlan(archive, inventory, storage, options.signal,
    { migrationVersion: journal.migrationVersion, converterVersion: journal.converterVersion, policyVersion: journal.policyVersion ?? 1 }, journal.id);
  if (plan.report.conversionSha256 !== journal.conversionSha256) { plan.dispose(); fail('journal-integrity', 'Archivkonvertierung stimmt nicht mit dem Journal überein.'); }
  if (plan.id !== id) { plan.dispose(); fail('journal-integrity', 'Journalidentität stimmt nicht mit dem Archiv überein.'); }
  return plan;
}

/** Small indexed pages; historical sources with unknown hashes remain visible until explicitly inspected. */
export async function listLegacyMigrationData(storage: SessionStorage = localSessionStorage,
  options: { sourceAfter?: string; journalAfter?: string; archiveAfter?: string; limit?: number; filter?: Omit<StorageQuery, 'kind' | 'after' | 'limit'> } = {}) {
  const [sourcePage, journalPage, archivePage, libraryPage] = await Promise.all([
    queryStorage(storage, { kind: 'legacy-source', after: options.sourceAfter, limit: options.limit }),
    queryStorage(storage, { kind: 'journal', after: options.journalAfter, limit: options.limit, ...options.filter }),
    queryStorage(storage, { kind: 'archive', after: options.archiveAfter, limit: options.limit }),
    queryStorage(storage, { kind: 'legacy-library', limit: 1 }),
  ]);
  const sources: string[] = [];
  const library = libraryPage.items[0];
  for (const source of sourcePage.items) {
    let completed = false;
    // A missing historical hash is not evidence of successful migration.
    if (source.sourceSha256 && (!library || library.sourceSha256)) {
      let after: string | undefined;
      do {
        const page = await queryStorage(storage, { kind: 'journal', status: 'completed', sourceKey: source.key, after });
        completed = page.items.some((meta) => { const j = readJournal(meta.summary); return j &&
          (j.sourceKind ?? 'local') === 'local' && j.sourceSha256 === source.sourceSha256 && j.librarySha256 === (library?.sourceSha256 ?? null); });
        after = page.next;
      } while (!completed && after);
    }
    if (!completed) sources.push(source.key);
  }
  return { sources, journals: journalPage.items.map((meta) => {
    const journal = readJournal(meta.summary); if (!journal) fail('journal-integrity', 'Journal benötigt eine Detailprüfung: ' + meta.key); return journal;
  }), archives: archivePage.items.map((meta) => meta.archiveId!),
    unverifiedSources: sourcePage.items.filter((meta) => !meta.sourceSha256 || (library && !library.sourceSha256)).map((meta) => meta.key),
    next: { sources: sourcePage.next, journals: journalPage.next, archives: archivePage.next } };
}
export async function hasUnfinishedMigrations(storage: SessionStorage = localSessionStorage) {
  for (const status of ['prepared', 'stored', 'failed', 'unknown']) {
    const page = await queryStorage(storage, { kind: 'journal', status, limit: 1 });
    if (page.items.length) return true;
  }
  return false;
}
/** Original-JSON export deliberately does not hydrate resource blobs. */
export async function readLocalArchiveOriginal(id: string, storage: SessionStorage = localSessionStorage) {
  const raw = (await readStorageKeys(storage, [archiveKey(id)])).get(archiveKey(id));
  if (!raw) fail('archive-missing', 'Originalarchiv fehlt.');
  const manifest = JSON.parse(raw) as StoredArchive;
  if (manifest.storageVersion !== 1 || manifest.archiveVersion !== 1 || manifest.archiveId !== id ||
    await sha256(canonicalJson({ archiveVersion: 1, original: manifest.original, assessment: manifest.assessment })) !== id ||
    await sha256(manifest.original.definition!.json) !== manifest.original.definition!.sha256 ||
    (manifest.original.library && await sha256(manifest.original.library.json) !== manifest.original.library.sha256))
    fail('archive-integrity', 'Originalarchiv ist inkonsistent.');
  return manifest.original;
}
