import { legacyDecode, renderLegacy } from '../legacy';
import type { Definition, LegacyImage, Rig } from '../legacy';
import { parseDocumentMetadata } from '../document';
import { parseRasterDocument } from '../files';
import type { RasterSessionV2 } from '../files';
import { production, render } from '../raster';
import { canonicalJson, sha256 } from '../contentHash';
import { inspectLegacy } from './legacyAudit';
import type { LegacyAudit, LegacyInput, LegacyInventory, OriginalArchive, ResourceSet } from './legacyAudit';

export type RasterizedRoute = 'gerastert exakt' | 'gerastert verlustbehaftet';
export type ConvertedFrameReport = {
  index: number;
  durationMs: number;
  route: RasterizedRoute;
  nonUniform8Blocks: number;
  legacyRgbaSha256: string;
  rasterRgbaSha256: string;
  exportRgbaSha256: string;
  operations?: { disposition: 'baked-not-replayable'; types: string[]; reason: string };
};
export type ConversionReport = {
  conversionVersion: 1;
  scope: 'rendered-animation';
  route: RasterizedRoute;
  algorithm: { name: 'nearest-neighbor'; factor: 8; offsetX: 0; offsetY: 0; rgba: 'literal' };
  source: {
    archiveId: string;
    definitionSha256: string;
    librarySha256: string | null;
    inventorySha256: string;
    origin: LegacyInput['source'];
    definitionId: string;
    reactionStatePresent: boolean;
    reactionState: string | null;
    context: Pick<LegacyAudit['resolved'], 'rigVersion' | 'addonRoot' | 'addonCandidates' | 'addonContext'>;
    resources: LegacyAudit['references'];
  };
  frames: ConvertedFrameReport[];
  library: { disposition: 'archived-only' | 'absent'; templateCount: number };
  structure: { layers: 'flattened'; operations: 'baked'; faceRig: 'baked'; originals: 'retained-in-archive' };
  conversionSha256: string;
};
export type LegacyConversion = {
  document: RasterSessionV2;
  json: string;
  report: ConversionReport;
  previews: { index: number; legacyRgba: Uint8Array; rasterRgba: Uint8Array }[];
};
export class LegacyConversionBlockedError extends Error {
  readonly route = 'blockiert';
  constructor(readonly code: string, message: string, readonly audit?: LegacyAudit) {
    super(message); this.name = 'LegacyConversionBlockedError';
  }
}
function block(code: string, message: string, audit?: LegacyAudit): never {
  throw new LegacyConversionBlockedError(code, message, audit);
}
const asBytes = (value: string | Uint8Array) => typeof value === 'string' ? new TextEncoder().encode(value) : value;
const asText = (value: string | Uint8Array) => typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
const approved = (audit: LegacyAudit) => audit.complete && audit.route !== 'blockiert' &&
  !audit.issues.some((issue) => issue.severity === 'blocking') && audit.references.every((ref) => ref.status === 'verified') &&
  audit.frames.length > 0 && audit.frames.every((frame) => frame.route !== 'blockiert' && frame.rgbaSha256 !== null);

/** Literal RGBA reduction. Top-left phase agrees with the Legacy integer NN convention. */
export function reduceLegacyImage(image: LegacyImage) {
  if (image.width !== 1024 || image.height !== 1024 || image.pixels.length !== 1024 * 1024)
    block('render-size', 'Legacy-Ergebnis muss 1024×1024 Pixel besitzen.');
  const pixels: [number, number][] = [];
  let nonUniform8Blocks = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const value = image.get(x * 8, y * 8);
    // Keep transparent RGB too; only literal zero can be omitted without information loss.
    if (value !== 0) pixels.push([y * 128 + x, value]);
    let different = false;
    for (let yy = y * 8; yy < y * 8 + 8 && !different; yy++) for (let xx = x * 8; xx < x * 8 + 8; xx++) {
      if (image.get(xx, yy) !== value) { different = true; break; }
    }
    if (different) nonUniform8Blocks++;
  }
  const route: RasterizedRoute = nonUniform8Blocks ? 'gerastert verlustbehaftet' : 'gerastert exakt';
  return { pixels, route, nonUniform8Blocks };
}

