import { expect, test, type Page } from '@playwright/test';
import type * as EditorModule from '../../src/store/editorStore';
import { deserializeProject, serializeProject } from '../../src/persistence/projectFile';

declare global {
  interface Window {
    saveProbe: {
      writes: { content: string; target: string }[];
      pickers: number;
      finish: (outcome?: 'error' | 'abort' | 'cancel') => void;
    };
  }
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import(performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname === '/src/store/editorStore.ts').at(-1)?.name ?? '/src/store/editorStore.ts') as typeof EditorModule;
    const s = useEditorStore.getState();
    return { dirty: s.dirty, name: s.project.name, message: s.message };
  });
}
async function menu(page: Page, action: string) {
  const fileMenu = page.locator('.topbar .menu').first();
  if (await fileMenu.getAttribute('open') === null) await fileMenu.locator('summary').click();
  await page.locator('.topbar .menu[open]').getByRole('button', { name: action, exact: true }).click();
}
async function launch(page: Page, native: boolean) {
  await page.addInitScript((native) => {
    let complete: ((outcome?: 'error' | 'abort' | 'cancel') => void) | undefined;
    const pending = () => new Promise<void>((resolve, reject) => {
      complete = (outcome) => {
        if (outcome === 'error') reject(new Error('Write failed'));
        else if (outcome === 'abort') reject(new DOMException('Cancelled', 'AbortError'));
        else resolve();
      };
    });
    let cancelled = false;
    const probe = window.saveProbe = {
      writes: [] as { content: string; target: string }[], pickers: 0,
      finish: (outcome?: 'error' | 'abort' | 'cancel') => {
        cancelled = outcome === 'cancel';
        complete?.(outcome);
      },
    };
    if (native) {
      Object.assign(window, {
        CapacitorCustomPlatform: { name: 'android' },
        Capacitor: {
          PluginHeaders: [{ name: 'NativeFileDialog', methods: [
            { name: 'saveFile', rtype: 'promise' }, { name: 'writeFile', rtype: 'promise' },
          ] }],
          nativePromise: async (plugin: string, method: string, options: { base64: string; uri?: string }) => {
            if (plugin !== 'NativeFileDialog') throw new Error('Unexpected plugin');
            const target = method === 'saveFile' ? `content://saved/${++probe.pickers}` : options.uri!;
            probe.writes.push({ content: atob(options.base64), target });
            await pending();
            return cancelled ? { cancelled: true } : { uri: target, name: 'saved.json' };
          },
        },
      });
    } else {
      Object.assign(window, { showSaveFilePicker: () => {
        const target = `browser/${++probe.pickers}`;
        return Promise.resolve({ name: 'saved.json', createWritable: () => Promise.resolve({
          write: (content: string) => { probe.writes.push({ content, target }); return Promise.resolve(); },
          close: pending,
        }) });
      } });
    }
  }, native);
  await page.goto('/');
  await page.getByRole('button', { name: 'Asset Editor 3D-Objekte gestalten und exportieren', exact: true }).click();
  await page.getByLabel('Projektname').fill('Written version');
}
async function start(page: Page, count = 1, action = 'Speichern') {
  await menu(page, action);
  await expect.poll(() => page.evaluate(() => window.saveProbe.writes.length)).toBe(count);
}
async function finish(page: Page, outcome?: 'error' | 'abort' | 'cancel') {
  await page.evaluate((outcome) => window.saveProbe.finish(outcome), outcome);
  // A subsequent UI round trip allows the promise chain (including the native bridge) to settle.
  await page.getByLabel('Projektname').focus();
}

