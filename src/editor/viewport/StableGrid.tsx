import { Grid } from '@react-three/drei';

export const GRID_EXTENT = 400;

export function StableGrid({ cellSize }: { cellSize: number }) {
  const gridProps = {
    args: [GRID_EXTENT, GRID_EXTENT] as [number, number],
    cellSize,
    cellThickness: 0.6,
    cellColor: '#53626a',
    sectionSize: cellSize * 5,
    sectionThickness: 1,
    sectionColor: '#4f8f68',
    fadeDistance: 1000,
    fadeStrength: 0,
    followCamera: false,
    infiniteGrid: false,
    frustumCulled: false,
    renderOrder: 1
  };
  return (
    <group>
      <Grid {...gridProps} position={[0, 0.003, 0]} />
      <Grid {...gridProps} position={[0, -0.003, 0]} rotation={[Math.PI, 0, 0]} />
    </group>
  );
}
