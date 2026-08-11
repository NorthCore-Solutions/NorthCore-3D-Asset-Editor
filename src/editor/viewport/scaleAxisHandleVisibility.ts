import type * as THREE from 'three';

export type ScaleAxis = 'X' | 'Y' | 'Z';
export type ScaleSide = -1 | 1;

// Sichtbarkeitsregel der Skalier-Achspfeile: Pro Achse ist nur der
// kameraseitig erreichbare Pfeil sichtbar; beim Drehen der Kamera um das
// Objekt wechselt der Pfeil auf die gegenüberliegende Seite, sodass aus
// beiden Richtungen skaliert werden kann. Bei nahezu axialem Blick entlang
// einer Achse wird diese ausgeblendet
// (Achsenrichtung · Blickrichtung > SCALE_AXIS_HIDE_THRESHOLD, analog zur
// Ausblendung der Verschiebe-Pfeile der TransformControls). Die
// Objektrotation steckt bereits in der übergebenen Welt-Achsrichtung.
export const SCALE_AXIS_HIDE_THRESHOLD = 0.99;

export const isScaleAxisHandleVisible = (
  worldAxisDirection: THREE.Vector3,
  eyeDirection: THREE.Vector3
): boolean => {
  const facing = worldAxisDirection.dot(eyeDirection);
  return facing > 0 && facing <= SCALE_AXIS_HIDE_THRESHOLD;
};
