import type { PaintTextureData } from '../../types/editor';
import type { SurfaceUvAtlas } from '../../geometry/uvAtlas';
import { createPaintTextureData, type SurfaceRasterMetric } from './surfacePaintGrid';

export function withPaintBaseColor(
  texture: PaintTextureData | undefined,
  baseColor: string
): PaintTextureData | undefined {
  if (!texture?.surfaceGrid) return texture;
  return {
    ...texture,
    surfaceGrid: {
      ...texture.surfaceGrid,
      baseColor: baseColor.toUpperCase()
    }
  };
}

export function createPaintDocument(
  layers: HTMLCanvasElement[],
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): PaintTextureData {
  return withPaintBaseColor(
    createPaintTextureData(layers, atlas, metrics, baseColor),
    baseColor
  )!;
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
