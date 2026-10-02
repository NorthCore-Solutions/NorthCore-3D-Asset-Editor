import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { legacyDecode, parseDefinition, renderLegacy } from '../src/animation/legacy';
import type { Rig } from '../src/animation/legacy';

it('V1/V2 renderer matches the Dart renderer across all poses and pixel operations', async () => {
  const cases = JSON.parse(readFileSync('tests/fixtures/legacy-dart-goldens.json', 'utf8')) as {
    definition: unknown;
    hash: number;
  }[];
  for (const c of cases) {
    const d = parseDefinition(JSON.stringify(c.definition));
    const rig = JSON.parse(
      readFileSync(
        `public/animation/legacy/${d.faceRigVersion === 2 ? 'addons_rig_v2' : 'addons_rig'}/rig.json`,
        'utf8'
      )
    ) as Rig;
    const image = await renderLegacy(
      d,
      0,
      (path) =>
        Promise.resolve(legacyDecode(new Uint8Array(readFileSync(`public/animation/legacy/${path}`)))),
      rig
    );
    let hash = 2166136261;
    for (const value of image.toBytes()) hash = Math.imul(hash ^ value, 16777619) >>> 0;
    expect(hash, `${d.basePose} V${d.faceRigVersion ?? 1}, ops=${d.frames[0]!.ops.length}`).toBe(c.hash);
  }
}, 30000);
