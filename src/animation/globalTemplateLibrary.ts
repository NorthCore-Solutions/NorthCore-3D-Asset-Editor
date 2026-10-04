import { saveBlobAs } from '../platform/nativeFileDialog';
import { bounds, contains, rectMask } from './raster';
import type { Rect } from './raster';
import type { AnimationStore } from './store';
import { emptyGlobalLibrary, parseGlobalLibrary } from './globalTemplateFormat';
import type { GlobalTemplate, GlobalTemplateDocument, LibraryReceipt } from './globalTemplateFormat';
import { localSessionStorage, sameStorageHead, StorageConflictError } from './storage';
import type { SessionClient, SessionRecord } from './storage';
import { canonicalJson, sha256 } from './contentHash';

export const GLOBAL_TEMPLATE_KEY = '__raster128_global_templates_v1';
export const GLOBAL_TEMPLATE_EXTENSION = '.raster128-library.json';
export interface GlobalLibraryStorage {
  read(this: void): Promise<string | undefined>;
  write(this: void, json: string): Promise<void>;
  acceptRead?(this: void): void;
  overwrite?(this: void, json: string): Promise<void>;
  subscribe?(this: void, changed: () => void): () => void;
}
export function globalLibraryStorage(client: SessionClient = localSessionStorage): GlobalLibraryStorage {
  let base: SessionRecord = { value: undefined, revision: null }, pendingRead: SessionRecord | undefined;
  return {
    read: async () => { pendingRead = await client.read(GLOBAL_TEMPLATE_KEY); return pendingRead.value; },
    acceptRead: () => { if (pendingRead) { base = pendingRead; pendingRead = undefined; } },
    write: async (json) => { base = await client.write(GLOBAL_TEMPLATE_KEY, json, base); },
    overwrite: async (json) => {
      const current = await client.read(GLOBAL_TEMPLATE_KEY);
      base = await client.write(GLOBAL_TEMPLATE_KEY, json, current);
    },
    subscribe: (changed) => client.subscribe((keys) => {
      if (keys.includes(GLOBAL_TEMPLATE_KEY) || keys.includes('*')) void client.head(GLOBAL_TEMPLATE_KEY).then((current) => {
        if (!client.isOwnRecord(current) && !sameStorageHead(current, base)) changed();
      }).catch(() => { /* A later read/write reports the error. */ });
    }),
  };
}
function unique(value: string, used: Set<string>) { let next = value, n = 2; while (used.has(next)) next = `${value} (${n++})`; return next; }
function append(document: GlobalTemplateDocument, templates: GlobalTemplate[]) {
  const ids = new Set(document.templates.map((t) => t.id)), names = new Set(document.templates.map((t) => t.name));
  const added = templates.map((t) => {
    const copy = { ...t, id: unique(t.id, ids), name: unique(t.name, names) };
    ids.add(copy.id); names.add(copy.name); return copy;
  });
  return { document: { ...document, templates: [...document.templates, ...added] }, ids: added.map((t) => t.id) };
}
async function validatedDocument(json: string) {
  const document = parseGlobalLibrary(json);
  for (const receipt of document.migrations) if (await sha256(receipt.originalJson) !== receipt.sourceSha256)
    throw Error('Ungültige Prüfsumme des archivierten Legacy-Bibliotheksoriginals.');
  return document;
}

