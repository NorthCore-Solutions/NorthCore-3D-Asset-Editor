import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import { APPLE_CUTTER_CELL_SIZE } from '../appleCutter/appleCutterAxisGrid';
import type { AppleCutterScope } from '../appleCutter/appleCutterTypes';
import { removeOpposingCoincidentAnchors } from './compositeAnchorFilter';
import { buildImportedComponentRoots } from './importComponentAnalysis';
import { buildGeometrySupportPoints } from './surfaceSupport';
import {
  buildGeometrySurfaceSnapAnchors,
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from './surfaceSnapTopology';

const EPSILON = 0.000001;
const TOPOLOGY_CACHE_LIMIT = 256;
const COMPOSITE_CACHE_LIMIT = 64;
const INSIDE_RAY_DIRECTION = new THREE.Vector3(1, 0.371, 0.613).normalize();

interface CachedTopology {
  localBounds: THREE.Box3;
  anchors: SurfaceSnapAnchor[];
  supportPoints: THREE.Vector3[];
}

interface ImportedTopologyCacheEntry extends CachedTopology {
  signature: string;
  id: string;
}

const topologyCache = new Map<string, CachedTopology>();
const sceneCompositeCache = new Map<string, CachedTopology>();
const importedCompositeCache = new WeakMap<THREE.Object3D, ImportedTopologyCacheEntry>();

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

function finiteBounds(bounds: THREE.Box3): boolean {
  return [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z
  ].every(Number.isFinite) && !bounds.isEmpty();
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function roundedVector(vector: THREE.Vector3): number[] {
  return [rounded(vector.x), rounded(vector.y), rounded(vector.z)];
}

function matrixForSceneObject(object: SceneObjectData): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
}

function geometryCacheKey(object: SceneObjectData): string {
  return JSON.stringify({
    id: object.id,
    type: object.type,
    geometry: object.geometry,
    scale: object.scale.map((value) => rounded(Math.abs(value))),
    cutterCellSize: APPLE_CUTTER_CELL_SIZE
  });
}

function rememberLru(
  cache: Map<string, CachedTopology>,
  key: string,
  topology: CachedTopology,
  limit: number
): void {
  cache.set(key, topology);
  if (cache.size <= limit) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey) cache.delete(oldestKey);
}

function cachedSceneTopology(object: SceneObjectData): CachedTopology | null {
  const key = geometryCacheKey(object);
  const cached = topologyCache.get(key);
  if (cached) {
    topologyCache.delete(key);
    topologyCache.set(key, cached);
    return {
      localBounds: cached.localBounds.clone(),
      anchors: cached.anchors,
      supportPoints: cached.supportPoints
    };
  }

  const geometry = createGeometry(object);
  try {
    geometry.computeBoundingBox();
    const localBounds = geometry.boundingBox?.clone();
    if (!localBounds || !finiteBounds(localBounds)) return null;
    const anchors = buildGeometrySurfaceSnapAnchors(
      geometry,
      APPLE_CUTTER_CELL_SIZE,
      new THREE.Vector3(...object.scale),
      { componentId: object.id, scope: 'component' }
    );
    const supportPoints = buildGeometrySupportPoints(geometry);
    if (anchors.length === 0 || supportPoints.length === 0) return null;

    const topology = { localBounds, anchors, supportPoints };
    rememberLru(topologyCache, key, topology, TOPOLOGY_CACHE_LIMIT);
    return {
      localBounds: localBounds.clone(),
      anchors,
      supportPoints
    };
  } finally {
    geometry.dispose();
  }
}

export function surfaceSnapTargetFromSceneObject(
  object: SceneObjectData,
  _cellSize: number = APPLE_CUTTER_CELL_SIZE
): SurfaceSnapTarget | null {
  void _cellSize;
  const topology = cachedSceneTopology(object);
  if (!topology) return null;
  return {
    id: object.id,
    visible: object.visible,
    localBounds: topology.localBounds,
    matrixWorld: matrixForSceneObject(object),
    anchors: topology.anchors,
    supportPoints: topology.supportPoints,
    scope: 'component'
  };
}

function matrixScale(matrix: THREE.Matrix4): THREE.Vector3 {
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale;
}

function normalizedSnapGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const clone = source.clone();
  const geometry = clone.index ? clone.toNonIndexed() : clone;
  if (geometry !== clone) clone.dispose();

  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position') geometry.deleteAttribute(name);
  }
  geometry.clearGroups();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function mergedGeometry(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  return mergeGeometries(parts, false);
}

