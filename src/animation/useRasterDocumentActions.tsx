import { useCallback, useEffect, useRef, useState } from 'react';
import { animationStore as store } from './store';
import { textField } from './builderForm';
import { SOURCES } from './raster';
import type { SourceId } from './raster';
import { exportPng, exportRasterDocument, importRasterDocument, importReference, RASTER_DOCUMENT_ACCEPT, loadRasterSession, watchRasterStorage, saveRasterSession } from './files';
import { localSessionStorage } from './storage';
import type { SessionRecord } from './storage';
import type { BuilderDialogs } from './useBuilderDialogs';


/** Document dialogs/file inputs call the existing validated persistence APIs. */
export function useRasterDocumentActions({ setModal, setMessage, report }: Pick<BuilderDialogs, 'setModal' | 'setMessage' | 'report'>) {
  const [sessions, setSessions] = useState<Map<string, string>>(new Map());
  const [nextSession, setNextSession] = useState<string>();
  const listing = useRef(0);
  const invalidateListing = useCallback(() => { listing.current++; }, []);
  const moreSessions = () => {
    const generation = listing.current;
    report(localSessionStorage.query({ kind: 'raster', after: nextSession }).then((page) => {
      if (generation !== listing.current) return;
      setSessions((old) => new Map([...old, ...page.items.map((meta) => [meta.key, ''] as const)])); setNextSession(page.next);
    }));
  };
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const current = ++listing.current;
      void localSessionStorage.query({ kind: 'raster' }).then((page) => { if (active && current === listing.current) { setSessions(new Map(page.items.map((meta) => [meta.key, '']))); setNextSession(page.next); } })
        .catch(() => { if (active && current === listing.current) setMessage('Lokaler Speicher ist nicht verfügbar.'); });
    };
    refresh();
    const stopListing = localSessionStorage.subscribe((keys) => { if (keys.some((key) => key === '*' || (!key.startsWith('__') && !key.endsWith('.finoanim.json')))) refresh(); });
    const stopDocument = watchRasterStorage(store);
    return () => { active = false; invalidateListing(); stopListing(); stopDocument(); };
  }, [setMessage, invalidateListing]);
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
            Ausgangszustand
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
  const saveLocal = (expected?: SessionRecord) =>
    report(
      (async () => {
        const result = await saveRasterSession(store, { expected });
        if (result === 'busy' || result === 'stale') return;
        setMessage(result === 'saved' ? 'Sitzung lokal gesichert.' : 'Sitzung lokal gesichert; weitere Änderungen sind ungespeichert.');
        const generation = ++listing.current;
        const page = await localSessionStorage.query({ kind: 'raster' });
        if (generation !== listing.current) return;
        setSessions(new Map(page.items.map((meta) => [meta.key, '']))); setNextSession(page.next);
      })()
    );
  const savePng = () =>
    report(
      exportPng(store.frame, store.state.name).then((result) => {
        if (result) setMessage(`${result.name} exportiert (ohne Referenz)`);
      })
    );
  const saveDocument = () => report(exportRasterDocument(store).then((result) => {
    if (result) setMessage(`${result.name} exportiert; lokaler Sicherungsstatus unverändert.`);
  }));
  const importDocument = (file: File) => {
    const session = store.captureContent();
    setModal({
      title: 'Raster-Dokument importieren',
      content: <p>„{file.name}“ importieren? Der aktuelle Stand wird ersetzt. Sichere ihn vorher lokal oder exportiere ihn als Raster-Dokument.</p>,
      action: 'Importieren',
      submit: () => {
        if (!store.isCurrentSession(session)) return;
        report(importRasterDocument(store, file).then((result) => {
          if (result === 'imported') setMessage(`${file.name} importiert`);
        }));
      },
    });
  };
  const load = (name: string) =>
    setModal({
      title: 'Sitzung öffnen',
      content: (
        <p>
          „{name}“ laden? Der aktuelle Stand wird ersetzt. Sichere ihn vorher über „Sitzung lokal
          sichern“.
        </p>
      ),
      action: 'Öffnen',
      submit: () => report(loadRasterSession(store, name).then((result) => {
        if (result === 'loaded') setMessage(`${name} geladen`);
      })),
    });
  const overwrite = () => report((async () => {
    const session = store.captureContent(), key = store.state.name;
    const expected = await localSessionStorage.read(key);
    if (!store.isCurrentSession(session)) return;
    setModal({ title: 'Lokalen Stand überschreiben', action: 'Überschreiben',
      content: <p>Den gespeicherten Stand „{key}“ (Revision {expected.revision?.sequence ?? 'Altbestand'}) durch deinen lokalen Stand ersetzen? Änderungen anderer Tabs werden ersetzt. Exportiere sie bei Bedarf vorher.</p>,
      submit: () => { if (store.isCurrentSession(session)) saveLocal(expected); },
    });
  })());
  const conflictControls = store.localPersistence && ['updated', 'conflict', 'failed'].includes(store.localPersistence.status) && <div className="ab-storage-conflict" role="status">
    <span>{store.localPersistence.error ?? 'Gespeicherter Stand in anderem Tab aktualisiert.'}</span>
    <button onClick={() => load(store.localPersistence!.key)}>Externen Stand laden …</button>
    <button onClick={overwrite}>Lokalen Stand überschreiben …</button>
  </div>;
  const inputs = <>
    <input
      id="ab-document-file"
      type="file"
      accept={RASTER_DOCUMENT_ACCEPT}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) importDocument(file);
      }}
    />
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
  </>;
  return { sessions, nextSession, moreSessions, newAnimation, saveLocal, savePng, saveDocument, load, inputs, conflictControls };
}
export type RasterDocumentActions = ReturnType<typeof useRasterDocumentActions>;
