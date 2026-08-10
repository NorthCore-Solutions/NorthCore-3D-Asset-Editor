import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  createTranslationSurfaceSnapSession,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession
} from '../src/editor/snapping/translationSurfaceSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;

function withPosition(object: SceneObjectData, position: Vec3): SceneObjectData {
  return { ...object, position };
}

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Welt-Bounds für ${object.type}.`);
  return bounds;
}

function sphereToBoxGap(gap: number): {
  source: SceneObjectData;
  target: SceneObjectData;
  targetBounds: THREE.Box3;
} {
  const target = createSceneObject('box');
  target.id = 'target-box';
  const targetBounds = requiredBounds(target);
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());

  const sphere = createSceneObject('sphere');
  sphere.id = 'source-sphere';
  const sphereBounds = requiredBounds(sphere);
  const sphereCenter = sphereBounds.getCenter(new THREE.Vector3());
  const aligned = withPosition(sphere, [
    sphere.position[0],
    sphere.position[1] + targetCenter.y - sphereCenter.y,
    sphere.position[2] + targetCenter.z - sphereCenter.z
  ]);
  const alignedBounds = requiredBounds(aligned);
  const source = withPosition(aligned, [
    aligned.position[0] + targetBounds.min.x - gap - alignedBounds.max.x,
    aligned.position[1],
    aligned.position[2]
  ]);

  return { source, target, targetBounds };
}

describe.each(['Maus', 'Touch'])('gemeinsamer Formen-Snap für %s', () => {
  it('erkennt den Apfelschneider-Kontakt über denselben Solver', () => {
    const { source, target, targetBounds } = sphereToBoxGap(0.2);
    const candidate = withPosition(source, [
      source.position[0] + 0.15,
      source.position[1],
      source.position[2]
    ]);
    const resolution = resolveTranslationSurfaceSnap(
      candidate,
      [source, target],
      STEP,
      candidate.position,
      createTranslationSurfaceSnapSession()
    );

    expect(resolution.result.targetId).toBe(target.id);
    expect(resolution.result.targetAnchorId).toBeTruthy();
    expect(requiredBounds(withPosition(candidate, resolution.result.position)).max.x)
      .toBeCloseTo(targetBounds.min.x, 4);
  });

  it('hält einen Kontakt bei kleinen kontinuierlichen Rohbewegungen', () => {
    const session: TranslationSurfaceSnapSession = {
      active: {
        targetId: 'target-box',
        targetAnchorId: 'target-anchor',
        sourceAnchorId: 'source-anchor',
        captureRawPosition: [1, 2, 3],
        acceptedPosition: [0.75, 2, 3],
        normal: [-1, 0, 0]
      },
      previousCompositeTarget: null
    };
    const source = createSceneObject('box');
    source.position = [0.8, 2, 3];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [1.08, 2, 3],
      session
    );

    expect(resolution.result.targetId).toBe('target-box');
    expect(resolution.result.position).toEqual([0.75, 2, 3]);
    expect(resolution.session.active).not.toBeNull();
  });

  it('gibt den Kontakt nach Verlassen des Fangbereichs ohne Blockade frei', () => {
    const session: TranslationSurfaceSnapSession = {
      active: {
        targetId: 'target-box',
        targetAnchorId: 'target-anchor',
        sourceAnchorId: 'source-anchor',
        captureRawPosition: [1, 2, 3],
        acceptedPosition: [0.75, 2, 3],
        normal: [-1, 0, 0]
      },
      previousCompositeTarget: null
    };
    const source = createSceneObject('box');
    source.position = [1.25, 2, 3];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [1.25, 2, 3],
      session
    );

    expect(resolution.result.targetId).toBeNull();
    expect(resolution.result.position).toEqual(source.position);
    expect(resolution.session.active).toBeNull();
    expect(resolution.session).toEqual({
      active: null,
      previousCompositeTarget: null
    });
  });
});
