import type * as StoreModule from '../../src/animation/store';
import type * as RasterModule from '../../src/animation/raster';
import type * as LegacyModule from '../../src/animation/legacyStore';
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
      faces: s.faces.length,
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

test('native mouse strokes, history, sizes, exact picker, exclusive face/template, dialogs and editor return', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await launch(page);
  await page.getByLabel('Grundpose', { exact: true }).selectOption('empty');
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  await page.getByRole('button', { name: 'Werkzeuggröße', exact: true }).click();
  await page.getByRole('option', { name: '4×4', exact: true }).click();
  const a = await cell(page, 52, 38),
    b = await cell(page, 76, 45),
    before = await state(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 2 });
  expect((await state(page)).commits).toBe(before.commits);
  await page.mouse.up();
  const painted = await state(page);
  expect(painted.commits).toBe(before.commits + 1);
  expect(painted.pixels.length).toBeGreaterThan(80);
  await page.getByTitle('Rückgängig', { exact: true }).click();
  expect((await state(page)).pixels).toHaveLength(0);
  await page.getByTitle('Wiederholen', { exact: true }).click();
  expect((await state(page)).pixels).toEqual(painted.pixels);
  await page.getByRole('button', { name: 'Radierer', exact: true }).click();
  await page.getByRole('button', { name: 'Werkzeuggröße', exact: true }).click();
  await page.getByRole('option', { name: '2×2', exact: true }).click();
  await page.mouse.click(a.x, a.y);
  expect((await state(page)).pixels.length).toBe(painted.pixels.length - 4);
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  await expect(page.getByLabel('Werkzeuggröße')).toHaveText('4×4 ▾');
  await page.getByTitle('Pipette aktivieren').click();
  await page.mouse.click(b.x, b.y);
  expect((await state(page)).color).toBe(0xff3366ff);
  await page.getByRole('button', { name: 'Rechteckauswahl', exact: true }).click();
  const p = await cell(page, 46, 32),
    q = await cell(page, 82, 50);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y);
  await page.mouse.up();
  await menu(page, 'Vorlagen', 'Auswahl als Vorlage speichern …');
  await page.getByLabel('Vorlagen-Name').fill('Augen');
  await page.getByLabel('Als Gesichts-Asset speichern').check();
  await page.getByLabel('Vorlagen-Name').press('Enter');
  expect((await state(page)).faces).toBe(1);
  expect((await state(page)).templates).toBe(0);
  await menu(page, 'Vorlagen', 'Auswahl als Vorlage speichern …');
  await page.getByLabel('Vorlagen-Name').fill('Pinselspur');
  await page.getByLabel('Vorlagen-Name').press('Enter');
  expect((await state(page)).templates).toBe(1);
  await page.getByTitle('Farbe auswählen', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('RGBA Hex').fill('#12345601');
  await page.getByRole('dialog').getByLabel('RGBA Hex').press('Enter');
  expect((await state(page)).color).toBe(0x12345601);
  await page.getByTitle('Neue Animation', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Abbrechen');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(page)).pixels).not.toHaveLength(0);
  await page.getByRole('button', { name: '‹ Auswahl', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zur Auswahl', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Animation Builder Fino zeichnen und animieren',
    })
    .click();
  expect((await state(page)).faces).toBe(1);
  expect((await state(page)).templates).toBe(1);
  expect(errors).toEqual([]);
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
  await page.getByTitle('PNG exportieren', { exact: true }).click();
  expect((await download).suggestedFilename()).toContain('1024.png');
});

test('tablet touch drawing, pinch cancels stroke, panels keep canvas geometry', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await launch(page);
  await page.getByLabel('Grundpose', { exact: true }).selectOption('empty');
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

test('legacy loads with original rigs and retains frames across switching', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await launch(page);
  await page.getByRole('button', { name: 'Legacy 1024' }).click();
  await expect(page.getByLabel('Legacy Zeichenfläche 1024')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const p = '/src/animation/legacyStore.ts';
        const { legacyStore: s } = (await import(
          performance
            .getEntriesByType('resource')
            .filter((e) => new URL(e.name).pathname === p)
            .at(-1)?.name ?? p
        )) as typeof LegacyModule;
        return !!s.image;
      })
    )
    .toBe(true);
  await page.getByTitle('Neue Animation', { exact: true }).click();
  await page.getByRole('dialog').getByLabel('Start').selectOption('preset');
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter');
  await expect(page.getByText('Face-Rig V2', { exact: true })).toBeVisible();
  await page.getByTitle('Frame duplizieren', { exact: true }).click();
  await page.getByRole('button', { name: 'Raster128', exact: true }).click();
  await page.getByRole('button', { name: 'Legacy 1024' }).click();
  await expect(page.getByRole('button', { name: 'Frame 2 400 ms', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'idle_breathing.finoanim.json', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.ab-title')).not.toHaveText('Neue Animation');
  await page.getByLabel('Arbeitsbereich', { exact: true }).selectOption('Pixel');
  await expect(page.getByTitle('Information: Gesicht', { exact: true })).toHaveCount(0);
  await page.getByLabel('Arbeitsbereich', { exact: true }).selectOption('Kombiniert');
  await expect(page.getByTitle('Information: Gesicht', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/legacy.png' });
  expect(errors).toEqual([]);
});

test('reference only moves with Grab, undo restores it, brush popup scrolls without a scrollbar', async ({
  page,
}) => {
  await launch(page);
  await page.getByLabel('Grundpose', { exact: true }).selectOption('empty');
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
  await page.getByRole('button', { name: '‹ Editor-Auswahl', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zur Auswahl', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Animation Builder Fino zeichnen und animieren',
    })
    .click();
  await page.keyboard.press('Control+z');
  expect(await count()).toBe(initial + 1);
  await page.getByRole('button', { name: '‹ Auswahl', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Asset Editor 3D-Objekte gestalten und exportieren',
    })
    .click();
  expect(await count()).toBe(initial + 1);
});
