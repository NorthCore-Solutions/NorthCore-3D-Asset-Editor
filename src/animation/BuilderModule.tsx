import { lazy, Suspense, useState } from 'react';
import { AnimationBuilder } from './AnimationBuilder';
const LegacyBuilder = lazy(() =>
  import('./LegacyBuilder').then((module) => ({ default: module.LegacyBuilder }))
);
export function BuilderModule() {
  const [legacy, setLegacy] = useState(false);
  return legacy ? (
    <Suspense fallback={<div className="editor-launcher">Legacy-Builder wird geladen …</div>}>
      <LegacyBuilder onNative={() => setLegacy(false)} />
    </Suspense>
  ) : (
    <AnimationBuilder onLegacy={() => setLegacy(true)} />
  );
}
