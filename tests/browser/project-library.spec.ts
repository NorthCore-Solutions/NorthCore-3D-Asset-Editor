/* eslint-disable @typescript-eslint/require-await -- In-memory mocks implement asynchronous filesystem methods. */
import { expect, test, type Page } from '@playwright/test';
import type { ProjectDirectoryHandle, ProjectFileHandle } from '../../src/animation/projectDirectory';
import type * as StoreModule from '../../src/animation/store';

type Harness = { root: ProjectDirectoryHandle; add(name: string): void; writes: Record<string, string>; permission: PermissionState; requests: number };
async function launch(page: Page, supported = true) {
  await page.addInitScript(({ supported }) => {
    const data = JSON.stringify({ version: 2, metadata: { id: 'deep-project' }, name: 'Deep project', source: 'empty', frames: [{ duration: 125, layers: [{ id: 'pixels-1', name: 'Pixels', visible: true, locked: false, pixels: [[386, 0x123456ff]] }] }], templates: [], reference: null });
    const writes: Record<string, string> = {};
    const file = (name: string): ProjectFileHandle => ({ kind: 'file', name, getFile: async () => new File([writes[name] ?? data], name), createWritable: async () => ({ write: async (json) => { writes[name] = json; }, close: async () => {}, abort: async () => {} }) });
    const harness: Harness = { root: undefined as unknown as ProjectDirectoryHandle, add: () => {}, writes, permission: 'granted', requests: 0 };
    const directory = (name: string, entries: (ProjectDirectoryHandle | ProjectFileHandle)[]): ProjectDirectoryHandle => ({ kind: 'directory', name,
      async *values() { yield* entries; }, queryPermission: async () => harness.permission,
      requestPermission: async () => { harness.requests++; harness.permission = 'granted'; return 'granted'; },
      getFileHandle: async (name, options) => { const found = entries.find((e): e is ProjectFileHandle => e.kind === 'file' && e.name === name); if (found) return found;
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); const created = file(name); entries.push(created); return created; },
    });
    const deep = directory('Deep', [file('deep.raster128.json')]);
    const first = directory('First', [deep]); const other = directory('Other', [file('other.raster128.json')]);
    const entries = [first, other, file('root.raster128.json'), file('ignore.txt')];
    harness.root = directory('Projects', entries); harness.add = (name) => { entries.push(file(name)); };
    Object.assign(window, { __projectTest: harness });
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: supported ? async () => harness.root : undefined });
  }, { supported });
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.locator('.ab-canvas')).toBeVisible();
}
const harness = (page: Page, action: 'add' | 'revoke' | 'requests') => page.evaluate((action) => {
  const h = (window as unknown as Window & { __projectTest: Harness }).__projectTest;
  if (action === 'add') h.add('external.raster128.json');
  if (action === 'revoke') h.permission = 'prompt';
  return h.requests;
}, action);

