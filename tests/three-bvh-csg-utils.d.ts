declare module 'three-bvh-csg/src/utils/isWaterTight.js' {
  import type * as THREE from 'three';
  export function isWaterTight(geometry: THREE.BufferGeometry | THREE.Mesh): boolean;
}
