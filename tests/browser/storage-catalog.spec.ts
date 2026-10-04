import { expect, test, type Page } from '@playwright/test';
import type * as Storage from '../../src/animation/storage';
import type * as Migration from '../../src/animation/migration/localMigration';
import type * as Content from '../../src/animation/contentHash';
import inventory from '../../src/animation/migration/legacy-inventory.json' with { type: 'json' };
import rasterV1 from '../fixtures/raster-session-v1.json' with { type: 'json' };
import type * as Files from '../../src/animation/files';
import type * as Stores from '../../src/animation/store';
import type * as Libraries from '../../src/animation/globalTemplateLibrary';
declare global { interface Window { catalogLibraryReads: number; } }

async function isolated(page: Page) {
  // Same-origin minimal host avoids startup queries racing a deliberately seeded V1 database.
  await page.route('**/__storage_probe__', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage probe</title>' }));
  await page.goto('/__storage_probe__');
}

test('large V1 upgrade, bounded indexed pages, lookups and lazy archive hydration have structural read budgets', async ({ page }, info) => {
  test.setTimeout(120000); await isolated(page);
  const result = await page.evaluate(async (inventory) => {
    const contentPath = '/src/animation/contentHash.ts', { canonicalJson, sha256 } = await import(contentPath) as typeof Content;
    const rows = new Map<string, string>(), pad = (i: number) => String(i).padStart(4, '0');
    const hashId = (i: number) => i.toString(16).padStart(64, '0');
    const inventoryText = canonicalJson(inventory), inventoryHash = await sha256(inventoryText);
    const blob = (hash: string, text: string) => {
      const bytes = new TextEncoder().encode(text); let encoded = '';
      for (let i = 0; i < bytes.length; i += 32768) encoded += String.fromCharCode(...bytes.subarray(i, i + 32768));
      rows.set(`__migration_v1:blob:${hash}`, JSON.stringify({ blobVersion: 1, sha256: hash, base64: btoa(encoded) }));
    };
    blob(inventoryHash, inventoryText);
    const resourceTexts = ['a'.repeat(524288), 'b'.repeat(524288)], resourceHashes = await Promise.all(resourceTexts.map((text) => sha256(text)));
    resourceTexts.forEach((text, i) => blob(resourceHashes[i]!, text));
    const refs = Array.from({ length: 4 }, (_, i) => ({ path: `resource-${i}.bin`, role: 'reference', category: 4, expectedSha256: resourceHashes[i % 2]!, actualSha256: resourceHashes[i % 2]!, status: 'verified' }));
    const originalJson = JSON.stringify({ version: 2, id: 'user', name: 'Large source', basePose: 'fino_standing_neutral.png', frames: [{ durationMs: 100, ops: [],
      layers: [{ id: 'p', name: 'Pixels', kind: 'pixels', pixels: Array.from({ length: 12000 }, (_, i) => ({ x: i % 1024, y: Math.floor(i / 1024), rgba: 0x123456ff })) }] }] });
    const sourceHash = await sha256(originalJson); const archiveIds: string[] = [];
    for (let i = 0; i < 180; i++) {
      const original = { source: { kind: 'file', name: `user-${pad(i)}.json` }, definition: { json: originalJson, sha256: sourceHash } };
      const assessment = { auditVersion: 1, inventorySha256: inventoryHash, source: original.source, complete: true, migrationPerformed: false,
        route: 'gerastert exakt', issues: [], components: [], references: refs,
        resolved: { rigVersion: 2, addonRoot: null, addonCandidates: [], addonContext: 'unused', frames: [] }, frames: [] };
      const archiveId = await sha256(canonicalJson({ archiveVersion: 1, original, assessment })); archiveIds.push(archiveId);
      rows.set(`__migration_v1:archive:${archiveId}`, canonicalJson({ storageVersion: 1, archiveVersion: 1, archiveId, original, assessment,
        inventorySha256: inventoryHash, resources: refs.map((ref) => ({ ...ref, encoding: 'bytes', blobSha256: ref.actualSha256 })) }));
    }
    const pixels = Array.from({ length: 6000 }, (_, i) => [i, 0x123456ff]);
    for (let i = 0; i < 320; i++) rows.set(`Document ${pad(i)}`, JSON.stringify({ version: 2, name: `Document ${pad(i)}`, metadata: { id: `document-${i}` }, frames: [{ layers: [{ pixels }] }] }));
    for (let i = 0; i < 600; i++) rows.set(`__migration_v1:journal:${hashId(i)}`, JSON.stringify({ journalVersion: 1, id: hashId(i),
      migrationVersion: 1, converterVersion: '1', scope: 'rendered-animation', libraryDisposition: 'absent', sourceKind: 'file', sourceIdentitySha256: hashId(i),
      sourceKey: `user-${i % 5}.json`, sourceSha256: sourceHash, libraryKey: '__legacy_templates', librarySha256: null, archiveId: archiveIds[i % 180],
      conversionSha256: hashId(i), targetId: `target-${i}`, targetKey: `Raster-Migration target-${i}.raster128.json`, targetSha256: sourceHash,
      route: 'exact', approval: 'not-required', approvedConversionSha256: null,
      status: ['completed', 'failed', 'prepared', 'stored'][i % 4], revision: 1, attempts: 1, error: null }));
    rows.set('user.finoanim.json', originalJson); rows.set('__legacy_templates', '{"version":1,"templates":[]}');
    rows.set('__raster128_global_templates_v1', '{"format":"northcore-raster128-library","version":1,"templates":[],"migrations":[]}');
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('northcore-animation-builder', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('sessions');
      open.onerror = () => reject(open.error ?? Error('Seed failed'));
      open.onsuccess = () => { const tx = open.result.transaction('sessions', 'readwrite');
        for (const [key, value] of rows) tx.objectStore('sessions').put(value, key);
        tx.oncomplete = () => { open.result.close(); resolve(); }; tx.onabort = () => reject(tx.error ?? Error('Seed aborted')); };
    });
    const counts = { metadata: 0, journal: 0, archive: 0, blob: 0, raster: 0, source: 0, revision: 0, other: 0, keys: 0 };
    const get = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'get')!.value as IDBObjectStore['get'];
    const keyCursor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'openKeyCursor')!.value as IDBObjectStore['openKeyCursor'];
    const indexCursor = Object.getOwnPropertyDescriptor(IDBIndex.prototype, 'openCursor')!.value as IDBIndex['openCursor'];
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'builder_metadata') counts.metadata++;
      else if (typeof key === 'string') {
        const category = key.startsWith('__migration_v1:journal:') ? 'journal' : key.startsWith('__migration_v1:archive:') ? 'archive'
          : key.startsWith('__migration_v1:blob:') ? 'blob' : key.startsWith('Document ') ? 'raster' : key.endsWith('.finoanim.json') ? 'source'
          : key.startsWith('__builder_revision_v1:') ? 'revision' : 'other'; counts[category]++;
      }
      return get.call(this, key);
    };
    IDBObjectStore.prototype.openKeyCursor = function (...args) {
      const request = keyCursor.apply(this, args); request.addEventListener('success', () => { if (request.result) counts.keys++; }); return request;
    };
    IDBIndex.prototype.openCursor = function (...args) {
      const request = indexCursor.apply(this, args); request.addEventListener('success', () => { if (request.result) counts.metadata++; }); return request;
    };
    IDBObjectStore.prototype.getAll = () => { throw Error('Unbounded payload getAll forbidden'); };
    IDBObjectStore.prototype.openCursor = () => { throw Error('Payload value cursor forbidden'); };
    const snapshot = () => ({ ...counts }), reset = () => { for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = 0; };
    const path = '/src/animation/storage.ts', storage = await import(path) as typeof Storage, client = storage.createSessionClient();
    const first = await client.query({ kind: 'raster', limit: 50 }), upgrade = snapshot();
    reset(); const second = await client.query({ kind: 'raster', after: first.next, limit: 50 }), pagination = snapshot();
    const all = [...first.items, ...second.items]; let after = second.next;
    while (after) { const page = await client.query({ kind: 'raster', after, limit: 50 }); all.push(...page.items); after = page.next; }
    reset(); const status = await client.query({ kind: 'journal', status: 'failed', limit: 50 }), filtered = snapshot();
    reset(); const bySource = await client.query({ kind: 'journal', sourceIdentitySha256: hashId(123) }), byTarget = await client.query({ kind: 'journal', targetId: 'target-123' }),
      byArchive = await client.query({ kind: 'journal', archiveId: archiveIds[123] }), lookups = snapshot();
    reset(); await client.head('Document 0000'); const head = snapshot();
    reset(); const mpath = '/src/animation/migration/localMigration.ts', migration = await import(mpath) as typeof Migration;
    const archive = await migration.readLocalMigrationArchive(archiveIds[0]!, client), detail = snapshot();
    reset(); const original = await migration.readLocalArchiveOriginal(archiveIds[0]!, client), originalOnly = snapshot();
    const untouched = (await client.read('user.finoanim.json')).value === originalJson;
    const version = (await indexedDB.databases()).find((db) => db.name === 'northcore-animation-builder')!.version;
    client.close();
    return { counts: { upgrade, pagination, filtered, lookups, head, detail, originalOnly },
      first: first.items.length, second: second.items.length, all: all.map((meta) => meta.key), status: status.items.map((meta) => meta.status),
      bySource: bySource.items.length, byTarget: byTarget.items.length, byArchive: byArchive.items.length,
      resourceBytes: archive.archive.resources.map((ref) => ref.original && 'bytes' in ref.original ? ref.original.bytes.length : 0),
      originalUnchanged: original.definition!.json === originalJson && untouched, version, records: rows.size, payloadCharacters: [...rows.values()].reduce((n, value) => n + value.length, 0) };
  }, inventory);
  expect(result.version).toBe(2); expect(result.originalUnchanged).toBe(true);
  expect(result.first).toBe(50); expect(result.second).toBe(50); expect(result.all).toHaveLength(320);
  expect(new Set(result.all).size).toBe(320); expect(result.all).toEqual([...result.all].sort());
  expect(result.status).toHaveLength(50); expect(new Set(result.status)).toEqual(new Set(['failed']));
  expect([result.bySource, result.byTarget, result.byArchive]).toEqual([1, 1, 3]);
  for (const phase of ['upgrade', 'pagination', 'filtered', 'lookups', 'head'] as const) {
    expect(result.counts[phase].archive).toBe(0); expect(result.counts[phase].blob).toBe(0);
    expect(result.counts[phase].raster).toBe(0); expect(result.counts[phase].source).toBe(0);
  }
  expect(result.counts.upgrade.journal).toBe(600); expect(result.counts.pagination.metadata).toBeLessThanOrEqual(51);
  expect(result.counts.filtered.metadata).toBeLessThanOrEqual(51); expect(result.counts.lookups.metadata).toBeLessThanOrEqual(5);
  expect(result.counts.detail.archive).toBe(2); // V1 summary is enriched with a byte-comparison once.
  expect(result.counts.detail.blob).toBe(3); // Inventory plus two deduplicated resources, despite four references.
  expect(result.counts.originalOnly.archive).toBe(1); expect(result.counts.originalOnly.blob).toBe(0);
  expect(result.resourceBytes).toEqual([524288, 524288, 524288, 524288]);
  await info.attach('storage-read-budget.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('empty/small database, filtered paging, atomic metadata quota failure and cross-tab CAS', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const path = '/src/animation/storage.ts', { createSessionClient } = await import(path) as typeof Storage;
    const a = createSessionClient(), b = createSessionClient();
    const empty = await a.query({ kind: 'raster' });
    const old = await a.write('A', '{"version":2,"metadata":{"id":"a"}}');
    await a.write('B', '{"version":1}'); await b.read('A');
    const put = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')!.value as IDBObjectStore['put'];
    let quota = '';
    try {
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (this.name === 'builder_metadata') throw new DOMException('Metadata quota', 'QuotaExceededError'); return put.call(this, value, key);
      };
      await a.write('A', '{"version":2,"metadata":{"id":"changed"}}', old);
    } catch (error) { quota = error instanceof Error ? error.name : 'unknown'; }
    finally { IDBObjectStore.prototype.put = put; }
    const afterFailure = await a.read('A'), oldIndex = await a.query({ kind: 'raster', targetId: 'a' }), badIndex = await a.query({ kind: 'raster', targetId: 'changed' });
    const winner = await a.write('A', '{"version":2,"metadata":{"id":"new"}}', old); let conflict = '';
    try { await b.write('A', 'stale'); } catch (error) { conflict = error instanceof Error ? error.name : 'unknown'; }
    const first = await a.query({ kind: 'raster', limit: 1 }), second = await a.query({ kind: 'raster', after: first.next, limit: 1 });
    const explicit = await b.read('A'); await b.write('A', 'explicit', explicit);
    await a.write('', '{}'); const emptyKey = await a.query({ kind: 'raster', limit: 1 });
    const afterEmpty = await a.query({ kind: 'raster', limit: 1, after: emptyKey.next });
    const saved = await a.read('A'); a.close(); b.close();
    return { empty: empty.items.length, quota, unchanged: afterFailure.value === old.value && afterFailure.revision?.writeId === old.revision?.writeId,
      oldIndex: oldIndex.items.length, badIndex: badIndex.items.length, conflict, sequence: winner.revision!.sequence,
      pages: [...first.items, ...second.items].map((meta) => meta.key), last: second.next, saved: saved.value,
      emptyKeyPages: [...emptyKey.items, ...afterEmpty.items].map((meta) => meta.key) };
  });
  expect(result).toEqual({ empty: 0, quota: 'QuotaExceededError', unchanged: true, oldIndex: 1, badIndex: 0,
    conflict: 'StorageConflictError', sequence: 2, pages: ['A', 'B'], last: undefined, saved: 'explicit', emptyKeyPages: ['', 'A'] });
});

