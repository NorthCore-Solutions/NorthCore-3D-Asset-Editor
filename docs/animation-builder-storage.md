# Builder-Storage: Katalog und Lazy Loading

## Modell und Sicherheit

IndexedDB `northcore-animation-builder`, Version **2**:

- `sessions`: unveränderte Stringpayloads und bestehende `__builder_revision_v1:`-Sidecars.
- `builder_metadata`, Primary Key `key`: Datensatzart, bekannte IDs/Quelle/Status,
  optional Bibliotheksindikator und Quellhash. Keine Originaltexte, Ressourcen oder Pixel.
  Kleine Journale besitzen zusätzlich eine begrenzte Verwaltungszusammenfassung.
- Compound-Indizes `[kind, key]` und `[kind, field, key]` für Status, Source-Key,
  Source-Hash/-Identität, Archive-ID, Target-ID und `detailsKnown`.

Payload, Revision, Write-ID und Metadaten werden in derselben Readwrite-Transaktion
geschrieben. CAS vergleicht weiterhin die vollständige erwartete Basis.
Metadatenfehler/Quota brechen die gesamte Transaktion ab. Löschen entfernt den
Katalogeintrag; Revisionstombstones bleiben erhalten. Archive/Blobs bleiben
unveränderlich und dedupliziert. Journalphasen, Retry und Sessionguards bleiben erhalten.
Der Katalog ist eine abgeleitete Übersicht, keine neue Formatquelle oder Saved-Basis.

`SessionStorage.run(callback, keys, documentId?)` verlangt im nativen Adapter
explizite Keys. Der Callback bleibt synchron. Änderungen außerhalb des Bereichs
werden abgelehnt; ID-sensitive Publikation prüft den Dokumentindex in derselben
Transaktion. Schmale In-Memory-Testadapter können weiterhin die bisherige
Map-Schnittstelle verwenden; ihr Fallback ist kein nativer Produktionsscan.

## Upgrade und historische Daten

Das Versionchange-Upgrade erzeugt Schema und Katalog **atomar**. Ein Keycursor
liest die vorhandenen Keys; nur Journale werden als kleine Verwaltungsdatensätze
gelesen. Archivmanifest, Ressourcenblobs, Dokumentpixel, Legacy-Original-JSON und
Bibliotheken werden nicht gelesen, geändert oder gelöscht. Abbruch lässt Version 1
vollständig bestehen; der nächste Versuch kann neu beginnen.

Historische Raster-IDs bleiben zunächst unbekannt. Vor einer neuen ID-sensitiven
Migration trägt `ensureDocumentCatalog()` sie in begrenzten Batches von 25 nach.
Diese einmalige Prüfung muss die alten Dokumente lesen, um ID-Kollisionen weiterhin
zuverlässig auszuschließen. Bereits indizierte Dokumente werden nicht erneut geladen.
Ein CAS-artiger Bytevergleich schützt jeden abgeleiteten Nachtrag vor Rennen.

Historische Legacy-Quell-/Bibliothekshashes werden bei gewähltem Laden beziehungsweise
Migration nachgetragen. Die Verwaltung zeigt ungeprüfte Quellen weiterhin an;
fehlende Hashes gelten niemals als Beweis einer abgeschlossenen Migration.
Historische Archive ohne Bibliotheksindikator erscheinen als ungeprüfte Kandidaten.
Erst ihre gewählte Detailprüfung bestimmt diese Daten. Originalbytes bleiben erhalten.
V1/V2-Rasterparser und Bibliotheksformat bleiben unverändert.

Verbindungen schließen nach ihrer Transaktion und bei `versionchange`. Ein altes
offenes Fenster kann das Upgrade vorübergehend blockieren; die Fehlermeldung fordert
Schließen/Retry. Verwaiste Open-Requests schließen nach späterer Freigabe ihre Verbindung.
Eine feste Version-1-App erhält nach Upgrade `VersionError` statt die neuen Daten
anzufassen. Es werden keine persistenten Locks verwendet.

## Abfragen und Oberflächen

`query({kind, after?, limit?, ...filters})` liefert `{items, next?}` ohne Payloads.
50 ist Standard, 100 Maximum. `after` ist der letzte untersuchte Key; Sortierung
ist IndexedDB-Key-Reihenfolge. Jeder Zugriff liest maximal einen Batch plus einen
kleinen Lookahead. Auch der leere String ist ein gültiger Fortsetzungstoken.
Mehrfachfilter nutzen einen passenden Index und prüfen verbleibende Felder im Batch;
leere Ergebnisse können deshalb `next` besitzen. Pagination ist eine aktuelle Sicht,
kein Snapshot über mehrere Transaktionen; bei externen Änderungen wird neu abgefragt.

