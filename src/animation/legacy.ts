import { decodePng } from './png';
import { bytes, rgba } from './colors';
import type { Point, Rect } from './raster';

export type FacePart = 'leftEye' | 'rightEye' | 'mouth';
export type FaceElement = {
  state: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
};
export type Mask = ({ type: 'rect' } & Rect) | { type: 'polygon'; points: [number, number][] };
export type Pixel = Point & { rgba: number };
export type LegacyLayer = {
  id: string;
  name: string;
  kind: 'base' | FacePart | 'pixels';
  visible?: boolean;
  locked?: boolean;
  pixels?: Pixel[];
};
export type LegacyOp = {
  type: string;
  mask?: Mask;
  rect?: Rect;
  dx?: number;
  dy?: number;
  sx?: number;
  sy?: number;
  scope?: string;
  vacatedArea?: string | { strategy: string };
};
export type Addon = string | { state: string; dx?: number; dy?: number };
export type LegacyFrame = {
  durationMs: number;
  ops: LegacyOp[];
  face?: Partial<Record<FacePart, FaceElement>>;
  layers?: LegacyLayer[];
  eyes?: Addon | null;
  mouth?: Addon | null;
};
export type Definition = {
  version: number;
  faceRigVersion?: number;
  id: string;
  name: string;
  basePose: string;
  reactionState?: string | null;
  frames: LegacyFrame[];
};
export type RigElement = { file: string; width: number; height: number; anchorX: number; anchorY: number };
export type Rig = {
  version: number;
  rigRoot?: string;
  baseRoot?: string;
  elements: Record<string, RigElement>;
  faceBases?: Record<string, { file: string }>;
};
export const POSES = [
  'standing_neutral',
  'standing_active',
  'sitting_relaxed',
  'sleeping',
  'reading',
  'eating',
];
export const EYES = ['open', 'half', 'closed', 'happy', 'surprised'];
export const MOUTHS = ['neutral', 'smile', 'open', 'chew', 'sad'];
export const PARTS: FacePart[] = ['leftEye', 'rightEye', 'mouth'];
const partKey = (part: FacePart) =>
  part === 'leftEye' ? 'eyeLeft' : part === 'rightEye' ? 'eyeRight' : 'mouth';
