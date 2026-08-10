import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ADDITION, Brush, Evaluator } from 'three-bvh-csg';
import { createGeometry, triangleCount } from '../geometry/factory';
import type { PrimitiveType, SceneObjectData } from '../types/editor';
import { safeFilename } from '../persistence/projectFile';

export type ExportGeometryMode = 'separate' | 'union';

export interface ExportReport {
  objects: SceneObjectData[];
  triangles: number;
  warnings: string[];
  unionEligible: number;
  unionSeparate: number;
}

interface ExportResources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}

const UNION_TYPES = new Set<PrimitiveType>([
  'box', 'cuboid', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'wedge', 'prism'
]);

export function filterExportObjects(objects: SceneObjectData[], selectedId: string | null, selectionOnly: boolean): SceneObjectData[] {
  return objects.filter((object) => object.visible && (!selectionOnly || object.id === selectedId));
}

function isUnionEligible(object: SceneObjectData): boolean {
  return UNION_TYPES.has(object.type)
    && object.material.opacity > 0
    && !object.material.paintTexture;
}

function liesBelowGround(object: SceneObjectData): boolean {
  const geometry = createGeometry(object);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox?.clone();
  geometry.dispose();
  if (!box) return false;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
  box.applyMatrix4(matrix);
  return box.min.y < -0.001;
}

export function inspectExport(
  objects: SceneObjectData[],
  selectedId: string | null,
  selectionOnly: boolean,
  geometryMode: ExportGeometryMode = 'separate'
): ExportReport {
  const filtered = filterExportObjects(objects, selectedId, selectionOnly);
  const triangles = filtered.reduce((sum, object) => sum + triangleCount(object), 0);
  const warnings: string[] = [];
  const unionEligible = filtered.filter(isUnionEligible).length;
  const unionSeparate = filtered.length - unionEligible;

  if (filtered.length === 0) warnings.push('Keine sichtbaren Objekte zum Exportieren.');
  if (triangles > 100_000) warnings.push('Sehr hohe Polygonzahl: über 100.000 Dreiecke.');
  if (filtered.some(liesBelowGround)) warnings.push('Mindestens ein Objekt liegt teilweise unterhalb der Bodenebene.');
  if (filtered.some((object) => object.material.opacity <= 0)) warnings.push('Mindestens ein Objekt ist vollständig transparent.');

  if (geometryMode === 'union') {
    if (unionEligible < 2) {
      warnings.push('Union benötigt mindestens zwei geschlossene, unbemalte Grundformen. Der Export bleibt für diese Auswahl getrennt.');
    }
    if (unionSeparate > 0) {
      warnings.push(`${unionSeparate} bemalte, nicht geschlossene oder nicht unterstützte Objekt${unionSeparate === 1 ? '' : 'e'} werden separat exportiert.`);
    }
  }

  return { objects: filtered, triangles, warnings, unionEligible, unionSeparate };
}

function loadTexture(dataUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => reject(new Error('Bemalungstextur konnte nicht geladen werden.'));
    image.src = dataUrl;
  });
}

async function loadPaintTextures(objects: SceneObjectData[]): Promise<Map<string, THREE.Texture>> {
  const urls = [...new Set(objects.map((object) => object.material.paintTexture?.dataUrl).filter((url): url is string => Boolean(url)))];
  const entries = await Promise.all(urls.map(async (url) => [url, await loadTexture(url)] as const));
  return new Map(entries);
}

function createMaterial(object: SceneObjectData, paintTextures: Map<string, THREE.Texture>): THREE.MeshStandardMaterial {
  const paintUrl = object.material.paintTexture?.dataUrl;
  const map = paintUrl ? paintTextures.get(paintUrl) ?? null : null;
  return new THREE.MeshStandardMaterial({
    color: map ? '#FFFFFF' : object.material.color,
    map,
    roughness: object.material.roughness,
    metalness: object.material.metalness,
    opacity: object.material.opacity,
    transparent: object.material.opacity < 1 || Boolean(map),
    alphaTest: map ? 0.001 : 0,
    flatShading: object.material.flatShading
  });
}

function objectMatrix(object: SceneObjectData): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
}

