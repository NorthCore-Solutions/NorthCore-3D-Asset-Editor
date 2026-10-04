import { encode } from 'fast-png';
import { decodePng } from './png';
import { localSessionStorage, sameStorageHead, StorageConflictError } from './storage';
import type { SessionClient, SessionRecord } from './storage';
import { saveBlobAs } from '../platform/nativeFileDialog';
import { production } from './raster';
import type { Frame, Layer, PixelAsset, Rect, Reference, SourceId } from './raster';
import type { AnimationStore } from './store';
import { parseDocumentMetadata, upgradeV1Metadata } from './document';
import type { DocumentMetadata } from './document';

export const REFERENCE_NAMES = [
  'standing_neutral',
  'standing_active',
  'eating',
  'reading',
  'sitting_relaxed',
  'sleeping',
] as const;
export const REFERENCE_LABELS = [
  'Stehend – neutral',
  'Stehend – aktiv',
  'Essend',
  'Lesend',
  'Sitzend – entspannt',
  'Schlafend',
];
export async function importReference(file: Blob, name: string, aligned = false): Promise<Reference> {
  const data = new Uint8Array(await file.arrayBuffer());
  let source: { width: number; height: number; rgba: Uint8Array };
  if (data[0] === 137 && data[1] === 80) source = decodePng(data);
  else {
    const image = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      source = {
        width: image.width,
        height: image.height,
        rgba: new Uint8Array(ctx.getImageData(0, 0, image.width, image.height).data),
      };
    } finally {
      image.close();
    }
  }
  if (aligned && (source.width !== 128 || source.height !== 128))
    throw Error('Referenz muss 128×128 Pixel haben.');
  const factor = 128 / Math.max(source.width, source.height);
  return {
    name,
    ...source,
    aligned,
    visible: true,
    bounds: { x: 0, y: 0, width: source.width * factor, height: source.height * factor },
  };
}
export async function builtinReference(index: number): Promise<Reference> {
  const name = REFERENCE_NAMES[index];
  if (!name) throw Error('Unbekannte Referenz');
  const response = await fetch(`${import.meta.env.BASE_URL}animation/tracing/fino_${name}_128.png`);
  if (!response.ok) throw Error('Referenz konnte nicht geladen werden.');
  return importReference(await response.blob(), REFERENCE_LABELS[index]!, true);
}
export async function exportPng(frame: Frame, name: string) {
  const data = encode({ width: 1024, height: 1024, channels: 4, depth: 8, data: production(frame.layers) });
  return saveBlobAs(new Blob([new Uint8Array(data)], { type: 'image/png' }), `${name}-1024.png`, 'image/png');
}
type SavedLayer = Omit<Layer, 'pixels'> & { pixels: [number, number][] };
type SavedAsset = Omit<PixelAsset, 'pixels'> & { pixels: [number, number][] };
type SessionContent = {
  name: string;
  source: SourceId;
  frames: { duration: number; layers: SavedLayer[];  }[];
  templates: SavedAsset[];
  reference: (Omit<Reference, 'rgba'> & { rgba: number[] }) | null;
};
export type RasterSessionV1 = SessionContent & { version: 1; index: number; active: string };
export type RasterSessionV2 = SessionContent & { version: 2; metadata: DocumentMetadata };
export const RASTER_DOCUMENT_EXTENSION = '.raster128.json';
export const RASTER_DOCUMENT_ACCEPT = `${RASTER_DOCUMENT_EXTENSION},application/json`;
/** File export deliberately does not establish a saved baseline or retain a write target. */
export function exportRasterDocument(store: AnimationStore) {
  const json = serializeSession(store);
  const name = Array.from(store.state.name, (char) =>
    char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('').trim() || 'Rasteranimation';
  return saveBlobAs(new Blob([json], { type: 'application/json' }), `${name}${RASTER_DOCUMENT_EXTENSION}`, 'application/json');
}
/** The same restore/parser path serves local storage and portable V1/V2 files. */
export async function importRasterDocument(store: AnimationStore, file: Blob | null): Promise<'imported' | 'cancelled' | 'stale'> {
  if (!file) return 'cancelled';
  const session = store.captureContent();
  const json = await file.text();
  if (!store.isCurrentSession(session)) return 'stale';
  restoreSession(store, json);
  return 'imported';
}
export function serializeSession(store: AnimationStore): string {
  const asset = (a: PixelAsset): SavedAsset => ({ ...a, pixels: [...a.pixels] });
  const layer = (l: Layer): SavedLayer => ({ id: l.id, name: l.name, visible: l.visible, locked: l.locked, pixels: [...l.pixels] });
  const data: RasterSessionV2 = {
    version: 2,
    name: store.state.name,
    source: store.state.source,
    metadata: parseDocumentMetadata(store.state.metadata),
    frames: store.state.frames.map((f) => ({
      duration: f.duration,
      layers: f.layers.map(layer),
    })),
    templates: store.templates.map(asset),
    reference: store.reference ? { ...store.reference, rgba: [...store.reference.rgba] } : null,
  };
  return JSON.stringify(data);
}
/** Shared, pure document parser: validates every field before any editor mutation. */
export function parseRasterDocument(json: string): Pick<AnimationStore, 'state' | 'templates'> {
  const s = JSON.parse(json) as RasterSessionV1 | RasterSessionV2;
  if (!s || (s.version !== 1 && s.version !== 2)) throw Error('Unbekannte Raster-Dokumentversion.');
  if (
    !Array.isArray(s.frames) ||
    !s.frames.length ||
    s.frames.length > 1000 ||
    typeof s.name !== 'string' ||
    typeof s.source !== 'string'
  )
    throw Error('Ungültige Builder-Sitzung.');
  const pixels = (items: unknown) => {
    if (
      !Array.isArray(items) ||
      items.length > 16384 ||
      items.some(
        (item: unknown) => {
          if (!Array.isArray(item) || item.length !== 2) return true;
          const [k, v] = item as unknown[];
          return typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k >= 16384 ||
            typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff;
        }
      )
    )
      throw Error('Ungültige Rasterdaten.');
    return new Map(items as [number, number][]);
  };
  const named = (item: { id: string; name: string }) => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string')
      throw Error('Ungültiger Layer oder Collection-Eintrag.');
  };
  const bounds = (rect: Rect, integer: boolean) => {
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every((v) =>
      typeof v === 'number' && Number.isFinite(v) && (!integer || Number.isInteger(v))) ||
      rect.width <= 0 || rect.height <= 0) throw Error('Ungültige Dokument-Bounds.');
  };
  const frames = s.frames.map((f) => {
    if (!f || !Number.isInteger(f.duration) || f.duration < 1 || !Array.isArray(f.layers))
      throw Error('Ungültiger Frame.');
    return { duration: f.duration, layers: f.layers.map((l) => {
      named(l);
      if (typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean') throw Error('Ungültiger Layer.');
      // Removed optional authoring metadata never controls saved pixel content.
      return { id: l.id, name: l.name, visible: l.visible, locked: l.locked, pixels: pixels(l.pixels) };
    }) };
  });
  const assets = (items: SavedAsset[]) => {
    if (!Array.isArray(items)) throw Error('Ungültige Collection.');
    return items.map((a) => {
      named(a); bounds(a.bounds, true);
      return { ...a, pixels: pixels(a.pixels) };
    });
  };
  const templates = assets(s.templates);
  const ref = s.reference;
  if (
    ref &&
    (typeof ref.name !== 'string' || typeof ref.visible !== 'boolean' || typeof ref.aligned !== 'boolean' ||
      !Number.isInteger(ref.width) ||
      !Number.isInteger(ref.height) ||
      ref.width < 1 ||
      ref.height < 1 ||
      !Array.isArray(ref.rgba) || ref.rgba.length !== ref.width * ref.height * 4 ||
      ref.rgba.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
  )
    throw Error('Ungültige Referenz.');
  if (ref !== null) {
    if (!ref || typeof ref !== 'object') throw Error('Ungültige Referenz.');
    bounds(ref.bounds, false);
  }
  const metadata = s.version === 2 ? parseDocumentMetadata(s.metadata) : upgradeV1Metadata({
    name: s.name, source: s.source,
    frames: frames.map((f) => ({ ...f, layers: f.layers.map((l) => ({ ...l, pixels: [...l.pixels].sort(([a], [b]) => a - b) })) })),
    templates: templates.map((a) => ({ ...a, pixels: [...a.pixels].sort(([a], [b]) => a - b) })),
    reference: ref,
  }, s.source);
  const state = {
    metadata,
    name: s.name,
    source: s.source === 'transparent' ? 'transparent' as const : 'empty' as const,
    index: s.version === 1 && Number.isInteger(s.index) ? Math.max(0, Math.min(frames.length - 1, s.index)) : 0,
    active: s.version === 1 && typeof s.active === 'string' ? s.active : frames[0]!.layers.find((l) => !l.locked)?.id ?? '',
    frames,
    reference: ref ? { ...ref, rgba: new Uint8Array(ref.rgba) } : null,
  };
  return { state, templates };
}
export function restoreSession(store: AnimationStore, json: string) {
  const document = parseRasterDocument(json);
  persistedBases.delete(store);
  store.pause(false);
  store.past = [];
  store.future = [];
  store.selection = null;
  store.referenceSelected = false;
  store.state = document.state;
  store.templates = document.templates;
  store.resetSavedContent();
  store.emit();
}

// One in-flight write per store, including across builder remounts. Session guards remain independent of CAS.
const pendingSaves = new WeakSet<AnimationStore>();
const persistedBases = new WeakMap<AnimationStore, { session: ReturnType<AnimationStore['captureContent']>; records: Map<string, SessionRecord> }>();
function bases(store: AnimationStore) {
  let base = persistedBases.get(store);
  if (!base || !store.isCurrentSession(base.session)) {
    base = { session: store.captureContent(), records: new Map() }; persistedBases.set(store, base);
  }
  return base;
}
/** Explicit local load reads the current record, validates it, then establishes its write basis. */
export async function loadRasterSession(store: AnimationStore, key: string, storage: SessionClient = localSessionStorage) {
  const session = store.captureContent(), record = await storage.read(key);
  if (!store.isCurrentSession(session)) return 'stale';
  if (record.value === undefined) throw Error('Lokale Sitzung fehlt.');
  restoreSession(store, record.value);
  bases(store).records.set(key, record);
  store.localPersistence = { key, status: 'saved' }; store.emit();
  return 'loaded';
}
/** Notifications mark newer content; they never adopt a foreign basis or mutate local pixels. */
export function watchRasterStorage(store: AnimationStore, storage: SessionClient = localSessionStorage) {
  const check = async (keys: readonly string[]) => {
    const base = bases(store), key = store.localPersistence?.key ?? store.state.name, expected = base.records.get(key) ?? (pendingSaves.has(store) ? { value: undefined, revision: null } : undefined);
    if (!expected || (!keys.includes(key) && !keys.includes('*'))) return;
    const current = await storage.head(key);
    if (!store.isCurrentSession(base.session) || (base.records.has(key) && base.records.get(key) !== expected) || storage.isOwnRecord(current) || sameStorageHead(current, expected)) return;
    store.localPersistence = { key, status: store.dirty || pendingSaves.has(store) ? 'conflict' : 'updated',
      error: store.dirty || pendingSaves.has(store) ? new StorageConflictError(key).message : undefined };
    store.emit();
  };
  const report = (keys: readonly string[]) => { void check(keys).catch(() => { /* The next explicit read/write reports storage errors. */ }); };
  const unsubscribe = storage.subscribe(report);
  report([...bases(store).records.keys()]);
  return unsubscribe;
}
export async function saveRasterSession(store: AnimationStore, options: { expected?: SessionRecord; storage?: SessionClient } = {}): Promise<'saved' | 'changed' | 'stale' | 'busy'> {
  if (pendingSaves.has(store)) return 'busy';
  pendingSaves.add(store);
  const content = store.captureContent(), base = bases(store), storage = options.storage ?? localSessionStorage;
  try {
    const json = serializeSession(store);
    const expected = options.expected ?? base.records.get(content.name) ?? { value: undefined, revision: null };
    if (content.name.startsWith('__')) throw Error('Reservierter Speicherkey.');
    store.localPersistence = { key: content.name, status: 'saving' }; store.emit();
    const written = await storage.write(content.name, json, expected);
    if (!store.isCurrentSession(content)) return 'stale';
    base.records.set(content.name, written);
    const externallyChanged = store.localPersistence?.status === 'conflict';
    store.localPersistence = { key: content.name, status: externallyChanged ? 'updated' : 'saved' };
    if (!store.markSaved(content)) return 'stale';
    return store.dirty ? 'changed' : 'saved';
  } catch (error) {
    if (!store.isCurrentSession(content)) return 'stale';
    store.localPersistence = { key: content.name, status: error instanceof StorageConflictError ? 'conflict' : 'failed',
      error: error instanceof Error ? error.message : String(error) }; store.emit();
    throw error;
  } finally { pendingSaves.delete(store); }
}
