import type { ReactNode } from 'react';
import { BuilderHeader, BuilderMenu, FitIcon, SelectionIcon, ToolGroup } from './BuilderUI';
import { BrushSizeSelector } from './BrushSizeSelector';
import { animationStore as store } from './store';
import type { Tool } from './store';
import { SOURCES } from './raster';
import type { SourceId } from './raster';
import { poseForSource } from './nativePoses';
import { builtinReference, REFERENCE_LABELS } from './files';
import { help } from './help';
import type { HelpTopic } from './help';
import type { BuilderDialogs } from './useBuilderDialogs';
import type { RasterDocumentActions } from './useRasterDocumentActions';
import type { useBuilderPanels } from './useBuilderPanels';

const tools: [Tool, string, string][] = [
  ['pencil', '✎', 'Stift'],
  ['eraser', '⌫', 'Radierer'],
  ['eyedropper', '⚗', 'Pipette'],
  ['rect', '□', 'Rechteckauswahl'],
  ['polygon', '⬡', 'Polygonauswahl'],
  ['pan', '↔', 'Ansicht verschieben'],
  ['grab', '◇', 'Layer greifen'],
];
export function BuilderCommands({ ui, documents, panels, mode, setMode, setTab, onOpenEditorMenu }: {
  ui: Pick<BuilderDialogs, 'info' | 'infoButton' | 'rename' | 'saveTemplate' | 'setColorOpen' | 'setMessage' | 'report'>;
  documents: Pick<RasterDocumentActions, 'newAnimation' | 'saveLocal' | 'saveDocument' | 'savePng'>; panels: ReturnType<typeof useBuilderPanels>;
  mode: string; setMode: (mode: string) => void; setTab: (tab: string) => void; onOpenEditorMenu?: () => void;
}) {
  const { info, infoButton, rename, saveTemplate, setColorOpen, setMessage, report } = ui;
  const { newAnimation, saveLocal, saveDocument, savePng } = documents;
  const { left, right, timeline, setLeft, setRight, setTimeline } = panels;
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
    <BuilderMenu name={name}>{content}</BuilderMenu>
  );
  const zoom = (factor: number) =>
    document
      .querySelector('.ab-canvas')
      ?.dispatchEvent(new CustomEvent('builder-zoom', { detail: factor }));
  const toolButton = ([tool, , label]: [Tool, string, string]) => (
    <span className="ab-tool" key={tool}>
      <button title={label} aria-label={label} aria-pressed={store.tool === tool} onClick={() => store.selectTool(tool)}>
        {tool === 'rect' || tool === 'polygon' ? <SelectionIcon polygon={tool === 'polygon'} /> : label}
      </button>
      {store.tool === tool && (tool === 'pencil' || tool === 'eraser') && <BrushSizeSelector value={store.brushSize} onChange={(size) => {
        if (tool === 'pencil') store.pencilSize = size;
        else store.eraserSize = size;
        store.emit();
      }} />}
    </span>
  );
  return <>
    <BuilderHeader name={store.state.name} onOpenEditorMenu={onOpenEditorMenu}>
      {menu(
        'Datei',
        <>
          {action('Neue Animation', newAnimation)}
          {action('Sitzung lokal sichern', () => saveLocal())}
          {action('Raster-Dokument importieren …', () => document.getElementById('ab-document-file')?.click())}
          {action('Raster-Dokument exportieren', saveDocument)}
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
          {action('Frame aus Grundpose', () => store.addPoseFrame(), !poseForSource(store.state.source))}
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
    </BuilderHeader>
    <nav className="ab-toolbar" aria-label="Editor-Werkzeuge">
      <ToolGroup label="Arbeitsbereich">
        <button title="Neue Animation" onClick={newAnimation}>＋</button>
        <select aria-label="Arbeitsbereich" value={mode} onChange={(e) => setMode(e.target.value)}>
          {['Animation', 'Pixel', 'Kombiniert'].map((m) => <option key={m}>{m}</option>)}
        </select>{infoButton('Ansicht')}
      </ToolGroup>
      <ToolGroup label="Zeichnen">{tools.slice(0, 3).map(toolButton)}</ToolGroup>
      <ToolGroup label="Auswahl / Greifen">{tools.slice(3).map(toolButton)}</ToolGroup>
      <ToolGroup label="Wiedergabe / Grundpose">
        <button title={store.playing ? 'Pause' : 'Abspielen'} onClick={() => (store.playing ? store.pause() : store.play())}>{store.playing ? 'Ⅱ' : '▶'}</button>
      <select aria-label="Grundpose" title="Grundpose auf den aktuellen Frame anwenden" value={store.state.source} onChange={(e) => {
        try { store.source(e.target.value as SourceId); } catch (error) { setMessage(String(error)); }
      }}>
        {Object.entries(SOURCES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>{infoButton('Grundpose')}
      </ToolGroup>
      <ToolGroup label="Zoom">
        <button title="Herauszoomen" onClick={() => zoom(0.8)}>−</button>
        <button className="ab-fit" title="Zoom zurücksetzen" aria-label="Einpassen" onClick={() => zoom(0)}><span className="ab-fit-width" aria-hidden="true">Einpassen</span><FitIcon /></button>
        <button title="Hineinzoomen" onClick={() => zoom(1.25)}>＋</button>
      </ToolGroup>
      <ToolGroup label="Undo / Redo">
        <button title="Rückgängig" disabled={!store.past.length} onClick={() => store.undo()}>↶</button>
        <button title="Wiederholen" disabled={!store.future.length} onClick={() => store.redo()}>↷</button>
      </ToolGroup>
    </nav>
  </>;
}
