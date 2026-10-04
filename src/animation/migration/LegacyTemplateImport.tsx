import { useEffect, useState } from 'react';
import type { DialogConfig } from '../Dialog';
import { globalTemplateLibrary as library } from '../globalTemplateLibrary';
import { localSessionStorage } from '../storage';
import { prepareLegacyTemplates, prepareArchivedLegacyTemplates, migrateLegacyTemplates } from './legacyTemplates';
import type { StorageMetadata } from '../storageCatalog';
import type { LegacyTemplatePlan } from './legacyTemplates';

/** Import controls compose into the native library, without owning authoring state. */
export function LegacyTemplateImport({ onDialog, onMessage }: {
  onDialog: (dialog: DialogConfig) => void; onMessage: (message: string) => void;
}) {
  const report = (task: Promise<unknown>) => {
    void task.catch((error: unknown) => onMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.'));
  };
  const reviewLegacyLibrary = (plan: LegacyTemplatePlan) => onDialog({
    title: 'Legacy-Vorlagen übernehmen',
    content: <>
      <p>{plan.sourceKey} · {plan.route}. Die Legacy-Originale bleiben erhalten.</p>
      <ul>{plan.entries.map((entry) => <li key={entry.index}>{entry.name}: {entry.route} — {entry.reason}</li>)}</ul>
      {plan.route === 'lossy' && <label><input type="checkbox" name="approve-lossy" required />
        Verlustbehaftete Reduktion dieses Berichts ausdrücklich freigeben</label>}
      {plan.route === 'blocked' && <p>Die Bibliothek wird wegen blockierter Vorlagen nicht übernommen.</p>}
    </>,
    action: 'Übernehmen',
    ...(plan.route !== 'blocked' ? { submit: (data: FormData) => report(migrateLegacyTemplates(library, plan,
      data.has('approve-lossy') ? { sourceSha256: plan.sourceSha256, reportSha256: plan.reportSha256 } : undefined)
      .then((result) => onMessage(result === 'existing' ? 'Bibliothek bereits übernommen.' : 'Legacy-Vorlagen global gespeichert.'))) } : {}),
  });
  const legacyLibraries = () => report((async () => {
    const local = await localSessionStorage.has('__legacy_templates');
    onDialog({ title: 'Legacy-Bibliothek prüfen', action: 'Prüfen',
      content: <ArchivedLibraryPicker local={local} onMessage={onMessage} />,
      submit: (data) => {
        const source = data.get('library-source');
        if (typeof source !== 'string' || !source) return;
        report((source === 'local' ? localSessionStorage.read('__legacy_templates').then((record) => {
          if (record.value === undefined) throw Error('Lokale Legacy-Bibliothek fehlt.');
          return prepareLegacyTemplates(record.value, '__legacy_templates');
        }) : prepareArchivedLegacyTemplates(source)).then(reviewLegacyLibrary));
      },
    });
  })());
  return <>
    <button onClick={legacyLibraries}>Legacy-Vorlagen prüfen …</button>
    <button onClick={() => document.querySelector<HTMLInputElement>('#ab-legacy-library-file')?.click()}>Legacy-Bibliothek importieren …</button>
      <input
        id="ab-legacy-library-file" type="file" accept=".json,application/json" hidden
        onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) report(file.text().then((json) => prepareLegacyTemplates(json, file.name)).then(reviewLegacyLibrary));
        }}
      />
  </>;
}

/** Only catalog rows enter the picker; original library/resources load after explicit selection. */
function ArchivedLibraryPicker({ local, onMessage }: { local: boolean; onMessage: (message: string) => void }) {
  const [archives, setArchives] = useState<StorageMetadata[]>([]), [next, setNext] = useState<string>();
  useEffect(() => {
    let active = true;
    void localSessionStorage.query({ kind: 'archive' }).then((page) => {
      if (active) { setArchives(page.items.filter((meta) => meta.hasLibrary !== false)); setNext(page.next); }
    }).catch((error: unknown) => { if (active) onMessage(String(error)); });
    return () => { active = false; };
  }, [onMessage]);
  const more = () => { void localSessionStorage.query({ kind: 'archive', after: next }).then((page) => {
    setArchives((old) => [...new Map([...old, ...page.items.filter((meta) => meta.hasLibrary !== false)].map((meta) => [meta.key, meta])).values()]); setNext(page.next);
  }).catch((error: unknown) => onMessage(String(error))); };
  return <>
    <label>Quelle<select name="library-source">
      {local && <option value="local">Lokal gespeicherte Legacy-Bibliothek</option>}
      {archives.map((archive) => <option key={archive.key} value={archive.archiveId}>Archiv: {archive.sourceKey ?? archive.archiveId}
        {archive.hasLibrary === undefined ? ' (Bibliothek ungeprüft)' : ''}</option>)}
    </select></label>
    {!local && !archives.length && <p>Keine bekannte Legacy-Bibliothek in dieser Seite vorhanden.</p>}
    {next && <button type="button" onClick={more}>Weitere Bibliotheksarchive laden</button>}
  </>;
}