test('aborted V1 upgrade rolls back completely and restart upgrades byte-identical originals', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const key = '__migration_v1:archive:original', original = '{"original":"unchanged large bytes"}';
    await new Promise<void>((resolve) => { const request = indexedDB.open('northcore-animation-builder', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions');
      request.onsuccess = () => { const tx = request.result.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(original, key);
        tx.oncomplete = () => { request.result.close(); resolve(); }; }; });
    const open = indexedDB.open.bind(indexedDB); let abort = true;
    indexedDB.open = (...args) => { const request = open(...args); request.addEventListener('upgradeneeded', () => {
      if (abort && args[1] === 2) { abort = false; queueMicrotask(() => request.transaction?.abort()); }
    }); return request; };
    const path = '/src/animation/storage.ts', { createSessionClient } = await import(path) as typeof Storage, client = createSessionClient();
    let failure = '';
    try { await client.query({ kind: 'archive' }); } catch (error) { failure = error instanceof Error ? error.name : 'unknown'; }
    const before = (await indexedDB.databases()).find((db) => db.name === 'northcore-animation-builder')!.version;
    indexedDB.open = open; client.close();
    const fresh = createSessionClient(), list = await fresh.query({ kind: 'archive' }), record = await fresh.read(key);
    let oldVersion = '';
    await new Promise<void>((resolve) => { const request = indexedDB.open('northcore-animation-builder', 1);
      request.onerror = () => { oldVersion = request.error?.name ?? ''; resolve(); }; }); fresh.close();
    return { failure, before, items: list.items.length, original: record.value, oldVersion };
  });
  expect(result).toEqual({ failure: 'AbortError', before: 1, items: 1, original: '{"original":"unchanged large bytes"}', oldVersion: 'VersionError' });
});

