import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type * as StoreModule from '../../src/animation/store';
import type * as FilesModule from '../../src/animation/files';
import v1 from '../fixtures/raster-session-v1.json' with { type: 'json' };

async function launch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByLabel('Raster128 Zeichenfläche')).toBeVisible();
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/animation/store.ts', files = '/src/animation/files.ts';
    const url = (path: string) => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
    const { animationStore: store } = await import(url(path)) as typeof StoreModule;
    const { serializeSession } = await import(url(files)) as typeof FilesModule;
    return { json: serializeSession(store), dirty: store.dirty, history: store.past.length };
  });
}
async function pick(page: Page, json: string, name = 'Reference.raster128.json') {
  await page.getByText('Datei', { exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Raster-Dokument importieren …', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Raster-Dokument importieren', exact: true })).toBeVisible();
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Importieren', exact: true }).click();
}

test('actual browser picker imports V1; V2 download/import retains content and saved status', async ({ page }) => {
  await launch(page);
  await pick(page, JSON.stringify(v1), 'Older-session.json'); await confirm(page);
  await expect(page.locator('.ab-status')).toContainText('Older-session.json importiert');
  const before = await state(page); expect(before.dirty).toBe(false);
  await page.getByText('Datei', { exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Raster-Dokument exportieren', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe(`${v1.name}.raster128.json`);
  const json = await readFile(await file.path(), 'utf8');
  expect(json).toBe(before.json); expect(await state(page)).toEqual(before);
  await pick(page, json); await confirm(page);
  await expect(page.locator('.ab-status')).toContainText('Reference.raster128.json importiert');
  expect(await state(page)).toEqual(before);
});

test('cancelling either picker or import confirmation preserves dirty editor content', async ({ page }) => {
  await launch(page);
  await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const url = performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
    const { animationStore } = await import(url) as typeof StoreModule;
    animationStore.duration(250);
  });
  const before = await state(page); expect(before.dirty).toBe(true);
  await page.getByText('Datei', { exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Raster-Dokument importieren …', exact: true }).click();
  await (await chooser).setFiles([]);
  expect(await state(page)).toEqual(before);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await pick(page, JSON.stringify(v1));
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(await state(page)).toEqual(before);
});

test('invalid document data is rejected through the UI without a partial restore', async ({ page }) => {
  await launch(page); const before = await state(page);
  await pick(page, JSON.stringify({ ...v1, reference: { ...v1.reference, rgba: [1] } }));
  await confirm(page);
  await expect(page.locator('.ab-status')).toContainText('Ungültige Referenz');
  expect(await state(page)).toEqual(before);
  // Input is reset, so selecting the same filename again remains possible.
  await pick(page, JSON.stringify(v1)); await confirm(page);
  await expect(page.locator('.ab-status')).toContainText('Reference.raster128.json importiert');
  expect((await state(page)).dirty).toBe(false);
});
