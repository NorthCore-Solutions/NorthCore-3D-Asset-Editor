import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  isScaleAxisHandleVisible,
  SCALE_AXIS_HIDE_THRESHOLD
} from '../src/editor/viewport/scaleAxisHandleVisibility';

// Sichtbarkeitsregel der Skalier-Achspfeile: Pro Achse ist genau der
// kameraseitig erreichbare Pfeil sichtbar; beim Drehen der Kamera wechselt
// die Seite. Bei nahezu axialem Blick wird die Achse ausgeblendet
// (analog zur Ausblendung der Verschiebe-Pfeile der TransformControls).
const eyeFrom = (cameraPosition: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 =>
  cameraPosition.clone().sub(target).normalize();

const POSITIVE = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1)
};

describe('Seitenwahl der Skalier-Achspfeile', () => {
  it('zeigt in normaler Ansicht maximal einen Pfeil je Achse', () => {
    const eye = eyeFrom(new THREE.Vector3(5, 3, 8));

    for (const axis of [POSITIVE.X, POSITIVE.Y, POSITIVE.Z]) {
      const positiveVisible = isScaleAxisHandleVisible(axis, eye);
      const negativeVisible = isScaleAxisHandleVisible(axis.clone().negate(), eye);
      expect(positiveVisible).not.toBe(negativeVisible);
    }
  });

  it('zeigt die kameraseitig erreichbare Seite', () => {
    // Kamera auf der positiven Seite aller Achsen: positive Pfeile sichtbar.
    const eye = eyeFrom(new THREE.Vector3(5, 3, 8));

    expect(isScaleAxisHandleVisible(POSITIVE.X, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(POSITIVE.Y, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(POSITIVE.Z, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(POSITIVE.X.clone().negate(), eye)).toBe(false);
    expect(isScaleAxisHandleVisible(POSITIVE.Y.clone().negate(), eye)).toBe(false);
    expect(isScaleAxisHandleVisible(POSITIVE.Z.clone().negate(), eye)).toBe(false);
  });

  it('wechselt beim Drehen der Kamera auf die gegenüberliegende Seite', () => {
    // Kamera auf die negative X-/Z-Seite gedreht: Die X- und Z-Pfeile
    // springen auf die gegenüberliegende Objektseite.
    const eye = eyeFrom(new THREE.Vector3(-5, 3, -8));

    expect(isScaleAxisHandleVisible(POSITIVE.X, eye)).toBe(false);
    expect(isScaleAxisHandleVisible(POSITIVE.X.clone().negate(), eye)).toBe(true);
    expect(isScaleAxisHandleVisible(POSITIVE.Z, eye)).toBe(false);
    expect(isScaleAxisHandleVisible(POSITIVE.Z.clone().negate(), eye)).toBe(true);
    // Die Y-Seite bleibt, weil die Kamera weiterhin oberhalb liegt.
    expect(isScaleAxisHandleVisible(POSITIVE.Y, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(POSITIVE.Y.clone().negate(), eye)).toBe(false);
  });

  it('blendet eine Achse bei nahezu axialem Blick aus', () => {
    const axialEyes = [
      eyeFrom(new THREE.Vector3(10, 0.01, 0)),
      eyeFrom(new THREE.Vector3(-10, 0.01, 0))
    ];

    for (const eye of axialEyes) {
      expect(Math.abs(POSITIVE.X.dot(eye))).toBeGreaterThan(SCALE_AXIS_HIDE_THRESHOLD);
      expect(isScaleAxisHandleVisible(POSITIVE.X, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(POSITIVE.X.clone().negate(), eye)).toBe(false);
    }
  });

  it('lässt den kameraseitigen Pfeil genau am Schwellenwert sichtbar', () => {
    const boundaryEye = new THREE.Vector3(
      SCALE_AXIS_HIDE_THRESHOLD,
      Math.sqrt(1 - SCALE_AXIS_HIDE_THRESHOLD * SCALE_AXIS_HIDE_THRESHOLD),
      0
    );

    expect(isScaleAxisHandleVisible(POSITIVE.X, boundaryEye)).toBe(true);
    expect(isScaleAxisHandleVisible(POSITIVE.X.clone().negate(), boundaryEye)).toBe(false);
  });

  it('berücksichtigt die Objektrotation in der Seitenwahl', () => {
    // Objekt um 180° um Y gedreht: lokale +X-Achse zeigt in Welt -X. Für
    // eine Kamera auf der positiven X-Seite ist damit der lokale -X-Pfeil
    // (Welt +X) der erreichbare.
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const localPositiveX = POSITIVE.X.clone().applyQuaternion(rotation);
    const localNegativeX = POSITIVE.X.clone().negate().applyQuaternion(rotation);
    expect(localPositiveX.x).toBeCloseTo(-1);
    expect(localNegativeX.x).toBeCloseTo(1);

    const eye = eyeFrom(new THREE.Vector3(5, 3, 8));
    expect(isScaleAxisHandleVisible(localPositiveX, eye)).toBe(false);
    expect(isScaleAxisHandleVisible(localNegativeX, eye)).toBe(true);

    // Blick entlang der gedrehten Achse: Ausblendung bleibt erhalten.
    const axialEye = localNegativeX.clone();
    expect(isScaleAxisHandleVisible(localNegativeX, axialEye)).toBe(false);
    expect(isScaleAxisHandleVisible(localPositiveX, axialEye)).toBe(false);
  });
});
