import { useCallback, useEffect, useMemo, useRef } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  createTranslationSurfaceSnapSession,
  resolveCompositeTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession
} from '../../snapping/translationSurfaceSnap';
import {
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects
} from '../../snapping/objectSurfaceSnap';
import { useEditorStore } from '../../../store/editorStore';
import type { SceneObjectData, SnapSettings, TransformMode } from '../../../types/editor';
import type { MeshRegistry } from '../viewportTypes';

interface GroupDragState {
  proxyMatrix: THREE.Matrix4;
  objectMatrices: Map<string, THREE.Matrix4>;
  surfaceSnapSession: TranslationSurfaceSnapSession;
}

export function GroupTransformControls({ selectedIds, registry, tool, snap, onSnapTargetChange, onTransformDraggingChange }: {
  selectedIds: string[];
  registry: MeshRegistry;
  tool: TransformMode;
  snap: SnapSettings;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const proxy = useMemo(() => new THREE.Object3D(), []);
  const dragRef = useRef<GroupDragState | null>(null);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const selectionKey = selectedIds.join(':');

  const resetProxy = useCallback(() => {
    const meshes = selectedIds.map((id) => registry.current.get(id)).filter((mesh): mesh is THREE.Mesh => Boolean(mesh));
    if (meshes.length === 0) return;
    const center = meshes.reduce((sum, mesh) => sum.add(mesh.getWorldPosition(new THREE.Vector3())), new THREE.Vector3()).divideScalar(meshes.length);
    proxy.position.copy(center);
    proxy.rotation.set(0, 0, 0);
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld(true);
  }, [proxy, registry, selectedIds]);

  useEffect(() => resetProxy(), [resetProxy, selectionKey]);

  const start = () => {
    resetProxy();
    const objectMatrices = new Map<string, THREE.Matrix4>();
    for (const id of selectedIds) {
      const mesh = registry.current.get(id);
      if (!mesh) continue;
      mesh.updateMatrixWorld(true);
      objectMatrices.set(id, mesh.matrixWorld.clone());
    }
    proxy.updateMatrixWorld(true);
    dragRef.current = {
      proxyMatrix: proxy.matrixWorld.clone(),
      objectMatrices,
      surfaceSnapSession: createTranslationSurfaceSnapSession()
    };
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
  };

  const sync = () => {
    const drag = dragRef.current;
    if (!drag) return;
    proxy.updateMatrixWorld(true);
    const rawProxyPosition = proxy.position.clone();
    const effectiveProxyPosition = rawProxyPosition.clone();
    if (tool === 'translate' && snap.enabled && snap.position > 0) {
      effectiveProxyPosition.set(
        Math.round(effectiveProxyPosition.x / snap.position) * snap.position,
        Math.round(effectiveProxyPosition.y / snap.position) * snap.position,
        Math.round(effectiveProxyPosition.z / snap.position) * snap.position
      );
    }

    const effectiveProxyMatrix = proxy.matrixWorld.clone();
    if (tool === 'translate') {
      effectiveProxyMatrix.setPosition(effectiveProxyPosition);
    }
    const delta = effectiveProxyMatrix.multiply(drag.proxyMatrix.clone().invert());
    const liveObjects = useEditorStore.getState().objects;
    const transformedObjects = new Map<string, SceneObjectData>();

    for (const [id, startMatrix] of drag.objectMatrices) {
      const mesh = registry.current.get(id);
      const storedObject = liveObjects.find((object) => object.id === id);
      if (!mesh || !storedObject) continue;
      const worldMatrix = delta.clone().multiply(startMatrix);
      const localMatrix = mesh.parent
        ? mesh.parent.matrixWorld.clone().invert().multiply(worldMatrix)
        : worldMatrix;
      localMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrixWorld(true);
      transformedObjects.set(id, {
        ...storedObject,
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
      });
    }

    if (tool === 'translate' && snap.surface && transformedObjects.size > 1) {
      const selectedObjects = selectedIds.flatMap((id) => {
        const object = transformedObjects.get(id);
        return object ? [object] : [];
      });
      const sourceTarget = surfaceSnapTargetFromSceneObjects(
        selectedObjects,
        'selected-composite'
      );
      const targetObjects = liveObjects.filter((object) => (
        object.visible && !selectedIds.includes(object.id)
      ));
      const targets = targetObjects.flatMap((object) => {
        const target = surfaceSnapTargetFromSceneObject(object);
        return target ? [target] : [];
      });

      if (sourceTarget) {
        const resolution = resolveCompositeTranslationSurfaceSnap(
          sourceTarget,
          targets,
          [rawProxyPosition.x, rawProxyPosition.y, rawProxyPosition.z],
          drag.surfaceSnapSession,
          Math.min(0.12, Math.max(0.04, Math.abs(snap.position) * 0.4))
        );
        drag.surfaceSnapSession = resolution.session;
        const sourceCenter = new THREE.Vector3().setFromMatrixPosition(sourceTarget.matrixWorld);
        const correction = new THREE.Vector3(...resolution.result.position).sub(sourceCenter);
        if (correction.lengthSq() > 0.0000000001) {
          for (const [id, transformedObject] of transformedObjects) {
            const mesh = registry.current.get(id);
            if (!mesh) continue;
            mesh.position.add(correction);
            mesh.updateMatrixWorld(true);
            transformedObjects.set(id, {
              ...transformedObject,
              position: [mesh.position.x, mesh.position.y, mesh.position.z]
            });
          }
        }
        proxy.position.copy(effectiveProxyPosition).add(correction);
        proxy.updateMatrixWorld(true);
        onSnapTargetChange(resolution.result.targetId);
      } else {
        drag.surfaceSnapSession = createTranslationSurfaceSnapSession();
        proxy.position.copy(effectiveProxyPosition);
        proxy.updateMatrixWorld(true);
        onSnapTargetChange(null);
      }
    } else {
      drag.surfaceSnapSession = createTranslationSurfaceSnapSession();
      if (tool === 'translate') {
        proxy.position.copy(effectiveProxyPosition);
        proxy.updateMatrixWorld(true);
      }
      onSnapTargetChange(null);
    }

    for (const [id, transformedObject] of transformedObjects) {
      updateObject(id, {
        position: transformedObject.position,
        rotation: transformedObject.rotation,
        scale: transformedObject.scale
      }, false);
    }
  };

  const stop = () => {
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
    resetProxy();
  };

  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode={tool}
        space="world"
        size={tool === 'rotate' ? 1.4 : 1.15}
        translationSnap={tool === 'translate' ? undefined : (snap.enabled ? snap.position : undefined)}
        rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}
        scaleSnap={snap.enabled ? snap.scale : undefined}
        onMouseDown={start}
        onObjectChange={sync}
        onMouseUp={stop}
      />
    </>
  );
}
