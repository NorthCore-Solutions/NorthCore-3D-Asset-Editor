import type { PrimitiveType } from '../types/editor';

export const SHAPE_DEFINITIONS: Array<{ type: PrimitiveType; label: string; category: 'Grundformen' | 'Gebäude' }> = [
  { type: 'box', label: 'Würfel', category: 'Grundformen' },
  { type: 'cuboid', label: 'Quader', category: 'Grundformen' },
  { type: 'sphere', label: 'Kugel', category: 'Grundformen' },
  { type: 'hemisphere', label: 'Halbkugel', category: 'Grundformen' },
  { type: 'cylinder', label: 'Zylinder', category: 'Grundformen' },
  { type: 'cone', label: 'Kegel', category: 'Grundformen' },
  { type: 'pyramid', label: 'Pyramide', category: 'Grundformen' },
  { type: 'plane', label: 'Ebene', category: 'Grundformen' },
  { type: 'torus', label: 'Torus', category: 'Grundformen' },
  { type: 'wedge', label: 'Keil', category: 'Grundformen' },
  { type: 'prism', label: 'Prisma', category: 'Grundformen' },
  { type: 'wall', label: 'Wand', category: 'Gebäude' },
  { type: 'floor', label: 'Bodenplatte', category: 'Gebäude' },
  { type: 'flatRoof', label: 'Flachdach', category: 'Gebäude' },
  { type: 'gableRoof', label: 'Satteldach', category: 'Gebäude' },
  { type: 'shedRoof', label: 'Pultdach', category: 'Gebäude' },
  { type: 'door', label: 'Tür', category: 'Gebäude' },
  { type: 'window', label: 'Fenster', category: 'Gebäude' },
  { type: 'column', label: 'Säule', category: 'Gebäude' },
  { type: 'chimney', label: 'Schornstein', category: 'Gebäude' },
  { type: 'stairs', label: 'Treppe', category: 'Gebäude' }
];

export function defaultGeometryForType(type: PrimitiveType): Record<string, number> {
  switch (type) {
    case 'sphere': return { radius: 0.65, widthSegments: 24, heightSegments: 16 };
    case 'hemisphere': return { radius: 0.75, widthSegments: 24, heightSegments: 12 };
    case 'cylinder': return { radiusTop: 0.5, radiusBottom: 0.5, height: 1.4, radialSegments: 20 };
    case 'cone': return { radius: 0.65, height: 1.5, radialSegments: 20 };
    case 'pyramid': return { radius: 0.8, height: 1.5, radialSegments: 4 };
    case 'plane': return { width: 2, height: 2 };
    case 'torus': return { radius: 0.65, tube: 0.22, radialSegments: 12, tubularSegments: 32 };
    case 'prism': return { width: 1.6, height: 1.2, depth: 1.8 };
    case 'wall': return { width: 3, height: 2.5, depth: 0.2 };
    case 'floor': return { width: 3, height: 0.2, depth: 3 };
    case 'flatRoof': return { width: 3.4, height: 0.25, depth: 3.4 };
    case 'gableRoof': return { width: 3.4, height: 1.2, depth: 3.4 };
    case 'shedRoof': return { width: 3.4, height: 0.9, depth: 3.4 };
    case 'door': return { width: 0.9, height: 2, depth: 0.15 };
    case 'window': return { width: 1.2, height: 1, depth: 0.12 };
    case 'column': return { radiusTop: 0.3, radiusBottom: 0.36, height: 2.5, radialSegments: 16 };
    case 'chimney': return { width: 0.55, height: 1.7, depth: 0.55 };
    case 'stairs': return { width: 2, height: 1.4, depth: 1.6, steps: 5 };
    case 'cuboid': return { width: 2, height: 1, depth: 1 };
    case 'wedge': return { width: 1.5, height: 1, depth: 1.5 };
    default: return { width: 1, height: 1, depth: 1 };
  }
}

export function defaultPositionForType(type: PrimitiveType): [number, number, number] {
  const y: Partial<Record<PrimitiveType, number>> = {
    sphere: 0.65,
    hemisphere: 0,
    cylinder: 0.7,
    cone: 0.75,
    pyramid: 0.75,
    plane: 0.002,
    torus: 0.9,
    wedge: 0,
    prism: 0,
    wall: 1.25,
    floor: 0.1,
    flatRoof: 3,
    gableRoof: 3.1,
    shedRoof: 3,
    door: 1,
    window: 1.4,
    column: 1.25,
    chimney: 0.85,
    stairs: 0
  };
  return [0, y[type] ?? 0.5, 0];
}
