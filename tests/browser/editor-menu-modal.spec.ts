import { expect, test, type Page } from '@playwright/test';
import type * as EditorModule from '../../src/store/editorStore';
import type * as RasterModule from '../../src/animation/store';
import type * as FiberModule from '@react-three/fiber';
import type { Camera } from 'three';

declare global {
  interface Window {
    menuModalProbe: { dialog: HTMLDialogElement; gap: boolean; observer: MutationObserver };
    menuCamera: Camera;
    menuCanvas: HTMLCanvasElement;
  }
}
type Mode = 'asset' | 'raster';
const dialog = (page: Page) => page.locator('dialog[data-editor-menu]');
const trigger = (page: Page) => page.getByRole('button', { name: 'Menü öffnen', exact: true });
async function launch(page: Page, mode: Mode) {
  await page.goto('/');
  await page.getByRole('button', { name: mode === 'asset' ? 'Asset Editor 3D-Objekte gestalten und exportieren' : 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.locator(mode === 'asset' ? '.viewport canvas' : '.ab-canvas')).toBeVisible();
  await page.evaluate(async (mode) => {
    const path = mode === 'asset' ? '/src/store/editorStore.ts' : '/src/animation/store.ts';
    const url = performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname === path).at(-1)?.name ?? path;
    if (mode === 'asset') {
      const { useEditorStore } = await import(url) as typeof EditorModule;
      useEditorStore.getState().addObject('box');
      useEditorStore.getState().setProjectName('Dirty menu test');
    } else if (mode === 'raster') {
      const { animationStore } = await import(url) as typeof RasterModule;
      animationStore.duration(250);
    }
  }, mode);
}
async function content(page: Page, mode: Mode) {
  return page.evaluate(async (mode) => {
    const path = mode === 'asset' ? '/src/store/editorStore.ts' : '/src/animation/store.ts';
    const url = performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname === path).at(-1)?.name ?? path;
    if (mode === 'asset') {
      const { useEditorStore } = await import(url) as typeof EditorModule;
      const s = useEditorStore.getState();
      return JSON.stringify([s.objects, s.project, s.selectedIds, s.tool, s.past.length, s.future.length]);
    } else if (mode === 'raster') {
      const { animationStore: s } = await import(url) as typeof RasterModule;
      return JSON.stringify([s.state, s.tool, s.past.length, s.future.length]);
    }
  }, mode);
}

