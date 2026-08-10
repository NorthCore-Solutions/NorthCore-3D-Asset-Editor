import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';
import { useEditorStore } from '../../store/editorStore';
import { APPLE_CUTTER_CELL_SIZE } from '../appleCutter/appleCutterAxisGrid';
import {
  buildGeometrySurfaceSnapAnchors,
  createSurfaceSnapPointsGeometry
} from '../snapping/surfaceSnapTopology';

const vertexShader = `
  varying vec3 vLocalPosition;
  varying vec3 vLocalNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vLocalPosition = position;
    vLocalNormal = normalize(normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uBoundsMin;
  uniform vec3 uBoundsMax;
  uniform vec3 uObjectScale;
  uniform float uCellSize;
  uniform float uGridOffset;
  uniform float uOpacity;

  varying vec3 vLocalPosition;
  varying vec3 vLocalNormal;

  float gridLine(float value) {
    float fraction = fract(value);
    float distanceToLine = min(fraction, 1.0 - fraction);
    return 1.0 - smoothstep(0.006, 0.022, distanceToLine);
  }

  float edgeLine(float value, float extent) {
    float distanceToEdge = min(abs(value), abs(extent - value));
    return 1.0 - smoothstep(0.006, 0.022, distanceToEdge);
  }

  void main() {
    float safeCellSize = max(uCellSize, 0.0001);
    vec3 center = (uBoundsMin + uBoundsMax) * 0.5;

    vec3 centeredCoordinates = ((vLocalPosition - center) * uObjectScale) / safeCellSize;
    vec3 edgeCoordinates = ((vLocalPosition - uBoundsMin) * uObjectScale) / safeCellSize;
    vec3 extents = ((uBoundsMax - uBoundsMin) * uObjectScale) / safeCellSize;
    vec3 axisLines = max(
      vec3(
        gridLine(centeredCoordinates.x - uGridOffset),
        gridLine(centeredCoordinates.y - uGridOffset),
        gridLine(centeredCoordinates.z - uGridOffset)
      ),
      vec3(
        edgeLine(edgeCoordinates.x, extents.x),
        edgeLine(edgeCoordinates.y, extents.y),
        edgeLine(edgeCoordinates.z, extents.z)
      )
    );

    // Rasterachsen und Position liegen im lokalen Raum; daher muss auch die
    // Flächengewichtung lokal bleiben. Rotation und nicht-uniforme Skalierung
    // dürfen nicht auf eine andere Rasterachse umschalten.
    vec3 normalWeight = pow(abs(normalize(vLocalNormal)), vec3(8.0));
    normalWeight /= max(normalWeight.x + normalWeight.y + normalWeight.z, 0.0001);

    float onXFace = max(axisLines.y, axisLines.z);
    float onYFace = max(axisLines.x, axisLines.z);
    float onZFace = max(axisLines.x, axisLines.y);
    float pattern = dot(vec3(onXFace, onYFace, onZFace), normalWeight);
    float alpha = pattern * uOpacity;

    if (alpha < 0.012) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

interface PrimitiveSnapPatternProps {
  geometry: THREE.BufferGeometry;
  object: SceneObjectData;
  cellSize: number;
  highlighted: boolean;
}

export function PrimitiveSnapPattern({ geometry, object, cellSize, highlighted }: PrimitiveSnapPatternProps) {
  void cellSize;
  const tool = useEditorStore((state) => state.tool);
  const translating = tool === 'translate';
  const scaleX = object.scale[0];
  const scaleY = object.scale[1];
  const scaleZ = object.scale[2];
  const objectScale = useMemo(
    () => new THREE.Vector3(scaleX, scaleY, scaleZ),
    [scaleX, scaleY, scaleZ]
  );
  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.clone()
      ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  }, [geometry]);
  const anchors = useMemo(
    () => buildGeometrySurfaceSnapAnchors(
      geometry,
      APPLE_CUTTER_CELL_SIZE,
      objectScale,
      { componentId: object.id, scope: 'component' }
    ),
    [geometry, object.id, objectScale]
  );
  const pointsGeometry = useMemo(
    () => createSurfaceSnapPointsGeometry(anchors),
    [anchors]
  );

  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);

  // Translation rastet durch die Deckung von Quell- und Zielankern auch auf
  // den halben Apfelschneider-Schritten ein. Die Visualisierung zeigt deshalb
  // beim Verschieben dieses 0,125-Raster, ohne die Snap-Topologie zu verändern.
  const visualCellSize = translating
    ? APPLE_CUTTER_CELL_SIZE * 0.5
    : APPLE_CUTTER_CELL_SIZE;
  const visualGridOffset = translating ? 0 : 0.5;
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#EFFF00') },
    uBoundsMin: { value: bounds.min.clone() },
    uBoundsMax: { value: bounds.max.clone() },
    uObjectScale: {
      value: new THREE.Vector3(
        Math.max(0.0001, Math.abs(scaleX)),
        Math.max(0.0001, Math.abs(scaleY)),
        Math.max(0.0001, Math.abs(scaleZ))
      )
    },
    uCellSize: { value: visualCellSize },
    uGridOffset: { value: visualGridOffset },
    uOpacity: { value: highlighted ? 0.46 : 0.16 }
  }), [bounds, highlighted, scaleX, scaleY, scaleZ, visualCellSize, visualGridOffset]);
  const pointSize = Math.min(0.075, Math.max(0.025, APPLE_CUTTER_CELL_SIZE * 0.12));

  return (
    <group
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      visible={object.visible}
    >
      <mesh geometry={geometry} renderOrder={900} raycast={() => undefined}>
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthTest
          depthWrite={false}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      {!translating && (
        <points geometry={pointsGeometry} renderOrder={901} raycast={() => undefined}>
          <pointsMaterial
            color="#EFFF00"
            size={highlighted ? pointSize * 1.35 : pointSize}
            sizeAttenuation
            transparent
            opacity={highlighted ? 0.96 : 0.62}
            depthTest
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      )}
    </group>
  );
}
