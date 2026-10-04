import type { ReactNode } from 'react';
import { BuilderPanel, InspectorSection } from './BuilderUI';
import { number } from './builderForm';
import type { HelpTopic } from './help';
import { animationStore as store } from './store';
import { capture } from './raster';
import { hex } from './colors';
import { NativeFaceInspector } from './NativeFaceInspector';
import { RasterOperationsInspector } from './RasterOperationsInspector';
import type { BuilderDialogs } from './useBuilderDialogs';

export function BuilderInspector({ open: right, onToggle, mode, ui }: {
  open: boolean; onToggle: () => void; mode: string; ui: Pick<BuilderDialogs, 'infoButton' | 'rename' | 'setColorOpen'>;
}) {
  const { infoButton, rename, setColorOpen } = ui;
  const group = (title: HelpTopic, content: ReactNode, open = true) => (
    <InspectorSection title={title} info={infoButton(title)} defaultOpen={open}>
      {content}
    </InspectorSection>
  );
  const current = store.layer;
  return (
    <BuilderPanel side="right" title="Inspektor" open={right} onToggle={onToggle}>
      <NativeFaceInspector store={store} />
      <RasterOperationsInspector store={store} />
        {mode !== 'Animation' &&
          group(
            'Layer',
            <>
              <div className="ab-nudge"><button title="Pixel-Layer hinzufügen" onClick={() => store.addLayer()}>
                ＋
              </button></div>
              {store.reference && (
                <div className={`ab-layer ${store.referenceSelected ? 'selected' : ''}`}>
                  <button
                    title="Referenz ein-/ausblenden"
                    onClick={() =>
                      store.setReference({
                        ...store.reference!,
                        visible: !store.reference!.visible,
                      })
                    }
                  >
                    {store.reference.visible ? '◉' : '○'}
                  </button>
                  <button
                    onClick={() => {
                      store.referenceSelected = true;
                      store.emit();
                    }}
                  >
                    Referenz · nur Editor
                    <small>{store.reference.name}</small>
                  </button>
                  <button title="Referenz entfernen" onClick={() => store.setReference(null)}>
                    ×
                  </button>
                  {infoButton('Referenz')}
                </div>
              )}
              {[...store.frame.layers].reverse().map((l) => (
                <div
                  className={`ab-layer ${current === l && !store.referenceSelected ? 'selected' : ''}`}
                  key={l.id}
                >
                  <button
                    title="Sichtbarkeit"
                    onClick={() => store.editLayer(l.id, { visible: !l.visible })}
                  >
                    {l.visible ? '◉' : '○'}
                  </button>
                  <button
                    title="Sperren"
                    onClick={() => store.editLayer(l.id, { locked: !l.locked })}
                  >
                    {l.locked ? '🔒' : '♧'}
                  </button>
                  <button onClick={() => store.selectLayer(l.id)}>
                    {l.name}
                    <small>{l.pixels.size} Pixel</small>
                  </button>
                  <details className="ab-layer-menu">
                    <summary>⋮</summary>
                    <div>
                      <button
                        onClick={() =>
                          rename('Layer umbenennen', l.name, (name) =>
                            store.editLayer(l.id, { name })
                          )
                        }
                      >
                        Umbenennen
                      </button>
                      <button onClick={() => store.reorder(l.id, 1)}>Nach oben</button>
                      <button onClick={() => store.reorder(l.id, -1)}>Nach unten</button>
                      <button onClick={() => store.removeLayer(l.id)}>Löschen</button>
                    </div>
                  </details>
                </div>
              ))}
            </>
          )}
        {mode !== 'Animation' &&
          group(
            'Pixel & Farbe',
            <>
              <small>Aktiv: {current?.name ?? 'Kein Layer'}</small>
              <div className="ab-color">
                <button
                  className="ab-color-swatch"
                  title="Farbe auswählen"
                  style={{ background: hex(store.color) }}
                  onClick={() => setColorOpen(true)}
                />
                <button title="Pipette aktivieren" onClick={() => store.selectTool('eyedropper')}>
                  ⚗
                </button>
                <label>
                  RGBA Hex
                  <input
                    key={store.color}
                    defaultValue={hex(store.color)}
                    pattern="#?[0-9a-fA-F]{8}"
                    aria-label="RGBA Hex"
                    onBlur={(e) => {
                      const v = e.target.value.replace('#', '');
                      if (/^[0-9a-fA-F]{8}$/.test(v)) {
                        store.color = parseInt(v, 16);
                        store.emit();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                </label>
              </div>
            </>
          )}
        {mode !== 'Pixel' &&
          group(
            'Timeline',
            <form
              onSubmit={(e) => {
                e.preventDefault();
                store.duration(number(new FormData(e.currentTarget), 'duration'));
              }}
            >
              <label>
                Dauer (ms)
                <input
                  key={`${store.state.index}-${store.frame.duration}`}
                  name="duration"
                  type="number"
                  min="1"
                  step="1"
                  required
                  defaultValue={store.frame.duration}
                />
              </label>
              <button type="submit">Übernehmen</button>
            </form>
          )}
        {mode !== 'Pixel' &&
          group(
            'Gesicht',
            <>
              {!store.faces.length && <p>Noch keine nativen Gesichts-Assets</p>}
              {store.faces.map((a) => (
                <button
                  className="ab-library-row"
                  key={a.id}
                  aria-pressed={store.frame.layers.some((l) => l.faceId === a.id)}
                  onClick={() => store.useFace(a)}
                >
                  {a.name}
                </button>
              ))}
            </>
          )}
        {mode !== 'Animation' &&
          group(
            'Auswahl',
            <>
              <p>
                {store.selectionBounds()
                  ? `${store.selectionBounds()!.width}×${store.selectionBounds()!.height} Pixel`
                  : 'Keine Auswahl'}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  if (data.get('operation') === 'stretch')
                    store.stretch(number(data, 'x'), number(data, 'y'));
                  else store.move(number(data, 'x'), number(data, 'y'));
                }}
              >
                <select name="operation" aria-label="Transformation">
                  <option value="move">Verschieben</option>
                  <option value="stretch">Strecken / Stauchen</option>
                </select>
                <div className="ab-coordinate">
                  <label>
                    X
                    <input name="x" type="number" step="1" defaultValue="0" required />
                  </label>
                  <label>
                    Y
                    <input name="y" type="number" step="1" defaultValue="0" required />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={!store.editable || !capture(store.editable.pixels, store.selection)}
                >
                  Anwenden
                </button>
              </form>
              <div className="ab-nudge">
                {[
                  [0, -1, '↑'],
                  [-1, 0, '←'],
                  [1, 0, '→'],
                  [0, 1, '↓'],
                ].map(([x, y, text]) => (
                  <button key={text} onClick={() => store.move(Number(x), Number(y))}>
                    {text}
                  </button>
                ))}
              </div>
              <button onClick={() => store.setSelection(null)}>Auswahl aufheben</button>
            </>
          )}
    </BuilderPanel>
  );
}
