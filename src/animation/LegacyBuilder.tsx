import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { encode } from 'fast-png';
import { saveBlobAs } from '../platform/nativeFileDialog';
import { legacyStore as store } from './legacyStore';
import type { LegacyTemplate } from './legacyStore';
import {
  EYES,
  MOUTHS,
  PARTS,
  POSES,
  loadLegacyAsset,
  parseDefinition,
  renderLegacy,
  rigElement,
} from './legacy';
import type { FacePart } from './legacy';
import type { Tool } from './store';
import { hex } from './raster';
import { LegacyCanvas } from './LegacyCanvas';
import { Dialog } from './Dialog';
import { ColorDialog } from './ColorDialog';
import { legacyFiles, saveLocalSession } from './files';
import { help } from './help';
import { decodeTemplates, encodeTemplates } from './templateLibrary';
type Modal = {
  title: string;
  children: ReactNode;
  submit?: (data: FormData) => void;
  action?: string;
};
const text = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
};
const num = (data: FormData, key: string) => Number(text(data, key));
export function LegacyBuilder({ onExit, onNative }: { onExit: () => void; onNative: () => void }) {
  useSyncExternalStore(store.subscribe, store.snapshot);
  const [modal, setModal] = useState<Modal | null>(null);
  const [left, setLeft] = useState(innerWidth > 1100),
    [right, setRight] = useState(innerWidth > 1100),
    [timeline, setTimeline] = useState(true);
  const [colorOpen, setColorOpen] = useState(false);
  const [mode, setMode] = useState('Kombiniert');
  const [files, setFiles] = useState(new Map<string, string>());
  useEffect(() => {
    void store.initialize().catch((e) => store.reportError(e));
    void legacyFiles()
      .then(setFiles)
      .catch((e) => store.reportError(e));
    return () => store.pause(false);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        modal ||
        colorOpen ||
        (e.target instanceof HTMLElement && e.target.closest('input,select,textarea'))
      )
        return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) store.redo();
          else store.undo();
        }
        if (e.key === 'y') {
          e.preventDefault();
          store.redo();
        }
      }
      if (e.key === 'Escape')
        document
          .querySelectorAll('.ab-menu[open],.ab-layer-menu[open]')
          .forEach((el) => el.removeAttribute('open'));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modal, colorOpen]);
  const error = (e: unknown) => {
    store.reportError(e);
  };
  const report = (task: Promise<unknown>) => {
    void task.catch(error);
  };
  const info = (title: string, body: string) => setModal({ title, children: <p>{body}</p> });
  const infoButton = (title: string, body: string) => (
    <button title={`Information: ${title}`} onClick={() => info(title, body)}>
      ⓘ
    </button>
  );
  const group = (name: string, body: string, children: ReactNode) => {
    const pixel = ['Layer', 'Farbe', 'Auswahl & Operationen'].includes(name);
    if ((mode === 'Animation' && pixel) || (mode === 'Pixel' && !pixel)) return null;
    return (
      <section className="ab-group">
        <header>
          <strong>{name}</strong>
          {infoButton(name, body)}
        </header>
        {children}
      </section>
    );
  };
  const close = () =>
    document.querySelectorAll('.ab-menu[open]').forEach((el) => el.removeAttribute('open'));
  const menu = (label: string, children: ReactNode) => (
    <details className="ab-menu">
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
  const action = (label: string, fn: () => void, disabled = false) => (
    <button
      disabled={disabled}
      onClick={() => {
        close();
        fn();
      }}
    >
      {label}
    </button>
  );
  const rename = (title: string, value: string, done: (name: string) => void) =>
    setModal({
      title,
      children: (
        <label>
          Name
          <input name="name" required autoFocus defaultValue={value} />
        </label>
      ),
      submit: (d) => done(text(d, 'name')),
    });
  const newAnimation = () =>
    setModal({
      title: 'Neue Animation',
      action: 'Anlegen',
      children: (
        <>
          <label>
            Name
            <input name="name" defaultValue="Neue Animation" required autoFocus />
          </label>
          <label>
            Grundpose
            <select name="pose" defaultValue={store.definition.basePose}>
              {POSES.map((p) => (
                <option key={p} value={`fino_${p}.png`}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start
            <select name="strategy">
              <option value="empty">Leerer Frame</option>
              <option value="preset">Face-Preset (V2 bevorzugt)</option>
              <option value="copy">Aktuellen Frame übernehmen</option>
            </select>
          </label>
        </>
      ),
      submit: (d) => store.newAnimation(text(d, 'name'), text(d, 'pose'), text(d, 'strategy')),
    });
  const save = () =>
    report(
      (async () => {
        const definition = store.definition,
          name = `${definition.id}.finoanim.json`,
          json = JSON.stringify(definition, null, 2);
        const saved = await saveBlobAs(
          new Blob([json], { type: 'application/json' }),
          name,
          'application/json'
        );
        if (!saved) return;
        await saveLocalSession(name, json);
        setFiles(await legacyFiles());
        store.saved = definition;
        store.message = `${name} gespeichert`;
        store.emit();
      })()
    );
  const openJson = (json: string) => {
    try {
      const definition = parseDefinition(json);
      setModal({
        title: 'Animation öffnen',
        action: 'Öffnen',
        children: <p>„{definition.name}“ öffnen? Sichere vorher den aktuellen Stand.</p>,
        submit: () => store.load(definition),
      });
    } catch (e) {
      error(e);
    }
  };
  const exportImage = () =>
    report(
      (async () => {
        if (!store.rig) return;
        const image = await renderLegacy(
          store.definition,
          store.index,
          loadLegacyAsset,
          store.rig,
          store.addonRoot
        );
        const data = encode({
          width: 1024,
          height: 1024,
          data: image.toBytes(),
          channels: 4,
        });
        await saveBlobAs(
          new Blob([new Uint8Array(data)], { type: 'image/png' }),
          `${store.definition.id}.png`,
          'image/png'
        );
      })()
    );
  const zoom = (factor: number) =>
    document
      .querySelector('.ab-canvas')
      ?.dispatchEvent(new CustomEvent('builder-zoom', { detail: factor }));
  const insert = (t: LegacyTemplate) =>
    setModal({
      title: 'Vorlage einfügen',
      action: 'Einfügen',
      children: (
        <>
          {(['x', 'y', 'width', 'height'] as const).map((k) => (
            <label key={k}>
              {k}
              <input
                name={k}
                type="number"
                step="1"
                required
                min={k === 'width' || k === 'height' ? 1 : 0}
                max="1024"
                defaultValue={k === 'x' || k === 'y' ? t.origin[k] : t[k]}
              />
            </label>
          ))}
        </>
      ),
      submit: (d) =>
        store.insert(t, {
          x: num(d, 'x'),
          y: num(d, 'y'),
          width: num(d, 'width'),
          height: num(d, 'height'),
        }),
    });
  const faceHelp =
    'Wähle ein Auge oder den Mund. Variante, Position, Breite und Sichtbarkeit gelten für den aktuellen Frame. „Face-Preset“ richtet das Gesicht an der Grundpose aus. Mit „Greifen“ kannst du ein sichtbares Gesichtselement verschieben.';
  return (
    <div className="animation-builder">
      <header className="ab-menubar">
        <button onClick={onExit}>‹ Auswahl</button>
        {menu(
          'Datei',
          <>
            {action('Neue Animation', newAnimation)}
            {action('Öffnen …', () => document.querySelector<HTMLInputElement>('#legacy-open')?.click())}
            {action('Speichern', save)}
            {action('Speichern unter …', () =>
              rename('Speichern unter', store.definition.id, (id) => {
                store.commit({ ...store.definition, id });
                save();
              })
            )}
            {action('PNG exportieren', exportImage)}
            {action('Projekteinstellungen …', () =>
              setModal({
                title: 'Projekteinstellungen',
                children: (
                  <label>
                    Addon-Quelle
                    <select name="root" defaultValue={store.addonRoot}>
                      {['addons', 'addons_cleaned', 'addons_normalized'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                ),
                submit: (d) => {
                  store.setAddonRoot(text(d, 'root'));
                },
              })
            )}
          </>
        )}
        {menu(
          'Bearbeiten',
          <>
            {action('Rückgängig', () => store.undo(), !store.past.length)}
            {action('Wiederholen', () => store.redo(), !store.future.length)}
            {action('Animation umbenennen', () =>
              rename('Animation umbenennen', store.definition.name, (name) =>
                store.commit({ ...store.definition, name })
              )
            )}
            {action('Frame duplizieren', () => store.addFrame(true))}
            {action('Frame löschen', () => store.deleteFrame(), store.definition.frames.length === 1)}
            {action('Auswahl aufheben', () => {
              store.clearSelection();
            })}
          </>
        )}
        {menu(
          'Ansicht',
          <>
            {action('Linkes Panel', () => setLeft(!left))}
            {action('Inspektor', () => setRight(!right))}
            {action('Timeline', () => setTimeline(!timeline))}
            {action('Hineinzoomen', () => zoom(1.25))}
            {action('Herauszoomen', () => zoom(0.8))}
            {action('Zoom zurücksetzen', () => zoom(0))}
            {['Animation', 'Pixel', 'Kombiniert'].map((value) => (
              <button
                key={value}
                onClick={() => {
                  close();
                  setMode(value);
                }}
              >
                {value}
              </button>
            ))}
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
            {action('Face-Rig einsetzen', () => store.ensureFaceRig())}
            {action('Face-Preset anwenden', () => store.applyPreset())}
          </>
        )}
        {menu(
          'Pixel',
          <>
            {(['pencil', 'eraser', 'eyedropper', 'rect', 'polygon', 'pan', 'grab'] as Tool[]).map(
              (tool, i) => (
                <button
                  key={tool}
                  onClick={() => {
                    close();
                    store.selectTool(tool);
                  }}
                >
                  {
                    [
                      'Stift',
                      'Radierer',
                      'Pipette',
                      'Rechteckauswahl',
                      'Polygonauswahl',
                      'Ansicht verschieben',
                      'Layer greifen',
                    ][i]
                  }
                </button>
              )
            )}
            {action('Farbe auswählen …', () => setColorOpen(true))}
            {action('Pixel-Layer hinzufügen', () => store.addLayer())}
            {action('Auswahl aufheben', () => store.clearSelection())}
          </>
        )}
        {menu(
          'Vorlagen',
          <>
            {action('Vorlagen anzeigen', () => setLeft(true))}
            {action(
              'Auswahl als Vorlage speichern …',
              () =>
                rename('Auswahl als Vorlage speichern', 'Neue Vorlage', (name) =>
                  store.saveTemplate(name)
                ),
              !store.selection
            )}
            {action('Vorlagenbibliothek importieren …', () =>
              document.querySelector<HTMLInputElement>('#legacy-library')?.click()
            )}
            {action('Vorlagenbibliothek exportieren …', () =>
              report(
                saveBlobAs(
                  new Blob([encodeTemplates(store.templates)], {
                    type: 'application/json',
                  }),
                  'fino_templates.json',
                  'application/json'
                )
              )
            )}
            {store.templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  close();
                  insert(t);
                }}
              >
                {t.name}
              </button>
            ))}
          </>
        )}
        {menu(
          'Hilfe',
          <>
            {action('Werkzeuge', () =>
              info(
                'Werkzeuge',
                'Stift, Radierer und Pipette bearbeiten Bildpixel des aktiven Layers. Wähle Rechteck oder Polygon; Enter schließt das Polygon, Escape bricht ab. Die Hand bewegt die Ansicht.'
              )
            )}
            {action('Face-Rig', () => info('Face-Rig', faceHelp))}
            {action('Verschieben & Stretch', () =>
              info(
                'Verschieben & Stretch',
                'Die Operationen verändern die Grundpose im gewählten Bereich. Transparent schneidet aus, Original dupliziert, Auswahlrand führt Randpixel fort. Stretch kann die Umgebung nachschieben oder nur lokal wirken.'
              )
            )}
            {action('Tastaturkürzel', () => info('Tastaturkürzel', help.Tastaturkürzel))}
          </>
        )}
        <span className="ab-title">{store.definition.name}</span>
        <button onClick={onNative}>Raster128</button>
      </header>
      <nav className="ab-toolbar">
        <button title="Neue Animation" onClick={newAnimation}>
          ＋
        </button>
        <select aria-label="Arbeitsbereich" value={mode} onChange={(e) => setMode(e.target.value)}>
          {['Animation', 'Pixel', 'Kombiniert'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        {infoButton('Ansicht', help.Ansicht)}
        {(['pencil', 'eraser', 'eyedropper', 'rect', 'polygon', 'pan', 'grab'] as Tool[]).map(
          (tool, i) => (
            <button
              key={tool}
              aria-pressed={store.tool === tool}
              onClick={() => {
                store.selectTool(tool);
              }}
            >
              {['Stift', 'Radierer', 'Pipette', 'Rechteck', 'Polygon', 'Hand', 'Greifen'][i]}
            </button>
          )
        )}
        <button
          title={store.playing ? 'Pause' : 'Abspielen'}
          onClick={() => (store.playing ? store.pause() : store.play())}
        >
          {store.playing ? 'Ⅱ' : '▶'}
        </button>
        <select
          aria-label="Grundpose"
          value={store.definition.basePose}
          onChange={(e) => store.source(e.target.value)}
        >
          {POSES.map((p) => (
            <option key={p} value={`fino_${p}.png`}>
              {p}
            </option>
          ))}
        </select>
        <button onClick={() => zoom(0.8)}>−</button>
        <button onClick={() => zoom(0)}>Einpassen</button>
        <button onClick={() => zoom(1.25)}>＋</button>
        <button title="Rückgängig" disabled={!store.past.length} onClick={() => store.undo()}>
          ↶
        </button>
        <button title="Wiederholen" disabled={!store.future.length} onClick={() => store.redo()}>
          ↷
        </button>
      </nav>
      <main className="ab-workspace">
        <LegacyCanvas store={store} />
        {left && (
          <aside className="ab-left">
            <h3>Dateien</h3>
            {infoButton(
              'Dateien',
              'Öffne oder speichere eine .finoanim.json-Datei. Lokal gesicherte Animationen sind hier wieder auswählbar. Die Bilddateien werden mit dieser App mitgeliefert.'
            )}
            <button onClick={newAnimation}>Neue Animation</button>
            {[...files]
              .filter(([name]) => name.endsWith('.finoanim.json'))
              .map(([name, json]) => (
                <button key={name} className="ab-library-row" onClick={() => openJson(json)}>
                  {name}
                </button>
              ))}
            <h3>Pixel-Vorlagen</h3>
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
          </aside>
        )}
        <button
          className={`ab-toggle ab-toggle-left ${left ? 'expanded' : ''}`}
          onClick={() => setLeft(!left)}
        >
          ‹
        </button>
        {right && (
          <aside className="ab-right">
            <h3>Inspektor</h3>
            {group(
              'Layer',
              help.Layer,
              <>
                {!store.frame.layers?.length && (
                  <button onClick={() => store.ensureLayers()}>
                    Layer-Editor für diesen Frame aktivieren
                  </button>
                )}
                <button onClick={() => store.addLayer()}>＋ Pixel-Layer</button>
                {[...(store.frame.layers ?? [])].reverse().map((l) => (
                  <div className={`ab-layer ${store.active === l.id ? 'selected' : ''}`} key={l.id}>
                    <button
                      title="Sichtbarkeit"
                      onClick={() => store.layerEdit(l.id, { visible: l.visible === false })}
                    >
                      {l.visible === false ? '○' : '◉'}
                    </button>
                    <button title="Sperren" onClick={() => store.layerEdit(l.id, { locked: !l.locked })}>
                      {l.locked ? '🔒' : '♧'}
                    </button>
                    <button
                      onClick={() => {
                        store.active = l.id;
                        store.facePart = PARTS.includes(l.kind as FacePart)
                          ? (l.kind as FacePart)
                          : null;
                        store.emit();
                      }}
                    >
                      {l.name}
                    </button>
                    <details className="ab-layer-menu">
                      <summary>⋮</summary>
                      <div>
                        <button
                          onClick={() =>
                            rename('Layer umbenennen', l.name, (name) => store.layerEdit(l.id, { name }))
                          }
                        >
                          Umbenennen
                        </button>
                        <button onClick={() => store.moveLayer(l.id, 1)}>Nach oben</button>
                        <button onClick={() => store.moveLayer(l.id, -1)}>Nach unten</button>
                        {l.kind === 'pixels' && (
                          <button
                            onClick={() =>
                              store.frameEdit({
                                ...store.frame,
                                layers: store.frame.layers?.filter((a) => a !== l),
                              })
                            }
                          >
                            Löschen
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                ))}
              </>
            )}
            {group(
              'Farbe',
              'Gib die Farbe als RRGGBBAA ein. Die Pipette liest den Bildpixel unter dem Cursor.',
              <>
                <button title="Farbe auswählen" onClick={() => setColorOpen(true)}>
                  Farbe auswählen
                </button>
                <input
                  key={store.color}
                  aria-label="RGBA Hex"
                  defaultValue={hex(store.color)}
                  onBlur={(e) => {
                    const v = e.target.value.replace('#', '');
                    if (/^[a-f\d]{8}$/i.test(v)) {
                      store.color = parseInt(v, 16);
                      store.emit();
                    }
                  }}
                />
              </>
            )}
            {group(
              'Frame & Legacy-Addons',
              'Die Dauer bestimmt die Anzeigedauer. Legacy-Addons sind ganze Augen- oder Mundbilder; Face-Rig-Elemente werden darunter getrennt eingestellt.',
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    store.frameEdit({
                      ...store.frame,
                      durationMs: num(d, 'duration'),
                    });
                  }}
                >
                  <label>
                    Dauer (ms)
                    <input
                      name="duration"
                      key={`${store.index}-${store.frame.durationMs}`}
                      type="number"
                      min="1"
                      required
                      defaultValue={store.frame.durationMs}
                    />
                  </label>
                  <button>Übernehmen</button>
                </form>
                {(['eyes', 'mouth'] as const).map((part) => {
                  const raw = store.frame[part],
                    value = typeof raw === 'string' ? { state: raw, dx: 0, dy: 0 } : raw;
                  return (
                    <form
                      key={`${store.index}-${part}-${JSON.stringify(raw)}`}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        store.frameEdit({
                          ...store.frame,
                          [part]: text(d, 'state')
                            ? {
                                state: text(d, 'state'),
                                dx: num(d, 'dx'),
                                dy: num(d, 'dy'),
                              }
                            : null,
                        });
                      }}
                    >
                      <label>
                        {part === 'eyes' ? 'Augen-Addon' : 'Mund-Addon'}
                        <select name="state" defaultValue={value?.state ?? ''}>
                          <option value="">Keins</option>
                          {(part === 'eyes' ? EYES : MOUTHS).map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      <div className="ab-coordinate">
                        {(['dx', 'dy'] as const).map((k) => (
                          <label key={k}>
                            {k}
                            <input
                              name={k}
                              type="number"
                              step="1"
                              defaultValue={value?.[k] ?? store.addonPreset?.[part][k] ?? 0}
                              required
                            />
                          </label>
                        ))}
                      </div>
                      <button>Übernehmen</button>
                    </form>
                  );
                })}
              </>
            )}
            {group(
              'Gesicht',
              faceHelp,
              <>
                <button onClick={() => (store.frame.face ? store.applyPreset() : store.ensureFaceRig())}>
                  {store.frame.face ? 'Face-Preset anwenden' : 'Face-Rig V2 initialisieren'}
                </button>
                <p>Face-Rig V{store.definition.faceRigVersion ?? 1}</p>
                {PARTS.map((part) => {
                  const el = store.frame.face?.[part];
                  if (!el) return null;
                  return (
                    <form
                      key={`${part}-${store.index}-${JSON.stringify(el)}`}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget),
                          asset = store.rig && rigElement(store.rig, part, el.state),
                          width = num(d, 'width');
                        store.setFace(part, {
                          x: num(d, 'x'),
                          y: num(d, 'y'),
                          width,
                          height: asset
                            ? Math.max(1, Math.round((width * asset.height) / asset.width))
                            : el.height,
                          visible: d.has('visible'),
                        });
                      }}
                    >
                      <h4>{part}</h4>
                      <select
                        aria-label={`${part} Variante`}
                        value={el.state}
                        onChange={(e) => store.setFace(part, { state: e.target.value })}
                      >
                        {(part === 'mouth' ? MOUTHS : EYES).map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                      <div className="ab-coordinate">
                        {(['x', 'y', 'width'] as const).map((k) => (
                          <label key={k}>
                            {k}
                            <input
                              name={k}
                              type="number"
                              step="1"
                              min={k === 'width' ? 1 : -1024}
                              max="1024"
                              required
                              defaultValue={el[k]}
                            />
                          </label>
                        ))}
                      </div>
                      <label>
                        <input type="checkbox" name="visible" defaultChecked={el.visible !== false} />
                        Sichtbar
                      </label>
                      <button>Übernehmen</button>
                    </form>
                  );
                })}
              </>
            )}
            {group(
              'Auswahl & Operationen',
              'Verschieben und Stretch wirken auf die Grundpose. „Pixel verschieben“ bearbeitet stattdessen den aktiven Pixel-Layer. Jede Anwendung ist einzeln rückgängig machbar.',
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!store.selection) return;
                    const d = new FormData(e.currentTarget),
                      dx = num(d, 'x'),
                      dy = num(d, 'y');
                    if (text(d, 'op') === 'pixels') store.movePixels(dx, dy);
                    else
                      store.operation(
                        text(d, 'op') === 'stretch'
                          ? {
                              type: 'stretchSelection',
                              mask: store.selection,
                              sx: dx,
                              sy: dy,
                              scope: text(d, 'scope'),
                            }
                          : {
                              type: 'moveSelection',
                              mask: store.selection,
                              dx,
                              dy,
                              vacatedArea: { strategy: text(d, 'vacated') },
                            }
                      );
                  }}
                >
                  <select name="op">
                    <option value="move">Verschieben</option>
                    <option value="stretch">Strecken / Stauchen</option>
                    <option value="pixels">Pixel verschieben</option>
                  </select>
                  <select name="vacated">
                    <option value="transparent">Transparent</option>
                    <option value="restoreOriginal">Original behalten</option>
                    <option value="extendSelectionEdge">Auswahlrand fortführen</option>
                  </select>
                  <select name="scope">
                    <option value="bounds">Umgebung schiebt</option>
                    <option value="boundsLocal">Nur Auswahl (lokal)</option>
                  </select>
                  <div className="ab-coordinate">
                    <label>
                      X
                      <input name="x" type="number" step="1" required defaultValue="0" />
                    </label>
                    <label>
                      Y
                      <input name="y" type="number" step="1" required defaultValue="0" />
                    </label>
                  </div>
                  <button disabled={!store.selection}>Anwenden</button>
                </form>
                {store.frame.ops.map((op, i) => (
                  <div key={i}>
                    {op.type}
                    <button
                      title="Operation entfernen"
                      onClick={() =>
                        store.frameEdit({
                          ...store.frame,
                          ops: store.frame.ops.filter((_, n) => n !== i),
                        })
                      }
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
          className={`ab-toggle ab-toggle-right ${right ? 'expanded' : ''}`}
          onClick={() => setRight(!right)}
        >
          ›
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
              Timeline{infoButton('Timeline', help.Timeline)}
              <span className="ab-spacer" />
              <button onClick={() => store.addFrame()}>＋</button>
              <button title="Frame duplizieren" onClick={() => store.addFrame(true)}>
                ⧉
              </button>
              <button
                title="Frame löschen"
                disabled={store.definition.frames.length === 1}
                onClick={() => store.deleteFrame()}
              >
                ×
              </button>
            </header>
            <div className="ab-frames">
              {store.definition.frames.map((f, i) => (
                <button key={i} aria-pressed={store.index === i} onClick={() => store.selectFrame(i)}>
                  Frame {i + 1}
                  <small>{f.durationMs} ms</small>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="ab-status">
        <span>{store.message}</span>
        <span>{store.dirty ? 'Ungespeichert · ' : ''}Legacy · 1024×1024</span>
      </footer>
      <input
        hidden
        id="legacy-library"
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            report(
              file.text().then((json) => {
                store.templates = decodeTemplates(json);
                store.emit();
              })
            );
          e.target.value = '';
        }}
      />
      <input
        hidden
        id="legacy-open"
        type="file"
        accept=".json,.finoanim"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) report(file.text().then(openJson));
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
              ? (d) => {
                  try {
                    modal.submit?.(d);
                    setModal(null);
                  } catch (e) {
                    error(e);
                  }
                }
              : undefined
          }
        >
          {modal.children}
        </Dialog>
      )}
    </div>
  );
}
