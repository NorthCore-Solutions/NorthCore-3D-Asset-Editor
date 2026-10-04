import { CATALOG_INDEXES, metadataKey, summarizeStorage, matchesMetadata, pageLimit } from './storageCatalog';
import type { StorageMetadata, StorageQuery, StoragePage } from './storageCatalog';
import type { SessionStorage } from './storage';

const DB = 'northcore-animation-builder';
const CATALOG = 'builder_metadata';
/** V3 removes retired records and rebuilds native indexes; Raster128 document bytes stay unchanged. */
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 3); let abandoned = false;
    request.onupgradeneeded = () => {
      const db = request.result, tx = request.transaction!;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions');
      if (db.objectStoreNames.contains(CATALOG)) db.deleteObjectStore(CATALOG);
      const catalog = db.createObjectStore(CATALOG, { keyPath: 'key' });
      catalog.createIndex('kind', ['kind', 'key']);
      for (const field of CATALOG_INDEXES) catalog.createIndex(field, ['kind', field, 'key']);
      const sessions = tx.objectStore('sessions'), cursor = sessions.openKeyCursor();
      cursor.onsuccess = () => {
        const row = cursor.result; if (!row) return;
        if (typeof row.key === 'string') {
          const candidate = row.key.startsWith('__builder_revision_v1:') ? row.key.slice('__builder_revision_v1:'.length) : row.key;
          if (candidate.startsWith('__migration_v1:') || candidate === '__legacy_templates' || candidate.endsWith('.finoanim.json')) {
            sessions.delete(row.key); row.continue(); return;
          }
          const meta = metadataKey(row.key);
          if (meta) catalog.put(meta);
        }
        row.continue();
      };
    };
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => { abandoned = true; reject(Error('Speicherupgrade wird durch ein älteres Fenster blockiert. Dieses schließen und erneut versuchen.')); };
    request.onerror = () => reject(request.error ?? Error('Dateispeicher nicht verfügbar'));
  });
}
async function transact<T>(stores: string[], mode: IDBTransactionMode, operate: (tx: IDBTransaction, result: (value: T) => void) => void) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode); let value: T, failure: unknown;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(failure instanceof Error ? failure : tx.error ?? Error('Speichertransaktion abgebrochen.'));
      try { operate(tx, (next) => { value = next; }); }
      catch (error) { failure = error; tx.abort(); }
      // Async IDB callbacks must abort explicitly too, preserving their useful original error.
      failures.set(tx, (error) => { failure = error; tx.abort(); });
    });
  } finally { db.close(); }
}
const failures = new WeakMap<IDBTransaction, (error: unknown) => void>();
function guarded(tx: IDBTransaction, action: () => void) { try { action(); } catch (error) { failures.get(tx)?.(error); } }
function readKeys(tx: IDBTransaction, keys: readonly string[], done: (entries: Map<string, string>) => void) {
  const entries = new Map<string, string>(), selected = [...new Set(keys)];
  if (!selected.length) { done(entries); return; }
  let remaining = selected.length;
  for (const key of selected) {
    const read = tx.objectStore('sessions').get(key);
    read.onsuccess = () => guarded(tx, () => {
      if (read.result !== undefined) {
        if (typeof read.result !== 'string') throw Error('Ungültiger Sitzungsdatensatz.');
        entries.set(key, read.result);
      }
      if (--remaining === 0) done(entries);
    });
  }
}
export const indexedSessionStorage: SessionStorage = {
  metadata(key) {
    return transact([CATALOG], 'readonly', (tx, done) => { const read = tx.objectStore(CATALOG).get(key); read.onsuccess = () => done(read.result as StorageMetadata | undefined); });
  },
  probe(key, revisionKey) {
    return transact(['sessions'], 'readonly', (tx, done) => {
      const sessions = tx.objectStore('sessions'), revision = sessions.get(revisionKey), exists = sessions.getKey(key);
      let pending = 2;
      const finish = () => { if (--pending === 0) done({ exists: exists.result !== undefined, rawRevision: revision.result as string | undefined }); };
      revision.onsuccess = exists.onsuccess = finish;
    });
  },
  readKeys(keys) { return transact(['sessions'], 'readonly', (tx, done) => readKeys(tx, keys, done)); },
  has(key) {
    return transact(['sessions'], 'readonly', (tx, done) => { const read = tx.objectStore('sessions').getKey(key); read.onsuccess = () => done(read.result !== undefined); });
  },
  async run<T>(change: (entries: Map<string, string>) => T, keys?: readonly string[], prepared?: ReadonlyMap<string, StorageMetadata | undefined>): Promise<T> {
    if (!keys) throw Error('Speichertransaktion benötigt explizite Keys.');
    return transact(['sessions', CATALOG], 'readwrite', (tx, done) => {
      const catalog = tx.objectStore(CATALOG);
      const perform = () => readKeys(tx, keys, (entries) => {
        const before = new Map(entries), result = change(entries), sessions = tx.objectStore('sessions'), scope = new Set(keys);
        for (const key of new Set([...entries.keys(), ...before.keys()])) if (before.get(key) !== entries.get(key)) {
          if (!scope.has(key)) throw Error(`Speicherkey außerhalb des Transaktionsbereichs: ${key}`);
          if (entries.has(key)) {
            const value = entries.get(key)!; sessions.put(value, key);
            const meta = prepared?.get(key) ?? summarizeStorage(key, value); if (meta) catalog.put(meta);
          } else { sessions.delete(key); catalog.delete(key); }
        }
        done(result);
      });
      perform();
    });
  },
  query(query: StorageQuery): Promise<StoragePage> {
    return transact([CATALOG], 'readonly', (tx, done) => {
      const field = CATALOG_INDEXES.find((field) => query[field] !== undefined);
      const prefix: IDBValidKey[] = field ? [query.kind, query[field]!] : [query.kind];
      const range = IDBKeyRange.bound([...prefix, query.after ?? ''], [...prefix, []], query.after !== undefined);
      const cursor = tx.objectStore(CATALOG).index(field ?? 'kind').openCursor(range), limit = pageLimit(query);
      const items: StorageMetadata[] = []; let scanned = 0, last: string | undefined;
      cursor.onsuccess = () => guarded(tx, () => {
        const row = cursor.result; if (!row) { done({ items }); return; }
        if (scanned === limit) { done({ items, next: last }); return; }
        const meta = row.value as StorageMetadata; last = meta.key; scanned++;
        if (matchesMetadata(meta, query)) items.push(meta);
        row.continue();
      });
    });
  },
  /** Derived-only refresh compares payload bytes in the same transaction; never rewrites an original. */
  enrich(key, value, metadata) {
    return transact(['sessions', CATALOG], 'readwrite', (tx, done) => {
      const read = tx.objectStore('sessions').get(key);
      read.onsuccess = () => guarded(tx, () => { if (read.result === value && metadata) tx.objectStore(CATALOG).put(metadata); done(undefined); });
    });
  },
};
