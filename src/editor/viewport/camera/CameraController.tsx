import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../../store/editorStore';
import type { OrbitControlApi } from '../viewportTypes';

export function CameraController({ active }: { active: boolean }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const cameraView = useEditorStore((state) => state.cameraView);
  const cameraRequestId = useEditorStore((state) => state.cameraRequestId);

  useEffect(() => {
    if (!active) return;
    const { objects, selectedIds } = useEditorStore.getState();
    const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
    const target = selectedObjects.length > 0
      ? selectedObjects.reduce((sum, object) => sum.add(new THREE.Vector3(...object.position)), new THREE.Vector3()).divideScalar(selectedObjects.length)
      : new THREE.Vector3(0, 0.8, 0);
    const distance = selectedObjects.length > 0
      ? Math.max(3.5, ...selectedObjects.map((object) => Math.max(...object.scale) * 4))
      : 8;
    const positions: Record<Exclude<typeof cameraView, 'focus'>, [number, number, number]> = {
      perspective: [target.x + 6, target.y + 5, target.z + 7],
      front: [target.x, target.y, target.z + distance],
      back: [target.x, target.y, target.z - distance],
      left: [target.x - distance, target.y, target.z],
      right: [target.x + distance, target.y, target.z],
      top: [target.x, target.y + distance, target.z + 0.001],
      bottom: [target.x, target.y - distance, target.z + 0.001]
    };
    const position: [number, number, number] = cameraView === 'focus'
      ? [target.x + distance, target.y + distance * 0.65, target.z + distance]
      : (positions[cameraView] ?? positions.perspective);
    camera.up.set(0, 1, 0);
    if (cameraView === 'top') camera.up.set(0, 0, -1);
    if (cameraView === 'bottom') camera.up.set(0, 0, 1);
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target);
    controls?.target.copy(target);
    controls?.update();
    camera.updateProjectionMatrix();
  }, [active, camera, cameraRequestId, cameraView, controls]);

  return null;
}
