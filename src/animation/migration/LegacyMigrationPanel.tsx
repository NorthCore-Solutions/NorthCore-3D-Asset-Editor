import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { animationStore } from '../store';
import { saveBlobAs } from '../../platform/nativeFileDialog';
import { EDITOR_MENU_OPENED } from '../../app/editorMenuModal';
import { pauseMenuPlayback } from '../../app/menuPlayback';
import { legacyMigrationController as controller } from './migrationController';
import { listLegacyMigrationData, readLocalMigrationArchive, readCompletedLocalMigration, readLocalArchiveOriginal } from './localMigration';

function Preview({ bytes, size, label }: { bytes: Uint8Array; size: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(bytes), size, size), 0, 0);
  }, [bytes, size]);
  return <figure style={{ margin: 0 }}><figcaption>{label}</figcaption><canvas ref={canvas} width={size} height={size}
    style={{ width: 128, height: 128, imageRendering: 'pixelated', background: '#24202d' }} /></figure>;
}
export function LegacyMigrationPanel() {
  const revision = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [open, setOpen] = useState(false), [context, setContext] = useState(''), [approved, setApproved] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof listLegacyMigrationData>> | null>(null);
  const [error, setError] = useState(''), [frame, setFrame] = useState(0);
  const [journalStatus, setJournalStatus] = useState('');
  const listing = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), opener = useRef<HTMLButtonElement>(null);
  const resume = useRef<((resume: boolean) => void) | null>(null);
  const [pendingOpen, setPendingOpen] = useState<(() => Promise<unknown>) | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true; const generation = ++listing.current;
    void listLegacyMigrationData(undefined, { filter: journalStatus ? { status: journalStatus } : undefined }).then((result) => { if (active && generation === listing.current) setData(result); },
      (e: unknown) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [open, revision, journalStatus]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const trigger = opener.current;
    resume.current = pauseMenuPlayback();
    element.showModal(); window.dispatchEvent(new Event(EDITOR_MENU_OPENED));
    return () => { element.close(); resume.current?.(true); resume.current = null; trigger?.focus(); };
  }, [open]);
  const close = () => { controller.cancel(); setPendingOpen(null); setOpen(false); };
  const action = (task: Promise<unknown>) => { void task.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); };
  const begin = () => { setApproved(false); setFrame(0); setError(''); };
  const openTarget = (id: string) => {
    // Capture the session before the asynchronous integrity read, then ask before replacing dirty content.
    const session = animationStore.captureContent();
    const perform = async () => {
      if (!animationStore.isCurrentSession(session)) throw Error('Dokument wurde inzwischen gewechselt.');
      const result = await controller.open(animationStore, id);
      if (result === 'stale') throw Error('Dokument wurde inzwischen gewechselt.');
      setPendingOpen(null); close();
    };
    if (animationStore.dirty) { setPendingOpen(() => perform); setError('Aktuelles Raster-Dokument enthält ungesicherte Änderungen.'); }
    else action(perform());
  };
  const download = async (archiveId: string, originalOnly = false) => {
    const original = originalOnly ? await readLocalArchiveOriginal(archiveId) : undefined;
    const complete = originalOnly ? undefined : await readLocalMigrationArchive(archiveId);
    const json = original ? original.definition!.json : JSON.stringify(complete);
    await saveBlobAs(new Blob([json], { type: 'application/json' }),
      originalOnly ? original!.source.name : `Legacy-Originalarchiv-${archiveId}.json`, 'application/json');
  };
  const more = (kind: 'sources' | 'journals' | 'archives') => {
    const generation = listing.current;
    const after = data?.next[kind]; if (!after) return;
    action(listLegacyMigrationData(undefined, { [kind === 'sources' ? 'sourceAfter' : kind === 'journals' ? 'journalAfter' : 'archiveAfter']: after,
      filter: journalStatus ? { status: journalStatus } : undefined }).then((page) => {
      if (generation !== listing.current) return;
      setData((old) => {
        if (!old) return old;
        return { ...old, [kind]: kind === 'journals'
          ? [...new Map([...old.journals, ...page.journals].map((j) => [j.id, j])).values()]
          : [...new Set([...old[kind], ...page[kind]])],
          unverifiedSources: kind === 'sources' ? [...new Set([...old.unverifiedSources, ...page.unverifiedSources])] : old.unverifiedSources,
          next: { ...old.next, [kind]: page.next[kind] } };
      });
    }));
  };
  const preview = controller.previews[frame];
  return <>
    <button ref={opener} onClick={() => setOpen(true)}>Legacy-Daten importieren / verwalten …</button>
    {controller.dirty && <p role="status">Migration: {controller.status === 'saving' ? 'Speicherung ausstehend' : 'Ungesicherter Migrationslauf'}
      {controller.error && ` · ${controller.error}`}</p>}
    {open && <dialog ref={dialog} data-editor-menu className="editor-menu-dialog" aria-label="Legacy-Daten importieren und verwalten"
      style={{ maxWidth: 760, width: '90vw', maxHeight: '90vh', overflow: 'auto' }}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onPointerDown={(event) => { const b = event.currentTarget.getBoundingClientRect();
        if (event.target === event.currentTarget && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) close(); }}>
      <h2>Legacy-Daten importieren und verwalten</h2>
      <p>Originale bleiben unverändert. Keine automatische Migration.</p>
      <button autoFocus onClick={() => input.current?.click()} disabled={controller.status === 'saving'}>Legacy-Datei auswählen …</button>
      <input ref={input} hidden type="file" accept=".json,.finoanim" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) { begin(); action(controller.external(file, file.name)); }
      }} />
      <label>Darstellungskontext<select aria-label="Legacy-Addon-Kontext" disabled={controller.status === 'saving'} value={context} onChange={(event) => { controller.cancel(); setContext(event.target.value); setApproved(false); }}>
        <option value="">Nicht bekannt / automatisch prüfen</option>
        {['addons', 'addons_cleaned', 'addons_normalized'].map((root) => <option key={root} value={root}>{root}</option>)}
      </select></label>
      <button disabled={controller.status === 'saving' || controller.status === 'preparing'} onClick={() => { begin(); action(controller.recheck(context ? { addonRoot: context } : undefined)); }}>Mit Kontext erneut prüfen</button>
      <p role="status">Prüfung: {controller.status} · {controller.report?.route ?? controller.audit?.route ?? 'Noch keine Prüfung'}</p>
      {(controller.audit || controller.report) && <p>Face-Rig: {controller.report?.source.context.rigVersion ?? controller.audit?.resolved.rigVersion ?? 'unbekannt'}</p>}
      {controller.audit?.issues.map((issue, index) => <p key={index}>{issue.severity}: {issue.path} · {issue.message}</p>)}
      {(controller.error || error) && <p role="alert">{controller.error || error}</p>}
      {preview && <>
        <label>Vorschau-Frame<select value={frame} onChange={(event) => setFrame(Number(event.target.value))}>
          {controller.previews.map((p) => <option key={p.index} value={p.index}>Frame {p.index + 1}</option>)}
        </select></label>
        <div style={{ display: 'flex', gap: 12 }}>
          <Preview bytes={preview.legacyRgba} size={1024} label="Legacy-Original" />
          <Preview bytes={preview.rasterRgba} size={128} label="Raster128-Ziel" />
        </div>
      </>}
      {controller.report?.route === 'gerastert verlustbehaftet' && controller.status === 'review' && <label>
        <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
        Verlustbehaftete Rasterisierung ausdrücklich freigeben
      </label>}
      {controller.status === 'review' && <button disabled={controller.report?.route === 'gerastert verlustbehaftet' && !approved}
        onClick={() => action(controller.commit(approved))}>Archiv und Raster-Ziel speichern</button>}
      {controller.status === 'failed' && <button onClick={() => { setApproved(false); action(controller.retry()); }}>Migration erneut vorbereiten</button>}
      {controller.status === 'saved' && controller.completedId && <button onClick={() => openTarget(controller.completedId!)}>Migriertes Ziel in Raster128 öffnen</button>}
      {pendingOpen && <div role="group" aria-label="Ungesicherte Änderungen">
        <button onClick={() => action(pendingOpen())}>Ungesicherten Stand verwerfen und Ziel öffnen</button>
        <button onClick={() => { setPendingOpen(null); setError(''); }}>Aktuellen Stand behalten</button>
      </div>}
      <h3>Lokale Legacy-Dokumente</h3>
      {data?.sources.map((key) => <div key={key}>{key}{data.unverifiedSources.includes(key) && ' (Quellstand ungeprüft)'} <button disabled={controller.status === 'saving'} onClick={() => {
        begin(); action(controller.local(key, context ? { addonRoot: context } : undefined)); }}>Prüfen: {key}</button></div>)}
      {data?.next.sources && <button onClick={() => more('sources')}>Weitere Legacy-Quellen laden</button>}
      <h3>Migrationsjournal / Raster-Ziele</h3>
      <label>Journalstatus<select value={journalStatus} onChange={(event) => setJournalStatus(event.target.value)}>
        <option value="">Alle</option>{['prepared', 'stored', 'completed', 'failed'].map((status) => <option key={status}>{status}</option>)}
      </select></label>
      {data?.journals.map((journal) => <div key={journal.id}>
        <p>{journal.sourceKey} · {journal.status} · {journal.route} · Konverter {journal.converterVersion} · {journal.targetKey}</p>
        {journal.error && <p>{journal.error.message}</p>}
        {journal.status === 'completed' ? <>
          <button onClick={() => openTarget(journal.id)}>Ziel öffnen: {journal.sourceKey}</button>
          <button onClick={() => action(readCompletedLocalMigration(journal.id).then((saved) => saveBlobAs(new Blob([saved.json], { type: 'application/json' }), saved.journal.targetKey, 'application/json')))}>Raster-Ziel exportieren</button>
        </> : <button disabled={controller.status === 'saving'} onClick={() => { begin(); action(controller.resume(journal.id)); }}>Wiederaufnehmen: {journal.sourceKey}</button>}
      </div>)}
      {data?.next.journals && <button onClick={() => more('journals')}>Weitere Journale laden</button>}
      <h3>Dauerhafte Originalarchive</h3>
      {data?.archives.map((id) => <div key={id}><code>{id.slice(0, 16)}</code>
        <button onClick={() => action(download(id))}>Vollständiges Originalarchiv exportieren</button>
        <button onClick={() => action(download(id, true))}>Original-JSON exportieren</button>
      </div>)}
      {data?.next.archives && <button onClick={() => more('archives')}>Weitere Archive laden</button>}
      <button onClick={close}>Schließen / Abbrechen</button>
    </dialog>}
  </>;
}
