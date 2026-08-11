import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ADDITION, Brush, Evaluator } from 'three-bvh-csg';
import { isWaterTight } from 'three-bvh-csg/src/utils/isWaterTight.js';
import { HalfEdgeMap } from 'three-bvh-csg/src/core/HalfEdgeMap.js';
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

// Vollständig geprüfte, begründete Typdefinition statt Whitelist: Alle aktuell
// erzeugbaren Formtypen außer 'plane' liefern über createGeometry() nachweislich
// geschlossene, wasserdichte Volumenkörper (isWaterTight = true, Volumen > 0;
// durch tests/unionExport.test.ts für jeden Typ abgesichert). 'plane' ist eine
// beidseitige Fläche ohne Volumen (Volumen = 0), also kein Solide, und kann
// nicht an einer booleschen Union teilnehmen.
const NON_SOLID_TYPES = new Set<PrimitiveType>(['plane']);

export function filterExportObjects(objects: SceneObjectData[], selectedId: string | null, selectionOnly: boolean): SceneObjectData[] {
  return objects.filter((object) => object.visible && (!selectionOnly || object.id === selectedId));
}

function isUnionEligible(object: SceneObjectData): boolean {
  return !NON_SOLID_TYPES.has(object.type)
    && object.material.opacity > 0;
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
      warnings.push('Union benötigt mindestens zwei geschlossene Volumenkörper. Der Export bleibt für diese Auswahl getrennt.');
    }
    if (unionSeparate > 0) {
      warnings.push(`${unionSeparate} nicht union-fähige${unionSeparate === 1 ? 's' : ''} Objekt${unionSeparate === 1 ? '' : 'e'} (z. B. Ebene oder vollständig transparent) ${unionSeparate === 1 ? 'wird' : 'werden'} separat exportiert.`);
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
      // Dieselbe Konvention wie die Paint-Texturen im Editor (flipY = true,
      // siehe useSurfacePaintGrid): Der Oberflächenatlas legt seine UV-Inseln in
      // three.js-Konvention an (v = 1 = Bild-Oberkante). Der GLTFExporter
      // spiegelt Bilder mit flipY = true beim Einbetten in die glTF-Konvention
      // (v = 0 = Bild-Oberkante) – mit flipY = false bliebe das Bild
      // ungespiegelt und jede Insel würde den vertikal gespiegelten
      // Atlasbereich anzeigen (z. B. „Rechts" als „Unten").
      texture.flipY = true;
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
    // Position, Normalen und UVs gehen in die CSG-Pipeline. Die UVs werden vom
    // Evaluator (attributes: ['position', 'normal', 'uv']) durch die boolesche
    // Operation interpoliert, damit Bemalungen auf den erhaltenen Oberflächen
    // korrekt bleiben. Alle übrigen Attribute werden verworfen.
    for (const attributeName of Object.keys(geometry.attributes)) {
      if (attributeName !== 'position' && attributeName !== 'normal' && attributeName !== 'uv') geometry.deleteAttribute(attributeName);
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
  // Die von der CSG-Operation interpolierten Normalen bleiben erhalten, damit
  // die Oberflächen wie im Editor schattiert werden.
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
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

// Ein Union-Schritt zweier Brushes. Der Legacy-Splitter liefert für polyedrische
// Körper die bisher validierte Triangulierung (z. B. exakt aneinanderliegende
// Würfel) und bleibt deshalb der Standard. An gekrümmten Schnittkurven (Kugel,
// Halbkugel, Torus, …) kann er jedoch haarfeine Risse hinterlassen; dann
// trianguliert der CDT-Splitter die Schnittbereiche robust neu. Der CDT-Splitter
// ist in koplanaren Sonderfällen wiederum von der Operandenreihenfolge abhängig,
// deshalb wird nötigenfalls auch die getauschte Reihenfolge geprüft. Maßgeblich
// ist stets das Ergebnis: Akzeptiert wird die erste wasserdichte Geometrie mit
// intakter UV-Zuordnung; scheitern alle Varianten, gewinnt die mit den wenigsten
// unverbundenen Kanten.
function unmatchedEdgeCount(geometry: THREE.BufferGeometry): number {
  const halfEdges = new HalfEdgeMap();
  halfEdges.matchDisjointEdges = true;
  halfEdges.updateFrom(geometry);
  return halfEdges.unmatchedEdges;
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

// Die CSG-Operation darf UVs nur innerhalb der Eingabewerte interpolieren.
// Ein Kandidat ohne UVs, mit NaN oder mit Werten außerhalb des Eingaberahmens
// hätte die semantische Fläche-zu-Atlas-Insel-Zuordnung zerstört und wird
// deshalb nicht akzeptiert, solange eine bessere Variante existiert.
function hasConsistentUvs(result: Brush, sources: Brush[]): boolean {
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

function evaluateUnionStep(evaluator: Evaluator, a: Brush, b: Brush): Brush {
  const candidates: Brush[] = [];
  const accept = (candidate: Brush): Brush => {
    candidates.forEach((rejected) => rejected.geometry.dispose());
    candidates.length = 0;
    return candidate;
  };

  const legacyResult: Brush = evaluator.evaluate(a, b, ADDITION);
  legacyResult.updateMatrixWorld(true);
  if (isWaterTight(legacyResult.geometry) && hasConsistentUvs(legacyResult, [a, b])) return legacyResult;
  candidates.push(legacyResult);

  evaluator.useCDTClipping = true;
  try {
    for (const [first, second] of [[a, b], [b, a]] as const) {
      const cdtResult: Brush = evaluator.evaluate(first, second, ADDITION);
      cdtResult.updateMatrixWorld(true);
      if (isWaterTight(cdtResult.geometry) && hasConsistentUvs(cdtResult, [a, b])) return accept(cdtResult);
      candidates.push(cdtResult);
    }
  } finally {
    evaluator.useCDTClipping = false;
  }

  // Kein Kandidat ist wasserdicht mit intakten UVs: erst Wasserdichtigkeit
  // (wenigste unverbundene Kanten), bei Gleichstand UV-Konsistenz berücksichtigen.
  candidates.sort((left, right) => {
    const edgeDifference = unmatchedEdgeCount(left.geometry) - unmatchedEdgeCount(right.geometry);
    if (edgeDifference !== 0) return edgeDifference;
    return Number(hasConsistentUvs(right, [a, b])) - Number(hasConsistentUvs(left, [a, b]));
  });
  return accept(candidates[0]!);
}

function evaluateUnionBrushes(
  unionObjects: SceneObjectData[],
  paintTextures: Map<string, THREE.Texture>,
  resources?: ExportResources
): Brush {
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal', 'uv'];
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

    const nextResult = evaluateUnionStep(evaluator, result, brush);
    if (resources) {
      resources.geometries.add(nextResult.geometry);
      unionMaterials(nextResult).forEach((resultMaterial) => resources.materials.add(resultMaterial));
    }
    result = nextResult;
  }

  if (!result) throw new Error('Es konnten keine Volumenkörper für die Union vorbereitet werden.');
  return result;
}

// Erzeugt das vereinigte Mesh der union-fähigen Objekte. Die Welttransformation
// der Quellobjekte ist in der Geometrie gebacken, das Mesh selbst steht damit
// auf einer sauberen lokalen Identitätstransformation.
export function computeUnionMesh(objects: SceneObjectData[], paintTextures: Map<string, THREE.Texture> = new Map()): THREE.Mesh {
  const unionObjects = objects.filter(isUnionEligible);
  if (unionObjects.length < 2) {
    throw new Error('Union benötigt mindestens zwei geschlossene Volumenkörper.');
  }

  const result = evaluateUnionBrushes(unionObjects, paintTextures);
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
