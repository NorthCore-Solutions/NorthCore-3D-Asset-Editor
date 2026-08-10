import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { computeMeshVolume } from 'three-bvh-csg';
import { isWaterTight } from 'three-bvh-csg/src/utils/isWaterTight.js';
import { computeUnionMesh } from '../src/export/exportScene';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

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

const unionMesh = (objects: SceneObjectData[]): THREE.Mesh => {
  const mesh = computeUnionMesh(objects);
  mesh.updateMatrixWorld(true);
  return mesh;
};

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

  it('exportiert die Union unterschiedlicher Materialien als ein Mesh mit Materialgruppen', async () => {
    const json = await exportJson([
      makeBox([0, 0.5, 0], { color: '#ff0000' }),
      makeBox([0.75, 0.5, 0], { color: '#00ff00' })
    ]) as { meshes?: Array<{ primitives?: unknown[] }>; nodes?: Array<{ mesh?: number }> };
    expect(json.meshes?.length).toBe(1);
    expect(json.nodes?.filter((node) => node.mesh !== undefined).length).toBe(1);
    expect((json.meshes?.[0]?.primitives?.length ?? 0) >= 1).toBe(true);
  });
});
