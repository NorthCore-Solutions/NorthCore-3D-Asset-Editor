import { production, blankLayer } from '../raster';
import type { Pixels } from '../raster';
import { applyRasterOperation, createRasterRecipe, newRasterOperation } from '../rasterOperations';
import type { RasterMask, RasterOperation, RasterRecipe } from '../rasterOperations';
import type { LegacyInventory } from './legacyAudit';

export type LegacyOperationMapping = {
  version: 1; disposition: 'replayable' | 'baked-not-replayable' | 'blocked'; reason: string;
  operations: { index: number; type: string; disposition: 'replayable' | 'baked-not-replayable' | 'blocked'; reason: string }[];
  recipe?: RasterRecipe;
};
type Evidence = { nativeBase: Pixels; baseId: string; legacyStagesRgba?: readonly Uint8Array[] };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const grid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n % 8 === 0;
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const exported = (pixels: Pixels) => production([{ ...blankLayer('mapping-proof'), pixels }]);
class MappingBlockedError extends Error {}
/** Mapping is opt-in and evidence-based. No Legacy renderer/runtime import.
 * Every intermediate 1024 RGBA result must equal the normal 8x export of its
 * native counterpart; end-state coincidence alone never proves editability.
 */
export function mapLegacyOperations(operations: readonly unknown[], known: LegacyInventory, evidence: Evidence): LegacyOperationMapping {
  const reports: LegacyOperationMapping['operations'] = [], candidates: RasterOperation[] = [];
  const report = (index: number, type: string, disposition: 'baked-not-replayable' | 'blocked', reason: string) => {
    reports.push({ index, type, disposition, reason });
  };
  const mask = (v: unknown): RasterMask => {
    if (!isObject(v)) throw new MappingBlockedError('Ungültige Legacy-Maske.');
    if (v.type === 'rect') {
      if (Object.keys(v).some((k) => !['type', 'x', 'y', 'width', 'height'].includes(k))) throw new MappingBlockedError('Unbekannte Maskenfelder.');
      if (![v.x, v.y, v.width, v.height].every(grid)) throw Error('Maskengrenzen schneiden native 8×8-Blöcke.');
      return { type: 'rect', x: Number(v.x) / 8, y: Number(v.y) / 8, width: Number(v.width) / 8, height: Number(v.height) / 8 };
    }
    if (v.type === 'polygon' && Array.isArray(v.points) && v.points.length >= 3) {
      if (Object.keys(v).some((k) => !['type', 'points'].includes(k))) throw new MappingBlockedError('Unbekannte Maskenfelder.');
      const points = v.points.map((p: unknown) => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(grid)) throw Error('Polygon nicht nativ rasterkompatibel.');
        return [Number(p[0]), Number(p[1])] as const;
      });
      if (points.some(([x, y], i) => { const next = points[(i + 1) % points.length]!; return x !== next[0] && y !== next[1]; }))
        throw Error('Diagonale Polygonkante kann 8×8-Blöcke schneiden.');
      return { type: 'polygon', points: points.map(([x, y]) => [x / 8, y / 8] as const) };
    }
    throw new MappingBlockedError('Unbekannte oder ungültige Legacy-Maske.');
  };
  for (const [index, value] of operations.entries()) {
    if (!isObject(value) || typeof value.type !== 'string') { report(index, 'unknown', 'blocked', 'Ungültige Operation.'); continue; }
    const family = known.operations.find((f) => f.type === value.type);
    if (!family || Object.keys(value).some((k) => !family.fields.includes(k))) {
      report(index, value.type, 'blocked', 'Operation/Feld nicht im bestätigten Inventar.'); continue;
    }
    const geometry = value.type === 'moveRegion' ? value.rect : value.mask;
    const geometryType = value.type === 'moveRegion' ? 'rect' : isObject(geometry) ? geometry.type : undefined;
    const geometryFields = geometryType === 'rect' ? ['x', 'y', 'width', 'height', ...(value.type === 'moveRegion' ? [] : ['type'])] :
      geometryType === 'polygon' ? ['type', 'points'] : [];
    if (!isObject(geometry) || !geometryFields.length || Object.keys(geometry).some((k) => !geometryFields.includes(k))) {
      report(index, value.type, 'blocked', 'Unbekannte oder ungültige Geometrie/Felder.'); continue;
    }
    if (value.type === 'moveSelection') {
      const area = value.vacatedArea, fill = (isObject(area) ? area.strategy : area) ?? family.defaultStrategy;
      if ((isObject(area) && Object.keys(area).some((k) => !known.unions.vacatedArea.objectFields.includes(k))) ||
        !family.strategies?.some((s) => s === fill)) {
        report(index, value.type, 'blocked', 'Unbekannte Füllstrategie/Felder.'); continue;
      }
    }
    try {
      let candidate: RasterOperation;
      if (value.type === 'stretchSelection') {
        const sx = value.sx ?? 0, sy = value.sy ?? 0, scope = value.scope ?? family.defaultScope;
        if (!family.scopes?.some((s) => s === scope)) { report(index, value.type, 'blocked', 'Unbekannter Stretch-Bereich.'); continue; }
        if (!grid(sx) || !grid(sy)) throw Error('Subpixel-Stretch (z. B. Atmen 1–2 Legacy-Pixel) bleibt gebacken; keine Rundung auf Null.');
        const m = mask(value.mask);
        if (m.type !== 'rect') throw Error('Inklusive Legacy-Polygon-Bounds sind nicht durch acht teilbar.');
        candidate = newRasterOperation({ type: 'stretchSelection', mask: m, sx: sx / 8, sy: sy / 8, scope }, `legacy-op-${index}`);
      } else {
        const dx = value.dx ?? 0, dy = value.dy ?? 0;
        if (!grid(dx) || !grid(dy)) throw Error('Verschiebung unterhalb des nativen Rasters bleibt gebacken.');
        if (value.type === 'moveRegion') {
          if (!isObject(value.rect)) throw Error('Ungültige Region.');
          if (Object.keys(value.rect).some((k) => !['x', 'y', 'width', 'height'].includes(k))) throw new MappingBlockedError('Unbekannte Region-Felder.');
          const m = mask({ ...value.rect, type: 'rect' });
          if (m.type !== 'rect') throw Error('Ungültige Region.');
          const { x, y, width, height } = m;
          candidate = newRasterOperation({ type: 'moveRegion', rect: { x, y, width, height }, dx: dx / 8, dy: dy / 8 }, `legacy-op-${index}`);
        } else {
          const area = value.vacatedArea;
          if (isObject(area) && Object.keys(area).some((k) => !known.unions.vacatedArea.objectFields.includes(k))) {
            report(index, value.type, 'blocked', 'Unbekanntes Füllstrategiefeld.'); continue;
          }
          const fill = (isObject(area) ? area.strategy : area) ?? family.defaultStrategy;
          if (!family.strategies?.some((s) => s === fill)) { report(index, value.type, 'blocked', 'Unbekannte Füllstrategie.'); continue; }
          candidate = newRasterOperation({ type: 'moveSelection', mask: mask(value.mask), dx: dx / 8, dy: dy / 8, fill }, `legacy-op-${index}`);
        }
      }
      candidates.push(candidate);
      report(index, value.type, 'baked-not-replayable', 'Native Parameter möglich; jeder Zwischenschritt benötigt einen bytegleichen Nachweis.');
    } catch (error) { report(index, value.type, error instanceof MappingBlockedError ? 'blocked' : 'baked-not-replayable', error instanceof Error ? error.message : 'Nicht abbildbar.'); }
  }
  if (reports.some((r) => r.disposition === 'blocked')) return { version: 1, disposition: 'blocked', reason: 'Unbekannte/ungültige Semantik.', operations: reports };
  if (candidates.length !== operations.length) return { version: 1, disposition: 'baked-not-replayable', reason: 'Mindestens eine Operation nicht nativ abbildbar.', operations: reports };
  if (candidates.length > 256) return { version: 1, disposition: 'baked-not-replayable', reason: 'Mehr Operations als die native Replay-Grenze von 256.', operations: reports };
  const stages = evidence.legacyStagesRgba;
  if (!evidence.baseId.trim() || !stages || stages.length !== operations.length + 1 || stages.some((s) => s.length !== 1024 * 1024 * 4))
    return { version: 1, disposition: 'baked-not-replayable', reason: 'Eindeutige native Basis oder vollständige Zwischenschritt-Nachweise fehlen.', operations: reports };
  let current = evidence.nativeBase;
  if (!equal(exported(current), stages[0]!)) return { version: 1, disposition: 'baked-not-replayable', reason: 'Quellbasis ist nicht bytegleich als native Pixelbasis darstellbar.', operations: reports };
  for (const [index, op] of candidates.entries()) {
    current = applyRasterOperation(current, op);
    if (!equal(exported(current), stages[index + 1]!)) {
      reports[index]!.reason = 'Native Operation ist nicht bytegleich zum Legacy-Zwischenschritt.';
      return { version: 1, disposition: 'baked-not-replayable', reason: reports[index]!.reason, operations: reports };
    }
  }
  return { version: 1, disposition: 'replayable', reason: 'Rastergrenzen und sämtliche RGBA-Zwischenschritte verifiziert.',
    operations: reports.map((r) => ({ ...r, disposition: 'replayable', reason: 'Bytegleich verifiziert.' })),
    recipe: createRasterRecipe(evidence.nativeBase, candidates, evidence.baseId) };
}
