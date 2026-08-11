import { useEffect, useMemo, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData } from '../../types/editor';
import { isFormType } from '../snapping/primitiveSurfaceSnap';
import { useSurfacePaint } from '../paint/useSurfacePaint';
import type { SurfacePaintSettings } from '../paint/surfacePaintSession';
import { useViewportPerformance } from './useViewportPerformance';
import { useObjectDimensionsOverlay } from '../measurement/useObjectDimensionsOverlay';
import { useSceneMaterialSync } from '../material/useSceneMaterialSync';
import { PrimitiveSnapPattern } from './PrimitiveSnapPattern';
import { ScaleHandles } from './transform/ScaleControls';
import { SingleTranslateControls } from './transform/SingleTranslateControls';
import type { MeshRegistry } from './viewportTypes';

export function SceneMesh({ object, registry, snapTargetId, onSnapTargetChange, onTransformDraggingChange, paintSettings }: {
  object: SceneObjectData;
  registry: MeshRegistry;
  snapTargetId: string | null;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
  paintSettings: SurfacePaintSettings;
}) {
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const geometry = useMemo(() => createGeometry({ type: object.type, geometry: object.geometry }), [object.geometry, object.type]);
  const selected = selectedIds.includes(object.id);
  const singleSelection = selected && selectedIds.length === 1;
  const paint = useSurfacePaint(object, singleSelection, paintSettings, geometry);
  useViewportPerformance(object, geometry);
  useObjectDimensionsOverlay(object, geometry);
  useSceneMaterialSync(object, geometry, paint.texture);

  const snapToolActive = tool === 'translate' || tool === 'scale';
  const showSnapPattern = !paintSettings.enabled
    && snap.surface
    && snapToolActive
    && isFormType(object.type)
    && !selected
    && object.visible;

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    if (mesh) registry.current.set(object.id, mesh);
    return () => { registry.current.delete(object.id); };
  }, [mesh, object.id, registry]);

  const syncRotation = () => {
    if (!mesh) return;
    updateObject(object.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
    }, false);
  };

  const startRotation = () => {
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
  };

  const stopRotation = () => {
    syncRotation();
    endTransaction();
    onTransformDraggingChange(false);
  };

  return (
    <>
      <mesh
        ref={setMesh}
        name={object.name}
        geometry={geometry}
        position={object.position}
        rotation={object.rotation}
        scale={object.scale}
        visible={object.visible}
        castShadow
        receiveShadow
        onPointerDown={(event) => {
          if (paintSettings.enabled) {
            paint.onPointerDown(event);
            event.stopPropagation();
            return;
          }
          if (event.button === 2) event.stopPropagation();
        }}
        onPointerMove={paint.onPointerMove}
        onPointerUp={paint.onPointerUp}
        onPointerCancel={paint.onPointerCancel}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          if (paintSettings.enabled) return;
          select(object.id, event.shiftKey);
        }}
      >
        <meshStandardMaterial
          map={paint.texture}
          color={paint.texture ? '#FFFFFF' : object.material.color}
          roughness={object.material.roughness}
          metalness={object.material.metalness}
          opacity={object.material.opacity}
          transparent={object.material.opacity < 1 || Boolean(paint.texture)}
          alphaTest={paint.texture ? 0.001 : 0}
          flatShading={object.material.flatShading}
          emissive="#000000"
          emissiveIntensity={0}
        />
      </mesh>

      {showSnapPattern && (
        <PrimitiveSnapPattern
          geometry={geometry}
          object={object}
          cellSize={snap.position}
          highlighted={snapTargetId === object.id}
        />
      )}

      {!paintSettings.enabled && singleSelection && !object.locked && object.visible && mesh && (
        tool === 'scale' ? (
          <ScaleHandles
            mesh={mesh}
            geometry={geometry}
            object={object}
            snap={snap}
            onSnapTargetChange={onSnapTargetChange}
            onTransformDraggingChange={onTransformDraggingChange}
          />
        ) : tool === 'translate' ? (
          <SingleTranslateControls
            mesh={mesh}
            geometry={geometry}
            object={object}
            snap={snap}
            onSnapTargetChange={onSnapTargetChange}
            onTransformDraggingChange={onTransformDraggingChange}
          />
        ) : (
          <TransformControls
            object={mesh}
            mode="rotate"
            space="world"
            size={1.4}
            rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}
            onMouseDown={startRotation}
            onObjectChange={syncRotation}
            onMouseUp={stopRotation}
          />
        )
      )}
    </>
  );
}
