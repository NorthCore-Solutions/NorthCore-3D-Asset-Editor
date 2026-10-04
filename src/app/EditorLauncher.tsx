import { pauseMenuPlayback } from './menuPlayback';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { initializeLiveUpdates } from '../platform/liveUpdate';
import { useEditorStore } from '../store/editorStore';
import { animationStore } from '../animation/store';
import { legacyMigrationController } from '../animation/migration/migrationController';
import { globalTemplateLibrary } from '../animation/globalTemplateLibrary';
import { EditorMenuDialog } from './EditorMenuDialog';
import { EDITOR_VERSION } from './version';
import '../animation/builder.css';
import './editor-launcher.css';

const AssetEditor = lazy(() => import('./App').then((module) => ({ default: module.App })));
const AnimationBuilder = lazy(() =>
  import('../animation/AnimationBuilder').then((module) => ({ default: module.AnimationBuilder }))
);
export function EditorLauncher() {
  const [editor, setEditor] = useState<'asset' | 'animation' | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [assetVisited, setAssetVisited] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOpener, setMenuOpener] = useState<HTMLElement | null>(null);
  const playbackResume = useRef<((resume: boolean) => void) | null>(null);
  const openMenu = () => {
    if (menuOpen || exitOpen) return;
    playbackResume.current = editor === 'animation' ? pauseMenuPlayback() : null;
    setMenuOpener(document.querySelector<HTMLElement>(editor === 'asset'
      ? '.asset-editor-host .editor-menu-trigger' : '.animation-editor-host .editor-menu-trigger'));
    setMenuOpen(true);
  };
  const closeMenu = (resume = true) => {
    const finishPlayback = playbackResume.current;
    playbackResume.current = null;
    setMenuOpen(false); setExitOpen(false);
    finishPlayback?.(resume && editor === 'animation' && Boolean(menuOpener?.isConnected));
  };
  useEffect(() => {
    void initializeLiveUpdates();
    void legacyMigrationController.loadStatus().catch(() => { /* The migration manager reports storage errors when opened. */ });
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty || animationStore.dirty || animationStore.persistenceUnsaved || legacyMigrationController.dirty || globalTemplateLibrary.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  const exit = () => {
    if (legacyMigrationController.dirty || (editor === 'asset' ? useEditorStore.getState().dirty : animationStore.dirty || animationStore.persistenceUnsaved || globalTemplateLibrary.dirty))
      setExitOpen(true);
    else { closeMenu(false); setEditor(null); }
  };
  return (
    <>
      <Suspense fallback={<div className="editor-launcher">Editor wird geladen …</div>}>
        {assetVisited && (
          <div className="asset-editor-host" hidden={editor !== 'asset'}>
            <AssetEditor active={editor === 'asset'} onOpenEditorMenu={() => openMenu()} />
          </div>
        )}
        {editor === 'animation' ? (
          <div className="animation-editor-host">
            <AnimationBuilder onOpenEditorMenu={openMenu} />
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
      {(menuOpen || exitOpen) && editor && (
        <EditorMenuDialog confirming={exitOpen} opener={menuOpener}
          onClose={closeMenu} onReturn={exit}
          onConfirm={() => { closeMenu(false); setEditor(null); }} />
      )}
    </>
  );
}
