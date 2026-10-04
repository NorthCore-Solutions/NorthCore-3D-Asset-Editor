import { expect, it, vi } from 'vitest';
import { GlobalTemplateLibrary, applyGlobalTemplate, saveGlobalSelection, exportGlobalLibrary, importGlobalLibrary } from '../src/animation/globalTemplateLibrary';
import type { GlobalLibraryStorage } from '../src/animation/globalTemplateLibrary';
import { emptyGlobalLibrary, parseGlobalLibrary } from '../src/animation/globalTemplateFormat';
import type { GlobalTemplate } from '../src/animation/globalTemplateFormat';
import { AnimationStore } from '../src/animation/store';
import { restoreSession, serializeSession } from '../src/animation/files';
import { canonicalJson } from '../src/animation/contentHash';
import { rectMask } from '../src/animation/raster';

const platform = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../src/platform/nativeFileDialog', () => ({ saveBlobAs: platform.save }));
function deferred<T>() { let resolve!: (v: T) => void; return { promise: new Promise<T>((r) => { resolve = r; }), resolve }; }
const template = (id = 'native', name = 'Native'): GlobalTemplate => ({ id, name, width: 3, height: 2, origin: { x: 4, y: 5 }, pixels: [[1, 0x12345601]] });
function memory(initial?: string) {
  let json = initial;
  const writes: string[] = [];
  const persistence: GlobalLibraryStorage = { read: vi.fn(() => Promise.resolve(json)), write: vi.fn((value: string) => { writes.push(value); json = value; return Promise.resolve(); }) };
  return { persistence, writes, get json() { return json; } };
}
it('automatic writes are sequential, retain each immutable snapshot and stay pending until the latest completes', async () => {
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()], writes: string[] = [];
  let running = 0, maximum = 0;
  const lib = new GlobalTemplateLibrary({ read: () => Promise.resolve(undefined), write: async (json) => {
    const i = writes.length; writes.push(json); running++; maximum = Math.max(maximum, running); await gates[i]!.promise; running--;
  } });
  await lib.load(); lib.add(template()); lib.rename('native', 'Renamed'); lib.remove('native');
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  expect(lib.dirty).toBe(true); expect(lib.status).toBe('pending');
  gates[0]!.resolve(); await vi.waitFor(() => expect(writes).toHaveLength(2)); expect(lib.dirty).toBe(true);
  gates[1]!.resolve(); await vi.waitFor(() => expect(writes).toHaveLength(3)); gates[2]!.resolve(); await lib.settled();
  expect(maximum).toBe(1); expect(writes.map((s) => parseGlobalLibrary(s).templates.map((t) => t.name))).toEqual([['Native'], ['Renamed'], []]);
  expect(lib.dirty).toBe(false); expect(lib.status).toBe('saved');
});
it('write errors remain dirty and visible; retry persists the latest value without extra concurrent writes', async () => {
  const disk = memory(); let failed = true;
  const lib = new GlobalTemplateLibrary({ read: disk.persistence.read, write: async (json) => { if (failed) throw Error('Quota exceeded'); await disk.persistence.write(json); } });
  await lib.load(); lib.add(template()); await lib.settled();
  expect(lib.status).toBe('failed'); expect(lib.error).toBe('Quota exceeded'); expect(lib.dirty).toBe(true);
  failed = false; await lib.retry();
  expect(lib.status).toBe('saved'); expect(lib.error).toBeNull(); expect(lib.dirty).toBe(false);
  expect(parseGlobalLibrary(disk.json!).templates[0]!.name).toBe('Native');
});
it('late initial load rebases local additions, renames and deletions without losing stored entries', async () => {
  const gate = deferred<string | undefined>(), disk = memory();
  const lib = new GlobalTemplateLibrary({ read: () => gate.promise, write: disk.persistence.write });
  const loading = lib.load(); lib.add(template('local', 'Local')); lib.rename('local', 'Edited while loading');
  lib.add(template('removed', 'Removed')); lib.remove('removed');
  expect(disk.writes).toHaveLength(0);
  gate.resolve(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('old', 'Stored')] }));
  await loading; await lib.settled();
  expect(lib.templates.map((t) => t.name)).toEqual(['Stored', 'Edited while loading']);
  expect(disk.writes).toHaveLength(1); expect(lib.dirty).toBe(false);
});
it('failed initial read never overwrites unknown persisted data and can retry with buffered edits', async () => {
  let failed = true; const disk = memory(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('old', 'Stored')] }));
  const lib = new GlobalTemplateLibrary({ read: () => failed ? Promise.reject(Error('Read failed')) : Promise.resolve(disk.json), write: disk.persistence.write });
  lib.add(template()); await lib.settled();
  expect(lib.status).toBe('failed'); expect(lib.dirty).toBe(true); expect(disk.writes).toHaveLength(0);
  failed = false; await lib.retry(); await lib.settled();
  expect(lib.templates).toHaveLength(2); expect(lib.dirty).toBe(false);
});
it('late initial ID collisions rebase subsequent local rename/delete onto the right templates', async () => {
  const gate = deferred<string | undefined>(), disk = memory();
  const lib = new GlobalTemplateLibrary({ read: () => gate.promise, write: disk.persistence.write });
  lib.add(template()); lib.add(template()); lib.rename('native', 'Local renamed'); lib.remove('native (2)');
  gate.resolve(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('native', 'Stored')] }));
  await lib.settled();
  expect(lib.templates.map((t) => [t.id, t.name])).toEqual([['native', 'Stored'], ['native (2)', 'Local renamed']]);
});
it('a validated explicit backup can repair corrupt storage without bypassing validation', async () => {
  const disk = memory('{'), lib = new GlobalTemplateLibrary(disk.persistence);
  await lib.load(); expect(lib.status).toBe('failed'); expect(disk.writes).toHaveLength(0);
  await lib.importJson(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template()] })); await lib.settled();
  expect(lib.status).toBe('saved'); expect(lib.dirty).toBe(false); expect(parseGlobalLibrary(disk.json!).templates).toHaveLength(1);
});
it('global changes and delayed writes survive document Neu/Laden without altering document baseline or frame history', async () => {
  const gate = deferred<void>(), lib = new GlobalTemplateLibrary({ read: () => Promise.resolve(undefined), write: () => gate.promise });
  const store = new AnimationStore(), original = serializeSession(store), baseline = store.captureContent();
  await lib.load(); lib.add(template());
  expect(store.dirty).toBe(false); expect(store.past).toHaveLength(0); expect(store.captureContent()).toEqual(baseline);
  store.newAnimation('Other', 'empty', false); restoreSession(store, original);
  const session = store.captureContent(); gate.resolve(); await lib.settled();
  expect(store.captureContent()).toEqual(session); expect(store.dirty).toBe(false); expect(store.past).toHaveLength(0);
  expect(lib.templates).toHaveLength(1); expect(lib.dirty).toBe(false);
});
it('saving a global selection preserves its transparent bounds and never adds document collections/history', async () => {
  const disk = memory(), lib = new GlobalTemplateLibrary(disk.persistence), store = new AnimationStore();
  store.newAnimation('Selection', 'empty', false); store.pixels(store.editable!, new Map([[5 * 128 + 5, 0x12345600]]));
  store.setSelection(rectMask({ x: 4, y: 4 }, { x: 7, y: 6 })); store.markSaved(store.captureContent());
  const history = store.past.length; expect(saveGlobalSelection(store, lib, 'Selection')).toBe(true); await lib.settled();
  expect(lib.templates[0]).toMatchObject({ width: 4, height: 3, origin: { x: 4, y: 4 }, pixels: [[129, 0x12345600]] });
  expect(store.past).toHaveLength(history); expect(store.dirty).toBe(false); expect(store.templates).toEqual([]);
});
it('applying a global template retains holes and padded borders with one normal pixel commit', () => {
  const store = new AnimationStore(); store.newAnimation('Apply', 'empty', false); const before = store.past.length;
  applyGlobalTemplate(store, template(), { x: 10, y: 20, width: 3, height: 2 });
  expect(store.layer!.pixels).toEqual(new Map([[20 * 128 + 11, 0x12345601]]));
  expect(store.selectionBounds()).toEqual({ x: 10, y: 20, width: 3, height: 2 }); expect(store.past).toHaveLength(before + 1);
  store.undo(); expect(store.layer!.pixels.size).toBe(0);
});
it.each(['{', JSON.stringify({ ...emptyGlobalLibrary(), version: 2 }), JSON.stringify({ ...emptyGlobalLibrary(), templates: [template(), template()] })])('invalid backup is rejected before mutation: %s', async (json) => {
  const lib = new GlobalTemplateLibrary(memory().persistence); await lib.load(); lib.add(template()); await lib.settled(); const before = lib.exportJson();
  await expect(lib.importJson(json)).rejects.toThrow(); expect(lib.exportJson()).toBe(before); expect(lib.dirty).toBe(false);
});
it('file read failure preserves the library; explicit empty backup during loading replaces only global data', async () => {
  const lib = new GlobalTemplateLibrary(memory(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template()] })).persistence);
  await expect(importGlobalLibrary(lib, { text: () => Promise.reject(Error('Read failed')) })).rejects.toThrow('Read failed');
  await lib.importJson(JSON.stringify(emptyGlobalLibrary())); await lib.settled(); expect(lib.templates).toEqual([]); expect(lib.dirty).toBe(false);
});
it('export cancellation/failure never marks pending library data saved', async () => {
  const gate = deferred<void>(), lib = new GlobalTemplateLibrary({ read: () => Promise.resolve(undefined), write: () => gate.promise });
  await lib.load(); lib.add(template());
  platform.save.mockResolvedValueOnce(null); await exportGlobalLibrary(lib); expect(lib.dirty).toBe(true);
  platform.save.mockRejectedValueOnce(Error('Export failed')); await expect(exportGlobalLibrary(lib)).rejects.toThrow('Export failed'); expect(lib.dirty).toBe(true);
  gate.resolve(); await lib.settled();
});
it('backup export waits for initial data and includes buffered local edits', async () => {
  const gate = deferred<string | undefined>(), lib = new GlobalTemplateLibrary({ read: () => gate.promise, write: () => Promise.resolve() });
  const before = platform.save.mock.calls.length; lib.add(template('local', 'Local'));
  platform.save.mockResolvedValueOnce(null); const exportTask = exportGlobalLibrary(lib);
  expect(platform.save.mock.calls).toHaveLength(before);
  gate.resolve(JSON.stringify({ ...emptyGlobalLibrary(), templates: [template('stored', 'Stored')] }));
  await exportTask;
  const blob = platform.save.mock.calls.at(-1)![0] as Blob;
  expect(parseGlobalLibrary(await blob.text()).templates.map((t) => t.name)).toEqual(['Stored', 'Local']);
});
it('failed initial read cannot produce a misleading empty backup', async () => {
  const lib = new GlobalTemplateLibrary({ read: () => Promise.reject(Error('Read unavailable')), write: () => Promise.resolve() });
  const before = platform.save.mock.calls.length;
  await expect(exportGlobalLibrary(lib)).rejects.toThrow('Read unavailable'); expect(platform.save.mock.calls).toHaveLength(before);
});
it('document templates still serialize and restore independently of global collections', async () => {
  const store = new AnimationStore(); store.templates = [{ id: 'document', name: 'Document', pixels: new Map([[129, 0xffffffff]]), bounds: { x: 1, y: 1, width: 1, height: 1 } }];
  store.resetSavedContent(); const original = serializeSession(store), lib = new GlobalTemplateLibrary(memory().persistence);
  lib.add(template()); await lib.settled(); const other = new AnimationStore(); restoreSession(other, original);
  expect(canonicalJson(JSON.parse(serializeSession(other)))).toBe(canonicalJson(JSON.parse(original)));
  expect(other.templates.map((t) => t.name)).toEqual(['Document']); expect(lib.templates.map((t) => t.name)).toEqual(['Native']);
});
