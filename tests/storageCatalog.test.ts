import { expect, it } from 'vitest';
import { metadataKey, summarizeStorage, preparedMetadata, matchesMetadata, pageLimit } from '../src/animation/storageCatalog';

it('keeps large payloads and revision/blob/stage keys out of summaries', () => {
  for (const key of ['__builder_revision_v1:Doc', '__migration_v1:blob:hash', '__migration_v1:stage:id', '__migration_v1:document-id:id'])
    expect(metadataKey(key)).toBeUndefined();
  const json = JSON.stringify({ version: 2, metadata: { id: 'doc-id' }, frames: ['pixels'.repeat(100000)] });
  expect(summarizeStorage('Doc', json)).toEqual({ key: 'Doc', kind: 'raster', detailsKnown: 1, targetId: 'doc-id' });
  expect(metadataKey('__migration_v1:archive:abc')).toEqual({ key: '__migration_v1:archive:abc', kind: 'archive', archiveId: 'abc', detailsKnown: 0 });
  const archive = summarizeStorage('__migration_v1:archive:abc', JSON.stringify({ original: { source: { name: 'user.json' }, library: { json: 'x'.repeat(100000) } } }));
  expect(archive).toMatchObject({ sourceKey: 'user.json', hasLibrary: true }); expect(JSON.stringify(archive).length).toBeLessThan(250);
});
it('retains historical small journal details; corrupt or oversized journals remain explicitly unresolved', () => {
  expect(summarizeStorage('__migration_v1:journal:id', '{')).toMatchObject({ status: 'unknown' });
  const huge = summarizeStorage('__migration_v1:journal:id', JSON.stringify({ status: 'failed', error: 'x'.repeat(100000) }));
  expect(huge).toMatchObject({ status: 'failed' }); expect(huge!.summary).toBeUndefined();
});
it('hashes Legacy source/library bytes deterministically without mutating them', async () => {
  const original = '{"version":2}\r\n';
  const first = await preparedMetadata('user.finoanim.json', original), second = await preparedMetadata('user.finoanim.json', original);
  expect(first).toEqual(second); expect(first!.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await preparedMetadata('user.finoanim.json', original.trim()))!.sourceSha256).not.toBe(first!.sourceSha256);
  expect((await preparedMetadata('__legacy_templates', original))!.sourceSha256).toBe(first!.sourceSha256);
});
it('combines filters and bounds page sizes', () => {
  const meta = { key: 'J', kind: 'journal' as const, detailsKnown: 1 as const, status: 'failed', sourceKey: 'user', archiveId: 'a', targetId: 't' };
  expect(matchesMetadata(meta, { kind: 'journal', status: 'failed', sourceKey: 'user', archiveId: 'a', targetId: 't' })).toBe(true);
  expect(matchesMetadata(meta, { kind: 'journal', status: 'completed' })).toBe(false);
  expect(pageLimit({ kind: 'raster', limit: 10000 })).toBe(100); expect(pageLimit({ kind: 'raster', limit: -5 })).toBe(1);
});
