import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import inventory from '../src/animation/migration/legacy-inventory.json';
import fixtures from './fixtures/legacy-migration-cases.json';
import { EYES, MOUTHS, PARTS, POSES, legacyDecode, parseDefinition, renderLegacy } from '../src/animation/legacy';
import type { Rig } from '../src/animation/legacy';
import { decodeTemplates, encodeTemplates } from '../src/animation/templateLibrary';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const fileHash = (path: string) => sha256(readFileSync(path));
const sorted = (values: readonly string[]) => [...values].sort();
const record = (value: unknown) => value as Record<string, unknown>;
const keys = (value: unknown) => sorted(Object.keys(record(value)));
const source = (path: string) => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

// A representability measurement only; neither sampling nor a migration converter.
function nonUniform8Blocks(image: ReturnType<typeof legacyDecode>) {
  let count = 0;
  for (let y = 0; y < image.height; y += 8) for (let x = 0; x < image.width; x += 8) {
    const first = image.get(x, y);
    let different = false;
    for (let yy = y; yy < y + 8 && !different; yy++) for (let xx = x; xx < x + 8; xx++) if (image.get(xx, yy) !== first) { different = true; break; }
    if (different) count++;
  }
  return count;
}

// Inspect declarations, not serialized examples alone: optional/new fields must be reviewed too.
function alias(file: ts.SourceFile, name: string): ts.TypeNode {
  const declaration = file.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === name);
  if (!declaration) throw Error(`Missing declaration ${file.fileName}:${name}`);
  return declaration.type;
}
function fields(file: ts.SourceFile, node: ts.TypeNode): { name: string; optional: boolean; sourceType: string }[] {
  if (ts.isParenthesizedTypeNode(node)) return fields(file, node.type);
  if (ts.isIntersectionTypeNode(node)) return node.types.flatMap((part) => fields(file, part));
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(file);
    const owner = ['Point', 'Rect'].includes(name) && file.fileName === 'src/animation/legacy.ts' ? source('src/animation/raster.ts') : file;
    return fields(owner, alias(owner, name));
  }
  if (!ts.isTypeLiteralNode(node)) throw Error(`Expected record: ${node.getText(file)}`);
  return node.members.filter(ts.isPropertySignature).map((member) => ({ name: member.name.getText(file), optional: Boolean(member.questionToken), sourceType: member.type!.getText(file).replace(/\s+/g, '') }));
}
function unionStrings(file: ts.SourceFile, node: ts.TypeNode): string[] {
  if (ts.isUnionTypeNode(node)) return node.types.flatMap((part) => unionStrings(file, part));
  if (ts.isTypeReferenceNode(node)) return unionStrings(file, alias(file, node.typeName.getText(file)));
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return [node.literal.text];
  throw Error(`Expected string union: ${node.getText(file)}`);
}
function visit(node: ts.Node, fn: (node: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (child) => { visit(child, fn); });
}
function rendererValues(subject: string): string[] {
  const values = new Set<string>();
  visit(source('src/animation/legacy.ts'), (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && node.left.getText() === subject && ts.isStringLiteral(node.right)) values.add(node.right.text);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'includes' && node.arguments[0]?.getText() === subject && ts.isArrayLiteralExpression(node.expression.expression)) {
      for (const value of node.expression.expression.elements) if (ts.isStringLiteral(value)) values.add(value.text);
    }
  });
  return sorted([...values]);
}
function covered(value: unknown, structure: keyof typeof inventory.structures) {
  const declared = inventory.structures[structure].fields.map((field) => field.name);
  expect(keys(value).filter((key) => !declared.includes(key)), structure).toEqual([]);
}

