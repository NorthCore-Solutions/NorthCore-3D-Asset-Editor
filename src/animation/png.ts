import { decode, convertIndexedToRgb } from 'fast-png';

export function decodePng(data: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const decoded = decode(data, { checkCrc: true });
  const p = decoded.palette
    ? { ...decoded, data: convertIndexedToRgb(decoded), depth: 8, channels: decoded.palette[0]!.length }
    : decoded;
  const result = new Uint8Array(p.width * p.height * 4),
    maximum = 2 ** p.depth - 1;
  const channel = (k: number, c: number) => {
    if (p.depth >= 8) return p.data[k * p.channels + c]!;
    const rowBytes = Math.ceil((p.width * p.channels * p.depth) / 8),
      bit = ((k % p.width) * p.channels + c) * p.depth;
    return (
      (p.data[Math.floor(k / p.width) * rowBytes + Math.floor(bit / 8)]! >>> (8 - p.depth - (bit % 8))) &
      maximum
    );
  };
  for (let k = 0; k < p.width * p.height; k++) {
    const r = channel(k, 0),
      g = p.channels <= 2 ? r : channel(k, 1),
      b = p.channels <= 2 ? r : channel(k, 2);
    const transparent =
      !decoded.palette &&
      decoded.transparency?.length &&
      (p.channels === 1
        ? r === decoded.transparency[0]
        : p.channels === 3 && [r, g, b].every((v, i) => v === decoded.transparency![i]));
    const alpha =
      p.channels === 2 || p.channels === 4 ? channel(k, p.channels - 1) : transparent ? 0 : maximum;
    const convert = (v: number) => Math.round((v * 255) / maximum);
    result.set([convert(r), convert(g), convert(b), convert(alpha)], k * 4);
  }
  return { width: p.width, height: p.height, rgba: result };
}