/** Global lifetime: sessions never cancel or adopt library writes. Document dirty is separate. */
export class GlobalTemplateLibrary {
  private document = emptyGlobalLibrary();
  private ready = false;
  private refreshing = false;
  private loading: Promise<void> | null = null;
  private operations: ((d: GlobalTemplateDocument) => GlobalTemplateDocument)[] = [];
  private rebasing = false;
  private rebasedIds = new Map<string, string>();
  private revision = 0;
  private savedRevision = 0;
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();
  private latest: { revision: number; task: Promise<void> } | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  error: string | null = null;
  private externalRevision = 0;
  externalChanged = false;
  conflict = false;
  private readonly unsubscribe?: () => void;
  constructor(private readonly persistence: GlobalLibraryStorage = globalLibraryStorage()) {
    this.unsubscribe = persistence.subscribe?.(() => {
      this.externalRevision++; this.externalChanged = true;
      if (this.dirty) { this.conflict = true; this.error = new StorageConflictError(GLOBAL_TEMPLATE_KEY).message; }
      this.emit();
    });
  }
  dispose() { this.unsubscribe?.(); }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.version;
  private emit() { this.version++; this.listeners.forEach((fn) => fn()); }
  get templates() { return structuredClone(this.document.templates); }
  get loaded() { return this.ready; }
  get dirty() { return this.pending > 0 || this.revision !== this.savedRevision; }
  get status(): 'loading' | 'pending' | 'failed' | 'saved' {
    return this.error ? 'failed' : !this.ready ? 'loading' : this.pending ? 'pending' : 'saved';
  }
  async load(): Promise<void> {
    if (this.ready) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const json = await this.persistence.read();
        let loaded = json === undefined ? emptyGlobalLibrary() : await validatedDocument(json);
        this.rebasing = true;
        try { for (const op of this.operations) loaded = op(loaded); }
        finally { this.rebasing = false; this.rebasedIds.clear(); }
        this.document = parseGlobalLibrary(JSON.stringify(loaded));
        this.persistence.acceptRead?.();
        this.operations = []; this.ready = true; this.error = null;
        if (this.revision > this.savedRevision) void this.save();
      } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      finally { this.loading = null; this.emit(); }
    })();
    return this.loading;
  }
  private change(op: (d: GlobalTemplateDocument) => GlobalTemplateDocument) {
    const next = parseGlobalLibrary(JSON.stringify(op(this.document)));
    if (canonicalJson(next) === canonicalJson(this.document)) return;
    this.document = next; this.revision++;
    if (!this.ready) this.operations.push(op);
    this.emit();
    if (this.ready) void this.save(); else void this.load();
  }
  private save(overwrite = false): Promise<void> {
    if (this.latest?.revision === this.revision) return this.latest.task;
    const revision = this.revision, json = JSON.stringify(this.document);
    this.pending++;
    const task = this.queue.then(async () => {
      try {
        if (this.refreshing) throw Error('Bibliothek wird neu geladen; lokale Änderung bleibt ungespeichert.');
        if (this.conflict && !overwrite) throw new StorageConflictError(GLOBAL_TEMPLATE_KEY);
        const externalRevision = this.externalRevision;
        if (overwrite && this.persistence.overwrite) await this.persistence.overwrite(json);
        else await this.persistence.write(json);
        if (overwrite && externalRevision === this.externalRevision) { this.conflict = false; this.externalChanged = false; }
        this.savedRevision = revision;
        if (revision === this.revision) this.error = null;
      } catch (error) {
        if (error instanceof StorageConflictError) { this.conflict = true; this.externalChanged = true; }
        if (revision === this.revision || this.conflict) this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.pending--;
        if (this.latest?.task === task) this.latest = null;
        this.emit();
      }
    });
    this.queue = task; this.latest = { revision, task }; this.emit();
    return task;
  }
  /** Explicit resolutions only: queued local edits are never merged into a foreign library. */
  async reload() {
    if (this.refreshing) throw Error('Bibliothek wird bereits neu geladen.');
    this.refreshing = true;
    try {
      await this.loading; await this.queue;
      const revision = this.revision, externalRevision = this.externalRevision;
      const json = await this.persistence.read();
      const loaded = json === undefined ? emptyGlobalLibrary() : await validatedDocument(json);
      if (revision !== this.revision || externalRevision !== this.externalRevision) throw Error('Bibliothek wurde während des Ladens erneut geändert. Aktueller lokaler Stand bleibt erhalten.');
      this.document = loaded; this.persistence.acceptRead?.();
      this.operations = []; this.ready = true; this.savedRevision = revision;
      this.error = null; this.conflict = false; this.externalChanged = false; this.emit();
    } finally { this.refreshing = false; }
  }
  async overwrite() { await this.queue; if (!this.ready) throw Error('Bibliothek zuerst laden.'); await this.save(true); }
  async retry() { if (!this.ready) await this.load(); else await this.save(); }
  async settled() { await this.load(); await this.queue; }
  add(template: GlobalTemplate) {
    const valid = parseGlobalLibrary(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template] })).templates;
    let visibleId: string | undefined;
    this.change((d) => {
      const added = append(d, valid);
      if (visibleId === undefined) visibleId = added.ids[0]!;
      else if (this.rebasing) this.rebasedIds.set(visibleId, added.ids[0]!);
      return added.document;
    });
  }
  private operationId(id: string) { return this.rebasing ? this.rebasedIds.get(id) ?? id : id; }
  rename(id: string, name: string) {
    const base = name.trim(); if (!base) return;
    this.change((d) => {
      const target = this.operationId(id);
      return { ...d, templates: d.templates.map((t) => t.id === target ? { ...t,
        name: unique(base, new Set(d.templates.filter((other) => other.id !== target).map((other) => other.name))) } : t) };
    });
  }
  remove(id: string) { this.change((d) => ({ ...d, templates: d.templates.filter((t) => t.id !== this.operationId(id)) })); }
  exportJson() { return JSON.stringify(this.document, null, 2); }
  /** Backup import is an explicit replacement, validated before any mutation; autosave still applies. */
  async importJson(json: string) {
    const parsed = await validatedDocument(json);
    await this.load();
    if (!this.ready) {
      // Explicit backup replacement can repair a failed/corrupt initial read.
      this.document = parsed; this.operations = []; this.ready = true; this.error = null;
      this.revision++; this.emit(); void this.save();
    } else this.change(() => parsed);
  }
  /** Native batch import; compatibility validation/consent lives in the import layer. */
  async importTemplates(templates: GlobalTemplate[], receipt: Omit<LibraryReceipt, 'templateIds'>) {
    const captured = structuredClone({ templates, receipt });
    await validatedDocument(JSON.stringify({ ...emptyGlobalLibrary(), migrations: [{ ...captured.receipt, templateIds: [] }] }));
    await this.load();
    if (!this.ready) throw Error(this.error ?? 'Bibliothek ist nicht geladen.');
    if (this.document.migrations.some((r) => r.sourceSha256 === captured.receipt.sourceSha256)) {
      if (this.dirty) await this.retry();
      await this.queue;
      if (this.dirty) throw Error(this.error ?? 'Bibliothek ist noch nicht gespeichert.');
      return 'existing';
    }
    this.change((d) => {
      if (d.migrations.some((r) => r.sourceSha256 === captured.receipt.sourceSha256)) return d;
      const added = append(d, captured.templates);
      return { ...added.document, migrations: [...d.migrations, { ...captured.receipt, templateIds: added.ids }] };
    });
    await this.queue;
    if (this.dirty) throw Error(this.error ?? 'Bibliotheksänderungen sind noch nicht vollständig gespeichert.');
    return 'migrated';
  }

}
export const globalTemplateLibrary = new GlobalTemplateLibrary();

