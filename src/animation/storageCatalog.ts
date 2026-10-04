/** Derived summaries for local Raster128 documents and the pixel template library. */
export type StorageKind = 'raster' | 'global-library';
export type StorageMetadata = { key: string; kind: StorageKind; detailsKnown: 0 | 1 };
export type StorageQuery = { kind: StorageKind; after?: string; limit?: number; detailsKnown?: 0 | 1 };
export type StoragePage = { items: StorageMetadata[]; next?: string };
export const CATALOG_INDEXES = ['detailsKnown'] as const;
export function metadataKey(key: string): StorageMetadata | undefined {
  if (key === '__raster128_global_templates_v1') return { key, kind: 'global-library', detailsKnown: 0 };
  if (key.startsWith('__') || key.endsWith('.finoanim.json')) return;
  return { key, kind: 'raster', detailsKnown: 0 };
}
export function summarizeStorage(key: string, value: string): StorageMetadata | undefined {
  const meta = metadataKey(key);
  if (!meta) return;
  try { JSON.parse(value); return { ...meta, detailsKnown: 1 }; } catch { return meta; }
}
export function preparedMetadata(key: string, value: string) { return Promise.resolve(summarizeStorage(key, value)); }
export function pageLimit(query: StorageQuery) { return Math.max(1, Math.min(100, Math.trunc(query.limit ?? 50) || 50)); }
export function matchesMetadata(meta: StorageMetadata, query: StorageQuery) {
  return meta.kind === query.kind && (query.detailsKnown === undefined || meta.detailsKnown === query.detailsKnown);
}
