import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { isWaterTight } from 'three-bvh-csg/src/utils/isWaterTight.js';
import { computeUnionMesh } from '../src/export/exportScene';
import { createGeometry, createSceneObject } from '../src/geometry/factory';
import { getSurfaceUvAtlas, type SurfaceUvIsland } from '../src/geometry/uvAtlas';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

// Minimale FileReader-Ergänzung für den GLTFExporter in der Node-Testumgebung.
class NodeFileReaderPolyfill {
  onloadend: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
}

if (typeof globalThis.FileReader === 'undefined') {
  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReaderPolyfill;
}

// Diese Tests prüfen die semantische Zuordnung Fläche → Atlas-Insel → Pixel,
// nicht nur die Existenz von UVs. Der Atlas für Box-Typen hat die Inseln
// Rechts, Links, Oben, Unten, Vorne, Hinten (in dieser Reihenfolge), angelegt
// in three.js-Konvention (flipY = true: v = 1 = Bild-Oberkante).

let idCounter = 0;

const ATLAS_WIDTH = 300;
const ATLAS_HEIGHT = 300;

const FACE_LABELS = ['Rechts', 'Links', 'Oben', 'Unten', 'Vorne', 'Hinten'] as const;
type FaceLabel = (typeof FACE_LABELS)[number];

const FACE_DIRECTIONS: Record<FaceLabel, THREE.Vector3> = {
  Rechts: new THREE.Vector3(1, 0, 0),
  Links: new THREE.Vector3(-1, 0, 0),
  Oben: new THREE.Vector3(0, 1, 0),
  Unten: new THREE.Vector3(0, -1, 0),
  Vorne: new THREE.Vector3(0, 0, 1),
  Hinten: new THREE.Vector3(0, 0, -1)
};

const boxIslands = (): SurfaceUvIsland[] => {
  const geometry = createGeometry(createSceneObject('box'));
  const atlas = getSurfaceUvAtlas(geometry);
  geometry.dispose();
  return atlas.islands;
};

