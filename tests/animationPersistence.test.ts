import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnimationStore, Stroke } from '../src/animation/store';
import { Viewport } from '../src/animation/raster';
import { newRasterOperation } from '../src/animation/rasterOperations';
import { exportPng, importRasterDocument, parseRasterDocument, restoreSession, saveRasterSession, serializeSession } from '../src/animation/files';

vi.mock('../src/platform/nativeFileDialog', () => ({ saveBlobAs: vi.fn().mockResolvedValue({ name: 'export.png', uri: null }) }));

const transactions: {
  json?: string;
  name?: string;
  error: Error | null;
  oncomplete: () => void;
  onerror: () => void;
  onabort: () => void;
}[] = [];
const openDatabase = vi.fn();
const storedRows = new Map<string, string>();
let store: AnimationStore;
beforeEach(() => {
  transactions.length = 0;
  storedRows.clear();
  openDatabase.mockReset();
  vi.stubGlobal('indexedDB', {
    open: openDatabase.mockImplementation(() => {
      const request = {
        onsuccess: () => {},
        result: {
          close: vi.fn(),
          transaction: () => {
            const staged = new Map<string, string>();
            const tx = {
              error: null as Error | null,
              oncomplete: () => {}, onerror: () => {}, onabort: () => {},
              abort: () => tx.onabort(),
              objectStore: (name: string) => name === 'builder_metadata' ? { put() {}, delete() {} } : ({
                put: (json: string, name: string) => {
                  staged.set(name, json);
                  if (!name.startsWith('__builder_revision_v1:')) Object.assign(tx, { json, name });
                },
                get: (key: string) => { const read = { result: storedRows.get(key), onsuccess: () => {} }; queueMicrotask(() => read.onsuccess()); return read; },
                delete: (name: string) => storedRows.delete(name),
              }),
            };
            let complete = () => {};
            Object.defineProperty(tx, 'oncomplete', { get: () => complete, set: (callback: () => void) => {
              complete = () => { for (const [key, value] of staged) storedRows.set(key, value); callback(); };
            } });
            transactions.push(tx);
            return tx;
          },
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    }),
  });
  store = new AnimationStore();
  store.source('empty');
  new Stroke(store, { x: 2, y: 3 }, false).commit();
  store.markSaved(store.captureContent());
});
afterEach(() => { store.pause(false); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function pending() {
  const task = saveRasterSession(store);
  await vi.waitFor(() => expect(transactions).toHaveLength(1));
  return { task, tx: transactions[0]! };
}

it('native face changes during an asynchronous save stay dirty, unchanged face saves become clean', async () => {
  store.source('fino-standing-neutral-128'); store.beginFacePreview(); store.commitFacePreview();
  const first = await pending(); const savedJson = first.tx.json;
  store.beginFacePreview(); store.previewFaceSlot('mouth', { variant: 'open' }); store.commitFacePreview();
  first.tx.oncomplete(); expect(await first.task).toBe('changed'); expect(store.dirty).toBe(true);
  expect(parseRasterDocument(savedJson!).state.frames[0]!.nativeFace!.slots.mouth.variant).toBe('neutral');
  transactions.length = 0; const next = await pending(); next.tx.oncomplete();
  expect(await next.task).toBe('saved'); expect(store.dirty).toBe(false);
});
it('recipe-only changes during save stay dirty; unchanged recipes and UI selection save clean', async () => {
  const a = newRasterOperation({ type: 'moveRegion', rect: { x: 2, y: 3, width: 1, height: 1 }, dx: 0, dy: 0 });
  store.applyNativeOperation(a, true);
  const first = await pending();
  const b = newRasterOperation({ type: 'moveRegion', rect: { x: 2, y: 3, width: 1, height: 1 }, dx: 0, dy: 0 });
  store.applyNativeOperation(b, true); first.tx.oncomplete();
  expect(await first.task).toBe('changed'); expect(store.dirty).toBe(true);
  expect(parseRasterDocument(first.tx.json!).state.frames[0]!.layers[0]!.recipe!.operations).toHaveLength(1);
  transactions.length = 0; const next = await pending(); store.setSelection(new Set([0])); store.selectTool('pencil');
  next.tx.oncomplete(); expect(await next.task).toBe('saved'); expect(store.dirty).toBe(false);
});

it.each([false, true])('creating a template/face (face=%s) is dirty without a history entry', (face) => {
  const past = store.past.length;
  expect(store.dirty).toBe(false);
  expect(store.saveAsset('Asset', face)).not.toBeNull();
  expect(store.dirty).toBe(true);
  expect(store.past).toHaveLength(past);
});

it.each([false, true])('renaming/deleting collections is dirty outside frame history (face=%s)', (face) => {
  const asset = store.saveAsset('Asset', face)!;
  store.markSaved(store.captureContent());
  const past = store.past.length;
  store.renameAsset(asset.id, 'Renamed', face);
  expect(store.dirty).toBe(true);
  expect((face ? store.faces : store.templates)[0]!.name).toBe('Renamed');
  store.markSaved(store.captureContent());
  store.deleteAsset(asset.id, face);
  expect(store.dirty).toBe(true);
  expect(face ? store.faces : store.templates).toHaveLength(0);
  expect(store.past).toHaveLength(past);
});

it.each(['frames', 'name', 'source', 'reference'] as const)('document %s changes are dirty', (kind) => {
  if (kind === 'frames') store.duration(250);
  if (kind === 'name') store.commit({ ...store.state, name: 'Renamed animation' });
  if (kind === 'source') store.source('dev-reference-128');
  if (kind === 'reference') store.setReference({ name: 'Reference', width: 1, height: 1,
    rgba: new Uint8Array([1, 2, 3, 255]), bounds: { x: 0, y: 0, width: 1, height: 1 }, aligned: true, visible: true });
  expect(store.dirty).toBe(true);
});

it('unchanged completed save marks the written content clean', async () => {
  store.duration(250);
  const { task, tx } = await pending();
  expect(store.dirty).toBe(true);
  expect(JSON.parse(tx.json!) as unknown).toEqual(JSON.parse(serializeSession(store)) as unknown);
  tx.oncomplete();
  expect(await task).toBe('saved');
  expect(store.dirty).toBe(false);
});

it.each(['document', 'template', 'face', 'metadata'] as const)('%s changes during a save stay dirty', async (kind) => {
  store.duration(250);
  const { task, tx } = await pending();
  const written = tx.json!;
  if (kind === 'document') store.duration(300);
  else if (kind === 'metadata') store.setDocumentMetadata({ ...store.state.metadata, reactionState: 'happy' });
  else store.saveAsset('Created during write', kind === 'face');
  tx.oncomplete();
  expect(await task).toBe('changed');
  expect(store.dirty).toBe(true);
  const restored = new AnimationStore();
  restoreSession(restored, written);
  expect(restored.frame.duration).toBe(250);
  expect(restored.templates).toHaveLength(0);
  expect(restored.faces).toHaveLength(0);
  expect(restored.state.metadata.reactionState).toBeUndefined();
});

it('unchanged metadata save becomes clean and its immutable baseline survives caller mutation', async () => {
  const metadata = { ...store.state.metadata, reactionState: 'happy' };
  store.setDocumentMetadata(metadata);
  const { task, tx } = await pending();
  metadata.reactionState = 'sad';
  tx.oncomplete();
  expect(await task).toBe('saved');
  expect(store.state.metadata.reactionState).toBe('happy');
  expect(store.dirty).toBe(false);
  expect(openDatabase).toHaveBeenCalledWith('northcore-animation-builder', 2);
});

it('a new document gets a fresh identity and ignores an old save completion', async () => {
  const id = store.state.metadata.id;
  const { task, tx } = await pending();
  store.newAnimation('New', 'empty', false);
  expect(store.state.metadata.id).not.toBe(id);
  tx.oncomplete();
  expect(await task).toBe('stale');
  expect(store.dirty).toBe(true);
});

it.each(['onerror', 'onabort'] as const)('%s does not mark saved and releases the save lock', async (event) => {
  store.duration(250);
  store.setDocumentMetadata({ ...store.state.metadata, reactionState: 'unsaved' });
  const { task, tx } = await pending();
  const failed = expect(task).rejects.toThrow();
  tx.error = new Error('Controlled write failure');
  tx[event]();
  await failed;
  expect(store.dirty).toBe(true);
  const retry = saveRasterSession(store);
  await vi.waitFor(() => expect(transactions).toHaveLength(2));
  transactions[1]!.oncomplete();
  expect(await retry).toBe('saved');
});

it('restore replaces document and collections and establishes the clean baseline', () => {
  store.saveAsset('Template', false); store.saveAsset('Face', true);
  store.duration(250);
  const json = serializeSession(store);
  store.deleteAsset(store.templates[0]!.id);
  restoreSession(store, json);
  expect(store.frame.duration).toBe(250);
  expect(store.templates.map((a) => a.name)).toEqual(['Template']);
  expect(store.faces.map((a) => a.name)).toEqual(['Face']);
  expect(store.dirty).toBe(false);
  expect(store.past).toHaveLength(0);
  expect(store.future).toHaveLength(0);
  store.renameAsset(store.templates[0]!.id, 'After restore');
  expect(store.dirty).toBe(true);
});

it.each(['success', 'failure'] as const)('restore during a save ignores its stale %s', async (outcome) => {
  const json = serializeSession(store);
  store.duration(250);
  const { task, tx } = await pending();
  restoreSession(store, json);
  store.saveAsset('New session collection', false);
  if (outcome === 'success') tx.oncomplete();
  else { tx.error = new Error('Old session failure'); tx.onerror(); }
  expect(await task).toBe('stale');
  expect(store.dirty).toBe(true);
  expect(store.frame.duration).toBe(400);
});

it('undo/redo leave unsaved collections intact and dirty', () => {
  store.duration(250);
  store.saveAsset('Unsaved template', false); store.saveAsset('Unsaved face', true);
  const collections = [store.templates, store.faces];
  store.undo();
  expect(store.frame.duration).toBe(400);
  expect(store.dirty).toBe(true);
  store.redo();
  expect(store.frame.duration).toBe(250);
  expect(store.dirty).toBe(true);
  expect([store.templates, store.faces]).toEqual(collections);
});

it('undo to the saved document is clean and redo is dirty', () => {
  store.duration(250); store.undo();
  expect(store.dirty).toBe(false);
  store.redo();
  expect(store.dirty).toBe(true);
});

it('navigation, selection, tools, playback and viewport do not dirty or invalidate a save', async () => {
  store.addFrame(true);
  store.markSaved(store.captureContent());
  const { task, tx } = await pending();
  vi.useFakeTimers();
  store.frameAt(0); store.selectLayer('other-layer'); store.setSelection(new Set([386]));
  store.selectTool('pan'); store.viewport = new Viewport(15, 20, 3); store.emit();
  store.play(); vi.advanceTimersByTime(850); store.pause();
  expect(store.dirty).toBe(false);
  tx.oncomplete();
  expect(await task).toBe('saved');
  expect(store.dirty).toBe(false);
});

it('parallel saves are ignored and subsequent saves write the newer version', async () => {
  store.duration(250);
  const { task, tx } = await pending();
  store.duration(300);
  expect(await saveRasterSession(store)).toBe('busy');
  expect(transactions).toHaveLength(1);
  tx.oncomplete(); expect(await task).toBe('changed');
  const next = saveRasterSession(store);
  await vi.waitFor(() => expect(transactions).toHaveLength(2));
  transactions[1]!.oncomplete();
  expect(await next).toBe('saved');
  const restored = new AnimationStore(); restoreSession(restored, transactions[1]!.json!);
  expect(restored.frame.duration).toBe(300);
});

it('PNG export does not mark a session saved', async () => {
  store.saveAsset('Unsaved', false);
  await exportPng(store.frame, store.state.name);
  expect(store.dirty).toBe(true);
});

it.each(['oncomplete', 'onerror', 'onabort'] as const)('portable import invalidates an old local save (%s), even with the same document ID', async (event) => {
  const json = serializeSession(store);
  const id = store.state.metadata.id;
  store.duration(250);
  const { task, tx } = await pending();
  expect(await importRasterDocument(store, new Blob([json]))).toBe('imported');
  expect(store.state.metadata.id).toBe(id);
  expect(store.frame.duration).toBe(400);
  expect(store.dirty).toBe(false);
  tx[event]();
  expect(await task).toBe('stale');
  expect(store.frame.duration).toBe(400);
  expect(store.dirty).toBe(false);
});
