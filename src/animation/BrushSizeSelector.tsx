import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function BrushSizeSelector({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    popup.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
    const outside = (e: PointerEvent) => {
      if (
        e.target instanceof Node &&
        !popup.current?.contains(e.target) &&
        !button.current?.contains(e.target)
      )
        setPosition(null);
    };
    const resize = () => setPosition(null);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', resize);
    };
  }, [position]);
  const close = () => {
    setPosition(null);
    button.current?.focus();
  };
  return (
    <>
      <button
        ref={button}
        className="ab-brush"
        aria-label="Werkzeuggröße"
        aria-haspopup="listbox"
        aria-expanded={!!position}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPosition(position ? null : { left: Math.min(innerWidth - 73, r.left), top: r.bottom + 4 });
        }}
      >
        {value}×{value} ▾
      </button>
      {position &&
        createPortal(
          <div
            ref={popup}
            role="listbox"
            aria-label="Werkzeuggrößen"
            className="ab-brush-popup"
            style={position}
            onKeyDown={(e) => {
              const options = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]')],
                current = options.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? 7
                      : (current + (e.key === 'ArrowDown' ? 1 : 7)) % 8;
                options[next]?.focus();
              }
            }}
          >
            {Array.from({ length: 8 }, (_, i) => (
              <button
                type="button"
                role="option"
                key={i}
                aria-selected={value === i + 1}
                onClick={() => {
                  onChange(i + 1);
                  close();
                }}
              >
                {i + 1}×{i + 1}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
