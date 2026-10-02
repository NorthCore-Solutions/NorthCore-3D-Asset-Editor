import { useEffect, useRef } from 'react';
import type { LegacyStore } from './legacyStore';
import { facePlacement, masked, maskBounds, PARTS, resizeFace, rigElement } from './legacy';
import type {
  FaceElement,
  FacePart,
  FaceResizeAnchor,
  LegacyLayer,
  LegacyPreview,
  Mask,
  Pixel,
} from './legacy';
import { Viewport, cssColor, line } from './raster';
import type { Point } from './raster';

export function LegacyCanvas({ store }: { store: LegacyStore }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext('2d')!;
    let width = 0,
      height = 0,
      viewport = store.viewport ?? new Viewport(0, 0, 1),
      initialized = !!store.viewport;
    let polygon: Point[] = [],
      hover: Point | null = null;
    let drag: {
      point: Point;
      screen: Point;
      pan?: boolean;
      select?: boolean;
      face?: FacePart;
      corner?: FaceResizeAnchor;
      layer?: LegacyLayer;
      pixels?: Map<number, Pixel>;
      last?: Point;
      erase?: boolean;
      color?: number;
    } | null = null;
    let baseline = store.frame,
      tool = store.tool,
      active = store.active;
    const pointers = new Map<number, Point>();
    let pinch: { focal: Point; distance: number } | null = null;
    let cachedImage: typeof store.image = null;
    const image = document.createElement('canvas');
    image.width = 1024;
    image.height = 1024;
    const position = (e: PointerEvent | WheelEvent): Point => {
      const b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const valid = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < 1024 && p.y < 1024;
    const rect = (a: Point, b: Point): Mask => ({
      type: 'rect',
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x) + 1,
      height: Math.abs(a.y - b.y) + 1,
    });
    const facePreview = (part: FacePart): FaceElement | undefined => {
      const element = store.frame.face?.[part],
        asset = element && store.rig && rigElement(store.rig, part, element.state);
      if (!element || !asset || drag?.face !== part || !hover) return element;
      if (drag.corner) return resizeFace(element, asset, viewport.logical(hover), drag.corner);
      const p = viewport.pixel(hover);
      return {
        ...element,
        x: Math.max(0, Math.min(1023, element.x + p.x - drag.point.x)),
        y: Math.max(0, Math.min(1023, element.y + p.y - drag.point.y)),
      };
    };
    const draw = () => {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#10171b';
      ctx.fillRect(0, 0, width, height);
      for (let y = 0; y < 1024; y += 16)
        for (let x = 0; x < 1024; x += 16) {
          const p = viewport.edge({ x, y });
          ctx.fillStyle = ((x + y) / 16) % 2 ? '#22262a' : '#3e4348';
          ctx.fillRect(p.x, p.y, 16 * viewport.cell, 16 * viewport.cell);
        }
      if (cachedImage !== store.image) {
        cachedImage = store.image;
        if (cachedImage)
          image
            .getContext('2d')!
            .putImageData(new ImageData(new Uint8ClampedArray(cachedImage.toBytes()), 1024, 1024), 0, 0);
      }
      ctx.drawImage(image, viewport.x, viewport.y, 1024 * viewport.cell, 1024 * viewport.cell);
      if (drag && store.scene?.frame === store.frame) {
        const changed = new Set<number>();
        let preview: LegacyPreview | undefined;
        if (drag.pixels && drag.layer) {
          preview = { layer: drag.layer.id, pixels: drag.pixels };
          for (const p of drag.layer.pixels ?? [])
            if (drag.pixels.get(p.y * 1024 + p.x)?.rgba !== p.rgba) changed.add(p.y * 1024 + p.x);
          const original = new Map(drag.layer.pixels?.map((p) => [p.y * 1024 + p.x, p.rgba]));
          for (const [k, p] of drag.pixels) if (original.get(k) !== p.rgba) changed.add(k);
        } else if (drag.face && hover) {
          const element = store.frame.face?.[drag.face],
            asset = element && store.rig && rigElement(store.rig, drag.face, element.state);
          if (element && asset) {
            const moved = facePreview(drag.face)!;
            preview = { part: drag.face, element: moved };
            for (const el of [element, moved]) {
              const b = facePlacement(el, asset);
              for (let y = Math.max(0, b.y); y < Math.min(1024, b.y + el.height); y++)
                for (let x = Math.max(0, b.x); x < Math.min(1024, b.x + el.width); x++)
                  changed.add(y * 1024 + x);
            }
          }
        }
        for (const k of changed) {
          const p = { x: k % 1024, y: Math.floor(k / 1024) },
            e = viewport.edge(p);
          ctx.fillStyle = (Math.floor(p.x / 16) + Math.floor(p.y / 16)) % 2 ? '#22262a' : '#3e4348';
          ctx.fillRect(e.x, e.y, viewport.cell, viewport.cell);
          ctx.fillStyle = cssColor(store.scene.sample(p.x, p.y, preview));
          ctx.fillRect(e.x, e.y, viewport.cell, viewport.cell);
        }
      }
      ctx.strokeStyle = '#d2afff';
      ctx.lineWidth = 1;
      const selection =
        drag?.select && hover ? rect(drag.point, viewport.pixel(hover)) : store.selection;
      if (selection) {
        if (selection.type === 'polygon') {
          ctx.beginPath();
          selection.points.forEach(([x, y], i) => {
            const p = viewport.edge({ x, y });
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.stroke();
        } else {
          const b = maskBounds(selection),
            p = viewport.edge(b);
          ctx.strokeRect(p.x, p.y, b.width * viewport.cell, b.height * viewport.cell);
        }
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
      const part = drag?.face ?? store.facePart,
        el = part ? facePreview(part) : null,
        asset = part && el && store.rig ? rigElement(store.rig, part, el.state) : null;
      if (el && asset) {
        const e = viewport.edge(facePlacement(el, asset));
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(e.x, e.y, el.width * viewport.cell, el.height * viewport.cell);
        if (store.tool === 'grab') {
          ctx.fillStyle = '#fff';
          for (const x of [e.x, e.x + el.width * viewport.cell])
            for (const y of [e.y, e.y + el.height * viewport.cell]) ctx.fillRect(x - 5, y - 5, 10, 10);
        }
      }
    };
    const stamp = (p: Point) => {
      if (!drag?.pixels || !drag.last) return;
      for (const cell of line(drag.last, p)) {
        if (!valid(cell) || (store.selection && !masked(store.selection, cell.x, cell.y))) continue;
        if (drag.erase) drag.pixels.delete(cell.y * 1024 + cell.x);
        else
          drag.pixels.set(cell.y * 1024 + cell.x, {
            ...cell,
            rgba: drag.color!,
          });
      }
      drag.last = p;
    };
    const down = (event: PointerEvent) => {
      if (store.playing || store.scene?.frame !== store.frame) return;
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      const screen = position(event);
      pointers.set(event.pointerId, screen);
      hover = screen;
      if (pointers.size === 2) {
        drag = null;
        const [a, b] = [...pointers.values()];
        pinch = {
          focal: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
          distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        };
        return;
      }
      const p = viewport.pixel(screen);
      if (event.button === 1 || store.tool === 'pan') drag = { point: p, screen, pan: true };
      else if (!valid(p)) return;
      else if (store.tool === 'eyedropper') {
        store.color = store.image?.get(p.x, p.y) ?? 0;
        store.emit();
      } else if (store.tool === 'rect') drag = { point: p, screen, select: true };
      else if (store.tool === 'polygon') polygon.push(p);
      else if (
        (store.tool === 'pencil' || store.tool === 'eraser') &&
        store.layer?.kind === 'pixels' &&
        !store.layer.locked &&
        store.layer.visible !== false
      ) {
        drag = {
          point: p,
          screen,
          layer: store.layer,
          pixels: new Map((store.layer.pixels ?? []).map((v) => [v.y * 1024 + v.x, v])),
          last: p,
          color: store.color,
          erase: store.tool === 'eraser',
        };
        stamp(p);
      } else if (store.tool === 'grab') {
        const selected = store.facePart,
          element = selected && store.frame.face?.[selected],
          asset = element && selected && store.rig && rigElement(store.rig, selected, element.state);
        const selectedLayer = store.frame.layers?.find((l) => l.kind === selected);
        if (
          selected &&
          element?.visible !== false &&
          element &&
          asset &&
          !selectedLayer?.locked &&
          selectedLayer?.visible !== false
        ) {
          const b = facePlacement(element, asset);
          for (const sx of [-1, 1])
            for (const sy of [-1, 1]) {
              const edge = viewport.edge({
                x: b.x + (sx > 0 ? element.width : 0),
                y: b.y + (sy > 0 ? element.height : 0),
              });
              if (Math.abs(edge.x - screen.x) <= 10 && Math.abs(edge.y - screen.y) <= 10)
                drag = {
                  point: p,
                  screen,
                  face: selected,
                  corner: {
                    fixed: {
                      x: b.x + (sx < 0 ? element.width : 0),
                      y: b.y + (sy < 0 ? element.height : 0),
                    },
                    signX: sx,
                    signY: sy,
                  },
                };
            }
        }
        if (!drag)
          for (const part of [...PARTS].reverse()) {
            const layer = store.frame.layers?.find((l) => l.kind === part);
            if (
              layer?.locked ||
              layer?.visible === false ||
              !(store.scene.faceSample(part, p.x, p.y) & 255)
            )
              continue;
            store.facePart = part;
            drag = { point: p, screen, face: part };
            break;
          }
        if (!drag && store.layer?.kind === 'pixels' && !store.layer.locked)
          drag = { point: p, screen, layer: store.layer };
      }
      draw();
    };
    const move = (e: PointerEvent) => {
      const p = position(e);
      hover = p;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()],
          focal = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
          d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        viewport = viewport
          .zoomAt(pinch.focal, d / Math.max(0.1, pinch.distance), 0.03)
          .pan({ x: focal.x - pinch.focal.x, y: focal.y - pinch.focal.y });
        pinch = { focal, distance: d };
      } else if (drag?.pan) {
        viewport = viewport.pan({
          x: p.x - drag.screen.x,
          y: p.y - drag.screen.y,
        });
        drag.screen = p;
      } else if (drag?.pixels && drag.last) {
        const cell = viewport.pixel(p);
        if (valid(cell)) stamp(cell);
      } else if (drag?.layer && hover) {
        const at = viewport.pixel(hover),
          dx = at.x - drag.point.x,
          dy = at.y - drag.point.y;
        const selected = (drag.layer.pixels ?? []).filter(
            (v) => !store.selection || masked(store.selection, v.x, v.y)
          ),
          moved = new Set(selected);
        drag.pixels = new Map(
          (drag.layer.pixels ?? []).filter((v) => !moved.has(v)).map((v) => [v.y * 1024 + v.x, v])
        );
        for (const v of selected)
          if (valid({ x: v.x + dx, y: v.y + dy }))
            drag.pixels.set((v.y + dy) * 1024 + v.x + dx, {
              ...v,
              x: v.x + dx,
              y: v.y + dy,
            });
      }
      draw();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (!pointers.size) pinch = null;
        return;
      }
      const current = drag,
        face = drag?.face ? facePreview(drag.face) : undefined;
      drag = null;
      if (current?.select && hover) {
        store.selection = rect(current.point, viewport.pixel(hover));
        store.emit();
      }
      if (current?.layer && current.pixels && current.last && current.layer === store.layer) {
        const original = current.layer.pixels ?? [],
          next = [...current.pixels.values()];
        if (
          original.length !== next.length ||
          original.some((p) => current.pixels!.get(p.y * 1024 + p.x)?.rgba !== p.rgba)
        )
          store.layerEdit(current.layer.id, { pixels: next });
      } else if (current && hover && !current.pan && !current.select) {
        const p = viewport.pixel(hover),
          dx = p.x - current.point.x,
          dy = p.y - current.point.y;
        if (current.face && face) store.setFace(current.face, face);
        else if (current.layer) store.movePixels(dx, dy);
      }
      draw();
    };
    const cancel = () => {
      drag = null;
      pinch = null;
      polygon = [];
      pointers.clear();
      draw();
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && polygon.length >= 3) {
        store.selection = {
          type: 'polygon',
          points: polygon.map((p) => [p.x, p.y]),
        };
        polygon = [];
        store.emit();
        e.preventDefault();
      }
      if (e.key === 'Backspace' && polygon.length) {
        polygon.pop();
        draw();
        e.preventDefault();
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      viewport = viewport.zoomAt(position(e), Math.exp(-e.deltaY * 0.002), 0.03);
      draw();
    };
    const fit = () => {
      const available = Math.max(128, height - 120),
        side = Math.min(width, available) * 0.85;
      viewport = new Viewport((width - side) / 2, (available - side) / 2, side / 1024);
    };
    const zoom = (e: Event) => {
      const factor = (e as CustomEvent<number>).detail;
      if (!factor) fit();
      else viewport = viewport.zoomAt({ x: width / 2, y: height / 2 }, factor, 0.03);
      draw();
    };
    const observer = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      width = r.width;
      height = r.height;
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      if (!initialized) {
        initialized = true;
        fit();
      }
      draw();
    });
    const unsubscribe = store.subscribe(() => {
      if (baseline !== store.frame || tool !== store.tool || active !== store.active || store.playing) {
        drag = null;
        baseline = store.frame;
        tool = store.tool;
        active = store.active;
      }
      draw();
    });
    observer.observe(canvas);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', keyboard);
    canvas.addEventListener('builder-zoom', zoom);
    return () => {
      if (initialized) store.viewport = viewport;
      unsubscribe();
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', keyboard);
      canvas.removeEventListener('builder-zoom', zoom);
    };
  }, [store]);
  return <canvas className="ab-canvas" ref={ref} tabIndex={0} aria-label="Legacy Zeichenfläche 1024" />;
}
