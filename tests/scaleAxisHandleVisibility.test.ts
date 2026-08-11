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

describe('Skalier-Achspfeile bei festen Kameraansichten', () => {
  const NEGATIVE = {
    X: POSITIVE.X.clone().negate(),
    Y: POSITIVE.Y.clone().negate(),
    Z: POSITIVE.Z.clone().negate()
  };
  const FIXED_EYES = {
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    top: new THREE.Vector3(0, 1, 0),
    bottom: new THREE.Vector3(0, -1, 0)
  };
  const AXES = [
    { positive: POSITIVE.X, negative: NEGATIVE.X },
    { positive: POSITIVE.Y, negative: NEGATIVE.Y },
    { positive: POSITIVE.Z, negative: NEGATIVE.Z }
  ];

  it('zeigt bei Vorne/Hinten je eine Seite von X und Y, Z bleibt ausgeblendet', () => {
    for (const eye of [FIXED_EYES.front, FIXED_EYES.back]) {
      expect(isScaleAxisHandleVisible(POSITIVE.X, eye)).toBe(true);
      expect(isScaleAxisHandleVisible(NEGATIVE.X, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(POSITIVE.Y, eye)).toBe(true);
      expect(isScaleAxisHandleVisible(NEGATIVE.Y, eye)).toBe(false);
      // Blickachse: beide Seiten ausgeblendet.
      expect(isScaleAxisHandleVisible(POSITIVE.Z, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(NEGATIVE.Z, eye)).toBe(false);
    }
  });

  it('zeigt bei Links/Rechts je eine Seite von Y und Z, X bleibt ausgeblendet', () => {
    for (const eye of [FIXED_EYES.left, FIXED_EYES.right]) {
      expect(isScaleAxisHandleVisible(POSITIVE.X, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(NEGATIVE.X, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(POSITIVE.Y, eye)).toBe(true);
      expect(isScaleAxisHandleVisible(NEGATIVE.Y, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(POSITIVE.Z, eye)).toBe(true);
      expect(isScaleAxisHandleVisible(NEGATIVE.Z, eye)).toBe(false);
    }
  });

  it('zeigt bei Oben/Unten je eine Seite von X und Z, Y bleibt ausgeblendet', () => {
    for (const eye of [FIXED_EYES.top, FIXED_EYES.bottom]) {
      expect(isScaleAxisHandleVisible(POSITIVE.X, eye)).toBe(true);
      expect(isScaleAxisHandleVisible(NEGATIVE.X, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(POSITIVE.Z, eye)).toBe(true);
      expect(isScaleAxisHandleVisible(NEGATIVE.Z, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(POSITIVE.Y, eye)).toBe(false);
      expect(isScaleAxisHandleVisible(NEGATIVE.Y, eye)).toBe(false);
    }
  });

  it('zeigt bei Oben/Unten mit minimalem Z-Versatz weiterhin je eine Z-Seite passend zum Vorzeichen', () => {
    // Die App versetzt Oben/Unten minimal in Z (0.001), damit die Kamera-up-
    // Achse eindeutig bleibt; die Z-Seitenwahl folgt dann dem Vorzeichen.
    const topEye = eyeFrom(new THREE.Vector3(0, 8, 0.001));
    expect(isScaleAxisHandleVisible(POSITIVE.Z, topEye)).toBe(true);
    expect(isScaleAxisHandleVisible(NEGATIVE.Z, topEye)).toBe(false);
    expect(isScaleAxisHandleVisible(POSITIVE.X, topEye)).toBe(true);
    expect(isScaleAxisHandleVisible(NEGATIVE.X, topEye)).toBe(false);

    const bottomEye = eyeFrom(new THREE.Vector3(0, -8, 0.001));
    expect(isScaleAxisHandleVisible(POSITIVE.Z, bottomEye)).toBe(true);
    expect(isScaleAxisHandleVisible(NEGATIVE.Z, bottomEye)).toBe(false);
    expect(isScaleAxisHandleVisible(POSITIVE.X, bottomEye)).toBe(true);
    expect(isScaleAxisHandleVisible(NEGATIVE.X, bottomEye)).toBe(false);
  });

  it('zeigt in jeder festen Ansicht höchstens einen Pfeil pro Achse', () => {
    for (const eye of Object.values(FIXED_EYES)) {
      for (const { positive, negative } of AXES) {
        const positiveVisible = isScaleAxisHandleVisible(positive, eye);
        const negativeVisible = isScaleAxisHandleVisible(negative, eye);
        expect(positiveVisible && negativeVisible).toBe(false);
      }
    }
  });

  it('zeigt in jeder festen Ansicht genau die zwei bildebenen Achsen', () => {
    for (const [view, eye] of Object.entries(FIXED_EYES)) {
      const visibleAxes = AXES.filter(
        ({ positive, negative }) =>
          isScaleAxisHandleVisible(positive, eye) || isScaleAxisHandleVisible(negative, eye)
      ).length;
      expect(visibleAxes, `Ansicht ${view}`).toBe(2);
    }
  });

  it('behandelt exakt senkrechte Dot=0-Fälle deterministisch (positive Seite)', () => {
    const eye = new THREE.Vector3(0, 0, 1);
    expect(POSITIVE.X.dot(eye)).toBe(0);
    expect(isScaleAxisHandleVisible(POSITIVE.X, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(NEGATIVE.X, eye)).toBe(false);
    expect(POSITIVE.Y.dot(eye)).toBe(0);
    expect(isScaleAxisHandleVisible(POSITIVE.Y, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(NEGATIVE.Y, eye)).toBe(false);
  });

  it('wechselt die Seite, sobald die Kamera die Senkrechte nur minimal verlässt', () => {
    const slightPositive = eyeFrom(new THREE.Vector3(0.5, 0, 8));
    expect(isScaleAxisHandleVisible(POSITIVE.X, slightPositive)).toBe(true);
    expect(isScaleAxisHandleVisible(NEGATIVE.X, slightPositive)).toBe(false);

    const slightNegative = eyeFrom(new THREE.Vector3(-0.5, 0, 8));
    expect(isScaleAxisHandleVisible(POSITIVE.X, slightNegative)).toBe(false);
    expect(isScaleAxisHandleVisible(NEGATIVE.X, slightNegative)).toBe(true);
  });

  it('berücksichtigt Objektrotation auch bei festen Ansichten', () => {
    // Objekt um 90° um Y gedreht: lokale Z-Achse zeigt in Welt ±X, lokale
    // X-Achse in Welt ∓Z. Bei Frontansicht (Blick entlang Welt -Z) ist die
    // lokale X-Achse die Blickachse und bleibt ausgeblendet; von der lokalen
    // Z-Achse (jetzt Welt X) bleibt genau eine Seite sichtbar.
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const localPositiveX = POSITIVE.X.clone().applyQuaternion(rotation);
    const localNegativeX = NEGATIVE.X.clone().applyQuaternion(rotation);
    const localPositiveZ = POSITIVE.Z.clone().applyQuaternion(rotation);
    const localNegativeZ = NEGATIVE.Z.clone().applyQuaternion(rotation);
    expect(localPositiveX.z).toBeCloseTo(-1);
    expect(localPositiveZ.x).toBeCloseTo(1);

    const eye = FIXED_EYES.front;
    expect(isScaleAxisHandleVisible(localPositiveX, eye)).toBe(false);
    expect(isScaleAxisHandleVisible(localNegativeX, eye)).toBe(false);
    expect(isScaleAxisHandleVisible(localPositiveZ, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(localNegativeZ, eye)).toBe(false);
  });
});
