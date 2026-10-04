import { blankLayer, bounds, brushBounds, capture, contains, key, line, point, rectMask, referenceSample, sample, sourceLayers, transform } from './raster';
import type { Frame, Layer, PixelAsset, Pixels, Point, Rect, Reference, SourceId, Viewport } from './raster';
import { canonicalMetadata, newDocumentMetadata, parseDocumentMetadata } from './document';
import type { DocumentMetadata } from './document';
import { NATIVE_POSES, poseReference } from './nativePoses';
import type { NativePoseId } from './nativePoses';
import { bakeNativeFace, changeNativeSlot, defaultNativeFace, isNativeFaceLayer, nativeSlotForLayer, parseNativeFace, retargetNativeFace } from './nativeFaces';
import type { FaceSlot, NativeFace, NativeFaceSlot } from './nativeFaces';
import { applyRasterOperation, changeRasterRecipe, createRasterRecipe, parseRasterOperation, parseRasterRecipe, replayRasterRecipe, sameRasterPixels } from './rasterOperations';
import type { RasterOperation } from './rasterOperations';

export type Tool = 'pencil' | 'eraser' | 'eyedropper' | 'rect' | 'polygon' | 'pan' | 'grab';
type Snapshot = {
  metadata: DocumentMetadata;
  frames: readonly Frame[];
  index: number;
  name: string;
  source: SourceId;
  reference: Reference | null;
  active: string;
};
type SavedContent = Pick<Snapshot, 'frames' | 'name' | 'source' | 'reference' | 'metadata'> & {
  templates: PixelAsset[];
  faces: PixelAsset[];
  sessionId: number;
};
export class AnimationStore {
  state: Snapshot = {
    metadata: newDocumentMetadata(),
    frames: [{ layers: sourceLayers('fino-standing-neutral-128'), duration: 400, pose: poseReference('fino-standing-neutral-128') }],
    index: 0,
    name: 'Neue Rasteranimation',
    source: 'fino-standing-neutral-128',
    reference: null,
    active: 'native-pose',
  };
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  selection: ReadonlySet<number> | null = null;
  templates: PixelAsset[] = [];
  faces: PixelAsset[] = [];
  color = 0xff3366ff;
  pencilSize = 1;
  eraserSize = 1;
  tool: Tool = 'rect';
  previousTool: Tool = 'pencil';
  referenceSelected = false;
  playing = false;
  selectedFaceSlot: FaceSlot = 'leftEye';
  preserveFaceOnSource = false;
  setPreserveFaceOnSource(value: boolean) { this.preserveFaceOnSource = value; this.emit(); }
  private facePreview?: { base: Frame; session: number; face: NativeFace; frame: Frame };
  get faceDraft() {
    const draft = this.facePreview;
    if (draft && (draft.base !== this.frame || draft.session !== this.sessionId || this.playing)) this.facePreview = undefined;
    return this.facePreview;
  }
  get displayFrame() { return this.faceDraft?.frame ?? this.frame; }
  beginFacePreview() {
    if (this.playing || !this.frame.pose) return false;
    const pose = NATIVE_POSES.find((p) => p.id === this.frame.pose!.poseId)!;
    if (!this.frame.nativeFace && (this.frame.pose.assetVersion !== pose.assetVersion || this.frame.pose.pixelSha256 !== pose.pixelSha256))
      throw Error('Historische Grundpose: Face-Aktivierung benötigt den passenden nativen Katalog.');
    const face = this.frame.nativeFace ?? defaultNativeFace(this.frame.pose.poseId);
    const frame = bakeNativeFace(this.frame, face);
    this.facePreview = { base: this.frame, session: this.sessionId, face, frame };
    this.emit();
    return true;
  }
  selectFaceSlot(slot: FaceSlot) { this.selectedFaceSlot = slot; this.emit(); }
  previewFaceSlot(slot: FaceSlot, patch: Partial<NativeFaceSlot>) {
    const draft = this.faceDraft;
    if (!draft) return false;
    const face = changeNativeSlot(draft.face, slot, patch);
    this.facePreview = { ...draft, face, frame: bakeNativeFace(draft.base, face) };
    this.emit();
    return true;
  }
  cancelFacePreview() { this.facePreview = undefined; this.emit(); }
  commitFacePreview() {
    const draft = this.faceDraft;
    if (!draft) return false;
    this.facePreview = undefined;
    const before = draft.base, after = draft.frame;
    if (before.nativeFace && canonicalMetadata(before.nativeFace) === canonicalMetadata(after.nativeFace) &&
      before.layers.length === after.layers.length && before.layers.every((l, i) => {
        const next = after.layers[i]!;
        return l.id === next.id && l.name === next.name && l.visible === next.visible && l.locked === next.locked &&
          l.faceId === next.faceId && l.pixels.size === next.pixels.size && [...l.pixels].every(([k, v]) => next.pixels.get(k) === v);
      })) { this.emit(); return true; }
    this.editFrame(draft.frame);
    return true;
  }
  /** Inclusive explicit frame range; one history entry, unchanged other frames. */
  retargetFacePose(poseId: NativePoseId, first: number, last: number, preserve = true) {
    const pose = NATIVE_POSES.find((p) => p.id === poseId);
    if (!pose || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= this.state.frames.length)
      throw Error('Ungültiger Retargeting-Bereich.');
    const frames = this.state.frames.map((frame, i) => {
      if (i < first || i > last) return frame;
      if (!frame.pose) throw Error('Retargeting benötigt native Grundposen in allen gewählten Frames.');
      const face = frame.nativeFace ? retargetNativeFace(frame.nativeFace, poseId, preserve) : defaultNativeFace(poseId);
      return bakeNativeFace({ ...frame, pose: poseReference(pose.sourceId) }, face, true);
    });
    this.facePreview = undefined;
    this.commit({ ...this.state, frames, source: this.state.index >= first && this.state.index <= last ? pose.sourceId : this.state.source });
  }
  // Transient persistence coordination; never part of content/history or portable documents.
  localPersistence: { key: string; status: 'saving' | 'saved' | 'updated' | 'conflict' | 'failed'; error?: string } | null = null;
  get persistenceUnsaved() { return this.localPersistence !== null && ['saving', 'conflict', 'failed'].includes(this.localPersistence.status); }
  private sessionId = 0;
  private playbackDocument = {};
  capturePlaybackDocument() {
    return this.playbackDocument;
  }
  private savedContent = this.captureContent();
  captureContent(): SavedContent {
    const { frames, name, source, reference, metadata } = this.state;
    return { frames, name, source, reference, metadata, templates: this.templates, faces: this.faces, sessionId: this.sessionId };
  }
  isCurrentSession(content: SavedContent) {
    return content.sessionId === this.sessionId;
  }
  get dirty() {
    const saved = this.savedContent;
    return this.state.frames !== saved.frames || this.state.name !== saved.name ||
      this.state.source !== saved.source || this.reference !== saved.reference ||
      this.templates !== saved.templates || this.faces !== saved.faces || this.state.metadata !== saved.metadata;
  }
  markSaved(content: SavedContent) {
    if (!this.isCurrentSession(content)) return false;
    this.savedContent = content;
    this.emit();
    return true;
  }
  resetSavedContent() {
    this.facePreview = undefined;
    this.playbackDocument = {};
    this.sessionId++;
    this.localPersistence = null;
    this.savedContent = this.captureContent();
  }
  version = 0;
  viewport?: Viewport;
  commits = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
  get frame() {
    return this.state.frames[this.state.index]!;
  }
  get layer() {
    return this.frame.layers.find((l) => l.id === this.state.active);
  }
  get editable() {
    const l = this.layer;
    return l && !l.locked && l.visible && !l.faceId && !this.playing ? l : undefined;
  }
  get reference() {
    return this.state.reference;
  }
  get brushSize() {
    return this.tool === 'eraser' ? this.eraserSize : this.pencilSize;
  }
  commit(next: Snapshot) {
    if (next === this.state) return;
    this.facePreview = undefined;
    this.pause(false);
    this.past = [...this.past.slice(-99), this.state];
    this.future = [];
    this.state = next;
    this.commits++;
    this.emit();
  }
  editFrame(frame: Frame) {
    this.commit({
      ...this.state,
      frames: this.state.frames.map((f, i) => (i === this.state.index ? frame : f)),
    });
  }
  setDocumentMetadata(value: DocumentMetadata) {
    const metadata = parseDocumentMetadata(value);
    if (canonicalMetadata(metadata) === canonicalMetadata(this.state.metadata)) return;
    this.commit({ ...this.state, metadata });
  }
  pixels(layer: Layer, pixels: Pixels) {
    if (!this.frame.layers.includes(layer) || layer.locked || layer.faceId) return;
    if (pixels.size === layer.pixels.size && [...pixels].every(([k, v]) => layer.pixels.get(k) === v)) return;
    this.editFrame({
      ...this.frame,
      layers: this.frame.layers.map((l) => (l === layer ? { ...l, pixels, recipe: undefined } : l)),
    });
  }
  applyNativeOperation(value: RasterOperation, record = false) {
    const layer = this.editable;
    if (!layer) return false;
    const operation = parseRasterOperation(value);
    const recipe = record ? layer.recipe ? parseRasterRecipe({ ...layer.recipe, operations: [...layer.recipe.operations, operation] }) :
      createRasterRecipe(layer.pixels, [operation]) : undefined;
    const pixels = recipe ? replayRasterRecipe(recipe) : applyRasterOperation(layer.pixels, operation);
    if (!recipe && sameRasterPixels(layer.pixels, pixels)) return false;
    this.editFrame({ ...this.frame, layers: this.frame.layers.map((l) => l === layer ? { ...l, pixels, recipe } : l) });
    return true;
  }
  changeNativeOperation(operationId: string, replacement: RasterOperation | null) {
    const layer = this.editable;
    if (!layer?.recipe) return false;
    const recipe = changeRasterRecipe(layer.recipe, operationId, replacement), pixels = replayRasterRecipe(recipe);
    if (canonicalMetadata(recipe.operations) === canonicalMetadata(layer.recipe.operations)) return true;
    this.editFrame({ ...this.frame, layers: this.frame.layers.map((l) => l === layer ? { ...l, pixels, recipe } : l) });
    return true;
  }
  bakeNativeRecipe() {
    const layer = this.editable;
    if (!layer?.recipe) return false;
    this.editFrame({ ...this.frame, layers: this.frame.layers.map((l) => l === layer ? { ...l, recipe: undefined } : l) });
    return true;
  }
  undo() {
    const previous = this.past.at(-1);
    if (!previous) return;
    this.facePreview = undefined;
    this.pause(false);
    this.future.push(this.state);
    this.state = previous;
    this.past = this.past.slice(0, -1);
    this.selection = null;
    this.emit();
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.facePreview = undefined;
    this.pause(false);
    this.past.push(this.state);
    this.state = next;
    this.selection = null;
    this.emit();
  }
  selectTool(tool: Tool) {
    if (tool === 'eyedropper' && this.tool !== tool) this.previousTool = this.tool;
    this.tool = tool;
    this.emit();
  }
  cancelPicker() {
    if (this.tool === 'eyedropper') this.selectTool(this.previousTool);
  }
  pick(p: Point) {
    if (!contains(p.x, p.y)) return;
    this.color = referenceSample(this.reference, p) ?? sample(this.frame.layers, key(p));
    this.cancelPicker();
  }
  selectLayer(id: string) {
    this.state = { ...this.state, active: id };
    this.referenceSelected = false;
    this.emit();
  }
  setSelection(mask: ReadonlySet<number> | null) {
    this.selection = mask;
    this.emit();
  }
  addLayer() {
    const layer = blankLayer();
    this.commit({
      ...this.state,
      active: layer.id,
      frames: this.state.frames.map((f, i) =>
        i === this.state.index ? { ...f, layers: [...f.layers, layer] } : f
      ),
    });
    this.referenceSelected = false;
  }
  editLayer(id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked'>>) {
    const slot = nativeSlotForLayer(this.frame.layers.find((l) => l.id === id)), face = this.frame.nativeFace;
    const nativeFace = slot && face && patch.visible !== undefined ? parseNativeFace({ ...face,
      slots: { ...face.slots, [slot]: { ...face.slots[slot], visible: patch.visible } } }) : face;
    this.editFrame({
      ...this.frame,
      ...(nativeFace ? { nativeFace } : {}),
      layers: this.frame.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  }
  removeLayer(id: string) {
    const layers = this.frame.layers.filter((l) => l.id !== id);
    const slot = nativeSlotForLayer(this.frame.layers.find((l) => l.id === id)), face = this.frame.nativeFace;
    const nativeFace = slot && face ? parseNativeFace({ ...face, slots: { ...face.slots, [slot]: { ...face.slots[slot], visible: false } } }) : face;
    this.editFrame({ ...this.frame, layers, ...(nativeFace ? { nativeFace } : {}) });
    if (this.state.active === id) this.selectLayer(layers[0]?.id ?? '');
  }
  reorder(id: string, delta: number) {
    const layers = [...this.frame.layers],
      from = layers.findIndex((l) => l.id === id),
      to = Math.max(0, Math.min(layers.length - 1, from + delta));
    if (from < 0 || from === to) return;
    layers.splice(to, 0, layers.splice(from, 1)[0]!);
    this.editFrame({ ...this.frame, layers });
  }
  setReference(reference: Reference | null) {
    this.commit({ ...this.state, reference });
    this.referenceSelected = reference !== null;
  }
  source(source: SourceId) {
    const target = poseReference(source);
    if (this.preserveFaceOnSource && this.frame.nativeFace && target) {
      this.retargetFacePose(target.poseId, this.state.index, this.state.index);
      return;
    }
    const frames = this.state.frames.map((f, index) => {
      if (index !== this.state.index) return f;
      const retained = f.layers.filter((l) => l.id !== 'native-pose' && !l.faceId && !isNativeFaceLayer(l));
      const layers = [
        ...(source === 'empty' ? [] : sourceLayers(source).filter((l) => l.id === 'native-pose')),
        ...retained,
      ];
      if (!layers.some((l) => !l.locked && !l.faceId)) layers.push(blankLayer('pixels-1'));
      return { ...f, layers, pose: poseReference(source), nativeFace: undefined };
    });
    this.commit({
      ...this.state,
      source,
      frames,
      active: frames[this.state.index]!.layers.find((l) => !l.locked)!.id,
    });
    this.selection = null;
  }
  newAnimation(name: string, source: SourceId, copy: boolean) {
    this.playbackDocument = {};
    this.sessionId++;
    this.localPersistence = null;
    this.commit({
      ...this.state,
      metadata: newDocumentMetadata(),
      name,
      source: copy ? this.state.source : source,
      frames: [{ layers: copy ? this.frame.layers : sourceLayers(source), duration: 400,
        pose: copy ? this.frame.pose : poseReference(source), ...(copy && this.frame.nativeFace ? { nativeFace: this.frame.nativeFace } : {}) }],
      index: 0,
      active: copy ? this.state.active : sourceLayers(source).find((l) => !l.locked)!.id,
    });
    this.selection = null;
  }
  frameAt(index: number) {
    if (index < 0 || index >= this.state.frames.length) return;
    this.pause(false);
    this.showFrame(index);
  }
  private showFrame(index: number) {
    this.facePreview = undefined;
    this.state = { ...this.state, index };
    this.selection = null;
    if (!this.layer)
      this.state = { ...this.state, active: this.frame.layers.find((l) => !l.faceId)?.id ?? '' };
    this.emit();
  }
  addFrame(duplicate = false) {
    const frames = [...this.state.frames];
    frames.splice(
      this.state.index + 1,
      0,
      duplicate
        ? this.frame
        : {
            duration: 400,
            layers: this.frame.layers.map((l) => (l.faceId ? l : { ...l, pixels: new Map(), recipe: undefined })),
          }
    );
    this.commit({ ...this.state, frames, index: this.state.index + 1 });
    this.selection = null;
  }
  addPoseFrame() {
    const pose = poseReference(this.state.source);
    if (!pose) return false;
    const layers = sourceLayers(this.state.source), frames = [...this.state.frames];
    frames.splice(this.state.index + 1, 0, { duration: 400, layers, pose });
    this.commit({ ...this.state, frames, index: this.state.index + 1, active: layers[0]!.id });
    this.selection = null;
    this.referenceSelected = false;
    return true;
  }
  deleteFrame() {
    if (this.state.frames.length <= 1) return;
    const frames = this.state.frames.filter((_, i) => i !== this.state.index);
    this.commit({ ...this.state, frames, index: Math.min(this.state.index, frames.length - 1) });
  }
  duration(duration: number) {
    if (Number.isInteger(duration) && duration > 0) this.editFrame({ ...this.frame, duration });
  }
  play() {
    if (this.playing) return;
    this.facePreview = undefined;
    this.playing = true;
    this.emit();
    this.schedule();
  }
  private schedule() {
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      this.showFrame((this.state.index + 1) % this.state.frames.length);
      this.schedule();
    }, this.frame.duration);
  }
  pause(notify = true) {
    clearTimeout(this.timer);
    const was = this.playing;
    this.playing = false;
    if (notify && was) this.emit();
  }
  saveAsset(name: string, face: boolean): PixelAsset | null {
    if (!this.editable || !name.trim()) return null;
    const extracted = capture(this.editable.pixels, this.selection);
    if (!extracted) return null;
    const collection = face ? this.faces : this.templates;
    const base = name.trim();
    let unique = base,
      n = 2;
    while (collection.some((t) => t.name === unique)) unique = `${base} (${n++})`;
    const asset = { id: crypto.randomUUID(), name: unique, ...extracted };
    if (face) this.faces = [...this.faces, asset];
    else this.templates = [...this.templates, asset];
    this.emit();
    return asset;
  }
  renameAsset(id: string, name: string, face = false) {
    const collection = face ? this.faces : this.templates;
    if (!name.trim() || !collection.some((asset) => asset.id === id && asset.name !== name)) return;
    const next = collection.map((asset) => asset.id === id ? { ...asset, name } : asset);
    if (face) this.faces = next;
    else this.templates = next;
    this.emit();
  }
  deleteAsset(id: string, face = false) {
    const collection = face ? this.faces : this.templates;
    if (!collection.some((asset) => asset.id === id)) return;
    if (face) this.faces = collection.filter((asset) => asset.id !== id);
    else this.templates = collection.filter((asset) => asset.id !== id);
    this.emit();
  }
  useFace(asset: PixelAsset) {
    if (this.frame.layers.some((l) => l.faceId === asset.id)) return;
    this.editFrame({
      ...this.frame,
      layers: [
        ...this.frame.layers.filter((l) => !l.faceId),
        {
          ...blankLayer(`face-${asset.id}`, asset.name),
          pixels: asset.pixels,
          faceId: asset.id,
          locked: true,
        },
      ],
    });
  }
  insert(asset: PixelAsset, to: Rect) {
    const l = this.editable;
    if (!l || to.width < 1 || to.height < 1 || to.width > 128 || to.height > 128) return;
    const p = new Map(l.pixels);
    for (const [k, v] of transform(asset.pixels, null, to)) p.set(k, v);
    this.pixels(l, p);
    this.setSelection(rectMask(to, { x: to.x + to.width - 1, y: to.y + to.height - 1 }));
  }
  move(dx: number, dy: number) {
    if (!dx && !dy) return;
    const l = this.editable,
      source = l && capture(l.pixels, this.selection);
    if (!l || !source) return;
    const before = this.state;
    this.pixels(
      l,
      transform(l.pixels, this.selection, {
        ...source.bounds,
        x: source.bounds.x + dx,
        y: source.bounds.y + dy,
      })
    );
    if (this.state === before) return;
    if (this.selection)
      this.setSelection(
        new Set(
          [...this.selection]
            .map((k) => point(k))
            .filter((p) => contains(p.x + dx, p.y + dy))
            .map((p) => (p.y + dy) * 128 + p.x + dx)
        )
      );
  }
  stretch(dx: number, dy: number) {
    const l = this.editable,
      source = l && capture(l.pixels, this.selection);
    if (!l || !source) return;
    const to = {
      ...source.bounds,
      width: Math.max(1, Math.min(128, source.bounds.width + dx)),
      height: Math.max(1, Math.min(128, source.bounds.height + dy)),
    };
    this.pixels(l, transform(l.pixels, this.selection, to));
    if (this.selection) {
      const next = new Set<number>();
      for (let y = 0; y < to.height; y++)
        for (let x = 0; x < to.width; x++) {
          const sx = source.bounds.x + Math.floor((x * source.bounds.width) / to.width),
            sy = source.bounds.y + Math.floor((y * source.bounds.height) / to.height);
          if (contains(to.x + x, to.y + y) && source.pixels.has(sy * 128 + sx))
            next.add((to.y + y) * 128 + to.x + x);
        }
      this.setSelection(next);
    }
  }
  selectionBounds() {
    return this.selection ? bounds(this.selection) : null;
  }
}

