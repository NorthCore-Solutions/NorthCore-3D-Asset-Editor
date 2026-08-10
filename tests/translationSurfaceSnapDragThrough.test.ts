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

  // Stop-Raster für den Zielquader bei [2.5, 0.5, 0.5] (x ∈ [2, 3]) und eine
  // 1×1×1-Quelle: Wandkontakt bei 1.5/3.5 plus innere Apfelschneider-Linien
  // im 0.125-Raster (1.0 → 0.125 + 0.25 + 0.25 + 0.25 + 0.125).
  const STOP_STEP = 0.125;
  const stopIndex = (x: number) => Math.round((x - 1.5) / STOP_STEP);
  const isStop = (x: number) => {
    const k = stopIndex(x);
    return k >= 0 && k <= 16 && Math.abs(x - (1.5 + k * STOP_STEP)) < 1e-6;
  };

  it.each([
    ['vorwärts', [-2, 0.5, 0.5] as Vec3, [5, 0.5, 0.5] as Vec3, 1.5],
    ['rückwärts', [5, 0.5, 0.5] as Vec3, [-2, 0.5, 0.5] as Vec3, 3.5]
  ])('rastet außen und innen ein und zieht %s ohne Blockade vollständig durch', (_label, from, to, wallContactX) => {
    const frames = dragThrough(from, to, 140, [2.5, 0.5, 0.5]);
    const forward = to[0] > from[0];

    // Jeder Snap liegt auf dem Stop-Raster (Wandkontakt oder innere Linie).
    const snappedFrames = frames.filter((frame) => frame.targetId !== null);
    expect(snappedFrames.length).toBeGreaterThan(0);
    for (const frame of snappedFrames) {
      expect(isStop(frame.accepted[0])).toBe(true);
    }

    // Der Außen-Snap an der Wand bleibt erhalten.
    expect(
      snappedFrames.some((frame) => Math.abs(frame.accepted[0] - wallContactX) < 1e-6)
    ).toBe(true);

    // Beim Weiterziehen werden mehrere innere Apfelschneider-Positionen
    // nacheinander getroffen.
    const innerStops = new Set(
      snappedFrames
        .map((frame) => stopIndex(frame.accepted[0]))
        .filter((k) => (forward ? k > 0 : k < 16))
    );
    expect(innerStops.size).toBeGreaterThanOrEqual(4);

    // Kein Haken oder Zurückspringen: die akzeptierte Position ist monoton.
    for (let index = 1; index < frames.length; index += 1) {
      const delta = frames[index]!.accepted[0] - frames[index - 1]!.accepted[0];
      expect(forward ? delta >= -1e-9 : delta <= 1e-9).toBe(true);
    }

    // Vollständiger Durchzug: nach dem letzten Snap folgt die Position frei
    // der Rohbewegung; kein Hängenbleiben im Körper.
    let lastSnapIndex = -1;
    frames.forEach((frame, index) => {
      if (frame.targetId !== null) lastSnapIndex = index;
    });
    expect(lastSnapIndex).toBeGreaterThan(0);
    for (const frame of frames.slice(lastSnapIndex + 1)) {
      expect(frame.targetId).toBeNull();
      expect(frame.accepted[0]).toBeCloseTo(frame.raw[0], 6);
    }
    const last = frames[frames.length - 1];
    expect(last?.accepted).toEqual(to);
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

  it('rastet beim Verweilen innerhalb des Fangbands wieder ein', () => {
    const target = createSceneObject('box');
    target.id = 'target-box';
    target.position = [2.5, 0.5, 0.5];
    const source = createSceneObject('box');
    source.id = 'source-box';

    let session = createTranslationSurfaceSnapSession();
    let objects: SceneObjectData[] = [{ ...source, position: [0.5, 0.5, 0.5] }, target];
    const frames: Array<{ raw: Vec3; accepted: Vec3; targetId: string | null }> = [];

    // Annäherung, dann langsames Weiterdrücken in kleinen Schritten:
    // Solange die Rohposition im Fangband um die Wand (x=2.0) bleibt,
    // muss der Kontakt an der Wand (akzeptiert x=1.5) bestehen.
    const rawPath: Vec3[] = [];
    for (let x = 0.6; x <= 1.3; x += 0.1) rawPath.push([x, 0.5, 0.5]);
    for (let x = 1.42; x <= 2.4; x += 0.03) rawPath.push([x, 0.5, 0.5]);

    for (const raw of rawPath) {
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
      frames.push({ raw, accepted, targetId: resolution.result.targetId });
    }

    const bandFrames = frames.filter((frame) => frame.raw[0] >= 1.42 && frame.raw[0] <= 1.6);
    expect(bandFrames.length).toBeGreaterThan(0);
    for (const frame of bandFrames) {
      expect(frame.targetId).toBe('target-box');
      expect(frame.accepted[0]).toBeCloseTo(1.5, 6);
    }

    // Hinter dem Fangband kehrt der Wandkontakt nicht zurück: Die Position
    // folgt der Rohbewegung oder rastet an inneren Apfelschneider-Linien ein.
    const innerFrames = frames.filter((frame) => frame.raw[0] >= 1.75);
    expect(innerFrames.length).toBeGreaterThan(0);
    for (const frame of innerFrames) {
      expect(frame.accepted[0]).toBeGreaterThan(1.5 + 1e-6);
      if (frame.targetId === null) {
        expect(frame.accepted[0]).toBeCloseTo(frame.raw[0], 6);
      } else {
        expect(isStop(frame.accepted[0])).toBe(true);
      }
    }
  });
});
