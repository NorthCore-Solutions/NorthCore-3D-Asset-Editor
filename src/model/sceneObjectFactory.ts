import type { PrimitiveType, SceneObjectData } from '../types/editor';
import { defaultGeometryForType, defaultPositionForType, SHAPE_DEFINITIONS } from '../geometry/shapeCatalog';

const DEFAULT_MATERIAL = {
  color: '#AEB8BE',
  roughness: 0.8,
  metalness: 0,
  opacity: 1,
  flatShading: true
} as const;

export function createSceneObject(type: PrimitiveType, existingIds: string[] = []): SceneObjectData {
  let id = crypto.randomUUID();
  while (existingIds.includes(id)) id = crypto.randomUUID();
  const label = SHAPE_DEFINITIONS.find((item) => item.type === type)?.label ?? type;
  return {
    id,
    name: label,
    type,
    visible: true,
    locked: false,
    position: defaultPositionForType(type),
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    geometry: defaultGeometryForType(type),
    material: { ...DEFAULT_MATERIAL }
  };
}
