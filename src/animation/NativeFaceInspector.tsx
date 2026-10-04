import { useState } from 'react';
import { InspectorSection } from './BuilderUI';
import { FACE_SLOTS, EYE_VARIANTS, MOUTH_VARIANTS } from './nativeFaces';
import { NATIVE_POSES } from './nativePoses';
import type { NativePoseId } from './nativePoses';
import type { FaceSlot, FaceVariant } from './nativeFaces';
import type { AnimationStore } from './store';

export function NativeFaceInspector({ store }: { store: AnimationStore }) {
  const [target, setTarget] = useState<NativePoseId>('standing_neutral');
  const [range, setRange] = useState('current');
  const [first, setFirst] = useState(1), [last, setLast] = useState(1);
  const [preserve, setPreserve] = useState(true);
  const [error, setError] = useState('');
  const run = (action: () => unknown) => { try { action(); setError(''); } catch (e) { setError(String(e)); } };
  const draft = store.faceDraft, slot = store.selectedFaceSlot, state = draft?.face.slots[slot];
  return <InspectorSection title="Natives Gesicht" info={null} defaultOpen={true}>
    <p>Vorschau auf gesichtsfreier Grundpose. Übernehmen backt normale Pixel-Layer; weitere Zeichnungen bleiben erhalten.</p>
    {!draft && <button disabled={!store.frame.pose || store.playing} onClick={() => run(() => store.beginFacePreview())}>
      {store.frame.nativeFace ? 'Gesicht bearbeiten' : 'Natives Gesicht vorbereiten'}</button>}
    {draft && state && <>
      <label>Face-Slot<select aria-label="Face-Slot" value={slot} onChange={(e) => store.selectFaceSlot(e.target.value as FaceSlot)}>
        {FACE_SLOTS.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Face-Variante<select aria-label="Face-Variante" value={state.variant}
        onChange={(e) => run(() => store.previewFaceSlot(slot, { variant: e.target.value as FaceVariant }))}>
        {(slot === 'mouth' ? MOUTH_VARIANTS : EYE_VARIANTS).map((v) => <option key={v}>{v}</option>)}</select></label>
      <label><input type="checkbox" aria-label="Face-Slot sichtbar" checked={state.visible}
        onChange={(e) => run(() => store.previewFaceSlot(slot, { visible: e.target.checked }))} /> Sichtbar</label>
      {(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field}
        <input type="number" aria-label={`Face ${field}`} step={1} min={field === 'x' || field === 'y' ? -128 : 1}
          max={field === 'x' || field === 'y' ? 127 : 128} value={state[field]}
          onChange={(e) => run(() => store.previewFaceSlot(slot, { [field]: Number(e.target.value) }))} /></label>)}
      <p>Die Kreise auf dem Canvas sind 44-CSS-Pixel-Griffe für Maus und Touch. Pan/Pinch bleiben verfügbar.</p>
      <button onClick={() => run(() => store.commitFacePreview())}>Gesicht übernehmen</button>
      <button onClick={() => store.cancelFacePreview()}>Gesichtsvorschau abbrechen</button>
    </>}
    <label><input type="checkbox" checked={store.preserveFaceOnSource} onChange={(e) => store.setPreserveFaceOnSource(e.target.checked)} /> Gesicht beim Grundpose-Wechsel behalten</label>
    <label>Retargeting-Ziel<select aria-label="Face Zielpose" value={target} onChange={(e) => setTarget(e.target.value as NativePoseId)}>
      {NATIVE_POSES.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
    <label>Frame-Bereich<select aria-label="Face Frame-Bereich" value={range} onChange={(e) => setRange(e.target.value)}>
      <option value="current">Aktueller Frame</option><option value="all">Alle Frames</option><option value="range">Gewählter Bereich</option>
    </select></label>
    {range === 'range' && <>
      <label>Von Frame<input aria-label="Face erster Frame" type="number" min={1} max={store.state.frames.length} value={first} onChange={(e) => setFirst(Number(e.target.value))} /></label>
      <label>Bis Frame<input aria-label="Face letzter Frame" type="number" min={1} max={store.state.frames.length} value={last} onChange={(e) => setLast(Number(e.target.value))} /></label>
    </>}
    <label><input type="checkbox" checked={preserve} onChange={(e) => setPreserve(e.target.checked)} /> Varianten, Sichtbarkeit und Größe erhalten</label>
    <button disabled={!!draft || store.playing || !store.frame.pose} onClick={() => run(() => store.retargetFacePose(target,
      range === 'current' ? store.state.index : range === 'all' ? 0 : first - 1,
      range === 'current' ? store.state.index : range === 'all' ? store.state.frames.length - 1 : last - 1, preserve))}>Gesicht auf Zielpose übertragen</button>
    {error && <p role="alert">{error}</p>}
  </InspectorSection>;
}