/** No store, storage, fetch, renderer caches or mutation of input/archive resources. */
export async function convertLegacyArchive(archive: OriginalArchive, resources: ResourceSet, inventory: LegacyInventory): Promise<LegacyConversion> {
  try {
    // Bind every subsequent async phase to one snapshot, including caller-owned PNG buffers.
    const captured = structuredClone(archive), known = structuredClone(inventory);
    const files = new Map([...resources].map(([path, value]) => [path, typeof value === 'string' ? value : new Uint8Array(value)] as const));
    return await convertSnapshot(captured, files, known);
  } catch (error) {
    if (error instanceof LegacyConversionBlockedError) throw error;
    block('conversion-error', error instanceof Error ? error.message : 'Konvertierung fehlgeschlagen.');
  }
}
async function convertSnapshot(captured: OriginalArchive, files: Map<string, string | Uint8Array>, known: LegacyInventory): Promise<LegacyConversion> {
  if (captured.archiveVersion !== 1 || !approved(captured.assessment))
    block('audit-blocked', 'Nur vollständig freigegebene Definitionsarchive dürfen konvertiert werden.', captured.assessment);
  const original = captured.original;
  if (!original.definition) block('definition-missing', 'Archiv enthält keine Animationsdefinition.');
  if (await sha256(original.definition.json) !== original.definition.sha256 ||
    (original.library && await sha256(original.library.json) !== original.library.sha256) ||
    await sha256(canonicalJson(known)) !== captured.assessment.inventorySha256 ||
    await sha256(canonicalJson({ archiveVersion: 1, original, assessment: captured.assessment })) !== captured.archiveId)
    block('archive-integrity', 'Original, Inventar oder Archivbericht stimmt nicht mit seiner Prüfsumme überein.');
  if (canonicalJson(captured.resources.map(({ original, ...ref }) => {
    if (original === undefined) block('archive-resources', 'Archivressourcen besitzen keine Payload-Deklaration.');
    return ref;
  })) !== canonicalJson(captured.assessment.references))
    block('archive-resources', 'Archivressourcen stimmen nicht mit der Freigabe überein.');
  for (const resource of captured.resources) {
    const embedded = resource.original;
    if (embedded) {
      if (Object.keys(embedded).length !== 1 ||
        ('text' in embedded ? typeof embedded.text !== 'string' :
          !Array.isArray(embedded.bytes) || embedded.bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)))
        block('resource-integrity', `Ungültige Original-Payload: ${resource.path}`);
      const value = 'text' in embedded ? embedded.text : new Uint8Array(embedded.bytes);
      // Do not silently prefer one of two contradictory sources.
      if (await sha256(value) !== resource.actualSha256 ||
        (files.has(resource.path) && await sha256(files.get(resource.path)!) !== resource.actualSha256))
        block('resource-integrity', `Ressource weicht vom Archiv ab: ${resource.path}`);
      files.set(resource.path, value);
    }
  }
  const input: LegacyInput = {
    definitionJson: original.definition.json,
    source: original.source,
    ...(original.library ? { libraryJson: original.library.json } : {}),
    ...(original.suppliedContext ? { context: original.suppliedContext } : {}),
  };
  const audit = await inspectLegacy(input, files, known);
  if (!approved(audit)) block('audit-blocked', 'Erneute Prüfung blockiert die Konvertierung.', audit);
  if (canonicalJson(audit) !== canonicalJson(captured.assessment))
    block('audit-drift', 'Die aktuelle Prüfung weicht vom archivierten Ergebnis ab.', audit);
  const definition = JSON.parse(original.definition.json) as Definition;
  const rigEntry = known.rigs.find((rig) => rig.version === audit.resolved.rigVersion);
  if (!rigEntry || (audit.resolved.addonContext !== 'unused' && !audit.resolved.addonRoot))
    block('context', 'Rig oder Addon-Darstellungskontext ist nicht eindeutig.');
  const rig = JSON.parse(asText(files.get(rigEntry.manifestPath)!)) as Rig;
  const verified = new Set(audit.references.map((ref) => ref.path));
  const decoded = new Map<string, LegacyImage>();
  const loader = (path: string) => {
    const full = `public/animation/legacy/${path}`, data = files.get(full);
    if (!verified.has(full) || data === undefined) block('resource-missing', `Nicht freigegebene Renderressource: ${full}`);
    if (!decoded.has(full)) decoded.set(full, legacyDecode(asBytes(data)));
    return Promise.resolve(decoded.get(full)!);
  };
  const frames: RasterSessionV2['frames'] = [], reports: ConvertedFrameReport[] = [], previews: LegacyConversion['previews'] = [];
  for (let index = 0; index < definition.frames.length; index++) {
    let image: LegacyImage;
    try {
      const warnings: string[] = [];
      // Original, not normalized layers: implicit layer semantics preserve transparent RGB.
      image = await renderLegacy(definition, index, loader, rig, audit.resolved.addonRoot ?? known.defaults.addonRoot, (warning) => warnings.push(warning));
      if (warnings.length) block('renderer-warning', warnings.join('\n'));
    } catch (error) {
      if (error instanceof LegacyConversionBlockedError) throw error;
      block('renderer-error', error instanceof Error ? error.message : 'Legacy-Rendering fehlgeschlagen.');
    }
    const legacyRgba = image.toBytes(), legacyRgbaSha256 = await sha256(legacyRgba);
    const reduced = reduceLegacyImage(image), checked = audit.frames[index];
    if (!checked || checked.index !== index || checked.rgbaSha256 !== legacyRgbaSha256 ||
      checked.nonUniform8Blocks !== reduced.nonUniform8Blocks || checked.route !== reduced.route)
      block('render-drift', `Frame ${index} stimmt nicht mit dem geprüften Render-Ergebnis überein.`);
    const layer = { id: `legacy-baked-${index}`, name: 'Gerastertes Legacy-Ergebnis', visible: true, locked: false, pixels: reduced.pixels };
    const nativeLayer = { ...layer, pixels: new Map(layer.pixels) };
    const rasterRgba = render([nativeLayer]), exported = production([nativeLayer]);
    const exportRgbaSha256 = await sha256(exported);
    if (reduced.route === 'gerastert exakt' && exportRgbaSha256 !== legacyRgbaSha256)
      block('roundtrip-mismatch', 'Exakter Frame ist im nativen Rückexport nicht bytegleich.');
    const durationMs = definition.frames[index]!.durationMs;
    frames.push({ duration: durationMs, layers: [layer] });
    reports.push({ index, durationMs, route: reduced.route, nonUniform8Blocks: reduced.nonUniform8Blocks,
      legacyRgbaSha256, rasterRgbaSha256: await sha256(rasterRgba), exportRgbaSha256,
      ...(definition.frames[index]!.ops.length ? { operations: { disposition: 'baked-not-replayable' as const,
        types: definition.frames[index]!.ops.map((op) => op.type), reason: 'Legacy-Ergebnis gebacken; keine verifizierte native Ausgangsbasis mit vollständigen Replay-Zwischenschritten.' } } : {}) });
    previews.push({ index, legacyRgba, rasterRgba });
  }
  const templateCount = original.library ? (JSON.parse(original.library.json) as { templates: unknown[] }).templates.length : 0;
  const payload: Omit<ConversionReport, 'conversionSha256'> = {
    conversionVersion: 1, scope: 'rendered-animation',
    route: reports.some((frame) => frame.route === 'gerastert verlustbehaftet') ? 'gerastert verlustbehaftet' : 'gerastert exakt',
    algorithm: { name: 'nearest-neighbor', factor: 8, offsetX: 0, offsetY: 0, rgba: 'literal' },
    source: { archiveId: captured.archiveId, definitionSha256: original.definition.sha256, librarySha256: original.library?.sha256 ?? null,
      inventorySha256: audit.inventorySha256, origin: original.source, definitionId: definition.id,
      reactionStatePresent: Object.hasOwn(definition, 'reactionState'), reactionState: definition.reactionState ?? null,
      context: { rigVersion: audit.resolved.rigVersion, addonRoot: audit.resolved.addonRoot,
        addonCandidates: audit.resolved.addonCandidates, addonContext: audit.resolved.addonContext }, resources: audit.references },
    frames: reports, library: { disposition: original.library ? 'archived-only' : 'absent', templateCount },
    structure: { layers: 'flattened', operations: 'baked', faceRig: 'baked', originals: 'retained-in-archive' },
  };
  const report: ConversionReport = { ...payload, conversionSha256: await sha256(canonicalJson(payload)) };
  const document: RasterSessionV2 = {
    version: 2, name: definition.name, source: 'empty', frames, templates: [], faces: [], reference: null,
    metadata: parseDocumentMetadata({
      id: crypto.randomUUID(), ...(typeof definition.reactionState === 'string' ? { reactionState: definition.reactionState } : {}),
      provenance: { kind: 'legacy', sourceId: definition.basePose, sha256: original.definition.sha256, archiveId: captured.archiveId,
        ...(original.source.name ? original.source.kind === 'file' ? { fileName: original.source.name } : { storageKey: original.source.name } : {}) },
      legacy: { formatVersion: definition.version, rigVersion: audit.resolved.rigVersion, basePose: definition.basePose,
        ...(definition.id ? { definitionId: definition.id } : {}), ...(audit.resolved.addonRoot ? { addonRoot: audit.resolved.addonRoot } : {}) },
      migration: { reportVersion: 1, stage: 'conversion', archiveId: captured.archiveId,
        converter: { name: 'legacy-raster128-bake', version: '1' }, report },
    }),
  };
  const json = JSON.stringify(document);
  // The production document parser is the only acceptance authority for the target format.
  parseRasterDocument(json);
  return { document, json, report, previews };
}