test('cascading live folders, deep file open, save, outside/Escape, permission and edge placement', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await launch(page);
  await page.getByRole('button', { name: 'Hauptordner verbinden …', exact: true }).click();
  const root = page.getByRole('menu', { name: 'Projektdateien', exact: true });
  await expect(root.getByRole('menuitem')).toHaveCount(3);
  await root.getByRole('menuitem', { name: 'First', exact: true }).click();
  const first = page.getByRole('menu', { name: 'First', exact: true });
  await first.getByRole('menuitem', { name: 'Deep', exact: true }).click();
  const deep = page.getByRole('menu', { name: 'Deep', exact: true });
  const a = (await first.boundingBox())!, b = (await deep.boundingBox())!;
  expect(b.x).toBeGreaterThan(a.x); expect(b.y).toBeGreaterThan(a.y);
  await deep.getByRole('menuitem', { name: 'deep.raster128.json', exact: true }).click();
  await expect(page.locator('.ab-title')).toContainText('Deep project');
  await expect(page.locator('.ab-project-flyout')).toHaveCount(0);
  await expect(page.locator('.ab-status')).toContainText('Projekt geöffnet: deep.raster128.json');
  await root.getByRole('menuitem', { name: 'First', exact: true }).click();
  await first.getByRole('menuitem', { name: 'Deep', exact: true }).click();
  await root.getByRole('menuitem', { name: 'Other', exact: true }).click();
  await expect(page.locator('.ab-project-flyout')).toHaveCount(1);
  await expect(page.getByRole('menu', { name: 'Other', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.ab-project-flyout')).toHaveCount(0);
  await root.getByRole('menuitem', { name: 'First', exact: true }).click();
  await page.locator('.ab-title').click(); await expect(page.locator('.ab-project-flyout')).toHaveCount(0);
  await page.locator('.ab-project-library').getByRole('button', { name: 'Projekt hier speichern …', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Dateiname').fill('Created');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(root.getByRole('menuitem', { name: 'Created.raster128.json', exact: true })).toBeVisible();
  await harness(page, 'add'); await page.getByRole('button', { name: 'Ordner aktualisieren', exact: true }).click();
  await expect(root.getByRole('menuitem', { name: 'external.raster128.json', exact: true })).toBeVisible();
  await harness(page, 'revoke'); await page.getByRole('button', { name: 'Ordner aktualisieren', exact: true }).click();
  await page.getByRole('button', { name: 'Ordnerzugriff erlauben', exact: true }).click();
  await expect(root).toBeVisible(); expect(await harness(page, 'requests')).toBe(1);
  await page.setViewportSize({ width: 700, height: 650 });
  const reopen = page.getByRole('button', { name: 'Dateien / Vorlagen einblenden', exact: true });
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByRole('button', { name: 'Dateien / Vorlagen ausblenden', exact: true })).toBeVisible();
  await root.getByRole('menuitem', { name: 'First', exact: true }).click();
  await first.getByRole('menuitem', { name: 'Deep', exact: true }).click();
  for (const flyout of await page.locator('.ab-project-flyout').all()) {
    const rect = (await flyout.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(700);
    expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(650);
  }
  expect(errors).toEqual([]);
});

test('capability fallback, neutral starts and outline icons keep normal editor functions accessible', async ({ page }) => {
  await launch(page, false);
  await expect(page.locator('.ab-project-library')).toContainText('Ordnerbindung ist hier nicht verfügbar');
  await expect(page.getByRole('button', { name: 'Hauptordner verbinden …' })).toHaveCount(0);
  expect(await page.getByLabel('Ausgangszustand', { exact: true }).locator('option').allTextContents()).toEqual(['Leer', 'Transparent']);
  await page.getByLabel('Ausgangszustand', { exact: true }).selectOption('transparent');
  await expect(page.getByRole('button', { name: 'Pipette', exact: true }).locator('svg')).toHaveCount(0);
  const inspectorPipette = page.getByTitle('Pipette aktivieren');
  await expect(inspectorPipette.locator('svg')).toHaveCount(1);
  const pipetteGeometry = await inspectorPipette.evaluate((button) => {
    const box = button.getBoundingClientRect(), icon = button.querySelector('svg')!.getBoundingClientRect();
    return { width: box.width, height: box.height, iconWidth: icon.width, iconHeight: icon.height, dx: Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2), dy: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2) };
  });
  expect(pipetteGeometry.width).toBe(32);
  expect(pipetteGeometry.height).toBe(32);
  expect(pipetteGeometry.iconWidth).toBe(16);
  expect(pipetteGeometry.iconHeight).toBe(16);
  expect(pipetteGeometry.dx).toBeLessThanOrEqual(1);
  expect(pipetteGeometry.dy).toBeLessThanOrEqual(1);
  expect((await page.locator('.ab-layer-entry').first().boundingBox())?.height).toBe(48);
  await expect(page.locator('.ab-layer').getByTitle('Sperren').locator('svg')).toHaveCount(1);
  const layer = page.locator('.ab-layer.selected').first();
  await layer.hover(); expect(await layer.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(99, 85, 116)');
  await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore, Stroke } = await import(path) as typeof StoreModule;
    new Stroke(animationStore, { x: 2, y: 3 }, false).commit(); animationStore.move(1, 0); animationStore.stretch(1, 1); animationStore.undo(); animationStore.redo();
  });
  await page.getByRole('button', { name: 'Sitzung lokal sichern', exact: true }).click();
  await expect(page.locator('.ab-status')).toContainText('Sitzung lokal gesichert.');
});

