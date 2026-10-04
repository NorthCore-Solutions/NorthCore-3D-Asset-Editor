import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type * as Store from '../../src/animation/store';
import type * as Poses from '../../src/animation/nativePoses';
import type * as Files from '../../src/animation/files';
import manifest from '../../src/animation/data/poses/catalog.json' with { type: 'json' };

async function launch(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByLabel('Raster128 Zeichenfläche')).toBeVisible();
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const module = (path: string) => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
    const { animationStore: store } = await import(module('/src/animation/store.ts')) as typeof Store;
    const { serializeSession } = await import(module('/src/animation/files.ts')) as typeof Files;
    const { poseForSource, nativePosePixels } = await import(module('/src/animation/nativePoses.ts')) as typeof Poses;
    const selected = poseForSource(store.state.source);
    return { json: serializeSession(store), dirty: store.dirty, frames: store.state.frames.length, index: store.state.index,
      poseId: store.frame.pose?.poseId ?? null, pixels: [...store.layer!.pixels],
      expected: selected ? [...nativePosePixels(selected.id)] : [], originCount: store.state.frames.filter((f) => f.pose).length };
  });
}
test('all six native choices and frame actions work without Legacy resources or changes to earlier frames', async ({ page }) => {
  const legacyRequests: string[] = [];
  await page.route('**/animation/legacy/**', (route) => { legacyRequests.push(route.request().url()); return route.abort(); });
  await launch(page);
  for (const [i, pose] of manifest.poses.entries()) {
    const before = await state(page);
    await page.getByLabel('Grundpose', { exact: true }).selectOption(pose.sourceId);
    const chosen = await state(page); expect(chosen.poseId).toBe(pose.id); expect(chosen.pixels).toEqual(chosen.expected);
    const oldFrames = (JSON.parse(before.json) as { frames: unknown[] }).frames.slice(0, -1);
    expect((JSON.parse(chosen.json) as { frames: unknown[] }).frames.slice(0, -1)).toEqual(oldFrames);
    await page.getByRole('button', { name: 'Frame aus Grundpose', exact: true }).click();
    const next = await state(page); expect(next.frames).toBe(i + 2); expect(next.poseId).toBe(pose.id); expect(next.pixels).toEqual(chosen.pixels);
    expect((JSON.parse(next.json) as { frames: unknown[] }).frames.slice(0, -1)).toEqual((JSON.parse(chosen.json) as { frames: unknown[] }).frames);
  }
  await page.getByTitle('Frame hinzufügen', { exact: true }).click();
  const blank = await state(page); expect(blank.pixels).toEqual([]); expect(blank.poseId).toBeNull();
  await page.getByLabel('Grundpose', { exact: true }).selectOption('empty');
  await expect(page.getByRole('button', { name: 'Frame aus Grundpose', exact: true })).toBeDisabled();
  expect(legacyRequests).toEqual([]);
});
test('local save and portable download/import retain all native origins and exact saved pixels', async ({ page }) => {
  await launch(page); await page.getByLabel('Grundpose', { exact: true }).selectOption('fino-sleeping-128');
  await page.getByRole('button', { name: 'Frame aus Grundpose', exact: true }).click();
  await page.getByLabel('Grundpose', { exact: true }).selectOption('fino-reading-128');
  await page.getByRole('button', { name: 'Sitzung lokal sichern', exact: true }).click();
  await expect(page.locator('.ab-status')).toContainText('Sitzung lokal gesichert.');
  const before = await state(page); expect(before.dirty).toBe(false); expect(before.originCount).toBe(2);
  await page.getByText('Datei', { exact: true }).click(); const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Raster-Dokument exportieren', exact: true }).click();
  const file = await downloading, json = await readFile(await file.path(), 'utf8'); expect(json).toBe(before.json);
  await page.getByLabel('Grundpose', { exact: true }).selectOption('fino-eating-128');
  await page.locator('#ab-document-file').setInputFiles({ name: 'Native-poses.raster128.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('dialog').getByRole('button', { name: 'Importieren', exact: true }).click();
  await expect(page.locator('.ab-status')).toContainText('Native-poses.raster128.json importiert');
  const loaded = await state(page); expect(loaded.json).toBe(before.json); expect(loaded.dirty).toBe(false);
  await expect(page.getByLabel('Grundpose', { exact: true })).toHaveValue('fino-reading-128');
});
