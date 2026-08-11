import * as THREE from 'three';
import { createGeometry } from '../geometry/factory';
import type { SceneObjectData } from '../types/editor';

function objectMatrix(object: SceneObjectData): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
}

export function createWorldGeometry(object: SceneObjectData, forUnion: boolean): THREE.BufferGeometry {
  const source = createGeometry(object);
  let geometry = source;

  if (forUnion && source.index) {
    geometry = source.toNonIndexed();
    source.dispose();
  }

  geometry.applyMatrix4(objectMatrix(object));

  if (forUnion) {
    // CSG benötigt Position, Normalen und UVs. Weitere Attribute werden nicht
    // exportiert und dürfen die boolesche Operation nicht beeinflussen.
    for (const attributeName of Object.keys(geometry.attributes)) {
      if (attributeName !== 'position' && attributeName !== 'normal' && attributeName !== 'uv') {
        geometry.deleteAttribute(attributeName);
      }
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    if (!geometry.getAttribute('uv')) {
      const vertexCount = geometry.getAttribute('position').count;
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2));
    }
    const count = geometry.index?.count ?? geometry.getAttribute('position').count;
    geometry.clearGroups();
    geometry.addGroup(0, count, 0);
    geometry.setDrawRange(0, count);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
