import type { MutableRefObject } from 'react';
import type * as THREE from 'three';

export interface OrbitControlApi {
  target: THREE.Vector3;
  enabled: boolean;
  update: () => void;
}

export type MeshRegistry = MutableRefObject<Map<string, THREE.Mesh>>;

export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SelectionApi {
  idsInRect: (rect: SelectionRect) => string[];
}
