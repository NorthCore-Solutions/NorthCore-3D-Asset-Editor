import { decodePng } from './files';
import { bytes, rgba } from './raster';
import type { Point, Rect } from './raster';
import presets from './data/legacy-presets.json';

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
const cache = new Map<string, Promise<LegacyImage>>();
export const loadLegacyAsset: AssetLoader = (path) => {
  if (path.includes('..') || !/^[\w/.-]+\.png$/.test(path)) throw Error('Ungültiger Asset-Pfad.');
  let result = cache.get(path);
  if (!result) {
    result = fetch(`${import.meta.env.BASE_URL}animation/legacy/${path}`).then(async (response) => {
      if (!response.ok) throw Error(`Asset fehlt: ${path}`);
      return legacyDecode(new Uint8Array(await response.arrayBuffer()));
    });
    cache.set(path, result);
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    void result.catch(() => cache.delete(path));
  }
  return result;
};
export function legacyDecode(data: Uint8Array) {
  const p = decodePng(data),
    result = new LegacyImage(p.width, p.height);
  for (let i = 0; i < result.pixels.length; i++)
    result.pixels[i] = rgba(p.rgba[i * 4]!, p.rgba[i * 4 + 1]!, p.rgba[i * 4 + 2]!, p.rgba[i * 4 + 3]!);
  return result;
}
export async function loadRig(version: number): Promise<Rig> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}animation/legacy/${version === 2 ? 'addons_rig_v2' : 'addons_rig'}/rig.json`
  );
  if (!response.ok) throw Error('Face-Rig fehlt.');
  return (await response.json()) as Rig;
}
export function facePlacement(element: FaceElement, asset: RigElement): Point {
  return {
    x: element.x - Math.trunc((asset.anchorX * element.width) / asset.width),
    y: element.y - Math.trunc((asset.anchorY * element.height) / asset.height),
  };
}
export type FaceResizeAnchor = { fixed: Point; signX: number; signY: number };
export function resizeFace(
  element: FaceElement,
  asset: RigElement,
  at: Point,
  anchor: FaceResizeAnchor
): FaceElement {
  const dw = (at.x - anchor.fixed.x) * anchor.signX,
    dh = (at.y - anchor.fixed.y) * anchor.signY;
  const projected = (dw * asset.width + dh * asset.height) / (asset.width ** 2 + asset.height ** 2);
  const scale = Math.max(
    Math.max(4 / asset.width, 4 / asset.height),
    Math.min(Math.min(1024 / asset.width, 1024 / asset.height), projected)
  );
  const width = dartRound(asset.width * scale),
    height = dartRound(asset.height * scale);
  const left = anchor.fixed.x - (anchor.signX < 0 ? width : 0),
    top = anchor.fixed.y - (anchor.signY < 0 ? height : 0);
  return {
    ...element,
    width,
    height,
    x: left + Math.trunc((asset.anchorX * width) / asset.width),
    y: top + Math.trunc((asset.anchorY * height) / asset.height),
  };
}
export function rigElement(rig: Rig, part: FacePart, state: string) {
  return rig.elements[`${partKey(part)}/${state}`];
}
export type LegacyPreview =
  | { layer: string; pixels: ReadonlyMap<number, Pixel> }
  | { part: FacePart; element: FaceElement };
export class LegacyScene {
  constructor(
    readonly base: LegacyImage,
    readonly frame: LegacyFrame,
    readonly rig: Rig,
    readonly sprites: Map<FacePart, LegacyImage>
  ) {}
  private pixelLayers = new Map<LegacyLayer, Map<number, number>>();
  faceSample(part: FacePart, x: number, y: number, override?: FaceElement) {
    const el = override ?? this.frame.face?.[part],
      sprite = this.sprites.get(part),
      asset = el && rigElement(this.rig, part, el.state);
    if (!el || !sprite || !asset || el.visible === false) return 0;
    const p = facePlacement(el, asset),
      dx = x - p.x,
      dy = y - p.y;
    if (dx < 0 || dy < 0 || dx >= el.width || dy >= el.height) return 0;
    return sprite.get(
      Math.floor((dx * sprite.width) / el.width),
      Math.floor((dy * sprite.height) / el.height)
    );
  }
  sample(x: number, y: number, override?: LegacyPreview) {
    let out = 0;
    const layers: LegacyLayer[] = this.frame.layers?.length
      ? this.frame.layers
      : [{ id: 'base', name: '', kind: 'base' }, ...PARTS.map((kind) => ({ id: kind, name: '', kind }))];
    for (const layer of layers) {
      if (layer.visible === false) continue;
      if (layer.kind === 'base') out = alphaOver(this.base.get(x, y), out);
      else if (layer.kind === 'pixels') {
        let pixels = this.pixelLayers.get(layer);
        if (!pixels) {
          pixels = new Map(layer.pixels?.map((p) => [p.y * 1024 + p.x, p.rgba]));
          this.pixelLayers.set(layer, pixels);
        }
        const v =
          override && 'layer' in override && override.layer === layer.id
            ? override.pixels.get(y * 1024 + x)?.rgba
            : pixels.get(y * 1024 + x);
        if (v !== undefined && v & 255) out = v;
      } else
        out = alphaOver(
          this.faceSample(
            layer.kind,
            x,
            y,
            override && 'part' in override && override.part === layer.kind ? override.element : undefined
          ),
          out
        );
    }
    return out;
  }
}
export function presetFace(
  pose: string,
  version: number,
  rig: Rig,
  existing?: LegacyFrame['face']
): LegacyFrame['face'] {
  const table = (version === 2 ? presets.v2 : presets.v1) as Record<
    string,
    Partial<Record<FacePart, FaceElement>>
  >;
  const source = table[pose];
  if (!source) return {};
  const face = structuredClone(source);
  for (const part of PARTS) {
    const el = face[part],
      previous = existing?.[part];
    if (!el || !previous) continue;
    const a = rigElement(rig, part, el.state),
      b = rigElement(rig, part, previous.state);
    if (a && b) {
      el.width = Math.max(1, dartRound((b.width * el.width) / a.width));
      el.height = Math.max(1, dartRound((b.height * source[part]!.width) / a.width));
    }
    el.state = previous.state;
    el.visible = previous.visible ?? true;
  }
  if (!face.rightEye && face.leftEye) {
    const left = rigElement(rig, 'leftEye', 'open'),
      right = rigElement(rig, 'rightEye', 'open');
    if (left && right) {
      const width = dartRound((face.leftEye.width * right.width) / left.width);
      face.rightEye = {
        state: 'open',
        x: Math.min(1023, face.leftEye.x + dartRound(face.leftEye.width * 2.5)),
        y: face.leftEye.y,
        width,
        height: dartRound((width * right.height) / right.width),
        visible: false,
      };
    }
  }
  return face;
}
export async function renderLegacy(
  definition: Definition,
  index: number,
  loader: AssetLoader,
  rig: Rig,
  addonRoot = 'addons_normalized',
  warn: (text: string) => void = () => {},
  onScene?: (scene: LegacyScene) => void
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
  const sprites = new Map<FacePart, LegacyImage>();
  const face = async (out: LegacyImage, part: FacePart) => {
    const el = frame.face?.[part];
    if (!el || el.visible === false) return;
    const asset = rigElement(rig, part, el.state);
    if (!asset) {
      warn(`Face-Element ${part}/${el.state} fehlt.`);
      return;
    }
    const sprite = await loader(`${rig.rigRoot ?? 'addons_rig'}/${asset.file}`);
    sprites.set(part, sprite);
    const p = facePlacement(el, asset);
    out.composite(sprite, p.x, p.y, el.width, el.height);
  };
  if (!frame.layers?.length) {
    const result = base.clone();
    for (const p of PARTS) await face(result, p);
    onScene?.(new LegacyScene(base, frame, rig, sprites));
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
  onScene?.(new LegacyScene(base, frame, rig, sprites));
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