export const dartRound = (v: number) => (v < 0 ? -Math.round(-v) : Math.round(v));
function alphaOver(s: number, d: number) {
  const alpha = s & 255;
  if (!alpha) return d;
  if (alpha === 255) return s;
  const a = alpha / 255,
    da = (d & 255) / 255,
    out = a + da * (1 - a);
  const channel = (shift: number) =>
    Math.round((((s >>> shift) & 255) * a + ((d >>> shift) & 255) * da * (1 - a)) / out);
  return rgba(channel(24), channel(16), channel(8), Math.round(out * 255));
}
export function maskBounds(mask: Mask): Rect {
  if (mask.type === 'rect') return mask;
  const xs = mask.points.map((p) => p[0]),
    ys = mask.points.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x + 1, height: Math.max(...ys) - y + 1 };
}
export function masked(mask: Mask, x: number, y: number): boolean {
  if (mask.type === 'rect') {
    const b = mask;
    return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height;
  }
  let inside = false;
  for (let i = 0, j = mask.points.length - 1; i < mask.points.length; j = i++) {
    const a = mask.points[i]!,
      b = mask.points[j]!;
    if (
      a[1] > y + 0.5 !== b[1] > y + 0.5 &&
      x + 0.5 < ((b[0] - a[0]) * (y + 0.5 - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export class LegacyImage {
  readonly pixels: Uint32Array;
  constructor(
    readonly width: number,
    readonly height: number,
    pixels?: Uint32Array
  ) {
    this.pixels = pixels ?? new Uint32Array(width * height);
  }
  clone() {
    return new LegacyImage(this.width, this.height, this.pixels.slice());
  }
  get(x: number, y: number) {
    return this.pixels[y * this.width + x] ?? 0;
  }
  set(x: number, y: number, v: number) {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.pixels[y * this.width + x] = v;
  }
  toBytes() {
    const data = new Uint8Array(this.pixels.length * 4);
    this.pixels.forEach((v, i) => data.set(bytes(v), i * 4));
    return data;
  }
  composite(source: LegacyImage, left = 0, top = 0, w = source.width, h = source.height) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const tx = x + left,
          ty = y + top;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const s = source.get(Math.floor((x * source.width) / w), Math.floor((y * source.height) / h)),
          sa = s & 255;
        if (!sa) continue;
        if (sa === 255) {
          this.set(tx, ty, s);
          continue;
        }
        this.set(tx, ty, alphaOver(s, this.get(tx, ty)));
      }
  }
  move(mask: Mask, dx: number, dy: number, strategy: string) {
    if ((!dx && !dy) || !['transparent', 'restoreOriginal', 'extendSelectionEdge'].includes(strategy)) return;
    const original = this.clone(),
      b = maskBounds(mask),
      yes = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < this.width && y < this.height && masked(mask, x, y);
    const selected: Point[] = [];
    for (let y = Math.max(0, b.y); y < Math.min(this.height, b.y + b.height); y++)
      for (let x = Math.max(0, b.x); x < Math.min(this.width, b.x + b.width); x++)
        if (yes(x, y)) selected.push({ x, y });
    if (strategy !== 'restoreOriginal') selected.forEach((p) => this.set(p.x, p.y, 0));
    selected.forEach((p) => this.set(p.x + dx, p.y + dy, original.get(p.x, p.y)));
    if (strategy === 'extendSelectionEdge')
      for (const p of selected) {
        if (yes(p.x - dx, p.y - dy)) continue;
        const length = Math.max(Math.abs(dx), Math.abs(dy));
        let source = p;
        for (let k = 1; ; k++) {
          const x = p.x - dartRound((k * dx) / length),
            y = p.y - dartRound((k * dy) / length);
          if (!yes(x, y)) break;
          source = { x, y };
        }
        this.set(p.x, p.y, original.get(source.x, source.y));
      }
  }
  stretch(b: Rect, sx: number, sy: number, local: boolean) {
    const pass = (vertical: boolean, n: number, rect: Rect) => {
      if (!n) return;
      const length = vertical ? rect.height : rect.width;
      if (Math.abs(n) >= length) throw Error('Streckung muss kleiner als die Auswahl sein.');
      const src = this.clone(),
        start = vertical ? rect.y : rect.x,
        other = vertical ? rect.x : rect.y,
        otherLength = vertical ? rect.width : rect.height;
      const total = vertical ? this.height : this.width,
        next = length + n,
        end = local ? Math.min(total, start + Math.max(length, next)) : total;
      for (
        let cross = Math.max(0, other);
        cross < Math.min(vertical ? this.width : this.height, other + otherLength);
        cross++
      )
        for (let k = Math.max(0, start); k < end; k++) {
          let source: number;
          if (k < start + next) source = start + Math.floor(((k - start) * length) / next);
          else if (local) source = start + length - 1;
          else if (n > 0 || k < start + length) source = k - n;
          else continue;
          this.set(
            vertical ? cross : k,
            vertical ? k : cross,
            src.get(vertical ? cross : source, vertical ? source : cross)
          );
        }
    };
    pass(false, sx, b);
    pass(true, sy, local ? { ...b, width: b.width + Math.max(0, sx) } : b);
  }
}
export type AssetLoader = (path: string) => Promise<LegacyImage>;
export function legacyDecode(data: Uint8Array) {
  const p = decodePng(data),
    result = new LegacyImage(p.width, p.height);
  for (let i = 0; i < result.pixels.length; i++)
    result.pixels[i] = rgba(p.rgba[i * 4]!, p.rgba[i * 4 + 1]!, p.rgba[i * 4 + 2]!, p.rgba[i * 4 + 3]!);
  return result;
}
export function facePlacement(element: FaceElement, asset: RigElement): Point {
  return {
    x: element.x - Math.trunc((asset.anchorX * element.width) / asset.width),
    y: element.y - Math.trunc((asset.anchorY * element.height) / asset.height),
  };
}
export function rigElement(rig: Rig, part: FacePart, state: string) {
  return rig.elements[`${partKey(part)}/${state}`];
}
export async function renderLegacy(
  definition: Definition,
  index: number,
  loader: AssetLoader,
  rig: Rig,
  addonRoot = 'addons_normalized',
  warn: (text: string) => void = () => {}
) {
  const frame = definition.frames[index];
  if (!frame) throw Error('Frame fehlt.');
  const path =
    definition.faceRigVersion === 2
      ? `${rig.baseRoot}/${rig.faceBases?.[definition.basePose]?.file ?? ''}`
      : `basis/${definition.basePose}`;
  const base = (await loader(path)).clone();
  for (const op of frame.ops) {
    if (op.type === 'moveRegion' && op.rect)
      base.move({ type: 'rect', ...op.rect }, op.dx ?? 0, op.dy ?? 0, 'transparent');
    else if (op.type === 'moveSelection' && op.mask) {
      const strategy =
        typeof op.vacatedArea === 'string' ? op.vacatedArea : (op.vacatedArea?.strategy ?? 'transparent');
      if (['transparent', 'restoreOriginal', 'extendSelectionEdge'].includes(strategy))
        base.move(op.mask, op.dx ?? 0, op.dy ?? 0, strategy);
      else warn(`Unbekannte Strategie ${strategy} übersprungen.`);
    } else if (op.type === 'stretchSelection' && op.mask) {
      const scope = op.scope ?? 'bounds';
      if (['bounds', 'boundsLocal'].includes(scope))
        base.stretch(maskBounds(op.mask), op.sx ?? 0, op.sy ?? 0, scope === 'boundsLocal');
      else warn(`Unbekannter Stretch-Bereich ${scope} übersprungen.`);
    } else warn(`Unbekannte Operation ${op.type} übersprungen.`);
  }
  for (const part of ['eyes', 'mouth'] as const) {
    const raw = frame[part];
    if (!raw) continue;
    const ref = typeof raw === 'string' ? { state: raw, dx: 0, dy: 0 } : raw;
    base.composite(
      await loader(`${addonRoot}/${part === 'eyes' ? 'eyes' : 'mouths'}/fino_${part}_${ref.state}.png`),
      ref.dx ?? 0,
      ref.dy ?? 0
    );
  }
  const face = async (out: LegacyImage, part: FacePart) => {
    const el = frame.face?.[part];
    if (!el || el.visible === false) return;
    const asset = rigElement(rig, part, el.state);
    if (!asset) {
      warn(`Face-Element ${part}/${el.state} fehlt.`);
      return;
    }
    const sprite = await loader(`${rig.rigRoot ?? 'addons_rig'}/${asset.file}`);
    const p = facePlacement(el, asset);
    out.composite(sprite, p.x, p.y, el.width, el.height);
  };
  if (!frame.layers?.length) {
    const result = base.clone();
    for (const p of PARTS) await face(result, p);
    return result;
  }
  const result = new LegacyImage(base.width, base.height);
  for (const layer of frame.layers) {
    if (layer.visible === false) continue;
    if (layer.kind === 'base') result.composite(base);
    else if (layer.kind === 'pixels') {
      for (const p of layer.pixels ?? []) if (p.rgba & 255) result.set(p.x, p.y, p.rgba);
    } else await face(result, layer.kind);
  }
  return result;
}
export function parseDefinition(json: string): Definition {
  const d = JSON.parse(json) as Definition;
  if (
    !d ||
    typeof d.id !== 'string' ||
    typeof d.name !== 'string' ||
    !POSES.some((p) => d.basePose === `fino_${p}.png`) ||
    !Array.isArray(d.frames) ||
    !d.frames.length ||
    d.frames.length > 1000
  )
    throw Error('Ungültige Fino-Animation.');
  for (const frame of d.frames) {
    if (!Number.isInteger(frame.durationMs) || frame.durationMs < 1 || !Array.isArray(frame.ops))
      throw Error('Ungültiger Frame.');
    for (const p of PARTS) {
      const el = frame.face?.[p];
      if (
        el &&
        (![el.x, el.y, el.width, el.height].every(Number.isInteger) ||
          el.width < 1 ||
          el.height < 1 ||
          el.width > 1024 ||
          el.height > 1024)
      )
        throw Error('Ungültiges Face-Element.');
    }
    for (const l of frame.layers ?? [])
      for (const p of l.pixels ?? [])
        if (
          ![p.x, p.y, p.rgba].every(Number.isInteger) ||
          p.x < 0 ||
          p.y < 0 ||
          p.x >= 1024 ||
          p.y >= 1024 ||
          p.rgba < 0 ||
          p.rgba > 0xffffffff
        )
          throw Error('Ungültiger Layer-Pixel.');
  }
  return d;
}
