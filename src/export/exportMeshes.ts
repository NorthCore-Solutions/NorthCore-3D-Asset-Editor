import * as THREE from 'three';
import type { SceneObjectData } from '../types/editor';
import type { ExportResources } from './exportTypes';
import { createExportMaterial } from './exportMaterials';
import { createWorldGeometry } from './worldGeometry';
import { isUnionEligible } from './exportInspection';
import { evaluateUnionBrushes } from './union/unionCsg';
import { normalizeUnionGeometry, unionMaterials } from './union/unionValidation';

export function addSeparateMesh(
  group: THREE.Group,
  object: SceneObjectData,
  resources: ExportResources,
  paintTextures: Map<string, THREE.Texture>
): void {
  const geometry = createWorldGeometry(object, false);
  const material = createExportMaterial(object, paintTextures);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = object.name;
  resources.geometries.add(geometry);
  resources.materials.add(material);
  group.add(mesh);
}

function addUnionResult(
  group: THREE.Group,
  result: import('three-bvh-csg').Brush,
  resources: ExportResources
): void {
  const materials = unionMaterials(result);
  materials.forEach((material) => resources.materials.add(material));

  const geometry = normalizeUnionGeometry(result.geometry);
  if (!geometry) throw new Error('Die Union hat keine exportierbare Geometrie erzeugt.');
  resources.geometries.add(geometry);

  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = 'Union';
  group.add(mesh);
}

export function addUnionMeshes(
  group: THREE.Group,
  objects: SceneObjectData[],
  resources: ExportResources,
  paintTextures: Map<string, THREE.Texture>
): void {
  const unionObjects = objects.filter(isUnionEligible);
  const separateObjects = objects.filter((object) => !isUnionEligible(object));

  if (unionObjects.length < 2) {
    objects.forEach((object) => addSeparateMesh(group, object, resources, paintTextures));
    return;
  }

  const result = evaluateUnionBrushes(unionObjects, paintTextures, resources);
  addUnionResult(group, result, resources);
  separateObjects.forEach((object) => addSeparateMesh(group, object, resources, paintTextures));
}