function quantizedPointKey(point: THREE.Vector3): string {
  const precision = 0.00001;
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value / precision))
    .join(':');
}

function stableAnchorKey(anchor: SurfaceSnapAnchor): string {
  const positionPrecision = 0.00001;
  const normalPrecision = 0.005;
  return [
    Math.round(anchor.position.x / positionPrecision),
    Math.round(anchor.position.y / positionPrecision),
    Math.round(anchor.position.z / positionPrecision),
    Math.round(anchor.normal.x / normalPrecision),
    Math.round(anchor.normal.y / normalPrecision),
    Math.round(anchor.normal.z / normalPrecision)
  ].join(':');
}

function closedTriangleSoup(geometry: THREE.BufferGeometry): boolean {
  const positions = geometry.getAttribute('position');
  if (!positions || positions.itemSize < 3 || positions.count < 3) return false;
  const edgeCounts = new Map<string, number>();

  for (let triangle = 0; triangle + 2 < positions.count; triangle += 3) {
    const points = [0, 1, 2].map((offset) => (
      new THREE.Vector3().fromBufferAttribute(positions, triangle + offset)
    ));
    for (const [first, second] of [[0, 1], [1, 2], [2, 0]] as const) {
      const firstKey = quantizedPointKey(points[first] ?? new THREE.Vector3());
      const secondKey = quantizedPointKey(points[second] ?? new THREE.Vector3());
      const key = firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  return edgeCounts.size > 0 && [...edgeCounts.values()].every((count) => count % 2 === 0);
}

interface ClosedPartProbe {
  bounds: THREE.Box3;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

function pointInsideClosedProbe(
  point: THREE.Vector3,
  probe: ClosedPartProbe,
  raycaster: THREE.Raycaster
): boolean {
  if (!probe.bounds.containsPoint(point)) return false;

  raycaster.set(point, INSIDE_RAY_DIRECTION);
  raycaster.near = 0.000001;
  raycaster.far = Number.POSITIVE_INFINITY;
  const distances = raycaster.intersectObject(probe.mesh, false)
    .map((hit) => hit.distance)
    .filter((distance) => distance > 0.00001)
    .sort((left, right) => left - right);

  let uniqueCount = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const distance of distances) {
    if (distance - previous <= 0.00001) continue;
    previous = distance;
    uniqueCount += 1;
  }
  return uniqueCount % 2 === 1;
}

function externalCompositeAnchors(
  anchors: SurfaceSnapAnchor[],
  componentParts: readonly THREE.BufferGeometry[]
): SurfaceSnapAnchor[] {
  const exteriorCandidates = removeOpposingCoincidentAnchors(anchors);
  const closedParts = componentParts.filter(closedTriangleSoup);
  if (closedParts.length < 2) return exteriorCandidates;

  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const probes: ClosedPartProbe[] = closedParts.map((part) => {
    part.computeBoundingBox();
    const bounds = part.boundingBox?.clone() ?? new THREE.Box3().makeEmpty();
    const mesh = new THREE.Mesh(part, material);
    mesh.updateMatrixWorld(true);
    return { bounds, mesh };
  });
  const combinedBounds = probes.reduce(
    (bounds, probe) => bounds.union(probe.bounds),
    new THREE.Box3().makeEmpty()
  );
  const diagonal = combinedBounds.getSize(new THREE.Vector3()).length();
  const offset = Math.max(0.0001, diagonal * 0.00001);
  const raycaster = new THREE.Raycaster();

  try {
    return exteriorCandidates.filter((anchor) => {
      const outsideProbe = anchor.position.clone().addScaledVector(anchor.normal, offset);
      return !probes.some((probe) => pointInsideClosedProbe(outsideProbe, probe, raycaster));
    });
  } finally {
    material.dispose();
  }
}

function compositeTopologyFromParts(
  parts: THREE.BufferGeometry[],
  id: string,
  scale: THREE.Vector3
): CachedTopology | null {
  const geometry = mergedGeometry(parts);
  if (!geometry) return null;
  try {
    geometry.computeBoundingBox();
    const localBounds = geometry.boundingBox?.clone();
    if (!localBounds || !finiteBounds(localBounds)) return null;
    const rawAnchors = buildGeometrySurfaceSnapAnchors(
      geometry,
      APPLE_CUTTER_CELL_SIZE,
      scale,
      { componentId: id, scope: 'composite', maxAnchors: 16384 }
    );
    const anchors = externalCompositeAnchors(rawAnchors, parts);
    const supportPoints = buildGeometrySupportPoints(geometry);
    return anchors.length > 0 && supportPoints.length > 0
      ? { localBounds, anchors, supportPoints }
      : null;
  } finally {
    geometry.dispose();
    for (const part of parts) {
      if (part !== geometry) part.dispose();
    }
  }
}

function importedMeshSignature(
  root: THREE.Object3D,
  id: string
): { signature: string; records: Array<{ mesh: THREE.Mesh<THREE.BufferGeometry>; matrix: THREE.Matrix4 }> } {
  root.updateWorldMatrix(true, true);
  const inverseRootMatrix = root.matrixWorld.clone().invert();
  const records: Array<{ mesh: THREE.Mesh<THREE.BufferGeometry>; matrix: THREE.Matrix4 }> = [];
  const signatureParts: unknown[] = [];

  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return;
    const matrix = inverseRootMatrix.clone().multiply(mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    records.push({ mesh, matrix });
    signatureParts.push({
      node: mesh.uuid,
      geometry: mesh.geometry.uuid,
      positionCount: position?.count ?? 0,
      indexCount: index?.count ?? 0,
      matrix: matrix.elements.map(rounded)
    });
  });

  return {
    signature: JSON.stringify({
      id,
      scale: roundedVector(matrixScale(root.matrixWorld)),
      parts: signatureParts
    }),
    records
  };
}

export function surfaceSnapTargetFromObject3D(
  root: THREE.Object3D,
  id: string = root.uuid,
  _cellSize: number = APPLE_CUTTER_CELL_SIZE
): SurfaceSnapTarget | null {
  void _cellSize;
  const { signature, records } = importedMeshSignature(root, id);
  const cached = importedCompositeCache.get(root);
  let topology: CachedTopology | null = null;

  if (cached && cached.signature === signature && cached.id === id) {
    topology = {
      localBounds: cached.localBounds.clone(),
      anchors: cached.anchors,
      supportPoints: cached.supportPoints
    };
  } else {
    const parts = records.map(({ mesh, matrix }) => {
      const geometry = normalizedSnapGeometry(mesh.geometry);
      geometry.applyMatrix4(matrix);
      geometry.computeVertexNormals();
      return geometry;
    });
    topology = compositeTopologyFromParts(parts, id, matrixScale(root.matrixWorld));
    if (topology) {
      importedCompositeCache.set(root, {
        signature,
        id,
        localBounds: topology.localBounds.clone(),
        anchors: topology.anchors,
        supportPoints: topology.supportPoints
      });
    }
  }

  if (!topology) return null;
  return {
    id,
    visible: root.visible,
    localBounds: topology.localBounds,
    matrixWorld: root.matrixWorld.clone(),
    anchors: topology.anchors,
    supportPoints: topology.supportPoints,
    scope: 'composite'
  };
}

function rescopeTarget(
  target: SurfaceSnapTarget,
  id: string,
  scope: AppleCutterScope
): SurfaceSnapTarget {
  return {
    ...target,
    id,
    scope,
    anchors: target.anchors.map((anchor) => ({
      ...anchor,
      id: `${scope}:${id}:${stableAnchorKey(anchor)}`,
      componentId: id,
      scope
    }))
  };
}

export function analyzeImportedObject3DSnapTargets(
  root: THREE.Object3D,
  id: string = root.uuid
): ImportedObjectSnapAnalysis {
  const composite = surfaceSnapTargetFromObject3D(root, id);
  if (!composite) return { composite: null, components: [] };

  const componentRoots = buildImportedComponentRoots(root);
  if (componentRoots.length === 0) {
    return {
      composite,
      components: [rescopeTarget(composite, `${id}:component:0`, 'component')]
    };
  }

  const components = componentRoots.flatMap((componentRoot, index) => {
    const stableKey: unknown = componentRoot.userData.appleCutterComponentKey;
    const componentKey = typeof stableKey === 'string' ? stableKey : String(index);
    const componentId = `${id}:component:${componentKey}`;
    const target = surfaceSnapTargetFromObject3D(componentRoot, componentId);
    return target
      ? [rescopeTarget(target, componentId, 'component')]
      : [];
  });
  return {
    composite,
    components: components.length > 0
      ? components
      : [rescopeTarget(composite, `${id}:component:0`, 'component')]
  };
}

function sceneCompositeBounds(objects: readonly SceneObjectData[]): THREE.Box3 | null {
  const bounds = new THREE.Box3().makeEmpty();
  for (const object of objects) {
    const target = surfaceSnapTargetFromSceneObject(object);
    if (!target) continue;
    bounds.union(target.localBounds.clone().applyMatrix4(target.matrixWorld));
  }
  return finiteBounds(bounds) ? bounds : null;
}

function sceneCompositeKey(
  objects: readonly SceneObjectData[],
  id: string,
  center: THREE.Vector3
): string {
  return JSON.stringify({
    id,
    cutterCellSize: APPLE_CUTTER_CELL_SIZE,
    objects: [...objects]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((object) => ({
        id: object.id,
        type: object.type,
        geometry: object.geometry,
        relativePosition: object.position.map((value, axis) => rounded(value - center.getComponent(axis))),
        rotation: object.rotation.map(rounded),
        scale: object.scale.map(rounded)
      }))
  });
}

export function surfaceSnapTargetFromSceneObjects(
  objects: readonly SceneObjectData[],
  id: string = 'composite'
): SurfaceSnapTarget | null {
  const visibleObjects = objects.filter((object) => object.visible);
  if (visibleObjects.length === 0) return null;
  const worldBounds = sceneCompositeBounds(visibleObjects);
  if (!worldBounds) return null;

  const center = worldBounds.getCenter(new THREE.Vector3());
  const key = sceneCompositeKey(visibleObjects, id, center);
  const cached = sceneCompositeCache.get(key);
  let topology: CachedTopology | null = null;

  if (cached) {
    sceneCompositeCache.delete(key);
    sceneCompositeCache.set(key, cached);
    topology = {
      localBounds: cached.localBounds.clone(),
      anchors: cached.anchors,
      supportPoints: cached.supportPoints
    };
  } else {
    const localParts: THREE.BufferGeometry[] = [];
    for (const object of visibleObjects) {
      const sourceGeometry = createGeometry(object);
      const geometry = normalizedSnapGeometry(sourceGeometry);
      sourceGeometry.dispose();
      const localMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(
          object.position[0] - center.x,
          object.position[1] - center.y,
          object.position[2] - center.z
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
        new THREE.Vector3(...object.scale)
      );
      geometry.applyMatrix4(localMatrix);
      geometry.computeVertexNormals();
      localParts.push(geometry);
    }
    topology = compositeTopologyFromParts(localParts, id, new THREE.Vector3(1, 1, 1));
    if (topology) {
      rememberLru(sceneCompositeCache, key, {
        localBounds: topology.localBounds.clone(),
        anchors: topology.anchors,
        supportPoints: topology.supportPoints
      }, COMPOSITE_CACHE_LIMIT);
    }
  }

  if (!topology) return null;
  return {
    id,
    visible: true,
    localBounds: topology.localBounds,
    matrixWorld: new THREE.Matrix4().makeTranslation(center.x, center.y, center.z),
    anchors: topology.anchors,
    supportPoints: topology.supportPoints,
    scope: 'composite'
  };
}

function expandedWorldBounds(target: SurfaceSnapTarget, amount: number): THREE.Box3 {
  return target.localBounds.clone().applyMatrix4(target.matrixWorld).expandByScalar(amount);
}

function hashCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function hashKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function buildAnchorHash(
  anchors: readonly SurfaceSnapAnchor[],
  cellSize: number
): Map<string, SurfaceSnapAnchor[]> {
  const hash = new Map<string, SurfaceSnapAnchor[]>();
  for (const anchor of anchors) {
    const key = hashKey(
      hashCoordinate(anchor.position.x, cellSize),
      hashCoordinate(anchor.position.y, cellSize),
      hashCoordinate(anchor.position.z, cellSize)
    );
    const bucket = hash.get(key);
    if (bucket) bucket.push(anchor);
    else hash.set(key, [anchor]);
  }
  return hash;
}

function nearbyAnchors(
  hash: Map<string, SurfaceSnapAnchor[]>,
  position: THREE.Vector3,
  cellSize: number
): SurfaceSnapAnchor[] {
  const centerX = hashCoordinate(position.x, cellSize);
  const centerY = hashCoordinate(position.y, cellSize);
  const centerZ = hashCoordinate(position.z, cellSize);
  const result: SurfaceSnapAnchor[] = [];

  for (let x = centerX - 1; x <= centerX + 1; x += 1) {
    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
      for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
        const bucket = hash.get(hashKey(x, y, z));
        if (bucket) result.push(...bucket);
      }
    }
  }
  return result;
}

