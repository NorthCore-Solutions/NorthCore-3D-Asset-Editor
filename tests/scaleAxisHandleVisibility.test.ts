import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  isScaleAxisHandleVisible,
  SCALE_AXIS_HIDE_THRESHOLD
} from '../src/editor/viewport/scaleAxisHandleVisibility';

// Referenz: Verschiebe-Pfeile der TransformControls (three.js, mode "translate").
// Dort wird pro Achse ausschließlich die positive Richtung gezeigt, ohne
// kameraabhängigen Seitenwechsel; ausgeblendet wird nur bei nahezu axialem
// Blick (|Achse · Blick| > 0.99).
const eyeFrom = (cameraPosition: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 =>
  cameraPosition.clone().sub(target).normalize();

describe('Sichtbarkeit der Skalier-Achspfeile (Referenz: Verschieben)', () => {
  it('zeigt bei schrägem Blick wie Verschieben die positiven X/Y/Z-Richtungen', () => {
    const eye = eyeFrom(new THREE.Vector3(5, 3, 8));

    expect(isScaleAxisHandleVisible(1, new THREE.Vector3(1, 0, 0), eye)).toBe(true);
    expect(isScaleAxisHandleVisible(1, new THREE.Vector3(0, 1, 0), eye)).toBe(true);
    expect(isScaleAxisHandleVisible(1, new THREE.Vector3(0, 0, 1), eye)).toBe(true);
  });

  it('wechselt beim Drehen der Kamera nicht die Seite', () => {
    // Verschieben zeigt die positiven Richtungen unabhängig von der
    // Kameraseite; Skalieren muss sich genauso verhalten.
    const eyes = [
      eyeFrom(new THREE.Vector3(5, 3, 8)),
      eyeFrom(new THREE.Vector3(-5, 3, 8)),
      eyeFrom(new THREE.Vector3(-5, 3, -8)),
      eyeFrom(new THREE.Vector3(5, 3, -8))
    ];

    for (const eye of eyes) {
      expect(isScaleAxisHandleVisible(1, new THREE.Vector3(1, 0, 0), eye)).toBe(true);
      expect(isScaleAxisHandleVisible(-1, new THREE.Vector3(-1, 0, 0), eye)).toBe(false);
    }
  });

  it('blendet eine Achse bei nahezu axialem Blick wie Verschieben aus', () => {
    const axis = new THREE.Vector3(1, 0, 0);
    const axialEye = eyeFrom(new THREE.Vector3(10, 0.01, 0));
    expect(Math.abs(axis.dot(axialEye))).toBeGreaterThan(SCALE_AXIS_HIDE_THRESHOLD);

    expect(isScaleAxisHandleVisible(1, axis, axialEye)).toBe(false);
    expect(isScaleAxisHandleVisible(-1, axis.clone().negate(), axialEye)).toBe(false);
  });

  it('lässt eine Achse genau am Schwellenwert wie Verschieben sichtbar', () => {
    const axis = new THREE.Vector3(1, 0, 0);
    const boundaryEye = new THREE.Vector3(
      SCALE_AXIS_HIDE_THRESHOLD,
      Math.sqrt(1 - SCALE_AXIS_HIDE_THRESHOLD * SCALE_AXIS_HIDE_THRESHOLD),
      0
    );

    expect(isScaleAxisHandleVisible(1, axis, boundaryEye)).toBe(true);
  });

  it('berücksichtigt die Objektrotation in der Achsrichtung', () => {
    // Objekt um 180° um Y gedreht: lokale +X-Achse zeigt in Welt -X. Die
    // Sichtbarkeitsentscheidung folgt der gedrehten Achsrichtung, weiterhin
    // ausschließlich für die positive lokale Seite.
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const worldAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
    expect(worldAxis.x).toBeCloseTo(-1);

    const eye = eyeFrom(new THREE.Vector3(5, 3, 8));
    expect(isScaleAxisHandleVisible(1, worldAxis, eye)).toBe(true);
    expect(isScaleAxisHandleVisible(-1, worldAxis.clone().negate(), eye)).toBe(false);

    // Blick entlang der gedrehten Achse: Ausblendung wie bei Verschieben.
    const axialEye = worldAxis.clone();
    expect(isScaleAxisHandleVisible(1, worldAxis, axialEye)).toBe(false);
  });
});
