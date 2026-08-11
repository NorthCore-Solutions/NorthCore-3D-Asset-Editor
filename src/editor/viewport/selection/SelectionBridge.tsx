import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MeshRegistry, SelectionApi } from '../viewportTypes';

export function SelectionBridge({ registry, onReady }: { registry: MeshRegistry; onReady: (api: SelectionApi) => void }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const api: SelectionApi = {
      idsInRect: (rect) => {
        const canvasRect = gl.domElement.getBoundingClientRect();
        const ids: string[] = [];
        for (const [id, mesh] of registry.current) {
          if (!mesh.visible) continue;
          mesh.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(mesh);
          if (box.isEmpty()) continue;
          const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z), new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z), new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z), new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z)
          ];
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          for (const corner of corners) {
            const projected = corner.project(camera);
            const x = canvasRect.left + (projected.x + 1) * canvasRect.width * 0.5;
            const y = canvasRect.top + (1 - projected.y) * canvasRect.height * 0.5;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
          const intersects = maxX >= rect.left && minX <= rect.right && maxY >= rect.top && minY <= rect.bottom;
          if (intersects) ids.push(id);
        }
        return ids;
      }
    };

    onReady(api);
  }, [camera, gl, onReady, registry]);

  return null;
}
