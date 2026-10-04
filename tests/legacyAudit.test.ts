import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import inventory from '../src/animation/migration/legacy-inventory.json';
import fixtures from './fixtures/legacy-migration-cases.json';
import multiframe from './fixtures/legacy-multiframe.json';
import * as legacy from '../src/animation/legacy';
import { canonicalJson, sha256 } from '../src/animation/contentHash';
import { createLegacyOriginalArchive, inspectLegacy, inspectLocalLegacyDefinitions } from '../src/animation/migration/legacyAudit';
import type { LegacyInput, ResourceSet } from '../src/animation/migration/legacyAudit';

const resources: ResourceSet = new Map<string, string | Uint8Array>([
  ...inventory.assets.map((asset) => [asset.path, new Uint8Array(readFileSync(asset.path))] as const),
  [inventory.presets.path, readFileSync(inventory.presets.path, 'utf8')] as const,
]);
const fixture = (id: string) => fixtures.cases.find((c) => c.id === id)!.definition;
const input = (definition: unknown = fixture('empty-layers-null-addons-v1')): LegacyInput => ({
  definitionJson: JSON.stringify(definition), source: { kind: 'file', name: 'original.finoanim.json' },
});
const codes = (report: Awaited<ReturnType<typeof inspectLegacy>>) => report.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.code);
afterEach(() => vi.restoreAllMocks());

