import { test, expect } from '@playwright/test';

for (const device of [
  { name: 'desktop', width: 1440, height: 1000, touch: false },
  { name: 'tablet', width: 820, height: 1180, touch: true },
]) {
  for (const legacy of [false, true]) {
    test(`shared Builder UI: ${legacy ? 'Legacy1024' : 'Raster128'} ${device.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, hasTouch: device.touch, isMobile: device.touch });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren' }).click();
      if (legacy) await page.getByLabel('Editor-Modus', { exact: true }).selectOption('legacy1024');
      const canvas = page.locator('.ab-canvas');
      await expect(canvas).toBeVisible();
      await expect(page.locator('.ab-panel')).toHaveCount(3);
      await expect(page.locator('.ab-title')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Zeichnen', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ansicht verschieben', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Layer greifen', exact: true })).toBeVisible();
      expect(await page.locator('.ab-menubar').evaluate((element) => element.getBoundingClientRect().height)).toBe(device.touch ? 44 : 38);
      const originalBounds = await canvas.boundingBox();
      const left = page.locator('.ab-left');
      const right = page.locator('.ab-right');
      if (device.touch) {
        await expect(left).toHaveClass(/is-collapsed/);
        await expect(right).toHaveClass(/is-collapsed/);
      }
      // Mounted content retains unsaved input values, but is inert when collapsed.
      if (await right.evaluate((element) => element.classList.contains('is-collapsed')))
        await page.getByRole('button', { name: 'Inspektor einblenden', exact: true }).click();
      const duration = right.locator('input[name="duration"]').first();
      await duration.fill('731');
      await page.getByRole('button', { name: 'Inspektor ausblenden', exact: true }).click();
      await expect(right.locator('.ab-panel-content')).toHaveAttribute('inert', '');
      await duration.focus();
      expect(await duration.evaluate((element) => document.activeElement === element)).toBe(false);
      await page.getByRole('button', { name: 'Inspektor einblenden', exact: true }).click();
      await expect(duration).toHaveValue('731');
      await page.getByRole('button', { name: 'Dateien / Vorlagen ' + (device.touch ? 'einblenden' : 'ausblenden'), exact: true }).click();
      if (device.touch) await expect(right).toHaveClass(/is-collapsed/);
      expect(await canvas.boundingBox()).toEqual(originalBounds);
      const timeline = page.locator('.ab-timeline');
      await page.getByRole('button', { name: 'Timeline ausblenden', exact: true }).click();
      await expect(timeline).toHaveClass(/is-collapsed/);
      await expect(timeline.locator('.ab-panel-content')).toHaveAttribute('inert', '');
      expect(await canvas.boundingBox()).toEqual(originalBounds);
      await page.getByRole('button', { name: 'Timeline einblenden', exact: true }).click();
      await expect(timeline).not.toHaveClass(/is-collapsed/);
      expect(await timeline.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0.16s');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await timeline.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
      await page.locator('.ab-toolbar').getByTitle('Abspielen', { exact: true }).click();
      await expect(page.locator('.ab-toolbar').getByTitle('Pause', { exact: true })).toBeVisible();
      await page.locator('.ab-toolbar').getByTitle('Pause', { exact: true }).click();
      await page.screenshot({ path: `test-results/builder-${legacy ? 'legacy' : 'raster'}-${device.name}.png` });
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test('long animation names survive resize; collapse never changes canvas pixels or transform', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren' }).click();
  await page.locator('.ab-menu > summary').getByText('Bearbeiten', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Animation umbenennen …', exact: true }).click();
  const longName = 'Eine sehr lange Animation mit vielen Worten für die sichtbare Kopfzeile';
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(longName);
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter');
  await expect(page.locator('.ab-title')).toHaveText(longName);
  const pixels = () => page.locator('.ab-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    // Common top-left canvas region remains at exactly the same screen coordinates on resize.
    const data = canvas.getContext('2d')!.getImageData(0, 0, 600, 600).data;
    let hash = 2166136261;
    for (const value of data) hash = Math.imul(hash ^ value, 16777619);
    return hash >>> 0;
  });
  const before = await pixels();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('.ab-left')).toHaveClass(/is-collapsed/);
  await expect(page.locator('.ab-right')).toHaveClass(/is-collapsed/);
  await expect(page.locator('.ab-title')).toBeVisible();
  expect(await page.locator('.ab-title').evaluate((element) => getComputedStyle(element).textOverflow)).toBe('ellipsis');
  await expect.poll(pixels).toEqual(before);
  const toolbar = page.locator('.ab-toolbar');
  expect(await toolbar.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByTitle('Wiederholen', { exact: true }).scrollIntoViewIfNeeded();
  expect(await toolbar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.ab-brand')).toBeVisible();
  await expect.poll(pixels).toEqual(before);
});
