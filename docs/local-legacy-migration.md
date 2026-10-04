# Lokale Einzelmigration mit Originalarchiv

API: `src/animation/migration/localMigration.ts`. Keine automatische Migration
und kein Legacy-Import in einen aktiven Store. Die unabhängige Importverwaltung
nutzt diese API; die separate Vorlagenmigration ist nicht Teil des Dokumentlaufs.
Der vorhandene Prüfer und Konverter bleiben die einzige fachliche Grundlage.

## Aufrufvertrag

1. `prepareLocalLegacyMigration(sourceKey, context, resources, inventory)` liest
   Definition und globale Legacy-Bibliothek in einem konsistenten Snapshot.
   Kontext, Inventar und Ressourcen werden vor asynchroner Arbeit kopiert.
   Audit und Konverter prüfen vollständig; blockierte Quellen liefern keinen Plan.
2. `plan.report` und `plan.previews` dienen zur Prüfung. Bei Lossy muss ein Aufrufer
   eine ausdrückliche Nutzerentscheidung einholen und anschließend
   `{ approval: { archiveId: report.source.archiveId,
   conversionSha256: report.conversionSha256 } }` an `plan.commit()` übergeben.
   Eine fremde/alte Freigabe wird abgelehnt. Diese API erzeugt keine Freigabe selbst.
3. `commit()` speichert ausschließlich neue Datensätze. Exact benötigt keine
   Freigabe. Jede Speicherphase prüft erneut den unveränderten Quelltext und die
   Bibliothek. Quellenänderungen verlangen einen neu vorbereiteten Plan.
4. `readCompletedLocalMigration(id)` prüft Abschluss, Zielhash, V2-Parser und
   Ziel-/Archividentität. Nur abgeschlossene Ziele sind darüber lesbar.
   `openCompletedLocalMigration(store, id)` übernimmt sie ausdrücklich als neue
   Session mit Saved-Baseline; ein inzwischen erfolgtes Neu/Laden liefert `stale`.
   Die Migration selbst verändert keinen Editor, auch bei verspäteten Writes.
5. `resumeLocalLegacyMigration(id)` rekonstruiert einen Plan aus dem permanenten
   Archiv und dessen ursprünglichem Inventar ohne ausgelieferte Ressourcen.
   Bereits gespeicherte Lossy-Freigaben bleiben an denselben Bericht gebunden.

Pläne sind einmalig: Jeder Commit-Ausgang, auch Fehler oder Abbruch, gibt ihre
Preview-RGBA-Arrays frei. Ein reiner Preview-Abbruch verwendet `plan.dispose()`.
Schon gehaltene Arraycontainer werden geleert; externe Kopien einzelner Bytearrays
muss der Aufrufer selbst freigeben. Kein RGBA-Preview wird persistiert.
`AbortSignal` wird bei Vorbereitung und zwischen bzw. in Speicherphasen geprüft.
Ein bereits abgeschlossener Publikationscommit wird durch einen späteren Abbruch
nicht rückgängig gemacht.

## Bestehende IndexedDB und Commit-Protokoll

Weiterhin `northcore-animation-builder`, unveränderter Object Store
`sessions`, Stringwerte. Datenbankversion **2** ergänzt atomar einen Metadatenkatalog
mit gezielten Indizes; Originale bleiben bytegleich. Es entsteht keine allgemeine Dateisystemabstraktion.
`SessionStorage.run` in `src/animation/storage.ts` deklariert die benötigten Keys und führt Vergleiche und Änderungen synchron in einer einzigen
Readwrite-Transaktion aus; Erfolg wird erst bei `transaction.oncomplete` gemeldet.

Interne Schlüssel beginnen mit `__migration_v1:` und werden von den bestehenden
Dateilisten ausgeblendet:

| Schlüssel | Inhalt |
| --- | --- |
| `journal:<migrationId>` | Versioniertes Journal |
| `archive:<archiveId>` | Unveränderliches Originalarchivmanifest |
| `blob:<sha256>` | Versionierter Base64-Originalpayload |
| `document-id:<targetId>` | Reservierung der neuen Dokumentidentität |
| `stage:<migrationId>` | Noch nicht öffentliches V2-Ziel |

Speicherphasen:

1. Archivmanifest, Ressourcenblobs, ID-Reservierung und Journal `prepared` werden
   zusammen atomar gespeichert. Bereits vorhandene unveränderliche Einträge
   müssen bytegleich sein; sonst wird die Transaktion abgebrochen.
