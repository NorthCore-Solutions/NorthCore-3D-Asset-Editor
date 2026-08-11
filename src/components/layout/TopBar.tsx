import { useRef, useState } from 'react';
import { EDITOR_VERSION } from '../../app/version';
import { isNativeAndroid, overwriteNativeFile, saveBlobAs, type SavedFileReference } from '../../platform/nativeFileDialog';
import { buildProjectFile, deserializeProject, safeFilename, serializeProject } from '../../persistence/projectFile';
import { useEditorStore } from '../../store/editorStore';
import { ExportDialog } from '../dialogs/ExportDialog';

interface WritableFileStreamLike {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface BrowserFileHandleLike {
  name: string;
  createWritable: () => Promise<WritableFileStreamLike>;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    excludeAcceptAllOption?: boolean;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<BrowserFileHandleLike>;
}

type StoredFileTarget =
  | { kind: 'browser'; handle: BrowserFileHandleLike }
  | { kind: 'native'; uri: string; name: string };

async function saveScreenshot(projectName: string): Promise<SavedFileReference | null> {
  const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
  if (!canvas) return null;

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) return null;

  return saveBlobAs(blob, `${safeFilename(projectName)}-preview.png`, 'image/png');
}

function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>('.menu[open]').forEach((menu) => menu.removeAttribute('open'));
}

export function TopBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileTargetRef = useRef<StoredFileTarget | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const project = useEditorStore((state) => state.project);
  const scene = useEditorStore((state) => state.scene);
  const objects = useEditorStore((state) => state.objects);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const newProject = useEditorStore((state) => state.newProject);
  const loadProject = useEditorStore((state) => state.loadProject);
  const markSaved = useEditorStore((state) => state.markSaved);
  const setMessage = useEditorStore((state) => state.setMessage);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const selectedId = useEditorStore((state) => state.selectedId);
  const pastCount = useEditorStore((state) => state.past.length);
  const futureCount = useEditorStore((state) => state.future.length);
  const setScene = useEditorStore((state) => state.setScene);
  const requestCameraView = useEditorStore((state) => state.requestCameraView);

  const serializeCurrentProject = (): string => {
    const file = buildProjectFile(project, scene, objects);
    return serializeProject({ project: file.project, scene: file.scene, objects: file.objects });
  };

  const writeBrowserFile = async (handle: BrowserFileHandleLike, content: string): Promise<void> => {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  };

  const saveAs = async (): Promise<void> => {
    const content = serializeCurrentProject();
    const filename = `${safeFilename(project.name)}.ncae.json`;
    const blob = new Blob([content], { type: 'application/json' });
    const pickerWindow = window as SaveFilePickerWindow;

    try {
      if (isNativeAndroid()) {
        const saved = await saveBlobAs(blob, filename, 'application/json');
        if (!saved?.uri) return;

        fileTargetRef.current = { kind: 'native', uri: saved.uri, name: saved.name };
        markSaved();
        setMessage(`Gespeichert unter: ${saved.name}`);
      } else if (pickerWindow.showSaveFilePicker) {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: filename,
          excludeAcceptAllOption: false,
          types: [{
            description: 'NorthCore Asset Editor Projekt',
            accept: { 'application/json': ['.json'] }
          }]
        });
        await writeBrowserFile(handle, content);
        fileTargetRef.current = { kind: 'browser', handle };
        markSaved();
        setMessage(`Gespeichert unter: ${handle.name}`);
      } else {
        const saved = await saveBlobAs(blob, filename, 'application/json');
        if (!saved) return;

        fileTargetRef.current = null;
        markSaved();
        setMessage(`Heruntergeladen: ${saved.name}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? `Speichern fehlgeschlagen: ${error.message}` : 'Speichern fehlgeschlagen');
    } finally {
      closeMenus();
    }
  };

  const save = async (): Promise<void> => {
    const target = fileTargetRef.current;
    if (!target) {
      await saveAs();
      return;
    }

    try {
      const content = serializeCurrentProject();
      if (target.kind === 'native') {
        await overwriteNativeFile(target.uri, new Blob([content], { type: 'application/json' }));
        setMessage(`Gespeichert: ${target.name}`);
      } else {
        await writeBrowserFile(target.handle, content);
        setMessage(`Gespeichert: ${target.handle.name}`);
      }
      markSaved();
    } catch (error) {
      setMessage(error instanceof Error ? `Speichern fehlgeschlagen: ${error.message}` : 'Speichern fehlgeschlagen');
    } finally {
      closeMenus();
    }
  };

  const load = async (file: File) => {
    try {
      loadProject(deserializeProject(await file.text()));
      fileTargetRef.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Projektdatei konnte nicht geladen werden.');
    }
  };

  return (
    <>
      <header className="topbar">
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Datei</summary>
          <div className="menu-popover">
            <button onClick={() => { fileTargetRef.current = null; newProject(); closeMenus(); }}>Neu</button>
            <button onClick={() => { inputRef.current?.click(); closeMenus(); }}>Öffnen…</button>
            <button onClick={() => { void save(); }}>Speichern</button>
            <button onClick={() => { void saveAs(); }}>Speichern unter…</button>
          </div>
        </details>
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Bearbeiten</summary>
          <div className="menu-popover">
            <button disabled={pastCount === 0} onClick={() => { undo(); closeMenus(); }}>Rückgängig</button>
            <button disabled={futureCount === 0} onClick={() => { redo(); closeMenus(); }}>Wiederholen</button>
            <button disabled={!selectedId} onClick={() => { duplicateObject(); closeMenus(); }}>Duplizieren</button>
            <button disabled={!selectedId} className="danger" onClick={() => { deleteObject(); closeMenus(); }}>Löschen</button>
          </div>
        </details>
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Ansicht</summary>
          <div className="menu-popover">
            <button onClick={() => { requestCameraView('perspective'); closeMenus(); }}>Perspektive</button>
            <button onClick={() => { requestCameraView('focus'); closeMenus(); }}>Auswahl fokussieren</button>
            <button onClick={() => { setScene({ gridVisible: !scene.gridVisible }); closeMenus(); }}>Raster {scene.gridVisible ? 'aus' : 'ein'}</button>
            <button onClick={() => { setScene({ axesVisible: !scene.axesVisible }); closeMenus(); }}>Achsen {scene.axesVisible ? 'aus' : 'ein'}</button>
          </div>
        </details>
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Export</summary>
          <div className="menu-popover">
            <button onClick={() => { setExportOpen(true); closeMenus(); }}>GLB exportieren…</button>
            <button onClick={() => {
              void saveScreenshot(project.name)
                .then((saved) => {
                  if (saved) setMessage(`Screenshot gespeichert: ${saved.name}`);
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? `Screenshot fehlgeschlagen: ${error.message}` : 'Screenshot konnte nicht erstellt werden');
                });
              closeMenus();
            }}>Screenshot als PNG</button>
          </div>
        </details>
        <input className="project-name" aria-label="Projektname" value={project.name} onChange={(event) => setProjectName(event.target.value)} />
        <div className="brand">NorthCore 3D Asset Editor {EDITOR_VERSION}</div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".json,.ncae.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void load(file);
            event.currentTarget.value = '';
          }}
        />
      </header>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </>
  );
}
