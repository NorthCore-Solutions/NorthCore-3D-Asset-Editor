import type * as THREE from 'three';
import type { Brush } from 'three-bvh-csg';

function effectiveDrawRange(geometry: THREE.BufferGeometry): { start: number; count: number } {
  const total = geometry.index?.count ?? geometry.getAttribute('position').count;
  const start = Math.max(0, Math.min(total, geometry.drawRange.start));
  const requestedCount = Number.isFinite(geometry.drawRange.count)
    ? geometry.drawRange.count
    : total - start;
  return { start, count: Math.max(0, Math.min(total - start, requestedCount)) };
}

export function normalizeUnionGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const drawRange = effectiveDrawRange(source);
  const drawEnd = drawRange.start + drawRange.count;
  const sourceGroups = source.groups.length > 0
    ? source.groups
    : [{ start: drawRange.start, count: drawRange.count, materialIndex: 0 }];
  const selectedGroups = sourceGroups
    .map((group) => {
      const start = Math.max(group.start, drawRange.start);
      const end = Math.min(group.start + group.count, drawEnd);
      return { start, count: Math.max(0, end - start), materialIndex: group.materialIndex ?? 0 };
    })
    .filter((group) => group.count > 0);

  if (selectedGroups.length === 0) return null;

  const geometry = source.clone();
  geometry.clearGroups();
  selectedGroups.forEach((group) => geometry.addGroup(group.start, group.count, group.materialIndex));
  const count = geometry.index?.count ?? geometry.getAttribute('position').count;
  geometry.setDrawRange(0, count);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function unionMaterials(result: Brush): THREE.Material[] {
  return Array.isArray(result.material) ? result.material : [result.material];
}

function uvRange(geometry: THREE.BufferGeometry): { min: number; max: number } | null {
  const uv = geometry.getAttribute('uv');
  if (!uv) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < uv.count; index += 1) {
    for (let component = 0; component < 2; component += 1) {
      const value = component === 0 ? uv.getX(index) : uv.getY(index);
      if (!Number.isFinite(value)) return null;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return { min, max };
}

export function hasConsistentUvs(result: Brush, sources: Brush[]): boolean {
  const resultRange = uvRange(result.geometry);
  if (!resultRange) return false;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const source of sources) {
    const range = uvRange(source.geometry);
    if (!range) continue;
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  }
  if (!Number.isFinite(min)) return false;

  const tolerance = 0.001;
  return resultRange.min >= min - tolerance && resultRange.max <= max + tolerance;
}
