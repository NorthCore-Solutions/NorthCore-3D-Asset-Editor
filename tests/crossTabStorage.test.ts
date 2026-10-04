import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionClient, sameSessionRecord, StorageConflictError } from '../src/animation/storage';
import type { SessionClient, SessionStorage } from '../src/animation/storage';
import { GlobalTemplateLibrary, globalLibraryStorage } from '../src/animation/globalTemplateLibrary';
import { parseGlobalLibrary } from '../src/animation/globalTemplateFormat';
import { AnimationStore } from '../src/animation/store';
import { loadRasterSession, saveRasterSession, serializeSession, watchRasterStorage } from '../src/animation/files';

class Memory implements SessionStorage {
  rows = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  run<T>(change: (entries: Map<string, string>) => T): Promise<T> {
    const task = this.queue.then(() => { const draft = new Map(this.rows), result = change(draft); this.rows = draft; return result; });
    this.queue = task.then(() => {}, () => {}); return task;
  }
}
function deferred() { let resolve!: () => void; return { promise: new Promise<void>((r) => { resolve = r; }), resolve }; }
const clients: SessionClient[] = [], libraries: GlobalTemplateLibrary[] = [];
function client(memory: SessionStorage) { const result = createSessionClient(memory); clients.push(result); return result; }
class Channel {
  static instances = new Set<Channel>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  constructor() { Channel.instances.add(this); }
  postMessage(data: unknown) { for (const other of Channel.instances) if (other !== this) queueMicrotask(() => other.onmessage?.({ data } as MessageEvent<unknown>)); }
  close() { Channel.instances.delete(this); }
}
beforeEach(() => {
  const window = new EventTarget();
  Object.assign(window, { localStorage: { setItem: (key: string, newValue: string) => {
    window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
  } } });
  vi.stubGlobal('window', window); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('BroadcastChannel', Channel);
});
afterEach(() => { libraries.splice(0).forEach((lib) => lib.dispose()); clients.splice(0).forEach((c) => c.close()); vi.unstubAllGlobals(); });
const item = (id: string) => ({ id, name: id, width: 1, height: 1, origin: { x: 0, y: 0 }, pixels: [[0, 0x12345601] as [number, number]] });

