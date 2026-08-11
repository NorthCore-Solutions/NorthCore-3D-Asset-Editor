import type { PaintTextureData } from '../../types/editor';
import type { SurfaceUvAtlas } from '../../geometry/uvAtlas';
import { createPaintTextureData, type SurfaceRasterMetric } from './surfacePaintGrid';

export function createPaintDocument(
  layers: HTMLCanvasElement[],
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): PaintTextureData {
  const created = createPaintTextureData(layers, atlas, metrics, baseColor);
  return created.surfaceGrid
    ? {
        ...created,
        surfaceGrid: {
          ...created.surfaceGrid,
          baseColor: baseColor.toUpperCase()
        }
      }
    : created;
}

export function paintTextureNeedsMigration(
  texture: PaintTextureData | undefined,
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): boolean {
  if (!texture) return false;
  const storedGrid = texture.surfaceGrid;
  return !storedGrid
    || storedGrid.version !== 2
    || storedGrid.atlasSignature !== atlas.signature
    || storedGrid.baseColor?.toUpperCase() !== baseColor.toUpperCase()
    || !storedGrid.sourceDataUrl
    || !storedGrid.sourceWidth
    || !storedGrid.sourceHeight
    || storedGrid.surfaces.length !== metrics.length
    || storedGrid.surfaces.some((stored, index) => {
      const metric = metrics[index];
      return !metric
        || !stored.sourceWidth
        || !stored.sourceHeight
        || stored.width !== metric.width
        || stored.height !== metric.height
        || Math.abs(stored.coverageU - metric.coverageU) > 0.000001
        || Math.abs(stored.coverageV - metric.coverageV) > 0.000001;
    });
}