describe('reviewed Legacy migration inventory', () => {
  it('contains exactly the current 74 assets, with reviewed bytes, families and functions', () => {
    const root = 'public/animation/legacy';
    const actual = readdirSync(root, { recursive: true }).map(String).filter((path) => statSync(join(root, path)).isFile()).map((path) => `${root}/${path.replaceAll('\\', '/')}`);
    expect(sorted(actual)).toEqual(sorted(inventory.assets.map((asset) => asset.path)));
    expect(new Set(actual).size).toBe(74);
    for (const family of inventory.families) expect(inventory.assets.filter((asset) => asset.family === family.id), family.id).toHaveLength(family.count);
    for (const asset of inventory.assets) {
      expect(fileHash(asset.path), asset.path).toBe(asset.sha256);
      expect(asset.path.split('/')[3]).toBe(asset.family);
      expect(asset.role).not.toBe('');
      expect([3, 4]).toContain(asset.category);
      if (asset.png) {
        const image = legacyDecode(readFileSync(asset.path));
        expect([image.width, image.height]).toEqual([asset.png.width, asset.png.height]);
        let partial = 0;
        for (const pixel of image.pixels) if ((pixel & 255) > 0 && (pixel & 255) < 255) partial++;
        expect(partial, asset.path).toBe(asset.png.partialAlphaPixels);
        if (asset.png.nonUniform8Blocks !== null) {
          expect(nonUniform8Blocks(image), asset.path).toBe(asset.png.nonUniform8Blocks);
        }
      }
    }
  }, 30000);

  it('covers all six poses, both bases and the separate tracing references', () => {
    expect(inventory.poses.map((pose) => pose.id)).toEqual(POSES);
    for (const pose of inventory.poses) {
      expect(inventory.assets.find((asset) => asset.path === pose.base)?.pose).toBe(pose.id);
      expect(inventory.assets.find((asset) => asset.path === pose.faceBase)?.pose).toBe(pose.id);
      expect(fileHash(pose.reference.path)).toBe(pose.reference.sha256);
      expect(pose.reference.role).toBe('editor-only-reference-not-native-pose');
    }
    expect(inventory.states.eyes).toEqual(EYES);
    expect(inventory.states.mouths).toEqual(MOUTHS);
    expect(inventory.states.faceParts).toEqual(PARTS);
  });

  it('covers every rig element, manifest field, calibration field and referenced sprite', () => {
    expect(inventory.rigs.map((rig) => rig.version)).toEqual([1, 2]);
    for (const rig of inventory.rigs) {
      const manifest = record(read(rig.manifestPath));
      expect(fileHash(rig.manifestPath)).toBe(rig.sha256);
      expect(manifest.version).toBe(rig.version);
      expect(keys(manifest)).toEqual(sorted(rig.manifestFields));
      const elements = record(manifest.elements);
      expect(keys(elements)).toEqual(rig.elementKeys);
      expect(rig.elementKeys).toEqual(sorted([
        ...EYES.map((state) => `eyeLeft/${state}`),
        ...EYES.map((state) => `eyeRight/${state}`),
        ...MOUTHS.map((state) => `mouth/${state}`),
      ]));
      expect(sorted([...new Set(Object.values(elements).flatMap(keys))])).toEqual(rig.elementFields);
      for (const [key, raw] of Object.entries(elements)) {
        const element = record(raw);
        const asset = inventory.assets.find((candidate) => candidate.path === posix.join(dirname(rig.manifestPath).replaceAll('\\', '/'), String(element.file)));
        expect(asset, key).toBeDefined();
        expect(asset?.rigVersion).toBe(rig.version);
        expect([asset?.png?.width, asset?.png?.height]).toEqual([element.width, element.height]);
      }
      if (rig.faceBaseFields) {
        expect(manifest.strategy).toBe(rig.strategy);
        expect(manifest.muzzleVariant).toBe(rig.muzzleVariant);
        expect(keys(manifest.sources)).toEqual(rig.sourceFields);
        for (const [pose, raw] of Object.entries(record(manifest.faceBases))) {
          const base = record(raw);
          expect(keys(base)).toEqual(rig.faceBaseFields);
          expect(inventory.assets.some((asset) => asset.path === posix.join('public/animation/legacy', String(manifest.baseRoot), String(base.file)))).toBe(true);
          expect(inventory.poses.some((p) => `fino_${p.id}.png` === pose)).toBe(true);
          for (const window of [...base.eyeWindows as unknown[], base.mouthWindow]) {
            expect(keys(window)).toEqual(sorted(rig.windowFields ?? []));
            expect(keys(record(window).fillSample)).toEqual(rig.sampleFields);
          }
        }
        for (const element of Object.values(elements)) if (record(element).selectionWindow) expect(keys(record(element).selectionWindow)).toEqual(sorted(rig.selectionWindowFields ?? []));
      }
    }
  });

  it('covers each addon family, part and state, and all preset tables', () => {
    for (const root of inventory.contexts[0]!.values!) for (const part of ['eyes', 'mouth']) {
      expect(sorted(inventory.assets.filter((asset) => asset.family === root && asset.part === part).map((asset) => asset.state!))).toEqual(sorted(part === 'eyes' ? EYES : MOUTHS));
    }
    const presets = record(read(inventory.presets.path));
    expect(fileHash(inventory.presets.path)).toBe(inventory.presets.sha256);
    expect(keys(presets)).toEqual(sorted(inventory.presets.tables));
    for (const version of ['v1', 'v2']) {
      expect(keys(presets[version])).toEqual(sorted(POSES.map((pose) => `fino_${pose}.png`)));
      for (const face of Object.values(record(presets[version]))) for (const [part, element] of Object.entries(record(face))) {
        expect(PARTS).toContain(part);
        expect(keys(element)).toEqual(sorted(inventory.presets.faceFields));
      }
    }
    expect(keys(presets.addons)).toEqual(sorted(POSES.map((pose) => `fino_${pose}.png`)));
    for (const pose of Object.values(record(presets.addons))) {
      expect(keys(pose)).toEqual(sorted(inventory.presets.addonParts));
      for (const offset of Object.values(record(pose))) expect(keys(offset)).toEqual(sorted(inventory.presets.addonFields));
    }
  });

  it('matches source declarations, including optional fields and inherited point fields', () => {
    for (const [name, structure] of Object.entries(inventory.structures)) {
      if (name === 'TemplateLibrary' || name === 'SerializedTemplate') continue;
      const file = source(structure.source);
      expect(fields(file, alias(file, name)).sort((a, b) => a.name.localeCompare(b.name)), name).toEqual(structure.fields.map(({ name, optional, sourceType }) => ({ name, optional, sourceType })).sort((a, b) => a.name.localeCompare(b.name)));
    }
    const file = source('src/animation/legacy.ts');
    const layer = alias(file, 'LegacyLayer') as ts.TypeLiteralNode;
    const kind = layer.members.find((member): member is ts.PropertySignature => ts.isPropertySignature(member) && member.name.getText(file) === 'kind')!;
    expect(sorted(unionStrings(file, kind.type!))).toEqual(sorted(inventory.states.layerKinds));
    const mask = alias(file, 'Mask') as ts.UnionTypeNode;
    expect(mask.getText(file).replace(/\s+/g, '')).toBe(inventory.unions.Mask.sourceType);
    expect(mask.types.map((node) => fields(file, node).map((field) => field.name).sort())).toEqual(inventory.unions.Mask.variants.map((variant) => sorted(variant.fields)));
    const addon = alias(file, 'Addon') as ts.UnionTypeNode;
    expect(addon.getText(file).replace(/\s+/g, '')).toBe(inventory.unions.Addon.sourceType);
    expect(fields(file, addon.types.find(ts.isTypeLiteralNode)!).map((field) => field.name)).toEqual(inventory.unions.Addon.objectFields);
    const operation = alias(file, 'LegacyOp') as ts.TypeLiteralNode;
    const area = operation.members.find((node): node is ts.PropertySignature => ts.isPropertySignature(node) && node.name.getText(file) === 'vacatedArea')!;
    expect(area.type!.getText(file).replace(/\s+/g, '')).toBe(inventory.unions.vacatedArea.sourceType);
    const templateFile = source('src/animation/templateLibrary.ts');
    let dataType: ts.TypeLiteralNode | undefined;
    visit(templateFile, (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(templateFile) === 'data' && node.initializer && ts.isAsExpression(node.initializer) && ts.isTypeLiteralNode(node.initializer.type)) dataType = node.initializer.type; });
    expect(fields(templateFile, dataType!)).toEqual(inventory.structures.TemplateLibrary.fields.map(({ name, optional, sourceType }) => ({ name, optional, sourceType })));
    const templates = dataType!.members.find((node): node is ts.PropertySignature => ts.isPropertySignature(node) && node.name.getText(templateFile) === 'templates')!;
    expect(fields(templateFile, (templates.type as ts.ArrayTypeNode).elementType)).toEqual(inventory.structures.SerializedTemplate.fields.map(({ name, optional, sourceType }) => ({ name, optional, sourceType })));
  });

  it('pins recognized operation families, fill strategies and stretch scopes', () => {
    expect(rendererValues('op.type')).toEqual(sorted(inventory.operations.map((op) => op.type)));
    expect(rendererValues('strategy')).toEqual(sorted(inventory.operations.find((op) => op.type === 'moveSelection')!.strategies!));
    expect(rendererValues('scope')).toEqual(sorted(inventory.operations.find((op) => op.type === 'stretchSelection')!.scopes!));
    const operations = fixtures.cases.flatMap((c) => parseDefinition(JSON.stringify(c.definition)).frames.flatMap((f) => f.ops));
    expect(sorted([...new Set(operations.map((op) => op.type))])).toEqual(rendererValues('op.type'));
    const moves = operations.filter((op) => op.type === 'moveSelection');
    for (const strategy of rendererValues('strategy')) for (const mask of inventory.unions.Mask.variants) for (const representation of ['string', 'object']) {
      expect(moves.some((raw) => { const op = record(raw), area = op.vacatedArea; return record(op.mask).type === mask.type && typeof area === representation && (typeof area === 'string' ? area : record(area).strategy) === strategy; }), `${mask.type}/${strategy}/${representation}`).toBe(true);
    }
    for (const scope of rendererValues('scope')) for (const mask of inventory.unions.Mask.variants) expect(operations.some((raw) => { const op = record(raw); return op.type === 'stretchSelection' && op.scope === scope && record(op.mask).type === mask.type; })).toBe(true);
  });

  it('retains only independent pose/rig/operation Dart goldens', () => {
    const reference = inventory.references.dartGoldens;
    expect(fileHash(reference.path)).toBe(reference.sha256);
    const goldens = read(reference.path) as { definition: unknown; hash: number }[];
    expect(goldens).toHaveLength(reference.count);
    expect(reference.count).toBe(24);
    expect(sorted([...new Set(goldens.map((c) => String(record(c.definition).basePose)))])).toEqual(sorted(POSES.map((p) => `fino_${p}.png`)));
    expect([...new Set(goldens.map((c) => record(c.definition).faceRigVersion ?? 1))].sort()).toEqual([1, 2]);
  });

  it('covers the fields actually present in synthetic cases and Dart definitions', () => {
    const goldens = read(inventory.references.dartGoldens.path) as { definition: unknown }[];
    for (const raw of [...fixtures.cases.map((c) => c.definition), ...goldens.map((c) => c.definition)]) {
      covered(raw, 'Definition');
      const d = parseDefinition(JSON.stringify(raw));
      for (const frame of d.frames) {
        covered(frame, 'LegacyFrame');
        for (const op of frame.ops) { covered(op, 'LegacyOp'); if (op.rect) covered(op.rect, 'Rect'); }
        for (const element of Object.values(frame.face ?? {})) covered(element, 'FaceElement');
        for (const layer of frame.layers ?? []) { covered(layer, 'LegacyLayer'); for (const pixel of layer.pixels ?? []) covered(pixel, 'Pixel'); }
      }
    }
    covered(fixtures.templateLibrary, 'TemplateLibrary');
    for (const template of fixtures.templateLibrary.templates) { covered(template, 'SerializedTemplate'); for (const pixel of template.pixels) covered(pixel, 'Pixel'); }
  });

  it('keeps reusable library fixtures byte-value preserving in the existing codec', () => {
    const decoded = decodeTemplates(JSON.stringify(fixtures.templateLibrary));
    expect(JSON.parse(encodeTemplates(decoded))).toEqual(fixtures.templateLibrary);
    expect(decoded.map((template) => template.origin)).toEqual([{ x: 520, y: 285 }, { x: -3, y: 1024 }]);
  });

  it('pins surviving storage/import formats without depending on the Authoring Store or UI', () => {
    const files = readFileSync('src/animation/indexedSessionStorage.ts', 'utf8');
    const migration = readFileSync('src/animation/migration/localMigration.ts', 'utf8');
    const panel = readFileSync('src/animation/migration/LegacyMigrationPanel.tsx', 'utf8');
    const builder = readFileSync('src/animation/migration/LegacyTemplateImport.tsx', 'utf8');
    const renderer = readFileSync('src/animation/legacy.ts', 'utf8');
    expect(files).toContain(`const DB = '${inventory.persistence.database}'`);
    expect(inventory.persistence.databaseVersion).toBe(1); // Historical source schema remains recorded.
    expect(files).toContain('indexedDB.open(DB, 2)');
    expect(files).toContain(`createObjectStore('${inventory.persistence.objectStore}')`);
    expect(builder).toContain(`localSessionStorage.read('${inventory.persistence.libraryKey}')`);
    expect(migration).toContain("sourceKey.endsWith('.finoanim.json')");
    expect(panel).toContain(`accept="${inventory.persistence.filePickerAccepts.join(',')}"`);
    const addon = inventory.contexts.find((context) => context.id === 'addonRoot')!;
    expect(renderer).toContain(`addonRoot = '${addon.default}'`);
    expect(inventory.structures.Definition.fields.some((field) => field.name === 'addonRoot')).toBe(false);
    for (const value of addon.values!) expect(panel).toContain(`'${value}'`);
  });

  it('records unknown, ambiguous and blocked data explicitly without implying successful conversion', () => {
    expect(sorted(fixtures.assessments.map((case_) => case_.status))).toEqual(['ambiguous', 'blocked', 'unknown', 'unknown']);
    for (const assessment of fixtures.assessments) {
      expect(inventory.assessmentStatuses).toContain(assessment.status);
      expect(assessment.reason.length).toBeGreaterThan(20);
      expect(() => parseDefinition(JSON.stringify(assessment.definition))).not.toThrow();
    }
    const categories: number[] = [];
    visitCategories(inventory, categories);
    visitCategories(fixtures, categories);
    expect(new Set(categories)).toEqual(new Set([1, 2, 3, 4]));
  });

  it('retains renderer semantics for the additional format-coverage baselines', async () => {
    const cache = new Map<string, ReturnType<typeof legacyDecode>>();
    const loader = (path: string) => {
      if (!cache.has(path)) cache.set(path, legacyDecode(readFileSync(`public/animation/legacy/${path}`)));
      return Promise.resolve(cache.get(path)!);
    };
    for (const case_ of fixtures.cases) {
      const d = parseDefinition(JSON.stringify(case_.definition));
      const rig = read(`public/animation/legacy/${d.faceRigVersion === 2 ? 'addons_rig_v2' : 'addons_rig'}/rig.json`) as Rig;
      for (const context of case_.renderContexts) {
        const warnings: string[] = [];
        const image = await renderLegacy(d, 0, loader, rig, context.addonRoot, (warning) => warnings.push(warning));
        expect(warnings, case_.id).toEqual([]);
        expect(sha256(image.toBytes()), `${case_.id}/${context.addonRoot}`).toBe(context.expectedRgbaSha256);
      }
    }
  }, 30000);
});

function visitCategories(value: unknown, found: number[]) {
  if (Array.isArray(value)) { for (const entry of value) visitCategories(entry, found); }
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (key === 'category') found.push(entry as number);
    else visitCategories(entry, found);
  }
}
