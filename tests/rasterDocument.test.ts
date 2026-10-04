import { expect, it } from 'vitest';
import v1 from './fixtures/raster-session-v1.json';
import { AnimationStore } from '../src/animation/store';
import { restoreSession, serializeSession } from '../src/animation/files';
import { parseDocumentMetadata } from '../src/animation/document';
import type { DocumentMetadata } from '../src/animation/document';
import { production, render, sample } from '../src/animation/raster';

const metadata: DocumentMetadata = {
  id: 'document-test', reactionState: 'happy',
  provenance: { kind: 'legacy', sourceId: 'standing_neutral', fileName: 'original.finoanim.json',
    storageKey: 'local-key', sha256: 'ab'.repeat(32), archiveId: 'archive-test' },
  legacy: { formatVersion: 1, rigVersion: 2, basePose: 'standing_neutral', definitionId: 'legacy-id', addonRoot: 'addons_normalized' },
  migration: { reportVersion: 1, stage: 'assessment', archiveId: 'archive-test', converter: { name: 'future-tool', version: '1' },
    report: { auditVersion: 1, migrationPerformed: false, route: 'blockiert', issues: [{ code: 'ambiguous', value: null }], exact: false, count: 3 } },
};
function restoredV1() {
  const store = new AnimationStore();
  restoreSession(store, JSON.stringify(v1));
  return store;
}

it('loads real V1 structure, collections, reference and historic navigation with a clean baseline', () => {
  const store = restoredV1();
  expect(store.state.index).toBe(1);
  expect(store.state.active).toBe('pixels-1');
  expect(store.frame.duration).toBe(123);
  expect(store.templates[0]!.pixels.get(386)).toBe(287453953);
  expect(store.faces[0]!.id).toBe('face-1');
  expect([...store.reference!.rgba]).toEqual([17, 34, 51, 1]);
  expect(store.state.metadata.provenance).toEqual({ kind: 'raster-v1', sourceId: 'empty' });
  expect(store.dirty).toBe(false);
});

it('V1 identity is deterministic, independent of navigation, object key order and pixel entry order', () => {
  const a = restoredV1();
  const b = new AnimationStore();
  const variant = structuredClone(v1);
  variant.index = 0; variant.active = 'other';
  variant.frames[0]!.layers[0]!.pixels.reverse();
  restoreSession(b, JSON.stringify(Object.fromEntries(Object.entries(variant).reverse())));
  expect(b.state.metadata.id).toBe(a.state.metadata.id);
  variant.name = 'Other content';
  restoreSession(b, JSON.stringify(variant));
  expect(b.state.metadata.id).not.toBe(a.state.metadata.id);
});

it('V1 upgrades to V2 and repeated restores/saves preserve identity and every content field', () => {
  const store = restoredV1();
  const json = serializeSession(store);
  const saved = JSON.parse(json) as Record<string, unknown>;
  expect(saved.version).toBe(2);
  expect(saved).not.toHaveProperty('index');
  expect(saved).not.toHaveProperty('active');
  const content: Record<string, unknown> = { ...v1 };
  delete content.version; delete content.index; delete content.active;
  expect(saved).toEqual({ version: 2, ...content, metadata: store.state.metadata });
  const second = new AnimationStore();
  restoreSession(second, json);
  expect(second.state.index).toBe(0);
  expect(second.state.active).toBe('pixels-1');
  expect(serializeSession(second)).toBe(json);
  expect(second.dirty).toBe(false);
});

it('V2 roundtrip preserves all metadata including open JSON report payloads without interpreting them', () => {
  const store = restoredV1();
  store.setDocumentMetadata(metadata);
  const json = serializeSession(store);
  const second = new AnimationStore();
  restoreSession(second, json);
  expect(second.state.metadata).toEqual(metadata);
  expect(Object.isFrozen(second.state.metadata.migration!.report.issues)).toBe(true);
  expect(serializeSession(second)).toBe(json);
  expect(second.dirty).toBe(false);
  expect(second.past).toHaveLength(0);
});

