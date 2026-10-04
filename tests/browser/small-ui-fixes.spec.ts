import { test, expect } from '@playwright/test';
import { EDITOR_VERSION } from '../../src/app/version';

for (const tablet of [false, true]) {
  for (const mode of ['asset', 'raster128']) {
    test(`small UI fixes: ${mode} ${tablet ? 'tablet' : 'desktop'}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: tablet ? { width: 820, height: 1180 } : { width: 1440, height: 1000 }, hasTouch: tablet, isMobile: tablet });
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.getByRole('heading', { name: `Northcore Editor ${EDITOR_VERSION}`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: mode === 'asset' ? 'Asset Editor 3D-Objekte gestalten und exportieren' : 'Animation Builder Fino zeichnen und animieren' }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const isAsset = mode === 'asset';
      const panel = page.locator(isAsset ? '.hierarchy' : '.ab-timeline');
      const toggle = panel.locator(isAsset ? '.panel-collapse-button' : '.ab-collapse');
      const sidebar = page.locator(isAsset ? '.left-panel .panel-collapse-button' : '.ab-left .ab-collapse');
      await expect(toggle).toBeVisible();
      const sideSize = await sidebar.boundingBox();
      const geometry = () => toggle.evaluate((element) => {
        const button = element.getBoundingClientRect(), icon = element.querySelector('svg')!.getBoundingClientRect();
        const header = element.closest('.hierarchy-header,.ab-panel-header')!.getBoundingClientRect();
        return { width: button.width, height: button.height, iconWidth: icon.width, iconHeight: icon.height, dx: Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2), dy: Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2), right: header.right - button.right, cy: button.y + button.height / 2 - header.top };
      });
      const before = await geometry();
      expect(before.width).toBe(tablet ? 36 : 22); // Historical desktop/touch hit areas.
      expect(before.height).toBe(tablet ? 36 : 22);
      expect(before.width).toBe(sideSize!.width);
      expect(before.height).toBe(sideSize!.height);
      expect(before.dx).toBeLessThan(0.1);
      expect(before.dy).toBeLessThan(0.1);
      await toggle.click();
      const after = await geometry();
      expect(after).toEqual(before); // Only direction changes; the header-relative position and box stay fixed.
      await toggle.click();
      expect(await geometry()).toEqual(before);
      // Check the visible contour, not only its SVG box: font metrics previously hid this drift.
      const headerBoxes = () => page.locator(isAsset ? '.topbar' : '.ab-menubar').evaluate((element) =>
        Array.from(element.children).map((child) => {
          const rect = child.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }));
      const originalHeader = await headerBoxes();
      for (const side of isAsset ? ['.left-panel', '.right-panel', '.hierarchy'] : ['.ab-left', '.ab-right', '.ab-timeline']) {
        const control = page.locator(side).locator(isAsset ? '.panel-collapse-button' : '.ab-collapse');
        const contourGeometry = () => control.evaluate((element) => {
          const button = element.getBoundingClientRect();
          const path = element.querySelector('svg path') as SVGGraphicsElement;
          const box = path.getBBox(), matrix = path.getScreenCTM()!;
          const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix);
          return { width: button.width, height: button.height, dx: center.x - button.x - button.width / 2, dy: center.y - button.y - button.height / 2, rotation: path.getAttribute('transform') };
        });
        const original = await contourGeometry();
        for (let cycle = 0; cycle < 4; cycle++) {
          await control.click();
          const current = await contourGeometry();
          expect(Math.abs(current.dx)).toBeLessThan(0.001);
          expect(Math.abs(current.dy)).toBeLessThan(0.001);
          expect(current.width).toBe(original.width);
          expect(current.height).toBe(original.height);
          expect(current.rotation === original.rotation).toBe(cycle % 2 === 1);
          expect(await headerBoxes()).toEqual(originalHeader);
        }
      }
      if (isAsset) {
        await expect(page.locator('.topbar .brand')).toHaveText('Northcore 3D Asset Editor');
        await expect(page.locator('.topbar .brand')).not.toContainText(EDITOR_VERSION);
        if (!tablet) {
          const header = await page.locator('.topbar').evaluate((element) => {
            const menu = element.querySelector('.menu:last-of-type')!.getBoundingClientRect();
            const title = element.querySelector('.brand')!.getBoundingClientRect();
            const project = element.querySelector('.project-name')!.getBoundingClientRect();
            return { gap: project.left - menu.right, dy: Math.abs(title.top + title.height / 2 - menu.top - menu.height / 2), titleLeft: title.left, projectRight: project.right, projectWidth: project.width, projectHeight: project.height, height: element.getBoundingClientRect().height };
          });
          expect(header.gap).toBe(16); // Original project position: 12px margin plus the 4px topbar gap.
          expect(header.dy).toBeLessThan(0.1);
          expect(header.titleLeft).toBeGreaterThan(header.projectRight);
          expect(header.projectWidth).toBe(230);
          expect(header.projectHeight).toBe(26);
          expect(header.height).toBe(38);
        }
      } else {
        if (tablet) await page.getByRole('button', { name: 'Inspektor einblenden', exact: true }).click();
        const inspector = page.locator('.ab-right');
        const add = inspector.getByTitle('Pixel-Layer hinzufügen', { exact: true });
        await add.click();
        const checkGap = async () => {
          const addBox = (await add.boundingBox())!, first = (await inspector.locator('.ab-layer').first().boundingBox())!;
          expect(first.y - addBox.y - addBox.height).toBeGreaterThanOrEqual(7);
        };
        await checkGap();
        await add.click();
        await checkGap();
        const fit = page.locator('.ab-toolbar').getByRole('button', { name: 'Einpassen', exact: true });
        await expect(fit).toHaveAttribute('title', 'Zoom zurücksetzen');
        const fitGeometry = await fit.evaluate((element) => {
          const box = element.getBoundingClientRect(), icon = element.querySelector('svg')!.getBoundingClientRect(), text = element.querySelector('.ab-fit-width')!.getBoundingClientRect(), css = getComputedStyle(element);
          return { width: box.width, oldWidth: text.width + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth), dx: Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2), dy: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2), iconWidth: icon.width, iconHeight: icon.height };
        });
        expect(fitGeometry.width).toBeCloseTo(fitGeometry.oldWidth, 1);
        expect(fitGeometry.dx).toBeLessThan(0.1);
        expect(fitGeometry.dy).toBeLessThan(0.1);
        expect(fitGeometry.iconWidth).toBe(16);
        expect(fitGeometry.iconHeight).toBe(16);
        await page.locator('.ab-toolbar').getByTitle('Hineinzoomen', { exact: true }).click();
        await fit.click();
        // Check the exact existing fit geometry at an empty checker corner, independently of asset/render timing.
        const fitCorner = await page.locator('.ab-canvas').evaluate((element) => {
          const canvas = element as HTMLCanvasElement, box = canvas.getBoundingClientRect(), available = Math.max(128, box.height - 120);
          const side = Math.min(box.width, available) * 0.84, x = (box.width - side) / 2, y = (available - side) / 2;
          const cell = side / 128, ratio = canvas.width / box.width;
          const rgba = canvas.getContext('2d')!.getImageData(Math.floor((x + cell / 2) * ratio), Math.floor((y + cell / 2) * ratio), 1, 1).data;
          return [...rgba];
        });
        expect(fitCorner).toEqual([62, 67, 72, 255]);
      }
      await page.screenshot({ path: `test-results/small-ui-${mode}-${tablet ? 'tablet' : 'desktop'}.png` });
      await context.close();
    });
  }
}
