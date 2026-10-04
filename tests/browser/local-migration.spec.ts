import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import inventory from '../../src/animation/migration/legacy-inventory.json' with { type: 'json' };
import type * as Migration from '../../src/animation/migration/localMigration';
import type * as Storage from '../../src/animation/storage';
import type * as Files from '../../src/animation/files';

const sourceKey = 'browser-migration.finoanim.json';
const source = JSON.stringify({ version: 2, faceRigVersion: 2, id: 'browser', name: 'Browser migration', basePose: 'fino_standing_neutral.png',
  frames: [{ durationMs: 37, ops: [], layers: [{ id: 'p', name: 'Pixels', kind: 'pixels',
    pixels: Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), rgba: 0x12345601 })) }] }] }, null, 2) + '\r\n';
const paths = inventory.assets.filter((a) => a.rigVersion === 2 || a.path === inventory.poses[0]!.faceBase).map((a) => a.path);
const preset = readFileSync(inventory.presets.path, 'utf8');
const modulePaths = { files: '/src/animation/files.ts', migration: '/src/animation/migration/localMigration.ts', storage: '/src/animation/storage.ts' };

test('real IndexedDB publishes once, retains byte-identical originals and reloads embedded assets/inventory', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ sourceKey, source, inventory, paths, preset, modulePaths }) => {
    const files = await import(modulePaths.files) as typeof Files;
    const sessions = await import(modulePaths.storage) as typeof Storage;
    const migration = await import(modulePaths.migration) as typeof Migration;
    await sessions.saveLocalSession(sourceKey, source);
    const resources = new Map(await Promise.all(paths.map(async (path) => [path, new Uint8Array(await (await fetch(`/${path.slice(7)}`)).arrayBuffer())] as const)));
    const injected = new Map<string, string | Uint8Array>(resources); injected.set(inventory.presets.path, preset);
    const plan = await migration.prepareLocalLegacyMigration(sourceKey, undefined, injected, inventory);
    const saved = await plan.commit();
    const repeated = await (await migration.prepareLocalLegacyMigration(sourceKey, undefined, injected, inventory)).commit();
    const restoredArchive = await migration.readLocalMigrationArchive(saved.journal.archiveId);
    const entries = await sessions.localSessionStorage.query({ kind: 'raster' });
    return { same: repeated.json === saved.json && repeated.journal.targetId === saved.journal.targetId,
      source: (await sessions.localSessionStorage.read(sourceKey)).value, original: restoredArchive.archive.original.definition!.json,
      embedded: restoredArchive.archive.resources.every((r) => r.original !== null),
      inventory: restoredArchive.inventory.inventoryVersion, status: saved.journal.status,
      valid: files.parseRasterDocument(saved.json).state.metadata.id === saved.journal.targetId,
      targets: entries.items.filter((meta) => meta.key.endsWith('.raster128.json')).length,
      previews: plan.previews.length, version: (await indexedDB.databases()).find((db) => db.name === 'northcore-animation-builder')!.version };
  }, { sourceKey, source, inventory, paths, preset, modulePaths });
  expect(result).toEqual({ same: true, source, original: source, embedded: true, inventory: inventory.inventoryVersion,
    status: 'completed', valid: true, targets: 1, previews: 0, version: 2 });
});

test('real queued writes roll back on target quota error and offline resume completes the same target identity', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ sourceKey, source, inventory, paths, preset, modulePaths }) => {
    const sessions = await import(modulePaths.storage) as typeof Storage;
    const migration = await import(modulePaths.migration) as typeof Migration;
    await sessions.saveLocalSession(sourceKey, source);
    const resources = new Map(await Promise.all(paths.map(async (path) => [path, new Uint8Array(await (await fetch(`/${path.slice(7)}`)).arrayBuffer())] as const)));
    const injected = new Map<string, string | Uint8Array>(resources); injected.set(inventory.presets.path, preset);
    const plan = await migration.prepareLocalLegacyMigration(sourceKey, undefined, injected, inventory), id = plan.id;
    const realPut = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')!.value as IDBObjectStore['put'];
    let error = '';
    try {
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (typeof key === 'string' && key.endsWith('.raster128.json')) throw new DOMException('Controlled target quota', 'QuotaExceededError');
        return realPut.call(this, value, key);
      };
      await plan.commit();
    } catch (e) { error = e instanceof Error ? e.name : String(e); }
    finally { IDBObjectStore.prototype.put = realPut; }
    const failed = await migration.readLocalMigrationJournal(id), entries = await sessions.localSessionStorage.query({ kind: 'raster' });
    let readable = true;
    try { await migration.readCompletedLocalMigration(id); } catch { readable = false; }
    const resumed = await migration.resumeLocalLegacyMigration(id); // deliberately no shipped resource argument
    const saved = await resumed.commit();
    return { error, failed: failed!.status, targetsBefore: entries.items.filter((meta) => meta.key.endsWith('.raster128.json')).length,
      source: (await sessions.localSessionStorage.read(sourceKey)).value, readable, identity: saved.journal.targetId === failed!.targetId,
      status: saved.journal.status, attempts: saved.journal.attempts, previews: plan.previews.length };
  }, { sourceKey, source, inventory, paths, preset, modulePaths });
  expect(result).toEqual({ error: 'QuotaExceededError', failed: 'failed', targetsBefore: 0, source, readable: false,
    identity: true, status: 'completed', attempts: 2, previews: 0 });
});

test('abort after real durable archive retains a resumable original and never publishes early', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ sourceKey, source, inventory, paths, preset, modulePaths }) => {
    const sessions = await import(modulePaths.storage) as typeof Storage;
    const migration = await import(modulePaths.migration) as typeof Migration;
    const { localSessionStorage: native } = await import(modulePaths.storage) as typeof Storage;
    await sessions.saveLocalSession(sourceKey, source);
    const resources = new Map(await Promise.all(paths.map(async (path) => [path, new Uint8Array(await (await fetch(`/${path.slice(7)}`)).arrayBuffer())] as const)));
    const injected = new Map<string, string | Uint8Array>(resources); injected.set(inventory.presets.path, preset);
    const controller = new AbortController();
    const intercepted: Storage.SessionStorage = { ...native, async run<T>(change: (entries: Map<string, string>) => T, keys?: readonly string[], documentId?: string) {
      const value = await native.run(change, keys, documentId);
      const prepared = (await native.query({ kind: 'journal', status: 'prepared', limit: 1 })).items.length > 0;
      if (prepared) controller.abort(); return value;
    } };
    const plan = await migration.prepareLocalLegacyMigration(sourceKey, undefined, injected, inventory, { storage: intercepted });
    let aborted = false;
    try { await plan.commit({ signal: controller.signal }); } catch (e) { aborted = e instanceof migration.LocalMigrationError && e.code === 'aborted'; }
    const journal = await migration.readLocalMigrationJournal(plan.id), archive = await migration.readLocalMigrationArchive(journal!.archiveId);
    const entries = await sessions.localSessionStorage.query({ kind: 'raster' });
    const saved = await (await migration.resumeLocalLegacyMigration(plan.id)).commit();
    return { aborted, before: journal!.status, earlyTarget: entries.items.some((meta) => meta.key === journal!.targetKey), original: archive.archive.original.definition!.json,
      after: saved.journal.status, previews: plan.previews.length };
  }, { sourceKey, source, inventory, paths, preset, modulePaths });
  expect(result).toEqual({ aborted: true, before: 'failed', earlyTarget: false, original: source, after: 'completed', previews: 0 });
});
