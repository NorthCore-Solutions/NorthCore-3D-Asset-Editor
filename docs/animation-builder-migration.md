# Animation Builder: Migration in die Asset-Editor-App

Quelle: `NorthCore-Solutions/Motivation_Pet`, Commit
`a555829a1f38cbe0b5c6fed65bf6ac95b5340337` (»Vor Übertragung«).
Die Quelle wurde nur gelesen. Es wurden keine Dateien dort verändert, verschoben oder gelöscht.

## Modulgrenze

- `src/app/EditorLauncher.tsx` öffnet Asset Editor oder Animation Builder.
- Der bestehende 3D-Editor behält seinen Zustand, seine History und sein Dateiziel beim Wechsel.
  Sein Viewport und seine Tastenkürzel werden im anderen Editor deaktiviert.
- `src/animation/AnimationBuilder.tsx` wird direkt vom Launcher als Raster128-Editor geladen.
  Legacy-Benutzerdaten sind über die unabhängige Import-/Migrationsverwaltung erreichbar.
- Rastermodell, native Pose, Werkzeuge und Viewport: `raster.ts`, `store.ts`, `RasterCanvas.tsx`.
- Legacy-Format und Renderer: `legacy.ts`; Audit, Konvertierung, Archiv und Journal:
  `migration/`. Diese Kompatibilitätsschicht besitzt keinen Authoring-Store oder Canvas.
- Plattformdateien verwenden weiterhin `src/platform/nativeFileDialog.ts`.
  Der einmalige Start von `initializeLiveUpdates()` liegt im Launcher; es gibt kein zweites Update-System.
- Lokale Builder-Sitzungen und die Legacy-Vorlagenbibliothek liegen in einer eigenen IndexedDB.
  Sie überschreiben keine 3D-Projekte. Das ist eine interne Sicherung des Editorzustands,
  kein gemeinsames neues Projektformat. `.finoanim.json` und `fino_templates.json` behalten ihr ursprüngliches Schema.

## Übernommener Funktionsumfang

| Bereich | Portierung |
| --- | --- |
| Native Pose | Ursprüngliche Polygon-/Palettendaten aus `native_standing_neutral.dart`; 3514 editierbare Pixel, kein PNG als Pose-Quelle |
| Raster128 | 128×128, exakte `0xRRGGBBAA`, Integer-Koordinaten, 8×-Produktionsexport |
| Werkzeuge | Quadratischer Stift/Radierer 1–8 mit unabhängiger Größe; Rechteck/Polygon; Move/Stretch/Grab; Vorschau; Undo/Redo |
| Pipette | Original-RGBA der sichtbaren Referenz, sonst Raster; gemeinsame Zielzelle für Sampling und Lupenrahmen; Escape |
| Referenz | PNG/JPEG/WEBP/BMP-Dateiauswahl, sechs mitgelieferte Tracing-Bilder, editor-only, Sichtbarkeit, ausgewählt + Grab zum Verschieben |
| Layer | Sichtbarkeit, Sperre, Reihenfolge, Namen, freie Pixel-Layer, native Face-Assets |
| Vorlagen | Auswahl direkt aus Rasterdaten; normale Vorlage **oder** Face-Asset; separate Collections und Namenskollisionen; unveränderte Originale beim Einfügen/Skalieren |
| Animation | Leere/kopierte Frames, Dauer, Wiedergabe, Timeline, neue Animation, lokale Sicherung, PNG-Export |
| Legacy-Import | Bestehende Definitionen mit Posen, V1/V2-Rigs, Addons, Operations und Pixel-Layern prüfen/konvertieren; unveränderliches Originalarchiv, Freigabe, Journal und Wiederaufnahme |
| Dialoge | Gemeinsamer Dialog mit Enter für die validierte primäre Aktion und Escape zum Abbrechen; HSV/Alpha/Hex-Farbauswahl |
| Bedienung | Maus/Touch/Pen über Pointer Events, Wheel/Touchpad und Pinch über dieselbe Ankerabbildung; Panels als Overlays |

Strokes und Face-/Auswahl-Drags ändern nur ihre lokale Vorschau, bis die Geste endet.
Ein Stroke erzeugt einen History-Eintrag. Native Frame-Bilder werden nach unveränderlicher
Frame-Identität gecacht. Legacy-Konvertierung verwendet geprüfte, injizierte Ressourcen
ohne Authoring-Cache oder Live-Pointer-Vorschau.

## Kopierte Assets und gemeinsame Abhängigkeiten

- `public/animation/tracing/`: sechs originale `*_128.png` aus dem Builder, bytegleich kopiert.
- `public/animation/legacy/`: 74 Dateien aus `assets/fino_assets_complete/`:
  `basis`, `basis_face_base`, `addons`, `addons_cleaned`, `addons_normalized`, `addons_rig`, `addons_rig_v2`.
  Originale, Kalibrierungen und Manifestdaten sind unverändert.
- `src/animation/data/standing-neutral.json`: native Geometrie/Palette.
- `src/animation/data/legacy-presets.json`: aus den bestehenden Dart-Presets extrahiert, nicht neu kalibriert.

