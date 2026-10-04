import { expect, test, type Page } from '@playwright/test';
import type * as Store from '../../src/animation/store';
import type * as Files from '../../src/animation/storage';
import type * as SessionStorageModule from '../../src/animation/storage';
import type * as Controller from '../../src/animation/migration/migrationController';
declare global { interface Window { releaseMigration?: () => void } }

function definition(lossy = false, addons = false) {
  return JSON.stringify({ version: 2, faceRigVersion: 2, id: 'user-source', name: 'Imported user source', basePose: 'fino_standing_neutral.png',
    frames: [{ durationMs: 37, ops: [], ...(addons ? { eyes: 'open' } : {}),
      layers: [{ id: 'p', name: 'Pixels', kind: 'pixels', pixels: lossy ? [{ x: 1, y: 1, rgba: 0x12345680 }]
        : Array.from({ length: 64 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), rgba: 0x12345680 })) }] }] });
}
async function launch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByLabel('Raster128 Zeichenfläche')).toBeVisible();
  await expect(page.getByLabel('Editor-Modus', { exact: true })).toHaveCount(0);
}
async function manager(page: Page) {
  await page.getByRole('button', { name: 'Legacy-Daten importieren / verwalten …', exact: true }).click();
  return page.getByRole('dialog', { name: 'Legacy-Daten importieren und verwalten', exact: true });
}
async function pick(page: Page, json: string, name = 'user.finoanim.json') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Legacy-Datei auswählen …', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) });
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/animation/store.ts';
    const { animationStore: s } = await import(performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path) as typeof Store;
    return { name: s.state.name, id: s.state.metadata.id, dirty: s.dirty, duration: s.state.frames[0]!.duration };
  });
}
for (const touch of [false, true]) {
  test(`independent external exact import, archive restart and native lifecycle ${touch ? 'touch' : 'desktop'}`, async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: touch, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), requests: string[] = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await launch(page); const dialog = await manager(page);
    await pick(page, definition(), 'actual-content.json');
    await expect(dialog.getByRole('status')).toContainText('review · gerastert exakt', { timeout: 30000 });
    await dialog.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('saved', { timeout: 30000 });
    await dialog.getByRole('button', { name: 'Migriertes Ziel in Raster128 öffnen', exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(await state(page)).toMatchObject({ name: 'Imported user source', dirty: false, duration: 37 });
    await page.getByRole('button', { name: 'Stift', exact: true }).click();
    const canvas = page.getByLabel('Raster128 Zeichenfläche'), box = (await canvas.boundingBox())!;
    if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect((await state(page)).dirty).toBe(true);
    await page.getByRole('button', { name: 'Sitzung lokal sichern', exact: true }).click();
    await expect.poll(async () => (await state(page)).dirty).toBe(false);
    await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
    await page.getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
    await page.reload(); await launch(page);
    const restarted = await manager(page);
    await expect(restarted.getByText(/user-source|actual-content.json/).first()).toBeVisible();
    await expect(restarted.getByRole('button', { name: 'Vollständiges Originalarchiv exportieren', exact: true })).toHaveCount(1);
    const download = page.waitForEvent('download');
    await restarted.getByRole('button', { name: 'Original-JSON exportieren', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('actual-content.json');
    await restarted.getByRole('button', { name: 'Ziel öffnen: actual-content.json', exact: true }).click();
    await expect(restarted).toHaveCount(0); expect((await state(page)).dirty).toBe(false);
    expect(requests.filter((path) => /LegacyBuilder|LegacyCanvas|legacyStore/.test(path))).toEqual([]);
    await context.close();
  });
}
test('lossy approval, blocked/invalid input, cancelled chooser and missing context do not mutate Raster', async ({ page }) => {
  await launch(page); const original = await state(page), dialog = await manager(page);
  await pick(page, definition(true));
  await expect(dialog.getByRole('status')).toContainText('gerastert verlustbehaftet', { timeout: 30000 });
  await expect(dialog.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Verlustbehaftete Rasterisierung ausdrücklich freigeben' }).check();
  await dialog.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('saved'); expect(await state(page)).toEqual(original);
  await pick(page, '{'); await expect(dialog.getByRole('status')).toContainText('blocked'); expect(await state(page)).toEqual(original);
  await pick(page, definition(false, true)); await expect(dialog.getByRole('status')).toContainText('blockiert', { timeout: 30000 });
  await expect(dialog.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Legacy-Addon-Kontext').selectOption('addons_normalized');
  await dialog.getByRole('button', { name: 'Mit Kontext erneut prüfen', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('review', { timeout: 30000 });
  const chooser = page.waitForEvent('filechooser'); await dialog.getByRole('button', { name: 'Legacy-Datei auswählen …', exact: true }).click();
  await (await chooser).setFiles([]); await expect(dialog.getByRole('status')).toContainText('review');
  await page.keyboard.press('Escape'); expect(await state(page)).toEqual(original);
});
test('local sources and quota-failed journals remain discoverable and resumable after restart', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async (json) => {
    const path = '/src/animation/storage.ts'; const files = await import(path) as typeof Files;
    await files.saveLocalSession('local-user.finoanim.json', json);
  }, definition());
  await launch(page); const dialog = await manager(page);
  await dialog.getByRole('button', { name: 'Prüfen: local-user.finoanim.json', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('gerastert exakt', { timeout: 30000 });
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve the original receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (typeof value === 'string' && value.includes('"status":"stored"')) throw new DOMException('Controlled quota', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await dialog.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('failed');
  expect(await page.evaluate(async () => {
    const path = '/src/animation/migration/migrationController.ts';
    return (await import(path) as typeof Controller).legacyMigrationController.dirty;
  })).toBe(true);
  await page.reload(); await launch(page); const resumed = await manager(page);
  await resumed.getByRole('button', { name: 'Wiederaufnehmen: local-user.finoanim.json', exact: true }).click();
  await expect(resumed.getByRole('status')).toContainText('review', { timeout: 30000 });
  await resumed.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true }).click();
  await expect(resumed.getByRole('status')).toContainText('saved');
  const original = await page.evaluate(async () => { const path = '/src/animation/storage.ts'; return (await (await import(path) as typeof Files).localSessionStorage.read('local-user.finoanim.json')).value; });
  expect(original).toBe(definition());
});

test('pending and failed migration writes protect Leave without making the Raster document dirty', async ({ page }) => {
  await launch(page); const before = await state(page), dialog = await manager(page);
  await pick(page, definition()); await expect(dialog.getByRole('status')).toContainText('review', { timeout: 30000 });
  await page.evaluate(async () => {
    const path = '/src/animation/storage.ts';
    const { localSessionStorage: storage } = await import(performance.getEntriesByType('resource')
      .filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path) as typeof SessionStorageModule;
    const original = storage.run.bind(storage); let hold = true;
    storage.run = async (change, keys, documentId) => {
      const result = await original(change, keys, documentId);
      if (hold && result && typeof result === 'object' && 'status' in result && result.status === 'prepared') {
        hold = false;
        await new Promise<void>((resolve) => { window.releaseMigration = resolve; });
      }
      return result;
    };
  });
  await dialog.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('saving');
  await expect.poll(() => page.evaluate(() => typeof window.releaseMigration)).toBe('function');
  await dialog.getByRole('button', { name: 'Schließen / Abbrechen', exact: true }).click();
  expect(await state(page)).toEqual(before);
  await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
  await page.getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Zur Editor-Auswahl?', exact: true })).toBeVisible();
  await page.evaluate(() => window.releaseMigration?.());
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const failed = await manager(page);
  await expect(failed.getByRole('status')).toContainText('failed');
  expect(await state(page)).toEqual(before);
  await failed.getByRole('button', { name: 'Migration erneut vorbereiten', exact: true }).click();
  await expect(failed.getByRole('status')).toContainText('review', { timeout: 30000 });
  await failed.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true }).click();
  await expect(failed.getByRole('status')).toContainText('saved');
  await failed.getByRole('button', { name: 'Schließen / Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
  await page.getByRole('button', { name: 'Zur Editor-Auswahl', exact: true }).click();
  await expect(page.locator('.editor-launcher nav')).toBeVisible();
});

test('external Legacy template backup imports into the global Raster library with its original preserved', async ({ page }) => {
  await launch(page);
  const json = JSON.stringify({ version: 1, templates: [{ id: 'user-template', name: 'User template', width: 8, height: 8,
    originX: 16, originY: 24, pixels: Array.from({ length: 64 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), rgba: 0x12345680 })) }] });
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Legacy-Bibliothek importieren …', exact: true }).click();
  await (await chooser).setFiles({ name: 'fino_templates.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByRole('dialog')).toContainText('exact');
  await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'User template', exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const path = '/src/animation/storage.ts'; return (await (await import(path) as typeof Files).localSessionStorage.read('__raster128_global_templates_v1')).value;
  });
  expect(saved).toContain('fino_templates.json'); expect(saved).toContain(JSON.stringify(json));
});

test('a missing compatibility resource and an unknown operation never publish a migration', async ({ page }) => {
  await page.route('**/animation/legacy/basis_face_base/fino_standing_neutral.png', (route) => route.fulfill({ status: 404, body: 'missing' }));
  await launch(page); const before = await state(page), dialog = await manager(page);
  await pick(page, definition()); await expect(dialog.getByRole('status')).toContainText('blocked', { timeout: 30000 });
  await expect(dialog.getByRole('alert')).toContainText('Legacy-Ressource fehlt');
  await expect(dialog.getByRole('button', { name: 'Archiv und Raster-Ziel speichern', exact: true })).toHaveCount(0);
  await page.unroute('**/animation/legacy/basis_face_base/fino_standing_neutral.png');
  const unknown = JSON.parse(definition()) as { frames: { ops: unknown[] }[] }; unknown.frames[0]!.ops = [{ type: 'unknown' }];
  await pick(page, JSON.stringify(unknown)); await expect(dialog.getByRole('status')).toContainText('blockiert', { timeout: 30000 });
  expect(await state(page)).toEqual(before);
  const entries = await page.evaluate(async () => { const path = '/src/animation/storage.ts'; return (await (await import(path) as typeof Files).localSessionStorage.query({ kind: 'journal' })).items.map((meta) => meta.key); });
  expect(entries.filter((key) => key.startsWith('__migration_v1:'))).toEqual([]);
});
