import { expect, test, type Page } from '@playwright/test';
import type * as Store from '../../src/animation/store';
import type * as Files from '../../src/animation/files';
import type * as StorageModule from '../../src/animation/storage';
import type * as Library from '../../src/animation/globalTemplateLibrary';

async function launch(page: Page, name: string, duration: number) {
  await page.goto('/'); await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.locator('.ab-canvas')).toBeVisible();
  await page.evaluate(async ({ name, duration }) => {
    const storePath = '/src/animation/store.ts'; const { animationStore: store } = await import(storePath) as typeof Store;
    store.newAnimation(name, 'empty', false); store.duration(duration);
  }, { name, duration });
}
async function save(page: Page) {
  return page.evaluate(async () => {
    const storePath = '/src/animation/store.ts'; const { animationStore: store } = await import(storePath) as typeof Store;
    const filesPath = '/src/animation/files.ts'; const files = await import(filesPath) as typeof Files;
    try { return { result: await files.saveRasterSession(store), dirty: store.dirty, duration: store.frame.duration }; }
    catch (error) { return { result: error instanceof Error ? error.name : 'Error', dirty: store.dirty, duration: store.frame.duration }; }
  });
}
async function status(page: Page) {
  return page.evaluate(async () => {
    const storePath = '/src/animation/store.ts'; const { animationStore: store } = await import(storePath) as typeof Store;
    return { status: store.localPersistence?.status, dirty: store.dirty, duration: store.frame.duration };
  });
}

test('two real tabs preserve the losing document, explicit overwrite and clean reload keep both baselines correct', async ({ page }) => {
  const other = await page.context().newPage(); await Promise.all([launch(page, 'Shared tabs', 101), launch(other, 'Shared tabs', 202)]);
  const results = await Promise.all([save(page), save(other)]);
  expect(results.filter((r) => r.result === 'saved')).toHaveLength(1);
  expect(results.filter((r) => r.result === 'StorageConflictError')).toHaveLength(1);
  const loser = results[0].result === 'StorageConflictError' ? page : other, winner = loser === page ? other : page;
  const loserDuration = loser === page ? 101 : 202;
  await expect(loser.locator('.ab-storage-conflict')).toContainText('Speicherkonflikt');
  expect(await status(loser)).toMatchObject({ dirty: true, duration: loserDuration });
  expect((await save(loser)).result).toBe('StorageConflictError');
  await loser.getByRole('button', { name: 'Lokalen Stand überschreiben …', exact: true }).click();
  await loser.getByRole('dialog').getByRole('button', { name: 'Überschreiben', exact: true }).click();
  await expect.poll(async () => (await status(loser)).dirty).toBe(false);
  await expect.poll(async () => (await status(winner)).status).toBe('updated');
  await winner.getByRole('button', { name: 'Externen Stand laden …', exact: true }).click();
  await winner.getByRole('dialog').getByRole('button', { name: 'Öffnen', exact: true }).click();
  await expect.poll(async () => (await status(winner)).duration).toBe(loserDuration);
  expect((await status(winner)).dirty).toBe(false);
});

test('touch conflict resolution stays reachable without resizing the canvas', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage(), other = await context.newPage();
    await Promise.all([launch(page, 'Touch conflict', 101), launch(other, 'Touch conflict', 202)]);
    const bounds = await Promise.all([page.locator('.ab-canvas').boundingBox(), other.locator('.ab-canvas').boundingBox()]);
    const results = await Promise.all([save(page), save(other)]);
    expect(results.filter((r) => r.result === 'StorageConflictError')).toHaveLength(1);
    const loser = results[0].result === 'StorageConflictError' ? page : other, winner = loser === page ? other : page;
    const duration = loser === page ? 101 : 202;
    await expect(loser.locator('.ab-storage-conflict')).toBeVisible();
    await loser.getByRole('button', { name: 'Lokalen Stand überschreiben …', exact: true }).tap();
    await loser.getByRole('dialog').getByRole('button', { name: 'Überschreiben', exact: true }).tap();
    await expect.poll(async () => (await status(loser)).dirty).toBe(false);
    await expect.poll(async () => (await status(winner)).status).toBe('updated');
    await winner.getByRole('button', { name: 'Externen Stand laden …', exact: true }).tap();
    await winner.getByRole('dialog').getByRole('button', { name: 'Öffnen', exact: true }).tap();
    await expect.poll(async () => (await status(winner)).duration).toBe(duration);
    expect((await status(winner)).dirty).toBe(false);
    expect(await page.locator('.ab-canvas').boundingBox()).toEqual(bounds[0]);
    expect(await other.locator('.ab-canvas').boundingBox()).toEqual(bounds[1]);
  } finally { await context.close(); }
});

