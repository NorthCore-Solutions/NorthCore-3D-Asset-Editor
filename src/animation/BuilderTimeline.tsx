import { BuilderPanel } from './BuilderUI';
import { animationStore as store } from './store';
import { poseForSource } from './nativePoses';
import type { BuilderDialogs } from './useBuilderDialogs';

export function BuilderTimeline({ open: timeline, onToggle, ui: { infoButton } }: {
  open: boolean; onToggle: () => void; ui: Pick<BuilderDialogs, 'infoButton'>;
}) {
  return (
    <BuilderPanel side="timeline" title="Timeline" open={timeline} onToggle={onToggle} info={infoButton('Timeline')} actions={<>
          <button title="Abspielen/Pause" onClick={() => store.playing ? store.pause() : store.play()}>{store.playing ? 'Ⅱ' : '▶'}</button>
          <button title="Frame hinzufügen" onClick={() => store.addFrame()}>＋</button>
          <button title="Frame aus Grundpose" aria-label="Frame aus Grundpose" disabled={!poseForSource(store.state.source)} onClick={() => store.addPoseFrame()}>＋ Pose</button>
          <button title="Frame duplizieren" onClick={() => store.addFrame(true)}>⧉</button>
          <button title="Frame löschen" disabled={store.state.frames.length === 1} onClick={() => store.deleteFrame()}>×</button>
        </>}>
        <div className="ab-frames">
          {store.state.frames.map((f, i) => (
            <button key={i} aria-pressed={i === store.state.index} onClick={() => store.frameAt(i)}>
              Frame {i + 1}
              <small>
                {f.duration} ms · {f.layers.length} Layer
              </small>
            </button>
          ))}
        </div>
    </BuilderPanel>
  );
}
