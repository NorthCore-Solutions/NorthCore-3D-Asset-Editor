# Verbindliches Inventar: Legacy1024 → Raster128

Stand: 3. Oktober 2026, aktueller Working Tree einschließlich der noch nicht
committeten Persistenz-, Menü-, Playback- und Polygonkorrekturen. Das Inventar wurde nach den Migrationsschritten 1–10 um den entfernten
Repo-Demobestand bereinigt. Benutzerformate und Importressourcen bleiben erfasst.

## Verbindliche Quellen

- `src/animation/migration/legacy-inventory.json`: vollständige Assetliste,
  SHA-256, PNG-Abmessungen, Familien/Funktionen, Feldinventar, Kalibrierungen,
  Persistenz und Kontextabhängigkeiten.
- `tests/fixtures/legacy-migration-cases.json`: 21 synthetische Definitionen mit
  23 Renderkontexten, eine Bibliothek und vier ausdrücklich ungelöste Beispiele.
- `tests/fixtures/legacy-dart-goldens.json`: 24 unabhängige
  Dart-Renderreferenzen. Sie werden referenziert, nicht kopiert oder ersetzt.
- `tests/legacyMigrationInventory.test.ts`: Driftprüfung gegen Dateien,
  Produktionsdeklarationen, erkannte Operations und bestehende Codecs/Renderer.

Die JSON-Fixtures sind unabhängig von Vitest und ohne Produktionsimporte lesbar.
Assets, Presets, Rigs und Dart-Goldens werden über Pfade und
Prüfsummen wiederverwendet; ihre Inhalte werden nicht redundant gespeichert.
Die synthetischen SHA-256-Renderwerte sind eingefrorene Ausgaben des aktuellen
Legacy-Renderers, keine neu behaupteten Dart-Goldens und keine zweite Renderlogik.

## Kategorien und Zielgrenzen

| Kategorie | Bedeutung |
| --- | --- |
| 1 | direkt verlustfrei übernehmen |
| 2 | deterministisch konvertieren, nur unter dokumentierten Voraussetzungen |
| 3 | native Raster128-Fähigkeit oder Metadaten erweitern |
| 4 | gerastertes Ergebnis übernehmen; Struktur und gegebenenfalls Details verlieren |

Kategorie 5 wird nicht vergeben: Kein gespeichertes Format und keine fachliche
Funktion ist aus diesem Repository heraus nachweislich entbehrlich.

`category` bewertet den jeweiligen Bestandteil, nicht automatisch seine gesamte
Animation. `classificationConditions` dokumentiert alternative Übernahmewege.
`sourceType` pinnt die bestehenden TypeScript-Feldtypen; `type` erläutert die
Datenbedeutung. Das Inventar ist ein Bestandsvertrag, kein neuer Importvalidator.

Raster128 bleibt 128×128 mit Integer-Koordinaten und exakten `0xRRGGBBAA`-Werten.
Export: ausschließlich 8× Nearest Neighbor auf 1024×1024. Keine Legacy-Blending-
Semantik, Fractional-Pixel oder Antialiasing-Erweiterung im Zielmodell.
Bytegleiches Endbild ist nicht gleichbedeutend mit editierbarer Migration.

## Assets und Kalibrierungen

| Familie | Dateien | Funktion |
| --- | ---: | --- |
| `basis` | 6 PNG | sechs originale Grundposen |
| `basis_face_base` | 6 PNG | gesichtsbereinigte V2-Grundposen |
| `addons` | 10 PNG | ganze Augen-/Mund-Overlays |
| `addons_cleaned` | 10 PNG | alternativ auswählbare ganze Overlays |
| `addons_normalized` | 10 PNG | Standardquelle ganzer Overlays |
| `addons_rig` | 15 PNG + Manifest | Face Rig V1 |
| `addons_rig_v2` | 15 PNG + Manifest | Face Rig V2 |

Insgesamt 74 Dateien. Das JSON führt jede Datei einzeln mit Funktion, Pose bzw.
Part/Zustand, Rig-Version und Prüfsumme auf. Alle 72 PNGs haben 8 Bit und vier
Kanäle. Teiltransparenz und nicht homogene 8×8-Blöcke werden separat erfasst.

