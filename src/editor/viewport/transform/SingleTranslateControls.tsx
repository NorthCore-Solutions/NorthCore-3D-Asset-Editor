import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  createTranslationSurfaceSnapSession,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession
} from '../../snapping/translationSurfaceSnap';
import { isFormType } from '../../snapping/primitiveSurfaceSnap';
import { useEditorStore } from '../../../store/editorStore';
import type { SceneObjectData, SnapSettings } from '../../../types/editor';

interface SingleTranslateDragState {
  lastRawProxyPosition: THREE.Vector3;
  rawMeshWorldPosition: THREE.Vector3;
  surfaceSnapSession: TranslationSurfaceSnapSession;
}

export function SingleTranslateControls({
  mesh,
  geometry,
  object,
  snap,
  onSnapTargetChange,
  onTransformDraggingChange
}: {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  object: SceneObjectData;
  snap: SnapSettings;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const proxy = useMemo(() => new THREE.Object3D(), []);
  const dragRef = useRef<SingleTranslateDragState | null>(null);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const localCenter = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  }, [geometry]);

  const resetProxy = useCallback(() => {
    mesh.updateMatrixWorld(true);
    proxy.position.copy(mesh.localToWorld(localCenter.clone()));
    proxy.rotation.set(0, 0, 0);
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld(true);
  }, [localCenter, mesh, proxy]);

  useFrame(() => {
    if (!dragRef.current) resetProxy();
  });

  const start = () => {
    resetProxy();
    dragRef.current = {
      lastRawProxyPosition: proxy.position.clone(),
      rawMeshWorldPosition: mesh.getWorldPosition(new THREE.Vector3()),
      surfaceSnapSession: createTranslationSurfaceSnapSession()
    };
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
  };

  const sync = () => {
    const drag = dragRef.current;
    if (!drag) return;

    const rawProxyPosition = proxy.position.clone();
    const rawDelta = rawProxyPosition.clone().sub(drag.lastRawProxyPosition);
    drag.lastRawProxyPosition.copy(rawProxyPosition);
    drag.rawMeshWorldPosition.add(rawDelta);

    const rawLocalPosition = mesh.parent
      ? mesh.parent.worldToLocal(drag.rawMeshWorldPosition.clone())
      : drag.rawMeshWorldPosition.clone();
    const nextWorldPosition = drag.rawMeshWorldPosition.clone();
    if (snap.enabled && snap.position > 0) {
      nextWorldPosition.set(
        Math.round(nextWorldPosition.x / snap.position) * snap.position,
        Math.round(nextWorldPosition.y / snap.position) * snap.position,
        Math.round(nextWorldPosition.z / snap.position) * snap.position
      );
    }
    const nextLocalPosition = mesh.parent
      ? mesh.parent.worldToLocal(nextWorldPosition.clone())
      : nextWorldPosition;
    mesh.position.copy(nextLocalPosition);
    mesh.updateMatrixWorld(true);

    let position: SceneObjectData['position'] = [
      mesh.position.x,
      mesh.position.y,
      mesh.position.z
    ];
    const rotation: SceneObjectData['rotation'] = [
      mesh.rotation.x,
      mesh.rotation.y,
      mesh.rotation.z
    ];
    const scale: SceneObjectData['scale'] = [
      mesh.scale.x,
      mesh.scale.y,
      mesh.scale.z
    ];

    if (snap.surface && isFormType(object.type)) {
      const liveObjects = useEditorStore.getState().objects;
      const resolution = resolveTranslationSurfaceSnap(
        { ...object, position, rotation, scale },
        liveObjects,
        snap.position,
        [rawLocalPosition.x, rawLocalPosition.y, rawLocalPosition.z],
        drag.surfaceSnapSession
      );
      drag.surfaceSnapSession = resolution.session;
      position = resolution.result.position;
      mesh.position.set(position[0], position[1], position[2]);
      mesh.updateMatrixWorld(true);
      onSnapTargetChange(resolution.result.targetId);
    } else {
      drag.surfaceSnapSession = createTranslationSurfaceSnapSession();
      onSnapTargetChange(null);
    }

    updateObject(object.id, { position, rotation, scale }, false);

    mesh.updateMatrixWorld(true);
    proxy.position.copy(mesh.localToWorld(localCenter.clone()));
    proxy.updateMatrixWorld(true);
  };

  const stop = () => {
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
    resetProxy();
  };

  useEffect(() => () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
  }, [endTransaction, onSnapTargetChange, onTransformDraggingChange]);

  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode="translate"
        space="world"
        size={1.15}
        translationSnap={undefined}
        onMouseDown={start}
        onObjectChange={sync}
        onMouseUp={stop}
      />
    </>
  );
}
