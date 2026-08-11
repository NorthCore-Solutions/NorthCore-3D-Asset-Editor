import * as THREE from 'three';
import type { Vec3 } from '../../types/editor';
import type { AppleCutterScope } from '../appleCutter/appleCutterTypes';
import type { SurfaceSnapAnchor } from './surfaceSnapTopology';

export interface ObjectSurfaceSnapResult {
  position: Vec3;
  targetId: string | null;
  distance: number;
  sourceAnchorId?: string | null;
  targetAnchorId?: string | null;
  /** Weltnormalen-Richtung des Kontakts (zeigt vom Ziel zur Quelle). */
  contactNormal?: Vec3 | null;
}

export interface SurfaceSnapTarget {
  id: string;
  visible: boolean;
  localBounds: THREE.Box3;
  matrixWorld: THREE.Matrix4;
  anchors: SurfaceSnapAnchor[];
  supportPoints?: THREE.Vector3[];
  scope?: AppleCutterScope;
}

export interface ImportedObjectSnapAnalysis {
  composite: SurfaceSnapTarget | null;
  components: SurfaceSnapTarget[];
}
