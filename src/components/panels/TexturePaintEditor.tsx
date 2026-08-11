import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PaintTextureData } from '../../types/editor';
import {
  atlasIslandAtPixel,
  atlasPixelRegion,
  type SurfaceUvAtlas
} from '../../geometry/uvAtlas';
import {
  cloneSurfaceCanvas,
  composeSurfaceAtlasCanvas,
  copySurfaceCanvas,
  createVisibleSurfaceCanvas,
  loadSurfaceCanvases,
  PAINT_BASE_ALPHA,
  resizeSurfaceCanvases,
  surfaceCanvasRegion,
  surfaceDimensionsKey,
  surfaceMetricsKey,
  surfaceUvWindow,
  type SurfaceRasterMetric
} from '../../editor/paint/surfacePaintGrid';
import {
  floodFill,
  hexToRgba,
  paintBrush,
  rgbaToHex,
  samplePixel,
  type PaintTool
} from '../../editor/paint/pixelPaint';
import {
  requestSurfaceCameraView,
  setSurfacePaintSettings,
  subscribeSurfacePaint
} from '../../editor/paint/surfacePaintSession';
import { createPaintDocument, paintTextureNeedsMigration } from '../../editor/paint/paintDocument';
import { linePoints } from '../../editor/paint/paintStroke';
import { cameraViewForSurfaceLabel } from '../../editor/paint/surfaceCamera';
import './texture-paint-editor.css';

interface TexturePaintEditorProps {
  objectId: string;
  baseColor: string;
  texture?: PaintTextureData;
  atlas: SurfaceUvAtlas;
  metrics: SurfaceRasterMetric[];
  onCommit: (texture: PaintTextureData | undefined) => void;
  onPaintModeChange?: (enabled: boolean) => void;
}

interface PaintPoint {
  islandIndex: number;
  point: [number, number];
}

type LayerSnapshot = ImageData[];

const TOOLS: Array<{ tool: PaintTool; label: string }> = [
  { tool: 'brush', label: 'Pinsel' },
  { tool: 'eraser', label: 'Radierer' },
  { tool: 'fill', label: 'Füllen' },
  { tool: 'eyedropper', label: 'Pipette' }
];

function surfaceDisplayLabel(index: number, label: string): string {
  const numberedLabel = `Fläche ${index + 1}`;
  return /^Fläche\s+\d+$/i.test(label) ? numberedLabel : `${numberedLabel} · ${label}`;
}

function closeSurfacePicker(button: HTMLButtonElement): void {
  button.closest('details')?.removeAttribute('open');
}

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const bounds = canvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(canvas.width - 1, Math.floor((clientX - bounds.left) / bounds.width * canvas.width))),
    Math.max(0, Math.min(canvas.height - 1, Math.floor((clientY - bounds.top) / bounds.height * canvas.height)))
  ];
}

function pointerInsideCanvas(canvas: HTMLCanvasElement, clientX: number, clientY: number): boolean {
  const bounds = canvas.getBoundingClientRect();
  return clientX >= bounds.left
    && clientX <= bounds.right
    && clientY >= bounds.top
    && clientY <= bounds.bottom;
}

function snapshotLayers(layers: HTMLCanvasElement[]): LayerSnapshot {
  return layers.map((layer) => {
    const context = layer.getContext('2d', { willReadFrequently: true });
    if (!context) return new ImageData(layer.width, layer.height);
    return context.getImageData(0, 0, layer.width, layer.height);
  });
}

function canvasesFromSnapshot(snapshot: LayerSnapshot): HTMLCanvasElement[] {
  return snapshot.map((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) {
      context.imageSmoothingEnabled = false;
      context.putImageData(image, 0, 0);
    }
    return canvas;
  });
}

