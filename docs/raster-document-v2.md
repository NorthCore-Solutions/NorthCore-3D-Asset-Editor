# Raster128-Dokumente V1/V2

Portable Dateien behalten die Endung `.raster128.json` und `version: 2`.
Inhalt: `name`, neutraler `source` (`empty` oder `transparent`), `metadata`,
`frames` (Dauer und geordnete Layer), `templates` und optionale Bildreferenz (`reference` oder null).
Ein Layer enthält ID, Name, Sichtbarkeit, Sperre und sparse Pixelpaare `[key, rgba]`.
Keys sind `y * 128 + x`, RGBA ist `0xRRGGBBAA`; explizite transparente Pixel behalten ihre RGB-Werte.

Metadaten enthalten die stabile Dokument-ID, optionalen Reaktionszustand und gewöhnliche Herkunft.
V1-Dateien werden weiter gelesen und erhalten eine deterministische Inhalts-ID.
V2 persistiert keine Canvas-/Auswahl-/Playback-Position. Import validiert vollständig vor jeder Store-Mutation.

Entfernte optionale Face-, Pose- und Replay-Metadaten werden beim Laden ignoriert.
Gespeicherte Layerpixel und sichtbare/gesperrte Zustände bleiben erhalten; es erfolgt kein Replay,
kein Retargeting und keine Rekonstruktion aus entfernten Assets. Eine alte Source-ID wird auf `empty`
normalisiert, ohne die vorhandenen Pixel zu ersetzen. Erneutes Speichern enthält nur den Rasterkern.

Raster-Dokumentexport ist ein separater Dateiexport und setzt keinen lokalen Gesichert-Status.
Lokale Sicherung und Projektordner-Speicherung markieren erst den erfolgreich geschriebenen Snapshot.
PNG-Export skaliert den aktuellen Frame exakt auf 1024×1024 und enthält keine Editorreferenzen.
