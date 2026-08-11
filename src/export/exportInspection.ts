import * as THREE from 'three';
import { createGeometry, triangleCount } from '../geometry/factory';
import type { PrimitiveType, SceneObjectData } from '../types/editor';
import type { ExportGeometryMode, ExportReport } from './exportTypes';

// Alle aktuellen Formtypen außer 'plane' sind durch die Union-Tests als
// geschlossene Volumenkörper abgesichert. 'plane' besitzt kein Volumen.
const NON_SOLID_TYPES = new Set<PrimitiveType>(['plane']);

export function filterExportObjects(
  objects: SceneObjectData[],
  selectedId: string | null,
  selectionOnly: boolean
): SceneObjectData[] {
  return objects.filter((object) => object.visible && (!selectionOnly || object.id === selectedId));
}

export function isUnionEligible(object: SceneObjectData): boolean {
  return !NON_SOLID_TYPES.has(object.type) && object.material.opacity > 0;
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
