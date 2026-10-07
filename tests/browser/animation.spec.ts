import type * as StoreModule from '../../src/animation/store';
import type * as RasterModule from '../../src/animation/raster';
import type * as EditorModule from '../../src/store/editorStore';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function launch(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Animation Builder Fino zeichnen und animieren',
    })
    .click();
  await expect(page.getByLabel('Raster128 Zeichenfläche')).toBeVisible();
}
async function returnToLauncher(page: Page) {
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.locator('.editor-menu-dialog').getByRole('button', { name: 'Zur Editor-Auswahl' }).click();
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: s } = (await import(
      performance
        .getEntriesByType('resource')
        .filter((e) => new URL(e.name).pathname === path)
        .at(-1)?.name ?? path
    )) as typeof StoreModule;
    return {
      commits: s.commits,
      pixels: [...(s.layer?.pixels ?? [])],
      frames: s.state.frames.length,
      templates: s.templates.length,
      color: s.color,
      pencil: s.pencilSize,
      eraser: s.eraserSize,
      selection: s.selection?.size,
      reference: s.reference ? { visible: s.reference.visible, bounds: s.reference.bounds } : null,
    };
  });
}
async function cell(page: Page, x: number, y: number) {
  const b = (await page.getByLabel('Raster128 Zeichenfläche').boundingBox())!;
  const available = Math.max(128, b.height - 120),
    side = Math.min(b.width, available) * 0.84;
  return {
    x: b.x + (b.width - side) / 2 + ((x + 0.5) * side) / 128,
    y: b.y + (available - side) / 2 + ((y + 0.5) * side) / 128,
  };
}
async function menu(page: Page, label: string, action: string) {
  await page.locator('.ab-menu > summary').getByText(label, { exact: true }).click();
  await page.locator('.ab-menu[open]').getByText(action, { exact: true }).click();
}

test('desktop raster painting, selection move/stretch, picker, frames and history remain native', async ({ page }) => {
  await launch(page);
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  const start = await cell(page, 20, 20), end = await cell(page, 23, 20);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  expect((await state(page)).pixels).toHaveLength(4);
  await page.getByRole('button', { name: 'Pipette', exact: true }).click();
  await page.mouse.click(start.x, start.y);
  await expect(page.getByRole('button', { name: 'Stift', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Rechteckauswahl', exact: true }).click();
  const a = await cell(page, 19, 19), b = await cell(page, 25, 22);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
  const form = page.locator('form').filter({ has: page.getByLabel('Transformation', { exact: true }) });
  await form.getByLabel('X', { exact: true }).fill('1'); await form.getByLabel('Y', { exact: true }).fill('0');
  await form.getByRole('button', { name: 'Anwenden', exact: true }).click();
  expect((await state(page)).pixels.map(([key]) => key)).toEqual([2581, 2582, 2583, 2584]);
  await form.getByLabel('Transformation').selectOption('stretch');
  await form.getByLabel('Y', { exact: true }).fill('1');
  await form.getByRole('button', { name: 'Anwenden', exact: true }).click();
  expect((await state(page)).pixels).toHaveLength(10);
  await page.getByTitle('Rückgängig', { exact: true }).click(); expect((await state(page)).pixels).toHaveLength(4);
  await page.getByTitle('Wiederholen', { exact: true }).click(); expect((await state(page)).pixels).toHaveLength(10);
  await page.getByTitle('Frame duplizieren', { exact: true }).click(); expect((await state(page)).frames).toBe(2);
});

test('editor hamburger menu opens and closes on Raster128', async ({
  page,
}) => {
  await launch(page);
  const trigger = page.getByRole('button', { name: 'Menü öffnen' });
  await expect(trigger).toBeVisible();
  await expect(page.locator('.editor-return-control')).toHaveCount(0);
  await expect(page.locator('.ab-main-menus > :first-child')).toHaveClass(/ab-menu/);
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Menü' })).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(page.getByRole('dialog', { name: 'Menü' })).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Menü' })).toHaveCount(0);
  await trigger.click();
  await page.getByRole('button', { name: 'Fortsetzen' }).click();
  await expect(page.getByRole('dialog', { name: 'Menü' })).toHaveCount(0);

  await page.setViewportSize({ width: 820, height: 1180 });
});

