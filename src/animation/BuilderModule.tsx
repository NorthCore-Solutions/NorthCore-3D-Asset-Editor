import { lazy, Suspense, useState } from 'react';
import { AnimationBuilder } from './AnimationBuilder';
const LegacyBuilder = lazy(() =>
  import('./LegacyBuilder').then((module) => ({ default: module.LegacyBuilder }))
);
export function BuilderModule({ onExit }: { onExit: () => void }) {
  const [legacy, setLegacy] = useState(false);
  return legacy ? (
    <Suspense fallback={<div className="editor-launcher">Legacy-Builder wird geladen …</div>}>
      <LegacyBuilder onExit={onExit} onNative={() => setLegacy(false)} />
    </Suspense>
  ) : (
    <AnimationBuilder onExit={onExit} onLegacy={() => setLegacy(true)} />
  );
}