2. Geprüftes V2-Ziel wird privat unter `stage` gespeichert; Journal wird `stored`.
3. Publikation unter `Raster-Migration <targetId>.raster128.json`, Journal
   `completed` und Entfernen des privaten Stagings erfolgen **atomar zusammen**.

Damit gibt es keinen öffentlich sichtbaren Teilerfolg. Die Gesamtoperation ist
ein wiederaufnehmbares Protokoll, kein einzelner lang laufender IDB-Commit.
Ein Fehler hinterlässt `failed` mit Fehlername/-code/-text. Scheitert auch dieser
Write, bleibt die letzte dauerhafte Phase `prepared`/`stored` wiederaufnehmbar.
Scheitert bereits die erste Transaktion, gibt es keinen dauerhaften Journaleintrag;
die unveränderte Legacy-Quelle kann erneut vorbereitet werden.

## Archiv, Identität und Parallelität

Das Manifest erhält Original-JSON und Bibliotheks-JSON als exakte Strings, deren
SHA-256, ursprüngliche Schlüssel, Darstellungskontext, ursprüngliches Audit und
Ressourcenreferenzen. Alle erforderlichen PNG-, Rig- und Preset-Originaldaten sowie
das vollständige ursprüngliche Inventar werden als prüfsummenadressierte Blobs
gespeichert. Pfade/Hashes allein reichen ausdrücklich nicht. Gleiche Bytes teilen
einen Blob auch zwischen mehreren Archiven; die Archivrehydrierung prüft sämtliche
Payloads, Referenzen und Original-/Inventar-/Archivprüfsummen.

Die Migrations-ID bindet Quellkey/-hash, Archiv-ID, Konvertierungshash und
Migrations-/Konverterversion. Die zufällige Ziel-ID beeinflusst sie nicht.
Eine unveränderte Quelle mit demselben Kontext/Inventar/Bibliotheksstand verwendet
erneut dasselbe Journal und Ziel. Eine geänderte Quelle ist eine neue Migration.
Unveränderte Pixel allein genügen nicht zur Gleichheit zweier Quellen.

Das Journal enthält Versionen, Quell-/Bibliotheksidentität und Hashes, Archiv-ID,
Konvertierungshash, Ziel-ID/-key/-hash, Exact/Lossy, gebundene Freigabe, Status,
Revision, Versuchszähler und Fehlerinfo. Zeitstempel sind für das Protokoll nicht
erforderlich. Bibliothek: `archived-only`, niemals als erfolgreich konvertiert
ausgewiesen. Scope: `rendered-animation`.

Bei Wiederaufnahme bleibt die reservierte Ziel-ID erhalten. Namen und bereits
verwendete Raster-IDs werden vor Speicherung und Publikation geprüft; Kollisionen
überschreiben nichts. Journalrevisionen sperren verspätete konkurrierende Versuche
aus. Ein alter Fehlerhandler darf einen neueren/abgeschlossenen Lauf nicht ändern.
Ein zweiter Commit desselben Planobjekts wird während des ersten abgewiesen.

## Validierung und verbleibende Grenzen

`tests/localMigration.test.ts` prüft Exact/Lossy/Blocked, gebundene Freigabe,
Originaltreue und Offline-Reproduktion, Bibliotheksarchivierung, Deduplication,
Idempotenz, Kollisionen, Quoten-/Write-Fehler, Abbruch, Wiederaufnahme, Quellen-
und Sessionwechsel, Parallelität, Journalphasen, Integrität und Previewfreigabe.
`tests/browser/local-migration.spec.ts` prüft echte IndexedDB-Transaktionen,
Publikationsrollback und Offline-Wiederaufnahme nach Quotenfehler/Abbruch.

Ein dauerhaft gespeichertes Archiv liegt lokal in IndexedDB; Browser-Löschen,
Speicherbereinigung oder Geräteverlust sind dadurch nicht abgesichert. Die vorhandene Verwaltung exportiert Archive und Original-JSON gezielt.
Listen und Status lesen nur indizierte Metadaten; Archivressourcen werden erst
bei einer Detail-/Export-/Resume-Aktion rehydratisiert. Die API ist für manuelle Einzelmigration gedacht,
nicht als Massenmigrationspipeline. Große Projekte behalten die temporären
Preview-Speicherkosten des bestehenden Konverters. Archive enthalten keine
ausführbare Renderer-Version: Reproduktion mit einer künftig anderen Engine muss
weiterhin die aufgezeichneten Renderhashes bestätigen, sonst blockieren.

Storage-Upgrade, Pagination, gezielte Quell-/Archiv-/Ziel-Lookups und strukturelle Performancebudgets sind in [animation-builder-storage.md](animation-builder-storage.md) beschrieben.