function anchorsCanMeet(
  source: SurfaceSnapAnchor,
  target: SurfaceSnapAnchor
): boolean {
  return source.normal.dot(target.normal) <= -0.12;
}

export function findSurfaceTargetSnap(
  sourceTarget: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  sourcePosition: THREE.Vector3,
  worldThreshold: number = 0.12
): ObjectSurfaceSnapResult {
  const unchanged: ObjectSurfaceSnapResult = {
    position: [sourcePosition.x, sourcePosition.y, sourcePosition.z],
    targetId: null,
    distance: Number.POSITIVE_INFINITY,
    sourceAnchorId: null,
    targetAnchorId: null
  };
  const sourceWorldAnchors = transformSurfaceSnapAnchors(
    sourceTarget.anchors,
    sourceTarget.matrixWorld
  );
  const sourceWorldBounds = expandedWorldBounds(sourceTarget, worldThreshold);
  let bestCorrection: THREE.Vector3 | null = null;
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestNormalAlignment = Number.POSITIVE_INFINITY;
  let bestSourceAnchorId: string | null = null;
  let bestTargetAnchorId: string | null = null;
  let bestContactNormal: THREE.Vector3 | null = null;

  for (const target of targets) {
    if (
      target.id === sourceTarget.id
      || !target.visible
      || target.anchors.length === 0
      || !sourceWorldBounds.intersectsBox(expandedWorldBounds(target, worldThreshold))
    ) continue;

    const targetWorldAnchors = transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
    const targetHash = buildAnchorHash(targetWorldAnchors, worldThreshold);

    for (const sourceAnchor of sourceWorldAnchors) {
      for (const targetAnchor of nearbyAnchors(targetHash, sourceAnchor.position, worldThreshold)) {
        const correction = targetAnchor.position.clone().sub(sourceAnchor.position);
        const distance = correction.length();
        if (distance > worldThreshold + EPSILON) continue;
        if (!anchorsCanMeet(sourceAnchor, targetAnchor)) continue;

        const normalAlignment = sourceAnchor.normal.dot(targetAnchor.normal);
        const betterDistance = distance < bestDistance - EPSILON;
        const equalDistanceBetterNormals = Math.abs(distance - bestDistance) <= EPSILON
          && normalAlignment < bestNormalAlignment;
        if (!betterDistance && !equalDistanceBetterNormals) continue;

        bestCorrection = correction;
        bestTargetId = target.id;
        bestDistance = distance;
        bestNormalAlignment = normalAlignment;
        bestSourceAnchorId = sourceAnchor.id ?? null;
        bestTargetAnchorId = targetAnchor.id ?? null;
        bestContactNormal = targetAnchor.normal.clone();
      }
    }
  }

  if (!bestCorrection || !bestContactNormal) return unchanged;
  const snappedPosition = sourcePosition.clone().add(bestCorrection);
  return {
    position: [snappedPosition.x, snappedPosition.y, snappedPosition.z],
    targetId: bestTargetId,
    distance: bestDistance,
    sourceAnchorId: bestSourceAnchorId,
    targetAnchorId: bestTargetAnchorId,
    contactNormal: [bestContactNormal.x, bestContactNormal.y, bestContactNormal.z]
  };
}

export function findObjectSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const sourceTarget = surfaceSnapTargetFromSceneObject(source);
  if (!sourceTarget) {
    return {
      position: [...source.position] as Vec3,
      targetId: null,
      distance: Number.POSITIVE_INFINITY,
      sourceAnchorId: null,
      targetAnchorId: null
    };
  }
  const threshold = Math.min(0.12, Math.max(0.04, Math.abs(positionStep) * 0.4));
  const targets = [
    ...objects.flatMap((object) => {
      const target = surfaceSnapTargetFromSceneObject(object);
      return target ? [target] : [];
    }),
    ...additionalTargets
  ];
  return findSurfaceTargetSnap(
    sourceTarget,
    targets,
    new THREE.Vector3(...source.position),
    threshold
  );
}

export function snapObjectToObjectSurfaces(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): Vec3 {
  return findObjectSurfaceSnap(source, objects, positionStep, additionalTargets).position;
}
