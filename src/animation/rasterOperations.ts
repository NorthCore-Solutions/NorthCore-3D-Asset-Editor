import { bounds, contains, point, polygonMask, rectMask } from './raster';
import type { Pixels, Rect } from './raster';

export type RasterMask = ({ readonly type: 'rect' } & Readonly<Rect>) |
  { readonly type: 'polygon'; readonly points: readonly (readonly [number, number])[] } |
  { readonly type: 'cells'; readonly keys: readonly number[] };
export const RASTER_FILLS = ['transparent', 'restoreOriginal', 'extendSelectionEdge'] as const;
export const RASTER_STRETCH_SCOPES = ['mask', 'boundsLocal', 'bounds'] as const;
export type RasterFill = typeof RASTER_FILLS[number];
export type RasterStretchScope = typeof RASTER_STRETCH_SCOPES[number];
type Header = { readonly id: string; readonly version: 1 };
export type RasterOperation = Header & (
  { readonly type: 'moveRegion'; readonly rect: Readonly<Rect>; readonly dx: number; readonly dy: number } |
  { readonly type: 'moveSelection'; readonly mask: RasterMask; readonly dx: number; readonly dy: number; readonly fill: RasterFill } |
  { readonly type: 'stretchSelection'; readonly mask: RasterMask; readonly sx: number; readonly sy: number; readonly scope: RasterStretchScope });
export type RasterRecipe = Readonly<{ version: 1;
  base: Readonly<{ id: string; pixels: readonly (readonly [number, number])[] }>;
  operations: readonly RasterOperation[] }>;
function invalid(): never { throw Error('Ungültige native Raster-Operation oder Replay-Basis.'); }
function object(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some((k) => !fields.includes(k))) invalid();
  return obj;
}
function integer(value: unknown, min = -128, max = 128): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid();
  return Number(value);
}
function id(value: unknown): string { if (typeof value !== 'string' || !value.trim()) invalid(); return value; }
export function parseRasterMask(value: unknown): RasterMask {
  const m = object(value, ['type', 'x', 'y', 'width', 'height', 'points', 'keys']);
  if (m.type === 'rect') {
    object(m, ['type', 'x', 'y', 'width', 'height']);
    return Object.freeze({ type: 'rect', x: integer(m.x), y: integer(m.y), width: integer(m.width, 1, 128), height: integer(m.height, 1, 128) });
  }
  if (m.type === 'polygon') {
    object(m, ['type', 'points']);
    if (!Array.isArray(m.points) || m.points.length < 3 || m.points.length > 512) invalid();
    const points = m.points.map((p: unknown) => {
      if (!Array.isArray(p) || p.length !== 2) invalid();
      return Object.freeze([integer(p[0]), integer(p[1])] as const);
    });
    return Object.freeze({ type: 'polygon', points: Object.freeze(points) });
  }
  if (m.type === 'cells') {
    object(m, ['type', 'keys']);
    if (!Array.isArray(m.keys) || !m.keys.length || m.keys.length > 16384) invalid();
    const keys = m.keys.map((k: unknown) => integer(k, 0, 16383));
    if (new Set(keys).size !== keys.length) invalid();
    return Object.freeze({ type: 'cells', keys: Object.freeze(keys.sort((a, b) => a - b)) });
  }
  return invalid();
}
export function rasterMaskKeys(mask: RasterMask): ReadonlySet<number> {
  if (mask.type === 'cells') return new Set(mask.keys);
  if (mask.type === 'rect') return rectMask(mask, { x: mask.x + mask.width - 1, y: mask.y + mask.height - 1 });
  return polygonMask(mask.points.map(([x, y]) => ({ x, y })));
}
export function rasterMaskBounds(mask: RasterMask): Rect {
  if (mask.type === 'rect') return { x: mask.x, y: mask.y, width: mask.width, height: mask.height };
  if (mask.type === 'cells') { const rect = bounds(mask.keys); if (!rect) invalid(); return rect; }
  const xs = mask.points.map(([x]) => x), ys = mask.points.map(([, y]) => y), x = Math.min(...xs), y = Math.min(...ys);
  // Explicit inclusive vertex bounds, matching the documented bounds family.
  return { x, y, width: Math.max(...xs) - x + 1, height: Math.max(...ys) - y + 1 };
}
export function parseRasterOperation(value: unknown): RasterOperation {
  const o = object(value, ['id', 'version', 'type', 'rect', 'mask', 'dx', 'dy', 'sx', 'sy', 'fill', 'scope']);
  if (o.version !== 1) throw Error('Unbekannte native Operationsversion.');
  const header: Header = { id: id(o.id), version: 1 };
  if (o.type === 'moveRegion') {
    object(o, ['id', 'version', 'type', 'rect', 'dx', 'dy']);
    const r = object(o.rect, ['x', 'y', 'width', 'height']);
    const mask = parseRasterMask({ type: 'rect', ...r });
    if (mask.type !== 'rect') invalid();
    const { x, y, width, height } = mask;
    return Object.freeze({ ...header, type: 'moveRegion', rect: Object.freeze({ x, y, width, height }), dx: integer(o.dx), dy: integer(o.dy) });
  }
  if (o.type === 'moveSelection') {
    object(o, ['id', 'version', 'type', 'mask', 'dx', 'dy', 'fill']);
    if (!RASTER_FILLS.some((f) => f === o.fill)) invalid();
    return Object.freeze({ ...header, type: 'moveSelection', mask: parseRasterMask(o.mask), dx: integer(o.dx), dy: integer(o.dy), fill: o.fill as RasterFill });
  }
  if (o.type === 'stretchSelection') {
    object(o, ['id', 'version', 'type', 'mask', 'sx', 'sy', 'scope']);
    if (!RASTER_STRETCH_SCOPES.some((s) => s === o.scope)) invalid();
    const mask = parseRasterMask(o.mask), rect = rasterMaskBounds(mask), sx = integer(o.sx), sy = integer(o.sy);
    if (o.scope === 'mask' ? rect.width + sx < 1 || rect.height + sy < 1 : Math.abs(sx) >= rect.width || Math.abs(sy) >= rect.height)
      throw Error('Ungültige Streckung für die Masken-Bounds.');
    return Object.freeze({ ...header, type: 'stretchSelection', mask, sx, sy, scope: o.scope as RasterStretchScope });
  }
  return invalid();
}
export function newRasterOperation(parameters: unknown, operationId: string = crypto.randomUUID()) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) invalid();
  return parseRasterOperation({ ...parameters, id: operationId, version: 1 });
}
export function sameRasterPixels(a: Pixels, b: Pixels) {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}
function copyCell(output: Map<number, number>, target: number, source: Pixels, sourceKey: number) {
  const value = source.get(sourceKey);
  if (value === undefined) output.delete(target); else output.set(target, value);
}
const nearestInteger = (value: number, denominator: number) =>
  Math.sign(value) * Math.floor((Math.abs(value) * 2 + denominator) / (denominator * 2));
