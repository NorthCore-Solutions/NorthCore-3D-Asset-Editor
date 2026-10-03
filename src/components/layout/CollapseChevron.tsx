export function CollapseChevron({ direction }: { direction: 'left' | 'right' | 'up' | 'down' }) {
  const rotation = { right: 0, down: 90, left: 180, up: 270 }[direction];
  // Center the compact visible contour itself, without font bearings or baseline offsets.
  // Its bounds are symmetric about (8, 8), which is also the fixed rotation center.
  return <svg width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.25 5 9.75 8 6.25 11" transform={`rotate(${rotation} 8 8)`} />
  </svg>;
}