Posen: `standing_neutral`, `standing_active`, `sitting_relaxed`, `sleeping`,
`reading`, `eating`. Augen: `open`, `half`, `closed`, `happy`, `surprised`.
Mund: `neutral`, `smile`, `open`, `chew`, `sad`.

Manifestreferenzen umfassen Sprite-Abmessungen/-Anker, V2-Basiszuordnung,
Generatorursprünge, Auswahl-/Füllfenster, Quellen, Strategie und `muzzleVariant`.
Auch derzeit nicht ausgewertete Generatorinformationen bleiben erfasst.
`legacy-presets.json` enthält V1/V2-Face-Kalibrierungen und Addon-Offsets für jede
Pose. Lesen besitzt zwei explizite Augen; der frühere Authoring-Host ergänzte
fehlende rechte Augen unsichtbar. Das ist historische Authoring-Semantik, kein
Import-Default; der entsprechende UI-Helfer ist seit 12b entfernt.
Manifest- und Presetwerte werden aus den
Originaldateien bezogen, nicht durch eine zweite Kalibrierung ersetzt.

Die sechs `tracing/*_128.png` sind zusätzliche Editorreferenzen, keine sechs
nativen Grundposen. Raster128 besitzt inzwischen einen unabhängigen nativen Katalog
aller sechs Posen; Referenzen werden weiterhin nicht als produktive Quellen verwendet.

## Definitionen, Layer und Operations

Das Feldinventar erfasst Definition, Frame, FaceElement, Layer, Pixel, Rect,
Point, Operation, Rig, RigElement und beide Bibliotheksrepräsentationen.

- Definition: `version`, `faceRigVersion`, `id`, `name`, `basePose`,
  `reactionState`, `frames`. Formatversion und Rig-Version sind unabhängig.
  Beide mitgelieferten Animationen haben Formatversion 1 und Rig-Version 2.
- Frames: Dauer in Millisekunden, Operations, Face-Parts, optionale Layer sowie
  Augen-/Mund-Addons als String, Objekt, null oder fehlender Wert.
- Layer: ID, Name, Typ, Sichtbarkeit, Sperre und optionale Pixel.
  Fehlende/leere Layerliste bedeutet implizit Basis plus Gesichtsteile.
- Pixel: Integer-x/y auf 1024×1024 und unsigned RGBA. Wiederholte Koordinaten,
  niedrige Alpha-Werte und transparente RGB-Werte sind als Beispiele enthalten.
- Face: Zustand, Position, Breite/Höhe und Sichtbarkeit; Positionen können
  außerhalb der Zeichenfläche liegen. Originale bewahren, nicht still clampen.
- Masken: Rechteck oder Polygonpunktliste. `stretchSelection` verwendet die
  Masken-Bounding-Box, nicht ausschließlich das Polygoninnere.

| Operation | Geometrie | Varianten/Defaults |
| --- | --- | --- |
| `moveRegion` | `rect` | transparent; fehlende dx/dy = 0 |
| `moveSelection` | `mask` | transparent, restoreOriginal, extendSelectionEdge; String oder strategy-Objekt; Default transparent |
| `stretchSelection` | Maskenbounds | bounds oder boundsLocal; Default bounds; fehlende sx/sy = 0 |

Operations wirken auf die Basis vor Addons und Face-Layern. Legacy verwendet
Source-over für Basis/Gesicht; Pixel-Layer überschreiben bei Alpha > 0.
Raster128 übernimmt dagegen das oberste RGBA wörtlich. Eine Layerkopie ist deshalb
kein zugesicherter Ersatz. Ein Konverter darf unbekannte Operations nicht wie der
aktuelle Renderer bloß mit Warnung überspringen und danach Vollständigkeit melden.

Repo-Beispielanimationen und deren 15 Golden-Einträge wurden entfernt.
`tests/fixtures/legacy-multiframe.json` prüft stattdessen zwei synthetische
Pixel-Layer-Frames mit unterschiedlichen Dauern und RGBA-Werten.
Alle zwölf Basis-PNGs enthalten unterschiedliche RGBA-Werte innerhalb von
8×8-Blöcken: keine bytegleiche Reduktion.

