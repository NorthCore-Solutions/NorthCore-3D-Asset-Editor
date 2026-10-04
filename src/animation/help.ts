export const help = {
  Werkzeuge:
    'Stift und Radierer bearbeiten den aktiven, entsperrten Layer. Wähle eine quadratische Größe von 1×1 bis 8×8. Die Pipette nimmt die Farbe unter dem Cursor auf. Mit der Hand verschiebst du die Ansicht; „Layer greifen“ verschiebt Bildinhalt.',
  Ansicht:
    'Animation zeigt Frame-Optionen, Pixel zeigt Zeichenwerkzeuge. Kombiniert zeigt beides. Die Seitenbereiche lassen sich ausblenden, ohne den Bildausschnitt zu ändern.',
  Ausgangszustand:
    'Leer und Transparent beginnen ohne vorbereitete Pixel. Referenzen und Vorlagen lädst du separat.',
  Layer:
    'Gemalt wird auf dem ausgewählten, sichtbaren und entsperrten Pixel-Layer. Obere Layer liegen vor unteren. Das Auge blendet einen Layer aus; das Schloss schützt vor Bearbeitung.',
  'Pixel & Farbe':
    'Wähle eine Farbe oder gib RRGGBBAA ein: die letzten zwei Stellen bestimmen die Deckkraft. Die Pipette übernimmt die Originalfarbe eines sichtbaren Referenzpixels, sonst die Rasterfarbe. Ein Klick übernimmt; Escape bricht ab.',
  Auswahl:
    'Ziehe ein Rechteck oder setze Polygonpunkte. Enter oder ein Klick auf den Startpunkt schließt das Polygon; Escape bricht ab. Verschieben und Strecken bearbeiten die gewählten Pixel im aktiven Layer.',
  Vorlagen:
    'Markiere Pixel und wähle „Auswahl als Vorlage speichern“. Vorlagen lassen sich an einer gewünschten Position und Größe einsetzen.',
  Referenz:
    'Lade ein eigenes Bild oder eine Fino-Referenz über Vorlagen. Wähle den Referenzeintrag und „Layer greifen“, um sie zu verschieben. Mit dem Auge blendest du sie aus. Sie wird nie in den PNG-Export aufgenommen.',
  Timeline:
    'Jeder Frame ist ein Animationsbild mit eigener Dauer. Plus fügt einen leeren Frame hinzu, Duplizieren kopiert den aktuellen. Abspielen zeigt die Frames nacheinander. Ein einzelner verbleibender Frame kann nicht gelöscht werden.',
  Dateien:
    'Rasteranimationen bleiben beim Wechsel zur Editor-Auswahl erhalten. „Sitzung lokal sichern“ speichert sie auf diesem Gerät. Verbinde einen Hauptordner, um .raster128.json-Dateien direkt aus Unterordnern zu öffnen und dort zu speichern. Der PNG-Export enthält den aktuellen Frame in 1024×1024, ohne Referenzbild.',
  Tastaturkürzel:
    'Strg+Z: Rückgängig. Strg+Y oder Strg+Umschalt+Z: Wiederholen. Enter bestätigt Dialoge und schließt Polygone. Escape bricht Dialoge, Pipette und laufende Auswahl ab. Mausrad zoomt unter dem Cursor; zwei Finger zoomen und verschieben die Ansicht.',
} as const;
export type HelpTopic = keyof typeof help;
