# Animation Builder: aktuelle Architektur

Der Launcher lädt `AnimationBuilder.tsx` direkt. Es gibt einen Raster128-Editor,
keinen Modul-/Modusadapter. Der Builder hält die gemeinsame Komposition und
Abonnements; Dialog-/Dokumentaktionen liegen in Hooks derselben Instanz. `Pixel`, `Animation` und `Kombiniert` sind weiterhin
Inspector-Ansichten innerhalb desselben Editors. Maus/Touch verwenden denselben
Canvas; Panels verändern dessen Transform nicht und Resize zentriert nicht neu.

## Verantwortlichkeiten

| Bereich | Module | Verantwortung |
| --- | --- | --- |
| Dokument | `raster.ts`, `document.ts`, `files.ts` | Native 128×128-Pixelmaps, Frames/Layer, V2-Metadaten; validiertes V1-Lesen, V2-Schreiben |
| Zustand/History | `store.ts` | Immutable Dokumentänderungen, Undo/Redo, Collections, transienter Bedienzustand, Saved-Baseline und Sitzungstoken |
| Canvas | `RasterCanvas.tsx` | Integer-Werkzeuge, Masken, Vorschauen, Maus/Touch, Zoom/Pan, Referenzen; unveränderte Pixel-/Sampling-Semantik |
| Posen | `nativePoses.ts`, `data/poses/` | Sechs native Posen, stabile IDs/Versionen/Hashes, Frame aus Grundpose |
| Face | `nativeFaces.ts`, `NativeFaceInspector.tsx`, `data/faces/` | Gesichtsfreie Posen, Slots/Varianten, Integer-Platzierung, Preview/Bake, explizites Retargeting |
| Operations | `rasterOperations.ts`, `RasterOperationsInspector.tsx` | Native Masken/Move/Stretch; versionierte Rezepte mit gespeicherter Ausgangsbasis und deterministischem Replay |
| Globale Bibliothek | `globalTemplateFormat.ts`, `globalTemplateLibrary.ts` | Lokale native Template-Koordinaten, Original-/Importbelege, sequenzielle automatische Writes, Status/Retry und Backup |
| Dateien | `files.ts` | Raster-Dokumentparser, Sitzungssave/Restore, `.raster128.json`, Referenzimport und PNG-Export |
| Neutrale Infrastruktur | `storage.ts`, `indexedSessionStorage.ts`, `storageCatalog.ts`, `png.ts`, `colors.ts`, `contentHash.ts` | Bestehende IndexedDB/Transaktionen, revisionsgebundene Writes und Cross-Tab-Hinweise, exakte PNG-Dekodierung, RGBA-/Farbhilfen, kanonisches JSON und SHA-256 |
| Komposition | `AnimationBuilder.tsx` | Store-Abonnements, Mount/Unmount, Panel-/Ansichts-/Tab-Koordination, Canvas/Status und ausdrücklich eingebundene Legacy-Importoberflächen |
| Dokumentaktionen | `useRasterDocumentActions.tsx` | Neue Animation, lokale Sitzungsübersicht/-Save/-Restore, Dokument-/PNG-Export sowie Dokument-/Referenz-Dateieingaben; unveränderte Persistenz-APIs |
| Dialogkoordination | `useBuilderDialogs.tsx`, `builderForm.ts`, `useBuilderShortcuts.ts` | Transiente Formular-/Farbdialoge, Umbenennen/Einfügen/Vorlagenspeicherung, Info und Meldungen; bisherige FormData-Auswertung und Tastatur-Sperren |
| Editorbereiche | `BuilderCommands.tsx`, `BuilderLibraryPanel.tsx`, `BuilderInspector.tsx`, `BuilderTimeline.tsx` | Menüs/Toolbar, Dateien und globale/Dokumentvorlagen, native Face-/Operations-/Layer-/Auswahlformulare und Frame-/Playback-Bedienung |
| Präsentation | `BuilderUI.tsx`, `Dialog.tsx`, `ColorDialog.tsx`, `BrushSizeSelector.tsx`, `useBuilderPanels.ts`, `builder.css` | Header/Panels/Menüs, Dialogkonfiguration, Toolbar und responsive Darstellung |

