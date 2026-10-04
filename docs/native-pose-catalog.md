# Nativer Raster128-Pose-Katalog (Schritt 8)

`src/animation/nativePoses.ts` liefert sechs stabile IDs:
`standing_neutral`, `standing_active`, `sitting_relaxed`, `sleeping`, `reading`,
`eating`. Bestehender Source-Alias `fino-standing-neutral-128` bleibt unverändert;
die fünf neuen Aliase folgen demselben Muster. Anzeigenamen stehen im Katalog.

Alle produktiven Assets liegen als versionierte, vollständige native 128×128-
Pixelmaps in `src/animation/data/poses/*.json`: Abmessungen, Assetversion und
sortierte `[y*128+x, RGBA]`-Paare. Fehlende Pixel sind transparentes RGBA 0.
Sie werden statisch geladen, ohne Canvas-Rasterisierung, Antialiasing, Bildfetch,
Legacy-Renderer, Skalierung oder Face-Rig zur Laufzeit. Jeder Quellenaufruf gibt
eine eigene Map zurück; Änderungen eines Dokuments verändern den Katalog nicht.
1024×1024-Ausgabe bleibt ausschließlich der bestehende 8×-Nearest-Neighbor-Export.

![Native Posen, 2× Nearest-Neighbor-Übersicht](native-pose-catalog.png)

## Autorenschaft und Stilanker

Die ursprüngliche Datei `src/animation/data/standing-neutral.json` und ihre
Polygon-/Glint-Rasterisierung sind unverändert. Die neue Neutral-Pixelmap ist ein
byteidentischer Snapshot dieses bisherigen Ergebnisses (3514 gesetzte Pixel,
RGBA-SHA-256 `b7e46ed7fe39264213f259550087377e2f37fab458a6b906f8424b36fcf0bb30`).
Der vorhandene Dart-Golden-Test bleibt die unabhängige Referenz.

`scripts/author-native-poses.py` ist eine Offline-Autorenrezeptur: feste Palette,
Integer-Polygone, native Kopfgeometrie aus der Neutralpose und explizite Details.
Es liest keine Tracing-/Legacy-Bilder und skaliert keine Quellbilder herunter.
Die fünf neuen Posen sind native Neuzeichnungen, keine umbenannten Konverter-
Ergebnisse. Aktive Pose und Essenspose behalten den nativen Neutral-Rumpf;
Sitzpose, Lesehaltung und eingerollter Schlafkörper sind neu gezeichnet.
Augen beim Schlafen sind geschlossene native Formen; Buch, Lätzchen und Besteck
sind fest eingebrannte normale Pixel, keine Operations oder Overlays.

Die vorhandenen sechs 128er Tracing-Bilder bleiben ausschließlich visuelle
Referenzen. Der Katalog nennt ihre Pfade als Provenance-Hinweis, lädt sie aber
nicht als Quellen. Die Autorenrezeptur kann mit `python scripts/author-native-poses.py`
ausgeführt werden. Pillow ist nur für die optionale Dokumentationsübersicht nötig;
die Asseterzeugung selbst benötigt lediglich Python-Standardbibliotheken.

Bewusste visuelle Abweichungen: Die Sitz-/Lesehaltung verwendet die Kontur und
Kopfproportionen des nativen Neutralankers. Das Buch ist ein vereinfachtes blaues
Rechteck mit klarer Rücken-/Seitenkontur. Die Schlafpose ist kompakter eingerollt;
der Kopf bleibt im nativen Profil, statt den 1024er Winkel zu imitieren. Das
Essensbesteck und das rot-cremefarbene Lätzchen sind bewusst gröber und vollständig
opaqu. Keine der Neuzeichnungen behauptet Pixelgleichheit zur Legacy-Illustration.

## Herkunft, Versionen und Persistenz

Katalogmanifest: `catalogVersion`, kanonischer SHA-256 des unveränderten
Neutral-Autorenankers; pro Pose ID, Source-ID, Name, explizite Assetdatei, Assetversion, kanonischer
Asset-SHA-256 und SHA-256 aller 65536 RGBA-Bytes einschließlich Transparenz.
Kanonische JSON-Hashes verwenden sortierte Objektschlüssel ohne Whitespace; dadurch
ändern Git-Zeilenenden weder Identität noch Vergleichsergebnisse. Pixelhashes
verwenden explizite RGBA-Kanalreihenfolge, keine Plattform-Uint32-Byteorder.