function createWorldGeometry(object: SceneObjectData, forUnion: boolean): THREE.BufferGeometry {
  const source = createGeometry(object);
  let geometry = source;

  if (forUnion && source.index) {
    geometry = source.toNonIndexed();
    source.dispose();
  }

  geometry.applyMatrix4(objectMatrix(object));

  if (forUnion) {
    for (const attributeName of Object.keys(geometry.attributes)) {
      if (attributeName !== 'position' && attributeName !== 'normal') geometry.deleteAttribute(attributeName);
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const count = geometry.index?.count ?? geometry.getAttribute('position').count;
    geometry.clearGroups();
    geometry.addGroup(0, count, 0);
    geometry.setDrawRange(0, count);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addSeparateMesh(
  group: THREE.Group,
  object: SceneObjectData,
  resources: ExportResources,
  paintTextures: Map<string, THREE.Texture>
): void {
  const geometry = createWorldGeometry(object, false);
  const material = createMaterial(object, paintTextures);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = object.name;
  resources.geometries.add(geometry);
  resources.materials.add(material);
  group.add(mesh);
}

function effectiveDrawRange(geometry: THREE.BufferGeometry): { start: number; count: number } {
  const total = geometry.index?.count ?? geometry.getAttribute('position').count;
  const start = Math.max(0, Math.min(total, geometry.drawRange.start));
  const requestedCount = Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : total - start;
  return { start, count: Math.max(0, Math.min(total - start, requestedCount)) };
}

function normalizeUnionGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
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
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const unionMaterials = (result: Brush): THREE.Material[] => (
  Array.isArray(result.material) ? result.material : [result.material]
);

function addUnionResult(group: THREE.Group, result: Brush, resources: ExportResources): void {
  const materials = unionMaterials(result);
  materials.forEach((material) => resources.materials.add(material));

  const geometry = normalizeUnionGeometry(result.geometry);
  if (!geometry) throw new Error('Die Union hat keine exportierbare Geometrie erzeugt.');
  resources.geometries.add(geometry);

  // Genau ein Mesh für das gesamte Union-Ergebnis. Unterschiedliche Materialien
  // bleiben als Gruppen innerhalb derselben Geometrie erhalten.
  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = 'Union';
  group.add(mesh);
}

function evaluateUnionBrushes(
  unionObjects: SceneObjectData[],
  paintTextures: Map<string, THREE.Texture>,
  resources?: ExportResources
): Brush {
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = true;

  let result: Brush | null = null;

  for (const object of unionObjects) {
    const geometry = createWorldGeometry(object, true);
    const material = createMaterial(object, paintTextures);
    const brush = new Brush(geometry, material);
    brush.name = object.name;
    brush.updateMatrixWorld(true);
    resources?.geometries.add(geometry);
    resources?.materials.add(material);

    if (!result) {
      result = brush;
      continue;
    }

    const nextResult: Brush = evaluator.evaluate(result, brush, ADDITION);
    nextResult.updateMatrixWorld(true);
    if (resources) {
      resources.geometries.add(nextResult.geometry);
      unionMaterials(nextResult).forEach((resultMaterial) => resources.materials.add(resultMaterial));
    }
    result = nextResult;
  }

  if (!result) throw new Error('Es konnten keine Grundformen für die Union vorbereitet werden.');
  return result;
}

// Erzeugt das vereinigte Mesh der union-fähigen Objekte. Die Welttransformation
// der Quellobjekte ist in der Geometrie gebacken, das Mesh selbst steht damit
// auf einer sauberen lokalen Identitätstransformation.
export function computeUnionMesh(objects: SceneObjectData[]): THREE.Mesh {
  const unionObjects = objects.filter(isUnionEligible);
  if (unionObjects.length < 2) {
    throw new Error('Union benötigt mindestens zwei geschlossene, unbemalte Grundformen.');
  }

  const result = evaluateUnionBrushes(unionObjects, new Map());
  const materials = unionMaterials(result);
  const geometry = normalizeUnionGeometry(result.geometry);
  if (!geometry) throw new Error('Die Union hat keine exportierbare Geometrie erzeugt.');

  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = 'Union';
  return mesh;
}

function addUnionMeshes(
  group: THREE.Group,
  objects: SceneObjectData[],
  resources: ExportResources,
  paintTextures: Map<string, THREE.Texture>
): void {
  const unionObjects = objects.filter(isUnionEligible);
  const separateObjects = objects.filter((object) => !isUnionEligible(object));

  if (unionObjects.length < 2) {
    objects.forEach((object) => addSeparateMesh(group, object, resources, paintTextures));
    return;
  }

  const result = evaluateUnionBrushes(unionObjects, paintTextures, resources);
  addUnionResult(group, result, resources);
  separateObjects.forEach((object) => addSeparateMesh(group, object, resources, paintTextures));
}

export async function exportGlb(
  objects: SceneObjectData[],
  filename: string,
  geometryMode: ExportGeometryMode = 'separate'
): Promise<Blob> {
  const group = new THREE.Group();
  const resources: ExportResources = {
    geometries: new Set<THREE.BufferGeometry>(),
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>()
  };

  try {
    const paintTextures = await loadPaintTextures(objects);
    paintTextures.forEach((texture) => resources.textures.add(texture));

    if (geometryMode === 'union') {
      addUnionMeshes(group, objects, resources, paintTextures);
    } else {
      objects.forEach((object) => addSeparateMesh(group, object, resources, paintTextures));
    }

    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(group, { binary: true, onlyVisible: true });
    if (!(result instanceof ArrayBuffer)) throw new Error('Der binäre GLB-Export hat kein ArrayBuffer erzeugt.');

    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(filename)}.glb`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return blob;
  } catch (error) {
    if (geometryMode === 'union') {
      const reason = error instanceof Error ? error.message : 'unbekannter Geometriefehler';
      throw new Error(`Union fehlgeschlagen: ${reason}`);
    }
    throw error;
  } finally {
    resources.geometries.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
    resources.textures.forEach((texture) => texture.dispose());
  }
}
