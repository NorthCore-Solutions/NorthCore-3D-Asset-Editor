import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import inventory from '../src/animation/migration/legacy-inventory.json';
import fixtures from './fixtures/legacy-migration-cases.json';
import multiframe from './fixtures/legacy-multiframe.json';
import { canonicalJson, sha256 } from '../src/animation/contentHash';
import { createLegacyOriginalArchive } from '../src/animation/migration/legacyAudit';
import type { LegacyInput, OriginalArchive, ResourceSet } from '../src/animation/migration/legacyAudit';
import { convertLegacyArchive, LegacyConversionBlockedError, reduceLegacyImage } from '../src/animation/migration/legacyConverter';
import * as legacy from '../src/animation/legacy';
import { LegacyImage } from '../src/animation/legacy';
import type { Definition } from '../src/animation/legacy';
import { parseRasterDocument, restoreSession, serializeSession } from '../src/animation/files';
import { AnimationStore, animationStore } from '../src/animation/store';
import { production, render } from '../src/animation/raster';

const resources: ResourceSet = new Map<string, string | Uint8Array>([
  ...inventory.assets.map((asset) => [asset.path, new Uint8Array(readFileSync(asset.path))] as const),
  [inventory.presets.path, readFileSync(inventory.presets.path, 'utf8')] as const,
]);
const input = (definition: unknown): LegacyInput => ({ definitionJson: JSON.stringify(definition), source: { kind: 'file', name: 'original.finoanim.json' } });
const fixture = (id: string) => fixtures.cases.find((c) => c.id === id)!.definition;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Independent byte-space oracle; production uses packed RGBA and sparse pixel maps.
function nearest128(source: Uint8Array) {
  return Uint8Array.from({ length: 128 * 128 * 4 }, (_, index) => {
    const pixel = Math.floor(index / 4);
    return source[(Math.floor(pixel / 128) * 8 * 1024 + pixel % 128 * 8) * 4 + index % 4]!;
  });
}
const dartGoldens = JSON.parse(readFileSync('tests/fixtures/legacy-dart-goldens.json', 'utf8')) as { definition: Definition; hash: number }[];
function dartHash(data: Uint8Array) {
  let hash = 2166136261;
  for (const value of data) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  return hash;
}
function homogeneous(data: Uint8Array) {
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const source = (Math.floor(y / 8) * 1024 * 8 + Math.floor(x / 8) * 8) * 4, k = (y * 1024 + x) * 4;
    for (let channel = 0; channel < 4; channel++) if (data[k + channel] !== data[source + channel]) return false;
  }
  return true;
}
afterEach(() => vi.restoreAllMocks());

it('converts synthetic frames with original timing, literal pixels and homogeneous native export', async () => {
  const sample = { frames: multiframe.frames.map((f, index) => ({ index, durationMs: f.durationMs, nonUniform8Blocks: 1 })) };
  const source = input(multiframe);
  const archive = await createLegacyOriginalArchive(source, resources, inventory);
  const before = canonicalJson(archive), editor = animationStore.captureContent();
  const converted = await convertLegacyArchive(archive, resources, inventory);
  expect(converted.report.route).toBe('gerastert verlustbehaftet');
  expect(converted.document.frames.map((frame) => frame.duration)).toEqual(sample.frames.map((f) => f.durationMs));
  expect(converted.report.frames.map((f) => f.index)).toEqual(sample.frames.map((f) => f.index));
  expect(converted.report.frames.map((f) => f.nonUniform8Blocks)).toEqual(sample.frames.map((f) => f.nonUniform8Blocks));
  const parsed = parseRasterDocument(converted.json);
  for (const frame of sample.frames) {
    const preview = converted.previews[frame.index]!, report = converted.report.frames[frame.index]!;
    const original = (JSON.parse(source.definitionJson!) as Definition).frames[frame.index]!;
    if (original.ops.length) {
      expect(report.operations!.disposition).toBe('baked-not-replayable');
      expect(report.operations!.types).toEqual(original.ops.map((op) => op.type));
      expect(converted.document.frames[frame.index]!.layers.every((l) => !l.recipe)).toBe(true);
    }
    expect(digest(preview.legacyRgba)).toBe(report.legacyRgbaSha256);
    expect(digest(preview.rasterRgba)).toBe(report.rasterRgbaSha256);
    expect(digest(nearest128(preview.legacyRgba))).toBe(report.rasterRgbaSha256);
    expect(Buffer.from(render(parsed.state.frames[frame.index]!.layers))).toEqual(Buffer.from(preview.rasterRgba));
    const out = production(parsed.state.frames[frame.index]!.layers);
    expect(digest(out)).toBe(report.exportRgbaSha256); expect(homogeneous(out)).toBe(true);
  }
  expect(converted.document.metadata.legacy?.rigVersion).toBe(2);
  expect(converted.document.metadata.provenance?.sha256).toBe(archive.original.definition!.sha256);
  expect(converted.document.metadata.provenance?.archiveId).toBe(archive.archiveId);
  expect(converted.document.metadata.id).not.toBe((JSON.parse(source.definitionJson!) as Definition).id);
  const store = new AnimationStore(); restoreSession(store, converted.json);
  expect(JSON.parse(serializeSession(store)) as unknown).toEqual(converted.document); expect(store.dirty).toBe(false);
  expect(canonicalJson(archive)).toBe(before); expect(animationStore.captureContent()).toEqual(editor);
}, 30000);