Das additive optionale Frame-Feld `pose` enthält `{poseId, assetVersion,
pixelSha256}`. Die SavedFrame-API und der gemeinsame Dokumentparser validieren es.
Alle neu aus dem Katalog erzeugten Frames erhalten diese eingefrorene Herkunft;
V1 und bisherige V2 ohne Feld bleiben unverändert lesbar. Es wird für alte Frames
keine unbewiesene Herkunft inferiert. Keine IndexedDB-/Dokumentversionsänderung.

`pose` bezeichnet den **ursprünglichen** Ausgangsasset, nicht den Hash später
bearbeiteter Pixel. Save/Load und `.raster128.json` behalten Pixelmaps und Herkunft
bei; die Herkunft löst niemals automatische Neu-Rasterisierung aus. Historische
Assetversionen/-hashes bleiben lesbar, auch wenn ein künftiger Katalog neue Assets
liefert. Unbekannte Pose-IDs und ungültige Herkunft werden vor Store-Mutation
abgelehnt. Änderungen am Frame bleiben über dieselbe Frames-Baseline dirty.

## Quellen- und Frame-Aktionen

Die Grundpose-Auswahl wendet die gewählte Quelle ausschließlich auf den aktuellen
Frame an; andere Frameobjekte und deren Pixel bleiben unverändert. Bisher entfernte
Pose-/Face-Layer werden nur dort ersetzt, eigene weitere Pixellayer bleiben erhalten.
`state.source` speichert weiterhin die zuletzt gewählte Dokumentquelle; Navigation
ändert sie nicht und wird dadurch nicht dirty. Die individuelle Frameherkunft ist
davon getrennt. Neu und „aktuellen Frame übernehmen“ erhalten passende Herkunft.

„Frame aus Grundpose“ im Animationsmenü und in der Timeline fügt nach dem aktuellen
Frame einen frischen Katalogframe mit 400 ms Dauer und normalem bearbeitbarem
Pixellayer ein. Keine bestehenden Pixel oder Gesichts-Collections werden hineinkopiert.
Bei Leer/Testfixture ist diese Aktion deaktiviert und ihre API erzeugt keinen Frame.
Einfügen erzeugt genau einen normalen History-Eintrag; Undo/Redo bleiben unverändert.

Das bisherige „Frame hinzufügen“ leert weiterhin die normalen Pixellayer, behält
das bisherige Face-Layer-Verhalten und erhält keine Pose-Herkunftsbehauptung.
„Frame duplizieren“ kopiert dagegen wie bisher vorhandene Pixel, nun einschließlich
bereits gespeicherter Herkunft. Kamera, Viewport, Zoom/Pan und Canvas-Resize werden
nicht geändert.

## Gesichtsfreie Varianten und nächste Grenzen

Es werden noch **keine** gesichtsfreien Varianten als geeignet deklariert. Augen,
Nase und Mund sind in den Assets normale native Pixel. Ein späterer Face-Schritt
muss passende gesichtsfreie Basen samt eigener Hashes und Masken/Anker validieren;
eine rechteckige Entfernung des Gesichts wird hier nicht als fertige Basis ausgegeben.
Schritt 8 selbst ergänzte noch keine Face-Overlays, Retargeting- oder Operationsfunktionen.
Diese nativen Funktionen folgten in Schritt 9/10. Seit 12b bleibt Legacy nur als
Import-/Kompatibilitätsschicht erhalten; ein separater Legacy-Editor existiert nicht mehr.

Tests: `tests/nativePoses.test.ts` prüft Katalog, Neutral-Golden, native Abmessungen,
Integer-RGBA, deterministische Hashes, Map-Isolation, Posewechsel, Frame-Aktionen,
Herkunft/Versionen, V1/V2-Datei-Roundtrip, Save-Race und sämtliche Exportblöcke.
`tests/browser/native-poses.spec.ts` prüft die realen Dropdown-/Timeline-Aktionen,
Datei-Roundtrip und fehlende Legacy-Ressourcenanfragen.
