/** Small disposable summaries; sessions remains the authoritative, byte-preserving payload store. */
export type StorageKind = 'raster' | 'legacy-source' | 'journal' | 'archive' | 'legacy-library' | 'global-library';
export type StorageMetadata = {
  key: string; kind: StorageKind; detailsKnown: 0 | 1;
  sourceKey?: string; sourceSha256?: string; sourceIdentitySha256?: string;
  archiveId?: string; targetId?: string; status?: string; hasLibrary?: boolean;
  summary?: string;
};
export type StorageQuery = {
  kind: StorageKind; after?: string; limit?: number;
  status?: string; sourceKey?: string; sourceSha256?: string; sourceIdentitySha256?: string;
  archiveId?: string; targetId?: string; detailsKnown?: 0 | 1;
};
export type StoragePage = { items: StorageMetadata[]; next?: string };
export const CATALOG_INDEXES = ['status', 'sourceKey', 'sourceSha256', 'sourceIdentitySha256', 'archiveId', 'targetId', 'detailsKnown'] as const;
export function metadataKey(key: string): StorageMetadata | undefined {
  if (key.startsWith('__builder_revision_v1:')) return;
  if (key.startsWith('__migration_v1:journal:')) return { key, kind: 'journal', status: 'unknown', detailsKnown: 0 };
  if (key.startsWith('__migration_v1:archive:')) return { key, kind: 'archive', archiveId: key.slice('__migration_v1:archive:'.length), detailsKnown: 0 };
  if (key === '__legacy_templates') return { key, kind: 'legacy-library', detailsKnown: 0 };
  if (key === '__raster128_global_templates_v1') return { key, kind: 'global-library', detailsKnown: 0 };
  if (key.startsWith('__')) return;
  return { key, kind: key.endsWith('.finoanim.json') ? 'legacy-source' : 'raster', detailsKnown: 0 };
}
export function summarizeStorage(key: string, value: string): StorageMetadata | undefined {
  const meta = metadataKey(key); if (!meta) return;
  if (meta.kind === 'global-library' || meta.kind === 'legacy-library') return { ...meta, detailsKnown: 1 };
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return meta;
    const str = (field: string) => typeof raw[field] === 'string' ? raw[field] : undefined;
    if (meta.kind === 'journal') return { ...meta, detailsKnown: 1, sourceKey: str('sourceKey'), sourceSha256: str('sourceSha256'),
      sourceIdentitySha256: str('sourceIdentitySha256'), archiveId: str('archiveId'), targetId: str('targetId'), status: str('status') ?? 'unknown',
      // Journals are small. Corrupt oversized records are retained, but never copied into list results.
      ...(value.length <= 65536 ? { summary: value } : {}) };
    if (meta.kind === 'archive') {
      const original = raw.original as { source?: { name?: unknown }; library?: unknown } | undefined;
      return { ...meta, detailsKnown: 1, ...(typeof original?.source?.name === 'string' ? { sourceKey: original.source.name } : {}), hasLibrary: Boolean(original?.library) };
    }
    const document = raw.metadata as { id?: unknown } | undefined;
    return { ...meta, detailsKnown: 1, ...(raw.version === 2 && typeof document?.id === 'string' ? { targetId: document.id } : {}) };
  } catch { return { ...meta, detailsKnown: 1 }; }
}
export async function preparedMetadata(key: string, value: string) {
  const meta = summarizeStorage(key, value);
  if (meta?.kind === 'legacy-source' || meta?.kind === 'legacy-library') {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    meta.sourceSha256 = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return meta;
}
export function pageLimit(query: StorageQuery) { return Math.max(1, Math.min(100, Math.trunc(query.limit ?? 50) || 50)); }
export function matchesMetadata(meta: StorageMetadata, query: StorageQuery) {
  return meta.kind === query.kind && CATALOG_INDEXES.every((field) => query[field] === undefined || meta[field] === query[field]);
}
