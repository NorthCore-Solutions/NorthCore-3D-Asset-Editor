import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  findSurfaceTargetSnap,
  isSuppressedSurfaceAnchor,
  type ObjectSurfaceSnapResult,
  type SuppressedSurfaceContact,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findSweptObjectSurfaceSnap } from './sweptObjectSurfaceSnap';
import { findSweptSurfaceTargetSnap } from './sweptSurfaceTargetSnap';

const RELEASE_DISTANCE = 0.14;
const REARM_DISTANCE = 0.35;
const MAX_WORLD_THRESHOLD = 0.12;

export interface TranslationSurfaceSnapContact {
  targetId: string;
  targetAnchorId: string | null;
  sourceAnchorId: string | null;
  captureRawPosition: Vec3;
  acceptedPosition: Vec3;
  /** Weltnormale des Kontakts; null nur bei alt gespeicherten Sitzungen. */
  normal: Vec3 | null;
}

export type TranslationSurfaceSnapSuppression = SuppressedSurfaceContact & {
  rawOrigin: Vec3;
};

export interface TranslationSurfaceSnapSession {
  active: TranslationSurfaceSnapContact | null;
  suppressed: TranslationSurfaceSnapSuppression | null;
  previousCompositeTarget: SurfaceSnapTarget | null;
}

export interface TranslationSurfaceSnapResolution {
  result: ObjectSurfaceSnapResult;
  session: TranslationSurfaceSnapSession;
}

export function createTranslationSurfaceSnapSession(): TranslationSurfaceSnapSession {
  return {
    active: null,
    suppressed: null,
    previousCompositeTarget: null
  };
}

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  );
}

function unchanged(position: Vec3): ObjectSurfaceSnapResult {
  return {
    position: [...position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY,
    sourceAnchorId: null,
    targetAnchorId: null,
    contactNormal: null
  };
}

function heldResolution(
  active: TranslationSurfaceSnapContact,
  heldPosition: Vec3,
  previousCompositeTarget: SurfaceSnapTarget | null
): TranslationSurfaceSnapResolution {
  return {
    result: {
      position: heldPosition,
      targetId: active.targetId,
      distance: 0,
      sourceAnchorId: active.sourceAnchorId,
      targetAnchorId: active.targetAnchorId,
      contactNormal: active.normal
    },
    session: {
      active,
      suppressed: null,
      previousCompositeTarget
    }
  };
}

function holdOrReleaseContact(
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession
): {
  held: TranslationSurfaceSnapResolution | null;
  active: TranslationSurfaceSnapContact | null;
  suppressed: TranslationSurfaceSnapSuppression | null;
} {
  let active = currentSession.active;
  let suppressed = currentSession.suppressed;

  if (active?.normal) {
    const normal = new THREE.Vector3(...active.normal);
    const delta = new THREE.Vector3(...rawPosition)
      .sub(new THREE.Vector3(...active.captureRawPosition));
    const normalDelta = delta.dot(normal);
    const tangential = delta.clone().addScaledVector(normal, -normalDelta);

    if (
      Math.abs(normalDelta) <= RELEASE_DISTANCE
      && tangential.length() <= RELEASE_DISTANCE
    ) {
      // Nur die Normalen-Komponente rastet ein; die Tangentialbewegung
      // folgt weiterhin der Rohposition und wird nicht eingefroren.
      const heldPosition = new THREE.Vector3(...active.acceptedPosition)
        .add(tangential);
      return {
        held: heldResolution(
          active,
          [heldPosition.x, heldPosition.y, heldPosition.z],
          currentSession.previousCompositeTarget
        ),
        active,
        suppressed: null
      };
    }

    // Nur ein Durchdrücken in den Körper hinein unterdrückt die Kontaktfläche,
    // damit Nachbar-Anker derselben Fläche nicht sofort wieder einrasten.
    // Wegziehen und tangentiales Gleiten bleiben ohne Unterdrückung frei.
    suppressed = normalDelta < -RELEASE_DISTANCE
      ? {
        targetId: active.targetId,
        normal: [...active.normal] as Vec3,
        rawOrigin: [...rawPosition] as Vec3
      }
      : null;
    active = null;
  } else if (active) {
    if (distance(rawPosition, active.captureRawPosition) <= RELEASE_DISTANCE) {
      return {
        held: heldResolution(
          active,
          [...active.acceptedPosition] as Vec3,
          currentSession.previousCompositeTarget
        ),
        active,
        suppressed: null
      };
    }
    active = null;
  }

  if (suppressed && distance(rawPosition, suppressed.rawOrigin) >= REARM_DISTANCE) {
    suppressed = null;
  }
  return { held: null, active, suppressed };
}

function capturedResolution(
  snapped: ObjectSurfaceSnapResult | null,
  rawPosition: Vec3,
  unchangedPosition: Vec3,
  suppressed: TranslationSurfaceSnapSuppression | null,
  previousCompositeTarget: SurfaceSnapTarget | null
): TranslationSurfaceSnapResolution {
  if (!snapped?.targetId) {
    return {
      result: unchanged(unchangedPosition),
      session: {
        active: null,
        suppressed,
        previousCompositeTarget
      }
    };
  }

  const active: TranslationSurfaceSnapContact = {
    targetId: snapped.targetId,
    targetAnchorId: snapped.targetAnchorId ?? null,
    sourceAnchorId: snapped.sourceAnchorId ?? null,
    captureRawPosition: [...rawPosition] as Vec3,
    acceptedPosition: [...snapped.position] as Vec3,
    normal: snapped.contactNormal ?? null
  };
  return {
    result: snapped,
    session: {
      active,
      suppressed: null,
      previousCompositeTarget
    }
  };
}

function compositeTargetAtPosition(
  target: SurfaceSnapTarget,
  position: Vec3
): SurfaceSnapTarget {
  const matrixWorld = target.matrixWorld.clone();
  matrixWorld.setPosition(position[0], position[1], position[2]);
  return {
    ...target,
    matrixWorld
  };
}

function compositeDistances(value: number): {
  positionStep: number;
  worldThreshold: number;
} {
  const magnitude = Math.max(0.0001, Math.abs(value));
  if (magnitude > MAX_WORLD_THRESHOLD) {
    return {
      positionStep: magnitude,
      worldThreshold: Math.min(
        MAX_WORLD_THRESHOLD,
        Math.max(0.04, magnitude * 0.4)
      )
    };
  }

  return {
    positionStep: Math.max(0.1, magnitude / 0.4),
    worldThreshold: magnitude
  };
}

/** Gemeinsame magnetische Freigabelogik für einzelne Formen auf Maus und Touch. */
export function resolveTranslationSurfaceSnap(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): TranslationSurfaceSnapResolution {
  const contact = holdOrReleaseContact(rawPosition, currentSession);
  if (contact.held) return contact.held;

  const snapped = findSweptObjectSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets,
    { suppressedContact: contact.suppressed }
  );
  return capturedResolution(
    snapped,
    rawPosition,
    source.position,
    contact.suppressed,
    null
  );
}

