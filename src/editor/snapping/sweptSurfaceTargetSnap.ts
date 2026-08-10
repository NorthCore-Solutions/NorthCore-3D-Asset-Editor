import * as THREE from 'three';
import type {
  ObjectSurfaceSnapResult,
  SurfaceSnapTarget
} from './objectSurfaceSnap';
import {
  minimumSurfaceProjection,
  transformSurfaceSupportPoints
} from './surfaceSupport';
import {
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from './surfaceSnapTopology';

const EPSILON = 0.000001;
const MIN_APPROACH_ALIGNMENT = 0.12;
const MAX_CAPTURE_DISTANCE = 0.12;
const MAX_TANGENTIAL_TOLERANCE = 0.16;
const THIN_DIMENSION = 0.0001;
const AT_SURFACE_DISTANCE = 0.001;

interface SweepCandidate {
  position: [number, number, number];
  targetId: string;
  distance: number;
  travel: number;
  lateralDistance: number;
  normalAlignment: number;
  sourceAnchorId: string | null;
  targetAnchorId: string | null;
  contactNormal: [number, number, number];
}

export interface SweptSurfaceTargetSnapOptions {
  ignoredTargetAnchorId?: string | null;
}

interface ContactNormals {
  source: THREE.Vector3;
  target: THREE.Vector3;
}

function hashCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function hashKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function normalKey(normal: THREE.Vector3): string {
  return [normal.x, normal.y, normal.z]
    .map((value) => value.toFixed(5))
    .join(':');
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

function anchorsInsideBounds(
  hash: Map<string, SurfaceSnapAnchor[]>,
  bounds: THREE.Box3,
  cellSize: number
): SurfaceSnapAnchor[] {
  const minimumX = hashCoordinate(bounds.min.x, cellSize);
  const minimumY = hashCoordinate(bounds.min.y, cellSize);
  const minimumZ = hashCoordinate(bounds.min.z, cellSize);
  const maximumX = hashCoordinate(bounds.max.x, cellSize);
  const maximumY = hashCoordinate(bounds.max.y, cellSize);
  const maximumZ = hashCoordinate(bounds.max.z, cellSize);
  const result: SurfaceSnapAnchor[] = [];

  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        const bucket = hash.get(hashKey(x, y, z));
        if (bucket) result.push(...bucket);
      }
    }
  }
  return result;
}

function worldBounds(target: SurfaceSnapTarget, padding: number): THREE.Box3 {
  return target.localBounds.clone()
    .applyMatrix4(target.matrixWorld)
    .expandByScalar(padding);
}

function isThinTarget(target: SurfaceSnapTarget): boolean {
  const size = target.localBounds.getSize(new THREE.Vector3());
  return Math.min(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)) <= THIN_DIMENSION;
}

function betterCandidate(
  candidate: SweepCandidate,
  current: SweepCandidate | null
): boolean {
  if (!current) return true;
  if (candidate.lateralDistance < current.lateralDistance - EPSILON) return true;
  if (Math.abs(candidate.lateralDistance - current.lateralDistance) > EPSILON) return false;
  if (candidate.travel < current.travel - EPSILON) return true;
  if (Math.abs(candidate.travel - current.travel) > EPSILON) return false;
  return candidate.normalAlignment < current.normalAlignment;
}

function contactNormals(
  sourceAnchor: SurfaceSnapAnchor,
  targetAnchor: SurfaceSnapAnchor,
  direction: THREE.Vector3,
  sourceIsThin: boolean,
  targetIsThin: boolean
): ContactNormals {
  return {
    source: sourceIsThin ? direction.clone() : sourceAnchor.normal,
    target: targetIsThin ? direction.clone().negate() : targetAnchor.normal
  };
}

function opposingAndApproaching(
  normals: ContactNormals,
  direction: THREE.Vector3
): boolean {
  if (normals.source.dot(normals.target) > -0.12) return false;
  return direction.dot(normals.source) >= MIN_APPROACH_ALIGNMENT
    && direction.dot(normals.target) <= -MIN_APPROACH_ALIGNMENT;
}

