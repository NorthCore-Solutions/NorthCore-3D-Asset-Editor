import {
  PARTS,
  dartRound,
  loadLegacyAsset,
  loadRig,
  masked,
  presetFace,
  renderLegacy,
  rigElement,
} from './legacy';
import type {
  Definition,
  FaceElement,
  FacePart,
  LegacyFrame,
  LegacyImage,
  LegacyLayer,
  LegacyOp,
  LegacyScene,
  Mask,
  Pixel,
  Rig,
} from './legacy';
import presets from './data/legacy-presets.json';
import type { Tool } from './store';
import type { Point, Rect, Viewport } from './raster';
import { localSessions, saveLocalSession } from './files';
import { decodeTemplates, encodeTemplates } from './templateLibrary';
export type LegacyTemplate = {
  id: string;
  name: string;
  width: number;
  height: number;
  pixels: Pixel[];
  origin: Point;
};
const defaultLayers = (): LegacyLayer[] => [
  { id: 'base', name: 'Grundpose', kind: 'base', locked: true },
  ...PARTS.map((kind) => ({ id: kind, name: kind, kind })),
  { id: 'pixels-1', name: 'Pixel-Layer', kind: 'pixels', pixels: [] },
];
export class LegacyStore {
  definition: Definition = {
    version: 2,
    id: 'new_animation',
    name: 'Neue Animation',
    basePose: 'fino_standing_neutral.png',
    frames: [{ durationMs: 400, ops: [], layers: defaultLayers() }],
  };
  index = 0;
  active = 'pixels-1';
  facePart: FacePart | null = null;
  selection: Mask | null = null;
  color = 0x2d1b19ff;
  tool: Tool = 'rect';
  past: Definition[] = [];
  future: Definition[] = [];
  saved: Definition | null = this.definition;
  addonRoot = 'addons_normalized';
  rigs = new Map<number, Rig>();
  private library: LegacyTemplate[] = [];
  private libraryReady = false;
  get templates() {
    return this.library;
  }
  set templates(value: LegacyTemplate[]) {
    this.library = value;
    void saveLocalSession('__legacy_templates', encodeTemplates(value)).catch((e) => this.reportError(e));
  }
  image: LegacyImage | null = null;
  scene: LegacyScene | null = null;
  message = 'Bereit';
  playing = false;
  version = 0;
  viewport?: Viewport;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  private renderSerial = 0;
  private frameCache = new Map<
    LegacyFrame,
    { source: string; image: LegacyImage; scene: LegacyScene | null }
  >();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
  reportError(e: unknown) {
    this.message = e instanceof Error ? e.message : 'Aktion fehlgeschlagen.';
    this.emit();
  }
  clearSelection() {
    this.selection = null;
    this.emit();
  }
  setAddonRoot(root: string) {
    this.addonRoot = root;
    this.frameCache.clear();
    void this.render();
  }
  get frame() {
    return this.definition.frames[this.index]!;
  }
  get addonPreset() {
    return presets.addons[this.definition.basePose as keyof typeof presets.addons];
  }
  get layer() {
    return this.frame.layers?.find((l) => l.id === this.active);
  }
  get dirty() {
    return this.saved !== this.definition;
  }
  async initialize() {
    if (!this.rigs.size) {
      const [v1, v2] = await Promise.all([loadRig(1), loadRig(2)]);
      this.rigs.set(1, v1);
      this.rigs.set(2, v2);
    }
    if (!this.libraryReady) {
      this.libraryReady = true;
      try {
        const saved = (await localSessions()).get('__legacy_templates');
        if (saved) this.library = decodeTemplates(saved);
      } catch (e) {
        this.reportError(e);
      }
    }
    await this.render();
  }
  get rig() {
    return this.rigs.get(this.definition.faceRigVersion ?? 1);
  }
  async render() {
    const serial = ++this.renderSerial,
      frame = this.frame,
      source = `${this.definition.basePose}/${this.definition.faceRigVersion ?? 1}/${this.addonRoot}`;
    try {
      if (!this.rig) return;
      let cached = this.frameCache.get(frame);
      if (!cached || cached.source !== source) {
        let scene: LegacyScene | null = null;
        const image = await renderLegacy(
          this.definition,
          this.index,
          loadLegacyAsset,
          this.rig,
          this.addonRoot,
          (text) => {
            this.message = text;
          },
          (value) => {
            scene = value;
          }
        );
        cached = { image, scene, source };
        this.frameCache.set(frame, cached);
        if (this.frameCache.size > 8) this.frameCache.delete(this.frameCache.keys().next().value!);
      }
      if (serial !== this.renderSerial) return;
      this.image = cached.image;
      this.scene = cached.scene;
      this.emit();
    } catch (e) {
      if (serial === this.renderSerial) {
        this.message = e instanceof Error ? e.message : 'Rendern fehlgeschlagen';
        this.emit();
      }
    }
  }
  commit(definition: Definition) {
    if (this.definition === definition) return;
    this.pause(false);
    this.past = [...this.past.slice(-99), this.definition];
    this.future = [];
    this.definition = definition;
    this.index = Math.min(this.index, definition.frames.length - 1);
    this.emit();
    void this.render();
  }
  frameEdit(frame: LegacyFrame) {
    this.commit({
      ...this.definition,
      frames: this.definition.frames.map((f, i) => (i === this.index ? frame : f)),
    });
  }
  undo() {
    const d = this.past.pop();
    if (!d) return;
    this.pause(false);
    this.future.push(this.definition);
    this.definition = d;
    this.index = Math.min(this.index, d.frames.length - 1);
    this.emit();
    void this.render();
  }
  redo() {
    const d = this.future.pop();
    if (!d) return;
    this.past.push(this.definition);
    this.definition = d;
    this.index = Math.min(this.index, d.frames.length - 1);
    this.emit();
    void this.render();
  }
  load(d: Definition) {
    this.pause(false);
    this.definition = d;
    this.saved = d;
    this.past = [];
    this.future = [];
    this.index = 0;
    this.active = this.frame.layers?.find((l) => l.kind === 'pixels' && !l.locked)?.id ?? '';
    this.facePart = null;
    this.selection = null;
    this.frameCache.clear();
    this.emit();
    void this.render();
  }
  ensureLayers() {
    if (!this.frame.layers?.length) {
      this.active = 'pixels-1';
      this.frameEdit({ ...this.frame, layers: defaultLayers() });
    }
  }
  selectTool(tool: Tool) {
    this.tool = tool;
    if (tool === 'pencil' || tool === 'eraser') {
      this.ensureLayers();
      if (this.layer?.kind !== 'pixels')
        this.active = this.frame.layers?.find((l) => l.kind === 'pixels' && !l.locked)?.id ?? '';
    }
    this.emit();
  }
  addFrame(copy = false) {
    const frames = [...this.definition.frames];
    frames.splice(
      this.index + 1,
      0,
      copy ? this.frame : { durationMs: 400, ops: [], face: this.frame.face, layers: defaultLayers() }
    );
    this.commit({ ...this.definition, frames });
    this.index++;
    this.emit();
    void this.render();
  }
  deleteFrame() {
    if (this.definition.frames.length > 1)
      this.commit({ ...this.definition, frames: this.definition.frames.filter((_, i) => i !== this.index) });
  }
  selectFrame(i: number) {
    this.pause(false);
    this.index = i;
    this.selection = null;
    this.emit();
    void this.render();
  }
  play() {
    if (this.playing) return;
    this.playing = true;
    const next = () => {
      this.timer = setTimeout(() => {
        if (!this.playing) return;
        this.index = (this.index + 1) % this.definition.frames.length;
        this.emit();
        void this.render();
        next();
      }, this.frame.durationMs);
    };
    next();
    this.emit();
  }
  pause(notify = true) {
    clearTimeout(this.timer);
    this.playing = false;
    if (notify) this.emit();
  }
  newAnimation(name: string, pose: string, strategy: string) {
    const version =
      strategy === 'preset' ? 2 : strategy === 'copy' ? (this.definition.faceRigVersion ?? 1) : 1;
    const frame: LegacyFrame =
      strategy === 'copy'
        ? this.frame
        : {
            durationMs: 400,
            ops: [],
            layers: defaultLayers(),
            ...(strategy === 'preset' ? { face: presetFace(pose, version, this.rigs.get(version)!) } : {}),
          };
    this.load({
      version: 2,
      faceRigVersion: version,
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name,
      basePose: pose,
      frames: [frame],
    });
    this.saved = null;
  }
  source(pose: string) {
    const old = presets.addons[this.definition.basePose as keyof typeof presets.addons],
      next = presets.addons[pose as keyof typeof presets.addons];
    const frames = this.definition.frames.map((f) => {
      const retarget = (part: 'eyes' | 'mouth') => {
        const raw = f[part];
        if (!raw || !old || !next) return raw;
        const ref = typeof raw === 'string' ? { state: raw, dx: 0, dy: 0 } : raw;
        return {
          ...ref,
          dx: (ref.dx ?? 0) + next[part].dx - old[part].dx,
          dy: (ref.dy ?? 0) + next[part].dy - old[part].dy,
        };
      };
      return {
        ...f,
        face:
          f.face && this.rig
            ? presetFace(pose, this.definition.faceRigVersion ?? 1, this.rig, f.face)
            : f.face,
        eyes: retarget('eyes'),
        mouth: retarget('mouth'),
      };
    });
    this.frameCache.clear();
    this.commit({ ...this.definition, basePose: pose, frames });
  }
  applyPreset() {
    if (this.rig)
      this.frameEdit({
        ...this.frame,
        face: presetFace(
          this.definition.basePose,
          this.definition.faceRigVersion ?? 1,
          this.rig,
          this.frame.face
        ),
      });
  }
  ensureFaceRig() {
    if (this.frame.face || !this.rigs.get(2)) return;
    this.frameCache.clear();
    this.commit({
      ...this.definition,
      faceRigVersion: 2,
      frames: this.definition.frames.map((f, i) =>
        i === this.index
          ? {
              ...f,
              eyes: null,
              mouth: null,
              face: presetFace(this.definition.basePose, 2, this.rigs.get(2)!),
            }
          : f
      ),
    });
  }
  setFace(part: FacePart, patch: Partial<FaceElement>) {
    const current = this.frame.face?.[part];
    if (!current) return;
    if (patch.state && patch.state !== current.state && this.rig) {
      const a = rigElement(this.rig, part, current.state),
        b = rigElement(this.rig, part, patch.state);
      if (a && b)
        patch = {
          ...patch,
          width: Math.max(1, dartRound((b.width * current.width) / a.width)),
          height: Math.max(1, dartRound((b.height * current.width) / a.width)),
        };
    }
    if (Object.entries(patch).every(([k, v]) => current[k as keyof FaceElement] === v)) return;
    this.frameEdit({ ...this.frame, face: { ...this.frame.face, [part]: { ...current, ...patch } } });
  }
  addLayer() {
    const id = crypto.randomUUID();
    this.frameEdit({
      ...this.frame,
      layers: [
        ...(this.frame.layers ?? defaultLayers()),
        { id, name: 'Pixel-Layer', kind: 'pixels', pixels: [] },
      ],
    });
    this.active = id;
    this.emit();
  }
  layerEdit(id: string, patch: Partial<LegacyLayer>) {
    this.frameEdit({
      ...this.frame,
      layers: this.frame.layers?.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  }
  moveLayer(id: string, direction: number) {
    const layers = [...(this.frame.layers ?? [])],
      i = layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const to = Math.max(0, Math.min(layers.length - 1, i + direction));
    layers.splice(to, 0, layers.splice(i, 1)[0]!);
    this.frameEdit({ ...this.frame, layers });
  }
  operation(op: LegacyOp) {
    this.frameEdit({ ...this.frame, ops: [...this.frame.ops, op] });
  }
  capture(): { bounds: Rect; pixels: Pixel[] } | null {
    const layer = this.layer;
    if (layer?.kind !== 'pixels') return null;
    const pixels = (layer.pixels ?? []).filter((p) => !this.selection || masked(this.selection, p.x, p.y));
    if (!pixels.length) return null;
    const x = Math.min(...pixels.map((p) => p.x)),
      y = Math.min(...pixels.map((p) => p.y));
    return {
      pixels,
      bounds: {
        x,
        y,
        width: Math.max(...pixels.map((p) => p.x)) - x + 1,
        height: Math.max(...pixels.map((p) => p.y)) - y + 1,
      },
    };
  }
  saveTemplate(name: string) {
    const captured = this.capture();
    if (!captured) return;
    let unique = name,
      suffix = 2;
    while (this.templates.some((t) => t.name === unique)) unique = `${name} (${suffix++})`;
    this.templates = [
      ...this.templates,
      {
        id: crypto.randomUUID(),
        name: unique,
        width: captured.bounds.width,
        height: captured.bounds.height,
        origin: { x: captured.bounds.x, y: captured.bounds.y },
        pixels: captured.pixels.map((p) => ({
          ...p,
          x: p.x - captured.bounds.x,
          y: p.y - captured.bounds.y,
        })),
      },
    ];
    this.emit();
  }
  insert(template: LegacyTemplate, b: Rect) {
    const l = this.layer;
    if (!l || l.kind !== 'pixels' || l.locked) return;
    const pixels = new Map((l.pixels ?? []).map((p) => [p.y * 1024 + p.x, p]));
    const source = new Map(template.pixels.map((p) => [p.y * template.width + p.x, p.rgba]));
    for (let y = 0; y < b.height; y++)
      for (let x = 0; x < b.width; x++) {
        const value = source.get(
          Math.floor((y * template.height) / b.height) * template.width +
            Math.floor((x * template.width) / b.width)
        );
        if (value !== undefined && b.x + x >= 0 && b.y + y >= 0 && b.x + x < 1024 && b.y + y < 1024)
          pixels.set((b.y + y) * 1024 + b.x + x, { x: b.x + x, y: b.y + y, rgba: value });
      }
    this.layerEdit(l.id, { pixels: [...pixels.values()] });
    this.selection = { type: 'rect', ...b };
  }
  movePixels(dx: number, dy: number) {
    const l = this.layer;
    if (!l || l.kind !== 'pixels' || l.locked) return;
    const captured = this.capture();
    if (!captured) return;
    const moving = new Set(captured.pixels),
      next = (l.pixels ?? []).filter((p) => !moving.has(p));
    const targets = new Map(next.map((p) => [p.y * 1024 + p.x, p]));
    for (const p of captured.pixels)
      if (p.x + dx >= 0 && p.y + dy >= 0 && p.x + dx < 1024 && p.y + dy < 1024)
        targets.set((p.y + dy) * 1024 + p.x + dx, { ...p, x: p.x + dx, y: p.y + dy });
    this.layerEdit(l.id, { pixels: [...targets.values()] });
    if (this.selection) {
      if (this.selection.type === 'polygon')
        this.selection = { type: 'polygon', points: this.selection.points.map(([x, y]) => [x + dx, y + dy]) };
      else this.selection = { ...this.selection, x: this.selection.x + dx, y: this.selection.y + dy };
    }
  }
}
export const legacyStore = new LegacyStore();
