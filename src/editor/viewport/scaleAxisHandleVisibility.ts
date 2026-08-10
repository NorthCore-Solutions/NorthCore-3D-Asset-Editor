import type * as THREE from 'three';

export type ScaleAxis = 'X' | 'Y' | 'Z';
export type ScaleSide = -1 | 1;

// Sichtbarkeitsregel 1:1 der Verschiebe-Pfeile der TransformControls
// (three.js, mode "translate"): Pro Achse wird ausschließlich die positive
// Richtung gezeigt; ein kameraabhängiger Seitenwechsel findet nicht statt.
// Eine Achse wird nur bei nahezu axialem Blick ausgeblendet
// (|Achsenrichtung · Blickrichtung| > SCALE_AXIS_HIDE_THRESHOLD).
// Die Objektrotation steckt bereits in der übergebenen Welt-Achsrichtung.
export const SCALE_AXIS_HIDE_THRESHOLD = 0.99;

export const isScaleAxisHandleVisible = (
  side: ScaleSide,
  worldAxisDirection: THREE.Vector3,
  eyeDirection: THREE.Vector3
): boolean => side === 1 && Math.abs(worldAxisDirection.dot(eyeDirection)) <= SCALE_AXIS_HIDE_THRESHOLD;
