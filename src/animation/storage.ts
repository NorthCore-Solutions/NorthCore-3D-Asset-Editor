import { indexedSessionStorage } from './indexedSessionStorage';
import { preparedMetadata, matchesMetadata, pageLimit } from './storageCatalog';
import type { StorageMetadata, StorageQuery, StoragePage } from './storageCatalog';
// Separate local session storage: never touches the 3D project's storage key.
const DB = 'northcore-animation-builder';
const REVISION_PREFIX = '__builder_revision_v1:';
const NOTICE_KEY = '__northcore_builder_write_notice_v1';
export type SessionRecord = { value: string | undefined; revision: { sequence: number; writeId: string } | null };
export class StorageConflictError extends Error {
  constructor(readonly key: string) {
    super(`Speicherkonflikt: „${key}“ wurde in einem anderen Tab geändert. Erneut laden oder ausdrücklich überschreiben.`);
    this.name = 'StorageConflictError';
  }
}
export function sameSessionRecord(a: SessionRecord, b: SessionRecord) {
  return a.value === b.value && a.revision?.sequence === b.revision?.sequence && a.revision?.writeId === b.revision?.writeId;
}
const revisionKey = (key: string) => `${REVISION_PREFIX}${encodeURIComponent(key)}`;
function nextRevision(current: SessionRecord, writer: string) {
  const sequence = (current.revision?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence)) throw Error('Speicherrevision ist ausgeschöpft.');
  return { sequence, writeId: `${writer}:${crypto.randomUUID()}` };
}
function record(entries: Map<string, string>, key: string): SessionRecord {
  const raw = entries.get(revisionKey(key));
  const revision = raw === undefined ? null : JSON.parse(raw) as SessionRecord['revision'];
  if (raw !== undefined && (!revision || !Number.isSafeInteger(revision.sequence) || revision.sequence < 1 || typeof revision.writeId !== 'string' || !revision.writeId))
    throw Error('Ungültige Speicherrevision.');
  return { value: entries.get(key), revision };
}
/** Synchronous scoped transactions retain IDB atomicity; optional APIs support small injected test drivers. */
export interface SessionStorage {
  run<T>(change: (entries: Map<string, string>) => T, keys?: readonly string[], documentId?: string,
    prepared?: ReadonlyMap<string, StorageMetadata | undefined>): Promise<T>;
  readKeys?(keys: readonly string[]): Promise<Map<string, string>>;
  has?(key: string): Promise<boolean>;
  query?(query: StorageQuery): Promise<StoragePage>;
  enrich?(key: string, value: string, metadata: StorageMetadata | undefined): Promise<void>;
  probe?(key: string, revisionKey: string): Promise<{ exists: boolean; rawRevision?: string }>;
  metadata?(key: string): Promise<StorageMetadata | undefined>;
}
export async function readStorageKeys(storage: SessionStorage, keys: readonly string[]) {
  return storage.readKeys ? storage.readKeys(keys) : storage.run((entries) => new Map(keys.filter((key) => entries.has(key)).map((key) => [key, entries.get(key)!])), keys);
}
export function hasStorageKey(storage: SessionStorage, key: string) {
  return storage.has ? storage.has(key) : storage.run((entries) => entries.has(key), [key]);
}
export async function queryStorage(storage: SessionStorage, query: StorageQuery): Promise<StoragePage> {
  if (storage.query) return storage.query(query);
  // Compatibility for in-memory transaction drivers; production uses the native indexed catalog.
  const entries = await storage.run((rows) => new Map(rows));
  const candidates = (await Promise.all([...entries].map(([key, value]) => preparedMetadata(key, value))))
    .filter((meta): meta is StorageMetadata => Boolean(meta) && matchesMetadata(meta!, query) && (query.after === undefined || meta!.key > query.after))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const items = candidates.slice(0, pageLimit(query));
  return { items, ...(candidates.length > items.length ? { next: items.at(-1)!.key } : {}) };
}
/** Resolve historical document IDs in bounded batches only when an ID-sensitive migration needs them. */
export async function ensureDocumentCatalog(storage: SessionStorage) {
  if (!storage.enrich) return;
  let page: StoragePage;
  do {
    page = await queryStorage(storage, { kind: 'raster', detailsKnown: 0, limit: 25 });
    for (const meta of page.items) {
      const value = (await readStorageKeys(storage, [meta.key])).get(meta.key);
      if (value !== undefined) await storage.enrich(meta.key, value, await preparedMetadata(meta.key, value));
    }
  } while (page.next);
}