// Baut ein Atlas-Bild, in dem jede benannte Insel ihre eigene Farbe hat.
// Die Pixel-Zuordnung folgt der Editor-Konvention: y = (1 - v) * height.
const buildAtlasPixels = (islands: SurfaceUvIsland[], colors: Map<FaceLabel, [number, number, number]>): Uint8Array => {
  const data = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
  islands.forEach((island) => {
    const color = colors.get(island.label as FaceLabel);
    if (!color) return;
    const minX = Math.floor(island.uMin * ATLAS_WIDTH);
    const maxX = Math.ceil(island.uMax * ATLAS_WIDTH);
    const minY = Math.floor((1 - island.vMax) * ATLAS_HEIGHT);
    const maxY = Math.ceil((1 - island.vMin) * ATLAS_HEIGHT);
    for (let y = minY; y < maxY; y += 1) {
      for (let x = minX; x < maxX; x += 1) {
        const offset = (y * ATLAS_WIDTH + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  });
  return data;
};

const makePaintTextures = (
  islands: SurfaceUvIsland[],
  colors: Map<FaceLabel, [number, number, number]>
): { dataUrl: string; texture: THREE.DataTexture; data: Uint8Array } => {
  const data = buildAtlasPixels(islands, colors);
  const texture = new THREE.DataTexture(data, ATLAS_WIDTH, ATLAS_HEIGHT);
  texture.flipY = true;
  texture.needsUpdate = true;
  return { dataUrl: `paint-${(idCounter += 1)}`, texture, data };
};

const makeBox = (position: Vec3, options: Partial<SceneObjectData> = {}): SceneObjectData => {
  idCounter += 1;
  return {
    ...createSceneObject('box'),
    id: `paint-uv-${idCounter}`,
    position,
    ...options
  };
};

interface FaceSample {
  label: FaceLabel;
  u: number;
  v: number;
  centroid: THREE.Vector3;
}

// Findet Dreiecke, deren Normale in Richtung `dir` zeigt, und liefert ihre
// Flächenmitten-UVs. optionales Positionsfilter grenzt auf einen Körper ein.
const faceSamples = (
  geometry: THREE.BufferGeometry,
  dir: THREE.Vector3,
  within?: (centroid: THREE.Vector3) => boolean
): FaceSample[] => {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  expect(uv).toBeDefined();
  const index = geometry.index;
  const indexAt = (i: number): number => (index ? index.getX(i) : i);
  const count = index ? index.count : position.count;

  const samples: FaceSample[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let start = 0; start + 2 < count; start += 3) {
    const i0 = indexAt(start);
    const i1 = indexAt(start + 1);
    const i2 = indexAt(start + 2);
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();
    if (normal.dot(dir) < 0.9) continue;
    const centroid = a.clone().add(b).add(c).divideScalar(3);
    if (within && !within(centroid)) continue;
    samples.push({
      label: '' as FaceLabel,
      u: (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3,
      v: (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3,
      centroid
    });
  }
  return samples;
};

// Liest die Atlasfarbe an einer UV-Position in Editor-/three.js-Konvention
// (flipY = true: v = 1 → Bildzeile 0).
const sampleAtlas = (data: Uint8Array, u: number, v: number): [number, number, number] => {
  const x = Math.round(u * (ATLAS_WIDTH - 1));
  const y = Math.round((1 - v) * (ATLAS_HEIGHT - 1));
  const offset = (y * ATLAS_WIDTH + x) * 4;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
};

const expectFaceColor = (
  geometry: THREE.BufferGeometry,
  data: Uint8Array,
  face: FaceLabel,
  expectedColor: [number, number, number],
  within?: (centroid: THREE.Vector3) => boolean
): void => {
  const samples = faceSamples(geometry, FACE_DIRECTIONS[face], within);
  expect(samples.length).toBeGreaterThan(0);
  samples.forEach((sample) => {
    expect(sampleAtlas(data, sample.u, sample.v), `UV von ${face} bei (${sample.u.toFixed(3)}, ${sample.v.toFixed(3)})`)
      .toEqual(expectedColor);
  });
};

const ALL_FACE_COLORS = new Map<FaceLabel, [number, number, number]>([
  ['Rechts', [255, 0, 0]],
  ['Links', [0, 255, 0]],
  ['Oben', [0, 0, 255]],
  ['Unten', [255, 255, 0]],
  ['Vorne', [255, 0, 255]],
  ['Hinten', [0, 255, 255]]
]);

const paintBox = (
  box: SceneObjectData,
  colors: Map<FaceLabel, [number, number, number]>,
  textures: Map<string, THREE.Texture>
): Uint8Array => {
  const paint = makePaintTextures(boxIslands(), colors);
  box.material.paintTexture = { dataUrl: paint.dataUrl, width: ATLAS_WIDTH, height: ATLAS_HEIGHT, pixelated: true };
  textures.set(paint.dataUrl, paint.texture);
  return paint.data;
};

describe('Semantische Flächen-UV-Zuordnung nach Union', () => {
  it.each(FACE_LABELS)('unrotierter Quader: %s bleibt nach der Union auf derselben Insel', (face) => {
    const textures = new Map<string, THREE.Texture>();
    const painted = makeBox([0, 0.5, 0]);
    const data = paintBox(painted, ALL_FACE_COLORS, textures);
    const other = makeBox([3, 0.5, 0]);

    const mesh = computeUnionMesh([painted, other], textures);
    expectFaceColor(mesh.geometry, data, face, ALL_FACE_COLORS.get(face)!, (centroid) => centroid.x < 1.5);
  });

  it('überlappende Würfel: erhaltene Außenflächen behalten ihre Insel', () => {
    const textures = new Map<string, THREE.Texture>();
    const painted = makeBox([0, 0.5, 0]);
    const data = paintBox(painted, ALL_FACE_COLORS, textures);
    const other = makeBox([0.75, 0.5, 0]);

    const mesh = computeUnionMesh([painted, other], textures);
    const firstBox = (centroid: THREE.Vector3): boolean => centroid.x < 0.6;
    // Diese Flächen des ersten Würfels bleiben Außenflächen.
    expectFaceColor(mesh.geometry, data, 'Links', ALL_FACE_COLORS.get('Links')!, firstBox);
    expectFaceColor(mesh.geometry, data, 'Oben', ALL_FACE_COLORS.get('Oben')!, firstBox);
    expectFaceColor(mesh.geometry, data, 'Unten', ALL_FACE_COLORS.get('Unten')!, firstBox);
    expectFaceColor(mesh.geometry, data, 'Vorne', ALL_FACE_COLORS.get('Vorne')!, firstBox);
    expectFaceColor(mesh.geometry, data, 'Hinten', ALL_FACE_COLORS.get('Hinten')!, firstBox);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('zwei verschieden bemalte Flächen desselben Körpers behalten beide ihre Insel', () => {
    const textures = new Map<string, THREE.Texture>();
    const painted = makeBox([0, 0.5, 0]);
    const colors = new Map<FaceLabel, [number, number, number]>([
      ['Rechts', [200, 10, 10]],
      ['Oben', [10, 10, 200]]
    ]);
    const data = paintBox(painted, colors, textures);

    const mesh = computeUnionMesh([painted, makeBox([3, 0.5, 0])], textures);
    const firstBox = (centroid: THREE.Vector3): boolean => centroid.x < 1.5;
    expectFaceColor(mesh.geometry, data, 'Rechts', [200, 10, 10], firstBox);
    expectFaceColor(mesh.geometry, data, 'Oben', [10, 10, 200], firstBox);
    // Eine unbemalte Insel bleibt unverändert weiß.
    expectFaceColor(mesh.geometry, data, 'Vorne', [255, 255, 255], firstBox);
  });

  it('bemalter Quader + unbemalter Körper: Bemalung korrekt, zweites Material ohne Map', () => {
    const textures = new Map<string, THREE.Texture>();
    const painted = makeBox([0, 0.5, 0]);
    const data = paintBox(painted, ALL_FACE_COLORS, textures);
    const plain = makeBox([3, 0.5, 0], { material: { ...createSceneObject('box').material, color: '#123456' } });

    const mesh = computeUnionMesh([painted, plain], textures);
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    expect(materials.filter((material) => material.map !== null).length).toBe(1);
    expectFaceColor(mesh.geometry, data, 'Rechts', ALL_FACE_COLORS.get('Rechts')!, (centroid) => centroid.x < 1.5);
    expectFaceColor(mesh.geometry, data, 'Unten', ALL_FACE_COLORS.get('Unten')!, (centroid) => centroid.x < 1.5);
  });

  it('zwei unterschiedlich bemalte Körper behalten jeweils ihre Flächenzuordnung', () => {
    const textures = new Map<string, THREE.Texture>();
    const first = makeBox([0, 0.5, 0]);
    const firstColors = new Map<FaceLabel, [number, number, number]>([['Rechts', [255, 0, 0]]]);
    const firstData = paintBox(first, firstColors, textures);
    const second = makeBox([3, 0.5, 0]);
    const secondColors = new Map<FaceLabel, [number, number, number]>([['Oben', [0, 0, 255]]]);
    const secondData = paintBox(second, secondColors, textures);

    const mesh = computeUnionMesh([first, second], textures);
    expectFaceColor(mesh.geometry, firstData, 'Rechts', [255, 0, 0], (centroid) => centroid.x < 1.5);
    expectFaceColor(mesh.geometry, secondData, 'Oben', [0, 0, 255], (centroid) => centroid.x > 1.5);
  });

  it('skalierter Körper: Bemalung bleibt auf derselben lokalen Fläche', () => {
    const textures = new Map<string, THREE.Texture>();
    const painted = makeBox([0, 1, 0], { scale: [1, 2, 0.5] });
    const data = paintBox(painted, ALL_FACE_COLORS, textures);

    const mesh = computeUnionMesh([painted, makeBox([5, 0.5, 0])], textures);
    const firstBox = (centroid: THREE.Vector3): boolean => centroid.x < 2.5;
    expectFaceColor(mesh.geometry, data, 'Rechts', ALL_FACE_COLORS.get('Rechts')!, firstBox);
    expectFaceColor(mesh.geometry, data, 'Oben', ALL_FACE_COLORS.get('Oben')!, firstBox);
    expectFaceColor(mesh.geometry, data, 'Vorne', ALL_FACE_COLORS.get('Vorne')!, firstBox);
  });

  it.each([
    ['Y', [0, Math.PI / 2, 0] as Vec3],
    ['X', [Math.PI / 2, 0, 0] as Vec3],
    ['Z', [0, 0, Math.PI / 2] as Vec3],
    ['schräg', [0.4, 0.7, 0.2] as Vec3]
  ])('um %s rotierter Körper: Bemalung folgt der lokalen Fläche', (_axis, rotation) => {
    void _axis;
    const textures = new Map<string, THREE.Texture>();
    const painted = makeBox([0, 3, 0], { rotation });
    const data = paintBox(painted, ALL_FACE_COLORS, textures);

    const mesh = computeUnionMesh([painted, makeBox([10, 0.5, 0])], textures);
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    const firstBox = (centroid: THREE.Vector3): boolean => centroid.x < 5;

    FACE_LABELS.forEach((face) => {
      // Die lokale Flächennormale wird mit der Objektrotation in die Welt gedreht.
      const worldDirection = FACE_DIRECTIONS[face].clone().applyQuaternion(quaternion);
      const samples = faceSamples(mesh.geometry, worldDirection, firstBox);
      expect(samples.length, `Fläche ${face}`).toBeGreaterThan(0);
      samples.forEach((sample) => {
        expect(sampleAtlas(data, sample.u, sample.v), `Fläche ${face}`).toEqual(ALL_FACE_COLORS.get(face)!);
      });
    });
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });
});

describe('UV-Semantik im exportierten GLB', () => {
  interface GltfJson {
    buffers?: Array<{ uri: string; byteLength: number }>;
    bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number }>;
    accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }>;
    meshes?: Array<{ primitives?: Array<{ attributes: Record<string, number>; indices?: number; material?: number }> }>;
  }

  const COMPONENT_SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  const readAccessor = (json: GltfJson, buffer: Buffer, accessorIndex: number): Float64Array => {
    const accessor = json.accessors![accessorIndex]!;
    const view = json.bufferViews![accessor.bufferView!]!;
    const components = COMPONENT_SIZES[accessor.type]!;
    const elementSize = components * (accessor.componentType === 5126 ? 4 : accessor.componentType === 5125 ? 4 : 2);
    const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const values = new Float64Array(accessor.count * components);
    for (let index = 0; index < accessor.count * components; index += 1) {
      const offset = base + index * (accessor.componentType === 5126 ? 4 : accessor.componentType === 5125 ? 4 : 2);
      if (accessor.componentType === 5126) values[index] = buffer.readFloatLE(offset);
      else if (accessor.componentType === 5125) values[index] = buffer.readUInt32LE(offset);
      else values[index] = buffer.readUInt16LE(offset);
      void elementSize;
    }
    return values;
  };

  const exportAndRead = async (objects: SceneObjectData[]): Promise<{ json: GltfJson; buffer: Buffer }> => {
    const mesh = computeUnionMesh(objects);
    mesh.updateMatrixWorld(true);
    const group = new THREE.Group();
    group.add(mesh);
    const exporter = new GLTFExporter();
    const json = await exporter.parseAsync(group, { binary: false, onlyVisible: true }) as GltfJson;
    const uri = json.buffers![0]!.uri;
    const buffer = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    return { json, buffer };
  };

  it('TEXCOORD_0 der resultierenden Außenflächen liegt in der korrekten Atlas-Insel', async () => {
    const painted = makeBox([0, 0.5, 0]);
    const plain = makeBox([3, 0.5, 0]);
    const { json, buffer } = await exportAndRead([painted, plain]);

    expect(json.meshes?.length).toBe(1);
    const islands = boxIslands();
    const primitives = json.meshes![0]!.primitives!;
    expect(primitives.length).toBeGreaterThan(0);

    const samples: Array<{ face: FaceLabel; u: number; v: number }> = [];
    primitives.forEach((primitive) => {
      const positions = readAccessor(json, buffer, primitive.attributes.POSITION!);
      const uvs = readAccessor(json, buffer, primitive.attributes.TEXCOORD_0!);
      const indices = primitive.indices !== undefined
        ? readAccessor(json, buffer, primitive.indices)
        : Float64Array.from({ length: positions.length / 3 }, (_, index) => index);

      for (let start = 0; start + 2 < indices.length; start += 3) {
        const [i0, i1, i2] = [indices[start]!, indices[start + 1]!, indices[start + 2]!];
        const ax = positions[i0 * 3]!; const ay = positions[i0 * 3 + 1]!; const az = positions[i0 * 3 + 2]!;
        const bx = positions[i1 * 3]!; const by = positions[i1 * 3 + 1]!; const bz = positions[i1 * 3 + 2]!;
        const cx = positions[i2 * 3]!; const cy = positions[i2 * 3 + 1]!; const cz = positions[i2 * 3 + 2]!;
        const normal = new THREE.Vector3(bx - ax, by - ay, bz - az).cross(new THREE.Vector3(cx - ax, cy - ay, cz - az));
        if (normal.lengthSq() < 1e-12) continue;
        normal.normalize();
        // Nur Dreiecke des ersten (unrotierten) Würfels auswerten.
        const centroidX = (ax + bx + cx) / 3;
        if (centroidX > 1.5) continue;
        const face = FACE_LABELS.find((label) => normal.dot(FACE_DIRECTIONS[label]) > 0.9);
        if (!face) continue;
        samples.push({
          face,
          u: (uvs[i0 * 2]! + uvs[i1 * 2]! + uvs[i2 * 2]!) / 3,
          v: (uvs[i0 * 2 + 1]! + uvs[i1 * 2 + 1]! + uvs[i2 * 2 + 1]!) / 3
        });
      }
    });

    // Jede der sechs Flächen muss im GLB in ihrer eigenen Insel liegen.
    FACE_LABELS.forEach((face) => {
      const island = islands.find((entry) => entry.label === face)!;
      const faceSamplesForIsland = samples.filter((sample) => sample.face === face);
      expect(faceSamplesForIsland.length, `Fläche ${face}`).toBeGreaterThan(0);
      faceSamplesForIsland.forEach((sample) => {
        expect(sample.u, `${face}: u`).toBeGreaterThanOrEqual(island.uMin - 1e-4);
        expect(sample.u, `${face}: u`).toBeLessThanOrEqual(island.uMax + 1e-4);
        expect(sample.v, `${face}: v`).toBeGreaterThanOrEqual(island.vMin - 1e-4);
        expect(sample.v, `${face}: v`).toBeLessThanOrEqual(island.vMax + 1e-4);
      });
    });
  });
});