it('all 24 pose/rig Dart references survive the audited render-before-reduction path', async () => {
  for (const c of dartGoldens) {
    const archive = await createLegacyOriginalArchive(input(c.definition), resources, inventory);
    const result = await convertLegacyArchive(archive, resources, inventory);
    expect(dartHash(result.previews[0]!.legacyRgba), `${c.definition.basePose} rig ${c.definition.faceRigVersion}`).toBe(c.hash);
    expect(result.document.metadata.legacy?.rigVersion).toBe(c.definition.faceRigVersion ?? 1);
  }
}, 60000);

it('all inventoried operation/default/addon contexts match their frozen source hashes', async () => {
  for (const c of fixtures.cases) for (const context of c.renderContexts) {
    const archive = await createLegacyOriginalArchive({ ...input(c.definition), context: { addonRoot: context.addonRoot } }, resources, inventory);
    const result = await convertLegacyArchive(archive, resources, inventory);
    expect(result.report.frames[0]!.legacyRgbaSha256, `${c.id}/${context.addonRoot}`).toBe(context.expectedRgbaSha256);
    expect(result.report.route, `${c.id}/${context.addonRoot}`).toBe('gerastert verlustbehaftet');
    expect(result.document.frames[0]!.duration).toBe(c.definition.frames[0]!.durationMs);
    if (c.definition.frames[0]!.ops.length) {
      expect(result.report.frames[0]!.operations?.disposition).toBe('baked-not-replayable');
      expect(result.document.frames[0]!.layers.every((layer) => !layer.recipe)).toBe(true);
    }
    expect(result.document.metadata.legacy?.addonRoot).toBe(context.addonRoot);
  }
}, 60000);

function exactDefinition(): Definition {
  const pixels: { x: number; y: number; rgba: number }[] = [];
  for (const [x0, y0, rgba] of [[0, 0, 0x12345601], [8, 0, 0xabcdef80], [1016, 1016, 0xffffffff]]) {
    for (let y = y0!; y < y0! + 8; y++) for (let x = x0!; x < x0! + 8; x++) pixels.push({ x, y, rgba: rgba! });
  }
  return { version: 2, faceRigVersion: 2, id: 'exact-original', name: 'Exact', basePose: 'fino_standing_neutral.png', reactionState: 'happy',
    frames: [{ durationMs: 37, ops: [], layers: [{ id: 'p', name: 'Pixels', kind: 'pixels', pixels }] }] };
}
it('an exact low-alpha source produces a byte-identical 1024 export, stable hashes and fresh target IDs', async () => {
  const source = input(exactDefinition()), resourceHash = await sha256(canonicalJson([...resources].map(([path, raw]) => [path, typeof raw === 'string' ? raw : [...raw]])));
  source.source = { kind: 'local', name: 'Exact.finoanim.json' };
  const archive = await createLegacyOriginalArchive(source, resources, inventory);
  const a = await convertLegacyArchive(archive, resources, inventory), b = await convertLegacyArchive(archive, resources, inventory);
  expect(a.report.route).toBe('gerastert exakt'); expect(a.report.frames[0]!.nonUniform8Blocks).toBe(0);
  const parsed = parseRasterDocument(a.json);
  expect(Buffer.from(production(parsed.state.frames[0]!.layers)).equals(Buffer.from(a.previews[0]!.legacyRgba))).toBe(true);
  expect(a.report.frames[0]!.legacyRgbaSha256).toBe(a.report.frames[0]!.exportRgbaSha256);
  expect(a.report).toEqual(b.report); expect(a.document.frames).toEqual(b.document.frames);
  expect(a.document.metadata.id).not.toBe(b.document.metadata.id);
  expect(a.document.metadata.reactionState).toBe('happy'); expect(a.document.metadata.provenance?.storageKey).toBe('Exact.finoanim.json');
  expect(a.document.metadata.migration?.report).toEqual(a.report);
  expect(await sha256(canonicalJson([...resources].map(([path, raw]) => [path, typeof raw === 'string' ? raw : [...raw]])))).toBe(resourceHash);
  expect(source.definitionJson).toBe(JSON.stringify(exactDefinition()));
}, 30000);