type Notice = { writer: string; keys: string[] };
/** A client owns observed bases, never advancing them merely because a foreign write is announced. */
export function createSessionClient(driver: SessionStorage = indexedSessionStorage) {
  const writer = crypto.randomUUID(), known = new Map<string, SessionRecord>(), listeners = new Set<(keys: readonly string[]) => void>();
  let closed = false, started = false, channel: BroadcastChannel | undefined;
  let removeEvents = () => {};
  function check() { if (closed) throw new DOMException('Speicherclient geschlossen.', 'AbortError'); }
  function announce(keys: readonly string[]) {
    for (const listener of listeners) { try { listener(keys); } catch { /* Notifications cannot change transaction success. */ } }
  }
  function receive(value: unknown) {
    const notice = value as Partial<Notice> | null;
    if (!closed && notice && notice.writer !== writer && typeof notice.writer === 'string' && Array.isArray(notice.keys) && notice.keys.every((key) => typeof key === 'string')) announce(notice.keys);
  }
  function start() {
    if (started || closed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    started = true;
    try { if (typeof BroadcastChannel !== 'undefined') { channel = new BroadcastChannel(DB); channel.onmessage = (event) => receive(event.data); } } catch { /* Storage-event fallback below. */ }
    const storageEvent = (event: StorageEvent) => { if (event.key === NOTICE_KEY && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch { /* Advisory message only. */ } } };
    // Missed/suspended notifications and API-less WebViews are rechecked on activation, without polling.
    const activate = () => announce(['*', ...known.keys()]);
    const visible = () => { if (document.visibilityState === 'visible') activate(); };
    window.addEventListener('storage', storageEvent); window.addEventListener('focus', activate); window.addEventListener('pageshow', activate);
    document.addEventListener('visibilitychange', visible);
    removeEvents = () => {
      window.removeEventListener('storage', storageEvent); window.removeEventListener('focus', activate); window.removeEventListener('pageshow', activate);
      document.removeEventListener('visibilitychange', visible);
    };
  }
  function publish(keys: string[]) {
    if (!keys.length || closed) return;
    start(); const notice: Notice = { writer, keys };
    if (channel) {
      try { channel.postMessage(notice); return; } catch { channel.close(); channel = undefined; }
    }
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(NOTICE_KEY, JSON.stringify({ ...notice, nonce: crypto.randomUUID() }));
    } catch { /* CAS remains authoritative when notification APIs/storage are unavailable. */ }
  }
  const client = {
    subscribe(listener: (keys: readonly string[]) => void) { start(); listeners.add(listener); return () => { listeners.delete(listener); }; },
    isOwnRecord(value: Pick<SessionRecord, 'revision'>) { return value.revision?.writeId.startsWith(`${writer}:`) ?? false; },
    close() { closed = true; channel?.close(); removeEvents(); listeners.clear(); },
    async read(key: string): Promise<SessionRecord> {
      check(); start();
      const rows = await readStorageKeys(driver, [key, revisionKey(key)]); check();
      const value = record(rows, key);
      if (value.value !== undefined && driver.enrich) {
        const meta = await driver.metadata?.(key);
        if (!meta?.detailsKnown || ((meta.kind === 'legacy-source' || meta.kind === 'legacy-library') && !meta.sourceSha256))
          await driver.enrich(key, value.value, await preparedMetadata(key, value.value));
      }
      known.set(key, value); return structuredClone(value);
    },
    async readKeys(keys: readonly string[]) { check(); start(); return readStorageKeys(driver, keys); },
    async has(key: string) { check(); start(); return hasStorageKey(driver, key); },
    async query(query: StorageQuery) { check(); start(); return queryStorage(driver, query); },
    async enrich(key: string, value: string, metadata: StorageMetadata | undefined) { check(); return driver.enrich?.(key, value, metadata); },
    async metadata(key: string) { check(); return driver.metadata?.(key); },
    async head(key: string) {
      check(); start();
      const probe = driver.probe ? await driver.probe(key, revisionKey(key))
        : await driver.run((rows) => ({ exists: rows.has(key), rawRevision: rows.get(revisionKey(key)) }), [key, revisionKey(key)]);
      const rows = new Map<string, string>(); if (probe.rawRevision !== undefined) rows.set(revisionKey(key), probe.rawRevision);
      return { revision: record(rows, key).revision, exists: probe.exists };
    },
    async write(key: string, value: string, expected: SessionRecord = known.get(key) ?? { value: undefined, revision: null }): Promise<SessionRecord> {
      check(); start(); const base = structuredClone(expected);
      if (key.startsWith(REVISION_PREFIX)) throw Error('Reservierter Speicherkey.');
      const metadata = await preparedMetadata(key, value);
      const saved = await driver.run((entries) => {
        check(); const current = record(entries, key);
        if (!sameSessionRecord(current, base)) throw new StorageConflictError(key);
        const next = { value, revision: nextRevision(current, writer) };
        entries.set(key, value); entries.set(revisionKey(key), JSON.stringify(next.revision)); return next;
      }, [key, revisionKey(key)], undefined, new Map([[key, metadata]]));
      known.set(key, saved); publish([key]); return structuredClone(saved);
    },
    // Only synchronous changes derived from current entries belong here. Cached snapshots use write(expected);
    // multi-phase owners (journals) compare their own captured revision in the callback.
    async run<T>(change: (entries: Map<string, string>) => T, keys?: readonly string[], documentId?: string): Promise<T> {
      check(); start();
      const saved = await driver.run((raw) => {
        check(); const entries = new Map([...raw].filter(([key]) => !key.startsWith(REVISION_PREFIX))), before = new Map(entries);
        const result = change(entries), changed: string[] = [];
        for (const key of new Set([...before.keys(), ...entries.keys()])) if (before.get(key) !== entries.get(key)) {
          if (key.startsWith(REVISION_PREFIX)) throw Error('Reservierter Speicherkey.');
          const current = record(raw, key);
          if (entries.has(key)) raw.set(key, entries.get(key)!); else raw.delete(key);
          raw.set(revisionKey(key), JSON.stringify(nextRevision(current, writer)));
          changed.push(key);
        }
        return { result, changed };
      }, keys ? [...new Set(keys.flatMap((key) => [key, revisionKey(key)]))] : undefined, documentId);
      publish(saved.changed); return saved.result;
    },
  };
  return client;
}
export type SessionClient = ReturnType<typeof createSessionClient>;
export const localSessionStorage = createSessionClient();
export async function saveLocalSession(name: string, json: string): Promise<void> { await localSessionStorage.write(name, json); }
export function sameStorageHead(head: { revision: SessionRecord['revision']; exists: boolean }, base: SessionRecord) {
  return head.exists === (base.value !== undefined) && head.revision?.sequence === base.revision?.sequence && head.revision?.writeId === base.revision?.writeId;
}
