import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AUTOSAVE_KEY, deserializeProject, serializeProject } from '../../src/persistence/projectFile';

declare global {
  interface Window {
    autosaveProbe: { reads: number; writes: string[]; read: () => string | null };
  }
}

const savedProject = serializeProject({
  project: { name: 'Gesicherte Sitzung', createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z' },
  scene: { background: '#123456', gridVisible: false, axesVisible: false, gridSize: 2 },
  objects: [],
});
const restoreDialog = (page: Page) => page.getByRole('dialog', { name: 'Letzte Sitzung wiederherstellen' });
const stored = (page: Page) => page.evaluate(() => window.autosaveProbe.read());
const writes = (page: Page) => page.evaluate(() => window.autosaveProbe.writes);

async function launch(page: Page, seed: string | null, failure?: 'getItem' | 'setItem' | 'removeItem') {
  await page.clock.install();
  await page.addInitScript(({ key, seed, failure }) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Each invocation supplies its Storage receiver via .call().
    const get = Storage.prototype.getItem;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve the original receiver for localStorage and sessionStorage.
    const set = Storage.prototype.setItem;
    if (seed !== null) set.call(localStorage, key, seed);
    window.autosaveProbe = { reads: 0, writes: [], read: () => get.call(localStorage, key) };
    Storage.prototype.getItem = function (name) {
      if (this === localStorage && name === key) {
        window.autosaveProbe.reads++;
        if (failure === 'getItem') throw new DOMException('Lesen gesperrt', 'SecurityError');
      }
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) {
        window.autosaveProbe.writes.push(value);
        if (failure === 'setItem') throw new DOMException('Speicher voll', 'QuotaExceededError');
      }
      return set.call(this, name, value);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked below with the original Storage receiver via .call().
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (name) {
      if (this === localStorage && name === key && failure === 'removeItem')
        throw new DOMException('Entfernen gesperrt', 'SecurityError');
      return remove.call(this, name);
    };
  }, { key: AUTOSAVE_KEY, seed, failure });
  await page.goto('/');
  await page.getByRole('button', { name: 'Asset Editor 3D-Objekte gestalten und exportieren', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

test('StrictMode never writes while restore is pending, including after document changes', async ({ page }) => {
  await launch(page, savedProject);
  await expect(restoreDialog(page)).toBeVisible();
  // main.tsx mounts the real application in StrictMode; initializers run twice in development.
  expect(await page.evaluate(() => window.autosaveProbe.reads)).toBeGreaterThanOrEqual(2);
  await page.clock.runFor(1000);
  expect(await stored(page)).toBe(savedProject);
  expect(await writes(page)).toEqual([]);
  await page.getByLabel('Projektname').fill('Neuer Stand vor der Entscheidung');
  await page.clock.runFor(1000);
  await expect(restoreDialog(page)).toBeVisible();
  expect(await stored(page)).toBe(savedProject);
  expect(await writes(page)).toEqual([]);
});

test('restore loads the saved project before autosave resumes and remains debounced', async ({ page }) => {
  await launch(page, savedProject);
  await restoreDialog(page).getByRole('button', { name: 'Wiederherstellen', exact: true }).click();
  await expect(restoreDialog(page)).toHaveCount(0);
  await expect(page.getByLabel('Projektname')).toHaveValue('Gesicherte Sitzung');
  await page.clock.runFor(1000);
  const restored = deserializeProject((await stored(page))!);
  expect(restored.scene).toEqual(deserializeProject(savedProject).scene);
  expect(restored.project.name).toBe('Gesicherte Sitzung');
  expect(await writes(page)).toHaveLength(1);
  await page.getByLabel('Projektname').fill('Zwischenstand');
  await page.clock.runFor(200);
  await page.getByLabel('Projektname').fill('Weiterbearbeitet');
  await page.clock.runFor(300);
  expect(await writes(page)).toHaveLength(1);
  await page.clock.runFor(200);
  expect(deserializeProject((await stored(page))!).project.name).toBe('Weiterbearbeitet');
  expect(await writes(page)).toHaveLength(2);
});

test('discard removes the old save and resumes autosaving the new project', async ({ page }) => {
  await launch(page, savedProject);
  await restoreDialog(page).getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(restoreDialog(page)).toHaveCount(0);
  await expect(page.getByLabel('Projektname')).toHaveValue('Unbenanntes Asset');
  expect(await stored(page)).toBeNull();
  await page.clock.runFor(1000);
  expect(deserializeProject((await stored(page))!).project.name).toBe('Unbenanntes Asset');
  expect(await writes(page)).toHaveLength(1);
  await page.getByLabel('Projektname').fill('Neues Projekt');
  await page.clock.runFor(500);
  expect(deserializeProject((await stored(page))!).project.name).toBe('Neues Projekt');
});

for (const seed of ['{broken', '', '{}']) {
  test(`invalid autosave ${JSON.stringify(seed)} is protected until explicit restore`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await launch(page, seed);
    await expect(restoreDialog(page)).toBeVisible();
    await page.clock.runFor(1000);
    expect(await stored(page)).toBe(seed);
    expect(await writes(page)).toEqual([]);
    await restoreDialog(page).getByRole('button', { name: 'Wiederherstellen', exact: true }).click();
    await expect(restoreDialog(page)).toHaveCount(0);
    await expect(page.locator('.statusbar .message')).toContainText('Autosave ungültig');
    await expect(page.getByLabel('Projektname')).toHaveValue('Unbenanntes Asset');
    await page.clock.runFor(1000);
    expect(deserializeProject((await stored(page))!).project.name).toBe('Unbenanntes Asset');
    expect(errors).toEqual([]);
  });
}

test('StrictMode cleans up duplicate effects when there is no restore candidate', async ({ page }) => {
  await launch(page, null);
  await expect(restoreDialog(page)).toHaveCount(0);
  await page.clock.runFor(1000);
  expect(await writes(page)).toHaveLength(1);
  expect(deserializeProject((await stored(page))!).project.name).toBe('Unbenanntes Asset');
});

for (const failure of ['getItem', 'setItem', 'removeItem'] as const) {
  test(`storage ${failure} failure is reported without crashing or claiming success`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await launch(page, savedProject, failure);
    if (failure === 'getItem') {
      await expect(page.locator('.statusbar .message')).toContainText('Autosave konnte nicht gelesen werden');
      await page.clock.runFor(1000);
      expect(await writes(page)).toEqual([]);
      expect(await stored(page)).toBe(savedProject);
    } else {
      await restoreDialog(page).getByRole('button', { name: 'Verwerfen', exact: true }).click();
      await expect(restoreDialog(page)).toHaveCount(0);
      if (failure === 'removeItem') {
        await expect(page.locator('.statusbar .message')).toContainText('Autosave konnte nicht entfernt werden');
        expect(await stored(page)).toBe(savedProject);
      }
      await page.getByLabel('Projektname').fill('Ungesicherte Änderung');
      await page.clock.runFor(1000);
      if (failure === 'setItem') {
        await expect(page.locator('.statusbar .message')).toContainText('Autosave fehlgeschlagen');
        await expect(page.locator('.statusbar .unsaved')).toBeVisible();
        expect(await stored(page)).toBeNull();
      } else {
        expect(deserializeProject((await stored(page))!).project.name).toBe('Ungesicherte Änderung');
      }
    }
    expect(errors).toEqual([]);
  });
}
