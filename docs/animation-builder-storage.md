# Raster128-Storage und Projektordner

## Projektordner auf dem Datenträger

Die File System Access API verbindet einen Hauptordner in unterstützten Browsern/Desktop-WebViews.
Alle Unterordner werden angezeigt; `.raster128.json`-Dateien sind direkt öffnbare Leaf-Einträge.
Andere Dateien werden ausgeblendet. Namen stammen ausschließlich vom Dateisystem.

Klick auf einen Ordner öffnet ein Flyout rechts neben dem Eintrag, etwas nach rechts und unten versetzt.
Weitere Ebenen kaskadieren; ein anderer Ordner derselben Ebene ersetzt die tieferen Flyouts.
Escape und Klick außerhalb schließen die Kette. Am rechten Rand wird nach links geöffnet;
Positionen werden an den Viewport angepasst und lange Menüs sind scrollbar.
Touch verwendet dieselben Klickziele. Eine Größenänderung schließt die alte Kette.

„Projekt hier speichern …“ schreibt in den jeweiligen geöffneten Ordner; im Hauptpanel in den Hauptordner.
Bestehende Dateinamen erfordern eine Ersetzen-Bestätigung. „Projektdatei speichern“ schreibt die zuvor
geöffnete/gespeicherte Datei. Nach Neu/Import/Laden verfällt dieses Schreibziel.
Der gespeicherte Snapshot wird erst nach erfolgreichem Write/Close als gesichert markiert;
Änderungen während des Schreibens bleiben ungespeichert. Fehler werden in der Statusleiste angezeigt.

IndexedDB `northcore-raster128-directory`, Store `handles`, enthält nur den strukturiert geklonten Hauptordner-Handle.
Es wird kein Baum gespeichert. Falls Handle-Persistenz nicht funktioniert, bleibt die Verbindung für diese Sitzung nutzbar.
Beim Neustart wird `queryPermission` geprüft, ohne automatisch um Berechtigung zu bitten.
„Ordnerzugriff erlauben“ erneuert sie durch eine explizite Nutzeraktion. Öffnen eines Ordners,
Aktualisieren, Fensterfokus, pageshow und Sichtbarwerden lesen den Datenträger erneut.
Es gibt keinen Dateisystem-Watcher; externe Änderungen erscheinen bei dieser Aktualisierung.

## Lokale Dokumente und Vorlagen

Die lokale Sitzungspersistenz nutzt weiterhin `northcore-animation-builder`, Store `sessions`,
mit Revision-Sidecars und Compare-and-Swap gegen konkurrierende Tabs.
Schema 3 baut ausschließlich den abgeleiteten Store `builder_metadata` neu auf: Raster-Dokumente
und globale Pixelbibliothek, mit `kind` und `detailsKnown` als Indizes.
Es gibt keine Legacy-Migrationsstores oder -indizes. Beim Schemawechsel werden die ausschließlich
dafür verwendeten `__migration_v1:*`-Datensätze, die alte `__legacy_templates`-Bibliothek,
`.finoanim.json`-Originale und deren Revision-Sidecars entfernt. Native Raster-Dokumente und die
globale Raster-Pixelbibliothek bleiben bytegleich erhalten.

Globale Vorlagen sind unabhängig vom Dokument und werden separat automatisch gesichert.
Datei-Import/-Export, lokale Dokumente und PNG-Export bleiben auch ohne File System Access API nutzbar.
Android verwendet die vorhandene native Datei-Abstraktion; Ordnerbindung steht dort erst bereit,
wenn die Plattform einen geeigneten Directory-Picker anbietet.
