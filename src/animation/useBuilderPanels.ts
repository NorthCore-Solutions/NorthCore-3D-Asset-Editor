import { useEffect, useState } from 'react';

const compactQuery = '(max-width: 1180px), (pointer: coarse) and (max-width: 1400px)';
const isCompact = () => window.matchMedia(compactQuery).matches;

// Only presentation state: opening panels never changes the canvas dimensions.
export function useBuilderPanels() {
  const [compact, setCompact] = useState(isCompact);
  const [left, updateLeft] = useState(() => !isCompact());
  const [right, updateRight] = useState(() => !isCompact());
  const [timeline, setTimeline] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(compactQuery);
    const changed = (event: MediaQueryListEvent) => {
      setCompact(event.matches);
      if (event.matches) {
        updateLeft(false);
        updateRight(false);
      }
    };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const setLeft = (open: boolean) => {
    if (compact && open) updateRight(false);
    updateLeft(open);
  };
  const setRight = (open: boolean) => {
    if (compact && open) updateLeft(false);
    updateRight(open);
  };
  return { left, right, timeline, setLeft, setRight, setTimeline };
}
