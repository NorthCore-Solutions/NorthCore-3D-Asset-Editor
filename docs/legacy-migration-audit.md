# Legacy-Migrationsprüfung und Originalarchiv (Schritt 2)

API: `src/animation/migration/legacyAudit.ts`. Keine UI-Anbindung, Store-Mutation,
IndexedDB-/Dateioperation, Netzwerkanfrage oder Raster-Konvertierung. Aufrufer
liefern das Inventar aus Schritt 1, Originaltexte und Ressourcen ausdrücklich.
Der Inventarimport im Modul ist ausschließlich ein TypeScript-Typimport.

## Eingänge und Funktionen

`LegacyInput` enthält Original-Definitions-JSON und/oder Bibliotheks-JSON,
`source: { kind: 'file' | 'local', name }` und optional den Addon-Kontext.
`ResourceSet` ordnet Repositorypfade Originalstrings oder Bytes zu. Auch bei
fehlenden/ungültigen Ressourcen können Bericht und Originalarchiv erzeugt werden.

- `inspectLegacy(input, resources, inventory)`: vollständiger Einzelbericht.
- `inspectLocalLegacyDefinitions(entries, resources, inventory, contexts)`:
  deterministisch sortierte Prüfung der bekannten lokalen `.finoanim.json`-Keys,
  einschließlich vorhandener `__legacy_templates`. Liest selbst keine Datenbank.
- `createLegacyOriginalArchive(input, resources, inventory, includeAssetBytes?)`:
  geprüftes, tief eingefrorenes Archivobjekt im Speicher; keine Schreiboperation.
- `sha256` und `canonicalJson`: SHA-256 bzw. kanonische Metadatenrepräsentation.

Alle Eingänge werden vor dem ersten asynchronen Schritt kopiert. Texte bleiben
unverändert; Ressourcenbytes werden nicht an den Aufrufer zurückgereicht.
Der Aufrufer ist für die spätere persistente Archivablage verantwortlich.

## Ergebnisvertrag

`LegacyAudit` enthält Inventarprüfsumme, Herkunft, Issues, Komponenten mit
Inventarkategorie 1–4, Übernahmeweg/Aktion und `requiresExtension`, verifizierte
Ressourcenreferenzen, aufgelöste Defaults und Frame-Messungen.

`complete` bedeutet vollständig verstanden/geprüft, **nicht** migriert.
`migrationPerformed` bleibt immer false. Die vier Übernahmewege sind:

| Weg | Bedeutung |
| --- | --- |
| editierbar | direkte Metadatenübernahme oder konservativ nachgewiesene vollständige native Pixelblöcke; `requiresExtension` bleibt gesondert sichtbar |
| gerastert exakt | fertiges 1024er Renderbild hat ausschließlich homogene 8×8-RGBA-Blöcke; keine Zusage über strukturelle Editierbarkeit |
| gerastert verlustbehaftet | Bild enthält Subrasterdetails oder Inhalt erfüllt die editierbare Übernahmebedingung nicht |
| blockiert | unbekannt, ungültig, mehrdeutig, Ressource fehlt/weicht ab oder Renderer warnt/scheitert |

Die Pixelbearbeitbarkeitsprüfung ist bewusst konservativ: vollständige gleichfarbige
8×8-Blöcke, keine mehrfachen Koordinaten/transparenten Pixel, passende Grenzen und
Vorlagenursprünge. Sie erzeugt keine 128er Pixelmap und ist keine Konvertierung.
Ein nicht nachgewiesener editierbarer Weg kann später genauer bewertet werden.

Frames werden mit dem bestehenden Legacy-Renderer und ausschließlich injizierten,
prüfsummenverifizierten Ressourcen untersucht. Gemessen werden unterschiedliche
8×8-Blöcke und der SHA-256 des unveränderten RGBA-Ergebnisses. Der Renderer und
die bisherigen Goldens bleiben unverändert. Jede Warnung und Exception blockiert;
bei bereits blockierter Eingangsprüfung findet keine Renderprüfung statt.

Explizite Defaults stehen getrennt vom Original: Rig V1 bei fehlender Angabe,
implizite Basis-/Face-Layer, Sichtbarkeit/Sperre, Addon-Offsets, Move-Strategie und
Stretch-Bereich. Der Renderer erhält weiterhin die Originaldefinition, denn das
Materialisieren impliziter Layer könnte transparente RGB-Werte verändern.