export function saveGlobalSelection(store: AnimationStore, library: GlobalTemplateLibrary, name: string) {
  const layer = store.editable, rectangle = store.selection && bounds(store.selection);
  if (!layer || !rectangle || !name.trim()) return false;
  const pixels: [number, number][] = [...layer.pixels].filter(([k]) => store.selection!.has(k))
    .map(([k, value]) => [(Math.floor(k / 128) - rectangle.y) * 128 + k % 128 - rectangle.x, value]);
  if (!pixels.length) return false;
  library.add({ id: crypto.randomUUID(), name: name.trim(), width: rectangle.width, height: rectangle.height,
    origin: { x: rectangle.x, y: rectangle.y }, pixels });
  return true;
}
/** Apply using explicit rectangle, preserving empty borders; existing document transforms stay untouched. */
export function applyGlobalTemplate(store: AnimationStore, template: GlobalTemplate, to: Rect = { ...template.origin, width: template.width, height: template.height }) {
  const layer = store.editable;
  if (!layer || ![to.x, to.y, to.width, to.height].every(Number.isSafeInteger) || to.width < 1 || to.height < 1 || to.width > 128 || to.height > 128) return;
  const pixels = new Map(layer.pixels), source = new Map(template.pixels);
  for (let y = 0; y < to.height; y++) for (let x = 0; x < to.width; x++) {
    const value = source.get(Math.floor(y * template.height / to.height) * 128 + Math.floor(x * template.width / to.width));
    if (value !== undefined && contains(to.x + x, to.y + y)) pixels.set((to.y + y) * 128 + to.x + x, value);
  }
  store.pixels(layer, pixels);
  store.setSelection(rectMask(to, { x: to.x + to.width - 1, y: to.y + to.height - 1 }));
}
export async function exportGlobalLibrary(library: GlobalTemplateLibrary = globalTemplateLibrary) {
  await library.load();
  if (!library.loaded) throw Error(library.error ?? 'Bibliothek ist noch nicht geladen.');
  return saveBlobAs(new Blob([library.exportJson()], { type: 'application/json' }), `Raster-Vorlagen${GLOBAL_TEMPLATE_EXTENSION}`, 'application/json');
}
export async function importGlobalLibrary(library: GlobalTemplateLibrary, file: Pick<File, 'text'>) {
  const json = await file.text(); await library.importJson(json);
}
