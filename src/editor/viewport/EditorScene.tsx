import { useEffect, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { SurfacePaintSettings } from '../paint/surfacePaintSession';
import { isNativeAndroid } from '../../platform/nativeFileDialog';
import { AndroidTouchZoomControls } from './AndroidTouchZoomControls';
import { CompositeSnapPattern } from './CompositeSnapPattern';
import { CameraController } from './camera/CameraController';
import { KeyboardCameraControls } from './camera/KeyboardCameraControls';
import { GroupTransformControls } from './transform/GroupTransformControls';
import { SelectionBridge } from './selection/SelectionBridge';
import { SceneMesh } from './SceneMesh';
import { GRID_EXTENT, StableGrid } from './StableGrid';
import { useNeutralMaterialEnvironment } from './useSceneEnvironment';
import type { MeshRegistry, SelectionApi } from './viewportTypes';

export function EditorScene({ keyboardActive, selectionActive, registry, onSelectionApi, paintSettings }: {
  keyboardActive: boolean;
  selectionActive: boolean;
  registry: MeshRegistry;
  onSelectionApi: (api: SelectionApi) => void;
  paintSettings: SurfacePaintSettings;
}) {
  const objects = useEditorStore((state) => state.objects);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);
  const [transformDragging, setTransformDragging] = useState(false);
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null);
  const nativeAndroid = isNativeAndroid();
  const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
  const groupMovable = !paintSettings.enabled
    && selectedObjects.length > 1
    && selectedObjects.every((object) => object.visible && !object.locked);

  useNeutralMaterialEnvironment();

  useEffect(() => {
    // Der Highlight-Zustand muss synchron mit dem externen Snapping-Modus zurückgesetzt werden.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!snap.surface || (tool !== 'translate' && tool !== 'scale') || paintSettings.enabled) setSnapTargetId(null);
  }, [paintSettings.enabled, snap.surface, tool]);

  return (
    <>
      <color attach="background" args={[scene.background]} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[6, 10, 5]} intensity={2.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <hemisphereLight args={['#dbe7ee', '#2a312c', 0.8]} />
      {scene.gridVisible && <StableGrid cellSize={scene.gridSize} />}
      {scene.axesVisible && <axesHelper args={[3]} />}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        onClick={(event) => {
          if (!paintSettings.enabled && event.button === 0 && !event.ctrlKey) select(null);
        }}
      >
        <planeGeometry args={[GRID_EXTENT, GRID_EXTENT]} />
        <shadowMaterial opacity={0.14} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {objects.map((object) => (
        <SceneMesh
          key={object.id}
          object={object}
          registry={registry}
          snapTargetId={snapTargetId}
          onSnapTargetChange={setSnapTargetId}
          onTransformDraggingChange={setTransformDragging}
          paintSettings={paintSettings}
        />
      ))}
      {groupMovable && snap.surface && (tool === 'translate' || tool === 'scale') && (
        <CompositeSnapPattern
          objects={selectedObjects}
          highlighted={snapTargetId === 'selected-composite'}
        />
      )}
      {groupMovable && (
        <GroupTransformControls
          selectedIds={selectedIds}
          registry={registry}
          tool={tool}
          snap={snap}
          onSnapTargetChange={setSnapTargetId}
          onTransformDraggingChange={setTransformDragging}
        />
      )}
      <OrbitControls
        makeDefault
        enabled={!transformDragging && !selectionActive}
        enablePan={!paintSettings.enabled}
        enableRotate={!paintSettings.enabled}
        enableZoom={!nativeAndroid}
        zoomToCursor
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
      />
      <AndroidTouchZoomControls active={nativeAndroid && !transformDragging && !selectionActive} />
      <KeyboardCameraControls active={!paintSettings.enabled && keyboardActive && !transformDragging && !selectionActive} />
      <CameraController active />
      <SelectionBridge registry={registry} onReady={onSelectionApi} />
    </>
  );
}
