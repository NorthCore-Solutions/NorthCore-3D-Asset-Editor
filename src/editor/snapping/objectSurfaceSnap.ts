import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import type { ObjectSurfaceSnapResult, SurfaceSnapTarget } from './objectSurfaceSnapTypes';
import { surfaceSnapTargetFromSceneObject } from './objectSurfaceTargets';
import { findSurfaceTargetSnap } from './surfaceTargetSnap';

export type {
  ObjectSurfaceSnapResult,
  SurfaceSnapTarget,
  ImportedObjectSnapAnalysis
} from './objectSurfaceSnapTypes';
export {
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObjects,
  analyzeImportedObject3DSnapTargets
} from './objectSurfaceTargets';
export { findSurfaceTargetSnap } from './surfaceTargetSnap';

export function findObjectSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const sourceTarget = surfaceSnapTargetFromSceneObject(source);
  if (!sourceTarget) {
    return {
      position: [...source.position] as Vec3,
      targetId: null,
      distance: Number.POSITIVE_INFINITY,
      sourceAnchorId: null,
      targetAnchorId: null
    };
  }
  const threshold = Math.min(0.12, Math.max(0.04, Math.abs(positionStep) * 0.4));
  const targets = [
    ...objects.flatMap((object) => {
      const target = surfaceSnapTargetFromSceneObject(object);
      return target ? [target] : [];
    }),
    ...additionalTargets
  ];
  return findSurfaceTargetSnap(
    sourceTarget,
    targets,
    new THREE.Vector3(...source.position),
    threshold
  );
}

export function snapObjectToObjectSurfaces(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): Vec3 {
  return findObjectSurfaceSnap(source, objects, positionStep, additionalTargets).position;
}
