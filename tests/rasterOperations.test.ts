import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { applyRasterOperation as apply, changeRasterRecipe, createRasterRecipe, newRasterOperation as op, parseRasterRecipe, rasterMaskKeys, replayRasterRecipe, RASTER_FILLS, RASTER_STRETCH_SCOPES } from '../src/animation/rasterOperations';
import type { RasterMask } from '../src/animation/rasterOperations';
import { AnimationStore, Stroke } from '../src/animation/store';
import { importRasterDocument, restoreSession, serializeSession } from '../src/animation/files';
import { production, render } from '../src/animation/raster';
import { mapLegacyOperations } from '../src/animation/migration/legacyOperations';
import { LegacyImage } from '../src/animation/legacy';
import known from '../src/animation/migration/legacy-inventory.json';
import v1 from './fixtures/raster-session-v1.json';

const A = 0x12345601, B = 0xabcdef00, C = 0xfedcba7f, D = 0xff0000ff;
const rect = { type: 'rect' as const, x: 1, y: 1, width: 3, height: 1 };
const data = () => new Map([[129, A], [130, B], [131, C], [132, D], [1000, A]]);
const move = (dx: number, dy = 0, fill = 'transparent', mask: RasterMask = rect) => op({ type: 'moveSelection', mask, dx, dy, fill });
function storeWithPixels() { const store = new AnimationStore(); store.source('empty'); store.pixels(store.layer!, data()); store.markSaved(store.captureContent()); return store; }
it('move region copies literal RGBA including zero-alpha RGB and clears transparent source cells at destination', () => {
  const pixels = data(), operation = op({ type: 'moveRegion', rect: { x: 1, y: 1, width: 4, height: 1 }, dx: 4, dy: 0 });
  const result = apply(pixels, operation);
  expect(result.get(133)).toBe(A); expect(result.get(134)).toBe(B); expect(result.get(135)).toBe(C); expect(result.get(136)).toBe(D);
  expect(result.has(129)).toBe(false); expect(result.get(1000)).toBe(A); expect(pixels).toEqual(data());
  const hole = new Map([[129, A], [131, D]]);
  expect(apply(hole, op({ type: 'moveRegion', rect: { x: 1, y: 1, width: 2, height: 1 }, dx: 1, dy: 0 })).has(131)).toBe(false);
});
it.each(RASTER_FILLS)('move selection %s has defined vacated fill and leaves other cells untouched', (fill) => {
  const before = data(), result = apply(before, move(2, 0, fill));
  expect(result.get(131)).toBe(A); expect(result.get(132)).toBe(B); expect(result.get(133)).toBe(C);
  if (fill === 'transparent') { expect(result.has(129)).toBe(false); expect(result.has(130)).toBe(false); }
  else { expect(result.get(129)).toBe(A); expect(result.get(130)).toBe(fill === 'restoreOriginal' ? B : A); }
  expect(result.get(1000)).toBe(A);
});
it('rectangle/polygon/cell masks preserve holes and constrain movement, with symmetric edge extension and clipping', () => {
  const polygon: RasterMask = { type: 'polygon', points: [[0, 0], [3, 0], [0, 3]] };
  expect([...rasterMaskKeys(polygon)].sort((a, b) => a - b)).toEqual([0, 1, 128]);
  const before = new Map([[0, A], [1, B], [128, C], [129, D], [16383, B]]);
  const result = apply(before, move(2, 2, 'transparent', polygon));
  expect(result.get(258)).toBe(A); expect(result.get(259)).toBe(B); expect(result.get(386)).toBe(C); expect(result.get(129)).toBe(D);
  expect(apply(before, move(-2, -2, 'transparent', polygon))).toEqual(new Map([[129, D], [16383, B]]));
  const cells: RasterMask = { type: 'cells', keys: [0, 128] };
  expect(apply(before, move(1, 0, 'transparent', cells)).get(1)).toBe(A);
  expect(apply(data(), move(-2, 0, 'extendSelectionEdge')).get(130)).toBe(C);
  expect(apply(new Map([[16383, B]]), move(1, 1, 'transparent', { type: 'rect', x: 127, y: 127, width: 1, height: 1 })).size).toBe(0);
});
it.each(RASTER_STRETCH_SCOPES)('stretch %s has native NN results and a bounded effect', (scope) => {
  const before = data(), result = apply(before, op({ type: 'stretchSelection', mask: rect, sx: 1, sy: 0, scope }));
  expect([result.get(129), result.get(130), result.get(131), result.get(132)]).toEqual([A, A, B, C]);
  expect(result.get(1000)).toBe(A);
  if (scope === 'bounds') expect(result.get(133)).toBe(D); else expect(result.has(133)).toBe(false);
  expect(before).toEqual(data());
});
it.each(RASTER_STRETCH_SCOPES)('polygon stretch %s distinguishes selected interior from explicit bounding stripes', (scope) => {
  const mask: RasterMask = { type: 'polygon', points: [[1, 1], [4, 1], [1, 4]] };
  const extra = 0x01020304, pixels = new Map([[129, A], [130, B], [257, C], [258, D], [259, extra], [999, A]]);
  const result = apply(pixels, op({ type: 'stretchSelection', mask, sx: 1, sy: 0, scope }));
  expect(result.get(259)).toBe(scope === 'mask' ? extra : D); expect(result.get(999)).toBe(A);
  expect(pixels.get(259)).toBe(extra);
});
it('local/global contraction, both axes and masked holes have explicit semantics; no coordinate aliasing', () => {
  const local = apply(data(), op({ type: 'stretchSelection', mask: rect, sx: -1, sy: 0, scope: 'boundsLocal' }));
  expect([local.get(129), local.get(130), local.get(131), local.get(132)]).toEqual([A, B, C, D]);
  const global = apply(data(), op({ type: 'stretchSelection', mask: rect, sx: -1, sy: 0, scope: 'bounds' })); expect(global.get(131)).toBe(D);
  const expanded = apply(new Map([[0, B]]), op({ type: 'stretchSelection', mask: { type: 'rect', x: 0, y: 0, width: 1, height: 1 }, sx: 1, sy: 1, scope: 'mask' }));
  expect(expanded).toEqual(new Map([[0, B], [1, B], [128, B], [129, B]]));
  const negative = apply(new Map([[127, A]]), op({ type: 'stretchSelection', mask: { type: 'rect', x: -1, y: 1, width: 2, height: 1 }, sx: 1, sy: 0, scope: 'mask' }));
  expect(negative).toEqual(new Map([[127, A]]));
  const cells: RasterMask = { type: 'cells', keys: [0, 2] };
  const holes = apply(new Map([[0, A], [1, D], [2, C]]), op({ type: 'stretchSelection', mask: cells, sx: 1, sy: 0, scope: 'mask' }));
  expect(holes.get(0)).toBe(A); expect(holes.get(1)).toBe(A); expect(holes.has(2)).toBe(false); expect(holes.get(3)).toBe(C);
});
it('replay equals sequential application, middle removal/change replays the base without mutating input', () => {
  const a = move(1), b = move(1, 0, 'restoreOriginal'), c = move(0, 1);
  const recipe = createRasterRecipe(data(), [a, b, c], 'stable-base'), json = JSON.stringify(recipe);
  expect(replayRasterRecipe(recipe)).toEqual(apply(apply(apply(data(), a), b), c));
  expect(replayRasterRecipe(changeRasterRecipe(recipe, b.id, null))).toEqual(apply(apply(data(), a), c));
  const replacement = move(-1);
  const changed = changeRasterRecipe(recipe, b.id, replacement);
  expect(changed.operations[1]!.id).toBe(b.id); expect(replayRasterRecipe(changed)).toEqual(apply(apply(apply(data(), a), replacement), c));
  expect(JSON.stringify(recipe)).toBe(json); expect(Object.isFrozen(recipe.base.pixels[0])).toBe(true);
});
it('one operation/change/remove/bake is one history entry; Undo/Redo and saved baseline include recipes', () => {
  const store = storeWithPixels(), baseline = store.frame, past = store.past.length;
  const a = move(1), b = move(2);
  store.applyNativeOperation(a, true); store.applyNativeOperation(b, true);
  const last = store.frame; expect(store.past).toHaveLength(past + 2); expect(store.dirty).toBe(true);
  store.changeNativeOperation(a.id, null); expect(store.layer!.pixels).toEqual(apply(data(), b));
  store.undo(); expect(store.frame).toBe(last); store.undo(); store.undo(); expect(store.frame).toBe(baseline); expect(store.dirty).toBe(false);
  store.redo(); store.redo(); const pixels = store.layer!.pixels; store.bakeNativeRecipe(); expect(store.layer!.recipe).toBeUndefined(); expect(store.layer!.pixels).toBe(pixels);
  store.undo(); expect(store.layer!.recipe!.operations).toHaveLength(2);
});
it('direct brush/transforms, empty frames and pose/face baking detach recipes without changing old history/other frames', () => {
  const store = storeWithPixels(); store.applyNativeOperation(move(1), true); const frame = store.frame;
  new Stroke(store, { x: 0, y: 0 }, false).commit(); expect(store.layer!.recipe).toBeUndefined(); store.undo(); expect(store.frame).toBe(frame);
  store.addFrame(); expect(store.layer!.recipe).toBeUndefined(); expect(store.layer!.pixels.size).toBe(0); expect(store.state.frames[0]).toBe(frame);
  store.frameAt(0); store.move(1, 0); expect(store.layer!.recipe).toBeUndefined(); store.undo();
  store.addFrame(true); const duplicate = store.frame; store.changeNativeOperation(frame.layers[0]!.recipe!.operations[0]!.id, null);
  expect(store.state.frames[0]).toBe(frame); expect(store.frame).not.toBe(duplicate);
  store.source('fino-standing-neutral-128'); store.selectLayer('native-pose'); store.applyNativeOperation(move(1), true);
  store.beginFacePreview(); store.commitFacePreview(); expect(store.frame.layers.find((l) => l.id === 'native-pose')!.recipe).toBeUndefined();
});
it('V2 portable/local roundtrip preserves replay; V1 and old V2 without recipes remain unchanged', async () => {
  const store = storeWithPixels(); store.applyNativeOperation(move(1), true); store.addFrame(true);
  const json = serializeSession(store), restored = new AnimationStore(); await importRasterDocument(restored, new Blob([json]));
  expect(serializeSession(restored)).toBe(json); expect(restored.dirty).toBe(false); expect(replayRasterRecipe(restored.layer!.recipe!)).toEqual(restored.layer!.pixels);
  restoreSession(restored, JSON.stringify(v1)); expect(restored.state.frames.every((f) => f.layers.every((l) => !l.recipe))).toBe(true);
  const oldV2 = serializeSession(restored); restoreSession(restored, oldV2); expect(serializeSession(restored)).toBe(oldV2);
});
it('unknown versions, invalid integer parameters, duplicate IDs/keys and mismatched saved pixels reject before mutation', () => {
  expect(() => apply(new Map([[1.5, A]]), move(1))).toThrow();
  expect(() => apply(new Map([[0, 0x100000000]]), move(1))).toThrow();
  expect(() => op({ type: 'moveSelection', mask: rect, dx: 1.2, dy: 0, fill: 'transparent' })).toThrow();
  expect(() => op({ type: 'stretchSelection', mask: rect, sx: 3, sy: 0, scope: 'bounds' })).toThrow();
  const recipe = createRasterRecipe(data(), [move(1)]);
  expect(() => parseRasterRecipe({ ...recipe, version: 2 })).toThrow('Replay-Version');
  expect(() => parseRasterRecipe({ ...recipe, operations: [...recipe.operations, recipe.operations[0]] })).toThrow();
  expect(() => parseRasterRecipe({ ...recipe, base: { ...recipe.base, pixels: [[0, A], [0, B]] } })).toThrow();
  const store = storeWithPixels(); store.applyNativeOperation(move(1), true); const before = store.state;
  const parsed = JSON.parse(serializeSession(store)) as { frames: { layers: { pixels: [number, number][] }[] }[] };
  parsed.frames[0]!.layers[0]!.pixels = [[0, D]];
  expect(() => restoreSession(store, JSON.stringify(parsed))).toThrow('Replay stimmt'); expect(store.state).toBe(before);
});
it('all operation outputs export as homogeneous literal 8x blocks, without Legacy runtime dependency', () => {
  const pixels = apply(data(), move(1)), layers = [{ id: 'test', name: 'test', visible: true, locked: false, pixels }], small = render(layers), big = production(layers);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const at = (y * 1024 + x) * 4, from = (Math.floor(y / 8) * 128 + Math.floor(x / 8)) * 4;
    for (let c = 0; c < 4; c++) if (big[at + c] !== small[from + c]) throw Error('Nonhomogeneous export');
  }
  expect(readFileSync('src/animation/rasterOperations.ts', 'utf8')).not.toMatch(/from ['"].*legacy|renderLegacy|1024/);
});
function legacyBase(pixels: ReadonlyMap<number, number>) {
  const bytes = production([{ id: 'proof', name: 'proof', visible: true, locked: false, pixels }]);
  const image = new LegacyImage(1024, 1024);
  for (let i = 0; i < image.pixels.length; i++) image.pixels[i] = ((bytes[i * 4]! << 24) | (bytes[i * 4 + 1]! << 16) | (bytes[i * 4 + 2]! << 8) | bytes[i * 4 + 3]!) >>> 0;
  return image;
}
it.each(RASTER_FILLS)('Legacy aligned move %s only becomes replayable after every real Legacy intermediate matches', (fill) => {
  const image = legacyBase(data()), base = image.toBytes(), mask = { type: 'rect' as const, x: 8, y: 8, width: 24, height: 8 };
  image.move(mask, 16, 0, fill);
  const operations = [{ type: 'moveSelection', mask, dx: 16, dy: 0, vacatedArea: { strategy: fill } }];
  const result = mapLegacyOperations(operations, known, { nativeBase: data(), baseId: 'archive-frame-base', legacyStagesRgba: [base, image.toBytes()] });
  expect(result.disposition).toBe('replayable'); expect(replayRasterRecipe(result.recipe!)).toEqual(apply(data(), move(2, 0, fill)));
  expect(mapLegacyOperations(operations, known, { nativeBase: data(), baseId: 'base' }).disposition).toBe('baked-not-replayable');
});
it('Legacy stretches and orthogonal polygons require actual prefix equality; mixed-color NN boundaries stay baked', () => {
  const image = legacyBase(data()), base = image.toBytes(); image.stretch({ x: 8, y: 8, width: 24, height: 8 }, 8, 0, true);
  const ops = [{ type: 'stretchSelection', mask: { type: 'rect', x: 8, y: 8, width: 24, height: 8 }, sx: 8, sy: 0, scope: 'boundsLocal' }];
  expect(mapLegacyOperations(ops, known, { nativeBase: data(), baseId: 'base', legacyStagesRgba: [base, image.toBytes()] }).disposition).toBe('baked-not-replayable');
  const uniform = new Map([[129, A], [130, A], [131, A]]), uniformImage = legacyBase(uniform), uniformBase = uniformImage.toBytes();
  uniformImage.stretch({ x: 8, y: 8, width: 24, height: 8 }, 8, 0, true);
  expect(mapLegacyOperations(ops, known, { nativeBase: uniform, baseId: 'base', legacyStagesRgba: [uniformBase, uniformImage.toBytes()] }).disposition).toBe('replayable');
  const polygon = { type: 'polygon' as const, points: [[8, 8], [32, 8], [32, 16], [8, 16]] as [number, number][] };
  const polyImage = legacyBase(data()), polyBase = polyImage.toBytes(); polyImage.move(polygon, 8, 0, 'transparent');
  expect(mapLegacyOperations([{ type: 'moveSelection', mask: polygon, dx: 8, dy: 0 }], known,
    { nativeBase: data(), baseId: 'base', legacyStagesRgba: [polyBase, polyImage.toBytes()] }).disposition).toBe('replayable');
});
it('subpixel breathing/1px, diagonal masks, unknown operations/defaults and bad proof never silently acquire replay', () => {
  for (const sy of [1, 2, -1, -2]) {
    const result = mapLegacyOperations([{ type: 'stretchSelection', mask: { type: 'rect', x: 8, y: 8, width: 24, height: 24 }, sy }], known, { nativeBase: data(), baseId: 'base' });
    expect(result.disposition).toBe('baked-not-replayable'); expect(result.operations[0]!.reason).toContain('keine Rundung auf Null'); expect(result.recipe).toBeUndefined();
  }
  expect(mapLegacyOperations([{ type: 'unknown' }], known, { nativeBase: data(), baseId: 'base' }).disposition).toBe('blocked');
  expect(mapLegacyOperations([{ type: 'moveSelection', mask: rect, vacatedArea: 'guess' }], known, { nativeBase: data(), baseId: 'base' }).disposition).toBe('blocked');
  const proof = legacyBase(data()).toBytes(), result = mapLegacyOperations([{ type: 'moveRegion', rect: { x: 8, y: 8, width: 24, height: 8 }, dx: 8 }], known,
    { nativeBase: data(), baseId: 'base', legacyStagesRgba: [proof, proof] });
  expect(result.disposition).toBe('baked-not-replayable'); expect(result.recipe).toBeUndefined();
});
it('Legacy region and sequential prefixes, plus both bounds scopes/signs, map only after genuine byte proofs', () => {
  const image = legacyBase(data()), stages = [image.toBytes()], rect = { x: 8, y: 8, width: 24, height: 8 };
  image.move({ type: 'rect', ...rect }, 8, 0, 'transparent'); stages.push(image.toBytes());
  image.move({ type: 'rect', ...rect }, 0, 8, 'transparent'); stages.push(image.toBytes());
  const result = mapLegacyOperations([{ type: 'moveRegion', rect, dx: 8 }, { type: 'moveRegion', rect, dy: 8 }], known,
    { nativeBase: data(), baseId: 'archive-base', legacyStagesRgba: stages });
  expect(result.disposition).toBe('replayable'); expect(result.recipe!.operations).toHaveLength(2);
  for (const scope of ['bounds', 'boundsLocal']) for (const sx of [-8, 8]) {
    const uniform = new Map([[129, A], [130, A], [131, A], [132, D]]), source = legacyBase(uniform), before = source.toBytes();
    source.stretch(rect, sx, 0, scope === 'boundsLocal');
    expect(mapLegacyOperations([{ type: 'stretchSelection', mask: { type: 'rect', ...rect }, sx, scope }], known,
      { nativeBase: uniform, baseId: 'archive-base', legacyStagesRgba: [before, source.toBytes()] }).disposition).toBe('replayable');
  }
});
it('unknown nested fields are reported even when a simultaneous subpixel delta is already unmappable', () => {
  for (const operation of [
    { type: 'moveSelection', mask: { ...rect, unknown: true }, dx: 1 },
    { type: 'moveSelection', mask: rect, dx: 1, vacatedArea: 'unknown' },
    { type: 'moveRegion', rect: { x: 8, y: 8, width: 8, height: 8, type: 'ignore' }, dx: 1 },
  ]) expect(mapLegacyOperations([operation], known, { nativeBase: data(), baseId: 'base' }).disposition).toBe('blocked');
});
it('unchanged operation replacement remains clean, with no redundant history; captured basis is detached and immutable', () => {
  const store = storeWithPixels(), operation = move(1); store.applyNativeOperation(operation, true); store.markSaved(store.captureContent());
  const before = store.frame, past = store.past.length;
  expect(store.changeNativeOperation(operation.id, operation)).toBe(true); expect(store.frame).toBe(before); expect(store.dirty).toBe(false); expect(store.past).toHaveLength(past);
  const original = data(), recipe = createRasterRecipe(original, [operation]); original.set(0, D);
  expect(recipe.base.pixels.some(([k]) => k === 0)).toBe(false);
});
