import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import {
  createTranslationSurfaceSnapSession,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession
} from '../src/editor/snapping/translationSurfaceSnap';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;

interface DragFrame {
  raw: Vec3;
  accepted: Vec3;
  targetId: string | null;
  session: TranslationSurfaceSnapSession;
}

/**
 * Simuliert echte Pointer-Schritte wie im Viewport: Die akzeptierte Position
 * landet nach jedem Schritt im Objektbestand und bildet den Sweep-Ursprung.
 */
function dragThrough(
  from: Vec3,
  to: Vec3,
  steps: number,
  targetPosition: Vec3
): DragFrame[] {
  const target = createSceneObject('box');
  target.id = 'target-box';
  target.position = targetPosition;
  const source = createSceneObject('box');
  source.id = 'source-box';

  let session = createTranslationSurfaceSnapSession();
  let objects: SceneObjectData[] = [{ ...source, position: from }, target];
  const frames: DragFrame[] = [];

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const raw: Vec3 = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t
    ];
    const resolution = resolveTranslationSurfaceSnap(
      { ...source, position: raw },
      objects,
      STEP,
      raw,
      session
    );
    session = resolution.session;
    const accepted = resolution.result.position;
    objects = [{ ...source, position: accepted }, target];
    frames.push({ raw, accepted, targetId: resolution.result.targetId, session });
  }
  return frames;
}

describe.each(['Desktop', 'Android'])('Formen-Snap-Durchzug auf %s', (platform) => {
  void platform;

  it.each([
    ['vorwärts', [-2, 0.5, 0.5] as Vec3, [5, 0.5, 0.5] as Vec3, 1.5],
    ['rückwärts', [5, 0.5, 0.5] as Vec3, [-2, 0.5, 0.5] as Vec3, 3.5]
  ])('rastet außen ein und zieht %s ohne Blockade vollständig durch', (_label, from, to, wallContactX) => {
    const frames = dragThrough(from, to, 140, [2.5, 0.5, 0.5]);

    const snappedFrames = frames.filter((frame) => frame.targetId !== null);
    expect(snappedFrames.length).toBeGreaterThan(0);
    for (const frame of snappedFrames) {
      expect(frame.accepted[0]).toBeCloseTo(wallContactX, 6);
    }

    const last = frames[frames.length - 1];
    expect(last?.accepted).toEqual(to);
    expect(last?.targetId).toBeNull();

    // Nach dem Loslassen der Fläche folgt die Position stetig der Rohbewegung;
    // kein Hängenbleiben an der Wand.
    const releaseIndex = frames.findIndex((frame, index) => (
      index > 0
      && frames[index - 1]?.targetId !== null
      && frame.targetId === null
    ));
    expect(releaseIndex).toBeGreaterThan(0);
    for (const frame of frames.slice(releaseIndex)) {
      expect(frame.accepted[0]).toBeCloseTo(frame.raw[0], 6);
    }
  });

  it('lässt die Tangentialbewegung während eines Wandkontakts frei', () => {
    const target = createSceneObject('box');
    target.id = 'target-box';
    target.position = [2.5, 0.5, 0.5];
    const source = createSceneObject('box');
    source.id = 'source-box';

    let session = createTranslationSurfaceSnapSession();
    let accepted: Vec3 = [1.0, 0.5, 0.5];
    let objects: SceneObjectData[] = [{ ...source, position: accepted }, target];
    let captured = false;

    // Erst in +x an die Wand heranfahren und einrasten.
    for (let index = 1; index <= 10 && !captured; index += 1) {
      const raw: Vec3 = [1.0 + index * 0.04, 0.5, 0.5];
      const resolution = resolveTranslationSurfaceSnap(
        { ...source, position: raw },
        objects,
        STEP,
        raw,
        session
      );
      session = resolution.session;
      accepted = resolution.result.position;
      objects = [{ ...source, position: accepted }, target];
      captured = resolution.result.targetId !== null;
    }
    expect(captured).toBe(true);
    expect(accepted[0]).toBeCloseTo(1.5, 6);

    // Dann tangential ziehen: x bleibt am Wandkontakt, y folgt frei.
    const tangentialFrames: DragFrame[] = [];
    for (let index = 1; index <= 4; index += 1) {
      const raw: Vec3 = [1.4, 0.5 + index * 0.03, 0.5];
      const resolution = resolveTranslationSurfaceSnap(
        { ...source, position: raw },
        objects,
        STEP,
        raw,
        session
      );
      session = resolution.session;
      accepted = resolution.result.position;
      objects = [{ ...source, position: accepted }, target];
      tangentialFrames.push({
        raw,
        accepted,
        targetId: resolution.result.targetId,
        session
      });
    }

    for (const frame of tangentialFrames) {
      expect(frame.targetId).toBe('target-box');
      expect(frame.accepted[0]).toBeCloseTo(1.5, 6);
      expect(frame.accepted[1]).toBeCloseTo(frame.raw[1], 6);
    }
  });
});
