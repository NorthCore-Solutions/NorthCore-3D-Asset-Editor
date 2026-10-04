export const rgba = (r: number, g: number, b: number, a: number) =>
  ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
export const bytes = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
export const hex = (v: number) => `#${v.toString(16).padStart(8, '0').toUpperCase()}`;
export const cssColor = (v: number) => {
  const [r, g, b, a] = bytes(v);
  return `rgba(${r},${g},${b},${a! / 255})`;
};
