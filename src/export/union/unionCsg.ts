import * as THREE from 'three';
import { ADDITION, Brush, Evaluator } from 'three-bvh-csg';
import type { SceneObjectData } from '../../types/editor';
import type { ExportResources } from '../exportTypes';
import { createExportMaterial } from '../exportMaterials';
import { createWorldGeometry } from '../worldGeometry';
import { isUnionEligible } from '../exportInspection';
import { isGeometryWaterTight, unmatchedEdgeCount } from './csgAdapter';
import { hasConsistentUvs, normalizeUnionGeometry, unionMaterials } from './unionValidation';

function evaluateUnionStep(evaluator: Evaluator, a: Brush, b: Brush): Brush {
  const candidates: Brush[] = [];
  const accept = (candidate: Brush): Brush => {
    candidates.forEach((rejected) => rejected.geometry.dispose());
    candidates.length = 0;
    return candidate;
  };

  const legacyResult: Brush = evaluator.evaluate(a, b, ADDITION);
  legacyResult.updateMatrixWorld(true);
  if (isGeometryWaterTight(legacyResult.geometry) && hasConsistentUvs(legacyResult, [a, b])) {
    return legacyResult;
  }
  candidates.push(legacyResult);

  evaluator.useCDTClipping = true;
  try {
    for (const [first, second] of [[a, b], [b, a]] as const) {
      const cdtResult: Brush = evaluator.evaluate(first, second, ADDITION);
      cdtResult.updateMatrixWorld(true);
      if (isGeometryWaterTight(cdtResult.geometry) && hasConsistentUvs(cdtResult, [a, b])) {
        return accept(cdtResult);
      }
      candidates.push(cdtResult);
    }
  } finally {
    evaluator.useCDTClipping = false;
  }

  candidates.sort((left, right) => {
    const edgeDifference = unmatchedEdgeCount(left.geometry) - unmatchedEdgeCount(right.geometry);
    if (edgeDifference !== 0) return edgeDifference;
    return Number(hasConsistentUvs(right, [a, b])) - Number(hasConsistentUvs(left, [a, b]));
  });
  return accept(candidates[0]!);
}

export function evaluateUnionBrushes(
  unionObjects: SceneObjectData[],
  paintTextures: Map<string, THREE.Texture>,
  resources?: ExportResources
): Brush {
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal', 'uv'];
  evaluator.useGroups = true;

  let result: Brush | null = null;

  for (const object of unionObjects) {
    const geometry = createWorldGeometry(object, true);
    const material = createExportMaterial(object, paintTextures);
    const brush = new Brush(geometry, material);
    brush.name = object.name;
    brush.updateMatrixWorld(true);
    resources?.geometries.add(geometry);
    resources?.materials.add(material);

    if (!result) {
      result = brush;
      continue;
    }

    const nextResult = evaluateUnionStep(evaluator, result, brush);
    if (resources) {
      resources.geometries.add(nextResult.geometry);
      unionMaterials(nextResult).forEach((resultMaterial) => resources.materials.add(resultMaterial));
    }
    result = nextResult;
  }

  if (!result) throw new Error('Es konnten keine Volumenkörper für die Union vorbereitet werden.');
  return result;
}

export function computeUnionMesh(
  objects: SceneObjectData[],
  paintTextures: Map<string, THREE.Texture> = new Map()
): THREE.Mesh {
  const unionObjects = objects.filter(isUnionEligible);
  if (unionObjects.length < 2) {
    throw new Error('Union benötigt mindestens zwei geschlossene Volumenkörper.');
  }

  const result = evaluateUnionBrushes(unionObjects, paintTextures);
  const materials = unionMaterials(result);
  const geometry = normalizeUnionGeometry(result.geometry);
  if (!geometry) throw new Error('Die Union hat keine exportierbare Geometrie erzeugt.');

  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = 'Union';
  return mesh;
}
