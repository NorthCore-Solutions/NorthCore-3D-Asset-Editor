# Raster128-Dokument V2

Schritt 3 der Legacy-Migration. Dies definiert ausschließlich das persistierte
Raster-Zielmodell. Kein Legacy-Konverter, Import, Rendererpfad oder UI wird ergänzt.
Maßgebliche Typen: `RasterSessionV1`/`RasterSessionV2` in `src/animation/files.ts`
und `DocumentMetadata` in `src/animation/document.ts`.

## Schema und Grenzen

V2 speichert `version: 2`, `name`, `source`, `frames`, `templates`, `faces`,
`reference` und den neuen Block `metadata`. Alle bisherigen Inhaltsfelder behalten
ihre Darstellung: native Integer-Pixelkeys 0–16383, unsigned 32-Bit-RGBA-Werte,
Frame-Dauern in ms, Layerflags/-IDs und optionale `faceId`, Collection-IDs/-Bounds,
Referenz-RGBA/-Bounds. Keine Legacy-Operations oder Rig-Transformationen werden
ausgeführt oder in Frame-Layer aufgenommen.

`metadata` enthält:

| Feld | Bedeutung |
| --- | --- |
| `id` (erforderlich) | Nichtleere Dokument-ID. Neue Dokumente: UUID. Bestehende V1-Dokumente: deterministische Inhaltsidentität. |
| `reactionState?` | Uninterpretierter String, auch leer; keine Zustandsenum oder Playbackfunktion. |
| `provenance?` | `kind`: `native`, `raster-v1`, `legacy` oder `import`; optionale `sourceId`, `fileName`, `storageKey`, `sha256`, `archiveId`. SHA-256: 64 kleine Hexzeichen. Ursprung, kein aktiver Assetresolver. |
| `legacy?` | Positive Integer-`formatVersion`, optionale `rigVersion` 1/2, erforderliche `basePose`, optionale `definitionId` und `addonRoot`. Originalkontext, kein Renderingverhalten. |
| `migration?` | `reportVersion: 1`, `stage`: `assessment` oder `conversion`, `report` als JSON-Objekt; optionale `archiveId` und `converter: {name, version}`. |

Metadatenobjekte besitzen geschlossene Feldlisten. Unbekannte Felder, falsche Typen,
null an optionalen Metadatenfeldern und nicht unterstützte Report-/Rig-Versionen
werden abgelehnt. Ein Report ist bewusst ein offenes, unverändert erhaltenes
JSON-Payload; er kann das Prüfergebnis aus Schritt 2 aufnehmen. Er wird nicht als
Nachweis erfolgreicher Konvertierung interpretiert. Nur endliche Zahlen und
JSON-Werte, maximal 64 Ebenen, sind erlaubt; kein Date/Map/undefined/NaN.

Archiv-ID und Quelldatei/Speicherkey sind Referenzen; sie ersetzen kein Originalarchiv.
Ein späterer Konverter muss Originalarchiv und Prüfergebnis weiterhin separat
erhalten und den tatsächlichen Übernahmeweg explizit bestimmen.

Frameindex, aktiver Layer, Auswahl, Tool, Playback, Viewport und Meldungen werden
nicht in V2 geschrieben. V2 beginnt beim Restore auf Frame 0 mit dessen erstem
ungesperrten Nicht-Face-Layer. Bestehende Collection-/Layer-/Face-IDs bleiben die
aktuellen nativen Referenzen. Zusätzliche Pose-/Rig-/Bibliotheks-Referenzschemas
werden erst mit den jeweiligen nativen Funktionen definiert; hierfür entsteht
jetzt kein spekulatives paralleles Legacy-Modell.

## V1-Kompatibilität

V1 bleibt synchron lesbar. Alle Inhaltsfelder sowie historischer Frameindex und
aktiver Layer werden geladen. Vor der Store-Mutation werden Inhalt und Metadaten
geprüft. Das nächste explizite Speichern schreibt V2; keine automatische lokale
Datenmigration findet statt.

Die V1-ID ist `raster-v1-` plus FNV-1a-128 über UTF-8 des kanonischen,
normalisierten Inhalts. Objektkeys und Pixelentries werden sortiert; Frame-,
Layer- und Collection-Reihenfolgen bleiben erhalten. UI-Zustände, Version,
Zeit und Zufall gehen nicht ein. Identische V1-Inhalte erhalten identische IDs.
Dies ist eine nicht kryptografische Inhaltsidentität, **keine Archivprüfsumme**;
SHA-256-Prüfsummen des Originalarchivs aus Schritt 2 bleiben unabhängig.
Nach V2-Speicherung bleibt die ID bei Inhaltsänderungen erhalten.

Nur Dokumentversionen 1 und 2 sind lesbar. Unbekannte Versionen werden vor
Store-Mutation abgelehnt, nicht heuristisch als V1 behandelt.

## Saved-Baseline und Persistenz

Metadaten sind validierte, vom Aufrufer abgetrennte, tief eingefrorene Werte.
`setDocumentMetadata` verwendet den vorhandenen Commit-/Undo-/Redo-Pfad;
inhaltlich identische Metadaten verursachen keinen Commit. Collections bleiben
außerhalb der Frame-History. Metadatenidentität ist Bestandteil der Saved-Baseline,
nicht der UI-/Playback-`version`.

