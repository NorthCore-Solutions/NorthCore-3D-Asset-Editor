import { expect, test } from '@playwright/test';
import type { NativeDirectoryEntry } from '../../src/platform/nativeFileDialog';

test('Android bridge drives the existing cascade, creation, overwrite, refresh, restore, cancel and reauthorization UI', async ({ page }) => {
  await page.addInitScript(() => {
    const root: NativeDirectoryEntry = { kind: 'directory', name: 'SAF Projects', treeUri: 'content://test/tree/root', documentId: 'root' };
    const folder = { ...root, name: 'Deep', documentId: 'folder:opaque' };
    const existing: NativeDirectoryEntry = { ...root, kind: 'file', name: 'existing.raster128.json', documentId: 'file:opaque' };
    const initial = JSON.stringify({ version: 2, metadata: { id: 'native-project' }, name: 'Native existing', source: 'empty', frames: [{ duration: 125, layers: [{ id: 'pixels-1', name: 'Pixels', visible: true, locked: false, pixels: [] }] }], templates: [], reference: null });
    const state = { cancelled: false, denyListing: false, creates: [] as string[], writes: [] as string[], methods: [] as string[] };
    const files = new Map<string, NativeDirectoryEntry>([[existing.name, existing]]);
    const contents = new Map<string, string>([[existing.documentId, initial]]);
    const methods = ['pickDirectory', 'rememberedDirectory', 'clearRememberedDirectory', 'directoryPermission', 'listDirectory', 'getDirectoryFile', 'readDocument', 'writeDocument'];
    Object.assign(window, {
      androidBridge: {}, __safTest: state,
      Capacitor: {
        PluginHeaders: [{ name: 'NativeFileDialog', methods: methods.map((name) => ({ name, rtype: 'promise' })) }],
        // The native bridge resolves these in-memory filesystem responses asynchronously.
        // eslint-disable-next-line @typescript-eslint/require-await
        nativePromise: async (_plugin: string, method: string, options: { documentId?: string; name?: string; create?: boolean; base64?: string } = {}) => {
          state.methods.push(method);
          switch (method) {
            case 'pickDirectory':
              if (state.cancelled) { state.cancelled = false; return { cancelled: true }; }
              state.denyListing = false;
              sessionStorage.setItem('saf-root', 'connected');
              return { directory: root };
            case 'rememberedDirectory': return { directory: sessionStorage.getItem('saf-root') ? root : null };
            case 'clearRememberedDirectory': sessionStorage.removeItem('saf-root'); return;
            case 'directoryPermission': return { granted: true };
            case 'listDirectory':
              if (state.denyListing) throw Object.assign(Error('Grant revoked'), { code: 'NotAllowedError' });
              return { entries: options.documentId === 'root' ? [folder] : [...files.values()] };
            case 'getDirectoryFile': {
              let file = files.get(options.name!);
              if (!file && !options.create) throw Object.assign(Error('Missing'), { code: 'NotFoundError' });
              if (!file) { file = { ...existing, name: options.name!, documentId: `created:${options.name}` }; files.set(file.name, file); state.creates.push(options.documentId!); }
              return { file };
            }
            case 'readDocument': return { base64: btoa(contents.get(options.documentId!)!) };
            case 'writeDocument':
              state.writes.push(options.documentId!);
              contents.set(options.documentId!, new TextDecoder().decode(Uint8Array.from(atob(options.base64!), (char) => char.charCodeAt(0))));
              return;
          }
          throw Error(`Unexpected native method ${method}`);
        },
      },
    });
  });
  const openBuilder = async () => {
    await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
    await expect(page.locator('.ab-canvas')).toBeVisible();
  };
  const state = () => page.evaluate(() => (window as unknown as { __safTest: { creates: string[]; writes: string[]; methods: string[] } }).__safTest);
  await page.goto('/'); await openBuilder();
  const connect = page.getByRole('button', { name: 'Hauptordner verbinden …', exact: true });
  await page.evaluate(() => { (window as unknown as { __safTest: { cancelled: boolean } }).__safTest.cancelled = true; });
  await connect.click();
  await expect(page.locator('.ab-status')).toContainText('Bereit');
  await expect(page.getByRole('menu', { name: 'Projektdateien', exact: true })).toHaveCount(0);
  await connect.click();
  const root = page.getByRole('menu', { name: 'Projektdateien', exact: true });
  await root.getByRole('menuitem', { name: 'Deep', exact: true }).click();
  const deep = page.getByRole('menu', { name: 'Deep', exact: true });
  await deep.getByRole('menuitem', { name: 'existing.raster128.json', exact: true }).click();
  await expect(page.locator('.ab-title')).toContainText('Native existing');
  await page.getByRole('button', { name: 'Projektdatei speichern', exact: true }).click();
  await expect(page.locator('.ab-status')).toContainText('Projekt gespeichert');
  await root.getByRole('menuitem', { name: 'Deep', exact: true }).click();
  await deep.getByRole('button', { name: 'Projekt hier speichern …', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Dateiname').fill('New');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect.poll(async () => (await state()).creates).toEqual(['folder:opaque']);
  await root.getByRole('menuitem', { name: 'Deep', exact: true }).click();
  await expect(deep.getByRole('menuitem', { name: 'New.raster128.json', exact: true })).toBeVisible();
  await deep.getByRole('button', { name: 'Projekt hier speichern …', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Dateiname').fill('existing');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Projektdatei ersetzen');
  await page.getByRole('dialog').getByRole('button', { name: 'Ersetzen', exact: true }).click();
  await expect.poll(async () => (await state()).writes).toEqual(['file:opaque', 'created:New.raster128.json', 'file:opaque']);
  await page.evaluate(() => { (window as unknown as { __safTest: { denyListing: boolean } }).__safTest.denyListing = true; });
  await page.getByRole('button', { name: 'Ordner aktualisieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ordnerzugriff erlauben', exact: true })).toBeVisible();
  await expect(root).toHaveCount(0);
  await page.getByRole('button', { name: 'Ordnerzugriff erlauben', exact: true }).click();
  await expect(root.getByRole('menuitem', { name: 'Deep', exact: true })).toBeVisible();
  await page.reload(); await openBuilder();
  await expect(root.getByRole('menuitem', { name: 'Deep', exact: true })).toBeVisible();
  expect((await state()).methods).toContain('rememberedDirectory');
});
