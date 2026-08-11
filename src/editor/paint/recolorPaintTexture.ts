import type { PaintTextureData } from '../../types/editor';
import type { SurfaceUvAtlas } from '../../geometry/uvAtlas';
import { loadSurfaceCanvases, type SurfaceRasterMetric } from './surfacePaintGrid';
import { createPaintDocument } from './paintDocument';

export async function recolorPaintTexture(
  texture: PaintTextureData,
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  nextBaseColor: string
): Promise<PaintTextureData> {
  const layers = await loadSurfaceCanvases(texture, atlas, metrics, nextBaseColor);
  return createPaintDocument(layers, atlas, metrics, nextBaseColor);
}
