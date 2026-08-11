import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { computeMeshVolume } from 'three-bvh-csg';
import { isWaterTight } from 'three-bvh-csg/src/utils/isWaterTight.js';
import { computeUnionMesh, inspectExport } from '../src/export/exportScene';
import { createGeometry, createSceneObject } from '../src/geometry/factory';
import type { PaintTextureData, PrimitiveType, SceneObjectData, Vec3 } from '../src/types/editor';

let idCounter = 0;

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

const makeBox = (position: Vec3, options: { rotation?: Vec3; scale?: Vec3; color?: string } = {}): SceneObjectData => {
  idCounter += 1;
  return {
    id: `union-test-${idCounter}`,
    name: `Würfel ${idCounter}`,
    type: 'box',
    visible: true,
    locked: false,
    position,
    rotation: options.rotation ?? [0, 0, 0],
    scale: options.scale ?? [1, 1, 1],
    geometry: { width: 1, height: 1, depth: 1 },
    material: {
      color: options.color ?? '#AEB8BE',
      roughness: 0.8,
      metalness: 0,
      opacity: 1,
      flatShading: false
    }
  };
};

const triangleCount = (geometry: THREE.BufferGeometry): number => (
  (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
);

const unionMesh = (objects: SceneObjectData[], paintTextures?: Map<string, THREE.Texture>): THREE.Mesh => {
  const mesh = computeUnionMesh(objects, paintTextures);
  mesh.updateMatrixWorld(true);
  return mesh;
};

const meshVolume = (object: SceneObjectData): number => {
  const geometry = createGeometry(object);
  const volume = computeMeshVolume(new THREE.Mesh(geometry));
  geometry.dispose();
  return volume;
};

// Alle erzeugbaren Formtypen außer 'plane'. Diese Liste ist der verbindliche
// Prüfstand für die begründete Typdefinition im Export (NON_SOLID_TYPES).
const SOLID_TYPES: PrimitiveType[] = [
  'box', 'cuboid', 'sphere', 'hemisphere', 'cylinder', 'cone', 'pyramid', 'torus', 'wedge', 'prism',
  'wall', 'floor', 'flatRoof', 'gableRoof', 'shedRoof', 'door', 'window', 'column', 'chimney', 'stairs'
];

const makePaintTexture = (dataUrl: string): PaintTextureData => ({
  dataUrl,
  width: 2,
  height: 2,
  pixelated: true
});

const makeDataTexture = (rgba: [number, number, number, number]): THREE.DataTexture => {
  const texture = new THREE.DataTexture(new Uint8Array([...rgba, ...rgba, ...rgba, ...rgba]), 2, 2);
  texture.needsUpdate = true;
  return texture;
};

const meshMaterials = (mesh: THREE.Mesh): THREE.MeshStandardMaterial[] => (
  (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]
);

describe('Union geschlossener Grundformen', () => {
  it('vereinigt zwei überlappende Würfel zu einem wasserdichten Mesh', () => {
    const mesh = unionMesh([makeBox([0, 0.5, 0]), makeBox([0.75, 0.5, 0])]);
    expect(computeMeshVolume(mesh)).toBeCloseTo(1.75, 4);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('vereinigt zwei exakt Fläche-an-Fläche liegende Würfel ohne interne Kontaktflächen', () => {
    const mesh = unionMesh([makeBox([0, 0.5, 0]), makeBox([1, 0.5, 0])]);
    expect(computeMeshVolume(mesh)).toBeCloseTo(2, 4);
    // 24 Dreiecke zweier Würfel abzüglich der 4 Dreiecke der gemeinsamen Kontaktflächen.
    expect(triangleCount(mesh.geometry)).toBe(20);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('behandelt winzige numerische Abweichungen an Kontaktflächen wie Aneinanderliegen', () => {
    const mesh = unionMesh([makeBox([0, 0.5, 0]), makeBox([1 + 1e-9, 0.5, 0])]);
    expect(computeMeshVolume(mesh)).toBeCloseTo(2, 4);
    expect(triangleCount(mesh.geometry)).toBe(20);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('vereinigt aneinanderliegende Quader mit unterschiedlicher Skalierung', () => {
    const mesh = unionMesh([
      makeBox([0, 1, 0], { scale: [1, 2, 0.5] }),
      makeBox([0.75, 0.5, 0], { scale: [0.5, 1, 1] })
    ]);
    expect(computeMeshVolume(mesh)).toBeCloseTo(1.5, 4);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('vereinigt gedrehte und skalierte überlappende Körper', () => {
    const mesh = unionMesh([
      makeBox([0, 0.5, 0]),
      makeBox([0.6, 0.5, 0], { rotation: [0, 0.7, 0], scale: [1, 0.5, 0.8] })
    ]);
    const volume = computeMeshVolume(mesh);
    expect(volume).toBeGreaterThan(1);
    expect(volume).toBeLessThan(1.8);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('liefert bei mehrachsig gedrehten Körpern ein volumenkorrektes Einzel-Mesh', () => {
    const mesh = unionMesh([
      makeBox([0, 0.5, 0]),
      makeBox([0.6, 0.8, 0], { rotation: [0.4, 0.7, 0.2], scale: [1, 0.5, 0.8] })
    ]);
    // Das Volumen der Vereinigung bleibt auch bei beliebigen Raumdrehungen korrekt.
    expect(computeMeshVolume(mesh)).toBeCloseTo(1.2648, 3);
  });

  it('vereinigt drei aneinanderliegende Formen zu einem Körper', () => {
    const mesh = unionMesh([
      makeBox([0, 0.5, 0]),
      makeBox([1, 0.5, 0]),
      makeBox([2, 0.5, 0])
    ]);
    expect(computeMeshVolume(mesh)).toBeCloseTo(3, 4);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('verschmilzt deutlich getrennte Formen nicht fälschlich', () => {
    const mesh = unionMesh([makeBox([0, 0.5, 0]), makeBox([3, 0.5, 0])]);
    expect(computeMeshVolume(mesh)).toBeCloseTo(2, 4);
    // Keine Kontaktflächen: beide geschlossenen Hüllen bleiben vollständig erhalten.
    expect(triangleCount(mesh.geometry)).toBe(24);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });
});

describe('Export des Union-Ergebnisses', () => {
  const exportJson = async (objects: SceneObjectData[]): Promise<{ meshes?: unknown[]; nodes?: Array<{ mesh?: number }> }> => {
    const group = new THREE.Group();
    group.add(unionMesh(objects));
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(group, { binary: false, onlyVisible: true });
    return result as { meshes?: unknown[]; nodes?: Array<{ mesh?: number }> };
  };

  it('exportiert die Union gleicher Materialien als genau ein Mesh-Objekt', async () => {
    const json = await exportJson([makeBox([0, 0.5, 0]), makeBox([0.75, 0.5, 0])]);
    expect(json.meshes?.length).toBe(1);
    expect(json.nodes?.filter((node) => node.mesh !== undefined).length).toBe(1);
  });

  it('behält das UV-Attribut durch die Union bis in den GLB-Export', async () => {
    const json = await exportJson([makeBox([0, 0.5, 0]), makeBox([0.75, 0.5, 0])]) as {
      meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
    };
    const primitives = json.meshes?.[0]?.primitives ?? [];
    expect(primitives.length).toBeGreaterThan(0);
    primitives.forEach((primitive) => {
      expect(primitive.attributes?.TEXCOORD_0).toBeDefined();
    });
  });

  it('exportiert die Union unterschiedlicher Materialien als ein Mesh mit Materialgruppen', async () => {
    const json = await exportJson([
      makeBox([0, 0.5, 0], { color: '#ff0000' }),
      makeBox([0.75, 0.5, 0], { color: '#00ff00' })
    ]) as { meshes?: Array<{ primitives?: unknown[] }>; nodes?: Array<{ mesh?: number }> };
    expect(json.meshes?.length).toBe(1);
    expect(json.nodes?.filter((node) => node.mesh !== undefined).length).toBe(1);
    expect(json.meshes?.[0]?.primitives?.length).toBe(2);
  });
});

describe('Geometrie-Audit aller Formtypen', () => {
  it.each(SOLID_TYPES)('%s erzeugt einen geschlossenen, wasserdichten Volumenkörper mit UVs', (type) => {
    const geometry = createGeometry(createSceneObject(type));
    expect(isWaterTight(geometry)).toBe(true);
    expect(computeMeshVolume(new THREE.Mesh(geometry))).toBeGreaterThan(0);
    expect(geometry.getAttribute('uv')).toBeDefined();
    geometry.dispose();
  });

  it('plane ist eine beidseitige Fläche ohne Volumen und daher nicht union-fähig', () => {
    const geometry = createGeometry(createSceneObject('plane'));
    expect(Math.abs(computeMeshVolume(new THREE.Mesh(geometry)))).toBeLessThan(1e-9);
    geometry.dispose();
    expect(inspectExport([createSceneObject('plane')], null, false, 'union').unionEligible).toBe(0);
  });
});

describe('Union-Eignung', () => {
  it.each(SOLID_TYPES)('%s ist union-fähig', (type) => {
    expect(inspectExport([createSceneObject(type)], null, false, 'union').unionEligible).toBe(1);
  });

  it('bemalte geschlossene Formen sind union-fähig', () => {
    const painted = makeBox([0, 0.5, 0]);
    painted.material.paintTexture = makePaintTexture('paint-a');
    expect(inspectExport([painted], null, false, 'union').unionEligible).toBe(1);
  });

  it('vollständig transparente Objekte sind nicht union-fähig', () => {
    const transparent = makeBox([0, 0.5, 0]);
    transparent.material.opacity = 0;
    expect(inspectExport([transparent], null, false, 'union').unionEligible).toBe(0);
  });
});

describe('Union aller geschlossenen Formtypen', () => {
  it.each(SOLID_TYPES)('%s bildet mit einem Quader eine wasserdichte Union mit UVs', (type) => {
    const box = makeBox([0, 0.5, 0]);
    const other = { ...createSceneObject(type), position: [0, 0, 0] as Vec3 };
    const mesh = unionMesh([box, other]);

    const boxVolume = meshVolume(box);
    const otherVolume = meshVolume(other);
    const volume = computeMeshVolume(mesh);
    expect(volume).toBeGreaterThan(Math.max(boxVolume, otherVolume) - 1e-6);
    expect(volume).toBeLessThan(boxVolume + otherVolume + 1e-6);
    expect(isWaterTight(mesh.geometry)).toBe(true);
    expect(mesh.geometry.getAttribute('uv')).toBeDefined();
  });

  it('vereinigt Halbkugel und Quader mit Überlappung', () => {
    const cuboid = { ...createSceneObject('cuboid'), position: [0, 0.5, 0] as Vec3 };
    const hemisphere = { ...createSceneObject('hemisphere'), position: [0, 0, 0] as Vec3 };
    const mesh = unionMesh([cuboid, hemisphere]);

    const volume = computeMeshVolume(mesh);
    expect(volume).toBeGreaterThan(Math.max(meshVolume(cuboid), meshVolume(hemisphere)));
    expect(volume).toBeLessThan(meshVolume(cuboid) + meshVolume(hemisphere));
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('vereinigt eine exakt auf einem Quader stehende Halbkugel ohne Volumenverlust', () => {
    const cuboid = { ...createSceneObject('cuboid'), position: [0, 0.5, 0] as Vec3 };
    // Die Grundfläche der Halbkugel (Radius 0,75) liegt exakt auf der
    // Deckfläche des Quaders (2 x 1) auf – reine Kontaktfläche ohne Überlappung.
    const hemisphere = { ...createSceneObject('hemisphere'), position: [0, 1, 0] as Vec3 };
    const mesh = unionMesh([cuboid, hemisphere]);

    expect(computeMeshVolume(mesh)).toBeCloseTo(meshVolume(cuboid) + meshVolume(hemisphere), 3);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('vereinigt gedrehte und skalierte Halbkugeln mit Quadern', () => {
    const cuboid = { ...createSceneObject('cuboid'), position: [0, 0.5, 0] as Vec3 };
    const hemisphere = {
      ...createSceneObject('hemisphere'),
      position: [0.4, 0.3, 0.2] as Vec3,
      rotation: [0.3, 0.8, 0.1] as Vec3,
      scale: [1.2, 0.8, 1] as Vec3
    };
    const mesh = unionMesh([cuboid, hemisphere]);
    expect(computeMeshVolume(mesh)).toBeGreaterThan(meshVolume(cuboid));
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });
});

describe('Union bemalter Formen', () => {
  it('vereinigt zwei bemalte Formen zu einem Mesh mit beiden Paint-Texturen', () => {
    const first = makeBox([0, 0.5, 0]);
    first.material.paintTexture = makePaintTexture('paint-a');
    const second = makeBox([0.75, 0.5, 0]);
    second.material.paintTexture = makePaintTexture('paint-b');
    const textures = new Map<string, THREE.Texture>([
      ['paint-a', makeDataTexture([255, 0, 0, 255])],
      ['paint-b', makeDataTexture([0, 255, 0, 255])]
    ]);

    const mesh = unionMesh([first, second], textures);
    const materials = meshMaterials(mesh);
    expect(materials.length).toBe(2);
    const maps = materials.map((material) => material.map);
    expect(maps.every((map) => map !== null)).toBe(true);
    expect(new Set(maps).size).toBe(2);
    expect(computeMeshVolume(mesh)).toBeCloseTo(1.75, 4);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('vereinigt bemalte und unbemalte Formen in einem Mesh', () => {
    const painted = makeBox([0, 0.5, 0]);
    painted.material.paintTexture = makePaintTexture('paint-a');
    const plain = makeBox([0.75, 0.5, 0], { color: '#2244cc' });
    const textures = new Map<string, THREE.Texture>([['paint-a', makeDataTexture([255, 0, 0, 255])]]);

    const mesh = unionMesh([painted, plain], textures);
    const materials = meshMaterials(mesh);
    expect(materials.length).toBe(2);
    expect(materials.filter((material) => material.map !== null).length).toBe(1);
    const plainMaterial = materials.find((material) => material.map === null);
    expect(plainMaterial?.color.getHexString()).toBe('2244cc');
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('behält die Paint-UVs auf den erhaltenen Oberflächen', () => {
    const painted = makeBox([0, 0.5, 0]);
    painted.material.paintTexture = makePaintTexture('paint-a');
    const other = makeBox([0.75, 0.5, 0]);
    other.material.paintTexture = makePaintTexture('paint-b');

    const mesh = unionMesh([painted, other]);
    const uv = mesh.geometry.getAttribute('uv');
    expect(uv).toBeDefined();
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let index = 0; index < uv.count; index += 1) {
      minU = Math.min(minU, uv.getX(index));
      maxU = Math.max(maxU, uv.getX(index));
      minV = Math.min(minV, uv.getY(index));
      maxV = Math.max(maxV, uv.getY(index));
    }
    // Der Oberflächenatlas verteilt die Flächen auf Inseln; die UVs dürfen
    // durch die CSG-Pipeline nicht verloren gehen oder auf null kollabieren.
    expect(maxU - minU).toBeGreaterThan(0.2);
    expect(maxV - minV).toBeGreaterThan(0.2);
  });

  it('entfernt gemeinsame Innenflächen auch bei bemalten Formen', () => {
    const first = makeBox([0, 0.5, 0]);
    first.material.paintTexture = makePaintTexture('paint-a');
    const second = makeBox([1, 0.5, 0]);
    second.material.paintTexture = makePaintTexture('paint-b');

    const mesh = unionMesh([first, second]);
    expect(computeMeshVolume(mesh)).toBeCloseTo(2, 4);
    // 24 Dreiecke zweier Würfel abzüglich der 4 Dreiecke der gemeinsamen
    // Kontaktflächen – innen liegende bemalte Flächen bleiben nicht erhalten.
    expect(triangleCount(mesh.geometry)).toBe(20);
    expect(isWaterTight(mesh.geometry)).toBe(true);
  });

  it('vereinigt bemalte gedrehte und skalierte Formen', () => {
    const first = makeBox([0, 0.5, 0]);
    first.material.paintTexture = makePaintTexture('paint-a');
    const second = makeBox([0.6, 0.5, 0], { rotation: [0, 0.7, 0], scale: [1, 0.5, 0.8] });
    second.material.paintTexture = makePaintTexture('paint-b');

    const mesh = unionMesh([first, second]);
    const volume = computeMeshVolume(mesh);
    expect(volume).toBeGreaterThan(1);
    expect(volume).toBeLessThan(1.8);
    expect(isWaterTight(mesh.geometry)).toBe(true);
    expect(mesh.geometry.getAttribute('uv')).toBeDefined();
  });
});
