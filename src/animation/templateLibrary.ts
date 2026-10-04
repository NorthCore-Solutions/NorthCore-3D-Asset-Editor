import type { Point } from './raster';
import type { Pixel } from './legacy';
export type LegacyTemplate = { id: string; name: string; width: number; height: number; pixels: Pixel[]; origin: Point };

/** The existing Dart FinoTemplateLibrary format; no image conversion. */
export function encodeTemplates(templates: LegacyTemplate[]): string {
  return JSON.stringify(
    {
      version: 1,
      templates: templates.map(({ origin, ...t }) => ({ ...t, originX: origin.x, originY: origin.y })),
    },
    null,
    2
  );
}
export function decodeTemplates(json: string): LegacyTemplate[] {
  const data = JSON.parse(json) as {
    version: number;
    templates: {
      id: string;
      name: string;
      width: number;
      height: number;
      originX: number;
      originY: number;
      pixels: Pixel[];
    }[];
  };
  if (data.version !== 1 || !Array.isArray(data.templates)) throw Error('Ungültige Vorlagenbibliothek.');
  return data.templates.map((t) => {
    if (
      typeof t.id !== 'string' ||
      typeof t.name !== 'string' ||
      ![t.width, t.height, t.originX, t.originY].every(Number.isInteger) ||
      t.width < 1 ||
      t.height < 1 ||
      t.width > 1024 ||
      t.height > 1024 ||
      !Array.isArray(t.pixels) ||
      t.pixels.some(
        (p) =>
          ![p.x, p.y, p.rgba].every(Number.isInteger) ||
          p.x < 0 ||
          p.x >= t.width ||
          p.y < 0 ||
          p.y >= t.height ||
          p.rgba < 0 ||
          p.rgba > 0xffffffff
      )
    )
      throw Error('Ungültige Pixel-Vorlage.');
    return {
      id: t.id,
      name: t.name,
      width: t.width,
      height: t.height,
      origin: { x: t.originX, y: t.originY },
      pixels: t.pixels,
    };
  });
}
