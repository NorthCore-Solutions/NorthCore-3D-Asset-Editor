# Globale Raster128-Vorlagenbibliothek (Schritt 7)

Die globale Bibliothek ist unabhängig von Raster-Dokumenten und deren Frame-History.
Dokumentgebundene `templates`/`faces` in V1/V2 bleiben unverändert. Die globale
Bibliothek ist kein Bestandteil eines `.raster128.json`-Dokuments oder PNG-Exports.

## Modell und Sicherung

`GlobalTemplateDocument`: `format: northcore-raster128-library`, `version: 1`,
`templates`, `migrations`. Eine Vorlage enthält ID, Name, native Breite/Höhe
(1–128), Integer-Ursprung und sparse lokale Pixelpaare `[y * 128 + x, RGBA]`.
Transparente Lücken und leere Außenränder bleiben durch die expliziten Abmessungen
erhalten; RGB bei Alpha 0 wird nicht entfernt. Es gibt keine Palette, Farbmittelung
oder Alpha-Quantisierung. Ursprung darf außerhalb der Zeichenfläche liegen.

Legacy-Provenance erhält Quellkey/-hash, ursprüngliche ID/Name, Originalursprung,
Originalgröße, Templatehash, Exact/Lossy, Konverteralgorithmus und optional Archiv-ID.
Migrationsreceipts speichern den unveränderten Bibliotheks-JSON-Text samt Quellhash,
Berichtshash, Übernahmeweg, Lossy-Freigabe und resultierenden IDs. Diese Originale
bleiben auch nach Umbenennen/Löschen migrierter Vorlagen erhalten. Ein Receipt
fordert nicht, dass alle resultierenden Vorlagen weiterhin vorhanden sind.

`parseGlobalLibrary` ist die gemeinsame Formatquelle für Speicherung und Backups;
unbekannte Versionen/Felder, ungültige RGBA-/Koordinatenwerte und doppelte IDs/Namen
werden abgelehnt. Laden und Backupimport prüfen zusätzlich die SHA-256 der
archivierten Originaltexte. Sicherungsdatei: `.raster128-library.json`.
Export wartet auf vollständiges initiales Laden, sichert den aktuellen In-Memory-
Stand und verändert keinen Saved-Status. Ein initialer Lesefehler verhindert einen
irreführenden leeren Backupexport; fehlgeschlagene Writes verhindern die Sicherung
des bereits bekannten aktuellen Inhalts dagegen nicht.
Import ersetzt nach Bestätigung nur die globale Bibliothek, validiert vor Mutation
und verwendet danach denselben Autosave. Ein gültiger expliziter Backupimport kann
auch eine fehlgeschlagene/ungültige initiale Bibliotheksladung reparieren.
Browserdownload und Android-Dateidialog verwenden weiterhin `saveBlobAs`; der
Import verwendet den bestehenden HTML-Dateiweg mit `File.text()`.

## Persistenz und Lebensdauer

Bestehende IndexedDB `northcore-animation-builder`, Version **2**, unveränderter `sessions`-Store,
ein privater Stringkey `__raster128_global_templates_v1`. Gezielte Transaktionen verwenden den bestehenden Speicherclient; ein kleiner Metadatenkatalog wird atomar mitgeschrieben. Eine einzelne Transaktion schreibt
Vorlagen, Receipts, Revision und Metadaten gemeinsam; Erfolg wird erst nach dem IDB-Commit gemeldet.
Es werden keine Legacy-Keys oder Archive geändert.

`GlobalTemplateLibrary` hat globale Lebensdauer. Status: `loading`, `pending`,
`failed`, `saved`; zusätzlich `dirty` und Fehlertext. Alle Writes laufen seriell
mit unveränderlichen Snapshots. Ein alter Write kann einen neueren Stand nicht
clean markieren. Pending und failed mit ungesicherten Änderungen aktivieren den
Leave-/Beforeunload-Schutz, bleiben aber getrennt von `AnimationStore.dirty`.
Ein erfolgreich gespeichertes Dokument speichert diese Bibliothek nicht mit.
Neu/Laden, Builderwechsel oder Unmount starten keine neue Bibliothekssitzung und
invalidieren keine globalen Writes. Retry dedupliziert einen bereits laufenden
Write desselben Standes, speichert ansonsten den neuesten Stand erneut.

Vor initialem Laden erfolgte Änderungen werden als Operationen gepuffert und auf
den gespeicherten Bestand angewendet, bevor geschrieben wird. ID-Kollisionen
rebinden nachfolgende lokale Rename/Delete-Operationen auf die richtige Vorlage.
Ein Lesefehler hält diese Operationen zurück: unbekannte gespeicherte Daten werden
dabei nicht automatisch überschrieben. Retry lädt erneut und führt sie zusammen.

## Kontrollierte Legacy-Migration

API: `prepareLegacyTemplates(originalJson, sourceKey, archiveId?)`,
`prepareArchivedLegacyTemplates(archiveId, storage?)`, `migrateLegacyTemplates(library, plan, approval?)`.
Das Archiv aus Schritt 6 wird vollständig mit dessen Ressourcenintegrität geprüft;
anschließend wird ausschließlich sein ursprünglicher Bibliothekstext verwendet.
Keine Frame-Konvertierung und keine Renderer-/Rig-/Operationssemantik sind nötig.

