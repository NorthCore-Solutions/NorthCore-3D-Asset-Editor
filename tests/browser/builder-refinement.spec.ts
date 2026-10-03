import { expect, test } from '@playwright/test';

for (const touch of [false, true]) {
  for (const legacy of [false, true]) {
    test(`Builder library, menus and controls: ${legacy ? 'Legacy1024' : 'Raster128'} ${touch ? 'tablet' : 'desktop'}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: touch ? { width: 820, height: 1180 } : { width: 1440, height: 1000 }, hasTouch: touch, isMobile: touch });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren' }).click();
      if (legacy) await page.getByLabel('Editor-Modus', { exact: true }).selectOption('legacy1024');
      await expect(page.locator('.ab-canvas')).toBeVisible();
      const bounds = await page.locator('.ab-canvas').boundingBox();
      if (touch) await page.getByRole('button', { name: 'Dateien / Vorlagen einblenden', exact: true }).click();
      const library = page.locator('.ab-left');
      await expect(library.getByRole('tab', { name: 'Dateien', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(library.getByRole('button', { name: '＋ Neue Animation', exact: true })).toBeVisible();
      if (!legacy) {
        const newButton = (await library.getByRole('button', { name: '＋ Neue Animation', exact: true }).boundingBox())!;
        const saveButton = (await library.getByRole('button', { name: 'Sitzung lokal sichern', exact: true }).boundingBox())!;
        expect(saveButton.y - newButton.y - newButton.height).toBeGreaterThanOrEqual(8);
      }
      await library.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
      await expect(library.getByRole('tabpanel')).toHaveAccessibleName('Vorlagen');
      await expect(library.getByRole('heading', { name: 'Pixel-Vorlagen', exact: true })).toBeVisible();
      await expect(library.getByRole('button', { name: '＋ Neue Animation', exact: true })).toHaveCount(0);
      expect(await library.locator('.ab-library-content').evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
      await library.getByRole('tab', { name: 'Dateien', exact: true }).click();
      expect(await page.locator('.ab-canvas').boundingBox()).toEqual(bounds);

      const summary = (name: string) => page.locator('.ab-menu > summary').getByText(name, { exact: true });
      const open = page.locator('.ab-main-menus .ab-menu[open]');
      if (touch) {
        await summary('Datei').tap();
        await summary('Bearbeiten').tap();
      } else {
        await summary('Datei').hover();
        await expect(open).toHaveCount(0); // First opening requires a click.
        await summary('Datei').click();
        await summary('Bearbeiten').hover();
      }
      await expect(open).toHaveCount(1);
      await expect(open.locator('summary')).toHaveText('Bearbeiten');
      // Clicking another heading leaves its dropdown open, even after hover switching.
      if (touch) await summary('Datei').tap(); else await summary('Datei').click();
      await expect(open).toHaveCount(1);
      await expect(open.locator('summary')).toHaveText('Datei');
      await expect(open.getByText(legacy ? 'PNG exportieren' : 'Frame als PNG exportieren (1024×1024)', { exact: true })).toBeVisible();
      await expect(page.locator('.ab-toolbar').getByTitle('PNG exportieren', { exact: true })).toHaveCount(0);
      expect(await open.locator('div[role="menu"]').evaluate((element) => getComputedStyle(element).scrollbarWidth)).toBe('thin');
      await page.keyboard.press('Escape');
      await expect(open).toHaveCount(0);
      if (!touch) {
        await summary('Datei').click();
        const menuBox = (await open.locator('div[role="menu"]').boundingBox())!;
        await page.mouse.move(menuBox.x + 30, menuBox.y + 12);
        await expect(open).toHaveCount(1); // Moving into the dropdown must not close it.
        await page.mouse.move(700, 500);
        await expect(open).toHaveCount(0);
      }
      await summary('Vorlagen').click();
      await open.getByText('Vorlagen anzeigen', { exact: true }).click();
      await expect(library.getByRole('tab', { name: 'Vorlagen', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(open).toHaveCount(0);

      for (const name of ['Rechteckauswahl', 'Polygonauswahl']) {
        const tool = page.locator('.ab-toolbar').getByRole('button', { name, exact: true });
        const centered = await tool.evaluate((element) => {
          const button = element.getBoundingClientRect(), icon = element.querySelector('svg')!.getBoundingClientRect();
          return { dx: Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2), dy: Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2), width: icon.width, height: icon.height };
        });
        expect(centered.dx).toBeLessThan(0.1);
        expect(centered.dy).toBeLessThan(0.1);
        expect(centered.width).toBe(16);
        expect(centered.height).toBe(16);
      }
      await summary('Datei').click();
      await open.getByText('Neue Animation', { exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.ab-dialog-body')).toBeVisible();
      expect(await dialog.locator('footer').evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('1px');
      const dialogBox = (await dialog.boundingBox())!;
      expect(dialogBox.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(touch ? 1180 : 1000);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(await page.locator('.ab-canvas').boundingBox()).toEqual(bounds);
      await page.screenshot({ path: `test-results/builder-refined-${legacy ? 'legacy' : 'raster'}-${touch ? 'tablet' : 'desktop'}.png` });
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}