test('historical document-ID backfill is lazy and prevents collisions without reading archives', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async (rasterV1) => {
    await new Promise<void>((resolve) => { const request = indexedDB.open('northcore-animation-builder', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions');
      request.onsuccess = () => { const tx = request.result.transaction('sessions', 'readwrite');
        for (let i = 0; i < 60; i++) tx.objectStore('sessions').put(JSON.stringify({ version: 2, metadata: { id: `id-${i}` } }), `Doc ${String(i).padStart(3, '0')}`);
        tx.objectStore('sessions').put('large archive', '__migration_v1:archive:untouched');
        tx.objectStore('sessions').put(JSON.stringify(rasterV1), rasterV1.name);
        tx.objectStore('sessions').put('{"format":"northcore-raster128-library","version":1,"templates":[],"migrations":[]}', '__raster128_global_templates_v1');
        tx.oncomplete = () => { request.result.close(); resolve(); }; }; });
    const path = '/src/animation/storage.ts', storage = await import(path) as typeof Storage, client = storage.createSessionClient();
    let archives = 0; const get = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'get')!.value as IDBObjectStore['get'];
    IDBObjectStore.prototype.get = function (key) { if (typeof key === 'string' && key.startsWith('__migration_v1:archive:')) archives++; return get.call(this, key); };
    const unknown = await client.query({ kind: 'raster', detailsKnown: 0 }); await storage.ensureDocumentCatalog(client);
    let collision = '';
    try { await client.run((rows) => rows.set('new', 'bad'), ['new'], 'id-59'); } catch (error) { collision = error instanceof Error ? error.name : 'unknown'; }
    const known = await client.query({ kind: 'raster', targetId: 'id-59' }), left = await client.query({ kind: 'raster', detailsKnown: 0 });
    const filesPath = '/src/animation/files.ts', files = await import(filesPath) as typeof Files;
    const storePath = '/src/animation/store.ts', { AnimationStore } = await import(storePath) as typeof Stores;
    const libraryPath = '/src/animation/globalTemplateLibrary.ts', { GlobalTemplateLibrary, globalLibraryStorage } = await import(libraryPath) as typeof Libraries;
    const store = new AnimationStore(); await files.loadRasterSession(store, rasterV1.name, client);
    const v1Clean = !store.dirty; await files.saveRasterSession(store, { storage: client });
    const v2 = JSON.parse((await client.read(rasterV1.name)).value!) as { version: number };
    const library = new GlobalTemplateLibrary(globalLibraryStorage(client)); await library.load();
    const libraryReady = library.loaded && !library.dirty; library.dispose();
    IDBObjectStore.prototype.get = get; client.close(); return { unknown: unknown.items.length, collision, known: known.items.length, left: left.items.length, archives, v1Clean, version: v2.version, libraryReady };
  }, rasterV1);
  expect(result).toEqual({ unknown: 50, collision: 'StorageIdentityCollision', known: 1, left: 0, archives: 0, v1Clean: true, version: 2, libraryReady: true });
});

