import catalog from './data/faces/catalog.json';
import { NATIVE_POSES, nativePosePixels } from './nativePoses';
import type { NativePoseId } from './nativePoses';
import type { Frame, Layer, Pixels } from './raster';

export const FACE_SLOTS = ['leftEye', 'rightEye', 'mouth'] as const;
export type FaceSlot = typeof FACE_SLOTS[number];
export const EYE_VARIANTS = ['open', 'half', 'closed', 'happy', 'surprised'] as const;
export const MOUTH_VARIANTS = ['neutral', 'smile', 'open', 'chew', 'sad'] as const;
export type FaceVariant = typeof EYE_VARIANTS[number] | typeof MOUTH_VARIANTS[number];
export type NativeFaceSlot = Readonly<{ variant: FaceVariant; visible: boolean; x: number; y: number; width: number; height: number }>;
export type NativeFace = Readonly<{
  catalogVersion: number; presetVersion: number; poseId: NativePoseId;
  family: 'native' | 'legacy-v1' | 'legacy-v2';
  slots: Readonly<Record<FaceSlot, NativeFaceSlot>>;
  origin?: Readonly<{ rigVersion: 1 | 2; baseKind: 'original-pose' | 'face-free'; placement: 'native-preset' }>;
}>;
type Asset = { assetVersion: number; width: number; height: number; contentWidth: number; contentHeight: number; pixels: number[][] };
const assets = import.meta.glob<Asset>('./data/faces/*.json', { eager: true, import: 'default' });
export const NATIVE_FACE_CATALOG = catalog;
const offsets: Record<NativePoseId, readonly [number, number]> = {
  standing_neutral: [0, 0], standing_active: [0, 0], sitting_relaxed: [2, 20],
  sleeping: [22, 70], reading: [0, 15], eating: [0, 0],
};
function asset(name: string): Asset {
  const value = assets[`./data/faces/${name}.json`];
  if (!value?.pixels) throw Error('Unbekanntes natives Face-Asset.');
  return value;
}
export function faceFreePixels(pose: NativePoseId): Pixels {
  return new Map(asset(`${pose}-face-free`).pixels.map(([k, v]) => [k!, v!]));
}
export function faceAssetName(face: NativeFace, slot: FaceSlot) {
  return `${slot === 'mouth' ? face.family === 'legacy-v1' ? 'mouth-v1' : 'mouth' : 'eye'}-${face.slots[slot].variant}`;
}
/** Native anchors follow native head geometry, never scaled Legacy calibration. */
export function defaultNativeFace(poseId: NativePoseId, family: NativeFace['family'] = 'native'): NativeFace {
  const [dx, dy] = offsets[poseId];
  const eye = poseId === 'sleeping' ? 'closed' : 'open';
  return parseNativeFace({ catalogVersion: catalog.catalogVersion, presetVersion: catalog.presetVersion, poseId, family, slots: {
    leftEye: { variant: eye, visible: true, x: 69 + dx, y: 12 + dy, width: 4, height: 4 },
    rightEye: { variant: eye, visible: true, x: 80 + dx, y: 11 + dy, width: 4, height: 4 },
    mouth: { variant: 'neutral', visible: true, x: (family === 'legacy-v1' ? 73 : 74) + dx,
      y: (family === 'legacy-v1' ? 19 : 20) + dy, width: family === 'legacy-v1' ? 10 : 8, height: family === 'legacy-v1' ? 6 : 4 },
  } });
}
/** Historical metadata is accepted without regenerating the already saved pixelmaps. */
export function parseNativeFace(value: unknown): NativeFace {
  const fail = (): never => { throw Error('Ungültige native Gesichtsdaten.'); };
  const object = (v: unknown, allowed: readonly string[]) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
    const obj = v as Record<string, unknown>;
    if (Object.keys(obj).some((k) => !allowed.includes(k))) fail();
    return obj;
  };
  const f = object(value, ['catalogVersion', 'presetVersion', 'poseId', 'family', 'slots', 'origin']);
  if (![f.catalogVersion, f.presetVersion].every((n) => Number.isSafeInteger(n) && Number(n) > 0) ||
      !NATIVE_POSES.some((p) => p.id === f.poseId) || typeof f.family !== 'string' || !['native', 'legacy-v1', 'legacy-v2'].includes(f.family)) fail();
  const slots = object(f.slots, FACE_SLOTS);
  const parsed = Object.fromEntries(FACE_SLOTS.map((slot) => {
    const s = object(slots[slot], ['variant', 'visible', 'x', 'y', 'width', 'height']);
    if (!(slot === 'mouth' ? MOUTH_VARIANTS : EYE_VARIANTS).some((v) => v === s.variant) || typeof s.visible !== 'boolean' ||
      ![s.x, s.y, s.width, s.height].every((n) => Number.isSafeInteger(n)) ||
      Number(s.x) < -128 || Number(s.x) > 127 || Number(s.y) < -128 || Number(s.y) > 127 ||
      Number(s.width) < 1 || Number(s.width) > 128 || Number(s.height) < 1 || Number(s.height) > 128) fail();
    return [slot, Object.freeze({ ...s })];
  })) as Record<FaceSlot, NativeFaceSlot>;
  let origin: NativeFace['origin'];
  if ('origin' in f) {
    const o = object(f.origin, ['rigVersion', 'baseKind', 'placement']);
    if ((o.rigVersion !== 1 && o.rigVersion !== 2) || o.baseKind !== (o.rigVersion === 1 ? 'original-pose' : 'face-free') ||
      o.placement !== 'native-preset' || f.family !== `legacy-v${o.rigVersion}`) fail();
    origin = Object.freeze({ ...o }) as NativeFace['origin'];
  }
  return Object.freeze({ ...f, slots: Object.freeze(parsed), ...(origin ? { origin } : {}) }) as NativeFace;
}
function requireCurrent(face: NativeFace) {
  if (face.catalogVersion !== catalog.catalogVersion || face.presetVersion !== catalog.presetVersion)
    throw Error('Historischer Gesichtskatalog: Pixel bleiben erhalten; Bearbeitung benötigt diesen Katalog.');
}
export function changeNativeSlot(face: NativeFace, slot: FaceSlot, patch: Partial<NativeFaceSlot>): NativeFace {
  requireCurrent(face);
  return parseNativeFace({ ...face, slots: { ...face.slots, [slot]: { ...face.slots[slot], ...patch } } });
}
export function dragNativeSlot(slot: NativeFaceSlot, dx: number, dy: number) {
  return { x: Math.max(-128, Math.min(127, slot.x + Math.round(dx))),
    y: Math.max(-128, Math.min(127, slot.y + Math.round(dy))) };
}
/** Integer nearest-neighbor placement with clipping; literal RGBA, no blending. */
export function slotPixels(face: NativeFace, slot: FaceSlot): Pixels {
  requireCurrent(face);
  const s = face.slots[slot], a = asset(faceAssetName(face, slot)), source = new Map(a.pixels.map(([k, v]) => [k!, v!]));
  const pixels = new Map<number, number>();
  if (!s.visible) return pixels;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const tx = s.x + x, ty = s.y + y;
    if (tx < 0 || tx > 127 || ty < 0 || ty > 127) continue;
    const rgba = source.get(Math.floor(y * a.contentHeight / s.height) * 128 + Math.floor(x * a.contentWidth / s.width));
    if (rgba !== undefined) pixels.set(ty * 128 + tx, rgba);
  }
  return pixels;
}
const slotId = (slot: FaceSlot) => `native-face-${slot}`;
export function nativeSlotForLayer(layer: Layer | undefined) { return layer?.nativeFaceSlot; }
export function isNativeFaceLayer(layer: Layer) { return nativeSlotForLayer(layer) !== undefined; }
/** Only an explicit first activation/pose change replaces the pose layer. */
export function bakeNativeFace(frame: Frame, face: NativeFace, replaceBase = false): Frame {
  requireCurrent(face);
  const retained = frame.layers.filter((l) => !isNativeFaceLayer(l));
  const base = retained.findIndex((l) => l.id === 'native-pose');
  if (base < 0) throw Error('Gesicht benötigt eine native Grundpose.');
  if (replaceBase) retained[base] = { ...retained[base]!, pixels: faceFreePixels(face.poseId), recipe: undefined };
  else if (!frame.nativeFace) {
    // Remove only unchanged catalog face pixels. Preserve user edits elsewhere
    // on the editable base, and every independent artwork/overlay layer.
    const original = nativePosePixels(face.poseId), free = faceFreePixels(face.poseId), pixels = new Map(retained[base]!.pixels);
    for (const k of new Set([...original.keys(), ...free.keys()])) {
      if (original.get(k) === free.get(k) || pixels.get(k) !== original.get(k)) continue;
      const value = free.get(k);
      if (value === undefined) pixels.delete(k); else pixels.set(k, value);
    }
    retained[base] = { ...retained[base]!, pixels, recipe: undefined };
  }
  const used = new Set(retained.map((l) => l.id));
  const slots: Layer[] = FACE_SLOTS.map((s) => {
    const previous = frame.layers.find((l) => l.nativeFaceSlot === s);
    const candidate = previous?.id ?? slotId(s);
    let id = candidate, suffix = 2;
    while (used.has(id)) id = `${candidate}-${suffix++}`;
    used.add(id);
    return { id, name: previous?.name ?? `Gesicht · ${s}`, visible: face.slots[s].visible,
      nativeFaceSlot: s, locked: true, pixels: slotPixels(face, s) };
  });
  // Immediately above the base, below user artwork/whole-face overlays.
  retained.splice(base + 1, 0, ...slots);
  return { ...frame, layers: retained, nativeFace: parseNativeFace(face) };
}
export function retargetNativeFace(face: NativeFace, poseId: NativePoseId, preserve = true): NativeFace {
  requireCurrent(face);
  const target = defaultNativeFace(poseId, face.family);
  return parseNativeFace({ ...target, ...(face.origin ? { origin: face.origin } : {}), slots: Object.fromEntries(FACE_SLOTS.map((s) =>
    [s, { ...target.slots[s], ...(preserve ? { variant: face.slots[s].variant, visible: face.slots[s].visible,
      width: face.slots[s].width, height: face.slots[s].height } : {}) }])) });
}
