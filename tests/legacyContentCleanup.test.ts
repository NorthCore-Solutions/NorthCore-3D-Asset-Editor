import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import inventory from '../src/animation/migration/legacy-inventory.json';
import multiframe from './fixtures/legacy-multiframe.json';
import { parseDefinition } from '../src/animation/legacy';

it('ships only import resources and permanent tracing references in public/animation', () => {
  const files = readdirSync('public/animation', { recursive: true }).map(String)
    .filter((name) => /\.(png|json)$/i.test(name)).map((name) => name.replaceAll('\\', '/')).sort();
  expect(files).toEqual([
    ...inventory.assets.map((asset) => asset.path.replace('public/animation/', '')),
    ...inventory.poses.map((pose) => pose.reference.path.replace('public/animation/', '')),
  ].sort());
});

it('retains independent compatibility goldens without animation demo definitions', () => {
  const cases = JSON.parse(readFileSync(inventory.references.dartGoldens.path, 'utf8')) as { definition: { id: string } }[];
  expect(cases).toHaveLength(24);
  expect(new Set(cases.map((item) => item.definition.id))).toEqual(new Set(['test']));
});

it('the small multiframe fixture covers timing and distinct literal RGBA without demo content', () => {
  const parsed = parseDefinition(JSON.stringify(multiframe));
  expect(parsed.frames.map((frame) => frame.durationMs)).toEqual([37, 91]);
  expect(parsed.frames.map((frame) => frame.layers?.[0]?.pixels?.length)).toEqual([1, 2]);
  expect(parsed.frames[0]?.layers?.[0]?.pixels?.[0]?.rgba).toBe(0x12345680);
});