it('only one concurrent write from the same base succeeds, and independent keys do not conflict', async () => {
  const disk = new Memory(), a = client(disk), b = client(disk);
  const [aa, bb] = await Promise.all([a.read('document'), b.read('document')]);
  const results = await Promise.allSettled([a.write('document', 'A', aa), b.write('document', 'B', bb)]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(await a.read('document')).toMatchObject({ value: 'A', revision: { sequence: 1 } });
  await Promise.all([a.write('other-A', 'A'), b.write('other-B', 'B')]);
  expect((await a.query({ kind: 'raster' })).items).toHaveLength(3); expect((await a.query({ kind: 'raster' })).items.map((meta) => meta.key)).not.toContain('__builder_revision_v1:document');
});
it('a delayed old write fails after a newer foreign write; retry needs an explicit new basis', async () => {
  const disk = new Memory(), a = client(disk), gate = deferred();
  const b = client({ run: async (fn) => { await gate.promise; return disk.run(fn); } });
  const base = await a.read('same');
  const delayed = b.write('same', 'late', base), failure = expect(delayed).rejects.toBeInstanceOf(StorageConflictError);
  const written = await a.write('same', 'new', base); gate.resolve(); await failure;
  await expect(b.write('same', 'retry', base)).rejects.toBeInstanceOf(StorageConflictError);
  expect((await a.read('same')).value).toBe('new');
  const explicit = await b.read('same'); await b.write('same', 'approved replacement', explicit);
  expect(sameSessionRecord(written, await a.read('same'))).toBe(false);
});
it('closing a queued client aborts its write, releases the transaction and leaves no permanent lock', async () => {
  const disk = new Memory(), gate = deferred(), a = client(disk);
  const b = client({ run: async (fn) => { await gate.promise; return disk.run(fn); } });
  const task = b.write('same', 'closed'), failed = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  b.close(); gate.resolve(); await failed; await a.write('same', 'survivor');
  expect((await a.read('same')).value).toBe('survivor');
});
it('legacy plain records are readable, tombstones prevent ABA and failed writes do not advance revisions', async () => {
  const disk = new Memory(); disk.rows.set('old', 'original'); const a = client(disk), b = client(disk);
  const old = await a.read('old'); expect(old.revision).toBeNull();
  await b.run((entries) => { entries.delete('old'); }); await b.run((entries) => { entries.set('old', 'original'); });
  await expect(a.write('old', 'stale', old)).rejects.toBeInstanceOf(StorageConflictError);
  const before = new Map(disk.rows);
  await expect(a.run((entries) => { entries.set('old', 'bad'); throw Error('Quota'); })).rejects.toThrow('Quota');
  expect(disk.rows).toEqual(before);
});
it.each(['broadcast', 'storage-event', 'activation'] as const)('external notification fallback: %s, without polling', async (mode) => {
  if (mode !== 'broadcast') vi.stubGlobal('BroadcastChannel', undefined);
  if (mode === 'activation') Object.assign(window, { localStorage: { setItem: () => { throw Error('Unavailable'); } } });
  const disk = new Memory(), a = client(disk), b = client(disk), keys: string[][] = [];
  b.subscribe((changed) => keys.push([...changed])); await b.read('key'); await a.write('key', 'new');
  if (mode === 'activation') window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(keys.flat()).toContain('key'));
  // A notice alone does not authorize overwriting the newer record.
  await expect(b.write('key', 'stale')).rejects.toBeInstanceOf(StorageConflictError);
});
it('document dirty and saved baselines survive external writes, explicit load and authorized overwrite', async () => {
  const disk = new Memory(), a = client(disk), b = client(disk), first = new AnimationStore(), second = new AnimationStore();
  first.newAnimation('Shared', 'empty', false); await saveRasterSession(first, { storage: a });
  await loadRasterSession(second, 'Shared', b);
  const stop = watchRasterStorage(second, b); second.duration(555);
  first.duration(444); await saveRasterSession(first, { storage: a });
  await vi.waitFor(() => expect(second.localPersistence?.status).toBe('conflict'));
  expect(second.frame.duration).toBe(555); expect(second.dirty).toBe(true);
  await expect(saveRasterSession(second, { storage: b })).rejects.toBeInstanceOf(StorageConflictError);
  second.undo(); expect(second.dirty).toBe(false); // saved baseline was not changed by failure
  await loadRasterSession(second, 'Shared', b); expect(second.frame.duration).toBe(444); expect(second.dirty).toBe(false);
  first.duration(666); await saveRasterSession(first, { storage: a });
  await vi.waitFor(() => expect(second.localPersistence?.status).toBe('updated'));
  expect(second.frame.duration).toBe(444); second.duration(777);
  const approved = await b.read('Shared'); await saveRasterSession(second, { storage: b, expected: approved });
  expect(second.dirty).toBe(false); expect(JSON.parse((await a.read('Shared')).value!) as unknown).toEqual(JSON.parse(serializeSession(second)) as unknown); stop();
});
it('a new session ignores a delayed old save result while CAS retains foreign successful writes', async () => {
  const disk = new Memory(), a = client(disk), gate = deferred();
  const b = client({ run: async (fn) => { await gate.promise; return disk.run(fn); } });
  const store = new AnimationStore(); store.newAnimation('Old', 'empty', false);
  const saving = saveRasterSession(store, { storage: b }); store.newAnimation('New', 'empty', false);
  await a.write('Old', 'foreign'); gate.resolve(); expect(await saving).toBe('stale');
  expect(store.localPersistence).toBeNull(); expect(store.state.name).toBe('New'); expect((await a.read('Old')).value).toBe('foreign');
});
it('global libraries preserve local templates on conflict, reject blind retries and synchronize only explicitly', async () => {
  const disk = new Memory(), a = client(disk), b = client(disk);
  const first = new GlobalTemplateLibrary(globalLibraryStorage(a)), second = new GlobalTemplateLibrary(globalLibraryStorage(b)); libraries.push(first, second);
  await Promise.all([first.load(), second.load()]); first.add(item('A')); second.add(item('B')); await Promise.all([first.settled(), second.settled()]);
  expect(first.dirty).toBe(false); expect(second.conflict).toBe(true); expect(second.status).toBe('failed'); expect(second.templates.map((t) => t.id)).toEqual(['B']);
  await second.retry(); expect(second.dirty).toBe(true); expect(first.templates.map((t) => t.id)).toEqual(['A']);
  await second.overwrite(); expect(second.dirty).toBe(false);
  await vi.waitFor(() => expect(first.externalChanged).toBe(true)); expect(first.dirty).toBe(false); expect(first.templates[0]!.id).toBe('A');
  await first.reload(); expect(first.templates[0]!.id).toBe('B'); expect(first.externalChanged).toBe(false);
});

