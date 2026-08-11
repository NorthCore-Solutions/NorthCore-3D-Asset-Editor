import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';

const BASE_ZOOM_SPEED = 1.25;
const MAX_ZOOM_SPEED = 3.75;
const MAX_VIEWPORT_PIXEL_RATIO = 1.5;

interface OrbitControlApi {
  target: THREE.Vector3;
  zoomSpeed: number;
  zoomToCursor: boolean;
  minDistance: number;
  maxDistance: number;
  dampingFactor: number;
}

interface ViewportPerformanceEntry {
  references: number;
  gl: THREE.WebGLRenderer;
  controls: OrbitControlApi;
  previousPixelRatio: number;
  previousShadowAutoUpdate: boolean;
  previousZoomSpeed: number;
  previousZoomToCursor: boolean;
  previousMinDistance: number;
  previousMaxDistance: number;
  previousDampingFactor: number;
  handleWheel: () => void;
}

const viewportPerformanceEntries = new WeakMap<THREE.Scene, ViewportPerformanceEntry>();

export function cappedViewportPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return THREE.MathUtils.clamp(devicePixelRatio, 1, MAX_VIEWPORT_PIXEL_RATIO);
}

export function zoomSpeedForDistance(distance: number): number {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 10;
  return THREE.MathUtils.clamp(
    BASE_ZOOM_SPEED + 1.5 / (safeDistance + 0.5),
    BASE_ZOOM_SPEED,
    MAX_ZOOM_SPEED
  );
}

function preferredPixelRatio(): number {
  return cappedViewportPixelRatio(window.devicePixelRatio || 1);
}

function setPixelRatio(gl: THREE.WebGLRenderer, value: number): void {
  if (Math.abs(gl.getPixelRatio() - value) < 0.001) return;
  gl.setPixelRatio(value);
}

function setControlZoomSpeed(controls: OrbitControlApi, value: number): void {
  controls.zoomSpeed = value;
}

function configureControls(controls: OrbitControlApi, zoomSpeed: number): void {
  controls.zoomSpeed = zoomSpeed;
  controls.zoomToCursor = true;
  controls.minDistance = 0.08;
  controls.maxDistance = 500;
  controls.dampingFactor = 0.1;
}

function restoreControls(entry: ViewportPerformanceEntry): void {
  entry.controls.zoomSpeed = entry.previousZoomSpeed;
  entry.controls.zoomToCursor = entry.previousZoomToCursor;
  entry.controls.minDistance = entry.previousMinDistance;
  entry.controls.maxDistance = entry.previousMaxDistance;
  entry.controls.dampingFactor = entry.previousDampingFactor;
}

function configureShadowMap(gl: THREE.WebGLRenderer, autoUpdate: boolean): void {
  gl.shadowMap.autoUpdate = autoUpdate;
  gl.shadowMap.needsUpdate = true;
}

function requestShadowUpdate(gl: THREE.WebGLRenderer): void {
  gl.shadowMap.needsUpdate = true;
}

export function useViewportPerformance(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry
): void {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const materialOpacity = object.material.opacity;
  const paintTextureDataUrl = object.material.paintTexture?.dataUrl;
  const [positionX, positionY, positionZ] = object.position;
  const [rotationX, rotationY, rotationZ] = object.rotation;
  const [scaleX, scaleY, scaleZ] = object.scale;
  const objectVisible = object.visible;

  useEffect(() => {
    if (!controls) return;

    let entry = viewportPerformanceEntries.get(scene);
    if (!entry) {
      const previousPixelRatio = gl.getPixelRatio();
      const previousShadowAutoUpdate = gl.shadowMap.autoUpdate;
      const previousZoomSpeed = controls.zoomSpeed;
      const previousZoomToCursor = controls.zoomToCursor;
      const previousMinDistance = controls.minDistance;
      const previousMaxDistance = controls.maxDistance;
      const previousDampingFactor = controls.dampingFactor;

      const handleWheel = (): void => {
        setControlZoomSpeed(controls, zoomSpeedForDistance(camera.position.distanceTo(controls.target)));
      };

      entry = {
        references: 0,
        gl,
        controls,
        previousPixelRatio,
        previousShadowAutoUpdate,
        previousZoomSpeed,
        previousZoomToCursor,
        previousMinDistance,
        previousMaxDistance,
        previousDampingFactor,
        handleWheel
      };
      viewportPerformanceEntries.set(scene, entry);

      configureControls(controls, zoomSpeedForDistance(camera.position.distanceTo(controls.target)));
      gl.domElement.addEventListener('wheel', handleWheel, { capture: true, passive: true });

      // Das Pixel Ratio bleibt während der gesamten Interaktion konstant:
      // Eine Interaktions-Herabsetzung skaliert den Drawing-Buffer um und
      // ließ Raster- und Achsenlinien bei jedem Klick/Tipp kurz aufhellen.
      setPixelRatio(gl, preferredPixelRatio());
      configureShadowMap(gl, false);
    }

    entry.references += 1;

    return () => {
      const current = viewportPerformanceEntries.get(scene);
      if (!current) return;
      current.references -= 1;
      if (current.references > 0) return;

      current.gl.domElement.removeEventListener('wheel', current.handleWheel, true);
      restoreControls(current);
      configureShadowMap(current.gl, current.previousShadowAutoUpdate);
      setPixelRatio(current.gl, current.previousPixelRatio);
      viewportPerformanceEntries.delete(scene);
    };
  }, [camera, controls, gl, scene]);

  useEffect(() => {
    requestShadowUpdate(gl);
  }, [
    geometry,
    gl,
    materialOpacity,
    objectVisible,
    paintTextureDataUrl,
    positionX,
    positionY,
    positionZ,
    rotationX,
    rotationY,
    rotationZ,
    scaleX,
    scaleY,
    scaleZ
  ]);
}
