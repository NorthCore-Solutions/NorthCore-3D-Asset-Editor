import { expect, test, type Page } from '@playwright/test';
import type * as RasterModule from '../../src/animation/store';

test.use({ hasTouch: true });
type Mode = 'raster';
async function access(page: Page, mode: Mode, action: 'setup' | 'play' | 'state' | 'dirty' | 'replace' = 'state') {
  return page.evaluate(async ({ mode, action }) => {
    const path = '/src/animation/store.ts';
    const url = performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
    if (mode === 'raster') {
      const { animationStore: s } = await import(url) as typeof RasterModule;
      if (action === 'setup') {
        s.newAnimation('Playback test', 'empty', false); s.addFrame(true);
        s.duration(1000); s.frameAt(0); s.duration(1000); s.markSaved(s.captureContent());
      }
      if (action === 'play') s.play();
      if (action === 'dirty') s.commit({ ...s.state, name: 'Dirty playback test' });
      if (action === 'replace') s.newAnimation('Replacement', 'empty', false);
      return { playing: s.playing, index: s.state.index, history: [s.past.length, s.future.length], dirty: s.dirty, document: JSON.stringify([s.state.frames, s.state.name, s.state.source]) };
    }
    throw Error('Unbekannter Builder.');
  }, { mode, action });
}
async function launch(page: Page, mode: Mode, playing = true, dirty = false) {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.locator('.ab-canvas')).toBeVisible();
  await access(page, mode, 'setup');
  if (dirty) await access(page, mode, 'dirty');
  if (playing) await access(page, mode, 'play');
}
const menu = (page: Page) => page.locator('dialog[data-editor-menu]');
const hamburger = (page: Page) => page.getByRole('button', { name: 'Menü öffnen', exact: true });
async function assertPaused(page: Page, mode: Mode) {
  expect((await access(page, mode)).playing).toBe(false);
  const paused = await access(page, mode);
  await page.clock.runFor(2200);
  expect(await access(page, mode)).toEqual(paused);
}

for (const mode of ['raster'] as const) {
  for (const close of ['resume', 'escape', 'mouse', 'touch'] as const) {
    test(`${mode}: running menu pauses and ${close} restores a single playback timer`, async ({ page }) => {
      await launch(page, mode);
      const before = await access(page, mode);
      await hamburger(page).click(); await assertPaused(page, mode);
      if (close === 'resume') await menu(page).getByRole('button', { name: 'Fortsetzen', exact: true }).click();
      else if (close === 'escape') await page.keyboard.press('Escape');
      else if (close === 'mouse') await page.mouse.click(10, 10);
      else await page.touchscreen.tap(10, 10);
      await expect(menu(page)).toHaveCount(0);
      expect(await access(page, mode)).toEqual(before);
      await page.clock.runFor(1000); expect((await access(page, mode)).index).toBe(1);
      await page.clock.runFor(1000); expect((await access(page, mode)).index).toBe(0);
    });
  }
  test(`${mode}: previously paused playback stays paused after Resume`, async ({ page }) => {
    await launch(page, mode, false);
    const before = await access(page, mode);
    await hamburger(page).click(); await assertPaused(page, mode);
    await menu(page).getByRole('button', { name: 'Fortsetzen', exact: true }).click();
    expect(await access(page, mode)).toEqual(before); await assertPaused(page, mode);
  });
  test(`${mode}: clean exit never resumes, even after re-entering the builder`, async ({ page }) => {
    await launch(page, mode);
    await hamburger(page).click();
    await menu(page).getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
    await expect(page.locator('.editor-launcher nav')).toBeVisible();
    await assertPaused(page, mode);
    await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
      await assertPaused(page, mode);
  });
  for (const confirm of [false, true]) {
    test(`${mode}: dirty confirmation ${confirm ? 'confirmed' : 'cancelled'} ${confirm ? 'discards' : 'restores'} prior playback`, async ({ page }) => {
      await launch(page, mode, true, true);
      const before = await access(page, mode);
      await hamburger(page).click();
      await menu(page).getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
      await expect(menu(page).getByRole('heading')).toHaveText('Zur Editor-Auswahl?');
      await assertPaused(page, mode);
      await menu(page).getByRole('button', { name: confirm ? 'Zur Auswahl' : 'Abbrechen', exact: true }).click();
      if (confirm) {
        await expect(page.locator('.editor-launcher nav')).toBeVisible();
        await assertPaused(page, mode);
      } else expect(await access(page, mode)).toEqual(before);
    });
  }
  test(`${mode}: cancelling a dirty confirmation preserves previously paused playback`, async ({ page }) => {
    await launch(page, mode, false, true);
    const before = await access(page, mode);
    await hamburger(page).click();
    await menu(page).getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
    await assertPaused(page, mode);
    await menu(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
    expect(await access(page, mode)).toEqual(before);
    await assertPaused(page, mode);
  });
  test(`${mode}: repeated menu cycles preserve history/dirty and never duplicate playback`, async ({ page }) => {
    await launch(page, mode);
    const before = await access(page, mode);
    for (let i = 0; i < 3; i++) {
      await hamburger(page).click();
      expect((await access(page, mode)).playing).toBe(false);
      await page.keyboard.press('Escape');
      expect(await access(page, mode)).toEqual(before);
    }
    await page.clock.runFor(1000); expect((await access(page, mode)).index).toBe(1);
  });
  test(`${mode}: document replacement while menu is open invalidates the resume`, async ({ page }) => {
    await launch(page, mode);
    await hamburger(page).click();
    await access(page, mode, 'replace');
    await menu(page).getByRole('button', { name: 'Fortsetzen', exact: true }).click();
    await assertPaused(page, mode);
  });
}
