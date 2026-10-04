import { animationStore } from '../animation/store';
/** One-shot Raster resume; document replacement always invalidates it. */
export function pauseMenuPlayback(): (resume: boolean) => void {
  const wasPlaying = animationStore.playing, document = animationStore.capturePlaybackDocument();
  if (wasPlaying) animationStore.pause();
  let pending = true;
  return (resume) => {
    if (!pending) return;
    pending = false;
    if (resume && wasPlaying && animationStore.capturePlaybackDocument() === document) animationStore.play();
  };
}
