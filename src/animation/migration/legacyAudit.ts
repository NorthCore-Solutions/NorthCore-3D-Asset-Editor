import { canonicalJson, sha256 } from '../contentHash';
import type inventory from './legacy-inventory.json';
import { legacyDecode, renderLegacy } from '../legacy';
import type { Definition, Rig } from '../legacy';

export type LegacyInventory = typeof inventory;
export type Category = 1 | 2 | 3 | 4;
export type TransferRoute = 'editierbar' | 'gerastert exakt' | 'gerastert verlustbehaftet' | 'blockiert';
export type ResourceSet = ReadonlyMap<string, string | Uint8Array>;
export type LegacyInput = {
  definitionJson?: string;
  libraryJson?: string;
  source: { kind: 'file' | 'local'; name: string };
  context?: { addonRoot?: string | readonly string[] };
};
export type AuditIssue = { code: string; path: string; severity: 'blocking' | 'information'; message: string };
export type AuditComponent = { path: string; kind: string; category: Category; route: TransferRoute; action: string; requiresExtension: boolean };
export type AssetReference = { path: string; role: string; category: Category; expectedSha256: string | null; actualSha256: string | null; status: 'verified' | 'missing' | 'changed' | 'unknown' };
export type LegacyAudit = {
  auditVersion: 1;
  inventorySha256: string;
  source: LegacyInput['source'];
  complete: boolean;
  migrationPerformed: false;
  route: TransferRoute;
  issues: AuditIssue[];
  components: AuditComponent[];
  references: AssetReference[];
  resolved: { rigVersion: number | null; addonRoot: string | null; addonCandidates: string[]; addonContext: 'explicit' | 'unused' | 'unresolved'; frames: Record<string, unknown>[] };
  frames: { index: number; route: TransferRoute; nonUniform8Blocks: number | null; rgbaSha256: string | null }[];
};

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const utf8 = (value: string) => new TextEncoder().encode(value);
const text = (value: string | Uint8Array) => typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
const bytes = (value: string | Uint8Array) => typeof value === 'string' ? utf8(value) : new Uint8Array(value);

const snapshotResources = (resources: ResourceSet) => new Map([...resources].map(([path, value]) => [path, typeof value === 'string' ? value : new Uint8Array(value)] as const));

/** No storage, network, clock, IDs, renderer globals or editor-store access. */
export async function inspectLegacy(input: LegacyInput, resources: ResourceSet, known: LegacyInventory): Promise<LegacyAudit> {
  return inspectSnapshot(structuredClone(input), snapshotResources(resources), structuredClone(known));
}

