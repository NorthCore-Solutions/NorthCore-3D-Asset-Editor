import { blankLayer, bounds, brushBounds, capture, contains, key, line, point, rectMask, referenceSample, sample, sourceLayers, transform } from './raster';
import type { Frame, Layer, PixelAsset, Pixels, Point, Rect, Reference, SourceId, Viewport } from './raster';
import { canonicalMetadata, newDocumentMetadata, parseDocumentMetadata } from './document';
import type { DocumentMetadata } from './document';

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
  sessionId: number;
};
export class AnimationStore {
  state: Snapshot = {
    metadata: newDocumentMetadata(),
    frames: [{ layers: sourceLayers('empty'), duration: 400 }],
    index: 0,
    name: 'Neue Rasteranimation',
    source: 'empty',
    reference: null,
    active: 'pixels-1',
  };
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  selection: ReadonlySet<number> | null = null;
  templates: PixelAsset[] = [];
  color = 0xff3366ff;
  autoReferenceColor = false;
  pencilSize = 1;
  eraserSize = 1;
  tool: Tool = 'rect';
  previousTool: Tool = 'pencil';
  referenceSelected = false;
  playing = false;
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
    return { frames, name, source, reference, metadata, templates: this.templates, sessionId: this.sessionId };
  }
  isCurrentSession(content: SavedContent) {
    return content.sessionId === this.sessionId;
  }
  get dirty() {
    const saved = this.savedContent;
    return this.state.frames !== saved.frames || this.state.name !== saved.name ||
      this.state.source !== saved.source || this.reference !== saved.reference ||
      this.templates !== saved.templates || this.state.metadata !== saved.metadata;
  }
  markSaved(content: SavedContent) {
    if (!this.isCurrentSession(content)) return false;
    this.savedContent = content;
    this.emit();
    return true;
  }
  resetSavedContent() {
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
  get displayFrame() { return this.frame; }
  get frame() {
    return this.state.frames[this.state.index]!;
  }
  get layer() {
    return this.frame.layers.find((l) => l.id === this.state.active);
  }
  get editable() {
    const l = this.layer;
    return l && !l.locked && l.visible && !this.playing ? l : undefined;
  }
  get reference() {
    return this.state.reference;
  }
  get brushSize() {
    return this.tool === 'eraser' ? this.eraserSize : this.pencilSize;
  }
  commit(next: Snapshot) {
    if (next === this.state) return;
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
    if (!this.frame.layers.includes(layer) || layer.locked) return;
    if (pixels.size === layer.pixels.size && [...pixels].every(([k, v]) => layer.pixels.get(k) === v)) return;
    this.editFrame({
      ...this.frame,
      layers: this.frame.layers.map((l) => (l === layer ? { ...l, pixels } : l)),
    });
  }
  undo() {
    const previous = this.past.at(-1);
    if (!previous) return;
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
    this.editFrame({ ...this.frame, layers: this.frame.layers.map((l) => l.id === id ? { ...l, ...patch } : l) });
  }
  removeLayer(id: string) {
    const layers = this.frame.layers.filter((l) => l.id !== id);
    this.editFrame({ ...this.frame, layers });
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
    // Both neutral starts use the same transparent pixel geometry.
    this.commit({ ...this.state, source });
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
      frames: [{ layers: copy ? this.frame.layers : sourceLayers(source), duration: 400 }],
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
    this.state = { ...this.state, index };
    this.selection = null;
    if (!this.layer)
      this.state = { ...this.state, active: this.frame.layers.find((l) => !l.locked)?.id ?? '' };
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
            layers: this.frame.layers.map((l) => ({ ...l, pixels: new Map() })),
          }
    );
    this.commit({ ...this.state, frames, index: this.state.index + 1 });
    this.selection = null;
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
  saveAsset(name: string): PixelAsset | null {
    if (!this.editable || !name.trim()) return null;
    const extracted = capture(this.editable.pixels, this.selection);
    if (!extracted) return null;
    const collection = this.templates;
    const base = name.trim();
    let unique = base,
      n = 2;
    while (collection.some((t) => t.name === unique)) unique = `${base} (${n++})`;
    const asset = { id: crypto.randomUUID(), name: unique, ...extracted };
    this.templates = [...this.templates, asset];
    this.emit();
    return asset;
  }
  renameAsset(id: string, name: string) {
    const collection = this.templates;
    if (!name.trim() || !collection.some((asset) => asset.id === id && asset.name !== name)) return;
    const next = collection.map((asset) => asset.id === id ? { ...asset, name } : asset);
    this.templates = next;
    this.emit();
  }
  deleteAsset(id: string) {
    const collection = this.templates;
    if (!collection.some((asset) => asset.id === id)) return;
    this.templates = collection.filter((asset) => asset.id !== id);
    this.emit();
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
  private readonly reference: Reference | null;
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
    this.reference = !erase && store.autoReferenceColor && store.reference?.visible
      ? store.reference
      : null;
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
          else {
            const color = this.reference ? referenceSample(this.reference, { x, y }) : this.color;
            if (color !== null) this.pixels.set(k, color);
          }
        }
    }
    this.last = p;
  }
  commit() {
    if (this.store.editable === this.layer) this.store.pixels(this.layer, this.pixels);
  }
}

export const animationStore = new AnimationStore();
