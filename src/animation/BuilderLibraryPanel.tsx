import type { ReactNode } from 'react';
import { BuilderPanel, LibraryTabs } from './BuilderUI';
import { animationStore as store } from './store';
import { globalTemplateLibrary as library, saveGlobalSelection, applyGlobalTemplate, exportGlobalLibrary, importGlobalLibrary } from './globalTemplateLibrary';
import type { BuilderDialogs } from './useBuilderDialogs';
import type { RasterDocumentActions } from './useRasterDocumentActions';

export function BuilderLibraryPanel({ open: left, onToggle, tab, setTab, ui, documents, migrationPanel, legacyTemplateImport }: {
  open: boolean; onToggle: () => void; tab: string; setTab: (tab: string) => void;
  ui: Pick<BuilderDialogs, 'infoButton' | 'rename' | 'insert' | 'saveTemplate' | 'report' | 'setMessage' | 'setModal'>;
  documents: Pick<RasterDocumentActions, 'sessions' | 'nextSession' | 'moreSessions' | 'newAnimation' | 'saveLocal' | 'load'>; migrationPanel: ReactNode; legacyTemplateImport: ReactNode;
}) {
  const { infoButton, rename, insert, saveTemplate, report, setMessage } = ui;
  const { sessions, nextSession, moreSessions, newAnimation, saveLocal, load } = documents;
  return (
    <BuilderPanel side="left" title="Dateien / Vorlagen" open={left} onToggle={onToggle} info={infoButton(tab === 'Dateien' ? 'Dateien' : 'Vorlagen')}>
        <LibraryTabs value={tab} onChange={setTab}>
        {tab === 'Dateien' ? (
          <>
            <div className="ab-library-actions">
              <button onClick={newAnimation}>＋ Neue Animation</button>
              <button onClick={() => saveLocal()}>Sitzung lokal sichern</button>
            </div>
            {[...sessions]
              .filter(([name]) => !name.endsWith('.finoanim.json') && !name.startsWith('__'))
              .map(([name]) => (
                <button className="ab-library-row" key={name} onClick={() => load(name)}>
                  {name}
                </button>
              ))}
            {nextSession && <button onClick={moreSessions}>Weitere Raster-Dokumente laden</button>}
            {migrationPanel}
            <p>Die aktuelle Sitzung bleibt beim Editorwechsel erhalten.</p>
          </>
        ) : (
          <>
            <h3>Globale Pixel-Vorlagen</h3>
            <p role="status">Bibliothek: {{ loading: 'Wird geladen', pending: 'Speicherung ausstehend', failed: 'Fehler', saved: 'Gespeichert' }[library.status]}
              {library.error && ` · ${library.error}`}</p>
            {library.status === 'failed' && <button onClick={() => report(library.retry())}>Bibliothek erneut speichern</button>}
            {library.externalChanged && <>
              <p role="status">Bibliothek in anderem Tab geändert. Lokale Vorlagen bleiben erhalten.</p>
              <button onClick={() => ui.setModal({ title: 'Globale Bibliothek neu laden', action: 'Neu laden',
                content: <p>Aktuellen gespeicherten Stand laden? Ungesicherte lokale Bibliotheksänderungen werden verworfen.</p>,
                submit: () => report(library.reload()),
              })}>Bibliothek neu laden …</button>
              {library.dirty && <button onClick={() => ui.setModal({ title: 'Globale Bibliothek überschreiben', action: 'Überschreiben',
                content: <p>Den aktuellen gespeicherten Bibliotheksstand durch deine lokalen Vorlagen ersetzen? Fremde Änderungen werden ersetzt.</p>,
                submit: () => report(library.overwrite()),
              })}>Bibliothek überschreiben …</button>}
            </>}
            <div className="ab-library-actions">
              <button disabled={!store.selection} onClick={() => rename('Globale Vorlage speichern', 'Neue globale Vorlage', (name) => {
                setMessage(saveGlobalSelection(store, library, name) ? 'Globale Vorlage zur Speicherung vorgemerkt.' : 'Keine bearbeitbaren Pixel ausgewählt.');
              })}>Auswahl global speichern …</button>
              <button onClick={() => report(exportGlobalLibrary())}>Bibliothek exportieren …</button>
              <button onClick={() => document.querySelector<HTMLInputElement>('#ab-library-file')?.click()}>Bibliothek importieren …</button>
              {legacyTemplateImport}
            </div>
            {library.templates.map((template) => <div className="ab-library-row" key={template.id}>
              <button onClick={() => insert({ name: template.name, bounds: { ...template.origin, width: template.width, height: template.height } },
                (to) => applyGlobalTemplate(store, template, to))}>{template.name}</button>
              <button title="Globale Vorlage umbenennen" onClick={() => rename('Globale Vorlage umbenennen', template.name, (name) => library.rename(template.id, name))}>✎</button>
              <button title="Globale Vorlage löschen" onClick={() => library.remove(template.id)}>×</button>
            </div>)}
            <h3>Dokumentvorlagen</h3>
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
                      store.renameAsset(t.id, name);
                    })
                  }
                >
                  ✎
                </button>
                <button
                  title="Löschen"
                  onClick={() => {
                    store.deleteAsset(t.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}
        </LibraryTabs>
    </BuilderPanel>
  );
}

export function BuilderLibraryFileInput({ ui: { setModal, report, setMessage } }: { ui: Pick<BuilderDialogs, 'setModal' | 'report' | 'setMessage'> }) {
  return (
    <input
      id="ab-library-file" type="file" accept=".raster128-library.json,application/json" hidden
      onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) setModal({ title: 'Globale Bibliothek importieren', action: 'Importieren',
          content: <p>„{file.name}“ ersetzt die globale Bibliothek. Exportiere sie vorher als Sicherung. Dokumentvorlagen bleiben erhalten.</p>,
          submit: () => report(importGlobalLibrary(library, file).then(() => setMessage('Bibliotheksimport zur Speicherung vorgemerkt.'))),
        });
      }}
    />
  );
}
