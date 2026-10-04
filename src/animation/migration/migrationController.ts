import inventory from './legacy-inventory.json';
import presets from '../data/legacy-presets.json?raw';
import { readStorageKeys, queryStorage, localSessionStorage } from '../storage';
import { inspectLegacy } from './legacyAudit';
import type { LegacyInput, LegacyAudit, ResourceSet } from './legacyAudit';
import { prepareExternalLegacyMigration, prepareLocalLegacyMigration, resumeLocalLegacyMigration, openCompletedLocalMigration, hasUnfinishedMigrations } from './localMigration';
import type { ConversionReport } from './legacyConverter';
import type { AnimationStore } from '../store';

type Plan = Awaited<ReturnType<typeof prepareExternalLegacyMigration>>;
type Request = { kind: 'external'; input: LegacyInput } | { kind: 'local'; key: string } | { kind: 'resume'; id: string };
export type MigrationStatus = 'idle' | 'preparing' | 'review' | 'blocked' | 'saving' | 'saved' | 'failed';
let cachedResources: Promise<ResourceSet> | undefined;
export function loadMigrationResources(): Promise<ResourceSet> {
  cachedResources ??= Promise.all(inventory.assets.map(async (asset) => {
    const response = await fetch(`${import.meta.env.BASE_URL}${asset.path.replace(/^public\//, '')}`);
    if (!response.ok) throw Error(`Legacy-Ressource fehlt: ${asset.path}`);
    return [asset.path, new Uint8Array(await response.arrayBuffer())] as const;
  })).then((entries) => new Map<string, string | Uint8Array>([...entries, [inventory.presets.path, presets]]))
    .catch((error: unknown) => { cachedResources = undefined; throw error; });
  return cachedResources;
}
/** Recognition only; the inventory audit is the authoritative full validation. */
export function recognizeLegacyDefinition(json: string): void {
  const raw = JSON.parse(json) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    typeof raw.basePose !== 'string' || typeof raw.id !== 'string' || typeof raw.name !== 'string' ||
    !Array.isArray(raw.frames) || !raw.frames.length || (raw.version !== 1 && raw.version !== 2))
    throw Error('Keine unterstützte Legacy-Animationsdefinition. Der Dateiinhalt ist maßgeblich.');
}
export class LegacyMigrationController {
  private listeners = new Set<() => void>();
  private version = 0;
  private generation = 0;
  private statusRead = 0;
  private abortController?: AbortController;
  private plan?: Plan;
  private request?: Request;
  private failedWrite = false;
  private unresolved = false;
  private context?: LegacyInput['context'];
  constructor() {
    localSessionStorage.subscribe?.((keys) => {
      if (keys.some((key) => key === '*' || key.startsWith('__migration_v1:') || key.endsWith('.finoanim.json') || key === '__legacy_templates'))
        void this.loadStatus().catch(() => { /* Explicit manager read/retry reports storage errors. */ });
    });
  }
  status: MigrationStatus = 'idle';
  error: string | null = null;
  audit: LegacyAudit | null = null;
  report: ConversionReport | null = null;
  completedId: string | null = null;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private emit() { this.version++; this.listeners.forEach((listener) => listener()); }
  get dirty() { return this.status === 'saving' || this.failedWrite || this.unresolved; }
  get previews() { return this.plan?.previews ?? []; }
  async external(file: Blob, name: string) {
    if (this.status === 'saving' || this.failedWrite) throw Error('Ausstehenden Migrationslauf zuerst erneut speichern.');
    this.abortController?.abort(); this.plan?.dispose(); this.plan = undefined;
    this.audit = null; this.report = null; this.completedId = null; this.request = undefined;
    const generation = ++this.generation;
    this.status = 'preparing'; this.error = null; this.emit();
    try {
      const json = await file.text();
      if (generation !== this.generation) return;
      recognizeLegacyDefinition(json);
      await this.review({ kind: 'external', input: { definitionJson: json, source: { kind: 'file', name } } });
    } catch (error) { if (generation === this.generation) { this.status = 'blocked'; this.error = String(error instanceof Error ? error.message : error); this.emit(); } }
  }
  local(key: string, context?: LegacyInput['context']) {
    if (this.failedWrite) return Promise.reject(Error('Fehlgeschlagenen Lauf zuerst erneut speichern.'));
    return this.review({ kind: 'local', key }, context);
  }
  resume(id: string) {
    if (this.failedWrite) return Promise.reject(Error('Fehlgeschlagenen Lauf zuerst erneut speichern.'));
    return this.review({ kind: 'resume', id });
  }
  recheck(context?: LegacyInput['context']) { return this.request ? this.review(this.request, context) : Promise.resolve(); }
  private async review(request: Request, context?: LegacyInput['context']) {
    if (this.status === 'saving') throw Error('Eine Migration wird bereits gespeichert.');
    this.abortController?.abort(); this.plan?.dispose(); this.plan = undefined;
    this.abortController = new AbortController(); const generation = ++this.generation;
    this.request = request; this.context = context; this.status = 'preparing'; this.error = null;
    this.audit = null; this.report = null; this.completedId = null; this.emit();
    try {
      let plan: Plan;
      if (request.kind === 'resume') plan = await resumeLocalLegacyMigration(request.id, { signal: this.abortController.signal });
      else {
        const resources = await loadMigrationResources();
        if (generation !== this.generation) return;
        let input: LegacyInput;
        if (request.kind === 'external') input = { ...request.input, ...(context ? { context } : {}) };
        else {
          const entries = await readStorageKeys(localSessionStorage, [request.key, inventory.persistence.libraryKey]), json = entries.get(request.key);
          if (json === undefined) throw Error('Lokale Legacy-Quelle fehlt.');
          input = { definitionJson: json, source: { kind: 'local', name: request.key }, ...(context ? { context } : {}),
            ...(entries.has(inventory.persistence.libraryKey) ? { libraryJson: entries.get(inventory.persistence.libraryKey)! } : {}) };
        }
        recognizeLegacyDefinition(input.definitionJson!);
        const audit = await inspectLegacy(input, resources, inventory);
        if (generation !== this.generation) return;
        this.audit = audit;
        if (!audit.complete || audit.route === 'blockiert') { this.status = 'blocked'; this.emit(); return; }
        const options = { signal: this.abortController.signal };
        plan = request.kind === 'external' ? await prepareExternalLegacyMigration(input, resources, inventory, options)
          : await prepareLocalLegacyMigration(request.key, context, resources, inventory, options);
      }
      if (generation !== this.generation) { plan.dispose(); return; }
      this.plan = plan; this.report = plan.report; this.status = 'review'; this.emit();
    } catch (error) {
      if (generation === this.generation) { this.status = 'blocked'; this.error = error instanceof Error ? error.message : String(error); this.emit(); }
    }
  }
  async commit(approveLossy: boolean) {
    if (!this.plan || this.status !== 'review') throw Error('Kein vollständig freigegebener Migrationsplan.');
    const plan = this.plan, report = plan.report;
    if (report.route === 'gerastert verlustbehaftet' && !approveLossy) throw Error('Ausdrückliche Freigabe erforderlich.');
    const generation = this.generation;
    this.status = 'saving'; this.failedWrite = true; this.emit();
    try {
      const saved = await plan.commit({ signal: this.abortController?.signal,
        ...(approveLossy ? { approval: { archiveId: report.source.archiveId, conversionSha256: report.conversionSha256 } } : {}) });
      if (generation === this.generation) { this.completedId = saved.journal.id; this.status = 'saved'; this.failedWrite = false; this.error = null; }
    } catch (error) {
      if (generation === this.generation) { this.status = 'failed'; this.error = error instanceof Error ? error.message : String(error); }
    } finally { if (generation === this.generation) { this.plan = undefined;
      try { await this.loadStatus(); } catch { /* The captured failure remains protected if the DB is unavailable. */ }
      this.emit(); } }
  }
  async loadStatus() {
    const read = ++this.statusRead;
    const unresolved = await hasUnfinishedMigrations();
    if (read !== this.statusRead) return;
    this.unresolved = unresolved;
    this.emit();
  }
  async retry() {
    const id = this.plan?.id;
    if (id) return this.review({ kind: 'resume', id });
    // Lookup durable journal first; failure before the archive write retains the captured request.
    const archiveId = this.report?.source.archiveId;
    const page = archiveId ? await queryStorage(localSessionStorage, { kind: 'journal', archiveId, limit: 1 }) : null;
    const journal = page?.items[0];
    if (journal) return this.review({ kind: 'resume', id: journal.key.slice('__migration_v1:journal:'.length) });
    if (this.request) return this.review(this.request, this.context);
  }
  /** Aborting a write keeps its durable journal/error protected; closing the UI is not success. */
  cancel() {
    this.abortController?.abort();
    if (this.status === 'saving') return;
    this.generation++; this.plan?.dispose(); this.plan = undefined;
    if (!this.failedWrite) { this.status = 'idle'; this.audit = null; this.report = null; this.error = null; }
    this.emit();
  }
  async open(store: AnimationStore, id = this.completedId) {
    if (!id) throw Error('Kein abgeschlossenes Ziel.');
    return openCompletedLocalMigration(store, id);
  }
}
export const legacyMigrationController = new LegacyMigrationController();