async function inspectSnapshot(input: LegacyInput, resources: ResourceSet, known: LegacyInventory): Promise<LegacyAudit> {
  const issues: AuditIssue[] = [], components: AuditComponent[] = [];
  const references = new Map<string, AssetReference>();
  const result: LegacyAudit = {
    auditVersion: 1, inventorySha256: await sha256(canonicalJson(known)), source: { ...input.source },
    complete: false, migrationPerformed: false, route: 'blockiert', issues, components, references: [],
    resolved: { rigVersion: null, addonRoot: null, addonCandidates: [], addonContext: 'unresolved', frames: [] }, frames: [],
  };
  const issue = (code: string, path: string, message: string, severity: AuditIssue['severity'] = 'blocking') => { issues.push({ code, path, message, severity }); };
  const component = (path: string, kind: string, category: number, route: TransferRoute, action: string) => {
    components.push({ path, kind, category: category as Category, route, action, requiresExtension: category === 3 });
  };
  const invalid = (path: string, message = 'Invalid value for the inventoried Legacy format.') => { issue('invalid-data', path, message); };
  function scan(value: unknown, structure: keyof LegacyInventory['structures'], path: string, recordFields = true): RecordValue | null {
    if (!object(value)) { invalid(path, 'Expected object.'); return null; }
    const shape = known.structures[structure];
    for (const key of Object.keys(value).sort()) if (!shape.fields.some((field) => field.name === key)) {
      issue('unknown-field', `${path}.${key}`, 'Not present in the reviewed inventory; preserve original data.');
      component(`${path}.${key}`, 'unknown-field', 3, 'blockiert', 'resolve-unknown-data');
    }
    for (const field of shape.fields) {
      const v = value[field.name], at = `${path}.${field.name}`;
      if (v === undefined) { if (!field.optional) invalid(at, 'Required field missing.'); continue; }
      const type = field.sourceType;
      if (type === 'string' && typeof v !== 'string') invalid(at);
      if (type === 'number' && !integer(v)) invalid(at, 'Expected safe integer.');
      if (type === 'boolean' && typeof v !== 'boolean') invalid(at);
      if (type === 'string|null' && v !== null && typeof v !== 'string') invalid(at);
      if (recordFields) component(at, 'field', field.category, field.category === 4 ? 'gerastert verlustbehaftet' : 'editierbar', field.category === 3 ? 'preserve-metadata-with-native-extension' : 'preserve-or-assess-content');
    }
    return value;
  }
  function parse(raw: string, path: string): unknown {
    try { return JSON.parse(raw) as unknown; } catch { invalid(path, 'Invalid JSON; raw input remains archivable.'); return null; }
  }
  function additional(value: RecordValue, allowed: readonly string[], path: string) {
    for (const key of Object.keys(value).sort()) if (!allowed.includes(key)) {
      issue('unknown-field', `${path}.${key}`, 'Unknown or inapplicable field.');
      component(`${path}.${key}`, 'unknown-field', 3, 'blockiert', 'resolve-unknown-data');
    }
  }
  function pixelArray(raw: unknown, path: string, width: number, height: number): RecordValue[] {
    if (!Array.isArray(raw) || raw.length > 1024 * 1024) { invalid(path, 'Expected bounded pixel list.'); return []; }
    const pixels: RecordValue[] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = scan(raw[i], 'Pixel', `${path}[${i}]`, false);
      if (!p) continue;
      if (!integer(p.x) || !integer(p.y) || p.x < 0 || p.y < 0 || p.x >= width || p.y >= height || !integer(p.rgba) || p.rgba < 0 || p.rgba > 0xffffffff) invalid(`${path}[${i}]`, 'Invalid coordinate or unsigned RGBA.');
      pixels.push(p);
    }
    return pixels;
  }
  // A conservative editing proof, not conversion: all occupied tiles must be complete.
  function editablePixels(pixels: RecordValue[], width: number, height: number, x = 0, y = 0) {
    if (width % 8 || height % 8 || x % 8 || y % 8 || x < 0 || y < 0 || x + width > 1024 || y + height > 1024) return false;
    const tiles = new Map<string, { rgba: unknown; cells: Set<string> }>();
    for (const p of pixels) {
      if (!integer(p.x) || !integer(p.y) || !integer(p.rgba) || !(p.rgba & 255)) return false;
      const k = `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)}`, cell = `${p.x},${p.y}`;
      const tile = tiles.get(k) ?? { rgba: p.rgba, cells: new Set<string>() };
      if (tile.rgba !== p.rgba || tile.cells.has(cell)) return false;
      tile.cells.add(cell); tiles.set(k, tile);
    }
    return [...tiles.values()].every((tile) => tile.cells.size === 64);
  }
  function geometry(raw: unknown, path: string, rectangle = false): { width: number; height: number } | null {
    if (!object(raw)) { invalid(path, 'Missing mask or rectangle.'); return null; }
    if (rectangle || raw.type === 'rect') {
      additional(raw, rectangle ? known.structures.Rect.fields.map((f) => f.name) : known.unions.Mask.variants[0]!.fields, path);
      if (![raw.x, raw.y, raw.width, raw.height].every(integer) || !integer(raw.width) || !integer(raw.height) || raw.width < 1 || raw.height < 1) { invalid(path, 'Invalid rectangle.'); return null; }
      return { width: raw.width, height: raw.height };
    }
    if (raw.type === 'polygon') {
      additional(raw, known.unions.Mask.variants[1]!.fields, path);
      const points = raw.points;
      if (!Array.isArray(points) || points.length < 3 || points.length > 16384 || !points.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(integer))) { invalid(path, 'Invalid polygon points.'); return null; }
      const xy = points as [number, number][];
      return { width: Math.max(...xy.map((p) => p[0])) - Math.min(...xy.map((p) => p[0])) + 1, height: Math.max(...xy.map((p) => p[1])) - Math.min(...xy.map((p) => p[1])) + 1 };
    }
    issue('unknown-mask', path, 'Unknown mask family.'); return null;
  }
  const hasDefinition = input.definitionJson !== undefined;
  if (!hasDefinition && input.libraryJson === undefined) invalid('$', 'No definition or library supplied.');
  const d = hasDefinition ? scan(parse(input.definitionJson!, '$'), 'Definition', '$') : null;
  if (d && !known.knownFormatVersions.definition.includes(d.version as number)) issue('unknown-version', '$.version', 'Unreviewed definition version.');
  const rigVersion = d?.faceRigVersion ?? known.presets.rigDefault;
  const rigEntry = d ? known.rigs.find((rig) => rig.version === rigVersion) : undefined;
  if (d && !rigEntry) issue('unknown-rig', '$.faceRigVersion', 'Unsupported rig version.');
  if (rigEntry) result.resolved.rigVersion = rigEntry.version;
  const pose = known.poses.find((p) => `fino_${p.id}.png` === d?.basePose);
  if (d && !pose) issue('unknown-pose', '$.basePose', 'Base pose is not inventoried.');
  const rawFrames = d?.frames;
  const frames: RecordValue[] = [];
  if (hasDefinition && (!Array.isArray(rawFrames) || !rawFrames.length || rawFrames.length > 1000)) invalid('$.frames', 'Expected 1..1000 frames.');
  else if (Array.isArray(rawFrames)) for (let i = 0; i < rawFrames.length; i++) {
    const f = scan(rawFrames[i], 'LegacyFrame', `$.frames[${i}]`); frames.push(f ?? {});
  }
  const hasAddons = frames.some((f) => f.eyes != null || f.mouth != null);
  const roots = input.context?.addonRoot;
  const candidates = [...new Set(typeof roots === 'string' ? [roots] : roots ?? [])].sort();
  const allowedRoots = known.contexts.find((c) => c.id === 'addonRoot')!.values!;
  result.resolved.addonCandidates = hasAddons ? candidates.length ? candidates : [...allowedRoots].sort() : candidates;
  if (candidates.some((root) => !allowedRoots.includes(root))) issue('unknown-addon-root', 'context.addonRoot', 'Addon family is not inventoried.');
  else if (candidates.length === 1) { result.resolved.addonRoot = candidates[0]!; result.resolved.addonContext = 'explicit'; }
  else if (hasAddons) issue('ambiguous-addon-root', 'context.addonRoot', 'No unique source family supplied; Legacy default is not evidence of origin.');
  else { result.resolved.addonContext = 'unused'; issue('unused-addon-root', 'context.addonRoot', 'No addons use this context.', 'information'); }
  const required = new Set<string>();
  if (pose) required.add(rigVersion === 2 ? pose.faceBase : pose.base);
  if (rigEntry) required.add(rigEntry.manifestPath);
  if (hasDefinition) required.add(known.presets.path);
  let rig: Rig | null = null;
  if (rigEntry && resources.has(rigEntry.manifestPath)) {
    try { rig = JSON.parse(text(resources.get(rigEntry.manifestPath)!)) as Rig; } catch { invalid(rigEntry.manifestPath, 'Invalid rig JSON.'); }
  }
  // Preserve the complete selected rig (including currently unused variants).
  if (rigEntry) for (const asset of known.assets) if (asset.rigVersion === rigVersion) required.add(asset.path);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!, at = `$.frames[${i}]`;
    if (!integer(f.durationMs) || f.durationMs < 1) invalid(`${at}.durationMs`);
    const implicit = f.layers === undefined || (Array.isArray(f.layers) && !f.layers.length);
    const layers = implicit ? ['base', ...known.states.faceParts].map((kind) => ({ id: kind, name: kind, kind })) : f.layers;
    const normalizedLayers: RecordValue[] = [];
    if (!Array.isArray(layers)) invalid(`${at}.layers`);
    else for (let j = 0; j < layers.length; j++) {
      const layer = scan(layers[j], 'LegacyLayer', `${at}.layers[${j}]`); if (!layer) continue;
      if (!known.states.layerKinds.includes(layer.kind as string)) issue('unknown-layer', `${at}.layers[${j}].kind`, 'Unknown layer kind.');
      const pixels = layer.pixels === undefined ? [] : pixelArray(layer.pixels, `${at}.layers[${j}].pixels`, 1024, 1024);
      component(`${at}.layers[${j}]`, 'layer', layer.kind === 'pixels' ? 2 : 3, layer.kind === 'pixels' && editablePixels(pixels, 1024, 1024) ? 'editierbar' : 'gerastert verlustbehaftet', 'preserve-layer-or-bake-compositing');
      normalizedLayers.push({ ...layer, visible: layer.visible ?? known.defaults.layerVisible, locked: layer.locked ?? known.defaults.layerLocked });
    }
    const normalizedOps: RecordValue[] = [];
    if (!Array.isArray(f.ops)) invalid(`${at}.ops`);
    else for (let j = 0; j < f.ops.length; j++) {
      const opAt = `${at}.ops[${j}]`, op = scan(f.ops[j], 'LegacyOp', opAt); if (!op) continue;
      const family = known.operations.find((candidate) => candidate.type === op.type);
      if (!family) { issue('unknown-operation', opAt, 'Renderer would skip an unknown operation.'); component(opAt, 'operation', 3, 'blockiert', 'resolve-unknown-operation'); continue; }
      additional(op, family.fields, opAt);
      const bounds = geometry(op.type === 'moveRegion' ? op.rect : op.mask, `${opAt}.${op.type === 'moveRegion' ? 'rect' : 'mask'}`, op.type === 'moveRegion');
      if (op.type === 'stretchSelection') {
        const scope = op.scope ?? family.defaultScope;
        if (!family.scopes?.includes(scope as string)) issue('unknown-scope', `${opAt}.scope`, 'Renderer would skip this stretch scope.');
        if (bounds && (Math.abs(Number(op.sx ?? 0)) >= bounds.width || Math.abs(Number(op.sy ?? 0)) >= bounds.height)) invalid(opAt, 'Stretch would throw in the Legacy renderer.');
        normalizedOps.push({ ...op, sx: op.sx ?? 0, sy: op.sy ?? 0, scope });
      } else {
        const area = op.vacatedArea;
        if (object(area)) additional(area, known.unions.vacatedArea.objectFields, `${opAt}.vacatedArea`);
        if (area !== undefined && typeof area !== 'string' && !object(area)) invalid(`${opAt}.vacatedArea`);
        if (object(area) && area.strategy !== undefined && typeof area.strategy !== 'string') invalid(`${opAt}.vacatedArea.strategy`);
        const strategy = typeof area === 'string' ? area : object(area) ? area.strategy ?? family.defaultStrategy : family.defaultStrategy;
        if (family.strategies && !family.strategies.includes(strategy as string)) issue('unknown-strategy', `${opAt}.vacatedArea`, 'Renderer would skip this fill strategy.');
        normalizedOps.push({ ...op, dx: op.dx ?? 0, dy: op.dy ?? 0, vacatedArea: strategy });
      }
      component(opAt, 'operation', family.category, 'gerastert verlustbehaftet', 'render-before-assessing-128-representability');
    }
    const face: RecordValue = {};
    if (f.face !== undefined && !object(f.face)) invalid(`${at}.face`);
    if (object(f.face)) {
      additional(f.face, known.states.faceParts, `${at}.face`);
      for (const part of known.states.faceParts) if (f.face[part] !== undefined) {
        const el = scan(f.face[part], 'FaceElement', `${at}.face.${part}`); if (!el) continue;
        const states = part === 'mouth' ? known.states.mouths : known.states.eyes;
        if (!states.includes(el.state as string)) issue('missing-face-asset', `${at}.face.${part}.state`, 'State has no inventoried sprite, including hidden elements.');
        if (!integer(el.width) || !integer(el.height) || el.width < 1 || el.height < 1 || el.width > 1024 || el.height > 1024) invalid(`${at}.face.${part}`);
        face[part] = { ...el, visible: el.visible ?? known.defaults.faceVisible };
      }
    }
    const addons: RecordValue = {};
    for (const part of known.presets.addonParts) {
      const raw = f[part]; if (raw === undefined || raw === null) { addons[part] = null; continue; }
      if (typeof raw !== 'string' && !object(raw)) { invalid(`${at}.${part}`); continue; }
      const addon = typeof raw === 'string' ? { state: raw } : raw;
      additional(addon, known.unions.Addon.objectFields, `${at}.${part}`);
      if (typeof addon.state !== 'string' || !(part === 'eyes' ? known.states.eyes : known.states.mouths).includes(addon.state)) issue('missing-addon-asset', `${at}.${part}.state`, 'Addon state is not inventoried.');
      for (const key of ['dx', 'dy']) if (addon[key] !== undefined && !integer(addon[key])) invalid(`${at}.${part}.${key}`);
      const normalized = { ...addon, dx: addon.dx ?? 0, dy: addon.dy ?? 0 };
      addons[part] = normalized;
      for (const root of result.resolved.addonCandidates.filter((root) => allowedRoots.includes(root))) required.add(`public/animation/legacy/${root}/${part === 'eyes' ? 'eyes' : 'mouths'}/fino_${part}_${String(addon.state)}.png`);
    }
    result.resolved.frames.push({ index: i, implicitLayers: implicit, layers: normalizedLayers, ops: normalizedOps, face, ...addons });
  }
  if (input.libraryJson !== undefined) {
    const library = scan(parse(input.libraryJson, 'library'), 'TemplateLibrary', 'library');
    if (library && !known.knownFormatVersions.library.includes(library.version as number)) issue('unknown-version', 'library.version', 'Unreviewed library version.');
    if (!Array.isArray(library?.templates)) invalid('library.templates');
    else for (let i = 0; i < library.templates.length; i++) {
      const at = `library.templates[${i}]`, t = scan(library.templates[i], 'SerializedTemplate', at); if (!t) continue;
      if (!integer(t.width) || !integer(t.height) || t.width < 1 || t.height < 1 || t.width > 1024 || t.height > 1024) invalid(at);
      const pixels = pixelArray(t.pixels, `${at}.pixels`, Number(t.width), Number(t.height));
      component(at, 'template', 2, editablePixels(pixels, Number(t.width), Number(t.height), Number(t.originX), Number(t.originY)) ? 'editierbar' : 'gerastert verlustbehaftet', 'preserve-origin-and-collection-outside-frame-history');
    }
  }
  for (const path of [...required].sort()) {
    const asset = known.assets.find((a) => a.path === path), preset = path === known.presets.path;
    const expected = asset?.sha256 ?? (preset ? known.presets.sha256 : null), raw = resources.get(path);
    const actual = raw === undefined ? null : await sha256(raw);
    const status = !expected ? 'unknown' : actual === null ? 'missing' : actual !== expected ? 'changed' : 'verified';
    references.set(path, { path, expectedSha256: expected, actualSha256: actual, role: asset?.role ?? (preset ? 'presets-calibration' : 'unknown'), category: (asset?.category ?? 3) as Category, status });
    if (status !== 'verified') issue(`resource-${status}`, path, 'Required resource absent, changed or outside the inventory.');
    component(path, 'resource', asset?.category ?? 3, status === 'verified' ? asset?.category === 4 ? 'gerastert verlustbehaftet' : 'editierbar' : 'blockiert', 'archive-original-resource-and-reference');
  }
  result.references = [...references.values()];
  if (!issues.some((entry) => entry.severity === 'blocking') && d && rig) {
    const decoded = new Map<string, ReturnType<typeof legacyDecode>>();
    const loader = (path: string) => {
      const full = `public/animation/legacy/${path}`;
      if (!required.has(full)) throw Error(`Unresolved renderer dependency: ${full}`);
      if (!decoded.has(full)) decoded.set(full, legacyDecode(bytes(resources.get(full)!)));
      return Promise.resolve(decoded.get(full)!);
    };
    for (let i = 0; i < frames.length; i++) {
      try {
        // Render the original definition: materializing implicit layers can alter transparent RGB.
        const warnings: string[] = [];
        const image = await renderLegacy(d as unknown as Definition, i, loader, rig, result.resolved.addonRoot ?? known.defaults.addonRoot, (warning) => warnings.push(warning));
        for (const warning of warnings) issue('renderer-warning', `$.frames[${i}]`, warning);
        let nonUniform = 0;
        for (let y = 0; y < 1024; y += 8) for (let x = 0; x < 1024; x += 8) {
          let different = false;
          for (let yy = y; yy < y + 8 && !different; yy++) for (let xx = x; xx < x + 8; xx++) if (image.get(xx, yy) !== image.get(x, y)) { different = true; break; }
          if (different) nonUniform++;
        }
        const route: TransferRoute = warnings.length ? 'blockiert' : nonUniform ? 'gerastert verlustbehaftet' : 'gerastert exakt';
        result.frames.push({ index: i, route, nonUniform8Blocks: nonUniform, rgbaSha256: await sha256(image.toBytes()) });
        component(`$.frames[${i}]`, 'rendered-frame', 4, route, 'assess-baked-result-without-conversion');
      } catch (error) { issue('render-failed', `$.frames[${i}]`, error instanceof Error ? error.message : 'Rendering failed.'); }
    }
  }
  result.complete = !issues.some((entry) => entry.severity === 'blocking');
  if (!result.complete) {
    for (const c of components) if (issues.some((entry) => entry.severity === 'blocking' && (entry.path === c.path || entry.path.startsWith(`${c.path}.`) || entry.path.startsWith(`${c.path}[`)))) c.route = 'blockiert';
    result.frames = frames.map((_, index) => ({ index, route: 'blockiert', nonUniform8Blocks: null, rgbaSha256: null }));
  } else result.route = result.frames.some((frame) => frame.route === 'gerastert verlustbehaftet') || components.some((c) => c.kind === 'template' && c.route === 'gerastert verlustbehaftet') ? 'gerastert verlustbehaftet' : result.frames.length ? 'gerastert exakt' : 'editierbar';
  return result;
}

