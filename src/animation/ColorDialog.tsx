import { useState } from 'react';
import { Dialog } from './Dialog';
import { bytes, cssColor, hex, rgba } from './raster';

function rgbToHsv(color: number) {
  const [r, g, b] = bytes(color).map((v) => v / 255) as [number, number, number, number];
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const hue = !delta
    ? 0
    : max === r
      ? (g - b) / delta
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}
function hsvToRgba(h: number, s: number, v: number, a: number) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return rgba(
    Math.round((rgb[0]! + m) * 255),
    Math.round((rgb[1]! + m) * 255),
    Math.round((rgb[2]! + m) * 255),
    a
  );
}
export function ColorDialog({
  initial,
  onApply,
  onCancel,
}: {
  initial: number;
  onApply: (color: number) => void;
  onCancel: () => void;
}) {
  const [color, setColor] = useState(initial),
    [hsv, setHsv] = useState(() => rgbToHsv(initial)),
    [text, setText] = useState(hex(initial));
  const set = (h: number, s: number, v: number, a = color & 255) => {
    const next = hsvToRgba(h, s, v, a);
    setHsv({ h, s, v });
    setColor(next);
    setText(hex(next));
  };
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    set(
      hsv.h,
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    );
  };
  return (
    <Dialog title="Farbe auswählen" onCancel={onCancel} onSubmit={() => onApply(color)}>
      <div
        className="ab-sv"
        aria-label="Sättigung und Helligkeit"
        style={{
          background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),${cssColor(hsvToRgba(hsv.h, 1, 1, 255))}`,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) pick(e);
        }}
      >
        <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <label>
        Farbton
        <input
          type="range"
          min="0"
          max="359.99"
          step="0.01"
          value={hsv.h}
          onChange={(e) => set(+e.target.value, hsv.s, hsv.v)}
        />
      </label>
      <label>
        Sättigung
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={hsv.s}
          onChange={(e) => set(hsv.h, +e.target.value, hsv.v)}
        />
      </label>
      <label>
        Helligkeit
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={hsv.v}
          onChange={(e) => set(hsv.h, hsv.s, +e.target.value)}
        />
      </label>
      <label>
        Alpha / Transparenz: {color & 255}
        <input
          type="range"
          min="0"
          max="255"
          step="1"
          value={color & 255}
          onChange={(e) => {
            const next = ((color & 0xffffff00) | +e.target.value) >>> 0;
            setColor(next);
            setText(hex(next));
          }}
        />
      </label>
      <label>
        RGBA Hex
        <input
          value={text}
          pattern="#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})"
          required
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            if (/^#?([\da-f]{6}|[\da-f]{8})$/i.test(next)) {
              const v = next.replace('#', ''),
                rgba = parseInt(v.length === 6 ? `${v}FF` : v, 16);
              setColor(rgba);
              setHsv(rgbToHsv(rgba));
            }
          }}
        />
      </label>
      <div className="ab-color-preview">
        <span style={{ background: cssColor(color) }} />
      </div>
    </Dialog>
  );
}
