import type { SceneObjectData } from '../types/editor';
import { createGeometry } from './primitiveGeometry';

export function triangleCount(object: Pick<SceneObjectData, 'type' | 'geometry'>): number {
  const geometry = createGeometry(object);
  const count = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
  geometry.dispose();
  return Math.round(count);
}