describe('isolated Legacy migration assessment', () => {
  it('assesses synthetic frames against the inventory without conversion', async () => {
    const report = await inspectLegacy(input(multiframe), resources, inventory);
    expect(report.complete).toBe(true);
    expect(report.migrationPerformed).toBe(false);
    expect(report.route).toBe('gerastert verlustbehaftet');
    expect(report.frames.map((f) => f.nonUniform8Blocks)).toEqual([1, 1]);
    expect(report.references.every((reference) => reference.status === 'verified')).toBe(true);
    expect(report.components.some((component) => component.category === 1 && component.route === 'editierbar')).toBe(true);
  });

  it.each([1, 2])('resolves rig version %i independently of format version', async (version) => {
    const definition = { ...fixture('empty-layers-null-addons-v1'), version: 1, faceRigVersion: version };
    const report = await inspectLegacy(input(definition), resources, inventory);
    expect(report.complete).toBe(true);
    expect(report.resolved.rigVersion).toBe(version);
    expect(report.references.some((r) => r.path.includes(version === 2 ? 'basis_face_base/' : '/basis/'))).toBe(true);
  });

  it('accepts all reviewed operation/mask/strategy fixtures and their render baselines', async () => {
    for (const case_ of fixtures.cases) {
      const report = await inspectLegacy({ ...input(case_.definition), context: { addonRoot: case_.renderContexts[0]!.addonRoot } }, resources, inventory);
      expect(report.complete, case_.id).toBe(true);
      expect(report.frames[0]?.rgbaSha256, case_.id).toBe(case_.renderContexts[0]!.expectedRgbaSha256);
    }
  }, 30000);

  it('keeps frame indices on malformed input and rejects invalid known values', async () => {
    const d = { ...fixture('empty-layers-null-addons-v1'), frames: [null, { durationMs: 2.5, ops: [], layers: [{ id: 'p', name: 'P', kind: 'pixels', visible: 'yes', pixels: [{ x: 1024, y: 0, rgba: -1 }] }] }] };
    const report = await inspectLegacy(input(d), resources, inventory);
    expect(report.complete).toBe(false);
    expect(report.resolved.frames.map((frame) => frame.index)).toEqual([0, 1]);
    expect(report.issues.some((issue) => issue.path === '$.frames[1].durationMs')).toBe(true);
    expect(codes(report)).toContain('invalid-data');
  });

  it('resolves omitted rig, layer, visibility, lock, offsets and operation defaults', async () => {
    const defaults = await inspectLegacy(input(fixture('missing-rig-version-and-reaction')), resources, inventory);
    expect(defaults.complete).toBe(true);
    expect(defaults.resolved.rigVersion).toBe(1);
    expect(defaults.resolved.addonContext).toBe('unused');
    expect(defaults.resolved.addonRoot).toBeNull();
    expect(defaults.resolved.frames[0]).toMatchObject({ implicitLayers: true, layers: inventory.states.layerKinds.filter((k) => k !== 'pixels').map((kind) => ({ kind, visible: true, locked: false })) });
    const ops = await inspectLegacy(input(fixture('operation-defaults')), resources, inventory);
    expect(ops.complete).toBe(true);
    expect(ops.resolved.frames[0]).toMatchObject({ ops: [{ dx: 0, dy: 0, vacatedArea: 'transparent' }, { dx: 0, dy: 0, vacatedArea: 'transparent' }, { sx: 0, sy: 0, scope: 'bounds' }] });
    const addon = await inspectLegacy({ ...input(fixture('layers-faces-and-addons')), context: { addonRoot: 'addons_cleaned' } }, resources, inventory);
    expect(addon.complete).toBe(true);
    expect(addon.resolved.frames[0]).toMatchObject({ eyes: { state: 'half', dx: 0, dy: 0 }, face: { leftEye: { visible: true }, rightEye: { visible: false } } });
  });

  it.each(fixtures.assessments)('blocks $id instead of treating parser acceptance as migration success', async (case_) => {
    const report = await inspectLegacy(input(case_.definition), resources, inventory);
    expect(report.complete).toBe(false);
    expect(report.route).toBe('blockiert');
    expect(codes(report).length).toBeGreaterThan(0);
    expect(report.frames.every((frame) => frame.route === 'blockiert')).toBe(true);
  });

  it('reports unknown fields recursively, including pixel, addon, face and library records', async () => {
    const d = fixture('layers-faces-and-addons');
    const f = d.frames[0];
    const modified = { ...d, futureRoot: true, frames: [{ ...f, futureFrame: true, eyes: { state: 'open', futureAddon: true }, face: { leftEye: { state: 'open', x: 1, y: 2, width: 4, height: 4, futureFace: true } }, layers: [{ id: 'pixels', name: 'Pixels', kind: 'pixels', pixels: [{ x: 0, y: 0, rgba: 0xffffffff, futurePixel: true }] }] }] };
    const report = await inspectLegacy({ ...input(modified), context: { addonRoot: 'addons' }, libraryJson: JSON.stringify({ ...fixtures.templateLibrary, futureLibrary: true }) }, resources, inventory);
    const unknown = report.issues.filter((issue) => issue.code === 'unknown-field').map((issue) => issue.path);
    for (const suffix of ['futureRoot', 'futureFrame', 'futureAddon', 'futureFace', 'futurePixel', 'futureLibrary']) expect(unknown.some((path) => path.endsWith(suffix))).toBe(true);
    expect(report.complete).toBe(false);
  });

  it.each(['unknown-strategy', 'unknown-scope', 'unknown-layer', 'unknown-mask', 'unknown-rig'])('blocks %s', async (kind) => {
    const d = { version: 2, faceRigVersion: kind === 'unknown-rig' ? 3 : 2, id: 'test', name: 'Test', basePose: 'fino_standing_neutral.png', frames: [{ durationMs: 1, layers: [{ id: 'x', name: 'X', kind: kind === 'unknown-layer' ? 'future' : 'pixels', pixels: [] }], ops: [{ type: kind === 'unknown-scope' ? 'stretchSelection' : 'moveSelection', mask: { type: kind === 'unknown-mask' ? 'future' : 'rect', x: 0, y: 0, width: 16, height: 16 }, ...(kind === 'unknown-scope' ? { scope: 'future' } : kind === 'unknown-strategy' ? { vacatedArea: { strategy: 'future' } } : {}) }] }] };
    expect(codes(await inspectLegacy(input(d), resources, inventory))).toContain(kind);
  });

  it('recognizes missing and changed resources, including the preset reference', async () => {
    const missing = new Map(resources); missing.delete(inventory.poses[0]!.base);
    expect(codes(await inspectLegacy(input(), missing, inventory))).toContain('resource-missing');
    const changed = new Map(resources); changed.set(inventory.presets.path, '{}');
    expect(codes(await inspectLegacy(input(), changed, inventory))).toContain('resource-changed');
  });

  it('blocks unknown asset states even in invisible face elements', async () => {
    const d = { ...fixture('empty-layers-null-addons-v1'), frames: [{ durationMs: 1, ops: [], face: { leftEye: { state: 'future', x: 0, y: 0, width: 1, height: 1, visible: false } } }] };
    expect(codes(await inspectLegacy(input(d), resources, inventory))).toContain('missing-face-asset');
  });

  it('retains all possible addon dependencies when the original family is unknown', async () => {
    const report = await inspectLegacy(input(fixture('layers-faces-and-addons')), resources, inventory);
    expect(report.resolved.addonCandidates).toEqual(['addons', 'addons_cleaned', 'addons_normalized']);
    for (const root of report.resolved.addonCandidates) expect(report.references.some((ref) => ref.path.includes(`/${root}/eyes/`))).toBe(true);
    expect(report.complete).toBe(false);
  });

  it.each([undefined, ['addons', 'addons_normalized'], 'future'])('blocks unresolved or invalid addon context %j', async (addonRoot) => {
    const report = await inspectLegacy({ ...input(fixture('layers-faces-and-addons')), context: { addonRoot } }, resources, inventory);
    expect(report.complete).toBe(false);
    expect(codes(report)).toContain(addonRoot === 'future' ? 'unknown-addon-root' : 'ambiguous-addon-root');
  });

  it('assesses all three explicit addon families with distinct verified dependencies', async () => {
    for (const addonRoot of inventory.contexts[0]!.values!) {
      const report = await inspectLegacy({ ...input(fixture('layers-faces-and-addons')), context: { addonRoot } }, resources, inventory);
      expect(report.complete).toBe(true);
      expect(report.references.some((ref) => ref.path.includes(`/${addonRoot}/eyes/`))).toBe(true);
      expect(report.resolved.addonContext).toBe('explicit');
    }
  });

  it('treats every renderer warning and render failure as blocking', async () => {
    const original = legacy.renderLegacy;
    vi.spyOn(legacy, 'renderLegacy').mockImplementation(async (...args) => {
      args[5]?.('Synthetic warning from existing renderer');
      return original(...args);
    });
    expect(codes(await inspectLegacy(input(), resources, inventory))).toContain('renderer-warning');
    vi.spyOn(legacy, 'renderLegacy').mockRejectedValue(new Error('Synthetic failure'));
    expect(codes(await inspectLegacy(input(), resources, inventory))).toContain('render-failed');
  });

  it('distinguishes a byte-exact baked result from editability without generating a target', async () => {
    const pixels = Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), rgba: 0x123456ff }));
    const d = { ...fixture('empty-layers-null-addons-v1'), frames: [{ durationMs: 7, ops: [], layers: [{ id: 'pixels', name: 'Pixels', kind: 'pixels', pixels }] }] };
    const report = await inspectLegacy(input(d), resources, inventory);
    expect(report.complete).toBe(true);
    expect(report.route).toBe('gerastert exakt');
    expect(report.frames[0]?.nonUniform8Blocks).toBe(0);
    expect(report.components.find((c) => c.kind === 'layer')?.route).toBe('editierbar');
    expect(report).not.toHaveProperty('rasterDocument');
  });

  it('assesses standalone and attached libraries and validates their pixel bounds', async () => {
    const libraryJson = JSON.stringify(fixtures.templateLibrary);
    const standalone = await inspectLegacy({ libraryJson, source: { kind: 'file', name: 'fino_templates.json' } }, new Map(), inventory);
    expect(standalone.complete).toBe(true);
    expect(standalone.references).toEqual([]);
    expect(standalone.components.filter((c) => c.kind === 'template')).toHaveLength(2);
    expect((await inspectLegacy({ ...input(), libraryJson }, resources, inventory)).complete).toBe(true);
    const invalid = { version: 1, templates: [{ id: 't', name: 'T', width: 1, height: 1, originX: 0, originY: 0, pixels: [{ x: 1, y: 0, rgba: -1 }] }] };
    expect(codes(await inspectLegacy({ ...input(), libraryJson: JSON.stringify(invalid) }, resources, inventory))).toContain('invalid-data');
  });

  it('discovers local definitions without accessing or changing IndexedDB', async () => {
    const entries = new Map([['z.finoanim.json', input().definitionJson!], ['a.finoanim.json', input().definitionJson!], ['Raster session', '{}'], [inventory.persistence.libraryKey, JSON.stringify(fixtures.templateLibrary)]]);
    const before = [...entries];
    const reports = await inspectLocalLegacyDefinitions(entries, resources, inventory);
    expect(reports.map((report) => report.source)).toEqual([{ kind: 'local', name: 'a.finoanim.json' }, { kind: 'local', name: 'z.finoanim.json' }]);
    expect(reports.every((report) => report.complete && report.components.some((c) => c.kind === 'template'))).toBe(true);
    expect([...entries]).toEqual(before);
  });

  it('returns identical reports repeatedly and does not mutate any input', async () => {
    const supplied = { ...input(), context: { addonRoot: ['addons'] }, libraryJson: JSON.stringify(fixtures.templateLibrary) };
    const before = structuredClone(supplied), beforeInventory = canonicalJson(inventory);
    const hashes = new Map([...resources].map(([path, raw]) => [path, createHash('sha256').update(raw).digest('hex')]));
    const first = await inspectLegacy(supplied, resources, inventory);
    expect(await inspectLegacy(supplied, resources, inventory)).toEqual(first);
    expect(supplied).toEqual(before);
    expect(canonicalJson(inventory)).toBe(beforeInventory);
    for (const [path, raw] of resources) expect(createHash('sha256').update(raw).digest('hex')).toBe(hashes.get(path));
  });
});

