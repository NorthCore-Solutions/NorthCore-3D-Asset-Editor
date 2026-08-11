import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { SceneObjectData } from '../types/editor';
import { safeFilename } from '../persistence/projectFile';
import type { ExportGeometryMode, ExportResources } from './exportTypes';
import { loadPaintTextures } from './exportMaterials';
import { addSeparateMesh, addUnionMeshes } from './exportMeshes';

export async function exportGlb(
  objects: SceneObjectData[],
  filename: string,
  geometryMode: ExportGeometryMode = 'separate'
): Promise<Blob> {
  const group = new THREE.Group();
  const resources: ExportResources = {
    geometries: new Set<THREE.BufferGeometry>(),
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>()
  };

  try {
    const paintTextures = await loadPaintTextures(objects);
    paintTextures.forEach((texture) => resources.textures.add(texture));

    if (geometryMode === 'union') {
      addUnionMeshes(group, objects, resources, paintTextures);
    } else {
      objects.forEach((object) => addSeparateMesh(group, object, resources, paintTextures));
    }

    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(group, { binary: true, onlyVisible: true });
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('Der binäre GLB-Export hat kein ArrayBuffer erzeugt.');
    }

    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(filename)}.glb`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return blob;
  } catch (error) {
    if (geometryMode === 'union') {
      const reason = error instanceof Error ? error.message : 'unbekannter Geometriefehler';
      throw new Error(`Union fehlgeschlagen: ${reason}`);
    }
    throw error;
  } finally {
    resources.geometries.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
    resources.textures.forEach((texture) => texture.dispose());
  }
}