Dokumentliste, Legacy-Verwaltung und Bibliotheksarchiv-Picker besitzen schlanke
„mehr laden“-Aktionen. Journale können nach Status gefiltert werden. Quellidentität,
Source-Key/-Hash, Archiv-ID und Ziel-ID sind über dieselbe API gezielt auffindbar.
Initialer Leave-Status prüft nur offene Statusindizes, nicht sämtliche Journale/Archive.
Die Wiederverwendung vorhandener Migrationen filtert Journalmetadaten nach Quellhash,
Konverterversion und bekannten Semantikhashes, bevor sie passende Archive lädt.
Historische Journale ohne diese Hashes benötigen weiterhin die vollständige Integritätsprüfung.

`readKeys()` liest genau die angegebenen Payloads. `head()` liest Existenz via
`getKey` und die Revision in einer gemeinsamen Readonly-Transaktion. Externe
Dokument-/Bibliothekshinweise laden somit keine Pixel-/Bibliotheksdaten. Öffnen,
Export, Audit und Resume laden und validieren ihre tatsächlichen Inhalte weiterhin.
Die globale Bibliothek wird erst beim Öffnen des Vorlagen-Tabs oder bei einer
expliziten Bibliotheksaktion geladen; die Dateienansicht lädt ihren Payload nicht.
Original-JSON-Export liest ein Manifest ohne Ressourcen; vollständiger Archivexport
lädt nur dessen deduplizierte Blob-Referenzen inklusive originalem Inventar.

## Reproduzierbarer Nachweis

`tests/storageCatalog.test.ts` prüft Zusammenfassungen, Hashes und Filter.
`tests/browser/storage-catalog.spec.ts` verwendet echtes Chromium-IndexedDB mit
320 großen Dokumenten, 600 Journalen, 180 großen Archiven und vier Ressourcenreferenzen
auf zwei identische/deduplizierte 512-KiB-Payloads, plus dem Inventarblob.
Der geprüfte Bestand umfasst 1.106 Payloaddatensätze mit rund 120 Millionen
Textzeichen; die initiale Listenabfrage liest keinen großen Payload.
Es instrumentiert IDB-Reads und verbietet Payloadcursor/`getAll` während der Prüfung.
Der Test hängt `storage-read-budget.json` mit Records und Payloadgröße an den Bericht.

| Zugriff | Große Payload-Reads | Strukturelles Budget |
| --- | --- | --- |
| Upgrade + erste Dokumentseite | 0 | Keycursor, 600 kleine Journale, bis 51 Metadaten für 50 Ergebnisse |
| Folgeseite / Statusfilter | 0 | höchstens 51 Metadaten |
| Quelle / Ziel / Archiv-Lookups gemeinsam | 0 | 5 passende Metadaten |
| Existenz-/Revisionshinweis | 0 | Sidecar + `getKey` |
| Ein historisches Archiv vollständig | nur dieses Archiv | Manifest + einmaliger konsistenter Nachtrag; genau 3 deduplizierte Blobs |
| Original-JSON-Export | ein Manifest | keine Ressourcenblobs |

Weitere Browserfälle prüfen leere/kleine DB, lückenfreie Pagination, UI-Pagination,
V1-Load/V2-Save, bestehende globale Bibliothek, Upgrade-Abbruch/Neustart, blockiertes
Upgrade, ID-Kollisionen, Metadaten-Quota-Rollback und Cross-Tab-CAS. Bestehende
Migrations-, Archiv-, Dirty- und Browserregressionen bleiben die fachlichen Nachweise.
Keine absolute Millisekundengrenze entscheidet über Erfolg.

Aufruf: `npx playwright test tests/browser/storage-catalog.spec.ts`. Für einen
maschinenlesbaren Bericht einschließlich Anhang `--reporter=json` ergänzen.

## Verbleibende Grenzen

Einmaliges Upgrade bleibt O(Anzahl Keys + kleine Journale), mit atomarer Sperre.
Die historische ID-Nachprüfung bleibt einmalig O(unindizierte Dokumente), bewusst
erst bei einer Migration. Große explizite Exporte/Konvertierungen benötigen ihren
Payload im Speicher. Die globale Bibliothek bleibt ein gemeinsamer JSON-Datensatz;
ihre fachliche Ladung und Backup/Write materialisieren den vollständigen Inhalt.
Ein Archivmanifest enthält weiterhin seine Originaltexte. Die Umwandlung dieser
Formate in Streaming-/Einzeltemplate-Payloads ist kein Bestandteil dieser Änderung.
