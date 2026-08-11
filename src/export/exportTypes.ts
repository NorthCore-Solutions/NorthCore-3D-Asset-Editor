import type * as THREE from 'three';
import type { SceneObjectData } from '../types/editor';

export type ExportGeometryMode = 'separate' | 'union';

export interface ExportReport {
  objects: SceneObjectData[];
  triangles: number;
  warnings: string[];
  unionEligible: number;
  unionSeparate: number;
}

export interface ExportResources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}