Layer bleiben normale Pixelmaps. Face-/Operationsmetadaten beschreiben editierbare
native Zustände; geladene Pixel werden nicht aus Herkunftsdaten neu generiert.
`sample()` bleibt unverändert. PNG-Produktion bleibt 1024×1024 per 8× Nearest Neighbor.

Dokument-Collections (`templates`, `faces`) und globale Bibliothek sind verschiedene
Bestände: Collections gehören zum portablen Dokument und zur Dokument-Baseline,
bleiben aber außerhalb der Frame-History. Globale Templates verwenden lokale
Koordinaten/Originalbelege und überleben Dokumentwechsel. Anwenden ist eine normale
Pixelbearbeitung; Umbenennen/Löschen in der Bibliothek erzeugt keine Frame-History.

## Drei Abhängigkeitsbereiche

1. **Raster128 Authoring:** Store, native Modelle/Renderer/Inspektoren und globale
   Bibliothek importieren keine Legacy-Parser, Renderer oder Migrationsmodule.
2. **Legacy Import/Kompatibilität:** `legacy.ts` und `templateLibrary.ts` sind
   ausschließlich Original-Format/Renderer/Codec. `migration/` besitzt Audit,
   Konverter, Face-/Operations-/Template-Mappings, Originalarchiv, Journal,
   Wiederaufnahme, Controller und Importoberflächen. Die 74 Public-Ressourcen und
   `data/legacy-presets.json` bleiben unverändert. Das maßgebliche Inventar liegt
   als Produktionsdaten in `migration/legacy-inventory.json`; Tests verwenden
   dieselbe Datei. Produktionscode importiert keine Test-Fixtures.
3. **Gemeinsame neutrale Infrastruktur:** PNG/RGBA, Hashing und Speicherzugriff
   kennen weder Legacy-Definition noch Raster-Store. Formdialog-Konfiguration und
   Modalitätsmechanismen sind ebenfalls gemeinsam nutzbare Präsentation.

Die extrahierten Editorbereiche erhalten nur benötigte Dialog-/Dokumentaktionen
über typisierte Props. Sie verwenden denselben vorhandenen Store; Abonnements und
Hook-Zustand bleiben in der Builder-Instanz. Es gibt keine zusätzlichen Provider,
Renderer-Instanzen oder Persistenzpfade. Bibliotheks-/Migrationsoberflächen werden
als React-Elemente in den nativen Bibliotheksbereich eingesetzt.

`AnimationBuilder.tsx` ist der erlaubte Kompositionspunkt: Es bindet
`LegacyMigrationPanel` und `LegacyTemplateImport` ein. Diese führen nur ausdrücklich
gewählte Imports aus. Vorlagenprüfung/Freigabe liegt in `legacyTemplates.ts`;
`GlobalTemplateLibrary.importTemplates()` installiert ausschließlich validierte
native Daten/Belege über die bestehende Write-Queue. `legacyFaces.ts` kapselt
V1/V2-/Addon-Vorschläge. Face-/Operations-Mappings werden nicht automatisch aus
einem gebackenen Ergebnis abgeleitet; isolierte, getestete APIs bleiben erhalten.

Kompatibilität darf validierte native Ausgabeformate verwenden. Der reine Legacy-
Renderer nutzt nur neutrale PNG-/RGBA-Helfer und typisierte Koordinaten, keinen
nativen Authoring-Laufzeitpfad. Historische `legacy`-Metadaten, Face-Familien und
Bibliotheksbelege bleiben für bestehende Dokumente erhalten; sie sind kein Modus.
Typreferenzen zwischen Frame/Face/Recipe sind zulässig, Runtime-Zyklen nicht.

## Dirty, Sitzung und Save

Dokument-Dirty vergleicht Frames, Name, Source, Referenz, Metadaten und Collections
mit der zuletzt tatsächlich geschriebenen Basis. Index, aktiver Layer, Auswahl,
Werkzeug, Playback und Viewport zählen nicht zum Inhalts-Dirty. Preview ist transient;
Commit erzeugt einen konsistenten History-Vorgang. Globale Bibliothekswrites haben
einen separaten Pending-/Failed-Status und machen das Raster-Dokument nicht dirty.