Der bestehende Save-Snapshot/Singleflight-Pfad bleibt erhalten. Ein erfolgreicher
Write bestätigt nur seine erfasste Baseline; zwischenzeitliche Metadatenänderungen
bleiben dirty. Restore und Neu invalidieren verspätete Ergebnisse. Neu erzeugt
eine neue Dokumentidentität mit nativer Herkunft; auch bei kopiertem Frame werden
alte Konvertierungsberichte nicht als Herkunft des neuen Dokuments übernommen.

IndexedDB bleibt `northcore-animation-builder`, Version 1, Store `sessions`.
Werte sind weiterhin JSON-Strings, Schlüssel weiterhin Sitzungsnamen. Ein
V2-Dokument erfordert daher keinen Datenbankbump. Gleichnamige Saves behalten das
bisherige Überschreibverhalten; die Dokument-ID ändert die Key-Semantik nicht.

## Referenzen und Validierung

`tests/fixtures/raster-session-v1.json` ist die feste Kompatibilitätsreferenz mit
zwei Frames, Collections und Referenzbild einschließlich niedriger Alpha-Werte
und transparentem RGB. `tests/rasterDocument.test.ts` prüft V1/V2, Metadaten,
invaliden Input und unveränderte Renderer-/Exportbytes. Save-Races und
IndexedDB-Vertrag werden in `tests/animationPersistence.test.ts` geprüft.

Offen für spätere Schritte: native Pose-/Face-Referenzen und Katalogversionen,
Konverteridentität und konkrete Konvertierungsbericht-Payloads. Diese dürfen
erst aus der jeweiligen nativen API abgeleitet werden; das V2-Metadatenschema
muss bei neuen geschlossenen Feldern bewusst weiterentwickelt werden.

## Portabler Dateiweg (Schritt 4)

Raster-Dokumente werden als `<Name>.raster128.json` mit MIME `application/json`
exportiert, ausdrücklich getrennt von Legacy-`.finoanim.json`. Der Dateiname
ersetzt plattformübergreifend problematische Zeichen, ohne den Dokumentnamen
zu verändern. Formatquelle bleibt `serializeSession`/`restoreSession`, einschließlich
der Metadatenvalidierung; kein zweiter Datei-Codec oder Schemawechsel entsteht.
Frames, sämtliche Layerpixel, Templates, Faces und Referenz-RGBA werden eingebettet.
Es werden keine externen Layer-/Collection-Dateien für einen Roundtrip benötigt.
Herkunfts-/Archivverweise bleiben Referenzen; Originalarchive werden nicht eingebettet.

`exportRasterDocument` verwendet den vorhandenen `saveBlobAs`-Pfad:
Browser/Desktop laden einen Blob herunter, Android verwendet `NativeFileDialog`
und `ACTION_CREATE_DOCUMENT` mit UTF-8/Base64-Payload. Export aktualisiert weder
Saved-Baseline noch lokales Speicherziel. Abbruch und Fehler werden nicht als
erfolgreicher Export gemeldet. PNG-Export bleibt separat unverändert.

`importRasterDocument` liest eine File/Blob vollständig und übernimmt V1/V2
ausschließlich über den gemeinsamen Restore-Pfad. Der Raster-Datei-Menüpunkt
verwendet den bestehenden HTML-Dateipicker und eine Bestätigung vor dem Ersetzen.
Androids Capacitor-WebView bietet denselben Input über seinen Dateipicker an;
ein neuer nativer Import-Pluginpfad ist nicht erforderlich. Der Picker akzeptiert
die Raster-Endung sowie JSON für ältere V1-Dateien; die Endung ersetzt keine
Inhaltsprüfung. Legacy-Dateien werden nicht konvertiert.

Prüfung von Version, Frames, Pixel-Tupeln, Layerflags/IDs, Collection-Bounds,
Referenzdaten und Metadaten geschieht vor jeder Store-Mutation. Erfolgreicher
Import pausiert altes Playback, leert die vorhandene Dokument-History/Auswahl,
setzt eine neue Session-/Playback-Identität und die Saved-Baseline einschließlich
Collections und Metadaten. Die Dokument-ID bleibt bei V2 erhalten; V1 erhält
seine deterministische Upgrade-ID. Der Import schreibt nichts nach IndexedDB.
Alte Save-Ergebnisse können die neue Baseline nicht markieren. Ein verspäteter
Datei-Read nach Neu/Restore oder einem anderen Import wird ebenfalls ignoriert.
Picker-/Bestätigungsabbruch und Lesefehler lassen Inhalt/Baseline unverändert.

Referenzen: `tests/rasterDocumentFiles.test.ts` prüft den Browser-Downloadpfad und
Android-Bridgevertrag samt Fehlern/Abbruch; `tests/animationPersistence.test.ts`
prüft Import bei laufendem alten Save. `tests/browser/raster-document-files.spec.ts`
prüft echte Browser-Dateiauswahl, Download/Roundtrip und Bestätigungsabbruch.
Native Android-Dateianbieter/URI-Berechtigungen benötigen zusätzlich einen
Gerätetest. Browser können nach Übergabe des Downloads an den Browser weder
den endgültigen Speicherort noch spätere Dateisystem-Schreibfehler bestätigen.
