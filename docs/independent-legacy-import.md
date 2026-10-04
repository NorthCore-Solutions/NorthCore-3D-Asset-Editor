# Unabhängiger Legacy-Import (12a / 12b)

Der normale Animation Builder ist Raster128-only. Im Dateienbereich öffnet
„Legacy-Daten importieren / verwalten …“ einen nativen Modal-Dialog. Legacy-Dateien
werden nicht in einen Editor-Store geladen. Das alte Authoring-System ist seit
12b entfernt; Import, Audit, Konvertierung und Archive sind unabhängig davon.

## Benutzerweg und API

`LegacyMigrationPanel.tsx` verbindet den Datei-Input mit
`migrationController.ts`. Die Erkennung prüft JSON-Inhalt/Version/Definitionform,
anschließend übernimmt ausschließlich das vollständige Inventar-Audit die Prüfung.
Dateiname/Endung sind keine Formatvalidierung. Ungültige Daten, unbekannte Felder,
Operations und fehlende Ressourcen werden blockiert. Ein unbekannter oder
mehrdeutiger Addon-Ursprung darf nicht durch den Renderer-Default ersetzt werden:
der Benutzer wählt eine bekannte Familie und prüft erneut. Rig-Defaults werden
vom Audit explizit aufgelöst und im Dialog angezeigt.

Nach dem Audit folgen Archiv/Preview und Konvertierung. Jeder Preview-Frame zeigt
Original und natives Ergebnis. Exact kann direkt gespeichert werden, Lossy erst
nach einer expliziten Checkbox; die Freigabe ist an Archiv und Konvertierungshash
gebunden. Blocked hat keine Speicheraktion. Der Commit verwendet unverändert
Archiv-/Blob-/Stage-/Target-Transaktionen des bestehenden Journals. Erst vollständig
publizierte, erneut hashgeprüfte Raster-V2-Ziele können geöffnet werden.

`prepareExternalLegacyMigration()` archiviert externe Originalbytes direkt. Es
legt keinen `.finoanim.json`-Authoringdatensatz an. `prepareLocalLegacyMigration()`
liest vorhandene lokale Definition/Bibliothek und prüft die Quelle vor jedem
Write. Kein Original wird überschrieben oder gelöscht. `listLegacyMigrationData()`
zeigt noch nicht migrierte bzw. geänderte lokale Quellen, Journale, Ziele und Archive.
`resumeLocalLegacyMigration()` arbeitet offline aus dem eingefrorenen Archiv.
Original-JSON, vollständiges Archiv einschließlich Ressourcen/Inventar und das
Raster-Ziel sind exportierbar. Die globale Bibliothek übernimmt separat lokale,
archivierte und externe `fino_templates.json` mit den vorhandenen Exact/Lossy/
Blocked-Regeln; sie speichert ebenfalls das ursprüngliche JSON dauerhaft.

Browser/Desktop und Android verwenden den bestehenden HTML-Datei-Input. Exporte
nutzen `saveBlobAs()` und damit Browser-Download bzw. Android-Dateidialog. Kein neuer
Dateisystemadapter, keine automatische Migration beim Start. Android-Gerätetests
wurden nicht ausgeführt; Plugin-/Dateiwege bleiben unverändert.

## Vier getrennte Identitäten

1. **Benutzerquelle:** Hash aus Original-Definitions-/Bibliotheksbytes, Herkunft
   und lokalem Key. Bei externen Dateien ist Umbenennen keine neue Quelle.
2. **Ressourcen-/Semantikfingerprint:** tatsächlich benötigte Ressourcenpfade und
   Originalhashes, aufgelöste Frames/Defaults, Rig-/Addon-Kontext. Beschreibungen,
   Golden-/Testreferenzen und TS-Dateipfade im Inventar sind ausgeschlossen.
3. **Verfahrensversion:** `migrationVersion`, `converterVersion`, `policyVersion`
   sind explizit. Bei tatsächlicher Algorithmusänderung muss die passende Version
   angehoben werden. Unbekannte Konverterversionen werden nicht mit dem aktuellen
   Algorithmus nachgespielt.
4. **Originalarchiv:** eigener unveränderlicher Hash über vollständige Originale
   und ursprüngliches Audit/Inventar. Änderungen an Dokumentation können andere
   neue Archivvorschläge erzeugen, werden aber niemals allein zur neuen Migration.

Migration-ID = Hash aus 1, 2 und 3. Vor neuer Konvertierung/Commit werden vorhandene
Journale über Quelle/Version und archivierte Semantik abgeglichen. Derselbe Zustand
verwendet das vorhandene Archiv und Ziel. Alte Journale ohne neue optionale Felder
behalten ihre historische ID; der Abgleich leitet die Fakten aus ihrem Archiv ab.
Neue Felder im Version-1-Journal sind optional kompatibel. Kein IndexedDB-Bump.

## Fehler, Leave und Sitzungswechsel

Der globale Controller ist ein eigener kleiner Statusadapter, kein Editor-Store.
Pending-Write und Fehler vor/nach dem Archivwrite bleiben im Leave-Schutz. Nach
Neustart werden nur Journalzustände gelesen; nichts wird automatisch migriert.
Ein Fehler vor dem ersten dauerhaften Write behält die Datei im Controller für
Retry. Ein späterer Fehler lässt ein wiederaufnehmbares Archiv/Journal zurück.
Preview-Buffers werden nach Commit/Abbruch freigegeben. Ein neuer Prüfablauf
invalidiert verspätete Lese-/Auditantworten. Während eines Writes ist kein neuer
Einzelimport erlaubt; ein fehlgeschlagener aktueller Write muss erst wiederholt
werden. Ein falscher Erfolg wird nicht als clean ausgegeben.

Migration macht den aktuellen Rasterinhalt nicht dirty. Öffnen ist optional,
fragt bei ungesichertem Dokument nach und prüft den Sitzungstoken während des
asynchronen Integrity-Reads. Die Modalität bleibt während der Dirty-Rückfrage
bestehen. Pause/Resume ist ein einmaliger Raster-Vorgang und wird durch einen
Dokumentwechsel invalidiert. Renderer/Frames/History/Viewport werden nicht neu
aufgebaut oder automatisch zentriert.

## Nachweise und 12b

Unit-/Golden-/Browserfälle prüfen Exact/Lossy/Blocked, Kontext/Ressourcen, lokale
und externe Quellen, Archive nach Neustart, Quotenfehler/Retry, Idempotenz trotz
Inventaränderung, Verfahrensversionen, verspätete Antworten sowie Raster-Save/Load,
Leave, Playback und Modalität. Der transitive Produktionsgraph darf kein
LegacyBuilder/LegacyCanvas/legacyStore/legacyPersistence enthalten. Der Workflow-
Test parst YAML und prüft `public/**` sowie Lint/Test/Build im Android-Job.

12b hat das isolierte Authoring-System und dessen vorübergehenden Test-Host
entfernt. Audit, Renderer, Codecs, Presets, die 74 Ressourcen, Originalarchive,
Journal, Bibliotheksimport und Kompatibilitätstests bleiben erhalten. Referenzen,
Tracing und native Pixelassets bleiben unverändert. Zusätzlich verhindern ein
repositoryweiter Import-/Dateiguard und `scripts/check-legacy-authoring.mjs` nach
dem Build eine Wiedereinführung. Android- und Beta-Workflow führen den Bundle-Guard aus.
