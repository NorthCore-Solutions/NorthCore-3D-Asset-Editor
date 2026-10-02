import {
  blankLayer,
  bounds,
  brushBounds,
  capture,
  contains,
  key,
  line,
  point,
  rectMask,
  referenceSample,
  sample,
  sourceLayers,
  transform,
} from './raster';
import type { Frame, Layer, PixelAsset, Pixels, Point, Rect, Reference, SourceId, Viewport } from './raster';

export type Tool = 'pencil' | 'eraser' | 'eyedropper' | 'rect' | 'polygon' | 'pan' | 'grab';
type Snapshot = {
  frames: readonly Frame[];
  index: number;
  name: string;
  source: SourceId;
  reference: Reference | null;
  active: string;
};
export class AnimationStore {
  state: Snapshot = {
    frames: [{ layers: sourceLayers('fino-standing-neutral-128'), duration: 400 }],
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
  dirty = false;
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
    this.pause(false);
    this.past = [...this.past.slice(-99), this.state];
    this.future = [];
    this.state = next;
    this.dirty = true;
    this.commits++;
    this.emit();
  }
  editFrame(frame: Frame) {
    this.commit({
      ...this.state,
      frames: this.state.frames.map((f, i) => (i === this.state.index ? frame : f)),
    });
  }
  pixels(layer: Layer, pixels: Pixels) {
    if (!this.frame.layers.includes(layer) || layer.locked || layer.faceId) return;
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
    this.dirty = true;
    this.emit();
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.pause(false);
    this.past.push(this.state);
    this.state = next;
    this.selection = null;
    this.dirty = true;
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
    this.editFrame({
      ...this.frame,
      layers: this.frame.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
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
    const frames = this.state.frames.map((f) => {
      const retained = f.layers.filter((l) => l.id !== 'native-pose' && !l.faceId);
      const layers = [
        ...(source === 'empty' ? [] : sourceLayers(source).filter((l) => l.id === 'native-pose')),
        ...retained,
      ];
      if (!layers.some((l) => !l.locked && !l.faceId)) layers.push(blankLayer('pixels-1'));
      return { ...f, layers };
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
    this.commit({
      ...this.state,
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
            layers: this.frame.layers.map((l) => (l.faceId ? l : { ...l, pixels: new Map() })),
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
    this.dirty = true;
    this.emit();
    return asset;
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