Legacy-Templates sind lokale Rechtecke. Quellkoordinaten werden **nicht** einzeln
durch acht geteilt. Stattdessen wird die vollständige sparse RGBA-Fläche samt
transparenten Lücken mit Phase `(0,0)` an `(8x,8y)` abgetastet. Zielabmessungen sind
`ceil(width/8)` und `ceil(height/8)`; überstehende Blockränder gelten als RGBA 0.
Der native Ursprung ist `floor(origin/8)`; die Originalwerte bleiben in Provenance
und Originalarchiv erhalten. Die Anwendung verwendet das explizite Rechteck,
damit transparente Außenränder nicht durch Tight-Bounds-Capture verschwinden.
Die bestehende Dokument-Transformfunktion wird dafür nicht verändert.

- **Exact:** alle vollständigen 8×8-Blöcke sind RGBA-homogen, Breite/Höhe und
  Ursprung sind Vielfache von acht. Ein 8×-Rückexport samt Ursprung erhält die
  Originalrechteckgeometrie und RGBA-Werte.
- **Lossy:** mindestens eine dieser Bedingungen fehlt. Keine Behauptung einer
  verlustfreien Ursprungsausrichtung oder Übernahme von Subpixel-Details.
- **Blocked:** unbekannte Felder/Version, ungültige Pixel, doppelte Pixelbelegung,
  mehrdeutige ID, unzuverlässiger Ursprung oder andere Formatfehler. Sobald eine
  Vorlage blockiert ist, wird die gesamte Übernahme abgelehnt; keine stille Teilauswahl.

Jede Vorlage hat ihren eigenen Bericht. Gesamtstatus ist Blocked vor Lossy vor
Exact. Vor Übernahme wird der gesamte Plan erneut aus den Originalen erzeugt und
kanonisch verglichen. Änderungen am geprüften Zieldatensatz umgehen dies nicht.
Lossy verlangt `{sourceSha256, reportSha256}` einer ausdrücklichen Freigabe.
Eine bereits im Receipt gespeicherte Freigabe derselben Quelle gilt auch bei Retry.
Das UI zeigt den Bericht und verlangt bei Lossy ein explizites Pflicht-Checkbox.

Gleicher unveränderter Originaltext wird über seinen SHA-256 dedupliziert, auch
zwischen lokalem Bestand und mehreren Archiven. Wiederholung stellt absichtlich
gelöschte Vorlagen nicht erneut her. Geänderte Quellen erhalten ein neues Receipt.
ID-/Namenskollisionen mit globalen Vorlagen bekommen deterministische Suffixe;
Original-ID/Name bleiben erhalten. Bibliothekswrite-Fehler melden keinen
Übernahmeerfolg; Retry speichert denselben Stand ohne weitere Vorlagenduplikate.

## Bestehende UI und Grenzen vor Schritt 8

Im bisherigen Vorlagen-Tab stehen globale Vorlagen und Dokumentvorlagen getrennt.
Globale Aktionen: Auswahl speichern, Anwenden, Rename/Delete, Backupimport/-export,
Status/Retry sowie Prüfung lokal gespeicherter oder dauerhaft archivierter
Legacy-Bibliotheken. Anwenden ist eine normale Pixelbearbeitung mit Frame-History;
alle Bibliotheksänderungen selbst erzeugen keine Frame-History-Einträge.

Der lokale Legacy-Weg liest den **persistierten** Bibliotheksstand. Der alte
Authoring-Editor ist entfernt; externe Bibliotheksbackups lassen sich unabhängig
importieren. Es gibt keine Start-/Massenmigration.
Originale und Backups können groß werden; die vollständigen Legacy-Originaltexte
sind bewusst erhalten. IndexedDB ist keine Sicherung gegen Geräteverlust oder
Browserbereinigung. Die serielle Queue gilt für eine App-Instanz. Tabübergreifend
prüft jeder Write atomar seine erwartete Basis mit Revision und Write-ID. Externe
Änderungen bleiben als aktualisierbar beziehungsweise als Konflikt sichtbar;
lokale Vorlagen bleiben erhalten. Retry übergeht keinen Konflikt. Neu laden oder
Überschreiben erfordert eine ausdrückliche Bestätigung; auch Überschreiben prüft
die unmittelbar vor dem Write gelesene Basis. BroadcastChannel, Storage-Events und
Aktivierungsereignisse melden Änderungen ohne Polling. Posen, Faces/Rigs und Operations werden hier nicht migriert;
Legacy bleibt ausschließlich als Import-/Kompatibilitätsschicht vorhanden.

Tests: `tests/globalTemplateLibrary.test.ts` (Format, Writes/Races/Retry, History-
Grenzen, Backup, Klassifikation, Hashes, Kollisionen, Idempotenz und Archivintegration)
sowie `tests/browser/global-template-library.spec.ts` (reale UI/IndexedDB,
Backups, Leave-Schutz, Retry und explizite Lossy-Freigabe), außerdem
`tests/crossTabStorage.test.ts` und `tests/browser/cross-tab-storage.spec.ts`
(konkurrierende Clients/Tabs, Konflikte, bewusstes Überschreiben und Neu laden).

Externe Hinweise prüfen nur Existenz und Revisionssidecar; sie laden den Bibliothekspayload nicht. Der native Bibliotheksinhalt bleibt ein gemeinsamer JSON-Datensatz und wird bei expliziter Bibliotheksladung vollständig validiert.
