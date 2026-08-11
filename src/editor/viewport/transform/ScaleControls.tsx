import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { findFormSurfaceSnap, isFormType } from '../../snapping/primitiveSurfaceSnap';
import { invertHexColor } from '../../paint/useSurfacePaint';
import { useEditorStore } from '../../../store/editorStore';
import type { SceneObjectData, SnapSettings } from '../../../types/editor';
import {
  isScaleAxisHandleVisible,
  type ScaleAxis,
  type ScaleSide
} from '../scaleAxisHandleVisibility';
import type { OrbitControlApi } from '../viewportTypes';

type CornerSides = [ScaleSide, ScaleSide, ScaleSide];

interface AxisScaleDragState {
  kind: 'axis';
  axis: ScaleAxis;
  side: ScaleSide;
  pointerId: number;
  startPointer: THREE.Vector2;
  screenAxis: THREE.Vector2;
  pixelsPerWorldUnit: number;
  anchorCoordinate: number;
  localSize: number;
  startPosition: THREE.Vector3;
  startScale: THREE.Vector3;
  worldAxis: THREE.Vector3;
}

interface UniformScaleDragState {
  kind: 'uniform';
  pointerId: number;
  startPointer: THREE.Vector2;
  screenAxis: THREE.Vector2;
  pixelsPerWorldUnit: number;
  startDiagonalWorld: number;
  worldDirection: THREE.Vector3;
  anchorLocal: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startScale: THREE.Vector3;
}

interface CenterScaleDragState {
  kind: 'center';
  pointerId: number;
  startPointer: THREE.Vector2;
  anchorLocal: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startScale: THREE.Vector3;
  pixelsPerFactor: number;
}

type ScaleDragState = AxisScaleDragState | UniformScaleDragState | CenterScaleDragState;

