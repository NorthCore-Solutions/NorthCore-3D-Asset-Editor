import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openAssetEditor(page: Page) {
  await page.getByRole('button', {
    name: 'Asset Editor 3D-Objekte gestalten und exportieren', exact: true,
  }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function expectFullAssetLayout(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector('#root')!.getBoundingClientRect();
    const shell = document.querySelector('.app-shell')!.getBoundingClientRect();
    const workspace = document.querySelector('.workspace')!.getBoundingClientRect();
    const returnControl = document.querySelector('.asset-editor-host .editor-return-control')!.getBoundingClientRect();
    const hierarchy = document.querySelector('.workspace > .hierarchy')!.getBoundingClientRect();
    const viewport = document.querySelector('.viewport')?.getBoundingClientRect();
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
    const top = document.querySelector('.topbar')!.getBoundingClientRect().height;
    const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect().height;
    const status = document.querySelector('.statusbar')!.getBoundingClientRect().height;
    return Math.abs(shell.height - root.height) < 1
      && Math.abs(shell.width - root.width) < 1
      && Math.abs(workspace.height - (root.height - top - toolbar - status)) < 1
      && workspace.height > 200
      && viewport?.height === workspace.height
      && !!canvas && canvas.width > 300 && canvas.height > 150
      && Math.abs(canvas.getBoundingClientRect().height - workspace.height) < 1
      && returnControl.left >= 0
      && returnControl.bottom <= hierarchy.top + 1;
  }), { timeout: 5000 }).toBe(true);
}

for (const device of [
  { name: 'desktop', width: 1440, height: 1000, touch: false },
  { name: 'desktop minimum', width: 1280, height: 720, touch: false },
  { name: 'tablet portrait', width: 820, height: 1180, touch: true },
  { name: 'coarse pointer above width breakpoint', width: 1366, height: 768, touch: true },
]) {
  test(`3D layout fills root on ${device.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.touch,
      isMobile: device.touch,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await openAssetEditor(page);
    await expectFullAssetLayout(page);
    if (device.touch) {
      await page.getByRole('button', { name: 'Inventar einblenden', exact: true }).click();
      await expect(page.locator('.left-panel')).not.toHaveClass(/panel-collapsed/);
      await expectFullAssetLayout(page);
    } else {
      await expect(page.locator('.left-panel')).not.toHaveClass(/panel-collapsed/);
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('layout survives resizing and editor switches with hidden host and remounted viewport', async ({ page }) => {
  await page.goto('/');
  await openAssetEditor(page);
  await expectFullAssetLayout(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectFullAssetLayout(page);
  await page.getByRole('button', { name: '‹ Editor-Auswahl', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeHidden();
  await expect(page.locator('.viewport')).toHaveCount(0);
  await page.getByRole('button', {
    name: 'Animation Builder Fino zeichnen und animieren', exact: true,
  }).click();
  await expect(page.getByLabel('Raster128 Zeichenfläche')).toBeVisible();
  expect(await page.locator('.animation-builder').evaluate((el) =>
    Math.abs(el.getBoundingClientRect().height - innerHeight) < 1)).toBe(true);
  await expect(page.locator('.ab-menubar > :first-child')).toHaveClass(/ab-menu/);
  await expect(page.locator('.ab-menubar button[title="Zur Editor-Auswahl"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '‹ Editor-Auswahl', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editor-Auswahl einklappen' }).click();
  await expect(page.getByRole('button', { name: '‹ Editor-Auswahl', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Editor-Auswahl einblenden' }).click();
  await expect(page.locator('.app-shell')).toBeHidden();
  await page.getByRole('button', { name: '‹ Editor-Auswahl', exact: true }).click();
  await openAssetEditor(page);
  await expectFullAssetLayout(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectFullAssetLayout(page);
});