for (const mode of ['asset', 'raster'] as const) {
  test(`${mode}: native modality, focus cycle, shortcut blocking, Escape and stable canvas`, async ({ page }) => {
    await launch(page, mode);
    const canvas = page.locator(mode === 'asset' ? '.viewport canvas' : '.ab-canvas');
    const originalBounds = await canvas.boundingBox();
    const before = await content(page, mode);
    await trigger(page).click();
    await expect(dialog(page)).toBeVisible();
    expect(await dialog(page).evaluate((d) => d.matches(':modal'))).toBe(true);
    await expect(dialog(page).getByRole('button', { name: 'Fortsetzen', exact: true })).toBeFocused();
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Tab']) {
      await page.keyboard.press(key);
      expect(await dialog(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    // Programmatic focus also cannot escape native modality.
    const backgroundControl = mode === 'asset' ? page.getByLabel('Projektname') : page.getByRole('button', { name: 'Stift', exact: true });
    await backgroundControl.evaluate((element) => (element as HTMLElement).focus());
    await expect(backgroundControl).not.toBeFocused();
    expect(await dialog(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
    for (const key of ['Control+z', 'Control+Shift+z', 'Control+y', 'Delete', 'Backspace', 'r', 's', 'f', 'w', 'e']) await page.keyboard.press(key);
    expect(await content(page, mode)).toBe(before);
    expect(await canvas.boundingBox()).toEqual(originalBounds);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    expect(await content(page, mode)).toBe(before);
    expect(await canvas.boundingBox()).toEqual(originalBounds);
    await trigger(page).click();
    await dialog(page).getByRole('button', { name: 'Fortsetzen', exact: true }).click();
    await expect(trigger(page)).toBeFocused();
  });

  test(`${mode}: dirty confirmation uses the same uninterrupted modal dialog`, async ({ page }) => {
    await launch(page, mode);
    const before = await content(page, mode);
    await trigger(page).click();
    await dialog(page).evaluate((element) => {
      const d = element as HTMLDialogElement;
      const observer = new MutationObserver((records) => {
        if (!d.isConnected || !d.open || records.some((record) => record.target === d && record.attributeName === 'open')) window.menuModalProbe.gap = true;
      });
      observer.observe(document.body, { subtree: true, attributes: true, childList: true });
      window.menuModalProbe = { dialog: d, gap: false, observer };
    });
    await dialog(page).getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
    await expect(dialog(page).getByRole('heading')).toHaveText('Zur Editor-Auswahl?');
    expect(await page.evaluate(() => !window.menuModalProbe.gap && window.menuModalProbe.dialog === document.querySelector('dialog[data-editor-menu]') && window.menuModalProbe.dialog.matches(':modal'))).toBe(true);
    await expect(dialog(page).getByRole('button', { name: 'Abbrechen', exact: true })).toBeFocused();
    await page.keyboard.press('Control+z'); await page.keyboard.press('Delete');
    expect(await content(page, mode)).toBe(before);
    await page.evaluate(() => window.menuModalProbe.observer.disconnect());
    await page.keyboard.press('Escape');
    await expect(trigger(page)).toBeFocused();
  });

  for (const touch of [false, true]) {
    test(`${mode}: outside ${touch ? 'touch' : 'mouse'} closes without activating the background`, async ({ browser }) => {
      const context = await browser.newContext({ hasTouch: touch, viewport: { width: 1440, height: 1000 } });
      try {
        const page = await context.newPage(); await launch(page, mode);
        const before = await content(page, mode);
        await trigger(page).click();
        // Click directly over an editor control; the modal backdrop must receive it.
        const background = mode === 'asset' ? page.getByLabel('Projektname') : page.getByRole('button', { name: 'Stift', exact: true });
        const bounds = (await background.boundingBox())!;
        if (touch) await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        else await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await expect(dialog(page)).toHaveCount(0);
        await expect(trigger(page)).toBeFocused();
        expect(await content(page, mode)).toBe(before);
      } finally { await context.close(); }
    });
  }
}

async function camera(page: Page, record = false) {
  return page.evaluate(async (record) => {
    const url = performance.getEntriesByType('resource').find((entry) => new URL(entry.name).pathname.endsWith('/@react-three_fiber.js'))!.name;
    const { _roots } = await import(url) as typeof FiberModule;
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas')!;
    const current = _roots.get(canvas)!.store.getState().camera;
    if (record) { window.menuCamera = current; window.menuCanvas = canvas; }
    return { position: current.position.toArray(), rotation: current.quaternion.toArray(), sameCamera: current === window.menuCamera, sameCanvas: canvas === window.menuCanvas };
  }, record);
}
test('held camera keys are neutralized without rebuilding camera or canvas', async ({ page }) => {
  await launch(page, 'asset');
  await page.locator('.viewport').focus();
  const initial = await camera(page, true);
  await page.keyboard.down('w');
  await expect.poll(async () => (await camera(page)).position).not.toEqual(initial.position);
  // Keep W held and open without first blurring the viewport with a mouse click.
  await trigger(page).evaluate((button) => (button as HTMLButtonElement).click());
  await expect(dialog(page).getByRole('button', { name: 'Fortsetzen', exact: true })).toBeFocused();
  const paused = await camera(page);
  await page.waitForTimeout(200);
  expect(await camera(page)).toEqual(paused);
  await page.keyboard.press('Escape');
  await page.locator('.viewport').focus();
  await page.waitForTimeout(200);
  expect(await camera(page)).toEqual(paused);
  await page.keyboard.up('w');
  expect(paused.sameCamera && paused.sameCanvas).toBe(true);
});
