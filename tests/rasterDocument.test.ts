import { expect, it } from 'vitest';
import { AnimationStore, Stroke } from '../src/animation/store';
import type { RasterSessionV2 } from '../src/animation/files';
import { parseRasterDocument, restoreSession, serializeSession } from '../src/animation/files';
import { parseDocumentMetadata } from '../src/animation/document';
import { SOURCES } from '../src/animation/raster';

it('offers only neutral starts with an unlocked transparent pixel layer', () => {
  expect(SOURCES).toEqual({ empty: 'Leer', transparent: 'Transparent' });
  const store = new AnimationStore();
  expect(store.state.source).toBe('empty'); expect(store.editable?.pixels.size).toBe(0);
  for (const source of ['empty', 'transparent'] as const) {
    store.newAnimation('Neutral', source, false);
    expect(store.frame.layers).toHaveLength(1); expect(store.editable?.pixels.size).toBe(0);
  }
});
it('preserves pixels, layers, frame durations and document identity in the existing V2 format', () => {
  const store = new AnimationStore();
  new Stroke(store, { x: 2, y: 3 }, false).commit();
  store.addLayer(); new Stroke(store, { x: 5, y: 6 }, false).commit();
  store.addFrame(true); store.duration(125); store.saveAsset('Template');
  const json = serializeSession(store), restored = new AnimationStore();
  restoreSession(restored, json);
  expect(serializeSession(restored)).toBe(json); expect(restored.state.frames[1]?.duration).toBe(125);
  expect(restored.dirty).toBe(false); expect((JSON.parse(json) as RasterSessionV2).version).toBe(2);
});
it('ignores removed optional semantics, even malformed ones, without altering baked pixel layers', () => {
  const store = new AnimationStore(); new Stroke(store, { x: 2, y: 3 }, false).commit();
  const json = JSON.parse(serializeSession(store)) as RasterSessionV2;
  Object.assign(json, { source: 'old-prepared-source', faces: 'obsolete' });
  Object.assign(json.metadata, { legacy: null, migration: { corrupt: true } });
  Object.assign(json.frames[0]!, { pose: null, nativeFace: { nonsense: true } });
  Object.assign(json.frames[0]!.layers[0]!, { faceId: 99, nativeFaceSlot: 'unknown', recipe: { invalid: true } });
  const restored = new AnimationStore(); restoreSession(restored, JSON.stringify(json));
  expect(restored.editable?.pixels.get(3 * 128 + 2)).toBe(store.color);
  expect(Object.keys(restored.frame)).toEqual(['duration', 'layers']);
  expect(Object.keys(restored.layer!)).toEqual(['id', 'name', 'visible', 'locked', 'pixels']);
  expect(JSON.parse(serializeSession(restored))).not.toHaveProperty('faces');
});
it('rejects invalid pixels before any document or playback mutation', () => {
  const store = new AnimationStore(), state = store.state;
  const json = JSON.parse(serializeSession(store)) as RasterSessionV2; json.frames[0]!.layers[0]!.pixels = [[16384, 255]];
  expect(() => restoreSession(store, JSON.stringify(json))).toThrow(); expect(store.state).toBe(state);
});
it('detaches and freezes ordinary metadata, discarding retired migration fields', () => {
  const data = { id: 'document', reactionState: 'happy', provenance: { kind: 'native' }, legacy: {}, migration: {} };
  const parsed = parseDocumentMetadata(data); data.reactionState = 'sad';
  expect(parsed.reactionState).toBe('happy'); expect(Object.isFrozen(parsed)).toBe(true);
  expect(parsed).not.toHaveProperty('legacy'); expect(parsed).not.toHaveProperty('migration');
  expect(() => parseRasterDocument('{}')).toThrow();
});
