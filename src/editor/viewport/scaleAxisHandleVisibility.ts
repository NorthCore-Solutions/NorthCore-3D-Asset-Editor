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

// Bei exakt (oder nahezu) senkrechtem Blick auf eine Achse — den festen
// Kameraansichten Vorne/Hinten/Links/Rechts/Oben/Unten — ist das Dot-Produkt
// beider Achsseiten ≈ 0. Wie bei den Verschiebe-Pfeilen der TransformControls
// bleibt die Achse dann sichtbar; deterministisch genau eine Seite (die mit
// positiver erster nennenswerter Komponente), damit pro Achse höchstens ein
// Pfeil erscheint.
export const SCALE_AXIS_PERPENDICULAR_EPSILON = 1e-6;

const firstSignificantComponent = (v: THREE.Vector3): number => {
  if (Math.abs(v.x) > SCALE_AXIS_PERPENDICULAR_EPSILON) return v.x;
  if (Math.abs(v.y) > SCALE_AXIS_PERPENDICULAR_EPSILON) return v.y;
  return v.z;
};

export const isScaleAxisHandleVisible = (
  worldAxisDirection: THREE.Vector3,
  eyeDirection: THREE.Vector3
): boolean => {
  const facing = worldAxisDirection.dot(eyeDirection);
  if (Math.abs(facing) > SCALE_AXIS_HIDE_THRESHOLD) return false;
  if (facing > SCALE_AXIS_PERPENDICULAR_EPSILON) return true;
  if (facing < -SCALE_AXIS_PERPENDICULAR_EPSILON) return false;
  return firstSignificantComponent(worldAxisDirection) > 0;
};