it('nearest-neighbor preserves literal selected RGBA and reports unsampled details and block boundaries as lossy', () => {
  const image = new LegacyImage(1024, 1024);
  image.set(0, 0, 0x12345601); image.set(7, 0, 0xffffffff); image.set(8, 0, 0xaabbcc80);
  image.set(9, 0, 0xabcdef00); image.set(16, 0, 0x33445500);
  const reduced = reduceLegacyImage(image);
  expect(reduced.route).toBe('gerastert verlustbehaftet'); expect(reduced.nonUniform8Blocks).toBe(3);
  expect(reduced.pixels).toEqual([[0, 0x12345601], [1, 0xaabbcc80], [2, 0x33445500]]);
  expect(image.get(7, 0)).toBe(0xffffffff);
});

it('the converter labels a single unsampled pixel lossy and leaves its nearest-neighbor result empty', async () => {
  const d = exactDefinition(); d.frames[0]!.layers![0]!.pixels = [{ x: 7, y: 7, rgba: 0x12345680 }];
  const archive = await createLegacyOriginalArchive(input(d), resources, inventory);
  const result = await convertLegacyArchive(archive, resources, inventory);
  expect(result.report.route).toBe('gerastert verlustbehaftet'); expect(result.report.frames[0]!.nonUniform8Blocks).toBe(1);
  expect(result.document.frames[0]!.layers[0]!.pixels).toEqual([]);
});

it('homogeneous transparent RGB blocks are exact and never dropped or alpha-quantized by reduction', () => {
  const image = new LegacyImage(1024, 1024);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) image.set(x, y, 0xabcdef00);
  const reduced = reduceLegacyImage(image);
  expect(reduced.route).toBe('gerastert exakt'); expect(reduced.pixels).toEqual([[0, 0xabcdef00]]);
  const layer = { id: 'p', name: 'P', locked: false, visible: true, pixels: new Map(reduced.pixels) };
  expect(Buffer.from(production([layer])).equals(Buffer.from(image.toBytes()))).toBe(true);
});

it.each(fixtures.assessments)('rejects blocklisted $id without producing a target', async (c) => {
  const archive = await createLegacyOriginalArchive(input(c.definition), resources, inventory);
  await expect(convertLegacyArchive(archive, resources, inventory)).rejects.toMatchObject({ route: 'blockiert', code: 'audit-blocked' });
});

it.each([undefined, ['addons', 'addons_normalized']])('rejects missing/ambiguous addonRoot %j', async (addonRoot) => {
  const archive = await createLegacyOriginalArchive({ ...input(fixture('layers-faces-and-addons')), ...(addonRoot ? { context: { addonRoot } } : {}) }, resources, inventory);
  await expect(convertLegacyArchive(archive, resources, inventory)).rejects.toBeInstanceOf(LegacyConversionBlockedError);
});

it('rejects missing/changed resources and unbound or altered archive data', async () => {
  const archive = await createLegacyOriginalArchive(input(exactDefinition()), resources, inventory);
  const missing = new Map(resources); missing.delete(inventory.poses[0]!.faceBase);
  await expect(convertLegacyArchive(archive, missing, inventory)).rejects.toMatchObject({ code: 'audit-blocked' });
  const changed = new Map(resources); changed.set(inventory.poses[0]!.faceBase, new Uint8Array([0]));
  await expect(convertLegacyArchive(archive, changed, inventory)).rejects.toMatchObject({ code: 'audit-blocked' });
  const corrupt = structuredClone(archive); corrupt.original.definition!.json = '{}';
  await expect(convertLegacyArchive(corrupt, resources, inventory)).rejects.toMatchObject({ code: 'archive-integrity' });
  const incomplete = structuredClone(archive); incomplete.assessment.complete = false;
  await expect(convertLegacyArchive(incomplete, resources, inventory)).rejects.toMatchObject({ code: 'audit-blocked' });
  const alteredInventory = structuredClone(inventory); alteredInventory.inventoryVersion++;
  await expect(convertLegacyArchive(archive, resources, alteredInventory)).rejects.toMatchObject({ code: 'archive-integrity' });
});