test('a real structured-cloned directory handle is reused after reload and sees new files', async ({ page }) => {
  await launch(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
      const storage = await navigator.storage.getDirectory();
      const root = await storage.getDirectoryHandle('PersistentProjects', { create: true });
      const file = await root.getFileHandle('persistent.raster128.json', { create: true });
      const writer = await file.createWritable(); await writer.write('{}'); await writer.close();
      return root;
    } });
  });
  await page.getByRole('button', { name: 'Hauptordner verbinden …', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'persistent.raster128.json', exact: true })).toBeVisible();
  // Read back the real handle: this verifies IndexedDB structured cloning, not a mock tree cache.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('northcore-raster128-directory', 1); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<string>((resolve) => { const request = db.transaction('handles').objectStore('handles').get('root'); request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined)?.name ?? ''); }); }
    finally { db.close(); }
  })).toBe('PersistentProjects');
  await page.reload();
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'persistent.raster128.json', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('PersistentProjects');
    const file = await root.getFileHandle('added.raster128.json', { create: true });
    const writer = await file.createWritable(); await writer.write('{}'); await writer.close();
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByRole('menuitem', { name: 'added.raster128.json', exact: true })).toBeVisible();
});

test('touch opens multiple folder levels and a deep project without hover', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage(); await launch(page);
    await page.getByRole('button', { name: 'Dateien / Vorlagen einblenden', exact: true }).tap();
    await page.getByRole('button', { name: 'Hauptordner verbinden …', exact: true }).tap();
    await page.getByRole('menu', { name: 'Projektdateien', exact: true }).getByRole('menuitem', { name: 'First', exact: true }).tap();
    await page.getByRole('menu', { name: 'First', exact: true }).getByRole('menuitem', { name: 'Deep', exact: true }).tap();
    await page.getByRole('menu', { name: 'Deep', exact: true }).getByRole('menuitem', { name: 'deep.raster128.json', exact: true }).tap();
    await expect(page.locator('.ab-title')).toContainText('Deep project');
  } finally { await context.close(); }
});

test('native storage upgrade removes retired records and indexes while preserving document bytes', async ({ page }) => {
  // Seed the old disk before loading application modules that request schema 3.
  await page.route('**/src/**', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('northcore-animation-builder', 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('sessions');
        const catalog = request.result.createObjectStore('builder_metadata', { keyPath: 'key' });
        catalog.createIndex('archiveId', ['kind', 'archiveId', 'key']);
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? Error('Open failed'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite'), sessions = tx.objectStore('sessions');
        sessions.put('native bytes', 'Keep'); sessions.put('native revision', '__builder_revision_v1:Keep');
        sessions.put('library bytes', '__raster128_global_templates_v1');
        for (const key of ['__migration_v1:archive:x', '__migration_v1:journal:x', '__legacy_templates', 'old.finoanim.json', '__builder_revision_v1:old.finoanim.json']) sessions.put('retired bytes', key);
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('Write failed'));
      });
    } finally { db.close(); }
  });
  await page.unroute('**/src/**'); await page.reload();
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep', exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('northcore-animation-builder', 3); request.onsuccess = () => resolve(request.result); });
    try {
      return await new Promise<{ keys: IDBValidKey[]; values: unknown[]; indexes: string[] }>((resolve) => {
        const tx = db.transaction(['sessions', 'builder_metadata']), sessions = tx.objectStore('sessions');
        const keys = sessions.getAllKeys(), values = sessions.getAll();
        const indexes = [...tx.objectStore('builder_metadata').indexNames];
        tx.oncomplete = () => resolve({ keys: keys.result, values: values.result as unknown[], indexes });
      });
    } finally { db.close(); }
  });
  expect(result.keys).toEqual(['Keep', '__builder_revision_v1:Keep', '__raster128_global_templates_v1']);
  expect(result.values).toEqual(['native bytes', 'native revision', 'library bytes']);
  expect(result.indexes).toEqual(['detailsKnown', 'kind']);
});