it('explicit document overwrite cannot modify internal archives, Legacy originals or published migration targets', async () => {
  const disk = new Memory(), a = client(disk);
  for (const key of ['__migration_v1:archive:original', 'original.finoanim.json', 'Raster-Migration original.raster128.json']) {
    await a.run((entries) => entries.set(key, 'original bytes'));
    const store = new AnimationStore(); store.newAnimation(key, 'empty', false);
    await expect(saveRasterSession(store, { storage: a, expected: await a.read(key) })).rejects.toThrow('Original-/Migrationsdaten');
    expect((await a.read(key)).value).toBe('original bytes'); expect(store.dirty).toBe(true);
  }
});
it('editing during explicit library reload preserves local edits and never adopts an unreviewed write basis', async () => {
  const disk = new Memory(), a = client(disk), b = client(disk), gate = deferred();
  const first = new GlobalTemplateLibrary(globalLibraryStorage(a)); libraries.push(first); await first.load(); first.add(item('A')); await first.settled();
  const base = globalLibraryStorage(b); let delay = false;
  const second = new GlobalTemplateLibrary({ ...base, read: async () => { const json = await base.read(); if (delay) await gate.promise; return json; } }); libraries.push(second);
  await second.load(); first.rename('A', 'Foreign'); await first.settled();
  await vi.waitFor(() => expect(second.externalChanged).toBe(true));
  delay = true; const reloading = second.reload(); await vi.waitFor(() => expect(second.loaded).toBe(true));
  // Awaiting a turn ensures the pending read is captured; the edit must invalidate that reload.
  await new Promise<void>((resolve) => setTimeout(resolve, 0)); second.rename('A', 'Local'); gate.resolve();
  await expect(reloading).rejects.toThrow('während des Ladens'); await second.settled(); await second.retry();
  expect(second.templates[0]!.name).toBe('Local'); expect(second.dirty).toBe(true); expect(second.conflict).toBe(true);
  expect(first.templates[0]!.name).toBe('Foreign');
});
it('delayed acknowledgement of a successful library write cannot replace later foreign state or lose newer local edits', async () => {
  const disk = new Memory(), a = client(disk), b = client(disk), gate = deferred();
  const base = globalLibraryStorage(a); let delayed = false;
  const first = new GlobalTemplateLibrary({ ...base, write: async (json) => { await base.write(json); if (delayed) await gate.promise; } }); libraries.push(first);
  const second = new GlobalTemplateLibrary(globalLibraryStorage(b)); libraries.push(second);
  await first.load(); delayed = true; first.add(item('A'));
  await vi.waitFor(() => expect(disk.rows.has('__raster128_global_templates_v1')).toBe(true));
  await second.load(); second.add(item('B')); await second.settled(); first.rename('A', 'Local during acknowledgement');
  await vi.waitFor(() => expect(first.conflict).toBe(true)); gate.resolve(); await first.settled();
  expect(first.dirty).toBe(true); expect(first.templates.map((t) => t.name)).toEqual(['Local during acknowledgement']);
  expect(second.templates.map((t) => t.name)).toEqual(['A', 'B']);
  await first.retry(); expect(first.conflict).toBe(true); expect(second.dirty).toBe(false);
});

it('delayed explicit overwrite acknowledgement retains a newer foreign change and blocks subsequent local edits', async () => {
  const disk = new Memory(), a = client(disk), b = client(disk), gate = deferred();
  const base = globalLibraryStorage(a);
  const first = new GlobalTemplateLibrary({ ...base, overwrite: async (json) => { await base.overwrite!(json); await gate.promise; } });
  const second = new GlobalTemplateLibrary(globalLibraryStorage(b)); libraries.push(first, second);
  await Promise.all([first.load(), second.load()]); second.add(item('Foreign')); await second.settled();
  first.add(item('Local')); await first.settled(); expect(first.conflict).toBe(true);
  const replacing = first.overwrite();
  await vi.waitFor(() => expect(parseGlobalLibrary(disk.rows.get('__raster128_global_templates_v1')!).templates[0]!.id).toBe('Local'));
  await second.reload(); second.add(item('Newer foreign')); await second.settled();
  // No queued local edit may recreate a conflict and mask an incorrectly cleared notification.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gate.resolve(); await replacing; await first.settled();
  expect(first.conflict).toBe(true); expect(first.externalChanged).toBe(true); expect(first.dirty).toBe(false);
  first.rename('Local', 'Newer local'); await first.settled(); expect(first.dirty).toBe(true);
  expect(first.templates[0]!.name).toBe('Newer local');
  await first.retry(); expect(first.dirty).toBe(true);
  expect(second.templates.map((t) => t.name)).toEqual(['Local', 'Newer foreign']);
  expect(parseGlobalLibrary((await b.read('__raster128_global_templates_v1')).value!).templates.map((t) => t.name)).toEqual(['Local', 'Newer foreign']);
});
