import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { animationStore as store } from './store';
import type { Tool } from './store';
import { SOURCES, capture, hex } from './raster';
import type { PixelAsset, SourceId } from './raster';
import {
  builtinReference,
  exportPng,
  importReference,
  localSessions,
  REFERENCE_LABELS,
  restoreSession,
  saveLocalSession,
  serializeSession,
} from './files';
import { RasterCanvas } from './RasterCanvas';
import { Dialog } from './Dialog';
import { ColorDialog } from './ColorDialog';
import { BrushSizeSelector } from './BrushSizeSelector';
import { help } from './help';
import type { HelpTopic } from './help';
import './builder.css';

type Modal = {
  title: string;
  content: ReactNode;
  submit?: (data: FormData) => void;
  action?: string;
};
const tools: [Tool, string, string][] = [
  ['pencil', '✎', 'Stift'],
  ['eraser', '⌫', 'Radierer'],
  ['eyedropper', '⚗', 'Pipette'],
  ['rect', '□', 'Rechteckauswahl'],
  ['polygon', '⬡', 'Polygonauswahl'],
  ['pan', '✋', 'Ansicht verschieben'],
  ['grab', '☝', 'Layer greifen'],
];
const textField = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};
const number = (data: FormData, name: string) => Number(data.get(name));
export function AnimationBuilder({ onExit, onLegacy }: { onExit: () => void; onLegacy: () => void }) {
  useSyncExternalStore(store.subscribe, store.snapshot);
  const [modal, setModal] = useState<Modal | null>(null);
  const [left, setLeft] = useState(() => innerWidth > 1100);
  const [right, setRight] = useState(() => innerWidth > 1100);
  const [timeline, setTimeline] = useState(true);
  const [mode, setMode] = useState('Kombiniert');
  const [tab, setTab] = useState('Dateien');
  const [message, setMessage] = useState('Bereit');
  const [sessions, setSessions] = useState<Map<string, string>>(new Map());
  const [faceSave, setFaceSave] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

  const report = (task: Promise<unknown>) => {
    void task.catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.')
    );
  };
  useEffect(() => {
    void localSessions()
      .then(setSessions)
      .catch(() => setMessage('Lokaler Speicher ist nicht verfügbar.'));
    return () => store.pause(false);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        modal ||
        colorOpen ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input,textarea,select,[contenteditable]'))
      )
        return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          store.redo();
        }
      }
      if (event.key === 'Escape') {
        document
          .querySelectorAll('.ab-menu[open],.ab-layer-menu[open]')
          .forEach((element) => element.removeAttribute('open'));
        store.cancelPicker();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modal, colorOpen]);
  const info = (topic: HelpTopic) => setModal({ title: topic, content: <p>{help[topic]}</p> });
  const infoButton = (topic: HelpTopic) => (
    <button
      className="ab-info"
      title={`Information: ${topic}`}
      aria-label={`Information: ${topic}`}
      onClick={() => info(topic)}
    >
      ⓘ
    </button>
  );
  const group = (title: HelpTopic, content: ReactNode, open = true) => (
    <section className="ab-group">
      <header>
        <strong>{title}</strong>
        {infoButton(title)}
      </header>
      <details open={open}>
        <summary>{title} anzeigen</summary>
        {content}
      </details>
    </section>
  );
  const closeMenus = () =>
    document.querySelectorAll('.ab-menu[open]').forEach((element) => element.removeAttribute('open'));
  const action = (label: string, fn: () => void, disabled = false) => (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        closeMenus();
        fn();
      }}
    >
      {label}
    </button>
  );
  const menu = (name: string, content: ReactNode) => (
    <details className="ab-menu">
      <summary>{name}</summary>
      <div role="menu">{content}</div>
    </details>
  );
  const zoom = (factor: number) =>
    document
      .querySelector('.ab-canvas')
      ?.dispatchEvent(new CustomEvent('builder-zoom', { detail: factor }));
  const rename = (title: string, value: string, done: (name: string) => void) =>
    setModal({
      title,
      content: (
        <label>
          Name
          <input name="name" defaultValue={value} required autoFocus />
        </label>
      ),
      submit: (data) => {
        done(textField(data, 'name').trim());
      },
    });
  const newAnimation = () =>
    setModal({
      title: 'Neue Animation',
      content: (
        <>
          <label>
            Name
            <input name="name" defaultValue="Neue Rasteranimation" required autoFocus />
          </label>
          <label>
            Grundpose
            <select name="source" defaultValue={store.state.source}>
              {Object.entries(SOURCES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input name="copy" type="checkbox" />
            Aktuellen Frame übernehmen
          </label>
        </>
      ),
      action: 'Anlegen',
      submit: (data) =>
        store.newAnimation(
          textField(data, 'name'),
          textField(data, 'source') as SourceId,
          data.has('copy')
        ),
    });
  const saveTemplate = () => {
    setFaceSave(false);
    setModal({
      title: 'Auswahl als Vorlage speichern',
      content: null,
      action: 'Speichern',
      submit: (data) => {
        const saved = store.saveAsset(textField(data, 'name'), data.has('face'));
        setMessage(saved ? `${saved.name} gespeichert` : 'Keine bearbeitbaren Pixel ausgewählt.');
      },
    });
  };
  const insert = (asset: PixelAsset) =>
    setModal({
      title: 'Vorlage einfügen',
      content: (
        <>
          <p>{asset.name}</p>
          {(['x', 'y', 'width', 'height'] as const).map((field) => (
            <label key={field}>
              {{ x: 'X', y: 'Y', width: 'Breite', height: 'Höhe' }[field]}
              <input
                name={field}
                type="number"
                step="1"
                min={field === 'width' || field === 'height' ? 1 : -127}
                max={128}
                defaultValue={asset.bounds[field]}
                required
              />
            </label>
          ))}
        </>
      ),
      action: 'Einfügen',
      submit: (data) =>
        store.insert(asset, {
          x: number(data, 'x'),
          y: number(data, 'y'),
          width: number(data, 'width'),
          height: number(data, 'height'),
        }),
    });
  const saveLocal = () =>
    report(
      (async () => {
        const savedState = store.state;
        await saveLocalSession(store.state.name, serializeSession(store));
        setSessions(await localSessions());
        if (savedState === store.state) store.dirty = false;
        store.emit();
        setMessage('Sitzung lokal gesichert.');
      })()
    );
  const savePng = () =>
    report(
      exportPng(store.frame, store.state.name).then((result) => {
        if (result) setMessage(`${result.name} exportiert (ohne Referenz)`);
      })
    );
  const load = (name: string, json: string) =>
    setModal({
      title: 'Sitzung öffnen',
      content: (
        <p>
          „{name}“ laden? Der aktuelle Stand wird ersetzt. Sichere ihn vorher über „Sitzung lokal
          sichern“.
        </p>
      ),
      action: 'Öffnen',
      submit: () => {
        try {
          restoreSession(store, json);
          setMessage(`${name} geladen`);
        } catch (e) {
          setMessage(String(e));
        }
      },
    });
  const current = store.layer;
  return (
    <div className="animation-builder">
      <header className="ab-menubar">
        <button title="Zur Editor-Auswahl" onClick={onExit}>
          ‹ Auswahl
        </button>
        {menu(
          'Datei',
          <>
            {action('Neue Animation', newAnimation)}
            {action('Sitzung lokal sichern', saveLocal)}
            {action('Frame als PNG exportieren (1024×1024)', savePng)}
          </>
        )}
        {menu(
          'Bearbeiten',
          <>
            {action('Rückgängig', () => store.undo(), !store.past.length)}
            {action('Wiederholen', () => store.redo(), !store.future.length)}
            {action('Animation umbenennen …', () =>
              rename('Animation umbenennen', store.state.name, (name) =>
                store.commit({ ...store.state, name })
              )
            )}
            {action('Frame duplizieren', () => store.addFrame(true))}
            {action('Frame löschen', () => store.deleteFrame(), store.state.frames.length === 1)}
            {action('Auswahl aufheben', () => store.setSelection(null))}
          </>
        )}
        {menu(
          'Ansicht',
          <>
            {['Animation', 'Pixel', 'Kombiniert'].map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  closeMenus();
                }}
              >
                {m}
              </button>
            ))}
            {action('Linkes Panel', () => setLeft(!left))}
            {action('Inspektor', () => setRight(!right))}
            {action('Timeline', () => setTimeline(!timeline))}
            {action('Hineinzoomen', () => zoom(1.25))}
            {action('Herauszoomen', () => zoom(0.8))}
            {action('Zoom zurücksetzen', () => zoom(0))}
          </>
        )}
        {menu(
          'Animation',
          <>
            {action(store.playing ? 'Pause' : 'Abspielen', () =>
              store.playing ? store.pause() : store.play()
            )}
            {action('Frame hinzufügen', () => store.addFrame())}
            {action('Frame duplizieren', () => store.addFrame(true))}
          </>
        )}
        {menu(
          'Pixel',
          <>
            {tools.map(([tool, , label]) => (
              <button
                key={tool}
                onClick={() => {
                  store.selectTool(tool);
                  closeMenus();
                }}
              >
                {label}
              </button>
            ))}
            {action('Farbe auswählen …', () => setColorOpen(true))}
            {action('Pixel-Layer hinzufügen', () => store.addLayer())}
            {action('Auswahl aufheben', () => store.setSelection(null))}
          </>
        )}
        {menu(
          'Vorlagen',
          <>
            {action('Auswahl als Vorlage speichern …', saveTemplate, !store.selection)}
            {action('Vorlagen anzeigen', () => {
              setTab('Vorlagen');
              setLeft(true);
            })}
            {action('Referenzbild hinzufügen …', () =>
              document.querySelector<HTMLInputElement>('#ab-reference-file')?.click()
            )}
            <hr />
            <strong>Fino-Referenz laden</strong>
            {REFERENCE_LABELS.map((label, i) => (
              <button
                key={label}
                onClick={() => {
                  closeMenus();
                  report(builtinReference(i).then((reference) => store.setReference(reference)));
                }}
              >
                {label}
              </button>
            ))}
          </>
        )}
        {menu(
          'Hilfe',
          <>
            {Object.keys(help).map((topic) => (
              <button
                key={topic}
                onClick={() => {
                  info(topic as HelpTopic);
                  closeMenus();
                }}
              >
                {topic}
              </button>
            ))}
          </>
        )}
        <span className="ab-title">{store.state.name}</span>
        <small>{store.dirty ? 'Ungespeichert' : 'Gesichert'}</small>
        <button onClick={onLegacy}>Legacy 1024</button>
      </header>
      <nav className="ab-toolbar" aria-label="Editor-Werkzeuge">
        <button title="Neue Animation" onClick={newAnimation}>
          ＋
        </button>
        <select aria-label="Arbeitsbereich" value={mode} onChange={(e) => setMode(e.target.value)}>
          {['Animation', 'Pixel', 'Kombiniert'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        {infoButton('Ansicht')}
        {tools.map(([tool, icon, label]) => (
          <span className="ab-tool" key={tool}>
            <button
              title={label}
              aria-label={label}
              aria-pressed={store.tool === tool}
              onClick={() => store.selectTool(tool)}
            >
              {icon}
            </button>
            {store.tool === tool && (tool === 'pencil' || tool === 'eraser') && (
              <BrushSizeSelector
                value={store.brushSize}
                onChange={(size) => {
                  if (tool === 'pencil') store.pencilSize = size;
                  else store.eraserSize = size;
                  store.emit();
                }}
              />
            )}
          </span>
        ))}
        <button
          title={store.playing ? 'Pause' : 'Abspielen'}
          onClick={() => (store.playing ? store.pause() : store.play())}
        >
          {store.playing ? 'Ⅱ' : '▶'}
        </button>
        <button title="PNG exportieren" onClick={savePng}>
          ⇩
        </button>
        <select
          aria-label="Grundpose"
          value={store.state.source}
          onChange={(e) => store.source(e.target.value as SourceId)}
        >
          {Object.entries(SOURCES).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {infoButton('Grundpose')}
        <button title="Herauszoomen" onClick={() => zoom(0.8)}>
          −
        </button>
        <button title="Zoom zurücksetzen" onClick={() => zoom(0)}>
          Einpassen
        </button>
        <button title="Hineinzoomen" onClick={() => zoom(1.25)}>
          ＋
        </button>
        <span className="ab-spacer" />
        <button title="Rückgängig" disabled={!store.past.length} onClick={() => store.undo()}>
          ↶
        </button>
        <button title="Wiederholen" disabled={!store.future.length} onClick={() => store.redo()}>
          ↷
        </button>
      </nav>
      <main className="ab-workspace">
        <RasterCanvas store={store} />
        {left && (
          <aside className="ab-left">
            <header>
              <button onClick={() => setTab('Dateien')}>Dateien</button>
              <button onClick={() => setTab('Vorlagen')}>Vorlagen</button>
              {infoButton(tab === 'Dateien' ? 'Dateien' : 'Vorlagen')}
            </header>
            {tab === 'Dateien' ? (
              <>
                <button onClick={newAnimation}>＋ Neue Animation</button>
                <button onClick={saveLocal}>Sitzung lokal sichern</button>
                {[...sessions]
                  .filter(([name]) => !name.endsWith('.finoanim.json') && !name.startsWith('__'))
                  .map(([name, json]) => (
                    <button className="ab-library-row" key={name} onClick={() => load(name, json)}>
                      {name}
                    </button>
                  ))}
                <p>Die aktuelle Sitzung bleibt beim Editorwechsel erhalten.</p>
              </>
            ) : (
              <>
                <h3>Pixel-Vorlagen</h3>
                <button disabled={!store.selection} onClick={saveTemplate}>
                  Auswahl als Vorlage speichern …
                </button>
                {store.templates.map((t) => (
                  <div className="ab-library-row" key={t.id}>
                    <button onClick={() => insert(t)}>{t.name}</button>
                    <button
                      title="Umbenennen"
                      onClick={() =>
                        rename('Vorlage umbenennen', t.name, (name) => {
                          store.templates = store.templates.map((a) => (a === t ? { ...a, name } : a));
                          store.emit();
                        })
                      }
                    >
                      ✎
                    </button>
                    <button
                      title="Löschen"
                      onClick={() => {
                        store.templates = store.templates.filter((a) => a !== t);
                        store.emit();
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
          </aside>
        )}
        <button
          className={`ab-toggle ab-toggle-left ${left ? 'expanded' : ''}`}
          title="Linkes Panel"
          onClick={() => setLeft(!left)}
        >
          {left ? '‹' : '›'}
        </button>
        {right && (
          <aside className="ab-right">
            <h3>Inspektor</h3>
            {mode !== 'Animation' &&
              group(
                'Layer',
                <>
                  <button title="Pixel-Layer hinzufügen" onClick={() => store.addLayer()}>
                    ＋
                  </button>
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
          </aside>
        )}
        <button
          className={`ab-toggle ab-toggle-right ${right ? 'expanded' : ''}`}
          title="Inspektor"
          onClick={() => setRight(!right)}
        >
          {right ? '›' : '‹'}
        </button>
        {timeline && (
          <section
            className="ab-timeline"
            style={{
              left: left ? 'var(--ab-left)' : 0,
              right: right ? 'var(--ab-right)' : 0,
            }}
          >
            <header>
              <strong>Timeline</strong>
              {infoButton('Timeline')}
              <span className="ab-spacer" />
              <button
                title="Abspielen/Pause"
                onClick={() => (store.playing ? store.pause() : store.play())}
              >
                {store.playing ? 'Ⅱ' : '▶'}
              </button>
              <button title="Frame hinzufügen" onClick={() => store.addFrame()}>
                ＋
              </button>
              <button title="Frame duplizieren" onClick={() => store.addFrame(true)}>
                ⧉
              </button>
              <button
                title="Frame löschen"
                disabled={store.state.frames.length === 1}
                onClick={() => store.deleteFrame()}
              >
                ×
              </button>
            </header>
            <div className="ab-frames">
              {store.state.frames.map((f, i) => (
                <button key={i} aria-pressed={i === store.state.index} onClick={() => store.frameAt(i)}>
                  Frame {i + 1}
                  <small>
                    {f.duration} ms · {f.layers.length} Layer
                  </small>
                </button>
              ))}
            </div>
          </section>
        )}
        <button
          className={`ab-toggle-bottom ${timeline ? 'expanded' : ''}`}
          title="Timeline"
          onClick={() => setTimeline(!timeline)}
        >
          {timeline ? '⌄' : '⌃'}
        </button>
      </main>
      <footer className="ab-status">
        <span>{message}</span>
        <span>
          {store.state.frames.length} Frames · {mode} · Raster 128×128
        </span>
      </footer>
      <input
        id="ab-reference-file"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            report(importReference(file, file.name).then((reference) => store.setReference(reference)));
          e.target.value = '';
        }}
      />
      {colorOpen && (
        <ColorDialog
          initial={store.color}
          onCancel={() => setColorOpen(false)}
          onApply={(color) => {
            store.color = color;
            store.emit();
            setColorOpen(false);
          }}
        />
      )}
      {modal && (
        <Dialog
          title={modal.title}
          action={modal.action}
          onCancel={() => setModal(null)}
          onSubmit={
            modal.submit
              ? (data) => {
                  modal.submit?.(data);
                  setModal(null);
                }
              : undefined
          }
        >
          {modal.title === 'Auswahl als Vorlage speichern' ? (
            <>
              <label>
                Vorlagen-Name
                <input name="name" required autoFocus defaultValue="Neue Vorlage" />
              </label>
              <label>
                <input
                  type="checkbox"
                  name="face"
                  checked={faceSave}
                  onChange={(e) => setFaceSave(e.target.checked)}
                />
                Als Gesichts-Asset speichern
              </label>
            </>
          ) : (
            modal.content
          )}
        </Dialog>
      )}
    </div>
  );
}