## Bibliothek, Persistenz und ungelöster Kontext

`fino_templates.json` hat Version 1 und `templates`. Jeder Eintrag enthält ID,
Name, Breite/Höhe, originX/originY und relative Pixel. Intern wird der Ursprung als
`origin: Point` geführt. Transparente Lücken, negative Ursprünge und Größen bis
1024 müssen erhalten bzw. ausdrücklich bewertet werden. Klein bedeutet nicht
automatisch native 128er Koordinateneinheit.

IndexedDB: `northcore-animation-builder`, Version 1, Store `sessions`.
Definitionen: `${definition.id}.finoanim.json`; globale Bibliothek:
`__legacy_templates`; Raster-Sitzungen: `${store.state.name}`. Die Bibliothek
speichert separat automatisch und seriell mit Retry/Dirty-Status. Definitions-
Save schreibt extern und danach lokal mit Snapshot-/Sitzungsprüfung.
Es werden ausschließlich lokale Definitionen aufgelistet. Namen können
mit anderen Sitzungsschlüsseln kollidieren; Migration darf Originale nicht ersetzen.

Externe Formate: `.finoanim.json`, `fino_templates.json`, 1024er Frame-PNG.
Der Dateipicker akzeptiert `.json,.finoanim`; Endung allein identifiziert kein
vollständig validiertes Format. PNG-Export ist keine Sitzungsspeicherung.

`addonRoot` ist **nicht** in der Definition gespeichert. Die drei Familien sind
auswählbar und beeinflussen das Ergebnis. Default `addons_normalized` ist keine
Beweisgrundlage für die Herkunft einer externen Datei. Auswahl im aktiven Store
erfassen oder ausdrücklich als mehrdeutig behandeln.

`assessmentStatuses` erlaubt `known`, `unknown`, `ambiguous`, `blocked`.
Die vier Assessment-Fixtures illustrieren unbekannte Operations, zusätzliche
Felder/unbekannte Version, fehlenden Addon-Kontext und einen fehlenden Assetzustand.
Sie sind bewusst vom Satz erfolgreich renderbarer Referenzen getrennt. Alle
werden vom heutigen permissiven Parser akzeptiert; das bedeutet nicht migrierbar.
Unbekannte Rohdaten dürfen weder entfernt noch als vollständig übernommen gelten.

Nicht erfasste private Benutzerbestände, externe Assets/Consumer und neue unbekannte
Formate bleiben offene Bestandsfragen. Die Prüfungen decken das Repository ab,
nicht Browserprofile oder Android-Geräte. Undo/Redo, Auswahl, Werkzeuge, Playback,
Viewport, Meldungen und Caches sind Laufzeitdaten; aktuelle ungespeicherte Dokument-
und Bibliotheksinhalte dürfen bei späterer Migration nicht verloren gehen.

## Pflege und Prüfung

Gezielt ausführen:

```sh
npx vitest run tests/legacyMigrationInventory.test.ts tests/animationLegacy.test.ts
npx tsc -p tsconfig.app.json --noEmit
npx eslint tests/legacyMigrationInventory.test.ts
```

Die Driftprüfungen erfassen hinzugefügte/entfernte/geänderte Assets, beide Rigs,
Presets, Samples und Dart-Goldens; Deklarationsfelder/Optionalität/Typen;
Layer-/Masken-/Addonvarianten; Renderer-Operations, Strategien und Stretch-Bereiche;
Bibliothekscodec, Persistenzkeys, Formatsuffixe und Addon-Kontext.
Sie sind absichtlich keine vollständige formale Spezifikation sämtlicher
Kontrollflüsse. Semantikänderungen benötigen weiterhin Golden-/Interaktionstests.

Bei bewusster Änderung: neue Daten/Felder zuerst klassifizieren und dokumentieren,
Inventar und Coverage-Fixture ergänzen, Hashänderung begründen und Referenzen
reviewen. Dart-Goldens niemals bloß an ein neues Renderergebnis anpassen.
Kein automatisches Aktualisieren beim Testlauf. Die bestehende
`animation-builder-migration.md` beschreibt den Flutter-Port, nicht diese Ablösung.
