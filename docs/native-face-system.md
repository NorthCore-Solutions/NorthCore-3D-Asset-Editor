# Native Raster128 faces · catalog/presets 1

Each V2 frame may contain `nativeFace`: catalog/preset version, native pose ID,
family (`native`, `legacy-v1`, `legacy-v2`) and three slots (`leftEye`,
`rightEye`, `mouth`). A slot records variant, visibility, integer x/y and integer
width/height. Optional Legacy origin distinguishes rig version, original-pose
versus face-free source, and explicit native-preset placement. Frames still store
the authoritative ordinary RGBA pixelmaps; loading never regenerates them.
Old V1/V2 and already baked Legacy migrations require no new fields or conversion.

## Authoring and assets

`scripts/author-native-faces.py` reuses the native polygon recipe before facial
features are painted. It removes eye/mouth/lip areas and glints, retaining muzzle,
fur, nose and silhouette. It neither reads Legacy PNGs nor downsamples references.
All six independent face-free maps are 128×128. The standing-neutral original is
untouched. Five eye, five native/V2 mouth and five separately authored V1-compatible
mouth maps have exact opaque RGBA and transparent gaps, with pinned pixel hashes
in `data/faces/catalog.json`. Versions must advance when published pixels or
anchors change; historical pixelmaps remain readable.

Presets follow native head geometry: neutral/active/eating use the anchor,
sitting translates (+2,+20), reading (0,+15), sleeping (+22,+70) with closed eyes
by default. Eyes are 4×4, native/V2 mouths 8×4, V1-compatible mouths 10×6 with a
different anchor. These are native artistic replacements, not reduced Legacy rigs.
The contact sheet shows the face-free bases and freshly baked native defaults.

## Baking, history and interaction

First activation removes only matching catalog face pixels from the editable
base; independent artwork and altered base pixels are retained. Slots bake into
three ordinary locked pixel layers directly above the base and below user artwork.
`nativeFaceSlot` marks generated layers explicitly; imported user-layer IDs that
look like generated IDs are retained, and generated IDs resolve collisions.
Scaling uses integer nearest neighbor, clips outside the 128 grid and copies RGBA
literally. `sample()`, rendering, export and compositing are unchanged. Whole-face
document assets continue using the existing normal pixel-overlay path.

Inspector preview is transient; the confirmed document, baseline and history do
not change until **Gesicht übernehmen**. The exact preview frame becomes the
committed frame in one history entry. Save during preview saves confirmed content.
Cancel, Escape, frame/document changes, history actions and playback discard the
draft. Canvas grips have a 44 CSS-pixel diameter, pick the nearest slot, and use
rounded logical deltas for both mouse/touch. Pointer cancellation/pinch takeover
restores the pre-drag slot; pan and wheel/pinch transforms remain the existing ones.

Retargeting explicitly selects current/all/inclusive frame range. It replaces the
chosen native base(s), reanchors using the target preset, optionally retains
variants, visibility and slot dimensions, and commits once. Unselected frames,
durations and independent artwork are retained. Mixed ranges containing empty or
non-native frames fail before mutation. The toolbar preserve-face option only
affects the current frame; normal source changes and blank-frame creation retain
their previous semantics. Original freehand modifications to a pose base are
replaced on explicit pose retarget, as with a normal pose replacement.

Manual pixel/layer edits remain authoritative. Reopening slot editing proposes a
freshly baked slot preview from metadata; it is applied only by explicit commit.
Unknown historical catalog versions can be viewed/exported but are not silently
rebaked with today's catalog. First activation of historical pose assets likewise
requires the matching asset version/hash.

## Compatibility boundary / next step

`migration/legacyFaces.ts`: `mapLegacyFace()` accepts separately validated V1/V2 states and returns a native
preset proposal, retaining explicit original-base context and different mouth
families. `mapLegacyAddons()` maps combined eyes to two independent slots and mouths
to the mouth slot, requires a known addonRoot, and rejects unknown states/context.
Both report **lossy + requiresApproval**: original geometry, source assets,
calibration and offsets stay in the migration archive. Neither replaces the exact
Legacy-to-raster converter or claims pixel-equivalent retargeting. No migration UI
automatically applies these proposals. Custom native preset
authoring and automatic conversion of old baked frames remain later work. Native operations/replay are implemented independently.

Validation: pinned asset hashes/dimensions/RGBA, six poses/all states, integer
scaling/clipping, preview/commit/history, explicit multi-frame retarget, isolated
artwork, historical/current JSON roundtrip, save race and homogeneous 8× export;
browser mouse/touch drag, zoom/pan, cancel, Undo/Redo, visibility, backup import and
blocked Legacy resource requests. Android hardware gesture testing remains useful.

## Files for this step

- `src/animation/nativeFaces.ts`: catalog access, validation, pixel baking,
  retargeting. Compatibility proposals live in `migration/legacyFaces.ts`.
- `src/animation/NativeFaceInspector.tsx`: preview, slot fields, commit and range UI.
- `src/animation/nativePoses.ts`, `raster.ts`, `store.ts`, `files.ts`: face-free
  references, frame/layer metadata, transient draft/history lifecycle and V2 files.
- `src/animation/RasterCanvas.tsx`, `AnimationBuilder.tsx`: mouse/touch grips,
  preview image, cancellation, targeted inspector integration and pose option.
- `src/animation/data/faces/`: six bases, fifteen slot assets and hash manifest.
- `scripts/author-native-faces.py`: deterministic offline authoring and optional sheet.
- `docs/native-face-system.md`, `docs/native-face-catalog.png`: contract/visual reference.
- `tests/nativeFaces.test.ts`, `tests/animationPersistence.test.ts`,
  `tests/browser/native-faces.spec.ts`: focused regression coverage.
