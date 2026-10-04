import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type * as Store from '../../src/animation/store';
import type * as Raster from '../../src/animation/raster';
import type * as Files from '../../src/animation/files';

test.use({ hasTouch: true });
async function launch(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const module = (path: string) => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
    const { animationStore: store } = await import(module('/src/animation/store.ts')) as typeof Store;
    const { Viewport } = await import(module('/src/animation/raster.ts')) as typeof Raster;
    store.viewport = new Viewport(350, 100, 4);
  });
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await page.getByRole('button', { name: 'Natives Gesicht vorbereiten', exact: true }).click();
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const module = (path: string) => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
    const { animationStore: store } = await import(module('/src/animation/store.ts')) as typeof Store;
    const { serializeSession } = await import(module('/src/animation/files.ts')) as typeof Files;
    const { render } = await import(module('/src/animation/raster.ts')) as typeof Raster;
    return { json: serializeSession(store), dirty: store.dirty, past: store.past.length,
      preview: [...render(store.displayFrame.layers)], pixels: [...render(store.frame.layers)], draft: store.faceDraft?.face, selected: store.selectedFaceSlot };
  });
}
async function drag(page: Page, touch: boolean, from: { x: number; y: number }, dx: number, dy: number) {
  if (touch) {
    const session = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(from.x + dx, from.y + dy) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 }); await page.mouse.up();
  }
}
for (const touch of [false, true]) test(`${touch ? 'touch' : 'mouse'} slot drag, integer preview, commit, Undo/Redo and stable Canvas`, async ({ page }) => {
  await launch(page); const before = await state(page), canvas = page.getByLabel('Raster128 Zeichenfläche'), bounds = (await canvas.boundingBox())!;
  const eye = before.draft!.slots.leftEye;
  await drag(page, touch, { x: bounds.x + 350 + (eye.x + eye.width / 2) * 4, y: bounds.y + 100 + (eye.y + eye.height / 2) * 4 }, 13, 9);
  await expect(page.getByLabel('Face x', { exact: true })).toHaveValue('72');
  await expect(page.getByLabel('Face y', { exact: true })).toHaveValue('14');
  const preview = await state(page); expect(preview.json).toBe(before.json); expect(preview.past).toBe(before.past); expect(preview.dirty).toBe(false);
  await page.getByLabel('Face-Variante', { exact: true }).selectOption('happy');
  const toCommit = await state(page);
  await page.getByRole('button', { name: 'Gesicht übernehmen', exact: true }).click();
  const committed = await state(page); expect(committed.pixels).toEqual(toCommit.preview); expect(committed.past).toBe(before.past + 1);
  expect(await canvas.boundingBox()).toEqual(bounds);
  await canvas.focus(); await page.keyboard.press('Control+z'); expect((await state(page)).json).toBe(before.json);
  await page.keyboard.press('Control+Shift+z'); expect((await state(page)).json).toBe(committed.json);
});
test('zoom/pan leave handles in CSS coordinates; pointer cancellation and Escape do not commit', async ({ page }) => {
  await launch(page); const canvas = page.getByLabel('Raster128 Zeichenfläche'), b = (await canvas.boundingBox())!, before = await state(page);
  // Pan with the middle button, then zoom exactly 2x around the moved left-eye center.
  await page.mouse.move(b.x + 800, b.y + 220); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(b.x + 830, b.y + 240); await page.mouse.up({ button: 'middle' });
  const eye = before.draft!.slots.leftEye, center = { x: b.x + 380 + (eye.x + eye.width / 2) * 4, y: b.y + 120 + (eye.y + eye.height / 2) * 4 };
  await page.mouse.move(center.x, center.y); await page.mouse.wheel(0, -Math.log(2) / 0.002);
  await expect.poll(async () => (await canvas.evaluate((c) => (c as HTMLCanvasElement).width)) > 0).toBe(true);
  await drag(page, true, center, 24, 16);
  await expect(page.getByLabel('Face x', { exact: true })).toHaveValue('72');
  await expect(page.getByLabel('Face y', { exact: true })).toHaveValue('14');
  const session = await page.context().newCDPSession(page);
  const moved = { x: center.x + 24, y: center.y + 16, id: 1 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [moved] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...moved, x: moved.x + 16 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await session.detach();
  await expect(page.getByLabel('Face x', { exact: true })).toHaveValue('72');
  await canvas.focus(); await page.keyboard.press('Escape'); expect((await state(page)).draft).toBeUndefined();
  expect((await state(page)).json).toBe(before.json); expect((await state(page)).past).toBe(before.past);
});
test('explicit multi-frame retarget, visibility, portable backup/import and no Legacy resource dependency', async ({ page }) => {
  const legacyRequests: string[] = [];
  await page.route('**/animation/legacy/**', (route) => { legacyRequests.push(route.request().url()); return route.abort(); });
  await launch(page); await page.getByLabel('Face-Slot', { exact: true }).selectOption('mouth');
  await page.getByLabel('Face-Variante').selectOption('sad'); await page.getByLabel('Face-Slot sichtbar').uncheck();
  await page.getByRole('button', { name: 'Gesicht übernehmen', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: store } = await import(performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path) as typeof Store;
    store.addFrame(true);
  });
  await page.getByLabel('Face Zielpose').selectOption('sleeping'); await page.getByLabel('Face Frame-Bereich').selectOption('all');
  await page.getByRole('button', { name: 'Gesicht auf Zielpose übertragen', exact: true }).click();
  const current = await state(page);
  const data = JSON.parse(current.json) as Files.RasterSessionV2;
  expect(data.frames).toHaveLength(2);
  expect(data.frames.every((f) => f.nativeFace!.poseId === 'sleeping' && f.nativeFace!.slots.mouth.variant === 'sad' && !f.nativeFace!.slots.mouth.visible)).toBe(true);
  await page.getByText('Datei', { exact: true }).click(); const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Raster-Dokument exportieren', exact: true }).click();
  const download = await downloadPromise, json = await readFile(await download.path(), 'utf8'); expect(json).toBe(current.json);
  await page.getByLabel('Grundpose', { exact: true }).selectOption('fino-reading-128');
  await page.locator('#ab-document-file').setInputFiles({ name: 'Faces.raster128.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('dialog').getByRole('button', { name: 'Importieren', exact: true }).click();
  await expect(page.locator('.ab-status')).toContainText('Faces.raster128.json importiert');
  expect((await state(page)).json).toBe(json); expect((await state(page)).dirty).toBe(false); expect(legacyRequests).toEqual([]);
});