const SCALE_HANDLE_SIZE_RATIO = 0.06;
const CENTER_SCALE_VISUAL_RADIUS = 0.11;
const CENTER_SCALE_HITBOX_RADIUS = 0.28;
const CORNER_SCALE_VISUAL_SIZE = 1.16;
const CORNER_SCALE_HITBOX_SIZE = 1.55;
const SCALE_GIZMO_SIZE = 1.15;
const SCALE_ARROW_SHAFT_GEOMETRY = new THREE.CylinderGeometry(0.0075, 0.0075, 0.5, 3);
SCALE_ARROW_SHAFT_GEOMETRY.translate(0, 0.25, 0);
const SCALE_ARROW_TIP_GEOMETRY = new THREE.CylinderGeometry(0, 0.04, 0.1, 12);
SCALE_ARROW_TIP_GEOMETRY.translate(0, 0.05, 0);
const SCALE_ARROW_PICKER_GEOMETRY = new THREE.CylinderGeometry(0.2, 0, 0.6, 4);
const scaleHandleEye = new THREE.Vector3();
const scaleHandleAxis = new THREE.Vector3();
const scaleHandleCenter = new THREE.Vector3();
const scaleHandleQuaternion = new THREE.Quaternion();
const CORNERS: CornerSides[] = [
  [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
  [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]
];

const axisValue = (vector: THREE.Vector3, axis: ScaleAxis): number => {
  if (axis === 'X') return vector.x;
  if (axis === 'Y') return vector.y;
  return vector.z;
};

const setAxisValue = (vector: THREE.Vector3, axis: ScaleAxis, value: number): void => {
  if (axis === 'X') vector.x = value;
  else if (axis === 'Y') vector.y = value;
  else vector.z = value;
};

const axisVector = (axis: ScaleAxis, value: number): THREE.Vector3 => {
  if (axis === 'X') return new THREE.Vector3(value, 0, 0);
  if (axis === 'Y') return new THREE.Vector3(0, value, 0);
  return new THREE.Vector3(0, 0, value);
};

const boundingValue = (box: THREE.Box3, axis: ScaleAxis, side: 'min' | 'max'): number => {
  const vector = side === 'min' ? box.min : box.max;
  return axisValue(vector, axis);
};

const cornerPoint = (bounds: THREE.Box3, sides: CornerSides): THREE.Vector3 => new THREE.Vector3(
  sides[0] === 1 ? bounds.max.x : bounds.min.x,
  sides[1] === 1 ? bounds.max.y : bounds.min.y,
  sides[2] === 1 ? bounds.max.z : bounds.min.z
);

const scaleHandleWorldSize = (mesh: THREE.Mesh, bounds: THREE.Box3): number => {
  const localSize = bounds.getSize(new THREE.Vector3());
  const averageWorldSize = (
    Math.abs(localSize.x * mesh.scale.x)
    + Math.abs(localSize.y * mesh.scale.y)
    + Math.abs(localSize.z * mesh.scale.z)
  ) / 3;
  return Math.max(0.0001, averageWorldSize * SCALE_HANDLE_SIZE_RATIO);
};

const scaleGizmoWorldScale = (camera: THREE.Camera, worldPosition: THREE.Vector3): number => {
  let factor: number;
  const orthographic = camera as THREE.OrthographicCamera;
  if (orthographic.isOrthographicCamera) {
    factor = (orthographic.top - orthographic.bottom) / orthographic.zoom;
  } else {
    const perspective = camera as THREE.PerspectiveCamera;
    factor = worldPosition.distanceTo(camera.position) * Math.min(1.9 * Math.tan((Math.PI * perspective.fov) / 360) / perspective.zoom, 7);
  }
  return (factor * SCALE_GIZMO_SIZE) / 4;
};

const cameraEyeVector = (camera: THREE.Camera, worldPosition: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 => {
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    return camera.getWorldDirection(target).negate();
  }
  return target.copy(camera.position).sub(worldPosition).normalize();
};

function ScaleHandle({ mesh, bounds, axis, side, color, onPointerDown }: {
  mesh: THREE.Mesh;
  bounds: THREE.Box3;
  axis: ScaleAxis;
  side: ScaleSide;
  color: string;
  onPointerDown: (axis: ScaleAxis, side: ScaleSide, event: ThreeEvent<PointerEvent>) => void;
}) {
  const handleRef = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const arrowRotation = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisVector(axis, side)),
    [axis, side]
  );

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;
    mesh.updateMatrixWorld();
    const localPoint = bounds.getCenter(new THREE.Vector3());
    const edge = boundingValue(bounds, axis, side === 1 ? 'max' : 'min');
    setAxisValue(localPoint, axis, edge);
    handle.position.copy(mesh.localToWorld(localPoint));
    handle.quaternion.copy(mesh.quaternion);
    handle.scale.setScalar(scaleGizmoWorldScale(camera, handle.position));

    mesh.getWorldQuaternion(scaleHandleQuaternion);
    scaleHandleAxis.copy(axisVector(axis, side)).applyQuaternion(scaleHandleQuaternion);
    bounds.getCenter(scaleHandleCenter);
    mesh.localToWorld(scaleHandleCenter);
    cameraEyeVector(camera, scaleHandleCenter, scaleHandleEye);
    handle.visible = isScaleAxisHandleVisible(scaleHandleAxis, scaleHandleEye);
  });

  return (
    <group ref={handleRef} renderOrder={1000}>
      <group quaternion={arrowRotation}>
        <mesh geometry={SCALE_ARROW_SHAFT_GEOMETRY} renderOrder={1000}>
          <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} depthWrite={false} fog={false} toneMapped={false} />
        </mesh>
        <mesh geometry={SCALE_ARROW_TIP_GEOMETRY} position={[0, 0.5, 0]} renderOrder={1000}>
          <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} depthWrite={false} fog={false} toneMapped={false} />
        </mesh>
        <mesh geometry={SCALE_ARROW_PICKER_GEOMETRY} position={[0, 0.3, 0]} renderOrder={1000} onPointerDown={(event) => onPointerDown(axis, side, event)}>
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} fog={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function CenterScaleHandle({ mesh, bounds, color, onPointerDown }: {
  mesh: THREE.Mesh;
  bounds: THREE.Box3;
  color: string;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const handleRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;

    mesh.updateMatrixWorld(true);
    const localCenter = bounds.getCenter(new THREE.Vector3());
    handle.position.copy(mesh.localToWorld(localCenter));
    handle.quaternion.identity();
    handle.scale.setScalar(scaleHandleWorldSize(mesh, bounds) / 0.2);
  });

  return (
    <group ref={handleRef} renderOrder={Infinity}>
      <mesh renderOrder={Infinity}>
        <octahedronGeometry args={[CENTER_SCALE_VISUAL_RADIUS, 0]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <mesh renderOrder={Infinity} onPointerDown={onPointerDown}>
        <octahedronGeometry args={[CENTER_SCALE_HITBOX_RADIUS, 0]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function CornerScaleHandle({ mesh, bounds, sides, onPointerDown }: {
  mesh: THREE.Mesh;
  bounds: THREE.Box3;
  sides: CornerSides;
  onPointerDown: (sides: CornerSides, event: ThreeEvent<PointerEvent>) => void;
}) {
  const handleRef = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;
    mesh.updateMatrixWorld();
    const localPoint = cornerPoint(bounds, sides);
    handle.position.copy(mesh.localToWorld(localPoint));
    handle.quaternion.copy(camera.quaternion);
    handle.scale.setScalar(scaleHandleWorldSize(mesh, bounds));
  });

  return (
    <group ref={handleRef} renderOrder={1001}>
      <mesh renderOrder={1001}>
        <planeGeometry args={[CORNER_SCALE_VISUAL_SIZE, CORNER_SCALE_VISUAL_SIZE]} />
        <meshBasicMaterial color="#ffff00" transparent opacity={0.48} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh renderOrder={1002} onPointerDown={(event) => onPointerDown(sides, event)}>
        <planeGeometry args={[CORNER_SCALE_HITBOX_SIZE, CORNER_SCALE_HITBOX_SIZE]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function ScaleHandles({ mesh, geometry, object, snap, onSnapTargetChange, onTransformDraggingChange }: {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  object: SceneObjectData;
  snap: SnapSettings;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const objects = useEditorStore((state) => state.objects);
  const dragRef = useRef<ScaleDragState | null>(null);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.clone() ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  }, [geometry]);

  const removeWindowListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', finishDrag, true);
    window.removeEventListener('pointercancel', finishDrag, true);
    window.removeEventListener('blur', finishDrag, true);
  };

  const syncTransform = () => {
    updateObject(object.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
    }, false);
  };

  const applySurfaceScaleSnap = (drag: ScaleDragState) => {
    if (drag.kind === 'center') {
      onSnapTargetChange(null);
      return;
    }

    if (!snap.surface || !isFormType(object.type)) {
      onSnapTargetChange(null);
      return;
    }

    const candidate: SceneObjectData = {
      ...object,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
    };
    const result = findFormSurfaceSnap(candidate, objects, snap.position);
    if (!result.targetId) {
      onSnapTargetChange(null);
      return;
    }

    const correction = new THREE.Vector3(...result.position).sub(mesh.position);
    const correctionLength = correction.length();
    if (correctionLength <= 0.000001) {
      onSnapTargetChange(result.targetId);
      return;
    }

    if (drag.kind === 'axis') {
      const outwardAxis = drag.worldAxis.clone().multiplyScalar(drag.side);
      const projectedCorrection = correction.dot(outwardAxis);
      const alignment = Math.abs(projectedCorrection) / correctionLength;
      if (alignment < 0.7) {
        onSnapTargetChange(null);
        return;
      }

      const startScale = axisValue(drag.startScale, drag.axis);
      const currentScale = axisValue(mesh.scale, drag.axis);
      const snappedScale = Math.max(0.02, currentScale + projectedCorrection / drag.localSize);
      setAxisValue(mesh.scale, drag.axis, snappedScale);
      const anchorOffset = drag.anchorCoordinate * (startScale - snappedScale);
      mesh.position.copy(drag.startPosition).addScaledVector(drag.worldAxis, anchorOffset);
      mesh.updateMatrixWorld(true);
      onSnapTargetChange(result.targetId);
      return;
    }

    const projectedCorrection = correction.dot(drag.worldDirection);
    const alignment = Math.abs(projectedCorrection) / correctionLength;
    if (alignment < 0.35) {
      onSnapTargetChange(null);
      return;
    }

    const factors = [
      Math.abs(drag.startScale.x) > 0.000001 ? mesh.scale.x / drag.startScale.x : 1,
      Math.abs(drag.startScale.y) > 0.000001 ? mesh.scale.y / drag.startScale.y : 1,
      Math.abs(drag.startScale.z) > 0.000001 ? mesh.scale.z / drag.startScale.z : 1
    ];
    const currentFactor = factors.reduce((sum, factor) => sum + factor, 0) / factors.length;
    const snappedFactor = Math.max(0.02, currentFactor + projectedCorrection / drag.startDiagonalWorld);
    const snappedScale = drag.startScale.clone().multiplyScalar(snappedFactor);
    mesh.scale.copy(snappedScale);
    const localOffset = new THREE.Vector3(
      drag.anchorLocal.x * (drag.startScale.x - snappedScale.x),
      drag.anchorLocal.y * (drag.startScale.y - snappedScale.y),
      drag.anchorLocal.z * (drag.startScale.z - snappedScale.z)
    ).applyQuaternion(drag.startQuaternion);
    mesh.position.copy(drag.startPosition).add(localOffset);
    mesh.updateMatrixWorld(true);
    onSnapTargetChange(result.targetId);
  };

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    if (drag.kind === 'center') {
      const upwardPixels = drag.startPointer.y - event.clientY;
      let factor = Math.max(0.02, 1 + upwardPixels / drag.pixelsPerFactor);
      if (snap.enabled && snap.scale > 0) {
        factor = Math.max(0.02, Math.round(factor / snap.scale) * snap.scale);
      }
      const nextScale = drag.startScale.clone().multiplyScalar(factor);
      mesh.scale.copy(nextScale);
      const localOffset = new THREE.Vector3(
        drag.anchorLocal.x * (drag.startScale.x - nextScale.x),
        drag.anchorLocal.y * (drag.startScale.y - nextScale.y),
        drag.anchorLocal.z * (drag.startScale.z - nextScale.z)
      ).applyQuaternion(drag.startQuaternion);
      mesh.position.copy(drag.startPosition).add(localOffset);
      mesh.updateMatrixWorld();
      onSnapTargetChange(null);
      syncTransform();
      return;
    }

    const pointerDelta = new THREE.Vector2(event.clientX - drag.startPointer.x, event.clientY - drag.startPointer.y);
    const worldDelta = pointerDelta.dot(drag.screenAxis) / drag.pixelsPerWorldUnit;

    if (drag.kind === 'axis') {
      const startScale = axisValue(drag.startScale, drag.axis);
      const startWorldSize = drag.localSize * startScale;
      const minimumScale = 0.02;
      let nextScale = Math.max(minimumScale, (startWorldSize + worldDelta) / drag.localSize);
      if (snap.enabled && snap.scale > 0) nextScale = Math.max(minimumScale, Math.round(nextScale / snap.scale) * snap.scale);
      const nextScaleVector = drag.startScale.clone();
      setAxisValue(nextScaleVector, drag.axis, nextScale);
      mesh.scale.copy(nextScaleVector);
      const anchorOffset = drag.anchorCoordinate * (startScale - nextScale);
      mesh.position.copy(drag.startPosition).addScaledVector(drag.worldAxis, anchorOffset);
      mesh.updateMatrixWorld();
      applySurfaceScaleSnap(drag);
      syncTransform();
      return;
    }

    let factor = Math.max(0.02, (drag.startDiagonalWorld + worldDelta) / drag.startDiagonalWorld);
    if (snap.enabled && snap.scale > 0) factor = Math.max(0.02, Math.round(factor / snap.scale) * snap.scale);
    const nextScale = drag.startScale.clone().multiplyScalar(factor);
    mesh.scale.copy(nextScale);
    const localOffset = new THREE.Vector3(
      drag.anchorLocal.x * (drag.startScale.x - nextScale.x),
      drag.anchorLocal.y * (drag.startScale.y - nextScale.y),
      drag.anchorLocal.z * (drag.startScale.z - nextScale.z)
    ).applyQuaternion(drag.startQuaternion);
    mesh.position.copy(drag.startPosition).add(localOffset);
    mesh.updateMatrixWorld();
    applySurfaceScaleSnap(drag);
    syncTransform();
  }

  function finishDrag(event?: Event) {
    const drag = dragRef.current;
    if (!drag || (event instanceof PointerEvent && event.pointerId !== drag.pointerId)) return;
    event?.preventDefault();
    event?.stopPropagation();
    dragRef.current = null;
    removeWindowListeners();
    syncTransform();
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
    if (controls) controls.enabled = true;
  }

  const beginDrag = () => {
    if (controls) controls.enabled = false;
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finishDrag, true);
    window.addEventListener('pointercancel', finishDrag, true);
    window.addEventListener('blur', finishDrag, true);
  };

  const startAxisDrag = (axis: ScaleAxis, side: ScaleSide, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    const localSize = boundingValue(bounds, axis, 'max') - boundingValue(bounds, axis, 'min');
    if (localSize <= 0.000001) return;
    const startQuaternion = mesh.quaternion.clone();
    const positiveWorldAxis = axisVector(axis, 1).applyQuaternion(startQuaternion).normalize();
    const outwardWorldAxis = positiveWorldAxis.clone().multiplyScalar(side);
    const centerProjected = mesh.position.clone().project(camera);
    const axisProjected = mesh.position.clone().add(outwardWorldAxis).project(camera);
    const screenAxis = new THREE.Vector2((axisProjected.x - centerProjected.x) * size.width * 0.5, -(axisProjected.y - centerProjected.y) * size.height * 0.5);
    const pixelsPerWorldUnit = screenAxis.length();
    if (pixelsPerWorldUnit < 2) return;
    screenAxis.normalize();
    dragRef.current = {
      kind: 'axis', axis, side, pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY), screenAxis, pixelsPerWorldUnit,
      anchorCoordinate: boundingValue(bounds, axis, side === 1 ? 'min' : 'max'), localSize,
      startPosition: mesh.position.clone(), startScale: mesh.scale.clone(), worldAxis: positiveWorldAxis
    };
    beginDrag();
  };

  const startCenterDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    const anchorLocal = bounds.getCenter(new THREE.Vector3());
    anchorLocal.y = bounds.min.y;
    dragRef.current = {
      kind: 'center',
      pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY),
      anchorLocal,
      startPosition: mesh.position.clone(),
      startQuaternion: mesh.quaternion.clone(),
      startScale: mesh.scale.clone(),
      pixelsPerFactor: 140
    };
    beginDrag();
  };

  const startUniformDrag = (sides: CornerSides, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    const startQuaternion = mesh.quaternion.clone();
    const draggedLocal = cornerPoint(bounds, sides);
    const oppositeSides = [-sides[0], -sides[1], -sides[2]] as CornerSides;
    const anchorLocal = cornerPoint(bounds, oppositeSides);
    const scaledDiagonal = draggedLocal.clone().sub(anchorLocal).multiply(mesh.scale);
    const startDiagonalWorld = scaledDiagonal.length();
    if (startDiagonalWorld <= 0.000001) return;
    const worldDirection = scaledDiagonal.applyQuaternion(startQuaternion).normalize();
    const centerProjected = mesh.position.clone().project(camera);
    const axisProjected = mesh.position.clone().add(worldDirection).project(camera);
    const screenAxis = new THREE.Vector2((axisProjected.x - centerProjected.x) * size.width * 0.5, -(axisProjected.y - centerProjected.y) * size.height * 0.5);
    const pixelsPerWorldUnit = screenAxis.length();
    if (pixelsPerWorldUnit < 2) return;
    screenAxis.normalize();
    dragRef.current = {
      kind: 'uniform', pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY), screenAxis, pixelsPerWorldUnit,
      startDiagonalWorld, worldDirection, anchorLocal, startPosition: mesh.position.clone(), startQuaternion, startScale: mesh.scale.clone()
    };
    beginDrag();
  };

  useEffect(() => () => {
    if (!dragRef.current) return;
    removeWindowListeners();
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();
    if (controls) controls.enabled = true;
    onTransformDraggingChange(false);
  }, [controls, endTransaction, onSnapTargetChange, onTransformDraggingChange]);

  return (
    <>
      <CenterScaleHandle
        mesh={mesh}
        bounds={bounds}
        color={invertHexColor(object.material.color)}
        onPointerDown={startCenterDrag}
      />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="X" side={-1} color="#ff0000" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="X" side={1} color="#ff0000" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Y" side={-1} color="#00ff00" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Y" side={1} color="#00ff00" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Z" side={-1} color="#0000ff" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Z" side={1} color="#0000ff" onPointerDown={startAxisDrag} />
      {CORNERS.map((sides) => <CornerScaleHandle key={sides.join(':')} mesh={mesh} bounds={bounds} sides={sides} onPointerDown={startUniformDrag} />)}
    </>
  );
}
