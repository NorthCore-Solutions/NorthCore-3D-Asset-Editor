import { expect, test, type Page } from '@playwright/test';
import type * as StoreModule from '../../src/animation/store';

async function prepare(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByLabel('Raster128 Zeichenfläche')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: store, Stroke } = await import(performance.getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === path).at(-1)?.name ?? path) as typeof StoreModule;
    store.source('empty');
    new Stroke(store, { x: 2, y: 3 }, false).commit();
    store.saveAsset('Template');
    store.markSaved(store.captureContent());
  });
}
async function save(page: Page) {
  await page.getByRole('tab', { name: 'Dateien', exact: true }).click();
  await page.getByRole('button', { name: 'Sitzung lokal sichern', exact: true }).click();
  await expect(page.locator('.ab-status')).toContainText('Sitzung lokal gesichert.');
  await expect(page.locator('.ab-status .ab-unsaved')).toHaveCount(0);
}

test('template rename/delete UI tracks dirty content and local IndexedDB restore includes collections', async ({ page }) => {
  await prepare(page);
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  const row = page.locator('.ab-library-row').filter({ has: page.getByRole('button', { name: 'Template', exact: true }) });
  await row.getByTitle('Umbenennen', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Renamed template');
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter');
  await expect(page.locator('.ab-status .ab-unsaved')).toHaveText('Ungespeichert');
  await save(page);
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await page.locator('.ab-library-row').filter({ has: page.getByRole('button', { name: 'Renamed template', exact: true }) })
    .getByTitle('Löschen', { exact: true }).click();
  await expect(page.locator('.ab-status .ab-unsaved')).toHaveText('Ungespeichert');
  await page.getByRole('tab', { name: 'Dateien', exact: true }).click();
  await page.getByRole('button', { name: 'Neue Rasteranimation', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Öffnen', exact: true }).click();
  await expect(page.locator('.ab-status .ab-unsaved')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Renamed template', exact: true })).toBeVisible();

});