it.each([1, 2])('restoring V%s replaces dirty metadata and collections with a consistent saved baseline', (version) => {
  const store = restoredV1();
  const json = version === 1 ? JSON.stringify(v1) : serializeSession(store);
  store.setDocumentMetadata(metadata);
  store.renameAsset('template-1', 'Unsaved');
  expect(store.dirty).toBe(true);
  restoreSession(store, json);
  expect(store.state.metadata.provenance?.kind).toBe('raster-v1');
  expect(store.state.metadata.migration).toBeUndefined();
  expect(store.templates[0]!.name).toBe('Template');
  expect(store.dirty).toBe(false);
});

it.each(['id', 'reactionState', 'provenance', 'migration', 'legacy'] as const)('%s metadata changes dirty the existing baseline and undo/redo retain collection boundaries', (field) => {
  const store = restoredV1();
  store.setDocumentMetadata({ ...store.state.metadata, [field]: metadata[field] });
  expect(store.dirty).toBe(true);
  const collections = [store.templates, store.faces];
  store.undo(); expect(store.dirty).toBe(false);
  store.redo(); expect(store.dirty).toBe(true);
  expect([store.templates, store.faces]).toEqual(collections);
  store.markSaved(store.captureContent()); expect(store.dirty).toBe(false);
  const past = store.past.length;
  store.setDocumentMetadata(structuredClone(store.state.metadata));
  expect(store.past).toHaveLength(past);
  expect(store.dirty).toBe(false);
});

it('navigation, selection, playback flags and viewport are absent from V2 and remain clean', () => {
  const store = restoredV1();
  const json = serializeSession(store);
  store.frameAt(0); store.selectLayer('other'); store.selectTool('pan');
  store.setSelection(new Set([386])); store.playing = true; store.emit();
  expect(store.dirty).toBe(false);
  expect(serializeSession(store)).toBe(json);
});

it.each([0, 3, 999, '2', null])('rejects unsupported document version %s before changing the store', (version) => {
  const store = restoredV1(); const state = store.state;
  expect(() => restoreSession(store, JSON.stringify({ ...v1, version }))).toThrow('Dokumentversion');
  expect(store.state).toBe(state); expect(store.dirty).toBe(false);
});

it.each([
  null, {}, { id: '' }, { id: 12 }, { id: 'x', extra: true }, { id: 'x', reactionState: null },
  { id: 'x', provenance: { kind: 'unknown' } }, { id: 'x', provenance: { kind: ['native'] } },
  { id: 'x', provenance: { kind: 'legacy', sha256: 'bad' } },
  { id: 'x', legacy: { formatVersion: 1, basePose: 'standing', rigVersion: 3 } },
  { id: 'x', migration: { reportVersion: 2, stage: 'assessment', report: {} } },
  { id: 'x', migration: { reportVersion: 1, stage: 'converted', report: {} } },
  { id: 'x', migration: { reportVersion: 1, stage: 'assessment', report: [] } },
])('invalid metadata %j does not mutate restore state or baseline', (invalid) => {
  const store = restoredV1(); const before = store.state;
  expect(() => restoreSession(store, JSON.stringify({ ...v1, version: 2, metadata: invalid }))).toThrow('metadaten');
  expect(store.state).toBe(before); expect(store.dirty).toBe(false);
});

it('API rejects non-JSON report values and detaches/freeze nested input', () => {
  expect(() => parseDocumentMetadata({ ...metadata, migration: { ...metadata.migration, report: { invalid: NaN } } })).toThrow();
  expect(() => parseDocumentMetadata({ ...metadata, migration: { ...metadata.migration, report: { invalid: undefined } } })).toThrow();
  const input = structuredClone(metadata);
  const parsed = parseDocumentMetadata(input);
  expect(parsed).toEqual(input); expect(parsed).not.toBe(input);
  expect(Object.isFrozen(parsed.migration!.report)).toBe(true);
});

it('metadata and V1/V2 roundtrips do not change native sampling, RGBA or 8x export bytes', () => {
  const store = restoredV1(); store.frameAt(0);
  const layers = store.frame.layers;
  const native = render(layers), output = production(layers);
  const color = sample(layers, 386);
  store.setDocumentMetadata(metadata);
  const second = new AnimationStore(); restoreSession(second, serializeSession(store));
  expect(Buffer.from(render(second.frame.layers))).toEqual(Buffer.from(native));
  expect(Buffer.from(production(second.frame.layers)).equals(Buffer.from(output))).toBe(true);
  expect(sample(second.frame.layers, 386)).toBe(color);
});