`saveRasterSession()` schreibt den aufgenommenen Inhalt und markiert genau diese
Basis gespeichert. Änderungen während Write bleiben dirty, konkurrierende Saves
werden pro Store blockiert. Neu/Restore/Import ändern die Sitzungsidentität; späte
Ergebnisse können keine neue Sitzung clean markieren. Restore validiert vollständig
vor Mutation, setzt Collections/Basis konsistent und leert die bisherige History.
JSON-Dateiexport und PNG-Export setzen keine Saved-Baseline. Datenbankname,
`sessions`-Store und vorhandene Keys bleiben unverändert; DB-Version 2 ergänzt einen Metadatenkatalog.

Der Launcher aggregiert 3D-/Raster-Dirty, globale Bibliothek und Pending-/Failed-
Migrationen für Unload/Leave. Das Pause-Menü ist nativ modal, blockiert Shortcuts und
pausiert Raster-Playback. Resume gilt einmalig nur für dasselbe Dokument. Migration
bleibt ohne Authoring-State; Originalarchive/Journale bleiben unabhängig erreichbar.

## Tabübergreifende Persistenz

`storage.ts` besitzt pro Browserrealm einen Client. Eine IndexedDB-Readwrite-Transaktion
liest und vergleicht die erwartete Basis und schreibt Inhalt plus Revision atomar.
Revisionen liegen unter `__builder_revision_v1:<codierter Key>` im bestehenden
`sessions`-Store; Inhalte/Keys bleiben kompatibel. DB-Version 2 ergänzt nur abgeleitete Metadaten. Altbestände haben
bis zum nächsten Write eine Nullrevision. Vergleich umfasst auch die Originalbytes,
um Writes älterer Clients ohne Revisionsmetadaten zu erkennen. Löschrevisionen bleiben
als Tombstones erhalten. Write-IDs enthalten Client-ID und UUID; Zähler sind pro Key.
Paginierte Listen lesen nur den Metadatenkatalog. Transaktionscallbacks blenden Revisionsmetadaten aus und deklarieren ihre benötigten Keys.

`BroadcastChannel` meldet ausschließlich erfolgreich abgeschlossene Writes. Fallback
ist ein best-effort Storage-Event; Fokus, Pageshow und sichtbare Aktivierung verifizieren
beobachtete Keys bei verpassten/fehlenden APIs. Es gibt kein Polling und keine separat
persistierten Locks. IndexedDB beendet/rollt Transaktionen bei Abbruch/Crash zurück.
Eine Nachricht verleiht keine Schreibberechtigung und verändert keine Saved-Basis.

Dokumentsitzungen merken pro Key die gelesene/geschriebene Basis unabhängig vom
UI-Sessiontoken. Neue/portable Dokumente schreiben zunächst nur auf nicht belegte
Keys. Lokales Öffnen liest/validiert den aktuellen Record. Fremde Writes markieren
clean Views als aktualisierbar und dirty Views als Konflikt; Pixel/History bleiben
stehen. Konflikt-/Failed-/Pending-Zustand aktiviert zusätzlich den Leave-Schutz.
Neuladen/Überschreiben braucht eine ausdrückliche Dialogentscheidung. Überschreiben
prüft auch die dabei aufgenommene neue Basis; ein weiterer fremder Write kann erneut
Konflikt erzeugen. Original-/interne/Migrationsziel-Keys sind keine überschreibbaren
Raster-Sitzungen. Datei-/PNG-Export bleiben unabhängige Sicherungen.

Die globale Bibliothek behält ihre sequenzielle Queue und veröffentlicht nur gegen
ihre angenommene Basis. Konflikt stoppt weitere Queue-Snapshots und blinde Retries;
alle lokalen Templates bleiben erhalten. Explizites Reload prüft zwischenzeitliche
lokale/externe Änderungen; erst erfolgreiche validierte Übernahme akzeptiert die
neue Basis. Explizites Overwrite schreibt den lokalen Snapshot mit frischer CAS-Basis.
Initiales Laden behält seine bisherige Puffer-/History-Grenze.

Migrationen vergleichen Journalrevisionen beim Start und in jedem Folgeschritt
innerhalb derselben Transaktion. Immutable Archive/Blobs und reservierte Zielidentitäten
werden weiter geprüft; externe Journalsignale aktualisieren nur die Verwaltung.
Konkurrierender Versuch wird abgelehnt oder übernimmt das bereits abgeschlossene
Ergebnis idempotent. Originale, Resume und integritätsgeprüfte Ziele bleiben erhalten.

