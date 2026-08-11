import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { useSurfacePaintSettings } from '../paint/useSurfacePaint';
import { isNativeAndroid } from '../../platform/nativeFileDialog';
import { AndroidMarqueeButton } from './AndroidMarqueeButton';
import { isAndroidMarqueePointer } from './androidMarqueeSelection';
import { EditorScene } from './EditorScene';
import type { SelectionApi, SelectionRect } from './viewportTypes';

interface MarqueeState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function EditorViewport() {
  const select = useEditorStore((state) => state.select);
  const selectMany = useEditorStore((state) => state.selectMany);
  const paintSettings = useSurfacePaintSettings();
  const viewportRef = useRef<HTMLDivElement>(null);
  const registry = useRef(new Map<string, THREE.Mesh>());
  const selectionApiRef = useRef<SelectionApi | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const marqueeFromAndroidButtonRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const marqueeListenersRef = useRef<{
    pointerMove: (event: PointerEvent) => void;
    finish: (event?: Event) => void;
  } | null>(null);
  const nativeAndroid = isNativeAndroid();
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [androidMarqueeArmed, setAndroidMarqueeArmed] = useState(false);

  const registerSelectionApi = useCallback((api: SelectionApi) => {
    selectionApiRef.current = api;
  }, []);

  const stopMarqueeEvent = useCallback((event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, []);

  const removeMarqueeListeners = useCallback(() => {
    const listeners = marqueeListenersRef.current;
    if (!listeners) return;

    window.removeEventListener('pointermove', listeners.pointerMove, true);
    window.removeEventListener('pointerup', listeners.finish, true);
    window.removeEventListener('pointercancel', listeners.finish, true);
    window.removeEventListener('blur', listeners.finish, true);
    marqueeListenersRef.current = null;
  }, []);

  const handleMarqueeMove = useCallback((event: PointerEvent) => {
    const current = marqueeRef.current;
    const viewport = viewportRef.current;
    if (!current || !viewport || event.pointerId !== current.pointerId) return;

    stopMarqueeEvent(event);
    const bounds = viewport.getBoundingClientRect();
    const next = {
      ...current,
      currentX: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      currentY: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    };
    marqueeRef.current = next;
    setMarquee(next);
  }, [stopMarqueeEvent]);

  const finishMarquee = useCallback((event?: Event) => {
    const current = marqueeRef.current;
    const viewport = viewportRef.current;
    if (!current || !viewport) return;
    if (event instanceof PointerEvent && event.pointerId !== current.pointerId) return;
    if (event) stopMarqueeEvent(event);

    const startedFromAndroidButton = marqueeFromAndroidButtonRef.current;
    removeMarqueeListeners();
    marqueeRef.current = null;
    marqueeFromAndroidButtonRef.current = false;
    setMarquee(null);
    if (startedFromAndroidButton) setAndroidMarqueeArmed(false);

    const width = Math.abs(current.currentX - current.startX);
    const height = Math.abs(current.currentY - current.startY);
    suppressNextClickRef.current = true;
    if (width < 4 || height < 4) return;

    const viewportBounds = viewport.getBoundingClientRect();
    const rect: SelectionRect = {
      left: viewportBounds.left + Math.min(current.startX, current.currentX),
      top: viewportBounds.top + Math.min(current.startY, current.currentY),
      right: viewportBounds.left + Math.max(current.startX, current.currentX),
      bottom: viewportBounds.top + Math.max(current.startY, current.currentY)
    };
    const ids = selectionApiRef.current?.idsInRect(rect) ?? [];
    selectMany(ids, event instanceof PointerEvent && event.shiftKey);
  }, [removeMarqueeListeners, selectMany, stopMarqueeEvent]);

  useEffect(() => () => {
    removeMarqueeListeners();
    marqueeRef.current = null;
    marqueeFromAndroidButtonRef.current = false;
  }, [removeMarqueeListeners]);

  useEffect(() => {
    if (!paintSettings.enabled || !androidMarqueeArmed) return;
    // Der Android-Auswahlmodus darf im Malmodus nicht aktiv bleiben.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAndroidMarqueeArmed(false);
  }, [androidMarqueeArmed, paintSettings.enabled]);

  const startMarquee = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-android-marquee-button="true"]')) return;
    viewportRef.current?.focus();
    const androidMarquee = isAndroidMarqueePointer(nativeAndroid, androidMarqueeArmed, event.pointerType);
    if (
      paintSettings.enabled
      || event.button !== 0
      || (!event.ctrlKey && !androidMarquee)
      || !viewportRef.current
      || marqueeRef.current
    ) return;

    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();

