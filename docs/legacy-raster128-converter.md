# Isolierter Legacy-Rasterkonverter (Schritt 5)

API: `convertLegacyArchive(archive, resources, inventory)` in
`src/animation/migration/legacyConverter.ts`. Keine Store-Mutation, Dateispeicherung,
IndexedDB, Netzwerkanfrage, UI, globaler Rendercache oder automatische Migration.
Das Originalarchiv aus Schritt 2 wird nicht geändert oder ersetzt.

## Freigabe und Eingangsbindung

Der Konverter verlangt ein Definitionsarchiv mit vollständig freigegebenem Audit,
verifizierten Ressourcen und freigegebenen Renderframes. Er verifiziert die
Original-JSON-SHA-256, Inventaridentität, Archiv-ID und Ressourcenliste. Eingebettete
Payloads werden gegen ihre Hashes geprüft; widersprüchliche externe Ressourcen
werden abgelehnt, nicht durch eingebettete Bytes still korrigiert. Ein vollständig
eingebettetes Archiv kann ohne externe Ressourcen konvertiert werden.

Danach wird der vorhandene Prüfer auf dem Original und demselben Ressourcen-
Snapshot erneut ausgeführt. Sein gesamter Bericht muss mit dem Archivbericht
übereinstimmen. Neu aufgetretene Warnungen, Fehler, unbekannte Operationen, Assets,
Kontexte oder fehlende Ressourcen blockieren. Auch ein manuell behaupteter
Freigabestatus und neu berechnete Archiv-ID umgehen den Prüfer nicht.

Archiv, Inventar und alle Ressourcenbytes werden vor dem ersten Await kopiert.
Aufruferänderungen während der Konvertierung beeinflussen den Snapshot nicht.
Alle Fehler liefern eine `LegacyConversionBlockedError` mit `route: 'blockiert'`,
Fehlercode und gegebenenfalls aktuellem Audit. Bei Blockade wird kein Teilergebnis
oder Zieldokument zurückgegeben.

## Algorithmus

Jeder originale Frame wird unverändert mit dem aktuellen Legacy-Renderer,
verifiziertem Rig und eindeutigem `addonRoot` in 1024×1024 gerendert. Operations,
Addons und Face-Rig wirken vor der Reduktion. Aufgelöste implizite Layer werden
nicht künstlich eingesetzt: Das könnte transparente RGB-Werte verändern.
Rendergröße und RGBA-Hash müssen zum geprüften Originalframe passen; jede Warnung,
Exception oder Renderabweichung blockiert auch nach erfolgreicher erneuter Prüfung.

Für Zielpixel `(x, y)` wird exakt Quellpixel `(8x, 8y)` übernommen (Phase 0/0,
links oben). Dies ist deterministische Nearest-Neighbor-Abtastung ohne Mittelwert,
Palette, Alpha-Quantisierung, Farbkorrektur oder Antialiasing.

- **Gerastert exakt:** sämtliche 64 vollständigen RGBA-Werte jedes Quellblocks
  sind gleich. Auch RGB bei Alpha 0 wird verglichen. Der vorhandene 8×-Export
  muss denselben SHA-256 wie das Originalbild ergeben.
- **Gerastert verlustbehaftet:** mindestens ein Block unterscheidet sich. Kleine
  Details können je nach Position verschwinden; es gibt keine Behauptung einer
  strukturell editierbaren Legacy-Migration.
- **Blockiert:** fehlende Freigabe/Integrität, Rendererwarnung/-fehler, Drift,
  fehlende Ressource oder mehrdeutiger Kontext. Keine implizite Erfolgsannahme.

Genau ein normaler, sichtbarer und ungesperrter Raster-Pixellayer entsteht je
Frame. Pixelkeys bleiben Integer 0–16383, Werte unsigned RGBA. Nur der Wert 0
wird aus der sparsamen Pixelmap weggelassen; transparentes RGB bleibt erhalten.
Frame-Reihenfolge und `durationMs` bleiben erhalten (Raster-Feld `duration`).
Gesamtstatus ist verlustbehaftet, sobald mindestens ein Frame verlustbehaftet ist.
Alle Raster-Rückexporte bestehen ausschließlich aus homogenen 8×8-Blöcken.