## Kontext und blockierende Fälle

Mit verwendeten Addons ist ein eindeutiger, inventarisierter `addonRoot` nötig.
Fehlender oder mehrfach möglicher Kontext blockiert. Kandidaten und mögliche
Addon-Ressourcen werden trotzdem erfasst. Ohne Addons gilt fehlender Kontext als
unbenutzt; es wird kein ursprünglicher Root behauptet. Unbekannte explizite Roots
werden auch dann gemeldet. Rig-Version und Definitionsversion bleiben unabhängig.

Blockierend sind insbesondere unbekannte Felder (auch verschachtelt), Operations,
Masken, Strategien, Stretch-Bereiche, Layerarten, Versionen und Assetzustände;
ungültige Werte/Geometrie/Bibliothek; fehlende oder geänderte Ressourcen;
mehrdeutiger Addon-Kontext sowie Renderer-Warnungen/-Fehler. Auch verborgene
Face-Zustände werden erfasst. Die gesamte gewählte Rig-Familie bleibt referenziert,
einschließlich momentan unbenutzter Varianten, sowie Basis und Presetdaten.

Das Inventar benennt nun ausdrücklich die bekannten Definitionsversionen 1/2 und
Bibliotheksversion 1. Der bestehende permissive Parser wird dadurch nicht verändert.
Diese Prüfung ist strenger: akzeptierte Originale können blockiert bleiben, wenn
ihre Semantik nicht im überprüften Bestand belegt ist. Rohdaten werden erhalten.

## Archivvertrag

`OriginalArchive` enthält:

- Version und deterministische, inhaltsgebundene `archiveId`.
- Unveränderte Original-JSON-Texte samt SHA-256 ihrer UTF-8-Bytes; fehlende
  Definition/Bibliothek bleibt null. Keine Normalisierung von Whitespace/Zeilenenden.
- Ursprünglichen Dateinamen/Speicherkey und unverändert gelieferten Kontext.
- Ressourcenpfade, Rollen, Kategorien, erwartete/tatsächliche Prüfsummen und Status.
- Originale Rig-/Preset-JSON-Ressourcen als Text oder als Originalbytearray.
- Den vollständigen Bericht einschließlich Blockaden und Mehrdeutigkeiten.

Standardmäßig werden PNGs als verifizierte Referenzen erfasst. Mit
`includeAssetBytes=true` werden alle vorhandenen benötigten Ressourcen eingebettet,
auch binäre Assets; das ergibt die für eine unabhängige Ablage benötigten Payloads.
Die referenzbasierte Variante allein ersetzt keine dauerhafte Asset-Sicherung.
Fehlende Ressourcen bleiben sichtbar und können nicht durch das Archiv geheilt
werden. Bei blockierten Originalen wird kein Erfolg vorgetäuscht.

Die ID bindet Originale, Herkunft, Kontext, Inventar und Bericht einschließlich der
Ressourcen-Digests. Payload-Einbettung ändert die ID nicht; deren Bytes sind über
den tatsächlichen Ressourcendigest gebunden. Kein Timestamp und kein zufälliger ID-
Generator. Kanonisierung gilt nur für Metadaten, niemals für Original-JSON.

## Validierung und verbleibende Grenzen

```sh
npx vitest run tests/legacyAudit.test.ts tests/legacyMigrationInventory.test.ts tests/animationLegacy.test.ts
npx tsc -p tsconfig.app.json --noEmit
npx eslint src/animation/migration/legacyAudit.ts tests/legacyAudit.test.ts
```

Tests prüfen beide Rigs, Samples, Defaults, alle Kontextfamilien, unbekannte/
fehlerhafte Daten, Ressourcen, Bibliotheken, exakte vs. verlustbehaftete Frames,
Warnungen, lokale Discovery, deterministische Hashes, Archiv-Payloads, wiederholte
Ergebnisse und unveränderte Eingänge. Inventardrift und Dart-Goldens bleiben aktiv.

Private Bestände und externe Consumer werden nicht automatisch entdeckt. Unbekannte
Assets/Versionen brauchen eine Inventarerweiterung und Prüfung, keine Heuristik.
Der Prüfer kann nicht rekonstruieren, welche nicht gespeicherte Addon-Familie früher
gewählt war. Native Raster-Erweiterungen und eine eigentliche Konvertierung bleiben
spätere Schritte. Das Modul ist noch nicht im App-Laufzeitpfad eingebunden.
