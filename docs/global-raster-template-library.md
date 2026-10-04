# Globale Raster-Pixelvorlagen

Die globale Bibliothek lebt unabhängig von Dokumenten im Key `__raster128_global_templates_v1`.
Format: `northcore-raster128-library`, Version 1, `templates`.
Vorlagen enthalten ID, Name, Breite/Höhe (1–128), Ursprung und sparse lokale RGBA-Pixel mit 128er Stride.
Duplikate und ungültige Pixel werden vor Änderungen zurückgewiesen.

Auswahl global speichern, Anwenden, Umbenennen, Löschen, Bibliothek importieren/exportieren bleiben erhalten.
Schreibvorgänge sind sequenziell, Fehler bleiben sichtbar und wiederholbar.
Konkurrierende Tab-Änderungen werden über Compare-and-Swap und Aktivierungs-/Broadcast-Ereignisse erkannt.
Bibliothek und Dokument haben unabhängige Ungespeichert-Zustände.

Die Bibliothek enthält keine Migrations-Receipts, Archive oder Konverter mehr.
Bei vorhandenen Bibliotheksdateien werden entfernte optionale Angaben ignoriert und nur native Pixelvorlagen übernommen.
Dokumentvorlagen bleiben separat im Raster-Dokument gespeichert.
