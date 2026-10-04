# Animation Builder: nativer Raster128-Kern

`AnimationBuilder.tsx` verbindet die reaktive Editor-Schale mit `AnimationStore` und dem `RasterCanvas`.
`raster.ts` enthält ausschließlich Pixelgeometrie, Layer, Masken, Transformationen und Rendering.
Der Start bietet Leer und Transparent: jeweils einen entsperrten, leeren Pixel-Layer. Es gibt keine vorbereiteten Posen.

Stift/Radierer (1–8 Pixel), Pipette, Rechteck/Polygon, Pan/Zoom und Layer greifen bleiben erhalten.
Verschieben und Strecken/Stauchen sind normale Pixeltransformationen mit einem History-Eintrag.
Pointer-Bewegungen arbeiten auf lokalem Gesteninhalt; Commit schreibt ein neues unveränderliches Frame.
Undo/Redo, Frames mit Dauer, Wiedergabe, Bildreferenzen, Tracing und Pixelvorlagen bleiben erhalten.
Referenzen beeinflussen den PNG-Export nicht.

Legacy-Renderer/Codecs, Ressourcen, Migration/Audit/Konverter, Journale/Archive/Mappings,
native Face-Slots/Presets/Retargeting, Operations-Recipes/Replay und zugehörige UI sind entfernt.
Die sechs Tracing-Bilder in `public/animation/tracing` bleiben als Referenzen erhalten.

`ProjectLibrary.tsx` verwaltet die Ordnerbindung und eine vorübergehende Flyout-Kette.
`projectDirectory.ts` kapselt die File System Access API und das Wiederverwenden eines Hauptordner-Handles.
Die echte Ordnerstruktur wird beim Öffnen, Aktualisieren und Aktivieren gelesen; es gibt keine Projektbaum-Datenbank.
Dateien öffnen das bestehende Raster128-Format über denselben validierenden Parser wie der Datei-Import.

Datei- und Bibliotheksimporte/-exporte nutzen die vorhandene Browser-/Capacitor-Abstraktion.
Ohne Directory-Picker (insbesondere Android/WebView) bleiben diese Dateifunktionen verfügbar.
Keine neue Dependency wurde hinzugefügt. Architekturtests prüfen erreichbare Module, Runtime-Abhängigkeiten und Zyklen;
der Produktionsguard prüft entfernte Systeme und Ressourcen nach dem Build.
