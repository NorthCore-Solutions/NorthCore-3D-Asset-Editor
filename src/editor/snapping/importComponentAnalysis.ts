import * as THREE from 'three';

const POSITION_PRECISION = 0.00001;
const MIN_CLUSTER_PADDING = 0.0001;
const PLACEHOLDER_MATERIAL = new THREE.MeshBasicMaterial();

interface CachedComponentRoots {
  signature: string;
  roots: THREE.Object3D[];
}

interface ComponentDefinition {
  key: string;
  order: number;
  parts: THREE.BufferGeometry[];
}

interface DirectPart {
  key: string;
  order: number;
  sourceMesh: THREE.Mesh<THREE.BufferGeometry>;
  geometry: THREE.BufferGeometry;
  bounds: THREE.Box3;
}

const componentRootCache = new WeakMap<THREE.Object3D, CachedComponentRoots>();

function pointKey(position: THREE.Vector3): string {
  return [position.x, position.y, position.z]
    .map((value) => Math.round(value / POSITION_PRECISION))
    .join(':');
}

function splitGeometryIslands(source: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const clone = source.clone();
  const geometry = clone.index ? clone.toNonIndexed() : clone;
  if (geometry !== clone) clone.dispose();

  const positions = geometry.getAttribute('position');
  const triangleCount = positions && positions.itemSize >= 3
    ? Math.floor(positions.count / 3)
    : 0;
  if (!positions || triangleCount === 0) {
    geometry.dispose();
    return [];
  }

  const parents = Array.from({ length: triangleCount }, (_, index) => index);
  const find = (value: number): number => {
    const current = parents[value];
    if (current === undefined || current === value) return value;
    const root = find(current);
    parents[value] = root;
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  const firstTriangleByPoint = new Map<string, number>();
  const point = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      point.fromBufferAttribute(positions, triangle * 3 + vertex);
      const key = pointKey(point);
      const first = firstTriangleByPoint.get(key);
      if (first === undefined) firstTriangleByPoint.set(key, triangle);
      else union(triangle, first);
    }
  }

  const positionGroups = new Map<number, number[]>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const group = find(triangle);
    const values = positionGroups.get(group) ?? [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const index = triangle * 3 + vertex;
      values.push(
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index)
      );
    }
    positionGroups.set(group, values);
  }

  geometry.dispose();
  return [...positionGroups.values()].map((values) => {
    const island = new THREE.BufferGeometry();
    island.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
    island.computeVertexNormals();
    island.computeBoundingBox();
    island.computeBoundingSphere();
    return island;
  });
}

function containsVisibleMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverseVisible((child) => {
    if ((child as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

function geometryPartsForNode(
  node: THREE.Object3D,
  inverseImportRoot: THREE.Matrix4
): Array<{
  sourceMesh: THREE.Mesh<THREE.BufferGeometry>;
  geometry: THREE.BufferGeometry;
}> {
  const parts: Array<{
    sourceMesh: THREE.Mesh<THREE.BufferGeometry>;
    geometry: THREE.BufferGeometry;
  }> = [];

  node.traverseVisible((child) => {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return;
    const meshToImportRoot = inverseImportRoot.clone().multiply(mesh.matrixWorld);
    for (const geometry of splitGeometryIslands(mesh.geometry)) {
      geometry.applyMatrix4(meshToImportRoot);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      parts.push({ sourceMesh: mesh, geometry });
    }
  });
  return parts;
}

function boundsForParts(parts: readonly THREE.BufferGeometry[]): THREE.Box3 {
  const bounds = new THREE.Box3().makeEmpty();
  for (const geometry of parts) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
  }
  return bounds;
}

function clusterDirectParts(parts: DirectPart[]): ComponentDefinition[] {
  if (parts.length === 0) return [];
  const combinedBounds = parts.reduce(
    (bounds, part) => bounds.union(part.bounds),
    new THREE.Box3().makeEmpty()
  );
  const diagonal = combinedBounds.getSize(new THREE.Vector3()).length();
  const padding = Math.max(MIN_CLUSTER_PADDING, diagonal * 0.00001);
  const parents = parts.map((_, index) => index);
  const find = (value: number): number => {
    const current = parents[value];
    if (current === undefined || current === value) return value;
    const root = find(current);
    parents[value] = root;
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < parts.length; left += 1) {
    const leftPart = parts[left];
    if (!leftPart) continue;
    for (let right = left + 1; right < parts.length; right += 1) {
      const rightPart = parts[right];
      if (!rightPart || leftPart.sourceMesh === rightPart.sourceMesh) continue;
      const leftBounds = leftPart.bounds.clone().expandByScalar(padding);
      const rightBounds = rightPart.bounds.clone().expandByScalar(padding);
      if (leftBounds.intersectsBox(rightBounds)) union(left, right);
    }
  }

  const groups = new Map<number, DirectPart[]>();
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(part);
    groups.set(root, group);
  }

  return [...groups.values()].map((group) => ({
    key: [...new Set(group.map((part) => part.key))].sort().join('+'),
    order: Math.min(...group.map((part) => part.order)),
    parts: group.map((part) => part.geometry)
  }));
}

function syncRootTransform(
  componentRoot: THREE.Object3D,
  importMatrixWorld: THREE.Matrix4
): void {
  importMatrixWorld.decompose(
    componentRoot.position,
    componentRoot.quaternion,
    componentRoot.scale
  );
  componentRoot.updateWorldMatrix(true, true);
}

function componentRoot(
  definition: ComponentDefinition,
  importMatrixWorld: THREE.Matrix4
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'AppleCutterImportComponent';
  root.userData.appleCutterComponentKey = definition.key;
  for (const geometry of definition.parts) {
    root.add(new THREE.Mesh(geometry, PLACEHOLDER_MATERIAL));
  }
  syncRootTransform(root, importMatrixWorld);
  return root;
}

function componentSignature(root: THREE.Object3D): string {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const meshes: unknown[] = [];
  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const relativeMatrix = inverseRoot.clone().multiply(mesh.matrixWorld);
    meshes.push({
      node: mesh.uuid,
      geometry: mesh.geometry.uuid,
      positionCount: position?.count ?? 0,
      positionVersion: position && 'version' in position ? position.version : 0,
      indexCount: index?.count ?? 0,
      indexVersion: index?.version ?? 0,
      matrix: relativeMatrix.elements.map((value) => Number(value.toFixed(6)))
    });
  });
  return JSON.stringify({
    directChildren: root.children.map((child) => ({
      node: child.uuid,
      visible: child.visible,
      mesh: (child as THREE.Mesh).isMesh === true,
      childCount: child.children.length
    })),
    meshes
  });
}