test('blocked upgrade releases after the old connection closes, without losing the old record', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const held = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('northcore-animation-builder', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve) => { const tx = held.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put('old', 'record'); tx.oncomplete = () => resolve(); });
    const path = '/src/animation/storage.ts', { createSessionClient } = await import(path) as typeof Storage, client = createSessionClient();
    let blocked = '';
    try { await client.query({ kind: 'raster' }); } catch (error) { blocked = error instanceof Error ? error.message : 'unknown'; }
    held.close(); const page = await client.query({ kind: 'raster' }), record = await client.read('record'); client.close();
    return { blocked: blocked.includes('älteres Fenster'), count: page.items.length, original: record.value };
  });
  expect(result).toEqual({ blocked: true, count: 1, original: 'old' });
});

test('document and migration manager lists load additional pages and filter status without changing the canvas', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const storagePath = '/src/animation/storage.ts', { localSessionStorage: disk } = await import(storagePath) as typeof Storage;
    const storePath = '/src/animation/store.ts', { animationStore } = await import(storePath) as typeof Stores;
    const filesPath = '/src/animation/files.ts', { serializeSession } = await import(filesPath) as typeof Files;
    const original = JSON.parse(serializeSession(animationStore)) as { name: string; metadata: { id: string } };
    const rows = new Map<string, string>(), id = (i: number) => i.toString(16).padStart(64, '0');
    for (let i = 0; i < 67; i++) {
      const name = `Paged ${String(i).padStart(3, '0')}`;
      rows.set(name, JSON.stringify({ ...original, name, metadata: { ...original.metadata, id: name } }));
      rows.set(`__migration_v1:archive:${id(i)}`, JSON.stringify({ original: { source: { name: `source-${i}.finoanim.json` } } }));
      rows.set(`__migration_v1:journal:${id(i)}`, JSON.stringify({ journalVersion: 1, id: id(i), migrationVersion: 1, converterVersion: '1',
        scope: 'rendered-animation', libraryDisposition: 'absent', sourceKey: `source-${i}.finoanim.json`, sourceSha256: id(i),
        libraryKey: '__legacy_templates', librarySha256: null, archiveId: id(i), conversionSha256: id(i), targetId: `target-${i}`,
        targetKey: `Raster-Migration target-${i}.raster128.json`, targetSha256: id(i), route: 'exact', approval: 'not-required',
        approvedConversionSha256: null, status: i % 2 ? 'failed' : 'completed', revision: 1, attempts: 1, error: null }));
    }
    await disk.run((entries) => { for (const [key, value] of rows) entries.set(key, value); }, [...rows.keys()]);
    await disk.write('__raster128_global_templates_v1', JSON.stringify({ format: 'northcore-raster128-library', version: 1, migrations: [],
      templates: Array.from({ length: 80 }, (_, i) => ({ id: `large-${i}`, name: `Large ${i}`, width: 128, height: 128, origin: { x: 0, y: 0 },
        pixels: Array.from({ length: 4096 }, (_, k) => [k, 0x123456ff]) })) }));
    window.catalogLibraryReads = 0;
    const get = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'get')!.value as IDBObjectStore['get'];
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'sessions' && key === '__raster128_global_templates_v1') window.catalogLibraryReads++;
      return get.call(this, key);
    };
  });
  await page.getByRole('button', { name: 'Animation Builder Fino zeichnen und animieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paged 049', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paged 050', exact: true })).toHaveCount(0);
  const bounds = await page.locator('.ab-canvas').boundingBox();
  expect(await page.evaluate(() => window.catalogLibraryReads)).toBe(0);
  await page.getByRole('button', { name: 'Weitere Raster-Dokumente laden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paged 066', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weitere Raster-Dokumente laden', exact: true })).toHaveCount(0);
  expect(await page.locator('.ab-canvas').boundingBox()).toEqual(bounds);
  await page.getByRole('button', { name: 'Legacy-Daten importieren / verwalten …', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Legacy-Daten importieren und verwalten', exact: true });
  await expect(dialog.getByRole('button', { name: 'Vollständiges Originalarchiv exportieren', exact: true })).toHaveCount(50);
  await dialog.getByRole('button', { name: 'Weitere Archive laden', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Vollständiges Originalarchiv exportieren', exact: true })).toHaveCount(67);
  await dialog.getByRole('button', { name: 'Weitere Journale laden', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Ziel öffnen:', exact: false })).toHaveCount(34);
  await dialog.getByLabel('Journalstatus').selectOption('failed');
  await expect(dialog.getByRole('button', { name: 'Ziel öffnen:', exact: false })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Wiederaufnehmen:', exact: false })).toHaveCount(33);
  await dialog.getByRole('button', { name: 'Schließen / Abbrechen', exact: true }).click();
  expect(await page.locator('.ab-canvas').boundingBox()).toEqual(bounds);
  expect(await page.evaluate(() => window.catalogLibraryReads)).toBe(0);
  await page.getByRole('tab', { name: 'Vorlagen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Large 0', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.catalogLibraryReads)).toBe(1);
});
