import type * as THREE from 'three';
import { isWaterTight } from 'three-bvh-csg/src/utils/isWaterTight.js';
import { HalfEdgeMap } from 'three-bvh-csg/src/core/HalfEdgeMap.js';

export function isGeometryWaterTight(geometry: THREE.BufferGeometry): boolean {
  return isWaterTight(geometry);
}

export function unmatchedEdgeCount(geometry: THREE.BufferGeometry): number {
  const halfEdges = new HalfEdgeMap();
  halfEdges.matchDisjointEdges = true;
  halfEdges.updateFrom(geometry);
  return halfEdges.unmatchedEdges;
}
