import { decode, encode, convertIndexedToRgb } from 'fast-png';
import { saveBlobAs } from '../platform/nativeFileDialog';
import { production } from './raster';
import type { Frame, Layer, PixelAsset, Reference, SourceId } from './raster';
import type { AnimationStore } from './store';

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
export async function legacyFiles(): Promise<Map<string, string>> {
  const names = ['idle_breathing.finoanim.json', 'idle_double_blink.finoanim.json'];
  const samples = await Promise.all(
    names.map(async (name) => {
      const response = await fetch(`${import.meta.env.BASE_URL}animation/animations/${name}`);
      if (!response.ok) throw Error(`Animation fehlt: ${name}`);
      return [name, await response.text()] as const;
    })
  );
  const local = await localSessions();
  return new Map([...samples, ...[...local].filter(([name]) => name.endsWith('.finoanim.json'))]);
}
export function decodePng(data: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const decoded = decode(data, { checkCrc: true });
  const p = decoded.palette
    ? { ...decoded, data: convertIndexedToRgb(decoded), depth: 8, channels: decoded.palette[0]!.length }
    : decoded;
  const result = new Uint8Array(p.width * p.height * 4),
    maximum = 2 ** p.depth - 1;
  const channel = (k: number, c: number) => {
    if (p.depth >= 8) return p.data[k * p.channels + c]!;
    const rowBytes = Math.ceil((p.width * p.channels * p.depth) / 8),
      bit = ((k % p.width) * p.channels + c) * p.depth;
    return (
      (p.data[Math.floor(k / p.width) * rowBytes + Math.floor(bit / 8)]! >>> (8 - p.depth - (bit % 8))) &
      maximum
    );
  };
  for (let k = 0; k < p.width * p.height; k++) {
    const r = channel(k, 0),
      g = p.channels <= 2 ? r : channel(k, 1),
      b = p.channels <= 2 ? r : channel(k, 2);
    const transparent =
      !decoded.palette &&
      decoded.transparency?.length &&
      (p.channels === 1
        ? r === decoded.transparency[0]
        : p.channels === 3 && [r, g, b].every((v, i) => v === decoded.transparency![i]));
    const alpha =
      p.channels === 2 || p.channels === 4 ? channel(k, p.channels - 1) : transparent ? 0 : maximum;
    const convert = (v: number) => Math.round((v * 255) / maximum);
    result.set([convert(r), convert(g), convert(b), convert(alpha)], k * 4);
  }
  return { width: p.width, height: p.height, rgba: result };
}
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
type Session = {
  version: 1;
  name: string;
  source: SourceId;
  index: number;
  active: string;
  frames: { duration: number; layers: SavedLayer[] }[];
  templates: SavedAsset[];
  faces: SavedAsset[];
  reference: (Omit<Reference, 'rgba'> & { rgba: number[] }) | null;
};
export function serializeSession(store: AnimationStore): string {
  const asset = (a: PixelAsset): SavedAsset => ({ ...a, pixels: [...a.pixels] });
  const data: Session = {
    version: 1,
    ...store.state,
    frames: store.state.frames.map((f) => ({
      duration: f.duration,
      layers: f.layers.map((l) => ({ ...l, pixels: [...l.pixels] })),
    })),
    templates: store.templates.map(asset),
    faces: store.faces.map(asset),
    reference: store.reference ? { ...store.reference, rgba: [...store.reference.rgba] } : null,
  };
  return JSON.stringify(data);
}
export function restoreSession(store: AnimationStore, json: string) {
  const s = JSON.parse(json) as Session;
  if (
    s.version !== 1 ||
    !Array.isArray(s.frames) ||
    !s.frames.length ||
    s.frames.length > 1000 ||
    typeof s.name !== 'string' ||
    !['empty', 'fino-standing-neutral-128', 'dev-reference-128'].includes(s.source)
  )
    throw Error('Ungültige Builder-Sitzung.');
  const pixels = (items: [number, number][]) => {
    if (
      !Array.isArray(items) ||
      items.length > 16384 ||
      items.some(
        ([k, v]) =>
          !Number.isInteger(k) || k < 0 || k >= 16384 || !Number.isInteger(v) || v < 0 || v > 0xffffffff
      )
    )
      throw Error('Ungültige Rasterdaten.');
    return new Map(items);
  };
  const frames = s.frames.map((f) => {
    if (!Number.isInteger(f.duration) || f.duration < 1 || !Array.isArray(f.layers))
      throw Error('Ungültiger Frame.');
    return { ...f, layers: f.layers.map((l) => ({ ...l, pixels: pixels(l.pixels) })) };
  });
  const assets = (items: SavedAsset[]) => items.map((a) => ({ ...a, pixels: pixels(a.pixels) }));
  const templates = assets(s.templates),
    faces = assets(s.faces);
  const ref = s.reference;
  if (
    ref &&
    (!Number.isInteger(ref.width) ||
      !Number.isInteger(ref.height) ||
      ref.width < 1 ||
      ref.height < 1 ||
      ref.rgba.length !== ref.width * ref.height * 4 ||
      ref.rgba.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
  )
    throw Error('Ungültige Referenz.');
  store.pause(false);
  store.past = [];
  store.future = [];
  store.selection = null;
  store.state = {
    name: s.name,
    source: s.source,
    index: Math.max(0, Math.min(frames.length - 1, s.index)),
    active: s.active,
    frames,
    reference: ref ? { ...ref, rgba: new Uint8Array(ref.rgba) } : null,
  };
  store.templates = templates;
  store.faces = faces;
  store.dirty = false;
  store.emit();
}

// Separate local session storage: never touches the 3D project's storage key.
const DB = 'northcore-animation-builder';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Dateispeicher nicht verfügbar'));
  });
}
export async function saveLocalSession(name: string, json: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(json, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Speichern fehlgeschlagen'));
    });
  } finally {
    db.close();
  }
}
export async function localSessions(): Promise<Map<string, string>> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('sessions').objectStore('sessions').openCursor();
      const values = new Map<string, string>();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          values.set(cursor.key as string, cursor.value as string);
          cursor.continue();
        } else resolve(values);
      };
      request.onerror = () => reject(request.error ?? new Error('Dateispeicher nicht verfügbar'));
    });
  } finally {
    db.close();
  }
}
