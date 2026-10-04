import { FACE_SLOTS, defaultNativeFace, changeNativeSlot, parseNativeFace } from '../nativeFaces';
import type { FaceSlot, FaceVariant } from '../nativeFaces';
import type { NativePoseId } from '../nativePoses';

/** Compatibility proposal API: validated states → native presets, explicitly a
 * stylistic replacement, not an exact translation of 1024 positions/geometry.
 * Original transforms must remain in the migration archive. No renderer import.
 */
export function mapLegacyFace(version: 1 | 2, poseId: NativePoseId,
  input: Partial<Record<FaceSlot, { state: string; visible?: boolean; x: number; y: number; width: number; height: number }>>) {
  if (version !== 1 && version !== 2) throw Error('Unbekannte Legacy-Rig-Version.');
  let face = defaultNativeFace(poseId, `legacy-v${version}`);
  for (const [slot, value] of Object.entries(input)) {
    if (!FACE_SLOTS.includes(slot as FaceSlot) || !value || Object.keys(value).some((k) => !['state', 'visible', 'x', 'y', 'width', 'height'].includes(k)) ||
      ![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0 ||
      (value.visible !== undefined && typeof value.visible !== 'boolean')) throw Error('Ungültiger Legacy-Face-Slot.');
    face = changeNativeSlot(face, slot as FaceSlot, { variant: value.state as FaceVariant, visible: value.visible ?? true });
  }
  face = parseNativeFace({ ...face, origin: { rigVersion: version, baseKind: version === 1 ? 'original-pose' : 'face-free', placement: 'native-preset' } });
  return { face, status: 'lossy' as const, requiresApproval: true as const,
    warnings: ['Native Neuplatzierung; originale Positionen, Skalierung und gesichtsfreie Basis bleiben im Archiv.'] };
}
/** Combined eyes/mouth addons become independently editable native slots.
 * Nonzero Legacy offsets are retained by the caller's archive/report, never
 * silently represented as exact native placement.
 */
export function mapLegacyAddons(poseId: NativePoseId, addonRoot: string,
  input: { eyes?: string | { state: string; dx?: number; dy?: number } | null;
    mouth?: string | { state: string; dx?: number; dy?: number } | null }) {
  if (!['addons', 'addons_cleaned', 'addons_normalized'].includes(addonRoot)) throw Error('Unbekannter Addon-Darstellungskontext.');
  let face = defaultNativeFace(poseId);
  for (const [part, value] of Object.entries(input)) {
    if (!['eyes', 'mouth'].includes(part)) throw Error('Unbekanntes Addon.');
    const slots: readonly FaceSlot[] = part === 'eyes' ? ['leftEye', 'rightEye'] : ['mouth'];
    if (value === null) { for (const slot of slots) face = changeNativeSlot(face, slot, { visible: false }); continue; }
    if (value === undefined) continue;
    const state = typeof value === 'string' ? value : value.state;
    if (typeof value === 'object' && (Object.keys(value).some((k) => !['state', 'dx', 'dy'].includes(k)) ||
      [value.dx, value.dy].some((n) => n !== undefined && !Number.isFinite(n)))) throw Error('Ungültige Addon-Position.');
    for (const slot of slots) face = changeNativeSlot(face, slot, { variant: state as FaceVariant, visible: true });
  }
  return { face, addonRoot, status: 'lossy' as const, requiresApproval: true as const,
    warnings: ['Addon-Familie, Originalassets und 1024er Offsets müssen im Archiv erhalten bleiben; native Presets ersetzen die Platzierung.'] };
}
