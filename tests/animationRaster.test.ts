import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnimationStore, Stroke } from '../src/animation/store';
import { brushBounds, key, production, referenceSample, render, shiftReference, sourceLayers, Viewport } from '../src/animation/raster';
import { bytes } from '../src/animation/colors';
import type { Reference } from '../src/animation/raster';
import { decodePng } from '../src/animation/png';
import { REFERENCE_NAMES, restoreSession, serializeSession } from '../src/animation/files';
import { encode } from 'fast-png';

function empty() {
  const s = new AnimationStore();
  s.state = {
    ...s.state,
    frames: [{ layers: sourceLayers('empty'), duration: 400 }],
    source: 'empty',
    active: 'pixels-1',
  };
  return s;
}
describe('ported Raster128 contract', () => {
  const multicolorReference: Reference = {
    name: 'colors', width: 3, height: 2,
    rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128,
      255, 255, 0, 255, 10, 20, 30, 0, 255, 0, 255, 255]),
    bounds: { x: 10, y: 20, width: 3, height: 2 }, visible: true, aligned: false,
  };
  it('automatic stroke samples every interpolated cell live without changing manual color or emitting', () => {
    const s = empty();
    s.setReference(multicolorReference);
    s.autoReferenceColor = true;
    const before = s.state, version = s.version, history = s.past.length, color = s.color;
    const stroke = new Stroke(s, { x: 9, y: 20 }, false);
    stroke.move({ x: 13, y: 20 });
    expect([...stroke.pixels]).toEqual([[2570, 0xff0000ff], [2571, 0x00ff00ff], [2572, 0x0000ff80]]);
    expect(s.state).toBe(before);
    expect(s.version).toBe(version);
    expect(s.color).toBe(color);
    stroke.commit();
    expect(s.past).toHaveLength(history + 1);
    expect(s.layer!.pixels).toEqual(stroke.pixels);
    s.undo();
    expect(s.layer!.pixels.size).toBe(0);
  });
  it('large automatic brush samples each cell, skips transparency and obeys selection', () => {
    const s = empty();
    s.setReference(multicolorReference);
    s.autoReferenceColor = true;
    s.pencilSize = 3;
    const stroke = new Stroke(s, { x: 11, y: 20 }, false);
    expect(stroke.pixels.size).toBe(5);
    for (const [k, color] of stroke.pixels) {
      expect(color).toBe(referenceSample(multicolorReference, { x: k % 128, y: Math.floor(k / 128) }));
    }
    expect(stroke.pixels.has(21 * 128 + 11)).toBe(false);
    expect(stroke.pixels.has(19 * 128 + 11)).toBe(false);
    s.selection = new Set([20 * 128 + 12]);
    expect([...new Stroke(s, { x: 11, y: 20 }, false).pixels]).toEqual([[2572, 0x0000ff80]]);
    s.editLayer(s.layer!.id, { locked: true });
    expect(() => new Stroke(s, { x: 11, y: 20 }, false)).toThrow('Layer ist nicht bearbeitbar.');
  });
  it('automatic sampling follows scaled and shifted reference bounds', () => {
    const s = empty();
    s.setReference({ ...multicolorReference, bounds: { x: 30.25, y: 40.25, width: 6, height: 4 } });
    s.autoReferenceColor = true;
    const stroke = new Stroke(s, { x: 30, y: 40 }, false);
    stroke.move({ x: 35, y: 40 });
    expect([...stroke.pixels.values()]).toEqual([0xff0000ff, 0xff0000ff, 0x00ff00ff, 0x00ff00ff, 0x0000ff80, 0x0000ff80]);
  });
  it.each(['disabled', 'absent', 'hidden'] as const)('manual painting is unchanged when automation is %s', (kind) => {
    const s = empty();
    if (kind !== 'absent') s.setReference({ ...multicolorReference, visible: kind !== 'hidden' });
    s.autoReferenceColor = kind !== 'disabled';
    const stroke = new Stroke(s, { x: 9, y: 20 }, false);
    stroke.move({ x: 13, y: 20 });
    expect(stroke.pixels.size).toBe(5);
    expect([...stroke.pixels.values()]).toEqual(Array(5).fill(s.color));
  });
  it('eraser ignores automatic color and commits its interpolated removal once', () => {
    const s = empty();
    new Stroke(s, { x: 10, y: 20 }, false).commit();
    s.setReference(multicolorReference);
    s.autoReferenceColor = true;
    const before = s.state, version = s.version, history = s.past.length;
    const stroke = new Stroke(s, { x: 9, y: 20 }, true);
    stroke.move({ x: 13, y: 20 });
    expect(stroke.pixels.size).toBe(0);
    expect(s.state).toBe(before);
    expect(s.version).toBe(version);
    stroke.commit();
    expect(s.past).toHaveLength(history + 1);
    s.undo();
    expect(s.layer!.pixels.has(2570)).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('square pencil/eraser size %i with fixed anchor', (size) => {
    const s = empty();
    s.pencilSize = size;
    s.eraserSize = size;
    s.color = 0x12345603;
    const center = { x: 64, y: 64 },
      before = s.state;
    const stroke = new Stroke(s, center, false);
    expect(s.state).toBe(before);
    expect(s.past).toHaveLength(0);
    stroke.commit();
    expect(s.layer!.pixels.size).toBe(size * size);
    expect([...s.layer!.pixels.values()].every((v) => v === 0x12345603)).toBe(true);
    const b = brushBounds(center, size);
    expect(b.x).toBe(64 - Math.floor((size - 1) / 2));
    expect(s.layer!.pixels.has(key(b))).toBe(true);
    new Stroke(s, center, true).commit();
    expect(s.layer!.pixels.size).toBe(0);
    s.undo();
    expect(s.layer!.pixels.size).toBe(size * size);
    s.redo();
    expect(s.layer!.pixels.size).toBe(0);
  });
  it('fast local stroke has no holes, one commit and independent sizes', () => {
    const s = empty();
    s.pencilSize = 3;
    s.eraserSize = 6;
    const stroke = new Stroke(s, { x: 0, y: 0 }, false),
      start = s.state;
    for (let x = 10; x <= 120; x += 10) stroke.move({ x, y: x });
    expect(s.state).toBe(start);
    expect(s.commits).toBe(0);
    stroke.commit();
    expect(s.past).toHaveLength(1);
    for (let x = 0; x <= 120; x++) expect(s.layer!.pixels.has(x * 128 + x)).toBe(true);
    expect([...s.layer!.pixels.keys()].every((k) => k >= 0 && k < 16384)).toBe(true);
    s.selectTool('eraser');
    expect(s.brushSize).toBe(6);
    s.selectTool('pencil');
    expect(s.brushSize).toBe(3);
  });
  it('export consists only of exact 8×8 RGBA cells, excluding references', () => {
    const s = empty();
    s.color = 0x12345603;
    new Stroke(s, { x: 3, y: 4 }, false).commit();
    const out = production(s.frame.layers),
      original = render(s.frame.layers);
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 1024; x++) {
        const i = (y * 1024 + x) * 4,
          j = (Math.floor(y / 8) * 128 + Math.floor(x / 8)) * 4;
        for (let c = 0; c < 4; c++)
          if (out[i + c] !== original[j + c]) throw Error(`RGBA mismatch at ${x},${y}`);
      }
    expect(
      Buffer.from(decodePng(encode({ width: 1024, height: 1024, data: out, channels: 4 })).rgba).equals(
        Buffer.from(out)
      )
    ).toBe(true);
  });
  it.each([
    { x: 4, y: 5 },
    { x: 400, y: 300 },
    { x: 790, y: 590 },
  ])('zoom focal anchor %j is stable', (p) => {
    let v = new Viewport(17, -9, 4);
    const logical = v.logical(p);
    for (const f of [1.25, 20, 0.03, 0.25, 16, 0.8]) {
      v = v.zoomAt(p, f);
      expect(v.logical(p).x).toBeCloseTo(logical.x, 10);
      expect(v.logical(p).y).toBeCloseTo(logical.y, 10);
    }
    const moved = v.zoomAt(p, 1.4).pan({ x: 17, y: -8 });
    const mapped = moved.logical({ x: p.x + 17, y: p.y - 8 });
    expect(mapped.x).toBeCloseTo(logical.x, 10);
    expect(mapped.y).toBeCloseTo(logical.y, 10);
  });
  it('reference sampling uses original alpha, aligned movement and fallback', () => {
    const ref: Reference = {
      name: 'test',
      width: 2,
      height: 1,
      rgba: new Uint8Array([...bytes(0x12345603), 10, 20, 30, 0]),
      bounds: { x: 10, y: 20, width: 2, height: 1 },
      aligned: true,
      visible: true,
    };
    expect(referenceSample(ref, { x: 10, y: 20 })).toBe(0x12345603);
    expect(referenceSample(ref, { x: 11, y: 20 })).toBeNull();
    expect(referenceSample({ ...ref, visible: false }, { x: 10, y: 20 })).toBeNull();
    expect(referenceSample(shiftReference(ref, { x: 3.4, y: -2.4 }), { x: 13, y: 18 })).toBe(0x12345603);
    const s = empty();
    s.setReference(ref);
    const before = s.state,
      history = s.past.length;
    s.selectTool('eyedropper');
    s.pick({ x: 10, y: 20 });
    expect(s.color).toBe(0x12345603);
    expect(s.state).toBe(before);
    expect(s.past.length).toBe(history);
  });
  it('frame duplication, session roundtrip and undo retain native pixels', () => {
    const s = empty();
    s.color = 0x11223301;
    new Stroke(s, { x: 3, y: 4 }, false).commit();
    s.addFrame(true);
    s.duration(123);
    const restored = empty();
    restoreSession(restored, serializeSession(s));
    // V2 persists content, not the currently viewed frame.
    expect(restored.state.index).toBe(0);
    restored.frameAt(s.state.index);
    expect(restored.frame.duration).toBe(123);
    expect(render(restored.frame.layers)).toEqual(render(s.frame.layers));
    s.undo();
    expect(s.frame.duration).toBe(400);
    s.undo();
    expect(s.state.frames).toHaveLength(1);
  });
  it.each(REFERENCE_NAMES)('bundled %s reference has native cells and transparency', (name) => {
    const p = decodePng(new Uint8Array(readFileSync(`public/animation/tracing/fino_${name}_128.png`)));
    expect([p.width, p.height]).toEqual([128, 128]);
    expect(p.rgba[3]).toBe(0);
    expect(p.rgba.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  });
});
