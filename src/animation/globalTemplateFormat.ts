import type { Point } from './raster';

export type GlobalTemplate = {
  id: string; name: string; width: number; height: number; origin: Point;
  /** Local coordinates, fixed native 128 stride; holes are transparent. */
  pixels: [number, number][];
};
export type GlobalTemplateDocument = {
  format: 'northcore-raster128-library'; version: 1; templates: GlobalTemplate[];
};
export const emptyGlobalLibrary = (): GlobalTemplateDocument => ({ format: 'northcore-raster128-library', version: 1, templates: [] });
function bad(): never { throw Error('Ungültige globale Raster-Vorlagenbibliothek.'); }
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some((key) => !keys.includes(key))) bad();
  return obj;
}
const text = (v: unknown) => { if (typeof v !== 'string' || !v.trim()) bad(); };
const int = (v: unknown) => { if (!Number.isSafeInteger(v)) bad(); };
function point(v: unknown) { const p = fields(v, ['x', 'y']); int(p.x); int(p.y); }
function size(v: unknown, max: number) {
  const s = fields(v, ['width', 'height']);
  for (const n of [s.width, s.height]) { int(n); if (Number(n) < 1 || Number(n) > max) bad(); }
}
/** One format source for IndexedDB, backups and mutations; no editor state. */
export function parseGlobalLibrary(json: string): GlobalTemplateDocument {
  const d = fields(JSON.parse(json), ['format', 'version', 'templates', 'migrations']);
  if (d.format !== 'northcore-raster128-library' || d.version !== 1 || !Array.isArray(d.templates)) bad();
  const ids = new Set<string>(), names = new Set<string>();
  for (const value of d.templates) {
    const t = fields(value, ['id', 'name', 'width', 'height', 'origin', 'pixels', 'provenance']);
    text(t.id); text(t.name); size({ width: t.width, height: t.height }, 128); point(t.origin);
    if (ids.has(String(t.id)) || names.has(String(t.name)) || !Array.isArray(t.pixels)) bad();
    ids.add(String(t.id)); names.add(String(t.name));
    const pixels = new Set<number>();
    for (const p of t.pixels) {
      if (!Array.isArray(p) || p.length !== 2) bad();
      const k: unknown = p[0], rgba: unknown = p[1]; int(k); int(rgba);
      const index = Number(k), value = Number(rgba);
      if (index < 0 || index % 128 >= Number(t.width) || Math.floor(index / 128) >= Number(t.height) ||
        value < 0 || value > 0xffffffff || pixels.has(index)) bad();
      pixels.add(index);
    }
  }
  return { format: 'northcore-raster128-library', version: 1, templates: d.templates.map((value) => {
    const t = value as GlobalTemplate;
    return structuredClone({ id: t.id, name: t.name, width: t.width, height: t.height, origin: t.origin, pixels: t.pixels });
  }) };
}
