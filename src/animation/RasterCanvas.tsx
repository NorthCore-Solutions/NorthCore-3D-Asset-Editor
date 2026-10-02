import { useEffect, useRef } from 'react';
import { Stroke } from './store';
import type { AnimationStore } from './store';
import {
  SIZE,
  Viewport,
  bounds,
  brushBounds,
  contains,
  cssColor,
  key,
  point,
  polygonMask,
  rectMask,
  referenceSample,
  render,
  sample,
  shiftReference,
  transform,
} from './raster';
import type { Layer, Pixels, Point, Reference } from './raster';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export function RasterCanvas({ store }: { store: AnimationStore }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let width = 0,
      height = 0,
      initialized = !!store.viewport;
    let viewport = store.viewport ?? new Viewport(0, 0, 4);
    let hover: Point | null = null;
    let polygon: Point[] = [];
    let stroke: Stroke | null = null;
    let baseFrame = store.frame;
    let activeTool = store.tool,
      activeLayer = store.state.active;
    let dragging: {
      start: Point;
      screen: Point;
      layer?: Layer;
      pixels?: Pixels;
      reference?: Reference;
      selection: ReadonlySet<number> | null;
      pan: boolean;
      rect: boolean;
    } | null = null;
    const pointers = new Map<number, Point>();
    let pinch: { focal: Point; distance: number } | null = null;
    const frameCache = new WeakMap<object, HTMLCanvasElement>();
    const referenceCache = new WeakMap<Uint8Array, HTMLCanvasElement>();
    const makeImage = (data: Uint8Array, w: number, h: number) => {
      const image = document.createElement('canvas');
      image.width = w;
      image.height = h;
      image.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
      return image;
    };
    const frameImage = () => {
      let image = frameCache.get(store.frame);
      if (!image) {
        image = makeImage(render(store.frame.layers), SIZE, SIZE);
        frameCache.set(store.frame, image);
      }
      return image;
    };
    const refImage = (reference: Reference) => {
      let image = referenceCache.get(reference.rgba);
      if (!image) {
        image = makeImage(reference.rgba, reference.width, reference.height);
        referenceCache.set(reference.rgba, image);
      }
      return image;
    };
    const pointer = (event: PointerEvent | WheelEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const delta = () => {
      if (!dragging || !hover) return { x: 0, y: 0 };
      const p = viewport.logical(hover),
        dx = p.x - dragging.start.x,
        dy = p.y - dragging.start.y;
      return dragging.reference ? { x: dx, y: dy } : { x: Math.round(dx), y: Math.round(dy) };
    };
    const previewReference = () =>
      dragging?.reference ? shiftReference(dragging.reference, delta()) : store.reference;
    const checker = (v: Viewport) => {
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const e = v.edge({ x, y });
          if (e.x > width || e.y > height || e.x + v.cell < 0 || e.y + v.cell < 0) continue;
          ctx.fillStyle = (x + y) % 2 ? '#22262a' : '#3e4348';
          ctx.fillRect(e.x, e.y, v.cell, v.cell);
        }
    };
    const patchPixels = (layer: Layer, pixels: Pixels) => {
      const changed = new Set([...layer.pixels.keys(), ...pixels.keys()]);
      const layers = store.frame.layers.map((l) => (l === layer ? { ...l, pixels } : l));
      for (const k of changed) {
        if (layer.pixels.get(k) === pixels.get(k)) continue;
        const p = point(k),
          e = viewport.edge(p);
        ctx.fillStyle = (p.x + p.y) % 2 ? '#22262a' : '#3e4348';
        ctx.fillRect(e.x, e.y, viewport.cell, viewport.cell);
        ctx.fillStyle = cssColor(sample(layers, k));
        ctx.fillRect(e.x, e.y, viewport.cell, viewport.cell);
      }
    };
    const drawReference = (reference: Reference | null, v: Viewport, opacity: number) => {
      if (!reference?.visible) return;
      const { bounds: b } = reference,
        p = v.edge(b);
      ctx.globalAlpha = opacity;
      ctx.drawImage(refImage(reference), p.x, p.y, b.width * v.cell, b.height * v.cell);
      ctx.globalAlpha = 1;
    };
    const draw = () => {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#10171b';
      ctx.fillRect(0, 0, width, height);
      checker(viewport);
      ctx.save();
      ctx.beginPath();
      ctx.rect(viewport.x, viewport.y, SIZE * viewport.cell, SIZE * viewport.cell);
      ctx.clip();
      ctx.drawImage(frameImage(), viewport.x, viewport.y, SIZE * viewport.cell, SIZE * viewport.cell);
      if (stroke) patchPixels(stroke.layer, stroke.pixels);
      if (dragging?.layer && dragging.pixels) patchPixels(dragging.layer, dragging.pixels);
      drawReference(previewReference(), viewport, 0.4);
      ctx.restore();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#c5a3ff';
      const shift = delta();
      const selected =
        dragging?.rect && hover
          ? rectMask(dragging.start, viewport.pixel(hover))
          : dragging?.layer && dragging.selection
            ? new Set(
                [...dragging.selection]
                  .map(point)
                  .filter((p) => contains(p.x + shift.x, p.y + shift.y))
                  .map((p) => (p.y + shift.y) * SIZE + p.x + shift.x)
              )
            : store.selection;
      if (selected) {
        ctx.beginPath();
        for (const k of selected) {
          const p = point(k),
            e = viewport.edge(p),
            c = viewport.cell;
          if (!selected.has(k - SIZE)) {
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(e.x + c, e.y);
          }
          if (!selected.has(k + SIZE)) {
            ctx.moveTo(e.x, e.y + c);
            ctx.lineTo(e.x + c, e.y + c);
          }
          if (p.x === 0 || !selected.has(k - 1)) {
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(e.x, e.y + c);
          }
          if (p.x === 127 || !selected.has(k + 1)) {
            ctx.moveTo(e.x + c, e.y);
            ctx.lineTo(e.x + c, e.y + c);
          }
        }
        ctx.stroke();
      }
      if (polygon.length) {
        ctx.beginPath();
        polygon.forEach((p, i) => {
          const e = viewport.edge(p);
          if (!i) ctx.moveTo(e.x, e.y);
          else ctx.lineTo(e.x, e.y);
        });
        if (hover) ctx.lineTo(hover.x, hover.y);
        ctx.stroke();
      }
      if (!hover) return;
      const target = viewport.pixel(hover);
      if (!contains(target.x, target.y)) return;
      if (store.tool === 'pencil' || store.tool === 'eraser') {
        const b = brushBounds(target, store.brushSize),
          p = viewport.edge(b);
        ctx.strokeStyle = '#ffffff99';
        ctx.strokeRect(p.x, p.y, b.width * viewport.cell, b.height * viewport.cell);
      }
      if (store.tool !== 'eyedropper') return;
      const edge = viewport.edge(target);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(edge.x, edge.y, viewport.cell, viewport.cell);
      const radius = 64,
        center = {
          x: Math.max(radius + 4, Math.min(width - radius - 4, hover.x + 88)),
          y: Math.max(radius + 4, Math.min(height - radius - 4, hover.y - 88)),
        };
      // One logical target, one magnifier transform, shared by image and frame.
      const cell = viewport.cell * 3;
      const magnifier = new Viewport(
        center.x - (target.x + 0.5) * cell,
        center.y - (target.y + 0.5) * cell,
        cell
      );
      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#161c22';
      ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
      ctx.drawImage(frameImage(), magnifier.x, magnifier.y, SIZE * cell, SIZE * cell);
      drawReference(store.reference, magnifier, 1);
      const m = magnifier.edge(target);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(m.x, m.y, cell, cell);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ddd';
      ctx.stroke();
      ctx.fillStyle = cssColor(
        referenceSample(store.reference, target) ?? sample(store.frame.layers, key(target))
      );
      ctx.fillRect(center.x - 12, center.y + radius - 10, 24, 14);
    };
    const cancel = () => {
      stroke = null;
      dragging = null;
      pinch = null;
      polygon = [];
      pointers.clear();
      draw();
    };
    const update = () => {
      if (
        baseFrame !== store.frame ||
        activeTool !== store.tool ||
        activeLayer !== store.state.active ||
        store.playing
      ) {
        stroke = null;
        dragging = null;
        baseFrame = store.frame;
        activeTool = store.tool;
        activeLayer = store.state.active;
      }
      canvas.style.cursor =
        store.tool === 'eyedropper' ? 'crosshair' : store.tool === 'pan' ? 'grab' : 'crosshair';
      draw();
    };
    const down = (event: PointerEvent) => {
      if (store.playing) return;
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      const p = pointer(event);
      pointers.set(event.pointerId, p);
      hover = p;
      if (pointers.size === 2) {
        stroke = null;
        dragging = null;
        const [a, b] = [...pointers.values()];
        pinch = { focal: midpoint(a!, b!), distance: distance(a!, b!) };
        draw();
        return;
      }
      const target = viewport.pixel(p);
      baseFrame = store.frame;
      if (event.button === 1 || store.tool === 'pan')
        dragging = { start: target, screen: p, selection: null, pan: true, rect: false };
      else if (!contains(target.x, target.y)) return;
      else if (store.tool === 'eyedropper') store.pick(target);
      else if (store.tool === 'pencil' || store.tool === 'eraser') {
        if (store.editable) stroke = new Stroke(store, target, store.tool === 'eraser');
      } else if (store.tool === 'rect')
        dragging = { start: target, screen: p, selection: null, pan: false, rect: true };
      else if (store.tool === 'polygon') {
        if (polygon.length >= 3 && distance(viewport.edge(polygon[0]!), p) < 10) {
          store.setSelection(polygonMask(polygon));
          polygon = [];
        } else polygon.push(target);
      } else if (store.tool === 'grab') {
        if (store.referenceSelected && store.reference?.visible)
          dragging = {
            start: viewport.logical(p),
            screen: p,
            reference: store.reference,
            selection: null,
            pan: false,
            rect: false,
          };
        else {
          const layer = [...store.frame.layers]
            .reverse()
            .find((l) => l.visible && !l.locked && !l.faceId && (l.pixels.get(key(target)) ?? 0) & 255);
          if (layer) {
            store.selectLayer(layer.id);
            dragging = {
              start: viewport.logical(p),
              screen: p,
              layer,
              selection: store.selection,
              pan: false,
              rect: false,
            };
          }
        }
      }
      draw();
    };
    const move = (event: PointerEvent) => {
      const p = pointer(event);
      hover = p;
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()],
          focal = midpoint(a!, b!),
          d = distance(a!, b!);
        viewport = viewport
          .zoomAt(pinch.focal, d / Math.max(0.1, pinch.distance))
          .pan({ x: focal.x - pinch.focal.x, y: focal.y - pinch.focal.y });
        pinch = { focal, distance: d };
      } else if (dragging?.pan) {
        viewport = viewport.pan({ x: p.x - dragging.screen.x, y: p.y - dragging.screen.y });
        dragging.screen = p;
      } else if (stroke) {
        const target = viewport.pixel(p);
        if (contains(target.x, target.y)) stroke.move(target);
      } else if (dragging?.layer) {
        const b = bounds(
          [...dragging.layer.pixels.keys()].filter((k) => !dragging?.selection || dragging.selection.has(k))
        );
        const d = delta();
        if (b)
          dragging.pixels = transform(dragging.layer.pixels, dragging.selection, {
            ...b,
            x: b.x + d.x,
            y: b.y + d.y,
          });
      }
      draw();
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pinch) {
        if (!pointers.size) pinch = null;
        return;
      }
      const currentStroke = stroke,
        current = dragging;
      stroke = null;
      dragging = null;
      currentStroke?.commit();
      if (current?.rect && hover) store.setSelection(rectMask(current.start, viewport.pixel(hover)));
      if (current?.reference && hover) {
        const p = viewport.logical(hover);
        store.setReference(
          shiftReference(current.reference, { x: p.x - current.start.x, y: p.y - current.start.y })
        );
      }
      if (current?.layer && current.pixels && hover) {
        const p = viewport.logical(hover);
        store.move(Math.round(p.x - current.start.x), Math.round(p.y - current.start.y));
      }
      draw();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      hover = pointer(event);
      viewport = viewport.zoomAt(hover, Math.exp(-event.deltaY * 0.002));
      draw();
    };
    const leave = () => {
      if (!pointers.size) {
        hover = null;
        draw();
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancel();
        store.cancelPicker();
        event.stopPropagation();
      }
      if (event.key === 'Enter' && polygon.length >= 3) {
        store.setSelection(polygonMask(polygon));
        polygon = [];
        draw();
        event.preventDefault();
      }
      if (event.key === 'Backspace' && polygon.length) {
        polygon.pop();
        draw();
        event.preventDefault();
      }
    };
    const zoom = (event: Event) => {
      const factor = (event as CustomEvent<number>).detail;
      if (factor === 0) fit();
      else viewport = viewport.zoomAt({ x: width / 2, y: height / 2 }, factor);
      draw();
    };
    const fit = () => {
      const available = Math.max(128, height - 120),
        side = Math.min(width, available) * 0.84;
      viewport = new Viewport((width - side) / 2, (available - side) / 2, side / SIZE);
    };
    const resize = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      if (!initialized) {
        fit();
        initialized = true;
      }
      draw();
    });
    resize.observe(canvas);
    const unsubscribe = store.subscribe(update);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', keyboard);
    canvas.addEventListener('builder-zoom', zoom);
    return () => {
      if (initialized) store.viewport = viewport;
      unsubscribe();
      resize.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', keyboard);
      canvas.removeEventListener('builder-zoom', zoom);
    };
  }, [store]);
  return <canvas ref={ref} className="ab-canvas" tabIndex={0} aria-label="Raster128 Zeichenfläche" />;
}
