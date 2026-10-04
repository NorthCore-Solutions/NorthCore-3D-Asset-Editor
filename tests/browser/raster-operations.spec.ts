import { expect, test, type Page } from '@playwright/test';
import type * as Store from '../../src/animation/store';
import type * as Files from '../../src/animation/files';

async function launch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: s } = await import(performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path) as typeof Store;
    s.source('empty'); s.pixels(s.layer!, new Map([[129, 0x11223301], [130, 0x44556600], [131, 0x778899ff]])); s.markSaved(s.captureContent());
  });
  await page.getByRole('button', { name: 'Native Operations / Replay', exact: true }).click();
  for (const [field, value] of Object.entries({ x: 1, y: 1, width: 3, height: 1 }))
    await page.getByLabel(`Operationsmaske ${field}`, { exact: true }).fill(String(value));
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const module = (path: string) => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
    const { animationStore: s } = await import(module('/src/animation/store.ts')) as typeof Store;
    const { serializeSession } = await import(module('/src/animation/files.ts')) as typeof Files;
    return { json: serializeSession(s), pixels: [...s.layer!.pixels], recipe: s.layer!.recipe, past: s.past.length, dirty: s.dirty };
  });
}
test('native operation form, edit/remove replay, Undo/Redo and document backup retain exact pixels', async ({ page }) => {
  await launch(page); const baseline = await state(page);
  await page.getByLabel('Native Replay speichern').check(); await page.getByLabel('Native Operation x', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Native Operation anwenden', exact: true }).click();
  const first = await state(page); expect(first.past).toBe(baseline.past + 1); expect(first.recipe!.operations).toHaveLength(1);
  await page.getByLabel('Native Operation x', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Native Operation anwenden', exact: true }).click();
  const second = await state(page); expect(second.recipe!.operations).toHaveLength(2);
  await page.getByRole('button', { name: 'Operation bearbeiten', exact: true }).first().click();
  await page.getByLabel('Native Operation x', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Replay-Operation ersetzen', exact: true }).click();
  expect((await state(page)).recipe!.operations[0]).toMatchObject({ dx: -1 });
  await page.getByRole('button', { name: 'Operation entfernen', exact: true }).first().click();
  const removed = await state(page); expect(removed.recipe!.operations).toHaveLength(1);
  expect(removed.pixels).toEqual([[131, 0x11223301], [132, 0x44556600], [133, 0x778899ff]]);
  const canvas = page.getByLabel('Raster128 Zeichenfläche'); await canvas.focus(); await page.keyboard.press('Control+z');
  expect((await state(page)).recipe!.operations).toHaveLength(2);
  await page.keyboard.press('Control+Shift+z'); expect((await state(page)).json).toBe(removed.json);
  await page.getByText('Datei', { exact: true }).click(); const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Raster-Dokument exportieren', exact: true }).click();
  const download = await downloading; expect(download.suggestedFilename()).toMatch(/\.raster128\.json$/);
  await page.locator('#ab-document-file').setInputFiles(await download.path());
  await page.getByRole('dialog').getByRole('button', { name: 'Importieren', exact: true }).click();
  await expect(page.locator('.ab-status')).toContainText('importiert'); expect((await state(page)).json).toBe(removed.json); expect((await state(page)).dirty).toBe(false);
});
test('invalid operations and stale editor forms cannot mutate the document; direct operation remains recipe-free', async ({ page }) => {
  await launch(page); const before = await state(page);
  await page.getByLabel('Native Operation x', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Native Operation anwenden', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Ungültige'); expect((await state(page)).json).toBe(before.json);
  await page.getByLabel('Native Operation x', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Native Operation anwenden', exact: true }).click();
  expect((await state(page)).recipe).toBeUndefined();
  await page.getByLabel('Native Replay speichern').check(); await page.getByRole('button', { name: 'Native Operation anwenden', exact: true }).click();
  await page.getByRole('button', { name: 'Operation bearbeiten', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: s } = await import(performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path) as typeof Store;
    s.addFrame(true);
  });
  const newFrame = await state(page);
  await page.getByRole('button', { name: 'Replay-Operation ersetzen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Sitzung wurde gewechselt'); expect((await state(page)).json).toBe(newFrame.json);
});
