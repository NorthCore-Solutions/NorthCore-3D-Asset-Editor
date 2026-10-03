import { lazy, Suspense, useEffect, useState } from 'react';
import { initializeLiveUpdates } from '../platform/liveUpdate';
import { useEditorStore } from '../store/editorStore';
import { animationStore } from '../animation/store';
import { legacyStore } from '../animation/legacyStore';
import { Dialog } from '../animation/Dialog';
import { EDITOR_VERSION } from './version';
import '../animation/builder.css';
import './editor-launcher.css';

const AssetEditor = lazy(() => import('./App').then((module) => ({ default: module.App })));
const AnimationBuilder = lazy(() =>
  import('../animation/BuilderModule').then((module) => ({ default: module.BuilderModule }))
);
export function EditorLauncher() {
  const [editor, setEditor] = useState<'asset' | 'animation' | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [assetVisited, setAssetVisited] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    void initializeLiveUpdates();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [menuOpen]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty || animationStore.dirty || legacyStore.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  const exit = () => {
    if (editor === 'asset' ? useEditorStore.getState().dirty : animationStore.dirty || legacyStore.dirty)
      setExitOpen(true);
    else setEditor(null);
  };
  return (
    <>
      <Suspense fallback={<div className="editor-launcher">Editor wird geladen …</div>}>
        {assetVisited && (
          <div className="asset-editor-host" hidden={editor !== 'asset'}>
            <AssetEditor active={editor === 'asset'} onOpenEditorMenu={() => setMenuOpen(true)} />
          </div>
        )}
        {editor === 'animation' ? (
          <div className="animation-editor-host">
            <AnimationBuilder onOpenEditorMenu={() => setMenuOpen(true)} />
          </div>
        ) : (
          editor === null && (
            <main className="editor-launcher">
              <h1>Northcore Editor {EDITOR_VERSION}</h1>
              <p>Wähle deinen Editor. Deine Arbeit bleibt beim Wechsel erhalten.</p>
              <nav>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setAssetVisited(true);
                    setEditor('asset');
                  }}
                >
                  Asset Editor<small>3D-Objekte gestalten und exportieren</small>
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setEditor('animation');
                  }}
                >
                  Animation Builder<small>Fino zeichnen und animieren</small>
                </button>
              </nav>
            </main>
          )
        )}
      </Suspense>
      {menuOpen && editor && (
        <div
          className="editor-menu-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMenuOpen(false);
          }}
        >
          <section className="editor-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-menu-title">
            <h2 id="editor-menu-title">Menü</h2>
            <button
              className="editor-menu-return"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                exit();
              }}
            >Zur Editor-Auswahl</button>
            <button className="editor-menu-resume" type="button" onClick={() => setMenuOpen(false)}>
              Fortsetzen
            </button>
          </section>
        </div>
      )}
      {exitOpen && (
        <Dialog
          title="Zur Editor-Auswahl?"
          action="Zur Auswahl"
          onCancel={() => setExitOpen(false)}
          onSubmit={() => {
            setExitOpen(false);
            setEditor(null);
          }}
        >
          <p>
            Es gibt ungespeicherte Änderungen. Sie bleiben in dieser Sitzung erhalten. Speichere im Editor,
            bevor du die App schließt.
          </p>
        </Dialog>
      )}
    </>
  );
}