test('reference original RGBA, wheel anchor and editor-only export', async ({ page }) => {
  await launch(page);
  await menu(page, 'Vorlagen', 'Stehend – neutral');
  await expect.poll(async () => (await state(page)).reference !== null).toBe(true);
  const target = await cell(page, 66, 40);
  await page.getByTitle('Pipette aktivieren').click();
  await page.mouse.move(target.x, target.y);
  await page.mouse.wheel(0, -530);
  await page.mouse.wheel(0, 100);
  await page.mouse.click(target.x, target.y);
  const sampled = await state(page);
  const expected = await page.evaluate(async () => {
    const p = '/src/animation/store.ts',
      r = '/src/animation/raster.ts';
    const { animationStore: s } = (await import(
      performance
        .getEntriesByType('resource')
        .filter((e) => new URL(e.name).pathname === p)
        .at(-1)?.name ?? p
    )) as typeof StoreModule;
    const { referenceSample } = (await import(
      performance
        .getEntriesByType('resource')
        .filter((e) => new URL(e.name).pathname === r)
        .at(-1)?.name ?? r
    )) as typeof RasterModule;
    return referenceSample(s.reference, { x: 66, y: 40 });
  });
  expect(sampled.color).toBe(expected);
  expect(sampled.commits).toBe(1);
  await page.screenshot({ path: 'test-results/reference-desktop.png' });
  const download = page.waitForEvent('download');
  await menu(page, 'Datei', 'Frame als PNG exportieren (1024×1024)');
  expect((await download).suggestedFilename()).toContain('1024.png');
});

test('reference alpha coverage hides only its checker cells and follows live movement', async ({ page }) => {
  await launch(page);
  const centers = await page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: s } = (await import(
      performance
        .getEntriesByType('resource')
        .filter((e) => new URL(e.name).pathname === path)
        .at(-1)?.name ?? path
    )) as typeof StoreModule;
    const canvas = document.querySelector<HTMLCanvasElement>('.ab-canvas')!,
      rect = canvas.getBoundingClientRect();
    const available = Math.max(128, canvas.clientHeight - 120),
      side = Math.min(canvas.clientWidth, available) * 0.84,
      left = (canvas.clientWidth - side) / 2,
      top = (available - side) / 2,
      cell = side / 128;
    s.setReference({
      name: 'red-transparent-green',
      width: 3,
      height: 1,
      rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255]),
      bounds: { x: 10, y: 10, width: 3, height: 1 },
      visible: true,
      aligned: false,
    });
    s.selectTool('grab');
    const center = (x: number, y: number) => ({
      x: rect.left + left + (x + 0.5) * cell,
      y: rect.top + top + (y + 0.5) * cell,
    });
    return { start: center(10, 10), moved: center(12, 10), cell };
  });
  const readCells = (referenceX = 10) => page.evaluate((refX: number) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.ab-canvas')!,
      ctx = canvas.getContext('2d')!,
      available = Math.max(128, canvas.clientHeight - 120),
      side = Math.min(canvas.clientWidth, available) * 0.84,
      left = (canvas.clientWidth - side) / 2,
      top = (available - side) / 2,
      cell = side / 128,
      ratioX = canvas.width / canvas.clientWidth,
      ratioY = canvas.height / canvas.clientHeight;
    const readCell = (x: number, y: number) => [...ctx.getImageData(
      Math.floor((left + (x + 0.5) * cell) * ratioX),
      Math.floor((top + (y + 0.5) * cell) * ratioY),
      1,
      1
    ).data];
    return {
      reference: readCell(refX, 10),
      outside: readCell(9, 10),
      transparent: readCell(refX + 1, 10),
      oldPosition: readCell(10, 10),
    };
  }, referenceX);
  let pixels = await readCells();
  expect(pixels.outside.slice(0, 3)).toEqual([34, 38, 42]);
  expect(pixels.reference.slice(0, 3)).toEqual([112, 14, 16]);
  expect(pixels.transparent.slice(0, 3)).toEqual([34, 38, 42]);

  await page.mouse.move(centers.start.x, centers.start.y);
  await page.mouse.down();
  await page.mouse.move(centers.moved.x, centers.moved.y);
  pixels = await readCells(12);
  expect(pixels.oldPosition.slice(0, 3)).toEqual([62, 67, 72]);
  expect(pixels.reference.slice(0, 3)).toEqual([112, 14, 16]);
  expect(pixels.transparent.slice(0, 3)).toEqual([34, 38, 42]);
  await page.mouse.up();
  pixels = await readCells(12);
  expect(pixels.oldPosition.slice(0, 3)).toEqual([62, 67, 72]);
  expect(pixels.reference.slice(0, 3)).toEqual([112, 14, 16]);
});

