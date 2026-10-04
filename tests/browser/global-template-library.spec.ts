import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type * as Raster from '../../src/animation/store';
import type * as Library from '../../src/animation/globalTemplateLibrary';
import type * as Storage from '../../src/animation/storage';

async function launch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByLabel('Raster128 Zeichenfläche')).toBeVisible();
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: store } = await import(performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path) as typeof Raster;
    store.source('empty'); store.pixels(store.editable!, new Map([[3 * 128 + 3, 0x12345601]]));
    store.setSelection(new Set([2 * 128 + 2, 2 * 128 + 3, 3 * 128 + 2, 3 * 128 + 3]));
    store.markSaved(store.captureContent());
  });
}
async function save(page: Page, name: string) {
  await page.getByRole('button', { name: 'Auswahl global speichern …', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen', exact: true }).click();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: store } = await import(performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path) as typeof Raster;
    return { dirty: store.dirty, history: store.past.length, documentTemplates: store.templates.length, pixels: [...store.layer!.pixels] };
  });
}
test('global templates save, rename, apply, backup roundtrip and survive document/session/editor changes', async ({ page }) => {
  await launch(page); const before = await snapshot(page);
  await save(page, 'Global browser'); await expect(page.getByRole('status')).toContainText('Gespeichert');
  expect(await snapshot(page)).toEqual(before);
  const row = page.locator('.ab-library-row').filter({ has: page.getByRole('button', { name: 'Global browser', exact: true }) });
  await row.getByTitle('Globale Vorlage umbenennen', { exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Renamed global');
  await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Bibliothek exportieren …', exact: true }).click();
  const download = await downloading; expect(download.suggestedFilename()).toBe('Raster-Vorlagen.raster128-library.json');
  const json = await readFile(await download.path(), 'utf8');
  await page.getByTitle('Globale Vorlage löschen', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Renamed global', exact: true })).toHaveCount(0);
  await page.locator('#ab-library-file').setInputFiles({ name: 'backup.raster128-library.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('dialog').getByRole('button', { name: 'Importieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Renamed global', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Gespeichert'); expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Renamed global', exact: true }).click();
  await page.getByRole('dialog').getByLabel('X', { exact: true }).fill('10');
  await page.getByRole('dialog').getByLabel('Y', { exact: true }).fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Einfügen', exact: true }).click();
  const applied = await snapshot(page); expect(applied.history).toBe(before.history + 1);
  expect(applied.pixels).toContainEqual([21 * 128 + 11, 0x12345601]);
  await page.reload();
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Renamed global', exact: true })).toBeVisible();
});
test('failed global writes are separate from document dirty, protect leaving and offer working Retry', async ({ page }) => {
  await launch(page);
  await page.evaluate(async () => {
    const path = '/src/animation/storage.ts';
    const { localSessionStorage: disk } = await import(path) as typeof Storage;
    const original = disk.write.bind(disk);
    const libraryPath = '/src/animation/globalTemplateLibrary.ts';
    const { GLOBAL_TEMPLATE_KEY } = await import(libraryPath) as typeof Library;
    disk.write = (key, json, expected) => {
      if (key === GLOBAL_TEMPLATE_KEY) return Promise.reject(new DOMException('Controlled library quota', 'QuotaExceededError'));
      return original(key, json, expected);
    };
    Object.assign(window, { restoreLibraryDisk: () => { disk.write = original; } });
  });
  const before = await snapshot(page); await save(page, 'Pending global');
  await expect(page.getByRole('status')).toContainText('Controlled library quota');
  expect(await snapshot(page)).toEqual(before); await expect(page.locator('.ab-status')).toContainText('Globale Bibliothek ungesichert');
  await page.locator('.editor-menu-trigger').click();
  await page.getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ungespeicherte Änderungen');
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.evaluate(() => (window as unknown as { restoreLibraryDisk: () => void }).restoreLibraryDisk());
  await page.getByRole('button', { name: 'Bibliothek erneut speichern', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert'); await expect(page.locator('.ab-status')).not.toContainText('Globale Bibliothek ungesichert');
  expect(await snapshot(page)).toEqual(before);
  await page.locator('.editor-menu-trigger').click(); await page.getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
  await expect(page.locator('.editor-launcher')).toBeVisible();
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pending global', exact: true })).toBeVisible();
});

test('a delayed global write result survives leaving and remounting without changing the document session', async ({ page }) => {
  await launch(page); const before = await snapshot(page);
  await page.evaluate(async () => {
    const path = '/src/animation/storage.ts'; const { localSessionStorage: disk } = await import(path) as typeof Storage;
    const original = disk.write.bind(disk), libPath = '/src/animation/globalTemplateLibrary.ts';
    const { GLOBAL_TEMPLATE_KEY } = await import(libPath) as typeof Library;
    disk.write = async (key, json, expected) => {
      const result = await original(key, json, expected);
      if (key === GLOBAL_TEMPLATE_KEY) await new Promise<void>((resolve) => { Object.assign(window, { releaseGlobalWrite: resolve }); });
      return result;
    };
  });
  await save(page, 'Delayed global'); await expect(page.getByRole('status')).toContainText('ausstehend');
  await page.locator('.editor-menu-trigger').click(); await page.getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
  await page.getByRole('button', { name: 'Zur Auswahl', exact: true }).click(); await expect(page.locator('.editor-launcher')).toBeVisible();
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click(); await expect(page.getByRole('status')).toContainText('ausstehend');
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => (window as unknown as { releaseGlobalWrite: () => void }).releaseGlobalWrite());
  await expect(page.getByRole('status')).toContainText('Gespeichert'); expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Delayed global', exact: true })).toBeVisible();
});