function suppressCompositeTargetAnchors(
  targets: readonly SurfaceSnapTarget[],
  suppressed: TranslationSurfaceSnapSuppression | null
): readonly SurfaceSnapTarget[] {
  if (!suppressed) return targets;
  return targets.map((target) => {
    if (target.id !== suppressed.targetId) return target;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(target.matrixWorld);
    return {
      ...target,
      anchors: target.anchors.filter((anchor) => (
        !isSuppressedSurfaceAnchor(
          target.id,
          anchor.normal.clone().applyMatrix3(normalMatrix).normalize(),
          suppressed
        )
      ))
    };
  });
}

/**
 * Dieselbe Hysterese für das äußere Raster einer Gruppe oder eines Imports.
 * Der zuletzt akzeptierte Composite-Zustand liegt direkt in der Drag-Sitzung;
 * dadurch hängt der Sweep nicht von React-Renderständen ab.
 *
 * Der fünfte Parameter akzeptiert aus Kompatibilitätsgründen sowohl den
 * bisherigen Fangabstand als auch direkt den Bewegungsraster-Schritt.
 */
export function resolveCompositeTranslationSurfaceSnap(
  sourceTarget: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession,
  thresholdOrPositionStep: number = MAX_WORLD_THRESHOLD
): TranslationSurfaceSnapResolution {
  const contact = holdOrReleaseContact(rawPosition, currentSession);
  if (contact.held) return contact.held;

  const filteredTargets = suppressCompositeTargetAnchors(targets, contact.suppressed);
  const sourcePosition = new THREE.Vector3().setFromMatrixPosition(sourceTarget.matrixWorld);
  const distances = compositeDistances(thresholdOrPositionStep);
  const swept = currentSession.previousCompositeTarget
    ? findSweptSurfaceTargetSnap(
      currentSession.previousCompositeTarget,
      sourceTarget,
      filteredTargets,
      distances.positionStep,
      { suppressedContact: contact.suppressed }
    )
    : null;
  const nearby = swept ?? findSurfaceTargetSnap(
    sourceTarget,
    filteredTargets,
    sourcePosition,
    distances.worldThreshold
  );
  const snapped = nearby.targetId ? nearby : null;
  const acceptedPosition = snapped?.position
    ?? [sourcePosition.x, sourcePosition.y, sourcePosition.z] as Vec3;
  const acceptedTarget = compositeTargetAtPosition(sourceTarget, acceptedPosition);

  return capturedResolution(
    snapped,
    rawPosition,
    acceptedPosition,
    contact.suppressed,
    acceptedTarget
  );
}
