import type * as THREE from 'three';
import { transformSurfaceSnapAnchors, type SurfaceSnapAnchor } from './surfaceSnapTopology';
import type { ObjectSurfaceSnapResult, SurfaceSnapTarget } from './objectSurfaceSnapTypes';

const EPSILON = 0.000001;

function expandedWorldBounds(target: SurfaceSnapTarget, amount: number): THREE.Box3 {
  return target.localBounds.clone().applyMatrix4(target.matrixWorld).expandByScalar(amount);
}

function hashCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function hashKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function buildAnchorHash(
  anchors: readonly SurfaceSnapAnchor[],
  cellSize: number
): Map<string, SurfaceSnapAnchor[]> {
  const hash = new Map<string, SurfaceSnapAnchor[]>();
  for (const anchor of anchors) {
    const key = hashKey(
      hashCoordinate(anchor.position.x, cellSize),
      hashCoordinate(anchor.position.y, cellSize),
      hashCoordinate(anchor.position.z, cellSize)
    );
    const bucket = hash.get(key);
    if (bucket) bucket.push(anchor);
    else hash.set(key, [anchor]);
  }
  return hash;
}

function nearbyAnchors(
  hash: Map<string, SurfaceSnapAnchor[]>,
  position: THREE.Vector3,
  cellSize: number
): SurfaceSnapAnchor[] {
  const centerX = hashCoordinate(position.x, cellSize);
  const centerY = hashCoordinate(position.y, cellSize);
  const centerZ = hashCoordinate(position.z, cellSize);
  const result: SurfaceSnapAnchor[] = [];

  for (let x = centerX - 1; x <= centerX + 1; x += 1) {
    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
      for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
        const bucket = hash.get(hashKey(x, y, z));
        if (bucket) result.push(...bucket);
      }
    }
  }
  return result;
}

function anchorsCanMeet(source: SurfaceSnapAnchor, target: SurfaceSnapAnchor): boolean {
  return source.normal.dot(target.normal) <= -0.12;
}

export function findSurfaceTargetSnap(
  sourceTarget: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  sourcePosition: THREE.Vector3,
  worldThreshold: number = 0.12
): ObjectSurfaceSnapResult {
  const unchanged: ObjectSurfaceSnapResult = {
    position: [sourcePosition.x, sourcePosition.y, sourcePosition.z],
    targetId: null,
    distance: Number.POSITIVE_INFINITY,
    sourceAnchorId: null,
    targetAnchorId: null
  };
  const sourceWorldAnchors = transformSurfaceSnapAnchors(
    sourceTarget.anchors,
    sourceTarget.matrixWorld
  );
  const sourceWorldBounds = expandedWorldBounds(sourceTarget, worldThreshold);
  let bestCorrection: THREE.Vector3 | null = null;
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestNormalAlignment = Number.POSITIVE_INFINITY;
  let bestSourceAnchorId: string | null = null;
  let bestTargetAnchorId: string | null = null;
  let bestContactNormal: THREE.Vector3 | null = null;

  for (const target of targets) {
    if (
      target.id === sourceTarget.id
      || !target.visible
      || target.anchors.length === 0
      || !sourceWorldBounds.intersectsBox(expandedWorldBounds(target, worldThreshold))
    ) continue;

    const targetWorldAnchors = transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
    const targetHash = buildAnchorHash(targetWorldAnchors, worldThreshold);

    for (const sourceAnchor of sourceWorldAnchors) {
      for (const targetAnchor of nearbyAnchors(targetHash, sourceAnchor.position, worldThreshold)) {
        const correction = targetAnchor.position.clone().sub(sourceAnchor.position);
        const distance = correction.length();
        if (distance > worldThreshold + EPSILON) continue;
        if (!anchorsCanMeet(sourceAnchor, targetAnchor)) continue;

        const normalAlignment = sourceAnchor.normal.dot(targetAnchor.normal);
        const betterDistance = distance < bestDistance - EPSILON;
        const equalDistanceBetterNormals = Math.abs(distance - bestDistance) <= EPSILON
          && normalAlignment < bestNormalAlignment;
        if (!betterDistance && !equalDistanceBetterNormals) continue;

        bestCorrection = correction;
        bestTargetId = target.id;
        bestDistance = distance;
        bestNormalAlignment = normalAlignment;
        bestSourceAnchorId = sourceAnchor.id ?? null;
        bestTargetAnchorId = targetAnchor.id ?? null;
        bestContactNormal = targetAnchor.normal.clone();
      }
    }
  }

  if (!bestCorrection || !bestContactNormal) return unchanged;
  const snappedPosition = sourcePosition.clone().add(bestCorrection);
  return {
    position: [snappedPosition.x, snappedPosition.y, snappedPosition.z],
    targetId: bestTargetId,
    distance: bestDistance,
    sourceAnchorId: bestSourceAnchorId,
    targetAnchorId: bestTargetAnchorId,
    contactNormal: [bestContactNormal.x, bestContactNormal.y, bestContactNormal.z]
  };
}
