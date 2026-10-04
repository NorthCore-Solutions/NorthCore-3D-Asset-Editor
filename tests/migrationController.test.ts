import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import inventory from '../src/animation/migration/legacy-inventory.json';
import { LegacyMigrationController, recognizeLegacyDefinition } from '../src/animation/migration/migrationController';
import { MIGRATION_PREFIX, readLocalMigrationArchive } from '../src/animation/migration/localMigration';
import { AnimationStore } from '../src/animation/store';
import type * as Storage from '../src/animation/storage';

const memory = vi.hoisted(() => ({ entries: new Map<string, string>(), fail: false, waiting: null as Promise<void> | null }));
vi.mock('../src/animation/storage', async (original) => ({ ...await original<typeof Storage>(), localSessionStorage: {
  async run<T>(change: (entries: Map<string, string>) => T) {
    const draft = new Map(memory.entries), result = change(draft);
    const journals = [...draft].filter(([key]) => key.startsWith('__migration_v1:journal:'));
    if (memory.fail && journals.some(([, raw]) => (JSON.parse(raw) as { status: string }).status === 'stored')) throw Error('Controlled quota failure');
    if (memory.waiting && journals.some(([, raw]) => (JSON.parse(raw) as { status: string }).status === 'prepared')) await memory.waiting;
    memory.entries = draft; return result;
  },
} }));
function source(lossy = false, addon = false) {
  return JSON.stringify({ version: 2, faceRigVersion: 2, id: 'external', name: 'External user document', basePose: 'fino_standing_neutral.png',
    frames: [{ durationMs: 37, ops: [], ...(addon ? { eyes: 'open' } : {}),
      layers: [{ id: 'p', name: 'Pixels', kind: 'pixels', pixels: lossy ? [{ x: 1, y: 1, rgba: 0x12345680 }]
        : Array.from({ length: 64 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), rgba: 0x12345680 })) }] }] });
}
let controller: LegacyMigrationController;
beforeEach(() => {
  memory.entries.clear(); memory.fail = false; memory.waiting = null;
  controller = new LegacyMigrationController();
  vi.stubGlobal('fetch', vi.fn((path: string) => {
    const bytes = readFileSync(`public/${path.replace(/^\//, '')}`);
    return Promise.resolve(new Response(bytes));
  }));
});
afterEach(() => { controller.cancel(); vi.unstubAllGlobals(); });

it('recognizes actual content rather than an extension; invalid JSON/Raster/unknown versions are rejected', () => {
  expect(() => recognizeLegacyDefinition(source())).not.toThrow();
  for (const json of ['{', '{}', '{"version":3}', JSON.stringify({ version: 2, frames: [], metadata: { id: 'raster' } })])
    expect(() => recognizeLegacyDefinition(json)).toThrow();
});
it('external exact audit/preview/archive/target/open does not create authoring data and releases previews', async () => {
  await controller.external(new Blob([source()]), 'anything.txt');
  expect(controller.status).toBe('review'); expect(controller.report?.route).toBe('gerastert exakt');
  expect(controller.previews).toHaveLength(1); expect(controller.dirty).toBe(false);
  await controller.commit(false); expect(controller.status).toBe('saved'); expect(controller.dirty).toBe(false);
  expect(controller.previews).toHaveLength(0); expect(memory.entries.has('anything.txt')).toBe(false);
  const store = new AnimationStore(); expect(await controller.open(store)).toBe('opened');
  expect(store.state.frames[0]!.duration).toBe(37); expect(store.dirty).toBe(false);
  const journalRaw = [...memory.entries].find(([key]) => key.startsWith(`${MIGRATION_PREFIX}journal:`))![1];
  const journal = JSON.parse(journalRaw) as { archiveId: string };
  expect((await readLocalMigrationArchive(journal.archiveId)).archive.original.definition!.json).toBe(source());
  const restarted = new LegacyMigrationController(); await restarted.loadStatus(); expect(restarted.dirty).toBe(false);
});
it('lossy needs explicit approval; cancellation leaves no target or archive', async () => {
  await controller.external(new Blob([source(true)]), 'lossy.finoanim.json');
  expect(controller.report?.route).toBe('gerastert verlustbehaftet');
  await expect(controller.commit(false)).rejects.toThrow('Freigabe'); expect(memory.entries.size).toBe(0);
  controller.cancel(); expect(controller.previews).toHaveLength(0);
  await controller.external(new Blob([source(true)]), 'lossy.json'); await controller.commit(true);
  expect(controller.status).toBe('saved');
});
it('unknown operations and ambiguous addon context stay blocked until an explicit valid context is supplied', async () => {
  const raw = JSON.parse(source()) as { frames: { ops: unknown[] }[] }; raw.frames[0]!.ops = [{ type: 'unknown' }];
  await controller.external(new Blob([JSON.stringify(raw)]), 'unknown.json');
  expect(controller.status).toBe('blocked'); await expect(controller.commit(true)).rejects.toThrow();
  await controller.external(new Blob([source(false, true)]), 'addons.json');
  expect(controller.status).toBe('blocked'); expect(controller.audit?.issues.some((i) => i.code === 'ambiguous-addon-root')).toBe(true);
  await controller.recheck({ addonRoot: 'addons_normalized' }); expect(controller.status).toBe('review');
});
it('a quota error stays protected through Retry; a fresh controller detects the durable failed journal', async () => {
  await controller.external(new Blob([source()]), 'user.json'); memory.fail = true;
  await controller.commit(false); expect(controller.status).toBe('failed'); expect(controller.dirty).toBe(true);
  const restarted = new LegacyMigrationController(); await restarted.loadStatus(); expect(restarted.dirty).toBe(true);
  await expect(controller.external(new Blob([source()]), 'another.json')).rejects.toThrow();
  memory.fail = false; await controller.retry(); expect(controller.status).toBe('review');
  await controller.commit(false); expect(controller.status).toBe('saved'); expect(controller.dirty).toBe(false);
});
it('a delayed file read or cancelled resource preparation cannot replace a newer review', async () => {
  let resolve!: (json: string) => void;
  const old = { text: () => new Promise<string>((r) => { resolve = r; }) } as Blob;
  const task = controller.external(old, 'old.json'); controller.cancel();
  await controller.external(new Blob([source()]), 'current.json'); resolve('invalid'); await task;
  expect(controller.status).toBe('review'); expect(controller.report?.source.origin.name).toBe('current.json');
});
it('a local user definition is migrated with no authoring store and no original mutation', async () => {
  // Controller reads existing session data through the same adapter used by the UI.
  expect(inventory.persistence.libraryKey).toBe('__legacy_templates');
  const key = 'local.finoanim.json'; memory.entries.set(key, source());
  const { prepareLocalLegacyMigration } = await import('../src/animation/migration/localMigration');
  const resources = new Map(inventory.assets.map((a) => [a.path, new Uint8Array(readFileSync(a.path))]));
  const full = new Map<string, string | Uint8Array>(resources); full.set(inventory.presets.path, readFileSync(inventory.presets.path, 'utf8'));
  const result = await (await prepareLocalLegacyMigration(key, undefined, full, inventory)).commit();
  expect(result.journal.status).toBe('completed'); expect(memory.entries.get(key)).toBe(source());
});
