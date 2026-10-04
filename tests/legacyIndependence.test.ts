import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const removedAuthoring = ['LegacyBuilder', 'LegacyCanvas', 'legacyStore', 'legacyPersistence'];
const authoringPath = /(?:^|\/)(LegacyBuilder|LegacyCanvas|legacyStore|legacyPersistence)(?:\.[cm]?[jt]sx?)?$/;

it('removed authoring files, test hosts and mode UI cannot return', () => {
  for (const name of removedAuthoring) {
    for (const extension of ['ts', 'tsx']) expect(existsSync(`src/animation/${name}.${extension}`)).toBe(false);
  }
  for (const name of ['legacy-authoring.html', 'legacy-authoring.tsx', 'legacy-polygon.spec.ts', 'legacy-persistence.spec.ts', 'legacy-content-cleanup.spec.ts'])
    expect(existsSync(`tests/browser/${name}`)).toBe(false);
  expect(existsSync('tests/legacyPersistence.test.ts')).toBe(false);
  for (const path of readdirSync('src', { recursive: true }).map(String).filter((p) => /\.(tsx?|css)$/.test(p))) {
    const content = readFileSync(resolve('src', path), 'utf8');
    expect(content, path).not.toMatch(new RegExp(removedAuthoring.join('|')));
    expect(content, path).not.toMatch(/legacy1024|Legacy1024|Editor-Modus|\.ab-menubar\s*>\s*select/);
  }
});

it('all production and test module edges, including type imports, exclude removed authoring', () => {
  for (const root of ['src', 'tests']) {
    for (const path of readdirSync(root, { recursive: true }).map(String).filter((p) => /\.[cm]?[jt]sx?$/.test(p))) {
      const fullPath = resolve(root, path);
      const file = ts.createSourceFile(fullPath, readFileSync(fullPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const dependencies: string[] = [];
      function visit(node: ts.Node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependencies.push(node.moduleSpecifier.text);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependencies.push(node.argument.literal.text);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependencies.push(node.arguments[0].text);
        ts.forEachChild(node, visit);
      }
      visit(file);
      for (const dependency of dependencies) expect(authoringPath.test(dependency.replaceAll('\\', '/').split(/[?#]/)[0]!), `${fullPath}: ${dependency}`).toBe(false);
    }
  }
});

it('the production Launcher/Builder entry graph never loads Legacy authoring', () => {
  const seen = new Set<string>(), forbidden = /(?:LegacyBuilder|LegacyCanvas|legacyStore|legacyPersistence)\.tsx?$/;
  function walk(path: string, chain: string[]) {
    if (seen.has(path)) return; seen.add(path);
    expect(forbidden.test(path), [...chain, path].join(' -> ')).toBe(false);
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const dependencies: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        // All-named type-only imports have no runtime edge.
        const bindings = node.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings) || node.importClause?.name || bindings.elements.some((e) => !e.isTypeOnly))
          dependencies.push(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependencies.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependencies.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(file);
    for (const dependency of dependencies) {
      if (!dependency.startsWith('.') || /\.(json|css|png)|\?/.test(dependency)) continue;
      const base = resolve(dirname(path), dependency);
      const child = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find((candidate) => existsSync(candidate));
      if (child && /\.tsx?$/.test(child)) walk(child, [...chain, path]);
    }
  }
  walk(resolve('src/app/EditorLauncher.tsx'), []);
  expect([...seen].some((p) => p.endsWith('legacy.ts'))).toBe(true); // Renderer remains import compatibility.
});

it('public assets trigger Android checks and both delivery workflows guard their built bundle', () => {
  // Use the existing dependency rather than introducing a YAML library into production.
  const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
  const workflow = yaml.load(readFileSync('.github/workflows/build-android-apk.yml', 'utf8')) as {
    on: { pull_request: { paths: string[] } }; jobs: Record<string, { steps: { run?: string }[] }>;
  };
  expect(workflow.on.pull_request.paths).toContain('public/**');
  expect(workflow.on.pull_request.paths).toContain('scripts/check-legacy-authoring.mjs');
  const runs = workflow.jobs['build-apk']!.steps.map((step) => step.run).filter(Boolean);
  for (const run of ['npm run lint', 'npm run test', 'npm run build', 'node scripts/check-legacy-authoring.mjs']) expect(runs).toContain(run);
  const beta = yaml.load(readFileSync('.github/workflows/publish-beta-live-update.yml', 'utf8')) as typeof workflow;
  const betaRuns = beta.jobs.publish!.steps.map((step) => step.run).filter(Boolean);
  for (const steps of [runs, betaRuns]) {
    expect(steps).toContain('npm run build');
    expect(steps).toContain('node scripts/check-legacy-authoring.mjs');
    expect(steps.indexOf('node scripts/check-legacy-authoring.mjs')).toBeGreaterThan(steps.indexOf('npm run build'));
  }
});