Die benötigte Logik aus `packages/fino_animation` wurde nach TypeScript portiert.
Das Dart-Paket selbst ist keine Laufzeitabhängigkeit des Asset Editors.
`fast-png` decodiert PNG-Pixel ohne den verlustbehafteten Canvas-Premultiplikations-Rückweg
und schreibt RGBA-PNG-Exporte. Andere Referenzformate verwenden den Browser-Bilddecoder.
Keine Aufgaben-, Ernährungs-, Self-Care-, Benachrichtigungs- oder Pet-App-Logik wurde übernommen.

## Reproduzierbare Prüfungen

```sh
npm test
npm run lint
npm run build
npx playwright test --config=playwright.config.mjs
npx cap sync android
```

Unter Windows anschließend `android/gradlew.bat assembleDebug` mit installiertem Android SDK/JDK.
Die Browser-Tests verwenden lokal installiertes Microsoft Edge und starten bei Bedarf Vite auf Port 5176.

- `animationRaster.test.ts`: bytegleiche native Pose zur Dart-Ausgabe, Brush-Größen/Anker,
  lückenlose Strokes, History, Zoom, Referenz-Sampling, Collections und 8×-RGBA-Blöcke.
- `animationLegacy.test.ts`: gespeicherte Dart-Render-Hashes aller sechs Posen mit V1/V2,
  Pixeloperationen. Repo-Beispiele und ihre Golden-Einträge wurden inzwischen entfernt.
- `animationInteraction.test.ts`: Raster-Quellenwechsel, Layer/Selection und PNG-/Bibliotheksdaten.
- `legacyIndependence.test.ts`: gelöschte Authoring-Dateien, sämtliche Produktions-/Testimports,
  transitive Einstiege und Android-Workflow; `scripts/check-legacy-authoring.mjs`: Produktionsbundle.
- `tests/browser/animation.spec.ts`: Desktop, Tablet, Touch/Pinch, Dialoge, Referenzen,
  gemeinsame App-Navigation und Regression des bestehenden 3D-Editors.

## Historisches Ergebnis der Portierungsprüfung (1. Oktober 2026)

Die folgende Prüfung beschreibt den damaligen Portierungsstand. Der Legacy-Editor
und seine Authoring-Tests wurden am 4. Oktober in Schritt 12b entfernt; aktuelle
Import-/Kompatibilitätstests und die Renderer-Goldens bleiben erhalten.

- Gesamte Vitest-Suite: **561 Tests in 42 Dateien erfolgreich**.
- Sechs Edge-Browsertests: Maus-Strokes/History, getrennte Brush-Größen,
  originale Referenzfarben/Export, Touch-Zeichnen/Pinch, Legacy-/Editorwechsel,
  Enter/Escape, Referenz-Grab und bestehende 3D-Objekte erfolgreich geprüft.
- TypeScript und Vite-Produktionsbuild erfolgreich.
- ESLint: keine Fehler. 33 bestehende Hook-Warnungen liegen ausschließlich in
  unveränderten 3D-Dateien; die neuen Builder-Dateien sind ohne Warnungen.
- Capacitor-Sync und Android `assembleDebug` erfolgreich.
- Desktop und Tablet-Hochformat im Browser zusätzlich visuell geprüft.
  Touch/Pinch wurden als echte Browser-Touch-Ereignisse getestet. Ein physisches
  Android-Gerät war nicht angeschlossen; eine Geräteprüfung steht daher aus.
- 80 kopierte Legacy-/Tracing-Dateien per SHA-256 mit der Quelle verglichen: keine Abweichung.
- `git status --porcelain` in Motivation_Pet bleibt leer; HEAD bleibt der oben genannte Commit.

Die Debug-APK liegt unter `android/app/build/outputs/apk/debug/app-debug.apk`.
Die größeren bestehenden 3D-Bundles lösen weiterhin die Vite-Chunkgrößenwarnung aus.

## Quelle und mögliche spätere Bereinigung

**In diesem Schritt nichts entfernen.** Insbesondere bleiben `lib/`, `test/`, `android/`,
Root-`pubspec.yaml`, Datenbank-, Aufgaben-, Ernährungs- und Benachrichtigungslogik der Motivation-Pet-App erhalten.
Der aktuelle Root-`pubspec.yaml` und `lib/` importieren `packages/fino_animation` nicht.
Das Paket und die Fino-Assets werden aber von weiteren Asset-Werkzeugen und Pakettests verwendet.

Nach separater Freigabe und Sicherung lokaler Animationen wäre ausschließlich
`tool/fino_animation_builder/` als alter eigenständiger Flutter-Host entfernbar:
`lib/`, `test/`, `assets/tracing/`, `windows/`, Builder-`pubspec.*`, Build-/Analyse-Konfiguration,
Builder-Dokumentation und dessen Analyse-/Vorschauwerkzeuge.
Den Unterordner `animations/` zuerst mit den portierten bzw. eigenen Dateien abgleichen und sichern.

`packages/fino_animation/`, `assets/fino_assets_complete/` sowie externe Rig-/Asset-Generatoren
**nicht pauschal mitlöschen**. Vor einer späteren Entfernung müssen deren verbliebene
Aufrufer und Tests gesondert geprüft werden. Die Haupt-App bleibt in ihrem eigenen Repository.
