import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AnimationStore } from '../src/animation/store';
import { NATIVE_POSES, nativePosePixels } from '../src/animation/nativePoses';
import { FACE_SLOTS, EYE_VARIANTS, MOUTH_VARIANTS, NATIVE_FACE_CATALOG, bakeNativeFace, changeNativeSlot, defaultNativeFace, dragNativeSlot, faceFreePixels, parseNativeFace, slotPixels } from '../src/animation/nativeFaces';
import { mapLegacyFace, mapLegacyAddons } from '../src/animation/migration/legacyFaces';
import { render, production, blankLayer } from '../src/animation/raster';
import { importRasterDocument, parseRasterDocument, restoreSession, serializeSession } from '../src/animation/files';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

it('pins the independently authored catalog and every asset, with native dimensions/exact opaque RGBA', () => {
  expect(hash(readFileSync('src/animation/data/faces/catalog.json'))).toBe('8f8cab3950fe001be2553d988703c046cef0705b22b0d30c80a78bc01907fcb5');
  expect(Object.keys(NATIVE_FACE_CATALOG.bases)).toEqual(NATIVE_POSES.map((p) => p.id));
  expect(Object.keys(NATIVE_FACE_CATALOG.assets)).toHaveLength(15);
  for (const ref of [...Object.values(NATIVE_FACE_CATALOG.bases), ...Object.values(NATIVE_FACE_CATALOG.assets)]) {
    const data = JSON.parse(readFileSync(`src/animation/data/faces/${ref.asset}`, 'utf8')) as { width: number; height: number; pixels: [number, number][] };
    expect([data.width, data.height]).toEqual([128, 128]);
    expect(new Set(data.pixels.map(([k]) => k)).size).toBe(data.pixels.length);
    expect(data.pixels.every(([k, rgba]) => Number.isInteger(k) && k >= 0 && k < 16384 &&
      Number.isInteger(rgba) && rgba >= 0 && rgba <= 0xffffffff && (rgba & 255) === 255)).toBe(true);
    expect(hash(render([{ ...blankLayer('test'), pixels: new Map(data.pixels) }]))).toBe(ref.pixelSha256);
  }
});
for (const pose of NATIVE_POSES) {
  it(`${pose.id}: face-free underlay, all slot variants and homogeneous 8x export`, () => {
    const free = faceFreePixels(pose.id);
    expect(free).not.toEqual(nativePosePixels(pose.id)); expect(free.size).toBeGreaterThan(1000);
    expect(hash(render([{ ...blankLayer('base'), pixels: free }]))).toBe(pose.faceFree.pixelSha256);
    const store = new AnimationStore(); store.source(pose.sourceId);
    let face = defaultNativeFace(pose.id);
    for (const slot of FACE_SLOTS) for (const variant of slot === 'mouth' ? MOUTH_VARIANTS : EYE_VARIANTS) {
      face = changeNativeSlot(face, slot, { variant });
      expect(slotPixels(face, slot).size).toBeGreaterThan(0);
      expect(slotPixels(face, slot)).toEqual(slotPixels(parseNativeFace(face), slot));
    }
    const frame = bakeNativeFace(store.frame, face), small = render(frame.layers), large = production(frame.layers);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const k = (y * 1024 + x) * 4, source = (Math.floor(y / 8) * 128 + Math.floor(x / 8)) * 4;
      for (let c = 0; c < 4; c++) if (large[k + c] !== small[source + c]) throw Error('Nonhomogeneous export');
    }
  });
}
it('slot placement/scaling is integer nearest neighbor, visibility/clipping and invalid metadata are explicit', () => {
  let face = defaultNativeFace('standing_neutral');
  face = changeNativeSlot(face, 'leftEye', { x: 0, y: 0, width: 8, height: 8 });
  const pixels = slotPixels(face, 'leftEye'); expect(pixels.get(2)).toBe(pixels.get(3));
  expect(slotPixels(changeNativeSlot(face, 'leftEye', { visible: false }), 'leftEye').size).toBe(0);
  expect(slotPixels(changeNativeSlot(face, 'leftEye', { x: -128 }), 'leftEye').size).toBe(0);
  expect(dragNativeSlot(face.slots.leftEye, 2.6, -1.6)).toEqual({ x: 3, y: -2 });
  for (const patch of [{ x: 1.5 }, { width: 0 }, { height: 129 }, { variant: 'sad' }, { visible: 'true' }])
    expect(() => changeNativeSlot(face, 'leftEye', patch as Parameters<typeof changeNativeSlot>[2])).toThrow();
});
it('preview stays clean, preserves unrelated base/artwork pixels; commit = preview and Undo/Redo = one operation', () => {
  const store = new AnimationStore();
  const pixels = new Map(store.layer!.pixels); pixels.set(0, 0x12345601); store.pixels(store.layer!, pixels);
  store.addLayer(); const artwork = store.layer!, artworkPixels = new Map([[16383, 0x98765402]]); store.pixels(artwork, artworkPixels);
  store.markSaved(store.captureContent()); const before = store.frame, count = store.past.length;
  expect(store.beginFacePreview()).toBe(true);
  store.previewFaceSlot('mouth', { variant: 'chew', x: 75, width: 16 });
  const preview = store.displayFrame, rgba = render(preview.layers);
  expect(store.frame).toBe(before); expect(store.dirty).toBe(false); expect(store.past).toHaveLength(count);
  expect(preview.layers.find((l) => l.id === 'native-pose')!.pixels.get(0)).toBe(0x12345601);
  expect(preview.layers.find((l) => l.id === artwork.id)!.pixels).toBe(artworkPixels);
  store.commitFacePreview(); expect(store.frame).toBe(preview); expect(render(store.frame.layers)).toEqual(rgba);
  expect(store.dirty).toBe(true); expect(store.past).toHaveLength(count + 1);
  store.undo(); expect(store.frame).toBe(before); expect(store.dirty).toBe(false);
  store.redo(); expect(store.frame).toBe(preview);
});
it('cancel/navigation/playback/new/restore cannot retain a stale preview or write UI states', () => {
  const store = new AnimationStore(), json = serializeSession(store);
  store.beginFacePreview(); store.selectFaceSlot('mouth'); store.preserveFaceOnSource = true;
  expect(serializeSession(store)).toBe(json); store.cancelFacePreview(); expect(store.displayFrame).toBe(store.frame);
  store.beginFacePreview(); store.addPoseFrame(); expect(store.faceDraft).toBeUndefined();
  store.beginFacePreview(); store.frameAt(0); expect(store.faceDraft).toBeUndefined();
  store.beginFacePreview(); store.play(); expect(store.faceDraft).toBeUndefined(); store.pause(false);
  store.beginFacePreview(); restoreSession(store, json); expect(store.faceDraft).toBeUndefined();
  store.beginFacePreview(); store.newAnimation('New', 'empty', false); expect(store.faceDraft).toBeUndefined();
});
it('pose-retarget preserves states/visibility/size, explicit range, artwork, timing; one reversible commit', () => {
  const store = new AnimationStore(); store.beginFacePreview();
  store.previewFaceSlot('leftEye', { variant: 'happy', visible: false, width: 6 });
  store.previewFaceSlot('mouth', { variant: 'sad' }); store.commitFacePreview();
  store.addLayer(); const artId = store.layer!.id, art = new Map([[2, 0x10203040]]); store.pixels(store.layer!, art);
  store.addFrame(true); store.duration(777); store.addFrame(true);
  const frames = store.state.frames, count = store.past.length;
  store.retargetFacePose('reading', 0, 1);
  expect(store.past).toHaveLength(count + 1); expect(store.state.frames[2]).toBe(frames[2]);
  for (const frame of store.state.frames.slice(0, 2)) {
    expect(frame.layers.find((l) => l.id === artId)!.pixels).toBe(art);
    expect(frame.pose!.poseId).toBe('reading');
    expect(frame.nativeFace!.slots.leftEye).toMatchObject({ variant: 'happy', visible: false, width: 6, x: 69, y: 27 });
    expect(frame.nativeFace!.slots.mouth.variant).toBe('sad');
  }
  expect(store.state.frames.map((f) => f.duration)).toEqual([400, 777, 777]);
  store.undo(); expect(store.state.frames).toBe(frames); store.redo();
  store.retargetFacePose('sleeping', 2, 2, false); expect(store.frame.nativeFace!.slots.leftEye.variant).toBe('closed');
});
it('invalid mixed/empty ranges fail atomically; source preserve is opt-in and current-frame only', () => {
  const store = new AnimationStore(); store.beginFacePreview(); store.previewFaceSlot('mouth', { variant: 'open' }); store.commitFacePreview();
  store.addFrame(true); const first = store.state.frames[0]; store.preserveFaceOnSource = true;
  store.source('fino-eating-128'); expect(store.state.frames[0]).toBe(first); expect(store.frame.nativeFace!.slots.mouth.variant).toBe('open');
  store.preserveFaceOnSource = false; store.source('fino-reading-128'); expect(store.frame.nativeFace).toBeUndefined();
  store.addFrame(); const before = store.state, past = store.past;
  expect(() => store.retargetFacePose('sleeping', 0, 2)).toThrow(); expect(store.state).toBe(before); expect(store.past).toBe(past);
  expect(() => store.retargetFacePose('sleeping', -1, 2)).toThrow();
});
it('V1/V2 are explicit stylistic mappings with distinct mouth/base/preset context; unknown states blocked', () => {
  const input = { leftEye: { state: 'half', x: 598, y: 142, width: 44, height: 40, visible: false },
    mouth: { state: 'chew', x: 686, y: 170, width: 173, height: 100 } };
  const v1 = mapLegacyFace(1, 'standing_neutral', input), v2 = mapLegacyFace(2, 'standing_neutral', input);
  expect(v1.status).toBe('lossy'); expect(v1.requiresApproval).toBe(true);
  expect(v1.face.slots.leftEye).toMatchObject({ variant: 'half', visible: false });
  expect(v1.face.slots.mouth.width).toBe(10); expect(v2.face.slots.mouth.width).toBe(8);
  expect(v1.face.origin!.baseKind).toBe('original-pose'); expect(v2.face.origin!.baseKind).toBe('face-free');
  expect(slotPixels(v1.face, 'mouth')).not.toEqual(slotPixels(v2.face, 'mouth'));
  expect(() => mapLegacyFace(2, 'reading', { mouth: { ...input.mouth, state: 'unknown' } })).toThrow();
});
it('Save/Load and portable files retain face provenance and pixels, including historical catalog versions without regeneration', async () => {
  const store = new AnimationStore(); store.beginFacePreview(); store.previewFaceSlot('mouth', { variant: 'smile' }); store.commitFacePreview();
  store.addFrame(true); store.retargetFacePose('eating', 1, 1);
  const json = serializeSession(store); const loaded = new AnimationStore();
  expect(await importRasterDocument(loaded, new Blob([json]))).toBe('imported');
  expect(serializeSession(loaded)).toBe(json); expect(loaded.dirty).toBe(false);
  const parsed = JSON.parse(json) as { frames: { nativeFace: { catalogVersion: number }; layers: { pixels: [number, number][] }[] }[] };
  parsed.frames[0]!.nativeFace.catalogVersion = 2; parsed.frames[0]!.layers[0]!.pixels = [[0, 0x11223304]];
  restoreSession(loaded, JSON.stringify(parsed)); expect(loaded.frame.layers[0]!.pixels).toEqual(new Map([[0, 0x11223304]]));
  expect(() => loaded.beginFacePreview()).toThrow('Historischer');
  expect(parseRasterDocument(serializeSession(loaded)).state.frames[0]!.nativeFace!.catalogVersion).toBe(2);
});
it('invalid face metadata rejects the entire document before Store mutation; baked migrations remain unchanged', () => {
  const store = new AnimationStore(); store.beginFacePreview(); store.commitFacePreview(); const before = store.state;
  const data = JSON.parse(serializeSession(store)) as { frames: { nativeFace: unknown }[] };
  data.frames[0]!.nativeFace = { ...defaultNativeFace('reading') };
  expect(() => restoreSession(store, JSON.stringify(data))).toThrow('widersprechen'); expect(store.state).toBe(before);
  const baked = new AnimationStore(); baked.source('empty'); const json = serializeSession(baked);
  restoreSession(baked, json); expect(serializeSession(baked)).toBe(json); expect(baked.beginFacePreview()).toBe(false);
});
it('native implementation has no Legacy renderer dependency', () => {
  for (const file of ['nativeFaces.ts', 'NativeFaceInspector.tsx']) {
    const source = readFileSync(`src/animation/${file}`, 'utf8');
    expect(source).not.toMatch(/from ['"].*legacy|renderLegacy|loadRig/);
  }
});
it('combined Legacy addons map to independent native slots, explicit context and approval; unknown states/root block', () => {
  const result = mapLegacyAddons('reading', 'addons_normalized', { eyes: { state: 'happy', dx: 13, dy: -9 }, mouth: null });
  expect(result.face.slots.leftEye.variant).toBe('happy'); expect(result.face.slots.rightEye.variant).toBe('happy');
  expect(result.face.slots.mouth.visible).toBe(false); expect(result.status).toBe('lossy'); expect(result.requiresApproval).toBe(true);
  expect(() => mapLegacyAddons('reading', 'unknown', { eyes: 'open' })).toThrow();
  expect(() => mapLegacyAddons('reading', 'addons', { mouth: 'unknown' })).toThrow();
  expect(() => mapLegacyAddons('reading', 'addons', { mouth: { state: 'open', dx: Infinity } })).toThrow();
});
it('layer visibility/removal retains slot state and Undo without resurrecting a deleted visible slot on edit', () => {
  const store = new AnimationStore(); store.beginFacePreview(); store.commitFacePreview();
  store.editLayer('native-face-mouth', { visible: false }); expect(store.frame.nativeFace!.slots.mouth.visible).toBe(false);
  store.undo(); expect(store.frame.nativeFace!.slots.mouth.visible).toBe(true);
  store.removeLayer('native-face-leftEye'); expect(store.frame.nativeFace!.slots.leftEye.visible).toBe(false);
  store.beginFacePreview(); expect(store.displayFrame.layers.find((l) => l.id === 'native-face-leftEye')!.visible).toBe(false);
  store.cancelFacePreview(); store.undo(); expect(store.frame.nativeFace!.slots.leftEye.visible).toBe(true);
});
it('unchanged native face editing/commit does not invalidate the saved baseline or create a redundant history entry', () => {
  const store = new AnimationStore(); store.beginFacePreview(); store.commitFacePreview(); store.markSaved(store.captureContent());
  const frame = store.frame, past = store.past.length;
  store.beginFacePreview(); store.commitFacePreview();
  expect(store.frame).toBe(frame); expect(store.dirty).toBe(false); expect(store.past).toHaveLength(past);
});
it('a user layer with a reserved-looking ID is preserved; native slots have explicit markers and collision-free IDs', () => {
  const store = new AnimationStore();
  const user = { ...blankLayer('native-face-leftEye', 'User artwork'), pixels: new Map([[0, 0x12345678]]) };
  store.editFrame({ ...store.frame, layers: [...store.frame.layers, user] });
  store.beginFacePreview(); store.commitFacePreview();
  expect(store.frame.layers.find((l) => l.id === user.id)).toBe(user);
  expect(store.frame.layers.find((l) => l.nativeFaceSlot === 'leftEye')!.id).toBe('native-face-leftEye-2');
  const json = serializeSession(store), loaded = new AnimationStore(); restoreSession(loaded, json);
  expect(serializeSession(loaded)).toBe(json);
  loaded.retargetFacePose('reading', 0, 0);
  expect(loaded.frame.layers.find((l) => l.id === user.id)!.pixels).toEqual(user.pixels);
  loaded.source('fino-sleeping-128'); expect(loaded.frame.layers.find((l) => l.id === user.id)!.pixels).toEqual(user.pixels);
});
it('all V1/V2 eye and mouth states map for every native target without equating rig families', () => {
  for (const version of [1, 2] as const) for (const pose of NATIVE_POSES) {
    for (const state of EYE_VARIANTS) expect(mapLegacyFace(version, pose.id,
      { rightEye: { state, x: 0, y: 0, width: 44, height: 40 } }).face.slots.rightEye.variant).toBe(state);
    for (const state of MOUTH_VARIANTS) expect(mapLegacyFace(version, pose.id,
      { mouth: { state, x: 0, y: 0, width: version === 1 ? 173 : 116, height: version === 1 ? 100 : 78 } }).face.family).toBe(`legacy-v${version}`);
  }
});
