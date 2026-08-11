import * as THREE from 'three';
import type { CameraView } from '../../types/editor';

export function cameraViewForSurfaceLabel(label: string): CameraView | null {
  const direction = label.replace(/\s+\d+$/u, '');
  if (direction === 'Vorne') return 'front';
  if (direction === 'Hinten') return 'back';
  if (direction === 'Links') return 'left';
  if (direction === 'Rechts') return 'right';
  if (direction === 'Oben') return 'top';
  if (direction === 'Unten') return 'bottom';
  return null;
}

export function surfaceCameraDestination(
  view: CameraView,
  target: THREE.Vector3,
  distance: number
): { position: THREE.Vector3; up: THREE.Vector3 } {
  const up = new THREE.Vector3(0, 1, 0);

  switch (view) {
    case 'perspective': return {
      position: target.clone().add(new THREE.Vector3(6, 5, 7)),
      up
    };
    case 'focus': return {
      position: target.clone().add(new THREE.Vector3(distance, distance * 0.65, distance)),
      up
    };
    case 'front': return { position: target.clone().add(new THREE.Vector3(0, 0, distance)), up };
    case 'back': return { position: target.clone().add(new THREE.Vector3(0, 0, -distance)), up };
    case 'left': return { position: target.clone().add(new THREE.Vector3(-distance, 0, 0)), up };
    case 'right': return { position: target.clone().add(new THREE.Vector3(distance, 0, 0)), up };
    case 'top': return {
      position: target.clone().add(new THREE.Vector3(0, distance, 0.001)),
      up: new THREE.Vector3(0, 0, -1)
    };
    case 'bottom': return {
      position: target.clone().add(new THREE.Vector3(0, -distance, 0.001)),
      up: new THREE.Vector3(0, 0, 1)
    };
  }
}