export function TexturePaintEditor({
  objectId,
  baseColor,
  texture,
  atlas,
  metrics,
  onCommit,
  onPaintModeChange
}: TexturePaintEditorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const layersRef = useRef<HTMLCanvasElement[]>([]);
  const drawingRef = useRef(false);
  const activeIslandRef = useRef<number | null>(null);
  const lastPointRef = useRef<[number, number] | null>(null);
  const historyRef = useRef<LayerSnapshot[]>([]);
  const futureRef = useRef<LayerSnapshot[]>([]);
  const loadedKeyRef = useRef('');
  const loadRequestRef = useRef(0);
  const [tool, setTool] = useState<PaintTool>('brush');
  const [paintColor, setPaintColor] = useState(baseColor);
  const [brushSize, setBrushSize] = useState(1);
  const [eraseAll, setEraseAll] = useState(false);
  const [surfaceEnabled, setSurfaceEnabled] = useState(false);
  const [selectedIsland, setSelectedIsland] = useState(-1);
  const [copyTargetIsland, setCopyTargetIsland] = useState(-1);
  const [historyLength, setHistoryLength] = useState(0);
  const [futureLength, setFutureLength] = useState(0);
  const dimensionsKey = surfaceDimensionsKey(metrics);
  const metricsKey = surfaceMetricsKey(metrics);

  const renderSelectedSurface = (islandIndex = selectedIsland): void => {
    const previewCanvas = previewCanvasRef.current;
    const previewContext = previewCanvas?.getContext('2d', { willReadFrequently: true });
    if (!previewCanvas || !previewContext || layersRef.current.length === 0) return;
    previewContext.imageSmoothingEnabled = false;

    if (islandIndex < 0) {
      const overview = composeSurfaceAtlasCanvas(layersRef.current, atlas, metrics, baseColor);
      previewCanvas.width = overview.width;
      previewCanvas.height = overview.height;
      previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewContext.drawImage(overview, 0, 0);
      return;
    }

    const layer = layersRef.current[islandIndex];
    const metric = metrics[islandIndex];
    if (!layer || !metric) return;
    const visible = createVisibleSurfaceCanvas(layer, metric);
    previewCanvas.width = visible.width;
    previewCanvas.height = visible.height;
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(visible, 0, 0);
  };

  const commitLayers = (): void => {
    if (layersRef.current.length === 0) return;
    const data = createPaintDocument(layersRef.current, atlas, metrics, baseColor);
    loadedKeyRef.current = `${objectId}:${data.dataUrl}:${atlas.signature}:${dimensionsKey}`;
    onCommit(data);
  };

  const pushHistory = (): void => {
    if (layersRef.current.length === 0) return;
    historyRef.current = [...historyRef.current.slice(-29), snapshotLayers(layersRef.current)];
    futureRef.current = [];
    setHistoryLength(historyRef.current.length);
    setFutureLength(futureRef.current.length);
  };

  useEffect(() => subscribeSurfacePaint((settings) => {
    setSurfaceEnabled(settings.enabled);
    setTool(settings.tool);
    setPaintColor(settings.color);
    setBrushSize(settings.brushSize);
    setEraseAll(settings.eraseAll);
    setSelectedIsland(Math.min(Math.max(-1, settings.islandIndex), Math.max(0, atlas.islands.length - 1)));
  }), [atlas.islands.length]);

  useEffect(() => () => {
    loadRequestRef.current += 1;
    setSurfacePaintSettings({ enabled: false });
  }, []);

  useEffect(() => {
    const clamped = Math.min(Math.max(-1, selectedIsland), Math.max(0, atlas.islands.length - 1));
    if (clamped !== selectedIsland) {
      const timer = window.setTimeout(() => {
        setSelectedIsland(clamped);
        setSurfacePaintSettings({ islandIndex: clamped });
      }, 0);
      return () => window.clearTimeout(timer);
    }
    renderSelectedSurface(clamped);
  }, [atlas.signature, selectedIsland, metricsKey]);

  const validCopyTargetIsland = copyTargetIsland >= atlas.islands.length ? -1 : copyTargetIsland;

  const changeTool = (nextTool: PaintTool): void => {
    setTool(nextTool);
    setSurfacePaintSettings({ tool: nextTool });
  };

  const changeColor = (nextColor: string): void => {
    const normalized = nextColor.toUpperCase();
    setPaintColor(normalized);
    setSurfacePaintSettings({ color: normalized });
  };

  const changeBrushSize = (nextSize: number): void => {
    setBrushSize(nextSize);
    setSurfacePaintSettings({ brushSize: nextSize });
  };

  const changeEraseAll = (nextEraseAll: boolean): void => {
    setEraseAll(nextEraseAll);
    setSurfacePaintSettings({ eraseAll: nextEraseAll });
  };

  const changeIsland = (nextIsland: number): void => {
    const clamped = Math.max(-1, Math.min(atlas.islands.length - 1, nextIsland));
    setSelectedIsland(clamped);
    setSurfacePaintSettings({ islandIndex: clamped });

    if (clamped >= 0) {
      const view = cameraViewForSurfaceLabel(atlas.islands[clamped]?.label ?? '');
      if (view) requestSurfaceCameraView(view);
    }
  };

  const chooseIsland = (nextIsland: number, button: HTMLButtonElement): void => {
    changeIsland(nextIsland);
    closeSurfacePicker(button);
  };

  const toggleSurfacePaint = (): void => {
    const nextEnabled = !surfaceEnabled;
    onPaintModeChange?.(nextEnabled);
    setSurfacePaintSettings({ enabled: nextEnabled });
  };

  useEffect(() => {
    const key = `${objectId}:${texture?.dataUrl ?? baseColor}:${atlas.signature}:${dimensionsKey}`;
    if (loadedKeyRef.current === key) return;
    const requestId = ++loadRequestRef.current;

    void loadSurfaceCanvases(texture, atlas, metrics, baseColor)
      .then((layers) => {
        if (loadRequestRef.current !== requestId) return;
        layersRef.current = layers;
        loadedKeyRef.current = key;
        historyRef.current = [];
        futureRef.current = [];
        renderSelectedSurface();
        setHistoryLength(historyRef.current.length);
        setFutureLength(futureRef.current.length);

        if (paintTextureNeedsMigration(texture, atlas, metrics, baseColor)) commitLayers();
      })
      .catch(() => undefined);
  }, [atlas.signature, baseColor, dimensionsKey, objectId, texture?.dataUrl, texture?.height, texture?.width]);

  useEffect(() => {
    if (layersRef.current.length === 0) return;
    layersRef.current = resizeSurfaceCanvases(layersRef.current, metrics, baseColor);
    renderSelectedSurface();
    if (texture) commitLayers();
  }, [metricsKey]);

  const resolvePaintPoint = (event: ReactPointerEvent<HTMLCanvasElement>): PaintPoint | null => {
    const preview = event.currentTarget;
    if (!pointerInsideCanvas(preview, event.clientX, event.clientY)) return null;
    const [previewX, previewY] = canvasPoint(preview, event.clientX, event.clientY);

    if (selectedIsland >= 0) {
      const layer = layersRef.current[selectedIsland];
      const metric = metrics[selectedIsland];
      if (!layer || !metric) return null;
      const visible = surfaceCanvasRegion(layer, metric);
      return {
        islandIndex: selectedIsland,
        point: [
          visible.x + Math.max(0, Math.min(visible.width - 1, previewX)),
          visible.y + Math.max(0, Math.min(visible.height - 1, previewY))
        ]
      };
    }

    const islandIndex = atlasIslandAtPixel(atlas, preview.width, preview.height, previewX, previewY);
    const layer = layersRef.current[islandIndex];
    const metric = metrics[islandIndex];
    if (!layer || !metric) return null;
    const region = atlasPixelRegion(atlas, islandIndex, preview.width, preview.height);
    if (
      previewX < region.minX
      || previewX > region.maxX
      || previewY < region.minY
      || previewY > region.maxY
    ) return null;

    const regionWidth = Math.max(1, region.maxX - region.minX + 1);
    const regionHeight = Math.max(1, region.maxY - region.minY + 1);
    const localX = Math.max(0, Math.min(0.999999, (previewX - region.minX + 0.5) / regionWidth));
    const localY = Math.max(0, Math.min(0.999999, (previewY - region.minY + 0.5) / regionHeight));
    const window = surfaceUvWindow(metric);
    const visible = surfaceCanvasRegion(layer, metric);
    const sampleX = visible.x + (window.offsetU + localX * window.scaleU) * visible.width;
    const sampleY = visible.y + (1 - window.offsetV - window.scaleV + localY * window.scaleV) * visible.height;

    return {
      islandIndex,
      point: [
        Math.max(0, Math.min(layer.width - 1, Math.floor(sampleX))),
        Math.max(0, Math.min(layer.height - 1, Math.floor(sampleY)))
      ]
    };
  };

  const applyAt = (islandIndex: number, point: [number, number], previous?: [number, number]): void => {
    const layer = layersRef.current[islandIndex];
    const context = layer?.getContext('2d', { willReadFrequently: true });
    if (!layer || !context) return;
    const image = context.getImageData(0, 0, layer.width, layer.height);

    if (tool === 'eyedropper') {
      const sampled = samplePixel(image, point[0], point[1]);
      if (sampled.a > 0) changeColor(rgbaToHex(sampled));
      return;
    }

    if (tool === 'fill') {
      floodFill(image, point[0], point[1], hexToRgba(paintColor));
    } else {
      const color = tool === 'eraser'
        ? eraseAll
          ? hexToRgba('#000000', 0)
          : hexToRgba(baseColor, PAINT_BASE_ALPHA)
        : hexToRgba(paintColor);
      linePoints(previous ?? point, point).forEach(([x, y]) => paintBrush(image, x, y, brushSize, color));
    }

    context.putImageData(image, 0, 0);
    renderSelectedSurface();
  };

  const startPaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const hit = resolvePaintPoint(event);
    if (!hit) return;

    if (tool === 'eyedropper') {
      applyAt(hit.islandIndex, hit.point);
      return;
    }

    pushHistory();
    applyAt(hit.islandIndex, hit.point);

    if (tool === 'fill') {
      commitLayers();
      return;
    }

    drawingRef.current = true;
    activeIslandRef.current = hit.islandIndex;
    lastPointRef.current = hit.point;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continuePaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current || (tool !== 'brush' && tool !== 'eraser')) return;
    const hit = resolvePaintPoint(event);
    if (!hit) {
      activeIslandRef.current = null;
      lastPointRef.current = null;
      return;
    }
    const sameIsland = activeIslandRef.current === hit.islandIndex;
    applyAt(hit.islandIndex, hit.point, sameIsland ? lastPointRef.current ?? hit.point : hit.point);
    activeIslandRef.current = hit.islandIndex;
    lastPointRef.current = hit.point;
  };

  const finishPaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    activeIslandRef.current = null;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commitLayers();
  };

  const copySelectedSurface = (): void => {
    const source = layersRef.current[selectedIsland];
    const sourceMetric = metrics[selectedIsland];
    if (!source || !sourceMetric || selectedIsland < 0) return;
    const targetIndices = validCopyTargetIsland < 0
      ? atlas.islands.map((_, index) => index).filter((index) => index !== selectedIsland)
      : [validCopyTargetIsland];
    if (targetIndices.length === 0 || targetIndices.includes(selectedIsland)) return;

    pushHistory();
    const next = layersRef.current.map(cloneSurfaceCanvas);
    targetIndices.forEach((targetIndex) => {
      const metric = metrics[targetIndex];
      if (metric) next[targetIndex] = copySurfaceCanvas(source, metric, sourceMetric);
    });
    layersRef.current = next;
    renderSelectedSurface();
    commitLayers();
  };

  const undo = (): void => {
    const previous = historyRef.current.at(-1);
    if (!previous || layersRef.current.length === 0) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [snapshotLayers(layersRef.current), ...futureRef.current].slice(0, 30);
    layersRef.current = canvasesFromSnapshot(previous);
    renderSelectedSurface();
    commitLayers();
    setHistoryLength(historyRef.current.length);
    setFutureLength(futureRef.current.length);
  };

  const redo = (): void => {
    const next = futureRef.current[0];
    if (!next || layersRef.current.length === 0) return;
    historyRef.current = [...historyRef.current.slice(-29), snapshotLayers(layersRef.current)];
    futureRef.current = futureRef.current.slice(1);
    layersRef.current = canvasesFromSnapshot(next);
    renderSelectedSurface();
    commitLayers();
    setHistoryLength(historyRef.current.length);
    setFutureLength(futureRef.current.length);
  };

  const clearTexture = (): void => {
    historyRef.current = [];
    futureRef.current = [];
    loadedKeyRef.current = '';
    layersRef.current = [];
    onCommit(undefined);
    setHistoryLength(historyRef.current.length);
    setFutureLength(futureRef.current.length);
  };

  const selectedSurface = selectedIsland >= 0 ? atlas.islands[selectedIsland] : undefined;
  const selectedSurfaceLabel = selectedIsland < 0
    ? 'Fläche X · Gesamtübersicht'
    : surfaceDisplayLabel(selectedIsland, selectedSurface?.label ?? 'Oberfläche');
  const copyDisabled = atlas.islands.length < 2
    || selectedIsland < 0
    || validCopyTargetIsland === selectedIsland;

  return (
    <div className="paint-editor">
      <button
        type="button"
        className={surfaceEnabled ? 'paint-mode-button active' : 'paint-mode-button'}
        aria-pressed={surfaceEnabled}
        onClick={toggleSurfacePaint}
      >
        Auf Form malen
      </button>

      <div className="paint-tool-grid">
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            className={tool === entry.tool ? 'paint-tool-button active' : 'paint-tool-button'}
            aria-pressed={tool === entry.tool}
            onClick={() => changeTool(entry.tool)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {(tool === 'brush' || tool === 'eraser') && (
        <div className="range-row paint-brush-size">
          <label>Pinselgröße</label>
          <input type="range" min={1} max={8} step={1} value={brushSize} onChange={(event) => changeBrushSize(Number(event.target.value))} />
          <span>{brushSize}px</span>
        </div>
      )}

      {tool === 'eraser' && (
        <label className="paint-eraser-all" title="Vollständig transparent radieren">
          <input
            type="checkbox"
            checked={eraseAll}
            onChange={(event) => changeEraseAll(event.target.checked)}
          />
          <span>Alles</span>
        </label>
      )}

      <div className="paint-surface-block">
        <div className="field-row paint-surface-field">
          <label>Fläche</label>
          <details className="paint-surface-picker">
            <summary>{selectedSurfaceLabel}</summary>
            <div className="paint-surface-options">
              <button
                type="button"
                className={selectedIsland === -1 ? 'active' : ''}
                onClick={(event) => chooseIsland(-1, event.currentTarget)}
              >
                Fläche X · Gesamtübersicht
              </button>
              {atlas.islands.map((island, islandIndex) => (
                <button
                  key={`${island.label}:${islandIndex}`}
                  type="button"
                  className={selectedIsland === islandIndex ? 'active' : ''}
                  onClick={(event) => chooseIsland(islandIndex, event.currentTarget)}
                >
                  {surfaceDisplayLabel(islandIndex, island.label)}
                </button>
              ))}
            </div>
          </details>
        </div>

        <div className="field-row">
          <label>Kopieren nach</label>
          <select value={validCopyTargetIsland} onChange={(event) => setCopyTargetIsland(Number(event.target.value))}>
            <option value={-1}>Alle Flächen</option>
            {atlas.islands.map((island, islandIndex) => (
              <option key={`copy:${island.label}:${islandIndex}`} value={islandIndex}>
                {surfaceDisplayLabel(islandIndex, island.label)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="paint-copy-button"
          disabled={copyDisabled}
          onClick={copySelectedSurface}
        >
          Kopieren
        </button>
      </div>

      <div className="paint-surface-preview-title">{selectedSurfaceLabel}</div>
      <div key={selectedIsland} className="paint-canvas-shell paint-canvas-switch">
        <canvas
          ref={previewCanvasRef}
          onPointerDown={startPaint}
          onPointerMove={continuePaint}
          onPointerUp={finishPaint}
          onPointerCancel={finishPaint}
        />
      </div>

      <div className="paint-history-actions">
        <button type="button" disabled={historyLength === 0} onClick={undo}>Rückgängig</button>
        <button type="button" disabled={futureLength === 0} onClick={redo}>Wiederholen</button>
        <button type="button" className="danger" disabled={!texture} onClick={clearTexture}>Entfernen</button>
      </div>
    </div>
  );
}