function disposeComponentRoots(roots: readonly THREE.Object3D[]): void {
  for (const root of roots) {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}

/**
 * Bestmögliche Komponentenheuristik für Fremdimporte:
 * - explizite direkte Gruppen bleiben eigene Komponenten,
 * - berührende direkte Mesh-Aufteilungen werden zusammengefasst,
 * - räumlich getrennte Meshes bleiben getrennt,
 * - getrennte Dreiecksinseln eines Meshes bleiben getrennt.
 */
export function buildImportedComponentRoots(root: THREE.Object3D): THREE.Object3D[] {
  root.updateWorldMatrix(true, true);
  const signature = componentSignature(root);
  const cached = componentRootCache.get(root);
  if (cached?.signature === signature) {
    cached.roots.forEach((component) => syncRootTransform(component, root.matrixWorld));
    return cached.roots;
  }
  if (cached) disposeComponentRoots(cached.roots);

  const inverseRoot = root.matrixWorld.clone().invert();
  const definitions: ComponentDefinition[] = [];
  const directParts: DirectPart[] = [];

  if ((root as THREE.Mesh).isMesh) {
    const mesh = root as THREE.Mesh<THREE.BufferGeometry>;
    const parts = geometryPartsForNode(mesh, inverseRoot);
    parts.forEach((part, islandIndex) => {
      directParts.push({
        key: `island-${islandIndex}`,
        order: islandIndex,
        sourceMesh: part.sourceMesh,
        geometry: part.geometry,
        bounds: boundsForParts([part.geometry])
      });
    });
  } else {
    root.children.forEach((child, childIndex) => {
      if (!child.visible || !containsVisibleMesh(child)) return;
      if ((child as THREE.Mesh).isMesh) {
        const parts = geometryPartsForNode(child, inverseRoot);
        parts.forEach((part, islandIndex) => {
          directParts.push({
            key: islandIndex === 0 ? String(childIndex) : `${childIndex}-island-${islandIndex}`,
            order: childIndex * 100000 + islandIndex,
            sourceMesh: part.sourceMesh,
            geometry: part.geometry,
            bounds: boundsForParts([part.geometry])
          });
        });
        return;
      }

      const parts = geometryPartsForNode(child, inverseRoot)
        .map((part) => part.geometry);
      if (parts.length > 0) {
        definitions.push({
          key: String(childIndex),
          order: childIndex * 100000,
          parts
        });
      }
    });
  }

  definitions.push(...clusterDirectParts(directParts));
  definitions.sort((left, right) => left.order - right.order);
  const roots = definitions
    .filter((definition) => !boundsForParts(definition.parts).isEmpty())
    .map((definition) => componentRoot(definition, root.matrixWorld));

  componentRootCache.set(root, { signature, roots });
  return roots;
}