    const bounds = viewportRef.current.getBoundingClientRect();
    const state: MarqueeState = {
      pointerId: event.pointerId,
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
      currentX: event.clientX - bounds.left,
      currentY: event.clientY - bounds.top
    };
    marqueeRef.current = state;
    marqueeFromAndroidButtonRef.current = androidMarquee;
    suppressNextClickRef.current = false;
    setMarquee(state);

    removeMarqueeListeners();
    const listeners = {
      pointerMove: handleMarqueeMove,
      finish: finishMarquee
    };
    marqueeListenersRef.current = listeners;
    window.addEventListener('pointermove', listeners.pointerMove, true);
    window.addEventListener('pointerup', listeners.finish, true);
    window.addEventListener('pointercancel', listeners.finish, true);
    window.addEventListener('blur', listeners.finish, true);
  }, [
    androidMarqueeArmed,
    finishMarquee,
    handleMarqueeMove,
    nativeAndroid,
    paintSettings.enabled,
    removeMarqueeListeners
  ]);

  const marqueeStyle = marquee ? {
    left: Math.min(marquee.startX, marquee.currentX),
    top: Math.min(marquee.startY, marquee.currentY),
    width: Math.abs(marquee.currentX - marquee.startX),
    height: Math.abs(marquee.currentY - marquee.startY)
  } : undefined;

  return (
    <div
      ref={viewportRef}
      className="viewport"
      tabIndex={0}
      onPointerDownCapture={startMarquee}
      onClickCapture={(event) => {
        if (!suppressNextClickRef.current) return;
        suppressNextClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onFocus={() => setKeyboardActive(true)}
      onBlur={() => setKeyboardActive(false)}
    >
      <Canvas
        shadows
        camera={{ position: [6, 5, 7], fov: 45, near: 0.05, far: 500 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={(event) => {
          if (!paintSettings.enabled && event.button === 0 && !event.ctrlKey && !suppressNextClickRef.current) select(null);
        }}
      >
        <EditorScene
          keyboardActive={keyboardActive}
          selectionActive={Boolean(marquee) || androidMarqueeArmed}
          registry={registry}
          onSelectionApi={registerSelectionApi}
          paintSettings={paintSettings}
        />
      </Canvas>
      {nativeAndroid && (
        <AndroidMarqueeButton
          active={androidMarqueeArmed}
          disabled={paintSettings.enabled}
          onToggle={() => {
            viewportRef.current?.focus();
            setAndroidMarqueeArmed((current) => !current);
          }}
        />
      )}
      {marquee && <div className="selection-marquee" style={marqueeStyle} />}
      {paintSettings.enabled && (
        <div style={{
          position: 'absolute', left: 12, top: 12, zIndex: 10, pointerEvents: 'none',
          padding: '6px 9px', border: '1px solid #68a47d', borderRadius: 4,
          background: 'rgba(25, 48, 36, 0.9)', color: '#dff4e7', fontSize: 12
        }}>
          Malmodus aktiv · direkt auf das ausgewählte Objekt malen
        </div>
      )}
      <div className="viewport-hint">
        {paintSettings.enabled
          ? 'Malmodus: Mausrad-Zoom und Perspektivwechsel verfügbar · Transformation gesperrt'
          : 'Strg + Linksklick-Ziehen: Auswahlrahmen · Shift + Linksklick: Mehrfachauswahl · Strg + G: gruppieren'}
      </div>
    </div>
  );
}