Mehrtab-Tests liegen in `crossTabStorage.test.ts`, `localMigration.test.ts` und
`tests/browser/cross-tab-storage.spec.ts`. Version-1-Clients können eine bereits
aktualisierte DB nicht mehr mit ihrer alten festen Versionsnummer öffnen; das
Upgrade überschreibt oder löscht keine Originale.

## Gezielte Abfragen und große Bestände

`indexedSessionStorage.ts` öffnet DB-Version 2 mit unveränderten Stringpayloads
in `sessions` und einem zusätzlichen `builder_metadata`-Store. Indizes kombinieren
Datensatzart, Status/Quelle/Quellhash/Quellidentität/Archiv-ID/Ziel-ID beziehungsweise
Details-Kenntnis und Key. `storageCatalog.ts` erzeugt kleine Beschreibungen ohne
Pixelmaps, Originaltexte oder Ressourcenbytes; nur kleine Journale enthalten ihre
vollständigen Verwaltungsfelder. Payload, Revision und Metadaten werden gemeinsam
atomar geändert. Abgeleitete Nachträge vergleichen den weiterhin aktuellen Payload.

Das atomare Upgrade liest Keys und kleine Journale, keine Archive, Blobs, Raster-
oder Legacy-Quellpayloads. Historische Dokument-IDs werden bei einer ID-sensitiven
Migration in Batches von 25 nachgetragen; die Publikation prüft den Index erneut
in ihrer Transaktion. Historische Quellen ohne Hash bleiben ausdrücklich ungeprüft,
bis eine gewählte Migration/Ladung sie erfasst. Historische Archive ohne Bibliotheks-
Metadaten dürfen gezielt ausgewählt werden; Details werden dann validiert.

Listen verwenden stabile Keyset-Pagination (50, maximal 100 Datensätze plus einen
kleinen Cursor-Lookahead), mit „mehr laden“ für Dokumente, Quellen, Journale und
Archive. Mehrfachfilter wählen einen passenden Index und prüfen verbleibende Felder
innerhalb des begrenzten Batches; eine leere Seite kann deshalb einen Folgetoken
besitzen. Laufende Änderungen machen Pagination zu einer aktuellen Sicht, nicht zu
einem eingefrorenen Snapshot. Externe Ereignisse invalidieren Verwaltungslisten.

Einzelzugriffe benutzen deklarierte `get`-Keys. Ein Existenz-/Revisionssignal liest
nur `getKey` und Revisionssidecar. Archivdetails laden nur ihr Manifest und dessen
deduplizierte Ressourcen; Original-JSON-Export lädt keine Ressourcen. Pending-/Leave-
Status fragt offene Journalstatus im Index ab, ohne Verwaltungsseiten zu materialisieren.
Es gibt keinen Payloadcursor und kein `getAll` im Produktionspfad. Näheres und
strukturelle Messungen: [Storage-Katalog](animation-builder-storage.md).

## Automatische Grenzen und verbleibende Schulden

`animationArchitecture.test.ts` prüft native/neutrale Abhängigkeitsgrenzen, fehlende
Runtime-Zyklen, Modul-Erreichbarkeit und offensichtlich unreferenzierte Exporte.
Nur die ausdrücklich erhaltenen, getesteten Face-/Operations-Mapping-APIs sind
offline. `legacyIndependence.test.ts` sperrt das entfernte Authoring-System;
`scripts/check-legacy-authoring.mjs` prüft den Build. Golden-/Lifecycle-/Browsertests
sichern Pixel, Archive, Restore, Replay, Desktop und Touch ab.

Die verbleibenden Menüs/Toolbar und Inspector-Formulare sind jeweils zusammenhängende
UI-Bereiche; eine weitere Aufteilung benötigt einen konkreten Wartungsgrund. Große explizite Archiv-/Dokumentexports und Konvertierungen können weiterhin Quota/Memory beanspruchen. Der Formdialog
behandelt Enter auf Abbrechen weiterhin wie die primäre Aktion. Diese bestehenden
Verhaltens-/Performancefragen werden hier nicht verändert.
