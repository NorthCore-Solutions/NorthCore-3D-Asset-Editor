import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { NATIVE_POSES, nativePosePixels, poseForSource, poseReference } from '../src/animation/nativePoses';
import { nativePose, render, production, sourceLayers, SOURCES } from '../src/animation/raster';
import { AnimationStore } from '../src/animation/store';
import { parseRasterDocument, restoreSession, serializeSession, exportRasterDocument, importRasterDocument, saveRasterSession } from '../src/animation/files';
import { canonicalMetadata } from '../src/animation/document';
import v1 from './fixtures/raster-session-v1.json';
import manifest from '../src/animation/data/poses/catalog.json';

const save = vi.hoisted(() => vi.fn());
vi.mock('../src/platform/nativeFileDialog', () => ({ saveBlobAs: save }));
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const goldens = {
  standing_neutral: 'b7e46ed7fe39264213f259550087377e2f37fab458a6b906f8424b36fcf0bb30',
  standing_active: '15919365ae676f00f2fd41a1210ab64078754e9195298ca87372fc4b86fc1a5e',
  sitting_relaxed: 'ac8583cdbc7f785c164d7f7babcf96807f3c398a92ca18b9ebf3415c1bb6e943',
  sleeping: '93ce70a0573e44a25ac19b3b5fa580ef140b107767e1dda744ff573bd106c6ce',
  reading: '1458175a6e831e9c7f5f61bd1cfea63ea427ec4ea0c9b3be2a48a6f225c515d8',
  eating: '12fdb2067b0d78e1b0f15a0c257f85f221bd7f76fc47b15baa233096277481cd',
};
it('catalog contains exactly six stable pose/source IDs and matches the original native anchor', () => {
  expect(NATIVE_POSES.map((p) => p.id)).toEqual(Object.keys(goldens));
  expect(new Set(NATIVE_POSES.map((p) => p.sourceId)).size).toBe(6);
  const anchor: unknown = JSON.parse(readFileSync('src/animation/data/standing-neutral.json', 'utf8'));
  expect(hash(canonicalMetadata(anchor))).toBe(manifest.anchorSha256);
  expect([...nativePosePixels('standing_neutral')].sort(([a], [b]) => a - b)).toEqual([...nativePose()].sort(([a], [b]) => a - b));
  expect(nativePosePixels('standing_neutral').size).toBe(3514);
});
for (const pose of NATIVE_POSES) {
  it(`${pose.id}: native asset dimensions, valid RGBA/alpha and stable asset/pixel hashes`, () => {
    expect(pose.asset).toBe(`${pose.id}.json`);
    const asset = JSON.parse(readFileSync(`src/animation/data/poses/${pose.asset}`, 'utf8')) as { width: number; height: number; assetVersion: number; pixels: [number, number][] };
    expect([asset.width, asset.height, asset.assetVersion]).toEqual([128, 128, 1]);
    expect(hash(canonicalMetadata(asset))).toBe(pose.assetSha256);
    expect(new Set(asset.pixels.map(([k]) => k)).size).toBe(asset.pixels.length);
    expect(asset.pixels.every(([k, rgba]) => Number.isInteger(k) && k >= 0 && k < 16384 && Number.isInteger(rgba) && rgba >= 0 && rgba <= 0xffffffff && (rgba & 255) === 255)).toBe(true);
    const layers = sourceLayers(pose.sourceId), pixels = nativePosePixels(pose.id);
    expect(layers[0]!.pixels).toEqual(pixels); expect(SOURCES[pose.sourceId]).toBe(pose.name);
    expect(hash(render(layers))).toBe(goldens[pose.id]); expect(hash(render(layers))).toBe(pose.pixelSha256);
    expect(nativePosePixels(pose.id)).not.toBe(pixels);
    expect(poseReference(pose.sourceId)).toEqual({ poseId: pose.id, assetVersion: 1, pixelSha256: pose.pixelSha256 });
  });
  it(`${pose.id}: choice and Frame aus Grundpose use independent native pixels with persistent origin`, () => {
    const store = new AnimationStore(); store.source(pose.sourceId);
    const first = store.frame, history = store.past.length;
    expect(first.layers[0]!.pixels).toEqual(nativePosePixels(pose.id)); expect(first.pose).toEqual(poseReference(pose.sourceId));
    expect(store.addPoseFrame()).toBe(true);
    expect(store.state.frames[0]).toBe(first); expect(store.frame.pose).toEqual(first.pose);
    expect(store.frame.layers[0]!.pixels).toEqual(first.layers[0]!.pixels); expect(store.frame.layers[0]!.pixels).not.toBe(first.layers[0]!.pixels);
    expect(store.past).toHaveLength(history + 1); expect(store.frame.duration).toBe(400);
    const json = serializeSession(store), restored = new AnimationStore(); restoreSession(restored, json);
    expect(restored.state.source).toBe(pose.sourceId); expect(restored.state.frames.map((f) => f.pose)).toEqual(store.state.frames.map((f) => f.pose));
    expect(serializeSession(restored)).toBe(json); expect(restored.dirty).toBe(false);
  });
  it(`${pose.id}: 1024 output is only literal homogeneous 8×8 blocks`, () => {
    const layers = sourceLayers(pose.sourceId), native = render(layers), output = production(layers);
    let identical = true;
    for (let y = 0; y < 1024 && identical; y++) for (let x = 0; x < 1024 && identical; x++) {
      const a = (Math.floor(y / 8) * 128 + Math.floor(x / 8)) * 4, b = (y * 1024 + x) * 4;
      for (let c = 0; c < 4; c++) if (native[a + c] !== output[b + c]) { identical = false; break; }
    }
    expect(output.length).toBe(1024 * 1024 * 4); expect(identical).toBe(true);
  });
}
it('pose changes alter only the current frame and are undoable without touching other frame pixels', () => {
  const store = new AnimationStore(); store.addPoseFrame(); store.addPoseFrame();
  const first = store.state.frames[0], last = store.state.frames[2]; store.frameAt(1); store.source('fino-sleeping-128');
  expect(store.state.frames[0]).toBe(first); expect(store.state.frames[2]).toBe(last);
  expect(store.frame.pose!.poseId).toBe('sleeping'); store.undo(); expect(store.frame.pose!.poseId).toBe('standing_neutral');
  store.redo(); expect(store.frame.pose!.poseId).toBe('sleeping');
});
it('ordinary new frames stay empty with no pose claim; duplicate/copy retain provenance and non-pose sources cannot create pose frames', () => {
  const store = new AnimationStore(); store.source('fino-reading-128'); store.addFrame();
  expect(store.frame.layers.every((l) => l.pixels.size === 0)).toBe(true); expect(store.frame.pose).toBeUndefined();
  store.addPoseFrame(); const pose = store.frame.pose; store.addFrame(true); expect(store.frame.pose).toEqual(pose);
  store.newAnimation('Copy', 'empty', true); expect(store.frame.pose).toEqual(pose);
  store.source('empty'); const before = store.state; expect(store.addPoseFrame()).toBe(false); expect(store.state).toBe(before);
  expect(store.frame.pose).toBeUndefined(); expect(poseForSource('dev-reference-128')).toBeUndefined();
});
it('editing saved pixels keeps historical origin and does not silently re-render them on Load or newer asset references', () => {
  const store = new AnimationStore(); store.source('fino-eating-128'); const pose = store.frame.pose;
  store.pixels(store.layer!, new Map([[129, 0x12345601]])); expect(store.frame.pose).toBe(pose);
  const data = JSON.parse(serializeSession(store)) as { frames: { pose: { assetVersion: number; pixelSha256: string } }[] };
  data.frames[0]!.pose.assetVersion = 2; data.frames[0]!.pose.pixelSha256 = '0'.repeat(64);
  restoreSession(store, JSON.stringify(data)); expect(store.layer!.pixels).toEqual(new Map([[129, 0x12345601]]));
  expect(store.frame.pose!.assetVersion).toBe(2); expect(Object.isFrozen(store.frame.pose)).toBe(true);
});
it('V1 without per-frame origins remains readable and preserves deterministic upgrade identity', () => {
  const store = new AnimationStore(); restoreSession(store, JSON.stringify(v1));
  expect(store.state.frames.every((f) => f.pose === undefined)).toBe(true);
  expect(parseRasterDocument(serializeSession(store)).state.metadata).toEqual(store.state.metadata);
});
it.each([null, { poseId: 'legacy-special', assetVersion: 1, pixelSha256: '0'.repeat(64) },
  { poseId: 'reading', assetVersion: 0, pixelSha256: '0'.repeat(64) }, { poseId: 'reading', assetVersion: 1, pixelSha256: 'invalid' }])('invalid pose metadata is rejected before Restore mutation: %o', (pose) => {
  const store = new AnimationStore(), before = store.state;
  const data = JSON.parse(serializeSession(store)) as { frames: { pose: unknown }[] }; data.frames[0]!.pose = pose;
  expect(() => restoreSession(store, JSON.stringify(data))).toThrow('Pose-Herkunft'); expect(store.state).toBe(before);
});
it('portable .raster128.json export/import preserves selected pose and every frame origin without changing export dirty state', async () => {
  const store = new AnimationStore(); store.source('fino-sitting-relaxed-128'); store.addPoseFrame(); const dirty = store.dirty;
  save.mockResolvedValueOnce({ name: 'poses.raster128.json', uri: null }); await exportRasterDocument(store);
  const [blob, name] = save.mock.calls.at(-1)! as [Blob, string]; expect(name.endsWith('.raster128.json')).toBe(true); expect(store.dirty).toBe(dirty);
  const other = new AnimationStore(); expect(await importRasterDocument(other, blob)).toBe('imported');
  expect(serializeSession(other)).toBe(serializeSession(store)); expect(other.dirty).toBe(false);
});
it('pose/frame changes during a delayed local save remain dirty', async () => {
  const rows = new Map<string, string>(); let write!: () => void;
  const request = { result: { close() {}, transaction() {
    const staged = new Map<string, string>();
    const tx = {
      oncomplete: undefined as (() => void) | undefined,
      objectStore: (name: string) => name === 'builder_metadata' ? { put() {}, delete() {} } : ({
        put: (json: string, key: string) => { staged.set(key, json); write = () => { for (const [k, v] of staged) rows.set(k, v); tx.oncomplete?.(); }; },
        get: (key: string) => { const read = { result: rows.get(key), onsuccess: () => {} }; queueMicrotask(() => read.onsuccess()); return read; },
      }),
    }; return tx;
  } }, onsuccess: null as (() => void) | null };
  vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => request.onsuccess?.()); return request; } });
  try {
    const store = new AnimationStore(); store.source('fino-reading-128'); const saving = saveRasterSession(store);
    await vi.waitFor(() => expect(write).toBeDefined()); store.addPoseFrame(); write();
    expect(await saving).toBe('changed'); expect(store.dirty).toBe(true);
    const written = parseRasterDocument(rows.get(store.state.name)!); expect(written.state.frames).toHaveLength(1);
    expect(written.state.frames[0]!.pose!.poseId).toBe('reading');
  } finally { vi.unstubAllGlobals(); }
});
it('native display/source implementation has no Legacy-renderer or reference-image dependency', () => {
  for (const path of ['src/animation/nativePoses.ts', 'src/animation/raster.ts']) {
    const code = readFileSync(path, 'utf8'); expect(code).not.toMatch(/from ['"][^'"]*legacy|renderLegacy|loadLegacyAsset|fetch\(/);
  }
  const recipe = readFileSync('scripts/author-native-poses.py', 'utf8'); expect(recipe).not.toMatch(/Image\.open|Image\.Resampling\.(BILINEAR|LANCZOS)|legacy\//);
});