test('different documents save concurrently, and external session listings refresh without replacing local content', async ({ page }) => {
  const other = await page.context().newPage(); await Promise.all([launch(page, 'Tab A', 101), launch(other, 'Tab B', 202)]);
  expect((await Promise.all([save(page), save(other)])).map((r) => r.result)).toEqual(['saved', 'saved']);
  await expect(page.getByRole('button', { name: 'Tab B', exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Tab A', exact: true })).toBeVisible();
  expect(await status(page)).toMatchObject({ dirty: false, duration: 101 }); expect(await status(other)).toMatchObject({ dirty: false, duration: 202 });
});

test('parallel global libraries retain local templates; retry cannot overwrite, explicit resolution synchronizes safely', async ({ page }) => {
  const other = await page.context().newPage(); await Promise.all([launch(page, 'Library A', 101), launch(other, 'Library B', 202)]);
  async function add(page: Page, id: string) {
    await page.evaluate(async (id) => {
      const globalTemplateLibraryPath = '/src/animation/globalTemplateLibrary.ts'; const { globalTemplateLibrary: library } = await import(globalTemplateLibraryPath) as typeof Library;
      await library.load(); library.add({ id, name: id, width: 1, height: 1, origin: { x: 0, y: 0 }, pixels: [[0, 0x12345601]] }); await library.settled();
    }, id);
  }
  await Promise.all([add(page, 'Local A'), add(other, 'Local B')]);
  async function libraryState(page: Page) { return page.evaluate(async () => {
    const globalTemplateLibraryPath = '/src/animation/globalTemplateLibrary.ts'; const { globalTemplateLibrary: library } = await import(globalTemplateLibraryPath) as typeof Library;
    return { dirty: library.dirty, conflict: library.conflict, names: library.templates.map((t) => t.name), external: library.externalChanged };
  }); }
  const loser = (await libraryState(page)).conflict ? page : other, winner = loser === page ? other : page;
  const local = (await libraryState(loser)).names;
  await loser.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await expect(loser.locator('.ab-left')).toContainText('Speicherkonflikt');
  await loser.getByRole('button', { name: 'Bibliothek erneut speichern', exact: true }).click();
  expect((await libraryState(loser)).dirty).toBe(true); expect((await libraryState(loser)).names).toEqual(local);
  await loser.getByRole('button', { name: 'Bibliothek überschreiben …', exact: true }).click();
  await loser.getByRole('dialog').getByRole('button', { name: 'Überschreiben', exact: true }).click();
  await expect.poll(async () => (await libraryState(loser)).dirty).toBe(false);
  await winner.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await expect(winner.getByRole('button', { name: 'Bibliothek neu laden …', exact: true })).toBeVisible();
  await winner.getByRole('button', { name: 'Bibliothek neu laden …', exact: true }).click();
  await winner.getByRole('dialog').getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect.poll(async () => (await libraryState(winner)).names).toEqual(local);
  expect(await status(page)).toMatchObject({ dirty: true, duration: 101 }); expect(await status(other)).toMatchObject({ dirty: true, duration: 202 });
});

for (const fallback of ['storage', 'activation'] as const) test(`no BroadcastChannel: ${fallback} notifications and CAS work in real tabs`, async ({ page }) => {
  await page.context().addInitScript((fallback) => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
    if (fallback === 'activation') Storage.prototype.setItem = () => { throw Error('Storage unavailable'); };
  }, fallback);
  const other = await page.context().newPage(); await Promise.all([launch(page, 'Fallback', 101), launch(other, 'Other', 202)]);
  await save(page);
  await other.evaluate(async () => {
    const storePath = '/src/animation/store.ts'; const { animationStore: store } = await import(storePath) as typeof Store;
    const filesPath = '/src/animation/files.ts'; const { loadRasterSession } = await import(filesPath) as typeof Files; await loadRasterSession(store, 'Fallback'); store.duration(303);
  });
  await page.evaluate(async () => { const storePath = '/src/animation/store.ts'; const { animationStore: store } = await import(storePath) as typeof Store; store.duration(404); }); await save(page);
  if (fallback === 'activation') await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await status(other)).status).toBe('conflict');
  expect((await save(other)).result).toBe('StorageConflictError'); expect((await status(other)).duration).toBe(303);
});

test('closing a tab with a real aborted transaction leaves no lock and no half-written record', async ({ page }) => {
  await launch(page, 'Survivor', 101); const other = await page.context().newPage(); await other.goto('/');
  await other.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('northcore-animation-builder', 3);
    open.onerror = () => reject(open.error ?? Error('IndexedDB open failed'));
    open.onsuccess = () => {
      const tx = open.result.transaction('sessions', 'readwrite');
      tx.onabort = () => { open.result.close(); resolve(); };
      tx.objectStore('sessions').put('must roll back', 'Crash'); tx.abort();
    };
  })); await other.close();
  expect((await save(page)).result).toBe('saved');
  expect(await page.evaluate(async () => { const storagePath = '/src/animation/storage.ts'; const { localSessionStorage } = await import(storagePath) as typeof StorageModule; return (await localSessionStorage.read('Crash')).value; })).toBeUndefined();
});
