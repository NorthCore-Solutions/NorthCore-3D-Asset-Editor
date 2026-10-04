import { useEffect, useState, useSyncExternalStore } from 'react';
import { animationStore as store } from './store';
import { globalTemplateLibrary as library } from './globalTemplateLibrary';
import { useBuilderPanels } from './useBuilderPanels';
import { useBuilderDialogs } from './useBuilderDialogs';
import { useBuilderShortcuts } from './useBuilderShortcuts';
import { useRasterDocumentActions } from './useRasterDocumentActions';
import { BuilderCommands } from './BuilderCommands';
import { BuilderLibraryPanel, BuilderLibraryFileInput } from './BuilderLibraryPanel';
import { BuilderInspector } from './BuilderInspector';
import { BuilderTimeline } from './BuilderTimeline';
import { RasterCanvas } from './RasterCanvas';
import './builder.css';

export function AnimationBuilder({ onOpenEditorMenu }: { onOpenEditorMenu?: () => void }) {
  useSyncExternalStore(store.subscribe, store.snapshot);
  useSyncExternalStore(library.subscribe, library.snapshot);
  useEffect(() => {
    return () => { store.pause(false); };
  }, []);
  const ui = useBuilderDialogs();
  const documents = useRasterDocumentActions(ui);
  const panels = useBuilderPanels();
  const [mode, setMode] = useState('Kombiniert');
  const [tab, setTab] = useState('Dateien');
  useEffect(() => { if (tab === 'Vorlagen') void library.load(); }, [tab]);
  useBuilderShortcuts(ui.modal, ui.colorOpen);
  const { left, right, timeline, setLeft, setRight, setTimeline } = panels;
  const { message } = ui;
  return (
    <div className="animation-builder">
      <BuilderCommands ui={ui} documents={documents} panels={panels}
        mode={mode} setMode={setMode} setTab={setTab} onOpenEditorMenu={onOpenEditorMenu} />
      <main className="ab-workspace" data-timeline-open={timeline}>
        <RasterCanvas store={store} />
        <BuilderLibraryPanel open={left} onToggle={() => setLeft(!left)} tab={tab} setTab={setTab}
          ui={ui} documents={documents} />
        <BuilderInspector open={right} onToggle={() => setRight(!right)} mode={mode} ui={ui} />
        <BuilderTimeline open={timeline} onToggle={() => setTimeline(!timeline)} ui={ui} />
      </main>
      <footer className="ab-status">
        <span>{message}</span><span className={store.dirty ? 'ab-unsaved' : ''}>{store.dirty ? 'Ungespeichert' : 'Unverändert'}</span>
        {library.dirty && <span className="ab-unsaved">Globale Bibliothek ungesichert</span>}
        <span>
          {store.state.frames.length} Frames · {mode} · Raster 128×128
        </span>
      </footer>
      {documents.conflictControls}
      <BuilderLibraryFileInput ui={ui} />
      {documents.inputs}
      {ui.overlays}
    </div>
  );
}
