declare module 'three-bvh-csg/src/utils/isWaterTight.js' {
  import type * as THREE from 'three';
  export function isWaterTight(geometry: THREE.BufferGeometry | THREE.Mesh): boolean;
}

declare module 'three-bvh-csg/src/core/HalfEdgeMap.js' {
  import type * as THREE from 'three';
  export class HalfEdgeMap {
    matchDisjointEdges: boolean;
    unmatchedEdges: number;
    updateFrom(geometry: THREE.BufferGeometry): void;
  }
}
