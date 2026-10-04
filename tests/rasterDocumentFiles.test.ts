import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import v1 from './fixtures/raster-session-v1.json';
import { AnimationStore } from '../src/animation/store';
import { exportPng, exportRasterDocument, importRasterDocument, serializeSession } from '../src/animation/files';
import { decodePng } from '../src/animation/png';
import { production, Viewport } from '../src/animation/raster';

const native = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false), getPlatform: vi.fn(() => 'web'),
  saveFile: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: native.isNativePlatform, getPlatform: native.getPlatform },
  registerPlugin: () => ({ saveFile: native.saveFile, writeFile: native.writeFile }),
}));
let store: AnimationStore;
let download: Blob | undefined;
const anchor = { href: '', download: '', style: { display: '' }, click: vi.fn(), remove: vi.fn() };
const revokeUrl = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  native.isNativePlatform.mockReturnValue(false); native.getPlatform.mockReturnValue('web');
  native.saveFile.mockReset(); native.writeFile.mockReset();
  download = undefined;
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
  vi.stubGlobal('window', { setTimeout: (fn: () => void) => { fn(); return 0; } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { download = blob as Blob; return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeUrl);
  store = new AnimationStore();
});
afterEach(() => { store.pause(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function importV1() { await importRasterDocument(store, new Blob([JSON.stringify(v1)])); }
function android() { native.isNativePlatform.mockReturnValue(true); native.getPlatform.mockReturnValue('android'); }

it('browser exports a complete V2 document and imports it without content loss', async () => {
  await importV1();
  store.addLayer(); store.addFrame(true);
  store.setDocumentMetadata({ id: 'portable-id', reactionState: 'happy',
    provenance: { kind: 'legacy', archiveId: 'archive-id', fileName: 'original.finoanim.json' },
    legacy: { formatVersion: 1, rigVersion: 2, basePose: 'reading', addonRoot: 'addons_normalized' },
    migration: { reportVersion: 1, stage: 'assessment', report: { issues: [{ code: 'blocked' }], migrationPerformed: false } },
  });
  const expected = serializeSession(store), content = store.captureContent(), past = store.past;
  expect(store.dirty).toBe(true);
  expect(await exportRasterDocument(store)).toEqual({ name: `${v1.name}.raster128.json`, uri: null });
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(revokeUrl).toHaveBeenCalledWith('blob:test');
  expect(download!.type).toBe('application/json');
  expect(await download!.text()).toBe(expected);
  expect(store.captureContent()).toEqual(content); expect(store.past).toBe(past); expect(store.dirty).toBe(true);
  expect(await importRasterDocument(store, download!)).toBe('imported');
  expect(serializeSession(store)).toBe(expected);
  expect(store.state.frames).toHaveLength(3); expect(store.state.frames[1]!.layers).toHaveLength(2);
  expect(store.templates).toHaveLength(1); expect(store.faces).toHaveLength(1);
  expect(store.state.index).toBe(0); expect(store.dirty).toBe(false);
  expect(store.past).toHaveLength(0); expect(store.future).toHaveLength(0);
});

it('V1 import establishes a clean baseline, then exports V2 without dirtying it', async () => {
  store.duration(999); expect(store.dirty).toBe(true);
  await importV1(); expect(store.dirty).toBe(false);
  const id = store.state.metadata.id;
  await exportRasterDocument(store);
  const data = JSON.parse(await download!.text()) as Record<string, unknown>;
  expect(data.version).toBe(2);
  expect(data.metadata).toEqual({ id, provenance: { kind: 'raster-v1', sourceId: 'empty' } });
  expect(data).not.toHaveProperty('index'); expect(data).not.toHaveProperty('active');
  expect(store.dirty).toBe(false);
});

it('successful import clears old document selections and playback while retaining viewport and tool', async () => {
  await importV1();
  store.referenceSelected = true; store.selection = new Set([386]); store.selectTool('pan');
  store.viewport = new Viewport(15, 20, 3);
  const viewport = store.viewport;
  const playbackDocument = store.capturePlaybackDocument();
  store.play();
  await importRasterDocument(store, new Blob([serializeSession(store)]));
  expect(store.selection).toBeNull(); expect(store.referenceSelected).toBe(false);
  expect(store.playing).toBe(false); expect(store.capturePlaybackDocument()).not.toBe(playbackDocument);
  expect(store.tool).toBe('pan'); expect(store.viewport).toBe(viewport);
  expect(store.dirty).toBe(false);
});

it.each([
  '{', JSON.stringify({ ...v1, version: 3 }), JSON.stringify({ ...v1, frames: [] }),
  JSON.stringify({ ...v1, frames: [{ duration: 0, layers: [] }] }),
  JSON.stringify({ ...v1, frames: [{ duration: 1, layers: [{ ...v1.frames[0]!.layers[0], visible: 'yes' }] }] }),
  JSON.stringify({ ...v1, frames: [{ duration: 1, layers: [{ ...v1.frames[0]!.layers[0], pixels: [[16384, 1]] }] }] }),
  JSON.stringify({ ...v1, templates: [{ ...v1.templates[0], bounds: { x: 0.5, y: 0, width: 1, height: 1 } }] }),
  JSON.stringify({ ...v1, faces: null }), JSON.stringify({ ...v1, reference: { ...v1.reference, aligned: 1 } }),
  JSON.stringify({ ...v1, reference: { ...v1.reference, bounds: { x: 0, y: 0, width: -1, height: 1 } } }),
  JSON.stringify({ version: 1, name: 'Legacy', basePose: 'reading', frames: [] }),
])('invalid portable data is rejected atomically: %s', async (json) => {
  await importV1(); store.duration(250); store.play();
  const state = store.state, past = store.past, collections = [store.templates, store.faces], session = store.captureContent();
  await expect(importRasterDocument(store, new Blob([json]))).rejects.toThrow();
  expect(store.state).toBe(state); expect(store.past).toBe(past);
  expect([store.templates, store.faces]).toEqual(collections);
  expect(store.isCurrentSession(session)).toBe(true); expect(store.playing).toBe(true); expect(store.dirty).toBe(true);
});

it('import cancellation and read failure leave content, playback and lifecycle untouched', async () => {
  await importV1(); store.duration(250); store.play();
  const content = store.captureContent();
  expect(await importRasterDocument(store, null)).toBe('cancelled');
  const file = new Blob(); vi.spyOn(file, 'text').mockRejectedValue(new Error('Read failed'));
  await expect(importRasterDocument(store, file)).rejects.toThrow('Read failed');
  expect(store.captureContent()).toEqual(content); expect(store.playing).toBe(true); expect(store.dirty).toBe(true);
});

it('a delayed file read cannot replace a newer session or a later successful import', async () => {
  let finish!: (json: string) => void;
  const file = new Blob(); vi.spyOn(file, 'text').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = importRasterDocument(store, file);
  await importV1();
  const session = store.captureContent(); finish(JSON.stringify({ ...v1, name: 'Old read' }));
  expect(await pending).toBe('stale'); expect(store.captureContent()).toEqual(session); expect(store.dirty).toBe(false);
});

it.each(['success', 'cancel', 'failure', 'missing-uri'])('Android JSON export uses the existing native bridge (%s) without changing saved state', async (outcome) => {
  await importV1(); store.duration(250); android();
  store.setDocumentMetadata({ ...store.state.metadata, reactionState: 'Glücklich 🦊' });
  const json = serializeSession(store), content = store.captureContent();
  if (outcome === 'failure') native.saveFile.mockRejectedValue(new Error('Write failed'));
  else native.saveFile.mockResolvedValue(outcome === 'cancel' ? { cancelled: true } : outcome === 'missing-uri' ? {} :
    { uri: 'content://documents/raster', name: 'native.raster128.json' });
  const task = exportRasterDocument(store);
  if (outcome === 'success') expect(await task).toEqual({ uri: 'content://documents/raster', name: 'native.raster128.json' });
  else if (outcome === 'cancel') expect(await task).toBeNull();
  else await expect(task).rejects.toThrow();
  expect(native.saveFile).toHaveBeenCalledWith({ fileName: `${v1.name}.raster128.json`, mimeType: 'application/json', base64: Buffer.from(json).toString('base64') });
  expect(store.captureContent()).toEqual(content); expect(store.dirty).toBe(true);
  expect(anchor.click).not.toHaveBeenCalled(); expect(native.writeFile).not.toHaveBeenCalled();
});

it('Browser download failure propagates and export filename never uses the Legacy suffix', async () => {
  store.commit({ ...store.state, name: 'Name:/with?invalid' });
  anchor.click.mockImplementationOnce(() => { throw Error('Download failed'); });
  const before = store.captureContent();
  await expect(exportRasterDocument(store)).rejects.toThrow('Download failed');
  expect(store.captureContent()).toEqual(before);
  expect(anchor.download).toBe('Name__with_invalid.raster128.json');
});

it('Android-selected File/Blob imports through the same V1/V2 parser without native writes', async () => {
  android(); await importV1();
  const json = serializeSession(store);
  expect(await importRasterDocument(store, new File([json], 'Android.raster128.json', { type: 'application/json' }))).toBe('imported');
  expect(serializeSession(store)).toBe(json); expect(store.dirty).toBe(false);
  expect(native.saveFile).not.toHaveBeenCalled(); expect(native.writeFile).not.toHaveBeenCalled();
});

it('PNG remains a 1024x1024 exact nearest-neighbor export without session save side effects', async () => {
  await importV1(); store.duration(250);
  const content = store.captureContent();
  await exportPng(store.frame, store.state.name);
  expect(anchor.download).toBe(`${v1.name}-1024.png`); expect(download!.type).toBe('image/png');
  const image = decodePng(new Uint8Array(await download!.arrayBuffer()));
  expect([image.width, image.height]).toEqual([1024, 1024]);
  expect(Buffer.from(image.rgba).equals(Buffer.from(production(store.frame.layers)))).toBe(true);
  expect(store.captureContent()).toEqual(content); expect(store.dirty).toBe(true);
});
