import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animationStore as store } from './store';
import { importRasterDocument, serializeSession } from './files';
import { pickProjectDirectory, supportsProjectDirectory, rememberedProjectDirectory, projectEntries, projectFileName, writeProjectFile, projectFlyoutPosition } from './projectDirectory';
import type { ProjectDirectoryHandle, ProjectFileHandle } from './projectDirectory';
import type { BuilderDialogs } from './useBuilderDialogs';

type Entry = ProjectDirectoryHandle | ProjectFileHandle;
type Level = { directory: ProjectDirectoryHandle; entries: Entry[]; anchor: DOMRect };
export function ProjectLibrary({ ui }: { ui: Pick<BuilderDialogs, 'setMessage' | 'setModal' | 'report'> }) {
  const [root, setRoot] = useState<ProjectDirectoryHandle>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [granted, setGranted] = useState(false);
  const [chain, setChain] = useState<Level[]>([]);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [target, setTarget] = useState<{ file: ProjectFileHandle; session: ReturnType<typeof store.captureContent> }>();
  const panel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const listing = useRef(0);
  const rootEpoch = useRef(0);
  const busy = useRef(false);
  const currentTarget = target && store.isCurrentSession(target.session) ? target.file : undefined;
  const supported = supportsProjectDirectory();
  const { setMessage, setModal, report } = ui;
  const invalidateListing = useCallback(() => { listing.current++; }, []);
  const close = useCallback(() => { generation.current++; setChain([]); }, []);
  const refresh = useCallback(async () => {
    if (!root) return;
    const id = ++listing.current;
    const allowed = await root.queryPermission({ mode: 'readwrite' }) === 'granted';
    if (id !== listing.current) return;
    setGranted(allowed);
    if (!allowed) { setEntries([]); close(); return; }
    const next = await projectEntries(root);
    if (id !== listing.current) return;
    setEntries(next);
    // Open menus are live views too; deleted/unreadable folders close cleanly.
    close();
  }, [root, close]);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    const epoch = rootEpoch.current;
    void rememberedProjectDirectory().then((handle) => { if (active && rootEpoch.current === epoch && handle) setRoot(handle); }).catch(() => {
      // A blocked/unavailable IndexedDB must not prevent connecting for this session.
    });
    return () => { active = false; };
  }, [supported]);
  useEffect(() => {
    let active = true;
    const activate = () => { if (active) report(refresh()); };
    const visible = () => { if (document.visibilityState === 'visible') activate(); };
    activate();
    window.addEventListener('focus', activate);
    window.addEventListener('pageshow', activate);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; invalidateListing(); window.removeEventListener('focus', activate); window.removeEventListener('pageshow', activate); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, report, invalidateListing]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest('.ab-project-library,.ab-project-flyout')) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && chain.length) { event.preventDefault(); event.stopImmediatePropagation(); close(); panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); } };
    const resize = () => { setSize({ width: window.innerWidth, height: window.innerHeight }); close(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); };
  }, [chain.length, close]);
  const connect = async () => {
    try {
      rootEpoch.current++;
      const handle = await pickProjectDirectory();
      close(); setRoot(handle); setTarget(undefined);
      try { await rememberedProjectDirectory(handle); }
      catch { setMessage('Ordner verbunden; Wiederverwendung nach Neustart ist hier nicht verfügbar.'); }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) throw error; }
  };
  const authorize = async () => {
    if (root && await root.requestPermission({ mode: 'readwrite' }) === 'granted') await refresh();
    else setMessage('Ordnerzugriff nicht erteilt. Datei-Import und Export bleiben verfügbar.');
  };
  const openFolder = async (directory: ProjectDirectoryHandle, depth: number, anchor: DOMRect) => {
    const id = ++generation.current;
    setChain((previous) => previous.slice(0, depth));
    const next = await projectEntries(directory);
    if (id !== generation.current) return;
    setChain((previous) => [...previous.slice(0, depth), { directory, entries: next, anchor }]);
  };
  const openFile = async (file: ProjectFileHandle) => {
    const content = store.captureContent();
    const blob = await file.getFile();
    if (!store.isCurrentSession(content)) return;
    const result = await importRasterDocument(store, blob);
    if (result === 'imported') { setTarget({ file, session: store.captureContent() }); close(); setMessage(`Projekt geöffnet: ${file.name}`); }
  };
  const requestOpenFile = (file: ProjectFileHandle) => {
    close();
    if (store.dirty || store.persistenceUnsaved) setModal({ title: 'Projekt öffnen', action: 'Öffnen', content: <p>„{file.name}“ öffnen und ungesicherte Änderungen am aktuellen Dokument verwerfen?</p>, submit: () => report(openFile(file)) });
    else report(openFile(file));
  };
  const save = async (file: ProjectFileHandle, json: string, content: ReturnType<typeof store.captureContent>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await writeProjectFile(file, json);
      if (store.markSaved(content)) { setTarget({ file, session: content }); setMessage(`Projekt gespeichert: ${file.name}${store.dirty ? ' · Weitere Änderungen ungespeichert' : ''}`); }
      await refresh();
    } finally { busy.current = false; }
  };
  const saveAs = (directory = root) => {
    if (!directory) return;
    setModal({ title: `Projekt speichern in ${directory.name}`, action: 'Speichern', content: <label>Dateiname<input name="filename" required autoFocus defaultValue={projectFileName(store.state.name)} /></label>, submit: (data) => report((async () => {
      const filename = data.get('filename');
      if (typeof filename !== 'string') throw Error('Bitte einen Dateinamen angeben.');
      const name = projectFileName(filename);
      const json = serializeSession(store), content = store.captureContent();
      let existing: ProjectFileHandle | undefined;
      try { existing = await directory.getFileHandle(name); } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
      if (existing) {
        const file = existing;
        setTimeout(() => setModal({ title: 'Projektdatei ersetzen', action: 'Ersetzen', content: <p>„{name}“ in „{directory.name}“ durch das aktuelle Dokument ersetzen?</p>, submit: () => report(save(file, json, content)) }), 0);
      } else await save(await directory.getFileHandle(name, { create: true }), json, content);
    })()) });
  };
  const row = (entry: Entry, depth: number) => <button key={`${entry.kind}:${entry.name}`} role="menuitem" className="ab-project-entry" aria-haspopup={entry.kind === 'directory' ? 'menu' : undefined} aria-expanded={entry.kind === 'directory' ? chain[depth]?.directory === entry : undefined}
    onClick={(event) => entry.kind === 'directory' ? report(openFolder(entry, depth, event.currentTarget.getBoundingClientRect())) : requestOpenFile(entry)}
    onKeyDown={(event) => {
      if (event.key === 'ArrowRight' && entry.kind === 'directory') { event.preventDefault(); report(openFolder(entry, depth, event.currentTarget.getBoundingClientRect())); }
      if (event.key === 'ArrowLeft' && depth > 0) { event.preventDefault(); generation.current++; setChain((previous) => previous.slice(0, depth - 1)); }
    }}><span>{entry.name}</span>{entry.kind === 'directory' && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>}</button>;
  const width = Math.min(260, Math.max(100, size.width - 16));
  return <div className="ab-project-library" ref={panel}>
    <h3>Projektordner</h3>
    {supported ? <button onClick={() => report(connect())}>Hauptordner verbinden …</button> : <p>Ordnerbindung ist hier nicht verfügbar. Verwende Raster-Dokument importieren / exportieren.</p>}
    {root && <>
      <p title={root.name}>{root.name}</p>
      {!granted ? <button onClick={() => report(authorize())}>Ordnerzugriff erlauben</button> : <>
        <div className="ab-library-actions"><button onClick={() => report(refresh())}>Ordner aktualisieren</button><button onClick={() => saveAs()}>Projekt hier speichern …</button></div>
        {currentTarget && <button onClick={() => report(save(currentTarget, serializeSession(store), store.captureContent()))}>Projektdatei speichern</button>}
        <div role="menu" aria-label="Projektdateien">{entries.map((entry) => row(entry, 0))}{!entries.length && <p>Keine Projektdateien oder Unterordner.</p>}</div>
      </>}
    </>}
    {chain.map((level, index) => {
      const height = Math.min(400, size.height - 16);
      const position = projectFlyoutPosition(level.anchor, width, height, size);
      return createPortal(<div key={`${index}:${level.directory.name}`} className="ab-project-flyout animation-builder" role="menu" aria-label={level.directory.name} style={{ ...position, width, maxHeight: height, zIndex: 160 + index }}>
        <strong>{level.directory.name}</strong>
        <button onClick={() => saveAs(level.directory)}>Projekt hier speichern …</button>
        {level.entries.map((entry) => row(entry, index + 1))}
        {!level.entries.length && <p>Ordner ist leer.</p>}
      </div>, document.body);
    })}
  </div>;
}
