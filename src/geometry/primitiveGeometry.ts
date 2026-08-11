import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneObjectData } from '../types/editor';
import { createRoundableBoxGeometry } from './rounding';
import { applySurfaceUvAtlas } from './uvAtlas';

function closedFlatGeometry(vertices: number[], indices: number[]): THREE.BufferGeometry {
  const indexedGeometry = new THREE.BufferGeometry();
  indexedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  indexedGeometry.setIndex(indices);

  const geometry = indexedGeometry.toNonIndexed();
  indexedGeometry.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function cappedHemisphereGeometry(radius: number, widthSegments: number, heightSegments: number): THREE.BufferGeometry {
  const radialSegments = Math.max(3, Math.round(widthSegments));
  const verticalSegments = Math.max(2, Math.round(heightSegments));
  const shell = new THREE.SphereGeometry(radius, radialSegments, verticalSegments, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = new THREE.CircleGeometry(radius, radialSegments);
  cap.rotateX(Math.PI / 2);

  const geometry = mergeGeometries([shell, cap], true);
  shell.dispose();
  cap.dispose();

  if (!geometry) throw new Error('Halbkugel konnte nicht geschlossen werden.');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function twoSidedPlaneGeometry(width: number, depth: number): THREE.BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const vertices = [
    -w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d,
    -w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d
  ];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7];
  return closedFlatGeometry(vertices, indices);
}

function wedgeGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const vertices = [-w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d, -w, height, d, w, height, d];
  const indices = [0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 0, 4, 5, 0, 5, 1, 1, 5, 2];
  return closedFlatGeometry(vertices, indices);
}

function prismGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const vertices = [-w, 0, -d, w, 0, -d, 0, height, -d, -w, 0, d, w, 0, d, 0, height, d];
  const indices = [0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2];
  return closedFlatGeometry(vertices, indices);
}

function stairsGeometry(width: number, height: number, depth: number, steps: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const stepWidth = width / steps;
  const stepHeight = height / steps;
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  for (let index = steps - 1; index >= 0; index -= 1) {
    shape.lineTo(-width / 2 + index * stepWidth, (index + 1) * stepHeight);
    shape.lineTo(-width / 2 + index * stepWidth, index * stepHeight);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function roofGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const vertices = [-w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d, 0, height, -d, 0, height, d];
  const indices = [0, 4, 1, 3, 2, 5, 0, 3, 5, 0, 5, 4, 1, 4, 5, 1, 5, 2, 0, 1, 2, 0, 2, 3];
  return closedFlatGeometry(vertices, indices);
}

export function createRawGeometry(object: Pick<SceneObjectData, 'type' | 'geometry'>): THREE.BufferGeometry {
  const g = object.geometry;
  switch (object.type) {
    case 'sphere':
      return new THREE.SphereGeometry(g.radius ?? 0.65, g.widthSegments ?? 24, g.heightSegments ?? 16);
    case 'hemisphere':
      return cappedHemisphereGeometry(g.radius ?? 0.75, g.widthSegments ?? 24, g.heightSegments ?? 12);
    case 'cylinder':
      return new THREE.CylinderGeometry(g.radiusTop ?? 0.5, g.radiusBottom ?? 0.5, g.height ?? 1.4, g.radialSegments ?? 20);
    case 'cone':
      return new THREE.ConeGeometry(g.radius ?? 0.65, g.height ?? 1.5, g.radialSegments ?? 20);
    case 'pyramid': {
      const geometry = new THREE.ConeGeometry(g.radius ?? 0.8, g.height ?? 1.5, 4);
      geometry.rotateY(Math.PI / 4);
      return geometry;
    }
    case 'plane':
      return twoSidedPlaneGeometry(g.width ?? 2, g.height ?? 2);
    case 'torus':
      return new THREE.TorusGeometry(g.radius ?? 0.65, g.tube ?? 0.22, g.radialSegments ?? 12, g.tubularSegments ?? 32);
    case 'wedge':
      return wedgeGeometry(g.width ?? 1.5, g.height ?? 1, g.depth ?? 1.5);
    case 'prism':
      return prismGeometry(g.width ?? 1.6, g.height ?? 1.2, g.depth ?? 1.8);
    case 'gableRoof':
      return roofGeometry(g.width ?? 3.4, g.height ?? 1.2, g.depth ?? 3.4);
    case 'shedRoof':
      return wedgeGeometry(g.width ?? 3.4, g.height ?? 0.9, g.depth ?? 3.4);
    case 'column':
      return new THREE.CylinderGeometry(g.radiusTop ?? 0.3, g.radiusBottom ?? 0.36, g.height ?? 2.5, g.radialSegments ?? 16);
    case 'stairs':
      return stairsGeometry(g.width ?? 2, g.height ?? 1.4, g.depth ?? 1.6, Math.max(2, Math.round(g.steps ?? 5)));
    case 'box':
    case 'cuboid':
    case 'wall':
    case 'floor':
    case 'flatRoof':
    case 'door':
    case 'window':
    case 'chimney':
      return createRoundableBoxGeometry(g.width ?? 1, g.height ?? 1, g.depth ?? 1, g);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function createGeometry(object: Pick<SceneObjectData, 'type' | 'geometry'>): THREE.BufferGeometry {
  return applySurfaceUvAtlas(createRawGeometry(object), object.type);
}
