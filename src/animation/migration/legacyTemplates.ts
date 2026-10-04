import { parseGlobalLibrary } from '../globalTemplateFormat';
import type { GlobalTemplateLibrary } from '../globalTemplateLibrary';
import { decodeTemplates } from '../templateLibrary';
import type { GlobalTemplate } from '../globalTemplateFormat';
import { canonicalJson, sha256 } from '../contentHash';
import { readLocalMigrationArchive } from './localMigration';
import type { SessionStorage } from '../storage';

export type LegacyTemplatePlan = {
  originalJson: string; sourceKey: string; sourceSha256: string; archiveId?: string;
  route: 'exact' | 'lossy' | 'blocked'; reportSha256: string;
  entries: { index: number; name: string; route: 'exact' | 'lossy' | 'blocked'; reason: string; template: GlobalTemplate | null }[];
};
const only = (v: unknown, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => keys.includes(k));
/** Templates are local rectangles, not complete 1024-canvas frames. No RGBA averaging. */
export async function prepareLegacyTemplates(originalJson: string, sourceKey: string, archiveId?: string): Promise<LegacyTemplatePlan> {
  if (!sourceKey.trim() || (archiveId !== undefined && !/^[a-f0-9]{64}$/.test(archiveId))) throw Error('Ungültige Legacy-Quellidentität.');
  const result: Omit<LegacyTemplatePlan, 'reportSha256'> = { originalJson, sourceKey, sourceSha256: await sha256(originalJson),
    ...(archiveId ? { archiveId } : {}), route: 'exact', entries: [] };
  try {
    const raw = JSON.parse(originalJson) as { version: number; templates: unknown[] };
    if (!only(raw, ['version', 'templates']) || raw.version !== 1 || !Array.isArray(raw.templates)) throw Error('Unbekanntes Legacy-Bibliotheksformat oder Feld.');
    const counts = new Map<string, number>();
    for (const value of raw.templates) {
      const id = (value as { id?: unknown } | null)?.id;
      if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [index, value] of raw.templates.entries()) {
      const name = typeof (value as { name?: unknown } | null)?.name === 'string' ? (value as { name: string }).name : `Vorlage ${index + 1}`;
      try {
        if (!only(value, ['id', 'name', 'width', 'height', 'originX', 'originY', 'pixels'])) throw Error('Unbekanntes Vorlagenfeld.');
        const t = decodeTemplates(JSON.stringify({ version: 1, templates: [value] }))[0]!;
        if (!t.id.trim() || !t.name.trim() || counts.get(t.id) !== 1 || ![t.origin.x, t.origin.y].every((v) => Number.isSafeInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER / 16))
          throw Error('Mehrdeutige Identität oder ungültiger Ursprung.');
        const pixels = new Map<number, number>();
        for (const p of t.pixels) {
          if (!only(p, ['x', 'y', 'rgba']) || pixels.has(p.y * t.width + p.x)) throw Error('Unbekannter oder doppelt belegter Pixel.');
          pixels.set(p.y * t.width + p.x, p.rgba);
        }
        const width = Math.ceil(t.width / 8), height = Math.ceil(t.height / 8), target: [number, number][] = [];
        let exact = [t.width, t.height, t.origin.x, t.origin.y].every((v) => v % 8 === 0);
        const sample = (x: number, y: number) => x >= t.width || y >= t.height ? 0 : pixels.get(y * t.width + x) ?? 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const rgba = sample(x * 8, y * 8);
          if (rgba !== 0) target.push([y * 128 + x, rgba]);
          for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) if (sample(x * 8 + dx, y * 8 + dy) !== rgba) exact = false;
        }
        const route = exact ? 'exact' : 'lossy';
        const template: GlobalTemplate = { id: t.id, name: t.name, width, height,
          origin: { x: Math.floor(t.origin.x / 8), y: Math.floor(t.origin.y / 8) }, pixels: target,
          provenance: { sourceKey, sourceSha256: result.sourceSha256, templateSha256: await sha256(canonicalJson(value)),
            originalId: t.id, originalName: t.name, originalOrigin: t.origin, originalSize: { width: t.width, height: t.height },
            route, algorithm: 'local-nearest-8-v1', ...(archiveId ? { archiveId } : {}) } };
        result.entries.push({ index, name, route, reason: exact ? 'Homogene 8×8-RGBA-Blöcke, Ursprung und Abmessungen ausgerichtet.' : 'Lokale Phase 0/0; Ränder mit transparentem RGBA 0 gepolstert; Ursprung abgerundet.', template });
      } catch (error) {
        result.entries.push({ index, name, route: 'blocked', reason: error instanceof Error ? error.message : String(error), template: null });
      }
    }
  } catch (error) {
    result.entries.push({ index: -1, name: sourceKey, route: 'blocked', reason: error instanceof Error ? error.message : String(error), template: null });
  }
  result.route = result.entries.some((e) => e.route === 'blocked') ? 'blocked' : result.entries.some((e) => e.route === 'lossy') ? 'lossy' : 'exact';
  return { ...result, reportSha256: await sha256(canonicalJson(result)) };
}
export async function prepareArchivedLegacyTemplates(archiveId: string, storage?: SessionStorage) {
  const { archive } = await readLocalMigrationArchive(archiveId, storage);
  if (!archive.original.library) throw Error('Archiv enthält keine Legacy-Bibliothek.');
  return prepareLegacyTemplates(archive.original.library.json, archive.original.source.name, archiveId);
}

/** Compatibility owns revalidation and consent; the native library only installs pixel templates. */
export async function migrateLegacyTemplates(library: GlobalTemplateLibrary, plan: LegacyTemplatePlan,
  approval?: { sourceSha256: string; reportSha256: string }) {
  const captured = structuredClone(plan);
  const verified = await prepareLegacyTemplates(captured.originalJson, captured.sourceKey, captured.archiveId);
  if (canonicalJson(verified) !== canonicalJson(captured)) throw Error('Legacy-Prüfbericht wurde verändert.');
  if (verified.route === 'blocked') throw Error('Blockierte Legacy-Vorlagen werden nicht übernommen.');
  await library.load();
  if (!library.loaded) throw Error(library.error ?? 'Bibliothek ist nicht geladen.');
  const prior = parseGlobalLibrary(library.exportJson()).migrations.find((r) => r.sourceSha256 === verified.sourceSha256);
  if (verified.route === 'lossy' && !(prior?.lossyApproved && prior.originalJson === verified.originalJson) &&
    (approval?.sourceSha256 !== verified.sourceSha256 || approval.reportSha256 !== verified.reportSha256))
    throw Error('Verlustbehaftete Vorlagen benötigen eine ausdrückliche Freigabe dieses Berichts.');
  return library.importTemplates(verified.entries.map((e) => e.template!), {
    sourceKey: verified.sourceKey, sourceSha256: verified.sourceSha256, originalJson: verified.originalJson,
    reportSha256: verified.reportSha256, route: verified.route, lossyApproved: verified.route === 'lossy',
    ...(verified.archiveId ? { archiveId: verified.archiveId } : {}),
  });
}
