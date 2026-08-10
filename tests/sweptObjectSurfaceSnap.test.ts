import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import { findAppleCutterSurfaceSnap } from '../src/editor/appleCutter/appleCutterSnap';
import { surfaceSnapTargetFromSceneObject } from '../src/editor/snapping/objectSurfaceSnap';
import {
  minimumSurfaceProjection,
  transformSurfaceSupportPoints
} from '../src/editor/snapping/surfaceSupport';
import {
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from '../src/editor/snapping/surfaceSnapTopology';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { PrimitiveType, SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;
const START_GAP = 0.05;
const CROSSING_DISTANCE = 0.8;
const THIN_DIMENSION = 0.0001;

const withPosition = (object: SceneObjectData, position: Vec3): SceneObjectData => ({
  ...object,
  position
});

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Welt-Bounds für ${object.type}.`);
  return bounds;
}

function requiredTarget(object: SceneObjectData) {
  const target = surfaceSnapTargetFromSceneObject(object);
  if (!target) throw new Error(`Keine Snap-Topologie für ${object.type}.`);
  return target;
}

function worldAnchors(object: SceneObjectData): SurfaceSnapAnchor[] {
  const target = requiredTarget(object);
  return transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
}

function bestOpposingPair(
  source: SceneObjectData,
  target: SceneObjectData
): { sourceAnchor: SurfaceSnapAnchor; targetAnchor: SurfaceSnapAnchor } {
  const sourceAnchors = worldAnchors(source);
  const targetAnchors = worldAnchors(target);
  let bestSource: SurfaceSnapAnchor | null = null;
  let bestTarget: SurfaceSnapAnchor | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const targetAnchor of targetAnchors) {
    for (const sourceAnchor of sourceAnchors) {
      const alignment = sourceAnchor.normal.dot(targetAnchor.normal);
      if (alignment > -0.12) continue;
      const cardinality = Math.max(
        Math.abs(targetAnchor.normal.x),
        Math.abs(targetAnchor.normal.y),
        Math.abs(targetAnchor.normal.z)
      );
      const score = (1 + alignment) * 100 + (1 - cardinality);
      if (score >= bestScore) continue;
      bestScore = score;
      bestSource = sourceAnchor;
      bestTarget = targetAnchor;
    }
  }

  if (!bestSource?.id || !bestTarget?.id) {
    throw new Error(`Kein gegengerichtetes Punktpaar für ${source.type} zu ${target.type}.`);
  }
  return { sourceAnchor: bestSource, targetAnchor: bestTarget };
}

function translatedObject(
  object: SceneObjectData,
  translation: THREE.Vector3
): SceneObjectData {
  return withPosition(object, [
    object.position[0] + translation.x,
    object.position[1] + translation.y,
    object.position[2] + translation.z
  ]);
}

function physicalSupportProjection(
  object: SceneObjectData,
  normal: THREE.Vector3
): number {
  const target = requiredTarget(object);
  const localSupport = target.supportPoints?.length
    ? target.supportPoints
    : target.anchors.map((anchor) => anchor.position);
  return minimumSurfaceProjection(
    transformSurfaceSupportPoints(localSupport, target.matrixWorld),
    normal
  );
}

function crossingSetup(sourceType: PrimitiveType, targetType: PrimitiveType) {
  const target = createSceneObject(targetType);
  target.id = `target-${targetType}`;
  const initialSource = createSceneObject(sourceType);
  initialSource.id = `source-${sourceType}`;
  const pair = bestOpposingPair(initialSource, target);
  const targetNormal = pair.targetAnchor.normal.clone().normalize();
  const movementDirection = targetNormal.clone().negate();

  const anchorDelta = pair.targetAnchor.position.clone().sub(pair.sourceAnchor.position);
  const tangentialTranslation = anchorDelta.sub(
    targetNormal.clone().multiplyScalar(anchorDelta.dot(targetNormal))
  );
  let previous = translatedObject(initialSource, tangentialTranslation);
  const targetProjection = pair.targetAnchor.position.dot(targetNormal);
  const currentProjection = physicalSupportProjection(previous, targetNormal);
  previous = translatedObject(
    previous,
    targetNormal.clone().multiplyScalar(
      START_GAP - (currentProjection - targetProjection)
    )
  );
  const candidate = translatedObject(
    previous,
    movementDirection.clone().multiplyScalar(CROSSING_DISTANCE)
  );

  return {
    target,
    previous,
    candidate,
    movementDirection
  };
}

function boxGapSetup(gap: number) {
  const target = createSceneObject('box');
  target.id = 'target-box';
  const targetBounds = requiredBounds(target);

  const source = createSceneObject('box');
  source.id = 'source-box';
  const sourceBounds = requiredBounds(source);
  const previous = withPosition(source, [
    source.position[0] + targetBounds.min.x - gap - sourceBounds.max.x,
    source.position[1],
    source.position[2]
  ]);

  return { target, previous };
}

function expectUnchanged(
  candidate: SceneObjectData,
  result: ReturnType<typeof findAppleCutterSurfaceSnap>
) {
  expect(result.targetId).toBeNull();
  expect(result.position[0]).toBeCloseTo(candidate.position[0], 6);
  expect(result.position[1]).toBeCloseTo(candidate.position[1], 6);
  expect(result.position[2]).toBeCloseTo(candidate.position[2], 6);
}

function expectPhysicalContact(
  source: SceneObjectData,
  target: SceneObjectData,
  movementDirection: THREE.Vector3,
  result: ReturnType<typeof findAppleCutterSurfaceSnap>
): void {
  const sourceTarget = requiredTarget(withPosition(source, result.position));
  const targetTarget = requiredTarget(target);
  const targetAnchor = transformSurfaceSnapAnchors(
    targetTarget.anchors,
    targetTarget.matrixWorld
  ).find((anchor) => anchor.id === result.targetAnchorId);
  expect(targetAnchor).toBeDefined();
  if (!targetAnchor) return;

  const targetSize = targetTarget.localBounds.getSize(new THREE.Vector3());
  const targetNormal = Math.min(targetSize.x, targetSize.y, targetSize.z) <= THIN_DIMENSION
    ? movementDirection.clone().negate()
    : targetAnchor.normal;
  const localSupport = sourceTarget.supportPoints?.length
    ? sourceTarget.supportPoints
    : sourceTarget.anchors.map((anchor) => anchor.position);
  const worldSupport = transformSurfaceSupportPoints(localSupport, sourceTarget.matrixWorld);

  expect(minimumSurfaceProjection(worldSupport, targetNormal))
    .toBeCloseTo(targetAnchor.position.dot(targetNormal), 4);
}

function expectStopsDuringCrossing(
  previous: SceneObjectData,
  candidate: SceneObjectData,
  movementDirection: THREE.Vector3,
  resultPosition: Vec3
): void {
  const previousProgress = new THREE.Vector3(...previous.position).dot(movementDirection);
  const candidateProgress = new THREE.Vector3(...candidate.position).dot(movementDirection);
  const resultProgress = new THREE.Vector3(...resultPosition).dot(movementDirection);

  expect(resultProgress).toBeGreaterThanOrEqual(previousProgress - 0.00001);
  expect(resultProgress).toBeLessThan(candidateProgress - 0.00001);
}

describe.each(['Desktop', 'Android'])('durchgängiger Formen-Snap auf %s', (platform) => {
  void platform;

  it.each([
    ['Kugel zu Würfel', 'sphere', 'box'],
    ['Kugel zu Zylinder', 'sphere', 'cylinder']
  ] as const)('stoppt %s beim Durchqueren', (_label, sourceType, targetType) => {
    const setup = crossingSetup(sourceType, targetType);
    const result = findAppleCutterSurfaceSnap(
      setup.candidate,
      [setup.previous, setup.target],
      STEP
    );

    expect(result.targetId).toBe(setup.target.id);
    expectStopsDuringCrossing(
      setup.previous,
      setup.candidate,
      setup.movementDirection,
      result.position
    );
    expectPhysicalContact(
      setup.candidate,
      setup.target,
      setup.movementDirection,
      result
    );
  });

  it('gibt den Kontakt beim nächsten Ziehschritt tief in die Form frei', () => {
    const setup = crossingSetup('sphere', 'box');
    const first = findAppleCutterSurfaceSnap(
      setup.candidate,
      [setup.previous, setup.target],
      STEP
    );
    expect(first.targetId).toBe(setup.target.id);

    // Aus dem akzeptierten Kontakt heraus tief in den Körper gezogen:
    // kein erneutes Festklemmen an der bereits überwundenen Fläche.
    const snappedPrevious = withPosition(setup.candidate, first.position);
    const deeperCandidate = translatedObject(
      snappedPrevious,
      setup.movementDirection.clone().multiplyScalar(STEP * 2)
    );
    const second = findAppleCutterSurfaceSnap(
      deeperCandidate,
      [snappedPrevious, setup.target],
      STEP
    );

    expect(second.targetId).toBeNull();
    expect(second.position[0]).toBeCloseTo(deeperCandidate.position[0], 6);
    expect(second.position[1]).toBeCloseTo(deeperCandidate.position[1], 6);
    expect(second.position[2]).toBeCloseTo(deeperCandidate.position[2], 6);
  });

  it('hält den Kontakt beim Verweilen innerhalb des Fangbands', () => {
    const setup = crossingSetup('sphere', 'box');
    const first = findAppleCutterSurfaceSnap(
      setup.candidate,
      [setup.previous, setup.target],
      STEP
    );
    expect(first.targetId).toBe(setup.target.id);

    // Nur ein kleines Stück über die Fläche hinaus (innerhalb des Fangbands):
    // der Kontakt bleibt magnetisch bestehen.
    const snappedPrevious = withPosition(setup.candidate, first.position);
    const hoverCandidate = translatedObject(
      snappedPrevious,
      setup.movementDirection.clone().multiplyScalar(STEP * 0.2)
    );
    const second = findAppleCutterSurfaceSnap(
      hoverCandidate,
      [snappedPrevious, setup.target],
      STEP
    );

    expect(second.targetId).toBe(setup.target.id);
    expectPhysicalContact(
      hoverCandidate,
      setup.target,
      setup.movementDirection,
      second
    );
  });

  it('lässt ein eingerastetes Element wieder von der Fläche wegziehen', () => {
    const { target, previous } = boxGapSetup(0);
    const candidate = withPosition(previous, [
      previous.position[0] - 0.35,
      previous.position[1],
      previous.position[2]
    ]);

    expectUnchanged(candidate, findAppleCutterSurfaceSnap(candidate, [previous, target], STEP));
  });

  it('lässt ein Element nahe an einer Fläche seitlich vorbeiziehen', () => {
    const { target, previous } = boxGapSetup(0.05);
    const candidate = withPosition(previous, [
      previous.position[0],
      previous.position[1] + 0.4,
      previous.position[2]
    ]);

    expectUnchanged(candidate, findAppleCutterSurfaceSnap(candidate, [previous, target], STEP));
  });

  it('greift bei bloßer Nähe außerhalb der Kontaktzone nicht ein', () => {
    const { target, previous } = boxGapSetup(0.35);
    const candidate = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);

    expectUnchanged(candidate, findAppleCutterSurfaceSnap(candidate, [previous, target], STEP));
  });

  it('rastet bei gezielter Annäherung innerhalb der Kontaktzone ein', () => {
    const { target, previous } = boxGapSetup(0.2);
    const candidate = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const result = findAppleCutterSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectPhysicalContact(candidate, target, new THREE.Vector3(1, 0, 0), result);
  });

  it('stoppt beim Durchziehen nacheinander an den inneren Apfelschneider-Linien', () => {
    const target = withPosition(createSceneObject('box'), [0, 0.5, 0]);
    target.id = 'target-box';
    const source = createSceneObject('box');
    source.id = 'source-box';

    // Stop-Raster: Ziel-Anker x ∈ {-0.5, -0.375, -0.125, 0.125, 0.375, 0.5},
    // Quell-Offsets ebenso → Quellmittelpunkte im 0.125-Raster von -1 bis 1
    // (1.0 → 0.125 + 0.25 + 0.25 + 0.25 + 0.125).
    const STOP_STEP = 0.125;
    const isStop = (x: number) => {
      const k = Math.round((x + 1) / STOP_STEP);
      return k >= 0 && k <= 16 && Math.abs(x - (-1 + k * STOP_STEP)) < 1e-6;
    };

    const snappedPositions: number[] = [];
    let previous = withPosition(source, [-1.6, 0.5, 0]);
    for (let step = 1; step <= 64; step += 1) {
      const candidate = withPosition(source, [-1.6 + step * 0.05, 0.5, 0]);
      const result = findAppleCutterSurfaceSnap(candidate, [previous, target], STEP);
      if (result.targetId === target.id) snappedPositions.push(result.position[0]);
      previous = withPosition(source, result.position);
    }

    // Außen-Snap an der Wand plus mehrere innere Linien werden getroffen,
    // jeder Stop liegt auf dem Apfelschneider-Raster.
    expect(snappedPositions.length).toBeGreaterThan(0);
    for (const x of snappedPositions) {
      expect(isStop(x)).toBe(true);
    }
    expect(snappedPositions.some((x) => Math.abs(x - -1) < 1e-6)).toBe(true);
    expect(new Set(snappedPositions.map((x) => Math.round((x + 1) / STOP_STEP))).size)
      .toBeGreaterThanOrEqual(4);

    // Vollständiger Durchzug: die letzte Position folgt frei der Rohbewegung.
    expect(previous.position[0]).toBeCloseTo(1.6, 6);
  });
});

describe('gleiche Durchquerungsbedingung für alle Elemente', () => {
  it.each(SHAPE_DEFINITIONS)("stoppt '$label' als bewegtes Element auf einer Apfelschneider-Bahn", ({ type }) => {
    const setup = crossingSetup(type, 'box');
    const result = findAppleCutterSurfaceSnap(
      setup.candidate,
      [setup.previous, setup.target],
      STEP
    );

    expect(result.targetId).toBe(setup.target.id);
    expectStopsDuringCrossing(
      setup.previous,
      setup.candidate,
      setup.movementDirection,
      result.position
    );
    expectPhysicalContact(
      setup.candidate,
      setup.target,
      setup.movementDirection,
      result
    );
  });

  it.each(SHAPE_DEFINITIONS)("stoppt eine Kugel an '$label' auf einer Apfelschneider-Bahn", ({ type }) => {
    const setup = crossingSetup('sphere', type);
    const result = findAppleCutterSurfaceSnap(
      setup.candidate,
      [setup.previous, setup.target],
      STEP
    );

    expect(result.targetId).toBe(setup.target.id);
    expectStopsDuringCrossing(
      setup.previous,
      setup.candidate,
      setup.movementDirection,
      result.position
    );
    expectPhysicalContact(
      setup.candidate,
      setup.target,
      setup.movementDirection,
      result
    );
  });
});
