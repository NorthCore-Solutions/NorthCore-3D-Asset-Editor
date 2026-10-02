import standing from './data/standing-neutral.json';

export const SIZE = 128;
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type Pixels = ReadonlyMap<number, number>;
export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  pixels: Pixels;
  faceId?: string;
};
export type Frame = { layers: readonly Layer[]; duration: number };
export type PixelAsset = { id: string; name: string; pixels: Pixels; bounds: Rect };
export type Reference = {
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  bounds: Rect;
  visible: boolean;
  aligned: boolean;
};
export const contains = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const key = (p: Point) => p.y * SIZE + p.x;
export const point = (k: number): Point => ({ x: k % SIZE, y: Math.floor(k / SIZE) });
export const rgba = (r: number, g: number, b: number, a: number) =>
  ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
export const bytes = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
export const hex = (v: number) => `#${v.toString(16).padStart(8, '0').toUpperCase()}`;
export const cssColor = (v: number) => {
  const [r, g, b, a] = bytes(v);
  return `rgba(${r},${g},${b},${a! / 255})`;
};
export function blankLayer(id: string = crypto.randomUUID(), name = 'Pixel-Layer'): Layer {
  return { id, name, visible: true, locked: false, pixels: new Map() };
}
export function polygonMask(vertices: readonly Point[]): Set<number> {
  const mask = new Set<number>();
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let inside = false;
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        let a = vertices[j]!,
          b = vertices[i]!;
        if (a.y > b.y) [a, b] = [b, a];
        const cy = 2 * y + 1;
        if (
          2 * a.y <= cy &&
          cy < 2 * b.y &&
          (2 * x + 1 - 2 * a.x) * (b.y - a.y) < (cy - 2 * a.y) * (b.x - a.x)
        )
          inside = !inside;
      }
      if (inside) mask.add(y * SIZE + x);
    }
  return mask;
}
export function nativePose(): Pixels {
  const pixels = new Map<number, number>();
  for (const area of standing.areas) {
    for (const k of polygonMask(area.points.map(([x, y]) => ({ x: x!, y: y! })))) pixels.set(k, area.color);
  }
  for (const [x, y, value] of standing.glints) pixels.set(y! * SIZE + x!, value!);
  const result = new Map<number, number>();
  for (const k of pixels.keys()) {
    const { x, y } = point(k);
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ])
      if (contains(x + dx!, y + dy!)) result.set((y + dy!) * SIZE + x + dx!, standing.outline);
  }
  for (const [k, v] of pixels) result.set(k, v);
  return result;
}
export function fixture(): Pixels {
  const p = new Map([
    [0, 0xff0000ff],
    [127, 0x00ff00ff],
    [16256, 0x0000ffff],
    [16383, 0xffffffff],
    [17 * SIZE + 13, 0xff00ffff],
    [18 * SIZE + 13, 0x12345680],
    [19 * SIZE + 13, 0xabcdef00],
  ]);
  for (let x = 24; x <= 80; x++) p.set(32 * SIZE + x, 0xffcc00ff);
  for (let y = 24; y <= 80; y++) p.set(y * SIZE + 96, 0x00ffffff);
  for (let y = 56; y < 72; y++) for (let x = 40; x < 64; x++) p.set(y * SIZE + x, 0x8844ccff);
  return p;
}
const pose = nativePose();
export const SOURCES = {
  empty: 'Leer / transparent',
  'fino-standing-neutral-128': 'Stehend – neutral',
  'dev-reference-128': 'Testfixture (128×128)',
};
export type SourceId = keyof typeof SOURCES;
export function sourceLayers(source: SourceId): Layer[] {
  if (source === 'empty') return [blankLayer('pixels-1')];
  return [
    {
      ...blankLayer('native-pose', source === 'dev-reference-128' ? 'Testfixture' : 'Grundpose – Pixel'),
      pixels: source === 'dev-reference-128' ? fixture() : pose,
      locked: source === 'dev-reference-128',
    },
    ...(source === 'dev-reference-128' ? [blankLayer('pixels-1')] : []),
  ];
}
/** Literal topmost RGBA, matching RasterDocument.sample; never alpha blended. */
export function sample(layers: readonly Layer[], k: number): number {
  let color = 0;
  for (const layer of layers) {
    if (!layer.visible) continue;
    const next = layer.pixels.get(k);
    if (next !== undefined && ((next & 255) !== 0 || (color & 255) === 0)) color = next;
  }
  return color;
}
export function render(layers: readonly Layer[]): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let k = 0; k < SIZE * SIZE; k++) data.set(bytes(sample(layers, k)), k * 4);
  return data;
}
export function production(layers: readonly Layer[]): Uint8Array {
  const source = render(layers),
    output = new Uint8Array(1024 * 1024 * 4);
  for (let y = 0; y < 1024; y++)
    for (let x = 0; x < 1024; x++) {
      const i = (Math.floor(y / 8) * SIZE + Math.floor(x / 8)) * 4;
      output.set(source.subarray(i, i + 4), (y * 1024 + x) * 4);
    }
  return output;
}
export function referenceSample(ref: Reference | null, target: Point): number | null {
  if (!ref?.visible) return null;
  const { x, y, width, height } = ref.bounds;
  const rx = target.x + 0.5 - x,
    ry = target.y + 0.5 - y;
  if (rx < 0 || ry < 0 || rx >= width || ry >= height) return null;
  const i = (Math.floor((ry * ref.height) / height) * ref.width + Math.floor((rx * ref.width) / width)) * 4;
  return ref.rgba[i + 3] ? rgba(ref.rgba[i]!, ref.rgba[i + 1]!, ref.rgba[i + 2]!, ref.rgba[i + 3]!) : null;
}
export function shiftReference(ref: Reference, delta: Point): Reference {
  const dx = ref.aligned ? Math.round(delta.x) : delta.x,
    dy = ref.aligned ? Math.round(delta.y) : delta.y;
  return { ...ref, bounds: { ...ref.bounds, x: ref.bounds.x + dx, y: ref.bounds.y + dy } };
}
export function brushBounds(p: Point, size: number): Rect {
  if (!Number.isInteger(size) || size < 1 || size > 8) throw Error('Werkzeuggröße muss 1–8 sein.');
  // Even brushes: cursor is the top-left of the central 2×2 cells.
  const leading = Math.floor((size - 1) / 2);
  return { x: p.x - leading, y: p.y - leading, width: size, height: size };
}
export function line(a: Point, b: Point): Point[] {
  const result: Point[] = [];
  let x = a.x,
    y = a.y;
  const dx = Math.abs(b.x - x),
    dy = -Math.abs(b.y - y),
    sx = x < b.x ? 1 : -1,
    sy = y < b.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    result.push({ x, y });
    if (x === b.x && y === b.y) return result;
    const e = error * 2;
    if (e >= dy) {
      error += dy;
      x += sx;
    }
    if (e <= dx) {
      error += dx;
      y += sy;
    }
  }
}
export function bounds(keys: Iterable<number>): Rect | null {
  let left = SIZE,
    top = SIZE,
    right = -1,
    bottom = -1;
  for (const k of keys) {
    const p = point(k);
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
export function rectMask(a: Point, b: Point): Set<number> {
  const result = new Set<number>();
  for (let y = Math.max(0, Math.min(a.y, b.y)); y <= Math.min(127, Math.max(a.y, b.y)); y++)
    for (let x = Math.max(0, Math.min(a.x, b.x)); x <= Math.min(127, Math.max(a.x, b.x)); x++)
      result.add(y * SIZE + x);
  return result;
}
export function capture(
  pixels: Pixels,
  selection: ReadonlySet<number> | null
): { pixels: Pixels; bounds: Rect } | null {
  const selected = new Map([...pixels].filter(([k]) => !selection || selection.has(k)));
  const rect = bounds(selected.keys());
  return rect ? { pixels: selected, bounds: rect } : null;
}
export function transform(
  pixels: Pixels,
  selection: ReadonlySet<number> | null,
  to: Rect,
  copy = false
): Pixels {
  const source = capture(pixels, selection);
  if (!source) return pixels;
  const output = new Map(pixels);
  if (!copy) for (const k of source.pixels.keys()) output.delete(k);
  for (let y = 0; y < to.height; y++)
    for (let x = 0; x < to.width; x++) {
      const sx = source.bounds.x + Math.floor((x * source.bounds.width) / to.width),
        sy = source.bounds.y + Math.floor((y * source.bounds.height) / to.height);
      const value = source.pixels.get(sy * SIZE + sx);
      if (value !== undefined && contains(x + to.x, y + to.y))
        output.set((y + to.y) * SIZE + x + to.x, value);
    }
  return output;
}
export class Viewport {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly cell: number
  ) {}
  logical(p: Point): Point {
    return { x: (p.x - this.x) / this.cell, y: (p.y - this.y) / this.cell };
  }
  pixel(p: Point): Point {
    const l = this.logical(p);
    const snap = (v: number) => (Math.abs(v - Math.round(v)) < 1e-10 ? Math.round(v) : v);
    return { x: Math.floor(snap(l.x)), y: Math.floor(snap(l.y)) };
  }
  edge(p: Point): Point {
    return { x: this.x + p.x * this.cell, y: this.y + p.y * this.cell };
  }
  pan(d: Point): Viewport {
    return new Viewport(this.x + d.x, this.y + d.y, this.cell);
  }
  zoomAt(p: Point, factor: number, minimum = 0.25): Viewport {
    const cell = Math.max(minimum, Math.min(128, this.cell * factor)),
      ratio = cell / this.cell;
    return new Viewport(p.x - (p.x - this.x) * ratio, p.y - (p.y - this.y) * ratio, cell);
  }
}
