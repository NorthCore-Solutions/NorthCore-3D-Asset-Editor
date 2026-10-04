import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const files = readdirSync('src', { recursive: true }).map(String).filter((p) => /\.tsx?$/.test(p)).map((p) => resolve('src', p));
const graph = new Map<string, string[]>();
const identifiers = new Map<string, number>();
const exported = new Map<string, string[]>();
const source = (p: string) => ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true);
for (const path of files) {
  const ast = source(path), dependencies: string[] = [], names: string[] = [];
  function visit(node: ts.Node) {
    let specifier: ts.Node | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      expect(node.moduleSpecifier.text, relative('.', path)).not.toMatch(/(?:^|\/)tests\//);
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings) || node.importClause?.name || bindings.elements.some((e) => !e.isTypeOnly)) specifier = node.moduleSpecifier;
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
      const base = resolve(dirname(path), specifier.text.split('?')[0]!);
      const child = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find((p) => files.includes(p));
      if (child) dependencies.push(child);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const node of ast.statements) if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) names.push(node.name.text);
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
  }
  graph.set(path, dependencies); exported.set(path, names);
}
for (const path of [...files, ...readdirSync('tests', { recursive: true }).map(String).filter((p) => /\.tsx?$/.test(p)).map((p) => resolve('tests', p))]) {
  function count(node: ts.Node) { if (ts.isIdentifier(node)) identifiers.set(node.text, (identifiers.get(node.text) ?? 0) + 1); ts.forEachChild(node, count); }
  count(source(path));
}
const name = (p: string) => relative('.', p).replaceAll('\\', '/');
function reachable(path: string, seen = new Set<string>()): Set<string> {
  if (seen.has(path)) return seen;
  seen.add(path); for (const child of graph.get(path) ?? []) reachable(child, seen);
  return seen;
}

it('native authoring and shared infrastructure cannot load Legacy compatibility', () => {
  const native = ['store', 'raster', 'files', 'nativePoses', 'nativeFaces', 'rasterOperations', 'globalTemplateLibrary', 'globalTemplateFormat',
    'RasterCanvas', 'NativeFaceInspector', 'RasterOperationsInspector', 'BuilderUI', 'Dialog', 'ColorDialog', 'BrushSizeSelector', 'useBuilderPanels', 'help', 'builderForm', 'BuilderCommands', 'BuilderLibraryPanel', 'BuilderInspector', 'BuilderTimeline',
    'useBuilderDialogs', 'useRasterDocumentActions', 'useBuilderShortcuts'];
  for (const entry of native) {
    const path = ['ts', 'tsx'].map((extension) => resolve(`src/animation/${entry}.${extension}`)).find((candidate) => existsSync(candidate))!;
    expect(existsSync(path), entry).toBe(true);
    for (const dependency of reachable(path)) expect(name(dependency), entry).not.toMatch(/\/migration\/|\/legacy\.ts$|\/templateLibrary\.ts$/);
  }
  for (const dependency of reachable(resolve('src/animation/storage.ts'))) expect(name(dependency)).toMatch(/src\/animation\/(?:storage|indexedSessionStorage|storageCatalog)\.ts$/);
  for (const entry of ['storageCatalog', 'png', 'contentHash', 'colors']) expect(graph.get(resolve(`src/animation/${entry}.ts`)), entry).toEqual([]);
  // The renderer may share PNG/RGBA primitives, but must not load native authoring.
  for (const dependency of graph.get(resolve('src/animation/legacy.ts')) ?? [])
    expect(name(dependency)).toMatch(/src\/animation\/(?:png|colors)\.ts$/);
});

it('the source runtime graph has no cycles', () => {
  const active = new Set<string>(), done = new Set<string>();
  function visit(path: string, chain: string[]) {
    expect(active.has(path), [...chain, path].map(name).join(' -> ')).toBe(false);
    if (done.has(path)) return;
    active.add(path); for (const child of graph.get(path) ?? []) visit(child, [...chain, path]);
    active.delete(path); done.add(path);
  }
  for (const path of files) visit(path, []);
});

it('animation modules are reachable or explicitly retained tested mapping APIs', () => {
  const shipped = reachable(resolve('src/main.tsx'));
  // Both pure mapping APIs remain required for compatibility, without automatic
  // lossy adoption in the converter. Their isolated tests are deliberate callers.
  const offline = ['src/animation/migration/legacyOperations.ts', 'src/animation/migration/legacyFaces.ts'];
  for (const path of files.filter((p) => name(p).startsWith('src/animation/')))
    expect(shipped.has(path) || offline.includes(name(path)), name(path)).toBe(true);
  for (const [path, names] of exported) if (name(path).startsWith('src/animation/')) for (const exportedName of names)
    expect(identifiers.get(exportedName), `${name(path)}: ${exportedName}`).toBeGreaterThan(1);
  expect(existsSync('src/animation/BuilderModule.tsx')).toBe(false);
  expect(existsSync('src/animation/migration/localMigrationStorage.ts')).toBe(false);
});