export function findSweptSurfaceTargetSnap(
  previousSource: SurfaceSnapTarget,
  currentSource: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  positionStep: number,
  options: SweptSurfaceTargetSnapOptions = {}
): ObjectSurfaceSnapResult | null {
  if (
    previousSource.id !== currentSource.id
    || previousSource.anchors.length === 0
    || previousSource.anchors.length !== currentSource.anchors.length
  ) return null;

  const previousCenter = new THREE.Vector3().setFromMatrixPosition(previousSource.matrixWorld);
  const currentCenter = new THREE.Vector3().setFromMatrixPosition(currentSource.matrixWorld);
  const movement = currentCenter.clone().sub(previousCenter);
  const movementLength = movement.length();
  if (movementLength <= EPSILON) return null;
  const direction = movement.clone().divideScalar(movementLength);

  const previousAnchors = transformSurfaceSnapAnchors(
    previousSource.anchors,
    previousSource.matrixWorld
  );
  const currentAnchors = transformSurfaceSnapAnchors(
    currentSource.anchors,
    currentSource.matrixWorld
  );
  const supportSource = currentSource.supportPoints?.length
    ? currentSource.supportPoints
    : currentSource.anchors.map((anchor) => anchor.position);
  const currentSupportPoints = transformSurfaceSupportPoints(
    supportSource,
    currentSource.matrixWorld
  );
  const supportProjectionCache = new Map<string, number>();
  const captureDistance = Math.min(
    MAX_CAPTURE_DISTANCE,
    Math.max(0.04, Math.abs(positionStep) * 0.4)
  );
  const tangentialTolerance = Math.min(
    MAX_TANGENTIAL_TOLERANCE,
    Math.max(0.07, Math.abs(positionStep) * 0.55)
  );
  const hashCellSize = Math.max(0.08, tangentialTolerance);
  const broadPhasePadding = tangentialTolerance + captureDistance;
  const sourceIsThin = isThinTarget(currentSource);
  let best: SweepCandidate | null = null;

  for (const target of targets) {
    if (
      !target.visible
      || target.id === currentSource.id
      || target.anchors.length === 0
    ) continue;

    const targetIsThin = isThinTarget(target);
    const targetAnchors = transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
    const targetHash = buildAnchorHash(targetAnchors, hashCellSize);
    const expandedTargetBounds = worldBounds(target, broadPhasePadding);

    for (let index = 0; index < currentAnchors.length; index += 1) {
      const currentAnchor = currentAnchors[index];
      const previousAnchor = previousAnchors[index];
      if (!currentAnchor || !previousAnchor) continue;

      const segmentBounds = new THREE.Box3()
        .setFromPoints([previousAnchor.position, currentAnchor.position])
        .expandByScalar(broadPhasePadding);
      if (!segmentBounds.intersectsBox(expandedTargetBounds)) continue;
      segmentBounds.intersect(expandedTargetBounds);

      for (const targetAnchor of anchorsInsideBounds(targetHash, segmentBounds, hashCellSize)) {
        if (
          options.ignoredTargetAnchorId
          && targetAnchor.id === options.ignoredTargetAnchorId
        ) continue;

        const normals = contactNormals(
          currentAnchor,
          targetAnchor,
          direction,
          sourceIsThin,
          targetIsThin
        );
        if (!opposingAndApproaching(normals, direction)) continue;

        const projectionKey = normalKey(normals.target);
        let currentSupportProjection = supportProjectionCache.get(projectionKey);
        if (currentSupportProjection === undefined) {
          currentSupportProjection = minimumSurfaceProjection(
            currentSupportPoints,
            normals.target
          );
          supportProjectionCache.set(projectionKey, currentSupportProjection);
        }
        const targetProjection = targetAnchor.position.dot(normals.target);
        const currentSeparation = currentSupportProjection - targetProjection;
        const previousSeparation = currentSeparation - movement.dot(normals.target);
        const separationChange = currentSeparation - previousSeparation;
        if (separationChange >= -EPSILON) continue;
        if (previousSeparation < -captureDistance - EPSILON) continue;
        if (currentSeparation > captureDistance + EPSILON) continue;
        // Kein erneutes Festklemmen hinter der Fläche: Lag die Quelle bereits
        // auf der Fläche (akzeptierter Kontakt), rastet sie nur innerhalb des
        // Fangbands wieder ein; dahinter bleibt der Weg in den Körper frei.
        if (
          previousSeparation <= AT_SURFACE_DISTANCE
          && currentSeparation < -captureDistance - EPSILON
        ) continue;

        const approachAlongTargetNormal = direction.dot(normals.target);
        if (approachAlongTargetNormal >= -MIN_APPROACH_ALIGNMENT) continue;

        const correctionAlongMovement = -currentSeparation / approachAlongTargetNormal;
        const contactPoint = currentAnchor.position.clone()
          .addScaledVector(direction, correctionAlongMovement);
        const contactDelta = contactPoint.sub(targetAnchor.position);
        const normalComponent = normals.target.clone()
          .multiplyScalar(contactDelta.dot(normals.target));
        const lateralDistance = contactDelta.sub(normalComponent).length();
        if (lateralDistance > tangentialTolerance + EPSILON) continue;

        const denominator = previousSeparation - currentSeparation;
        const rawTravel = denominator > EPSILON
          ? previousSeparation / denominator
          : 1;
        const travel = THREE.MathUtils.clamp(rawTravel, 0, 1);
        const correctedCenter = currentCenter.clone()
          .addScaledVector(direction, correctionAlongMovement);
        const candidate: SweepCandidate = {
          position: [correctedCenter.x, correctedCenter.y, correctedCenter.z],
          targetId: target.id,
          distance: Math.abs(correctionAlongMovement),
          travel,
          lateralDistance,
          normalAlignment: normals.source.dot(normals.target),
          sourceAnchorId: currentAnchor.id ?? null,
          targetAnchorId: targetAnchor.id ?? null,
          contactNormal: [normals.target.x, normals.target.y, normals.target.z]
        };
        if (betterCandidate(candidate, best)) best = candidate;
      }
    }
  }

  return best
    ? {
      position: best.position,
      targetId: best.targetId,
      distance: best.distance,
      sourceAnchorId: best.sourceAnchorId,
      targetAnchorId: best.targetAnchorId,
      contactNormal: best.contactNormal
    }
    : null;
}
