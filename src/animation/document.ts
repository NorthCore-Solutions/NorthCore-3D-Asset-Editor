/** Metadata only: no Legacy rendering or conversion semantics. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };
export type DocumentMetadata = {
  readonly id: string;
  readonly reactionState?: string;
  readonly provenance?: {
    readonly kind: 'native' | 'raster-v1' | 'legacy' | 'import';
    readonly sourceId?: string;
    readonly fileName?: string;
    readonly storageKey?: string;
    readonly sha256?: string;
    readonly archiveId?: string;
  };
  readonly migration?: {
    readonly reportVersion: 1;
    readonly stage: 'assessment' | 'conversion';
    readonly report: JsonObject;
    readonly archiveId?: string;
    readonly converter?: { readonly name: string; readonly version: string };
  };
  readonly legacy?: {
    readonly formatVersion: number;
    readonly rigVersion?: 1 | 2;
    readonly basePose: string;
    readonly definitionId?: string;
    readonly addonRoot?: string;
  };
};

function invalid(): never { throw Error('Ungültige Raster-Dokumentmetadaten.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value as Record<string, unknown>;
}
function fields(value: unknown, allowed: string[]) {
  const obj = object(value);
  if (Object.keys(obj).some((key) => !allowed.includes(key))) invalid();
  return obj;
}
function text(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) invalid();
}
function optionalTexts(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (key in obj) text(obj[key]);
}
function jsonCopy(value: unknown, depth = 0): JsonValue {
  if (depth > 64) invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item: unknown) => jsonCopy(item, depth + 1)));
  return Object.freeze(Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, jsonCopy(item, depth + 1)])));
}
/** Validate, detach from the caller, and deeply freeze for reference-based saved baselines. */
export function parseDocumentMetadata(value: unknown): DocumentMetadata {
  const data = fields(value, ['id', 'reactionState', 'provenance', 'migration', 'legacy']);
  text(data.id);
  if ('reactionState' in data && typeof data.reactionState !== 'string') invalid();
  if ('provenance' in data) {
    const p = fields(data.provenance, ['kind', 'sourceId', 'fileName', 'storageKey', 'sha256', 'archiveId']);
    if (typeof p.kind !== 'string' || !['native', 'raster-v1', 'legacy', 'import'].includes(p.kind)) invalid();
    optionalTexts(p, ['sourceId', 'fileName', 'storageKey', 'sha256', 'archiveId']);
    if ('sha256' in p && !/^[a-f0-9]{64}$/.test(String(p.sha256))) invalid();
  }
  if ('migration' in data) {
    const m = fields(data.migration, ['reportVersion', 'stage', 'report', 'archiveId', 'converter']);
    if (m.reportVersion !== 1 || typeof m.stage !== 'string' || !['assessment', 'conversion'].includes(m.stage)) invalid();
    object(m.report);
    optionalTexts(m, ['archiveId']);
    if ('converter' in m) {
      const c = fields(m.converter, ['name', 'version']);
      text(c.name); text(c.version);
    }
  }
  if ('legacy' in data) {
    const l = fields(data.legacy, ['formatVersion', 'rigVersion', 'basePose', 'definitionId', 'addonRoot']);
    if (!Number.isSafeInteger(l.formatVersion) || Number(l.formatVersion) < 1) invalid();
    if ('rigVersion' in l && l.rigVersion !== 1 && l.rigVersion !== 2) invalid();
    text(l.basePose);
    optionalTexts(l, ['definitionId', 'addonRoot']);
  }
  return jsonCopy(data) as DocumentMetadata;
}
export function newDocumentMetadata(): DocumentMetadata {
  return parseDocumentMetadata({ id: crypto.randomUUID(), provenance: { kind: 'native' } });
}
/** Stable ordering for comparisons and V1 content identities; arrays retain their order. */
export function canonicalMetadata(value: unknown): string {
  return JSON.stringify(jsonCopySorted(value));
}
function jsonCopySorted(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map((item: unknown) => jsonCopySorted(item));
  if (value && typeof value === 'object') {
    const obj = object(value);
    return Object.fromEntries(Object.keys(obj).sort().map((key) => [key, jsonCopySorted(obj[key])]));
  }
  return jsonCopy(value);
}
/** FNV-1a 128 content identity, not an archive checksum. No random/time/UI inputs. */
export function upgradeV1Metadata(content: unknown, sourceId: string): DocumentMetadata {
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  for (const byte of new TextEncoder().encode(canonicalMetadata(content))) {
    hash = BigInt.asUintN(128, (hash ^ BigInt(byte)) * 0x1000000000000000000013bn);
  }
  return parseDocumentMetadata({
    id: `raster-v1-${hash.toString(16).padStart(32, '0')}`,
    provenance: { kind: 'raster-v1', sourceId },
  });
}
