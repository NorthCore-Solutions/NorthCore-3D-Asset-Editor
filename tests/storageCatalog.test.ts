import { expect, it } from 'vitest';
import { metadataKey, summarizeStorage, matchesMetadata, pageLimit } from '../src/animation/storageCatalog';
it('indexes only native documents and the global library, never old special stores', () => {
  for (const key of ['__migration_v1:journal:id', '__migration_v1:archive:abc', '__legacy_templates', '__builder_revision_v1:Doc', 'old.finoanim.json']) expect(metadataKey(key)).toBeUndefined();
  expect(summarizeStorage('Doc', JSON.stringify({ frames: ['x'.repeat(100000)] }))).toEqual({ key: 'Doc', kind: 'raster', detailsKnown: 1 });
  expect(metadataKey('__raster128_global_templates_v1')?.kind).toBe('global-library');
});
it('bounds list sizes and combines native summary filters', () => {
  const meta = { key: 'Doc', kind: 'raster' as const, detailsKnown: 1 as const };
  expect(matchesMetadata(meta, { kind: 'raster', detailsKnown: 1 })).toBe(true);
  expect(matchesMetadata(meta, { kind: 'global-library' })).toBe(false);
  expect(pageLimit({ kind: 'raster', limit: 1000 })).toBe(100);
});