/** Gesture-local immutable baseline; UI pointer moves never notify the store. */
export class Stroke {
  readonly layer: Layer;
  readonly pixels: Map<number, number>;
  private last: Point;
  private readonly color: number;
  private readonly size: number;
  private readonly selection: ReadonlySet<number> | null;
  constructor(
    readonly store: AnimationStore,
    p: Point,
    readonly erase: boolean
  ) {
    if (!store.editable) throw Error('Layer ist nicht bearbeitbar.');
    this.layer = store.editable;
    this.pixels = new Map(this.layer.pixels);
    this.last = p;
    this.color = store.color;
    this.size = erase ? store.eraserSize : store.pencilSize;
    this.selection = store.selection;
    this.move(p);
  }
  move(p: Point) {
    for (const cell of line(this.last, p)) {
      const b = brushBounds(cell, this.size);
      for (let y = b.y; y < b.y + b.height; y++)
        for (let x = b.x; x < b.x + b.width; x++) {
          const k = y * 128 + x;
          if (!contains(x, y) || (this.selection && !this.selection.has(k))) continue;
          if (this.erase) this.pixels.delete(k);
          else this.pixels.set(k, this.color);
        }
    }
    this.last = p;
  }
  commit() {
    if (this.store.editable === this.layer) this.store.pixels(this.layer, this.pixels);
  }
}

export const animationStore = new AnimationStore();
