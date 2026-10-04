import { describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import { crc32, deflateSync } from 'node:zlib';
import { AnimationStore, Stroke } from '../src/animation/store';
import { blankLayer, rectMask } from '../src/animation/raster';
import { decodePng } from '../src/animation/png';

describe('migration interaction guarantees', () => {
  it('stale stroke cannot commit after frame switch or locking the target', () => {
    const s = new AnimationStore();
    const stroke = new Stroke(s, { x: 10, y: 10 }, false);
    s.addFrame();
    const c = s.commits;
    stroke.commit();
    expect(s.commits).toBe(c);
    const next = new Stroke(s, { x: 10, y: 10 }, false);
    s.editLayer(s.layer!.id, { locked: true });
    const d = s.commits;
    next.commit();
    expect(s.commits).toBe(d);
  });
  it('selection moves and stretches only captured occupied cells, preserving RGBA and undo', () => {
    const s = new AnimationStore();
    s.source('empty');
    s.pixels(
      s.layer!,
      new Map([
        [10 * 128 + 10, 0x12345601],
        [10 * 128 + 12, 0xffabcdef],
      ])
    );
    s.setSelection(rectMask({ x: 10, y: 10 }, { x: 12, y: 10 }));
    const original = s.layer!.pixels;
    s.stretch(3, 1);
    expect(s.selection!.size).toBe(8);
    expect(new Set(s.layer!.pixels.values())).toEqual(new Set(original.values()));
    s.undo();
    expect(s.layer!.pixels).toBe(original);
    s.setSelection(rectMask({ x: 10, y: 10 }, { x: 12, y: 10 }));
    s.move(2, -3);
    expect(s.layer!.pixels.get(7 * 128 + 12)).toBe(0x12345601);
    expect(s.selection!.has(7 * 128 + 14)).toBe(true);
  });
  it('PNG decoding preserves low alpha, grayscale transparency and indexed colors', () => {
    const raw = new Uint8Array([12, 43, 209, 1, 94, 12, 54, 0]);
    expect([...decodePng(encode({ width: 2, height: 1, data: raw, channels: 4 })).rgba]).toEqual([...raw]);
    // fast-png only writes palette tRNS, so supply an independent grayscale PNG.
    const chunk = (type: string, payload: Buffer) => {
      const body = Buffer.concat([Buffer.from(type), payload]),
        size = Buffer.alloc(4),
        crc = Buffer.alloc(4);
      size.writeUInt32BE(payload.length);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([size, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    const gray = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('tRNS', Buffer.from([0, 27])),
      chunk('IDAT', deflateSync(Buffer.from([0, 27, 99]))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect([...decodePng(gray).rgba]).toEqual([27, 27, 27, 0, 99, 99, 99, 255]);
    const indexed = encode({
      width: 2,
      height: 1,
      data: new Uint8Array([0, 1]),
      channels: 1,
      palette: [
        [17, 28, 39, 1],
        [90, 80, 70, 0],
      ],
    });
    expect([...decodePng(indexed).rgba]).toEqual([17, 28, 39, 1, 90, 80, 70, 0]);
  });
  it('layer visibility and topmost exact RGBA survive local history', () => {
    const s = new AnimationStore();
    s.source('empty');
    const l = blankLayer('extra');
    s.editFrame({ ...s.frame, layers: [...s.frame.layers, { ...l, pixels: new Map([[0, 0x12345601]]) }] });
    s.selectLayer(l.id);
    const before = s.state;
    s.editLayer(l.id, { visible: false });
    s.undo();
    expect(s.state).toBe(before);
    expect(s.layer!.pixels.get(0)).toBe(0x12345601);
  });
});
