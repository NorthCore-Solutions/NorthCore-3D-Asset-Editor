# Native Raster128 Operations / Replay V1

`rasterOperations.ts` implements pure operations on ordinary 128×128 RGBA maps.
No Legacy import, renderer, palette, alpha blending, float coordinates or 1024
runtime algorithms. Existing `transform()`, selection gestures and nudge/stretch
tools retain their previous behavior. Operations act on the explicitly active,
editable layer; other layers/frames remain unchanged.

## Operation semantics

Every operation has stable `id`, `version:1`, explicit integer parameters and type:

- `moveRegion`: rectangular source, dx/dy; vacated area transparent.
- `moveSelection`: rectangle, polygon or captured exact cell selection; dx/dy and
  `transparent`, `restoreOriginal` or `extendSelectionEdge` fill.
- `stretchSelection`: mask, sx/sy (size deltas), explicit scope.

Masks include empty/transparent cells. Copying such cells clears their destination;
stored zero-alpha RGB and partial alpha values are otherwise copied literally.
`restoreOriginal` retains the pre-operation vacated pixels (copy behavior), never
loads a pose/catalog. Edge extension fills only vacated mask cells from the
opposite contiguous selection edge; symmetric nearest-integer rays define
diagonal behavior. All writes clip to 128×128; source coordinate checks prevent
negative/out-of-grid coordinates from aliasing a different row.

Stretch scopes:

- `mask`: nearest-neighbor maps selected cells to the resized bounds; holes are
  preserved, source cells removed, other pixels outside the affected mask untouched.
  A single native pixel can explicitly grow; dimensions must remain positive.
- `boundsLocal`: ignores polygon interior, stretches the bounds, fills a contraction
  with the old edge and writes only the old/new bounds footprint. X then Y;
  the Y pass includes X expansion.
- `bounds`: affects the rectangular stripe through the trailing canvas edge on
  expansion. On contraction, the original far tail is retained; only the vacated
  end inside the original bounds is pulled forward. X then Y using original bounds.

The latter two are the confirmed Legacy scope use cases expressed on a native
128 grid, with `abs(delta) < axis length`. Polygon bounds include the final vertex
coordinate (`max-min+1`) explicitly. Mask coverage uses existing integer raster
polygon rules; arbitrary canvas selections can persist as sorted cell keys.

## Recipe and lifecycle

An optional `Layer.recipe` contains `version:1`, an inline immutable native pixel
snapshot `base:{id,pixels:[[key,rgba],...]}` and ordered versioned operations.
The ID identifies this captured basis; it has no dependency on today's pose assets
or on another document/frame. Duplicated frames may reference the same immutable
recipe in memory; modifying one creates a new layer/frame. Embedded bases make
files portable, with increased JSON size as the deliberate initial tradeoff.

Removal/replacement always replays the entire list from that base. It never applies
an approximate inverse. Store API: `applyNativeOperation(op, record)`,
`changeNativeOperation(id, replacement|null)`, `bakeNativeRecipe()`. Each effective
action is one existing history entry. An unchanged replacement is a no-op.
Removing every operation leaves the original base with an empty recipe.

Normal pixel editing, old tools and explicit pose/face replacement detach the
affected recipe while retaining their normal pixel result. Undo restores it.
Blank new frames remain blank and recipe-free; duplicating preserves replay.
Recipe-only changes are persistent content and remain dirty during older saves;
selection, navigation, Inspector fields and playback remain UI states.

New JSON saves/portable `.raster128.json` use the same Raster V2 format. No IndexedDB
bump. The parser and serializer validate recipe/operation versions, unique IDs,
integer geometry/RGBA, immutable base and exact sparse-map equality between replay
and stored pixels. A mismatch rejects the document before Store mutation (or Save).
Loading keeps authoritative saved maps; renderer/sample/8× export stay unchanged.
Old V1/V2 and baked Legacy/Face files without recipes remain compatible.

Inspector integration uses numeric rectangle fields, polygon points, or an exact
snapshot of the current selection. Replay recording is optional. The recipe list
allows editing/removal/baking; an edit form captures frame index/list, layer and
session so a later frame/document switch cannot submit stale edits into another
frame, including duplicates that share the same Frame object.

## Legacy mapping boundary

`migration/legacyOperations.ts` prepares mappings from successfully audited data
and the confirmed inventory. Unknown types/fields/strategies/scopes are blocked.
Supply the original audited operation fields; implicit defaults resolve from the
inventory, rather than from extra internal fields of a normalized audit object.
Parameters are never rounded. A candidate needs aligned geometry/deltas before
lossless unit conversion is even considered. Polygon movement only considers
grid-aligned orthogonal edges; polygon stretches with inclusive 1024 bounds remain
baked. Diagonal masks, subpixel movement/stretch and nonrepresentable contexts
stay `baked-not-replayable`, never a zero-delta replacement.

Actual replayability further requires an explicitly identified native basis and
**every original Legacy RGBA intermediate**, including the pre-operation image.
Each must byte-match the normal 8× native export. A merely equal final image does
not prove the effects of removable middle operations. Even aligned rectangle
stretches often fail because fine-grid NN boundaries cut 8×8 blocks. Unknown or
missing proofs never return a recipe. Proof RGBA is transient and not persisted.

The existing converter continues baking every original frame. Its report now
explicitly records operation types and `baked-not-replayable`; it does not attach
recipes or change source pixels/timing. The breathing animation's 1–2 Legacy-pixel
stretch therefore stays explicitly baked. No automatic replacement, parameter
rounding or local user-data rewrite occurs. Later migration orchestration must
collect authenticated/audited intermediate proofs before adopting a native recipe.

## Files / validation / remaining scope

New: `rasterOperations.ts`, `RasterOperationsInspector.tsx`,
`migration/legacyOperations.ts`, `tests/rasterOperations.test.ts`,
`tests/browser/raster-operations.spec.ts`, this specification.
Integrated: `raster.ts`, `store.ts`, `files.ts`, `nativeFaces.ts`,
`AnimationBuilder.tsx`, `migration/legacyConverter.ts`,
`tests/animationPersistence.test.ts`, `tests/legacyConverter.test.ts`.

Focused tests cover all fills/scopes, masks, clipping/alpha/holes, sequential replay,
middle removal/replacement, history, source isolation, V1/V2/portable roundtrip,
save races, real Legacy-image prefix proofs, breathing/subpixel rejection, original
goldens/local migration and homogeneous export. Browser tests cover application,
editing/removal, history, file roundtrip and stale forms. Existing Face/touch tests
remain the gesture oracle; Canvas architecture is unchanged.

Before step 11: automatic proof capture/native-recipe adoption, authenticated
archive context integration, optional base deduplication/file-size optimization,
and any broader multi-layer operation workflow need separate decisions. The Legacy
authoring editor has been removed; its import compatibility layer remains. No
unsupported operation is silently discarded.
