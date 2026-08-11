import * as THREE from 'three';
import type { SceneObjectData } from '../types/editor';

function loadTexture(dataUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // Paint-Atlas und Editor verwenden die three.js-UV-Konvention. Der
      // GLTFExporter spiegelt das Bild bei flipY=true korrekt für glTF.
      texture.flipY = true;
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => reject(new Error('Bemalungstextur konnte nicht geladen werden.'));
    image.src = dataUrl;
  });
}

export async function loadPaintTextures(objects: SceneObjectData[]): Promise<Map<string, THREE.Texture>> {
  const urls = [...new Set(
    objects
      .map((object) => object.material.paintTexture?.dataUrl)
      .filter((url): url is string => Boolean(url))
  )];
  const entries = await Promise.all(urls.map(async (url) => [url, await loadTexture(url)] as const));
  return new Map(entries);
}

export function createExportMaterial(
  object: SceneObjectData,
  paintTextures: Map<string, THREE.Texture>
): THREE.MeshStandardMaterial {
  const paintUrl = object.material.paintTexture?.dataUrl;
  const map = paintUrl ? paintTextures.get(paintUrl) ?? null : null;
  return new THREE.MeshStandardMaterial({
    color: map ? '#FFFFFF' : object.material.color,
    map,
    roughness: object.material.roughness,
    metalness: object.material.metalness,
    opacity: object.material.opacity,
    transparent: object.material.opacity < 1 || Boolean(map),
    alphaTest: map ? 0.001 : 0,
    flatShading: object.material.flatShading
  });
}