test('tablet touch drawing, pinch cancels stroke, panels keep canvas geometry', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await launch(page);
  await page.getByLabel('Ausgangszustand', { exact: true }).selectOption('empty');
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  const p = await cell(page, 60, 60);
  await page.touchscreen.tap(p.x, p.y);
  expect((await state(page)).pixels).toHaveLength(1);
  const before = await state(page),
    cd = await context.newCDPSession(page);
  await cd.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: p.x - 60, y: p.y, id: 1 },
      { x: p.x + 60, y: p.y, id: 2 },
    ],
  });
  await cd.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: p.x - 100, y: p.y - 20, id: 1 },
      { x: p.x + 100, y: p.y + 20, id: 2 },
    ],
  });
  await cd.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  expect((await state(page)).commits).toBe(before.commits);
  const box = await page.getByLabel('Raster128 Zeichenfläche').boundingBox();
  await page.getByTitle('Inspektor', { exact: true }).click();
  expect(await page.getByLabel('Raster128 Zeichenfläche').boundingBox()).toEqual(box);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/tablet.png' });
  await context.close();
});

test('reference only moves with Grab, undo restores it, brush popup scrolls without a scrollbar', async ({
  page,
}) => {
  await launch(page);
  await page.getByLabel('Ausgangszustand', { exact: true }).selectOption('empty');
  await menu(page, 'Vorlagen', 'Stehend – neutral');
  await expect.poll(async () => (await state(page)).reference !== null).toBe(true);
  await page.getByRole('button', { name: /Referenz · nur Editor/ }).click();
  const before = await state(page),
    a = await cell(page, 55, 35),
    b = await cell(page, 63, 39);
  const drag = async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
  };
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  await drag();
  expect((await state(page)).reference).toEqual(before.reference);
  expect((await state(page)).pixels.length).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Radierer', exact: true }).click();
  await drag();
  expect((await state(page)).reference).toEqual(before.reference);
  expect((await state(page)).pixels).toHaveLength(0);
  await page.getByRole('button', { name: 'Layer greifen', exact: true }).click();
  await drag();
  expect((await state(page)).reference?.bounds.x).toBe(before.reference!.bounds.x + 8);
  expect((await state(page)).reference?.bounds.y).toBe(before.reference!.bounds.y + 4);
  await page.getByTitle('Rückgängig', { exact: true }).click();
  expect((await state(page)).reference).toEqual(before.reference);
  await page.getByTitle('Wiederholen', { exact: true }).click();
  expect((await state(page)).reference?.bounds.x).toBe(before.reference!.bounds.x + 8);
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  const brush = page.getByLabel('Werkzeuggröße', { exact: true });
  const toolBounds = (await page.getByRole('button', { name: 'Stift', exact: true }).boundingBox())!;
  const brushBounds = (await brush.boundingBox())!;
  expect(brushBounds.x - toolBounds.x - toolBounds.width).toBe(8);
  await brush.click();
  const popup = page.getByRole('listbox', { name: 'Werkzeuggrößen' });
  await popup.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => popup.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(
    await popup.evaluate((el) => ({
      standard: getComputedStyle(el).scrollbarWidth,
      webkit: getComputedStyle(el, '::-webkit-scrollbar').display,
    }))
  ).toEqual({ standard: 'none', webkit: 'none' });
  await page.getByRole('option', { name: '8×8', exact: true }).click();
  await expect(brush).toHaveText('8×8 ▾');
});

test('existing 3D editor creates geometry and retains dirty project on return', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Asset Editor 3D-Objekte gestalten und exportieren',
    })
    .click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menü öffnen' })).toBeVisible();
  await expect(page.locator('.editor-return-control')).toHaveCount(0);
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await expect(page.getByRole('dialog', { name: 'Menü' })).toBeVisible();
  await page.getByRole('button', { name: 'Fortsetzen' }).click();
  const count = async () =>
    page.evaluate(async () => {
      const p = '/src/store/editorStore.ts';
      const { useEditorStore } = (await import(
        performance
          .getEntriesByType('resource')
          .filter((e) => new URL(e.name).pathname === p)
          .at(-1)?.name ?? p
      )) as typeof EditorModule;
      return useEditorStore.getState().objects.length;
    });
  const initial = await count();
  await page
    .getByRole('button', { name: /Würfel/ })
    .first()
    .click();
  await expect.poll(count).toBe(initial + 1);
  await returnToLauncher(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Zur Auswahl', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Animation Builder Fino zeichnen und animieren',
    })
    .click();
  await page.keyboard.press('Control+z');
  expect(await count()).toBe(initial + 1);
  await returnToLauncher(page);
  await page
    .getByRole('button', {
      name: 'Asset Editor 3D-Objekte gestalten und exportieren',
    })
    .click();
  expect(await count()).toBe(initial + 1);
});