export type OriginalArchive = {
  archiveVersion: 1;
  archiveId: string;
  original: { source: LegacyInput['source']; definition: { json: string; sha256: string } | null; library: { json: string; sha256: string } | null; suppliedContext: LegacyInput['context'] | null };
  resources: (AssetReference & { original: { text: string } | { bytes: number[] } | null })[];
  assessment: LegacyAudit;
};
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') { for (const entry of Object.values(value)) freezeDeep(entry); Object.freeze(value); }
  return value;
}

/** In-memory archive only. PNG payloads optional; JSON resources always retained exactly. */
export async function createLegacyOriginalArchive(input: LegacyInput, resources: ResourceSet, known: LegacyInventory, includeAssetBytes = false): Promise<OriginalArchive> {
  const captured = structuredClone(input), files = snapshotResources(resources), inv = structuredClone(known);
  const assessment = await inspectSnapshot(captured, files, inv);
  const original = {
    source: { ...captured.source }, definition: captured.definitionJson === undefined ? null : { json: captured.definitionJson, sha256: await sha256(captured.definitionJson) },
    library: captured.libraryJson === undefined ? null : { json: captured.libraryJson, sha256: await sha256(captured.libraryJson) },
    suppliedContext: captured.context ?? null,
  };
  const entries = assessment.references.map((reference) => {
    const raw = files.get(reference.path);
    return { ...reference, original: raw !== undefined && (includeAssetBytes || reference.path.endsWith('.json')) ? typeof raw === 'string' ? { text: raw } : { bytes: [...raw] } : null };
  });
  // Identity binds the report, context and original resource digests, independent of payload embedding.
  const archiveId = await sha256(canonicalJson({ archiveVersion: 1, original, assessment }));
  return freezeDeep({ archiveVersion: 1, archiveId, original, resources: entries, assessment });
}

/** Pure discovery adapter: caller supplies local entries and per-definition context. */
export async function inspectLocalLegacyDefinitions(entries: ReadonlyMap<string, string>, resources: ResourceSet, known: LegacyInventory, contexts: ReadonlyMap<string, LegacyInput['context']> = new Map()): Promise<LegacyAudit[]> {
  const captured = new Map(entries), files = snapshotResources(resources), inv = structuredClone(known), contextMap = new Map([...contexts].map(([key, context]) => [key, structuredClone(context)]));
  const reports: LegacyAudit[] = [];
  for (const [name, definitionJson] of [...captured].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) if (name.endsWith('.finoanim.json')) {
    reports.push(await inspectSnapshot({ definitionJson, source: { kind: 'local', name }, context: contextMap.get(name), ...(captured.has(inv.persistence.libraryKey) ? { libraryJson: captured.get(inv.persistence.libraryKey)! } : {}) }, files, inv));
  }
  return reports;
}