it('embedded resources support offline conversion, but corrupt payloads and conflicting supplied resources block', async () => {
  const archive = await createLegacyOriginalArchive(input(exactDefinition()), resources, inventory, true);
  const converted = await convertLegacyArchive(archive, new Map(), inventory);
  expect(converted.report.route).toBe('gerastert exakt');
  const corrupt = structuredClone(archive);
  const entry = corrupt.resources.find((r) => r.path.endsWith('.png'))!;
  (entry.original as { bytes: number[] }).bytes[0] = 0;
  await expect(convertLegacyArchive(corrupt, new Map(), inventory)).rejects.toMatchObject({ code: 'resource-integrity' });
  const outOfRange = structuredClone(archive);
  const payload = outOfRange.resources.find((r) => r.path === entry.path)!.original as { bytes: number[] };
  payload.bytes[0] = payload.bytes[0]! + 256;
  await expect(convertLegacyArchive(outOfRange, new Map(), inventory)).rejects.toMatchObject({ code: 'resource-integrity' });
  const conflicting = new Map(resources); conflicting.set(entry.path, new Uint8Array([0]));
  await expect(convertLegacyArchive(archive, conflicting, inventory)).rejects.toMatchObject({ code: 'resource-integrity' });
});

it.each(['warning', 'error', 'drift', 'resource'])('even a previously approved archive rejects a later renderer %s', async (mode) => {
  const archive = await createLegacyOriginalArchive(input(exactDefinition()), resources, inventory);
  const original = legacy.renderLegacy;
  let calls = 0;
  vi.spyOn(legacy, 'renderLegacy').mockImplementation(async (...args) => {
    const image = await original(...args);
    if (++calls === 1) return image; // re-audit succeeds; only conversion rendering changes.
    if (mode === 'warning') args[5]?.('Late renderer warning');
    if (mode === 'error') throw Error('Late renderer failure');
    if (mode === 'drift') image.set(0, 0, 0xffffffff);
    if (mode === 'resource') await args[2]('unreviewed.png');
    return image;
  });
  await expect(convertLegacyArchive(archive, resources, inventory)).rejects.toMatchObject({ code: mode === 'warning' ? 'renderer-warning' : mode === 'error' ? 'renderer-error' : mode === 'resource' ? 'resource-missing' : 'render-drift' });
});

it('mixed exact/lossy frames retain order and durations and classify the overall result lossy', async () => {
  const d = exactDefinition();
  d.frames.push({ durationMs: 71, ops: [], layers: [{ id: 'p', name: 'Detail', kind: 'pixels', pixels: [{ x: 1, y: 1, rgba: 0x11223301 }] }] });
  const archive = await createLegacyOriginalArchive(input(d), resources, inventory);
  const result = await convertLegacyArchive(archive, resources, inventory);
  expect(result.report.frames.map((f) => [f.index, f.durationMs, f.route])).toEqual([
    [0, 37, 'gerastert exakt'], [1, 71, 'gerastert verlustbehaftet'],
  ]);
  expect(result.report.route).toBe('gerastert verlustbehaftet');
});

it('snapshots archive, inventory and caller resource buffers before the first asynchronous phase', async () => {
  const captured = structuredClone(await createLegacyOriginalArchive(input(exactDefinition()), resources, inventory));
  const supplied = new Map([...resources].map(([path, value]) => [path, typeof value === 'string' ? value : new Uint8Array(value)] as const));
  const inv = structuredClone(inventory);
  const converting = convertLegacyArchive(captured, supplied, inv);
  captured.original.definition!.json = '{}'; inv.inventoryVersion++;
  (supplied.get(inventory.poses[0]!.faceBase) as Uint8Array).fill(0);
  expect((await converting).report.route).toBe('gerastert exakt');
});

it('library originals remain archived with an explicit deferred disposition, never silently empty migrated collections', async () => {
  const source = { ...input(exactDefinition()), libraryJson: JSON.stringify(fixtures.templateLibrary) };
  const archive = await createLegacyOriginalArchive(source, resources, inventory);
  const before = canonicalJson(archive);
  const result = await convertLegacyArchive(archive, resources, inventory);
  expect(result.report.scope).toBe('rendered-animation');
  expect(result.report.library).toEqual({ disposition: 'archived-only', templateCount: 2 });
  expect(result.report.source.librarySha256).toBe(archive.original.library!.sha256);
  expect(result.document.templates).toEqual([]); expect(result.document.faces).toEqual([]);
  expect(canonicalJson(archive)).toBe(before); expect(archive.original.library!.json).toBe(source.libraryJson);
});

it('a forged approval for an unknown operation is rejected by re-audit even if archive hashes are recomputed', async () => {
  const d = exactDefinition(); d.frames[0]!.ops = [{ type: 'future' }];
  const bad: OriginalArchive = structuredClone(await createLegacyOriginalArchive(input(d), resources, inventory));
  const good = await createLegacyOriginalArchive(input(exactDefinition()), resources, inventory);
  bad.assessment = structuredClone(good.assessment); bad.resources = structuredClone(good.resources);
  bad.archiveId = await sha256(canonicalJson({ archiveVersion: 1, original: bad.original, assessment: bad.assessment }));
  await expect(convertLegacyArchive(bad, resources, inventory)).rejects.toMatchObject({ code: 'audit-blocked' });
});
