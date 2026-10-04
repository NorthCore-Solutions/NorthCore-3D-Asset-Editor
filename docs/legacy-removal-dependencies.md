# Legacy1024: Authoring entfernt, Import erhalten

Stand: 4. Oktober 2026, nach Schritt 12b. Der Animation Builder besitzt nur noch
Raster128. Alle vorherigen lokalen Änderungen und Benutzerbestände bleiben erhalten.
Die verworfenen Repo-Beispiele wurden nicht durch neue Beispielanimationen ersetzt.

## Entfernt

- `src/animation/LegacyBuilder.tsx`, `LegacyCanvas.tsx`, `legacyStore.ts`,
  `legacyPersistence.ts`: Oberfläche, Pointer-Authoring, History, Playback und
  Definition-/Bibliotheks-Autosave des alten Editors.
- `tests/legacyPersistence.test.ts`; `tests/browser/legacy-authoring.html`,
  `legacy-authoring.tsx`, `legacy-polygon.spec.ts`, `legacy-persistence.spec.ts`,
  `legacy-content-cleanup.spec.ts`: ausschließlich der alten Authoring-Route zugeordnet.
- Optionale Moduswahl/Props im gemeinsamen Header, deren drei responsive CSS-Regeln,
  ungenutzter Spacer und tote Legacy-Zweige in gemischten Raster-/3D-Browsertests.
- Ausschließlich für den alten Editor benötigte Helfer in `legacy.ts`: Asset-/Rig-
  Fetchcache, Face-Resize und Authoring-Preset-Retargeting, Scene-/Pixel-Sampling-
  Preview samt Callback. Der reine Renderer besitzt unveränderte Pixel-/RGBA-Semantik.
- Der obsolete Dateilist-Helfer im gemeinsamen `files.ts`. Der unabhängige
  Migrationsweg listet lokale Quellen selbst und verwendet unverändert dieselbe Datenbank.
- Bereits zuvor: beide Repo-Demos und ihre 15 Golden-Einträge. Die synthetische
  Mehrframe-Fixture und 24 unabhängige Renderer-Goldens bleiben erhalten.

## Erhaltene Produktions-Kompatibilitätsschicht

| Datei | Zweck |
| --- | --- |
| `src/animation/legacy.ts` | Definition-/Layer-/Operation-/Rig-Typen, Parser, PNG-Dekodierung, Masken, Move/Stretch und geprüfte 1024er Kompatibilitätsdarstellung |
| `src/animation/templateLibrary.ts` | Originales `fino_templates.json`-Format und neutrale LegacyTemplate-Typen |
| `src/animation/data/legacy-presets.json` | Unveränderte V1/V2-Kalibrierungen und Addon-Kontext für Audit/Archiv |
| `migration/legacyAudit.ts` | Inventarprüfung, Defaults, Ressourcenprüfung und Originalarchiv |
| `migration/legacyConverter.ts` | Geprüftes Legacy-Rendering, Exact/Lossy-Klassifikation, natives Raster-V2-Ergebnis und Bericht |
| `migration/legacyOperations.ts` | Nachweisbare native Operations-Mappings; sonst gebacken |
| `migration/legacyTemplates.ts` | Native Vorlagen-Konvertierung mit Exact/Lossy/Blocked und Originalherkunft |
| `migration/localMigration.ts`, `storage.ts` | Atomare Ressourcen-/Archiv-/Zielspeicherung, stabile Identität, Journal und Wiederaufnahme |
| `migration/migrationController.ts`, `LegacyMigrationPanel.tsx` | Unabhängiger Import-/Verwaltungsweg, Freigabe, Status/Retry und optionales Raster-Öffnen |

Alle **74 Dateien** unter `public/animation/legacy/` bleiben bytegleich: sechs
Basisposen, sechs Face-Basen, drei Addon-Familien, beide Rigs samt Manifesten.
Alle sechs Tracing-Bilder, native Pose-/Face-Assets und Rasterbibliotheken bleiben.
`migration/legacyFaces.ts` enthält weiterhin reine V1/V2-/Addon-Mappings. Keine native
Darstellung verwendet den Legacy-Renderer.

IndexedDB-Version, lokale `.finoanim.json`-Keys, `__legacy_templates`, Raster-V2-
Ziele, Archive, Ressourcenblobs und Journale wurden weder migriert noch gelöscht.
Import erfordert Audit und eindeutigen Kontext, Lossy eine ausdrückliche Freigabe.
Archive enthalten ursprüngliche JSON-/Asset-/Rig-/Presetdaten. Identische Quellen
werden unabhängig von Inventardokumentation abgeglichen; alte Journale behalten
ihre historische Identität. Es gibt keine automatische Start-/Massenmigration.

## Launcher und Sicherheitsgrenzen

Der Launcher lädt `AnimationBuilder` direkt; der ehemalige Durchreich-Wrapper ist entfernt. Der Launcher hat keinen
Legacy-Moduszustand. Pause/Playback nutzen die bestehende Raster-Semantik.
Dirty-/Leave-/Unload-Schutz berücksichtigen Raster, globale Bibliothek, 3D und
Pending-/Failed-Migrationswrites. Die Migration macht keinen Raster-Inhalt dirty.
Alle Canvas-/History-/Transform-/Export-/Live-Update-Regeln bleiben unverändert.

## Automatische Guards und Referenzklassifikation

`tests/legacyIndependence.test.ts` prüft gelöschte Dateien/Testhosts, abwesende
Modus-UI, alle Produktions-/Test-Imports einschließlich Typimports, den transitiven
Launcher-/Buildergraphen sowie den Android-Workflow. `scripts/check-legacy-authoring.mjs`
prüft den fertigen Build; Android- und Beta-Workflow führen ihn nach dem Webbuild aus.
`public/**` und Änderungen am Bundle-Guard lösen den Workflow aus.

Nach der repo-weiten Suche sind Verweise auf `LegacyBuilder`, `LegacyCanvas`,
`legacyStore` und `legacyPersistence` ausschließlich folgenden Zwecken zugeordnet:

- **Historische Dokumentation:** diese Entfernungsliste. Sie dokumentiert bewusst
  die gelöschten Dateinamen; kein aktueller Bedienweg verweist darauf.
- **Negative Sicherheitsnachweise:** Unit-/Bundle-Guards und der unabhängige
  Browser-Migrationstest verwenden die Namen als Sperrliste. Das sind absichtliche
  Abwesenheitsprüfungen, keine Modulimporte oder Editorabhängigkeiten.
- **Aktuelle Importdokumentation:** beschreibt die verbotene Produktionskante als
  Invariante. Der historische Portierungsprüfungsabschnitt ist ausdrücklich datiert.

Es gibt keine verbliebenen fehlerhaften Authoring-Imports oder Laufzeitreferenzen.
Legacy1024 ist als Editor vollständig entfernt; die Importschicht bleibt nötig,
um echte bestehende Benutzerdaten weiterhin prüfen, archivieren und migrieren zu können.