/** Literal map copying. Transparent cells move too; no compositing or palette. */
export function applyRasterOperation(pixels: Pixels, value: RasterOperation): Pixels {
  for (const [k, rgba] of pixels) {
    integer(k, 0, 16383); integer(rgba, 0, 0xffffffff);
  }
  const op = parseRasterOperation(value), output = new Map(pixels);
  if (op.type !== 'stretchSelection') {
    if (!op.dx && !op.dy) return output;
    const selected = rasterMaskKeys(op.type === 'moveRegion' ? { type: 'rect', ...op.rect } : op.mask);
    const fill = op.type === 'moveRegion' ? 'transparent' : op.fill;
    if (fill !== 'restoreOriginal') for (const k of selected) output.delete(k);
    for (const k of selected) {
      const p = point(k), x = p.x + op.dx, y = p.y + op.dy;
      if (contains(x, y)) copyCell(output, y * 128 + x, pixels, k);
    }
    if (fill === 'extendSelectionEdge') {
      const length = Math.max(Math.abs(op.dx), Math.abs(op.dy));
      for (const k of selected) {
        const p = point(k), px = p.x - op.dx, py = p.y - op.dy;
        if (contains(px, py) && selected.has(py * 128 + px)) continue;
        let source = k;
        for (let step = 1; step <= 256; step++) {
          const x = p.x - nearestInteger(step * op.dx, length), y = p.y - nearestInteger(step * op.dy, length);
          if (!contains(x, y) || !selected.has(y * 128 + x)) break;
          source = y * 128 + x;
        }
        copyCell(output, k, pixels, source);
      }
    }
    return output;
  }
  const rect = rasterMaskBounds(op.mask);
  if (op.scope === 'mask') {
    const selected = rasterMaskKeys(op.mask), width = rect.width + op.sx, height = rect.height + op.sy;
    for (const k of selected) output.delete(k);
    for (let y = Math.max(0, rect.y); y < Math.min(128, rect.y + height); y++)
      for (let x = Math.max(0, rect.x); x < Math.min(128, rect.x + width); x++) {
        const sx = rect.x + Math.floor((x - rect.x) * rect.width / width), sy = rect.y + Math.floor((y - rect.y) * rect.height / height);
        if (contains(sx, sy) && selected.has(sy * 128 + sx)) copyCell(output, y * 128 + x, pixels, sy * 128 + sx);
      }
    return output;
  }
  // Native 128-grid stripe sweeps: x then y. Local shrink extends the edge;
  // bounds carries the post-selection stripe on expansion and retains the far
  // tail on contraction. Only this explicitly selected stripe can change.
  const pass = (vertical: boolean, delta: number, b: Rect) => {
    if (!delta) return;
    const source = new Map(output), start = vertical ? b.y : b.x, size = vertical ? b.height : b.width,
      crossStart = vertical ? b.x : b.y, crossSize = vertical ? b.width : b.height, next = size + delta;
    const end = op.scope === 'boundsLocal' ? Math.min(128, start + Math.max(size, next)) : 128;
    for (let cross = Math.max(0, crossStart); cross < Math.min(128, crossStart + crossSize); cross++)
      for (let k = Math.max(0, start); k < end; k++) {
        let at: number;
        if (k < start + next) at = start + Math.floor((k - start) * size / next);
        else if (op.scope === 'boundsLocal') at = start + size - 1;
        else if (delta > 0 || k < start + size) at = k - delta;
        else continue;
        const target = vertical ? k * 128 + cross : cross * 128 + k;
        if (at < 0 || at >= 128) output.delete(target);
        else copyCell(output, target, source, vertical ? at * 128 + cross : cross * 128 + at);
      }
  };
  pass(false, op.sx, rect);
  pass(true, op.sy, op.scope === 'boundsLocal' ? { ...rect, width: rect.width + Math.max(0, op.sx) } : rect);
  return output;
}
export function parseRasterRecipe(value: unknown): RasterRecipe {
  const r = object(value, ['version', 'base', 'operations']);
  if (r.version !== 1) throw Error('Unbekannte native Replay-Version.');
  const b = object(r.base, ['id', 'pixels']);
  if (!Array.isArray(b.pixels) || b.pixels.length > 16384 || !Array.isArray(r.operations) || r.operations.length > 256) invalid();
  const pixels = b.pixels.map((p: unknown) => {
    if (!Array.isArray(p) || p.length !== 2) invalid();
    return Object.freeze([integer(p[0], 0, 16383), integer(p[1], 0, 0xffffffff)] as const);
  });
  if (new Set(pixels.map(([k]) => k)).size !== pixels.length) invalid();
  const operations = r.operations.map((op: unknown) => parseRasterOperation(op));
  if (new Set(operations.map((op) => op.id)).size !== operations.length) invalid();
  return Object.freeze({ version: 1, base: Object.freeze({ id: id(b.id), pixels: Object.freeze(pixels.sort(([a], [b]) => a - b)) }),
    operations: Object.freeze(operations) });
}
export function createRasterRecipe(pixels: Pixels, operations: readonly RasterOperation[], baseId: string = crypto.randomUUID()) {
  return parseRasterRecipe({ version: 1, base: { id: baseId, pixels: [...pixels] }, operations });
}
export function replayRasterRecipe(recipe: RasterRecipe): Pixels {
  const parsed = parseRasterRecipe(recipe);
  return parsed.operations.reduce((pixels: Pixels, op) => applyRasterOperation(pixels, op), new Map(parsed.base.pixels));
}
export function changeRasterRecipe(recipe: RasterRecipe, operationId: string, replacement: RasterOperation | null) {
  if (!recipe.operations.some((o) => o.id === operationId)) throw Error('Operation nicht im Rezept.');
  return parseRasterRecipe({ ...recipe, operations: recipe.operations.flatMap((o) => o.id !== operationId ? [o] :
    replacement ? [{ ...replacement, id: operationId }] : []) });
}
