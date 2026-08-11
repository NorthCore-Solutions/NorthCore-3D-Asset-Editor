/* eslint-disable react-hooks/immutability -- Dieser Adapter verwaltet absichtlich mutable Canvas-, Three.js- und OrbitControls-Ressourcen außerhalb des React-Zustands. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData } from '../../types/editor';
import { getSurfaceUvAtlas, type SurfaceUvAtlas } from '../../geometry/uvAtlas';
import {
  composeSurfaceAtlasCanvas,
  getSurfaceRasterMetrics,
  loadSurfaceCanvases,
  PAINT_BASE_ALPHA,
  resizeSurfaceCanvases,
  surfaceMetricsKey,
  surfacePointFromUv,
  type SurfaceRasterMetric
} from './surfacePaintGrid';
import {
  floodFill,
  hexToRgba,
  paintBrush,
  rgbaToHex,
  samplePixel
} from './pixelPaint';
import {
  getSurfacePaintSettings,
  setSurfacePaintSettings,
  subscribeSurfacePaint,
  type SurfacePaintSettings
} from './surfacePaintSession';
import { shouldConnectStroke, type StrokeCoordinate } from './strokeContinuity';
import { createPaintDocument, paintTextureNeedsMigration } from './paintDocument';
import { linePoints } from './paintStroke';
import { surfaceCameraDestination } from './surfaceCamera';

const SCALE_RENDER_SETTLE_MS = 110;

interface PaintSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  layers: HTMLCanvasElement[];
}

interface PaintHit {
  point: [number, number];
  islandIndex: number;
}

interface CapturableTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

interface OrbitControlApi {
  enabled: boolean;
  enablePan: boolean;
  enableRotate: boolean;
  target: THREE.Vector3;
  update: () => void;
}

interface CameraTransition {
  startedAt: number;
  duration: number;
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  startUp: THREE.Vector3;
  upRotation: THREE.Quaternion;
}

export interface SurfacePaintBinding {
  active: boolean;
  texture: THREE.CanvasTexture | null;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerCancel: (event: ThreeEvent<PointerEvent>) => void;
}

function configureTexture(texture: THREE.CanvasTexture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
}

function createCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  configureTexture(texture);
  return texture;
}

function createSurface(): PaintSurface {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D-Kontext für Oberflächenbemalung nicht verfügbar.');
  context.imageSmoothingEnabled = false;
  return { canvas, context, texture: createCanvasTexture(canvas), layers: [] };
}

function renderAtlas(
  surface: PaintSurface,
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): boolean {
  const composed = composeSurfaceAtlasCanvas(surface.layers, atlas, metrics, baseColor);
  const sizeChanged = surface.canvas.width !== composed.width || surface.canvas.height !== composed.height;

  if (sizeChanged) {
    surface.canvas.width = composed.width;
    surface.canvas.height = composed.height;
    surface.context.imageSmoothingEnabled = false;
  }

  surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
  surface.context.drawImage(composed, 0, 0);

  if (sizeChanged) {
    const previousTexture = surface.texture;
    surface.texture = createCanvasTexture(surface.canvas);
    previousTexture.dispose();
    return true;
  }

  surface.texture.needsUpdate = true;
  return false;
}

function blockEvent(event: ThreeEvent<PointerEvent>): void {
  event.stopPropagation();
  event.nativeEvent.preventDefault();
  event.nativeEvent.stopImmediatePropagation();
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function useSurfacePaintSettings(): SurfacePaintSettings {
  const [settings, setSettings] = useState<SurfacePaintSettings>(() => getSurfacePaintSettings());
  useEffect(() => subscribeSurfacePaint(setSettings), []);
  return settings;
}

export function useSurfacePaint(
  object: SceneObjectData,
  selected: boolean,
  settings: SurfacePaintSettings,
  geometry: THREE.BufferGeometry
): SurfacePaintBinding {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const setMessage = useEditorStore((state) => state.setMessage);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const [surface] = useState<PaintSurface>(createSurface);
  const [visibleTexture, setVisibleTexture] = useState<THREE.CanvasTexture | null>(null);
  const atlas = useMemo(() => getSurfaceUvAtlas(geometry), [geometry]);
  const metrics = useMemo(
    () => getSurfaceRasterMetrics(geometry, object.scale, atlas),
    [atlas, geometry, object.scale[0], object.scale[1], object.scale[2]]
  );
  const metricsRef = useRef(metrics);
  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);
  const metricsKey = surfaceMetricsKey(metrics);

  const loadedDataUrlRef = useRef<string | null | undefined>(undefined);
  const loadedBaseColorRef = useRef<string | undefined>(undefined);
  const requestedDataUrlRef = useRef<string | null | undefined>(undefined);
  const loadRequestRef = useRef(0);
  const persistTimeoutRef = useRef<number | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);
  const disposeTimeoutRef = useRef<number | null>(null);
  const editRevisionRef = useRef(0);
  const activePointerRef = useRef<number | null>(null);
  const activeIslandRef = useRef<number | null>(null);
  const lastPointRef = useRef<[number, number] | null>(null);
  const lastClientPointRef = useRef<StrokeCoordinate | null>(null);
  const changedRef = useRef(false);
  const wasActiveRef = useRef(false);
  const handledCameraRequestRef = useRef(settings.cameraRequestId);
  const cameraTransitionRef = useRef<CameraTransition | null>(null);
  const paintTexture = object.material.paintTexture;
  const active = settings.enabled && selected && object.visible && !object.locked;
  const textureVisible = active || Boolean(paintTexture);

  const refreshAtlas = (): void => {
    renderAtlas(surface, atlas, metricsRef.current, object.material.color);
    setVisibleTexture(surface.texture);
  };

  const ensureCurrentLayers = (): boolean => {
    const currentMetrics = metricsRef.current;

    if (resizeTimeoutRef.current !== null) {
      window.clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = null;
    }

    if (surface.layers.length === 0) {
      if (paintTexture) return false;
      surface.layers = resizeSurfaceCanvases([], currentMetrics, object.material.color);
      refreshAtlas();
      return true;
    }

    const needsResize = surface.layers.length !== currentMetrics.length
      || currentMetrics.some((metric, index) => {
        const layer = surface.layers[index];
        return !layer || layer.width < metric.width || layer.height < metric.height;
      });

    if (needsResize) {
      surface.layers = resizeSurfaceCanvases(surface.layers, currentMetrics, object.material.color);
      refreshAtlas();
    }

    return true;
  };

  const persist = (): void => {
    if (!ensureCurrentLayers()) return;
    const data = createPaintDocument(
      surface.layers,
      atlas,
      metricsRef.current,
      object.material.color
    );
    loadedDataUrlRef.current = data.dataUrl;
    loadedBaseColorRef.current = object.material.color.toUpperCase();
    requestedDataUrlRef.current = undefined;
    updateMaterial(object.id, { paintTexture: data }, false);
  };

  useEffect(() => {
    if (settings.cameraRequestId === handledCameraRequestRef.current || !controls) return;
    handledCameraRequestRef.current = settings.cameraRequestId;
    if (!selected || !settings.cameraView) return;

    const target = new THREE.Vector3(...object.position);
    const distance = Math.max(
      3.5,
      Math.max(Math.abs(object.scale[0]), Math.abs(object.scale[1]), Math.abs(object.scale[2])) * 4
    );
    const destination = surfaceCameraDestination(settings.cameraView, target, distance);

    const startUp = camera.up.clone().normalize();
    const endUp = destination.up.clone().normalize();
    cameraTransitionRef.current = {
      startedAt: performance.now(),
      duration: 420,
      startPosition: camera.position.clone(),
      endPosition: destination.position,
      startTarget: controls.target.clone(),
      endTarget: target,
      startUp,
      upRotation: new THREE.Quaternion().setFromUnitVectors(startUp, endUp)
    };
  }, [
    camera,
    controls,
    object.position[0],
    object.position[1],
    object.position[2],
    object.scale[0],
    object.scale[1],
    object.scale[2],
    selected,
    settings.cameraRequestId,
    settings.cameraView
  ]);

  useFrame(() => {
    if (active && controls) {
      controls.enabled = true;
      controls.enablePan = false;
      controls.enableRotate = true;
    }

    const transition = cameraTransitionRef.current;
    if (!transition || !controls || !selected) return;
    const progress = THREE.MathUtils.clamp(
      (performance.now() - transition.startedAt) / transition.duration,
      0,
      1
    );
    const eased = smoothStep(progress);
    const upStep = new THREE.Quaternion().identity().slerp(transition.upRotation, eased);

    camera.position.lerpVectors(transition.startPosition, transition.endPosition, eased);
    controls.target.lerpVectors(transition.startTarget, transition.endTarget, eased);
    camera.up.copy(transition.startUp).applyQuaternion(upStep).normalize();
    camera.lookAt(controls.target);
    camera.updateMatrixWorld(true);
    controls.update();

    if (progress >= 1) cameraTransitionRef.current = null;
  });

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      return;
    }
    if (!wasActiveRef.current || !controls) return;
    wasActiveRef.current = false;
    controls.enabled = true;
    controls.enablePan = true;
    controls.enableRotate = true;
    camera.up.set(0, 1, 0);
    controls.update();
    camera.updateMatrixWorld(true);
  }, [active, camera, controls]);

  useEffect(() => {
    if (disposeTimeoutRef.current !== null) {
      window.clearTimeout(disposeTimeoutRef.current);
      disposeTimeoutRef.current = null;
    }

    return () => {
      loadRequestRef.current += 1;
      requestedDataUrlRef.current = undefined;
      if (persistTimeoutRef.current !== null) window.clearTimeout(persistTimeoutRef.current);
      if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);
      lastClientPointRef.current = null;
      if (activePointerRef.current !== null) {
        activePointerRef.current = null;
        activeIslandRef.current = null;
        endTransaction();
      }

      const textureToDispose = surface.texture;
      disposeTimeoutRef.current = window.setTimeout(() => {
        textureToDispose.dispose();
        disposeTimeoutRef.current = null;
      }, 0);
    };
  }, [endTransaction, surface]);

  useEffect(() => {
    const dataUrl = paintTexture?.dataUrl ?? null;
    const baseColor = object.material.color.toUpperCase();
    const externalTextureUpdate = loadedDataUrlRef.current !== undefined
      && loadedDataUrlRef.current !== dataUrl;

    if (externalTextureUpdate && persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    if (externalTextureUpdate && resizeTimeoutRef.current !== null) {
      window.clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = null;
    }

    if (
      surface.layers.length > 0
      && loadedDataUrlRef.current === dataUrl
      && loadedBaseColorRef.current === baseColor
    ) return;
    if (requestedDataUrlRef.current === dataUrl) return;

    const requestId = ++loadRequestRef.current;
    const editRevision = editRevisionRef.current;
    let cancelled = false;
    requestedDataUrlRef.current = dataUrl;

    void loadSurfaceCanvases(paintTexture, atlas, metricsRef.current, object.material.color)
      .then((layers) => {
        if (cancelled || loadRequestRef.current !== requestId) return;
        if (editRevisionRef.current !== editRevision) {
          if (requestedDataUrlRef.current === dataUrl) requestedDataUrlRef.current = undefined;
          return;
        }

        surface.layers = layers;
        refreshAtlas();
        requestedDataUrlRef.current = undefined;
        loadedDataUrlRef.current = dataUrl;
        loadedBaseColorRef.current = baseColor;

        if (paintTextureNeedsMigration(paintTexture, atlas, metricsRef.current, object.material.color)) {
          persist();
        }
      })
      .catch((error: unknown) => {
        if (cancelled || loadRequestRef.current !== requestId) return;
        if (requestedDataUrlRef.current === dataUrl) requestedDataUrlRef.current = undefined;
        setMessage(error instanceof Error
          ? `Bemalung konnte nicht geladen werden: ${error.message}`
          : 'Bemalung konnte nicht geladen werden.');
      });

    return () => {
      cancelled = true;
      if (loadRequestRef.current === requestId) loadRequestRef.current += 1;
      if (requestedDataUrlRef.current === dataUrl) requestedDataUrlRef.current = undefined;
    };
  }, [
    atlas,
    object.material.color,
    paintTexture?.dataUrl,
    paintTexture?.height,
    paintTexture?.width,
    setMessage,
    surface
  ]);

  useEffect(() => {
    if (surface.layers.length === 0) return;
    if (resizeTimeoutRef.current !== null) window.clearTimeout(resizeTimeoutRef.current);

    const sourceDataUrl = paintTexture?.dataUrl ?? null;
    resizeTimeoutRef.current = window.setTimeout(() => {
      resizeTimeoutRef.current = null;
      surface.layers = resizeSurfaceCanvases(
        surface.layers,
        metricsRef.current,
        object.material.color
      );
      refreshAtlas();

      if (!sourceDataUrl) return;
      const currentObject = useEditorStore.getState().objects.find((item) => item.id === object.id);
      if (currentObject?.material.paintTexture?.dataUrl !== sourceDataUrl) return;
      persist();
    }, SCALE_RENDER_SETTLE_MS);

    return () => {
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
    };
  }, [atlas, metricsKey, object.id, object.material.color, paintTexture?.dataUrl, surface]);

  const paintAt = (islandIndex: number, point: [number, number], previous: [number, number] | null): boolean => {
    if (!ensureCurrentLayers()) return false;
    const layer = surface.layers[islandIndex];
    const context = layer?.getContext('2d', { willReadFrequently: true });
    if (!layer || !context) return false;
    const currentPoint: [number, number] = [
      Math.max(0, Math.min(layer.width - 1, point[0])),
      Math.max(0, Math.min(layer.height - 1, point[1]))
    ];
    const currentPrevious: [number, number] | null = previous
      ? [
          Math.max(0, Math.min(layer.width - 1, previous[0])),
          Math.max(0, Math.min(layer.height - 1, previous[1]))
        ]
      : null;
    const image = context.getImageData(0, 0, layer.width, layer.height);

    if (settings.tool === 'eyedropper') {
      const sampled = samplePixel(image, currentPoint[0], currentPoint[1]);
      if (sampled.a > 0) setSurfacePaintSettings({ color: rgbaToHex(sampled) });
      return false;
    }

    if (settings.tool === 'fill') {
      floodFill(image, currentPoint[0], currentPoint[1], hexToRgba(settings.color));
    } else {
      const color = settings.tool === 'eraser'
        ? settings.eraseAll
          ? hexToRgba('#000000', 0)
          : hexToRgba(object.material.color, PAINT_BASE_ALPHA)
        : hexToRgba(settings.color);
      const points = currentPrevious ? linePoints(currentPrevious, currentPoint) : [currentPoint];
      points.forEach(([x, y]) => paintBrush(image, x, y, settings.brushSize, color));
    }

    context.putImageData(image, 0, 0);
    refreshAtlas();
    return true;
  };

  const hitFromEvent = (event: ThreeEvent<PointerEvent>): PaintHit | null => {
    if (!event.uv || !(event.object instanceof THREE.Mesh)) return null;
    return surfacePointFromUv(atlas, metricsRef.current, event.uv, surface.layers);
  };

  const releasePointer = (event: ThreeEvent<PointerEvent>): void => {
    const target = event.target as CapturableTarget;
    target.releasePointerCapture?.(event.pointerId);
  };

  const finishStroke = (event: ThreeEvent<PointerEvent>): void => {
    if (activePointerRef.current !== event.pointerId) return;
    blockEvent(event);
    activePointerRef.current = null;
    activeIslandRef.current = null;
    lastPointRef.current = null;
    lastClientPointRef.current = null;
    if (changedRef.current) persist();
    changedRef.current = false;
    releasePointer(event);
    endTransaction();
  };

  return {
    active,
    texture: textureVisible ? visibleTexture : null,
    onPointerDown: (event) => {
      if (!active || event.button !== 0) return;
      blockEvent(event);
      const hit = hitFromEvent(event);
      if (!hit) return;
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      if (!ensureCurrentLayers()) return;
      setSurfacePaintSettings({ islandIndex: hit.islandIndex });

      if (settings.tool === 'eyedropper') {
        paintAt(hit.islandIndex, hit.point, null);
        return;
      }

      editRevisionRef.current += 1;
      beginTransaction();
      const changed = paintAt(hit.islandIndex, hit.point, null);
      if (settings.tool === 'fill') {
        if (changed) persist();
        endTransaction();
        return;
      }

      activePointerRef.current = event.pointerId;
      activeIslandRef.current = hit.islandIndex;
      lastPointRef.current = hit.point;
      lastClientPointRef.current = [event.clientX, event.clientY];
      changedRef.current = changed;
      const target = event.target as CapturableTarget;
      target.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event) => {
      if (activePointerRef.current !== event.pointerId) return;
      if ((event.buttons & 1) === 0) {
        finishStroke(event);
        return;
      }
      blockEvent(event);
      const hit = hitFromEvent(event);
      if (!hit) {
        activeIslandRef.current = null;
        lastPointRef.current = null;
        lastClientPointRef.current = null;
        return;
      }

      const sameIsland = activeIslandRef.current === hit.islandIndex;
      const currentClient: StrokeCoordinate = [event.clientX, event.clientY];
      const metric = metricsRef.current[hit.islandIndex];
      const previousSample = sameIsland && lastPointRef.current && lastClientPointRef.current
        ? { pixel: lastPointRef.current, client: lastClientPointRef.current }
        : null;
      const connectPrevious = metric
        ? shouldConnectStroke(
            previousSample,
            { pixel: hit.point, client: currentClient },
            metric.width,
            metric.height,
            settings.brushSize
          )
        : false;

      if (!sameIsland) setSurfacePaintSettings({ islandIndex: hit.islandIndex });
      changedRef.current = paintAt(
        hit.islandIndex,
        hit.point,
        connectPrevious ? lastPointRef.current : null
      ) || changedRef.current;
      activeIslandRef.current = hit.islandIndex;
      lastPointRef.current = hit.point;
      lastClientPointRef.current = currentClient;
    },
    onPointerUp: finishStroke,
    onPointerCancel: finishStroke
  };
}