## Ergebnis und Hashvertrag

Ergebnis: V2-`document`, dessen JSON, `report` und `previews` mit Original-1024er
und Ziel-128er RGBA-Bytes je Frame. Das Zieldokument verwendet `source: 'empty'`,
eine neue UUID, Herkunft mit Dateiname/Speicherkey, Original-Definitionshash und
Archiv-ID sowie ursprünglichen Format-/Rig-/Pose-/Addon-Kontext. `reactionState`
wird als String übernommen; null/fehlend bleiben im Archiv und Bericht erkennbar.

Bericht: Algorithmus/Phase, Quellen- und Ressourcenhashes, aufgelöster Kontext,
Original-ID, Reaction-Präsenz, pro Frame Dauer, Index, Exact/Lossy, Zahl inhomogener
Blöcke und SHA-256 von Original-RGBA, Raster-RGBA und 1024er Rückexport.
`conversionSha256` ist SHA-256 des kanonischen vollständigen Berichts ohne dieses
Hashfeld. Die neue UUID ist ausdrücklich nicht Bestandteil: Wiederholte
Konvertierung erzeugt gleiche Pixel/Hashes, aber getrennte Dokumentidentitäten.
Bytehashes verwenden RGBA-Kanalreihenfolge, keine plattformabhängige Uint32-Byteorder.
Es entstehen keine Zeitstempel oder zufälligen Einflussgrößen in den Hashes.
Der Kontextblock übernimmt Rig-/Addon-Auflösung, keine Kopie sämtlicher Legacy-
Pixelarrays oder Operations. Vollständige aufgelöste Frames stehen bereits im
Archiv-Audit und sind über dessen ID gebunden; der Raster-Bericht bleibt Metadaten.

Das Zieldokument wird durch `parseRasterDocument` geprüft. Dies ist der aus dem
bestehenden Restore-Pfad freigestellte reine Parser, keine zweite Formatquelle
und kein temporärer Editor-Store. Restore und portabler Import verwenden ihn
weiterhin unverändert für Validierung und anschließende Session-Übernahme.

## Bewusste Grenzen vor weiteren Schritten

`scope: 'rendered-animation'`: getrennte Legacy-Layer, Face-Rig und Operations
bleiben als editierbare Originalstruktur im Archiv; im Ziel sind sie gebacken.
Die Vorlagenbibliothek wird nicht in native Collections konvertiert. Sie bleibt
mit Originaltext, Hash und Eintragszahl ausdrücklich `archived-only`. Die
Ziel-Collections sind leer; dies wird **nicht** als migrierte leere Bibliothek
ausgegeben. Dieser Frame-Konverter ist kein Kriterium zur Legacy-Entfernung.
Das Originalarchiv muss vor späterer Benutzerübernahme dauerhaft abgelegt werden.

Es gibt noch keine Nutzerfreigabe verlustbehafteter Übernahme, Preview-UI,
automatische lokale Migration oder Massenmigration. Der Aufrufer verantwortet
Archivablage und Lebensdauer der Preview-Bytes. Vorschauen benötigen rund 4,26 MB
pro Frame; große Projekte erfordern später eine gesteuerte Speicherstrategie.

## Referenzvalidierung

`tests/legacyConverter.test.ts`: eine synthetische Zweiframe-Fixture, die 24
Pose-/Rig-Dart-Referenzen, alle 23 Kontextfälle aus Schritt 1, Operationen, Addons,
Exact-Low-Alpha, transparente RGB-Blöcke, Einpixeldetails, Blockgrenzen,
gemischter Status, stabile Hashes, neue IDs, Archiv-/Ressourcenintegrität,
Rendererwarnung/-fehler/Drift, Snapshotisolation, Archivbibliothek, V2-Parser und
Roundtrip. Ein unabhängiger RGBA-Byte-Oracle prüft die 128er Abtastung.
Die 24 unabhängigen Legacy-Goldens bleiben erhalten; 15 Demo-Frame-Goldens
wurden entfernt. Renderer und native Raster-Goldens bleiben unverändert.