for (const native of [false, true]) {
  test.describe(native ? 'Android bridge' : 'Browser file handle', () => {
    test.beforeEach(async ({ page }) => { await launch(page, native); });

    test('unchanged save becomes clean; UI-only changes do not invalidate it', async ({ page }) => {
      await start(page);
      expect((await state(page)).dirty).toBe(true);
      await page.evaluate(async () => {
        const { useEditorStore } = await import(performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname === '/src/store/editorStore.ts').at(-1)?.name ?? '/src/store/editorStore.ts') as typeof EditorModule;
        const s = useEditorStore.getState();
        s.select(null); s.setTool('rotate'); s.setMessage('UI only'); s.setSnap({ enabled: true });
      });
      await finish(page);
      await expect.poll(async () => (await state(page)).dirty).toBe(false);
      expect(deserializeProject(await page.evaluate(() => window.saveProbe.writes[0]!.content)).project.name).toBe('Written version');
    });

    test('edits remain dirty, next save uses the established target and becomes clean', async ({ page }) => {
      await start(page);
      await page.getByLabel('Projektname').fill('Edited during save');
      await finish(page);
      await expect.poll(async () => (await state(page)).message).toContain('ungespeichert');
      expect((await state(page)).dirty).toBe(true);
      await start(page, 2);
      await finish(page);
      await expect.poll(async () => (await state(page)).dirty).toBe(false);
      const writes = await page.evaluate(() => window.saveProbe.writes);
      expect(writes[1]!.target).toBe(writes[0]!.target);
      expect(deserializeProject(writes[1]!.content).project.name).toBe('Edited during save');
    });

    const outcomes: ('error' | 'abort' | 'cancel')[] = native ? ['error', 'abort', 'cancel'] : ['error', 'abort'];
    for (const outcome of outcomes) {
      test(`${outcome} does not claim success; retry works`, async ({ page }) => {
        await start(page);
        await finish(page, outcome);
        if (outcome === 'error') await expect.poll(async () => (await state(page)).message).toContain('fehlgeschlagen');
        expect((await state(page)).dirty).toBe(true);
        expect((await state(page)).message).not.toContain('Gespeichert');
        await start(page, 2);
        await finish(page);
        await expect.poll(async () => (await state(page)).dirty).toBe(false);
        expect(await page.evaluate(() => window.saveProbe.pickers)).toBe(2);
      });
    }

    for (const outcome of ['error', 'abort'] as const) {
      test(`overwrite ${outcome} keeps edits dirty and preserves the target for retry`, async ({ page }) => {
        await start(page);
        await finish(page);
        await expect.poll(async () => (await state(page)).dirty).toBe(false);
        await page.getByLabel('Projektname').fill('Overwrite version');
        await start(page, 2);
        await finish(page, outcome);
        if (outcome === 'error') await expect.poll(async () => (await state(page)).message).toContain('fehlgeschlagen');
        expect((await state(page)).dirty).toBe(true);
        await start(page, 3);
        await finish(page);
        await expect.poll(async () => (await state(page)).dirty).toBe(false);
        const writes = await page.evaluate(() => window.saveProbe.writes);
        expect(writes.map((write) => write.target)).toEqual(Array(3).fill(writes[0]!.target));
        expect(await page.evaluate(() => window.saveProbe.pickers)).toBe(1);
      });
    }

    for (const replacement of ['new', 'load'] as const) {
      test(`${replacement} isolates dirty state, messages and file target from an old save`, async ({ page }) => {
        await start(page);
        if (replacement === 'new') await menu(page, 'Neu');
        else await page.locator('.topbar input[type=file]').setInputFiles({
          name: 'loaded.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject({
            project: { name: 'Loaded session', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
            scene: { background: '#11161A', gridVisible: true, axesVisible: true, gridSize: 1 }, objects: [],
          })),
        });
        await expect(page.getByLabel('Projektname')).toHaveValue(replacement === 'new' ? 'Unbenanntes Asset' : 'Loaded session');
        await page.getByLabel('Projektname').fill('New session edit');
        const before = await state(page);
        await finish(page);
        expect(await state(page)).toEqual(before);
        await start(page, 2);
        expect(await page.evaluate(() => window.saveProbe.pickers)).toBe(2);
        await finish(page);
        await expect.poll(async () => (await state(page)).dirty).toBe(false);
      });
    }

    test('repeated Save and Save As do not overlap, lock releases after completion', async ({ page }) => {
      await start(page);
      await menu(page, 'Speichern');
      await menu(page, 'Speichern unter…');
      expect(await page.evaluate(() => window.saveProbe.writes.length)).toBe(1);
      expect(await page.evaluate(() => window.saveProbe.pickers)).toBe(1);
      await finish(page);
      await expect.poll(async () => (await state(page)).dirty).toBe(false);
      await page.getByLabel('Projektname').fill('Second save');
      await start(page, 2, 'Speichern unter…');
      await finish(page);
      await expect.poll(async () => (await state(page)).dirty).toBe(false);
      expect(await page.evaluate(() => window.saveProbe.pickers)).toBe(2);
    });
  });
}
