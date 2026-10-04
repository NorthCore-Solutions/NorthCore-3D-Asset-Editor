import catalog from './data/poses/catalog.json';
import neutral from './data/poses/standing_neutral.json';
import active from './data/poses/standing_active.json';
import sitting from './data/poses/sitting_relaxed.json';
import sleeping from './data/poses/sleeping.json';
import reading from './data/poses/reading.json';
import eating from './data/poses/eating.json';
import faces from './data/faces/catalog.json';

export type NativePoseId = 'standing_neutral' | 'standing_active' | 'sitting_relaxed' | 'sleeping' | 'reading' | 'eating';
export type PoseSourceId = 'fino-standing-neutral-128' | 'fino-standing-active-128' | 'fino-sitting-relaxed-128' |
  'fino-sleeping-128' | 'fino-reading-128' | 'fino-eating-128';
export type NativePoseReference = { readonly poseId: NativePoseId; readonly assetVersion: number; readonly pixelSha256: string };
type Asset = { assetVersion: number; width: number; height: number; pixels: number[][] };
const assets: Record<NativePoseId, Asset> = { standing_neutral: neutral, standing_active: active, sitting_relaxed: sitting, sleeping, reading, eating };
export const NATIVE_POSES = Object.freeze(catalog.poses.map((entry) => Object.freeze({
  ...entry, id: entry.id as NativePoseId, sourceId: entry.sourceId as PoseSourceId,
  width: 128 as const, height: 128 as const,
  provenance: Object.freeze({ kind: 'native-pixel-authored' as const, catalogVersion: catalog.catalogVersion, anchorSha256: catalog.anchorSha256 }),
  faceFree: Object.freeze({ ...faces.bases[entry.id as NativePoseId], assetVersion: 1, catalogVersion: faces.catalogVersion }),
})));
export function poseForSource(source: string) { return NATIVE_POSES.find((pose) => pose.sourceId === source); }
export function nativePosePixels(id: NativePoseId): ReadonlyMap<number, number> {
  // Fresh map: edits or accidental mutation in one document cannot alter catalog/other frames.
  return new Map(assets[id].pixels.map(([k, value]) => [k!, value!]));
}
export function poseReference(source: string): NativePoseReference | undefined {
  const pose = poseForSource(source);
  return pose && Object.freeze({ poseId: pose.id, assetVersion: pose.assetVersion, pixelSha256: pose.pixelSha256 });
}
/** Historical references remain valid after asset revisions; they never re-render saved pixels. */
export function parsePoseReference(value: unknown): NativePoseReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Ungültige native Pose-Herkunft.');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((k) => !['poseId', 'assetVersion', 'pixelSha256'].includes(k)) ||
    !NATIVE_POSES.some((pose) => pose.id === p.poseId) || !Number.isSafeInteger(p.assetVersion) || Number(p.assetVersion) < 1 ||
    typeof p.pixelSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.pixelSha256)) throw Error('Ungültige native Pose-Herkunft.');
  return Object.freeze({ poseId: p.poseId as NativePoseId, assetVersion: Number(p.assetVersion), pixelSha256: p.pixelSha256 });
}