describe('unchanged in-memory original archive', () => {
  it('preserves original whitespace, library, source, context and JSON resource bytes', async () => {
    const original = { ...input(), definitionJson: `\r\n  ${input().definitionJson!}\r\n`, libraryJson: JSON.stringify(fixtures.templateLibrary, null, 4), context: { addonRoot: ['addons', 'addons_normalized'] } };
    const archive = await createLegacyOriginalArchive(original, resources, inventory);
    expect(archive.original.definition?.json).toBe(original.definitionJson);
    expect(archive.original.library?.json).toBe(original.libraryJson);
    expect(archive.original.source).toEqual(original.source);
    expect(archive.original.suppliedContext).toEqual(original.context);
    const rig = archive.resources.find((ref) => ref.path.endsWith('/rig.json'))!;
    expect(rig.original).toEqual({ bytes: [...resources.get(rig.path) as Uint8Array] });
    expect(archive.resources.find((ref) => ref.path === inventory.presets.path)?.original).toEqual({ text: resources.get(inventory.presets.path) });
    expect(Object.isFrozen(archive)).toBe(true);
    expect(Object.isFrozen(archive.assessment.issues)).toBe(true);
    expect(archive).not.toHaveProperty('rasterDocument');
  });

  it('has deterministic SHA-256 identities and changes identity when originals/context change', async () => {
    const a = await createLegacyOriginalArchive(input(), resources, inventory);
    expect(await createLegacyOriginalArchive(input(), resources, inventory)).toEqual(a);
    expect(a.original.definition?.sha256).toBe(createHash('sha256').update(input().definitionJson!).digest('hex'));
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect((await createLegacyOriginalArchive({ ...input(), definitionJson: `${input().definitionJson!}\n` }, resources, inventory)).archiveId).not.toBe(a.archiveId);
    expect((await createLegacyOriginalArchive({ ...input(), context: { addonRoot: 'addons' } }, resources, inventory)).archiveId).not.toBe(a.archiveId);
  });

  it('can embed unchanged binary assets without changing archive identity', async () => {
    const thin = await createLegacyOriginalArchive(input(), resources, inventory);
    const embedded = await createLegacyOriginalArchive(input(), resources, inventory, true);
    expect(embedded.archiveId).toBe(thin.archiveId);
    for (const ref of embedded.resources) {
      const original = ref.original!;
      expect(await sha256('text' in original ? original.text : new Uint8Array(original.bytes))).toBe(ref.actualSha256);
    }
  });

  it('preserves malformed JSON and blocked findings instead of claiming success', async () => {
    const supplied = { ...input(), definitionJson: '{broken', libraryJson: '[broken' };
    const archive = await createLegacyOriginalArchive(supplied, resources, inventory);
    expect(archive.original.definition?.json).toBe(supplied.definitionJson);
    expect(archive.original.library?.json).toBe(supplied.libraryJson);
    expect(archive.assessment.complete).toBe(false);
    expect(archive.assessment.route).toBe('blockiert');
  });
});
