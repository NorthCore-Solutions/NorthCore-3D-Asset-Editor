import { useState } from 'react';
import { InspectorSection } from './BuilderUI';
import { newRasterOperation, parseRasterMask, RASTER_FILLS, RASTER_STRETCH_SCOPES } from './rasterOperations';
import type { AnimationStore } from './store';
import type { RasterFill, RasterOperation, RasterStretchScope } from './rasterOperations';
import type { Frame } from './raster';
import type { Rect } from './raster';

export function RasterOperationsInspector({ store }: { store: AnimationStore }) {
  const [type, setType] = useState<RasterOperation['type']>('moveSelection');
  const [maskKind, setMaskKind] = useState<'rect' | 'polygon' | 'cells'>('rect');
  const [rect, setRect] = useState<Rect>({ x: 10, y: 10, width: 16, height: 16 });
  const [polygon, setPolygon] = useState('10,10\n26,10\n10,26');
  const [cells, setCells] = useState<readonly number[]>([]);
  const [x, setX] = useState(0), [y, setY] = useState(0);
  const [fill, setFill] = useState<RasterFill>('transparent');
  const [scope, setScope] = useState<RasterStretchScope>('mask');
  const [record, setRecord] = useState(false);
  const [editing, setEditing] = useState<{ id: string; frame: Frame; frames: readonly Frame[]; index: number; layerId: string; session: object } | null>(null);
  const [error, setError] = useState('');
  const recipe = store.layer?.recipe;
  const run = (fn: () => unknown) => { try { fn(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const edit = (op: RasterOperation) => {
    setEditing({ id: op.id, frame: store.frame, frames: store.state.frames, index: store.state.index,
      layerId: store.state.active, session: store.capturePlaybackDocument() }); setType(op.type);
    const mask = op.type === 'moveRegion' ? { type: 'rect' as const, ...op.rect } : op.mask;
    setMaskKind(mask.type);
    if (mask.type === 'rect') setRect(mask);
    else if (mask.type === 'polygon') setPolygon(mask.points.map(([x, y]) => `${x},${y}`).join('\n'));
    else setCells(mask.keys);
    if (op.type === 'stretchSelection') { setX(op.sx); setY(op.sy); setScope(op.scope); }
    else { setX(op.dx); setY(op.dy); if (op.type === 'moveSelection') setFill(op.fill); }
  };
  return <InspectorSection title="Native Operations / Replay" info={null} defaultOpen={false}>
    <p>Wirkt auf den aktiven bearbeitbaren Layer. Direkte Pixelbearbeitung backt dessen Rezept; Undo stellt es wieder her.</p>
    <label>Operation<select aria-label="Native Operation" value={type} onChange={(e) => setType(e.target.value as RasterOperation['type'])}>
      <option value="moveRegion">Region verschieben</option><option value="moveSelection">Auswahl verschieben</option>
      <option value="stretchSelection">Auswahl strecken</option></select></label>
    <label>Maske<select aria-label="Native Operationsmaske" value={maskKind} onChange={(e) => setMaskKind(e.target.value as typeof maskKind)}>
      <option value="rect">Rechteck</option><option value="polygon">Polygon</option><option value="cells">Übernommene Auswahl</option></select></label>
    {maskKind === 'rect' && <div className="ab-coordinate">{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field}
      <input aria-label={`Operationsmaske ${field}`} type="number" step={1} value={rect[field]}
        onChange={(e) => setRect({ ...rect, [field]: Number(e.target.value) })} /></label>)}</div>}
    {maskKind === 'polygon' && <label>Ein Eckpunkt x,y je Zeile<textarea aria-label="Operationsmaske Polygonpunkte" value={polygon} onChange={(e) => setPolygon(e.target.value)} /></label>}
    {maskKind === 'cells' && <p>{cells.length} ausgewählte Pixel im Rezept.</p>}
    <button disabled={!store.selection?.size} onClick={() => {
      if (!store.selection?.size) return;
      if (type === 'moveRegion') { setRect(store.selectionBounds()!); setMaskKind('rect'); }
      else { setCells([...store.selection]); setMaskKind('cells'); }
    }}>Aktuelle Auswahl als Operationsmaske</button>
    <div className="ab-coordinate">{(['x', 'y'] as const).map((axis) => <label key={axis}>{type === 'stretchSelection' ? 'Stretch' : 'Move'} {axis}
      <input aria-label={`Native Operation ${axis}`} type="number" step={1} min={-128} max={128} value={axis === 'x' ? x : y}
        onChange={(e) => (axis === 'x' ? setX : setY)(Number(e.target.value))} /></label>)}</div>
    {type === 'moveSelection' && <label>Füllstrategie<select aria-label="Native Füllstrategie" value={fill} onChange={(e) => setFill(e.target.value as RasterFill)}>
      {RASTER_FILLS.map((v) => <option key={v}>{v}</option>)}</select></label>}
    {type === 'stretchSelection' && <><label>Wirkungsbereich<select aria-label="Native Stretch-Bereich" value={scope} onChange={(e) => setScope(e.target.value as RasterStretchScope)}>
      {RASTER_STRETCH_SCOPES.map((v) => <option key={v}>{v}</option>)}</select></label>
      <p>mask: nur Maskenpixel; boundsLocal: lokales Rechteck mit Randfüllung; bounds: Rechteck und nachfolgender Streifen.</p></>}
    {!editing && <label><input aria-label="Native Replay speichern" type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /> Als Replay-Rezept speichern</label>}
    <button disabled={!store.editable || !!store.faceDraft} onClick={() => run(() => {
      const mask = parseRasterMask(maskKind === 'rect' ? { ...rect, type: 'rect' } : maskKind === 'cells' ? { type: 'cells', keys: cells } :
        { type: 'polygon', points: polygon.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/[ ,]+/).map(Number)) });
      let parameters: unknown;
      if (type === 'moveRegion') {
        if (mask.type !== 'rect') throw Error('Region verschieben benötigt eine Rechteckmaske.');
        const { x: rx, y: ry, width, height } = mask;
        parameters = { type, rect: { x: rx, y: ry, width, height }, dx: x, dy: y };
      } else parameters = type === 'stretchSelection' ? { type, mask, sx: x, sy: y, scope } : { type, mask, dx: x, dy: y, fill };
      const op = newRasterOperation(parameters);
      if (editing) {
        if (editing.frame !== store.frame || editing.frames !== store.state.frames || editing.index !== store.state.index ||
          editing.layerId !== store.state.active || editing.session !== store.capturePlaybackDocument())
          throw Error('Frame/Layer/Sitzung wurde gewechselt. Operation erneut zum Bearbeiten auswählen.');
        if (!store.changeNativeOperation(editing.id, op)) throw Error('Dieses Rezept ist nicht mehr im aktiven Layer.');
        setEditing(null);
      } else store.applyNativeOperation(op, record);
    })}>{editing ? 'Replay-Operation ersetzen' : 'Native Operation anwenden'}</button>
    {editing && <button onClick={() => setEditing(null)}>Operationsänderung abbrechen</button>}
    {recipe && <>
      <p>Replay-Basis: {recipe.base.id} · {recipe.operations.length} Operations</p>
      <ol>{recipe.operations.map((op) => <li key={op.id}>{op.type}
        <button disabled={!store.editable} onClick={() => edit(op)}>Operation bearbeiten</button>
        <button disabled={!store.editable} onClick={() => run(() => store.changeNativeOperation(op.id, null))}>Operation entfernen</button>
      </li>)}</ol>
      <button disabled={!store.editable} onClick={() => run(() => { store.bakeNativeRecipe(); setEditing(null); })}>Rezept in Pixel backen</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </InspectorSection>;
}
