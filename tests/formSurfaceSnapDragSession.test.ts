import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import {
  createTranslationSurfaceSnapSession,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession
} from '../src/editor/snapping/translationSurfaceSnap';

const STEP = 0.25;

function activeSession(): TranslationSurfaceSnapSession {
  return {
    active: {
      targetId: 'target',
      targetAnchorId: 'target:anchor:1',
      sourceAnchorId: 'source:anchor:1',
      captureRawPosition: [0, 0, 0],
      acceptedPosition: [2, 3, 4],
      normal: [-1, 0, 0]
    },
    previousCompositeTarget: null
  };
}

describe('lokale Formen-Snap-Sitzung des Viewports', () => {
  it('ist pro Drag neu und besitzt keinen globalen Plattformzustand', () => {
    const first = createTranslationSurfaceSnapSession();
    const second = createTranslationSurfaceSnapSession();

    expect(first).not.toBe(second);
    expect(first).toEqual({
      active: null,
      previousCompositeTarget: null
    });
    expect(second).toEqual({
      active: null,
      previousCompositeTarget: null
    });
  });

  it('liefert beim Halten exakt dieselbe akzeptierte Position ohne Nachspringen', () => {
    const source = createSceneObject('box');
    source.position = [20, 20, 20];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [0.1, 0, 0],
      activeSession()
    );

    expect(resolution.result.position).toEqual([2, 3, 4]);
    expect(resolution.result.targetId).toBe('target');
  });

  it('lässt die Tangentialbewegung während des Haltens frei', () => {
    const source = createSceneObject('box');
    source.position = [2, 3.1, 4];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [0, 0.1, 0],
      activeSession()
    );

    expect(resolution.result.targetId).toBe('target');
    expect(resolution.result.position).toEqual([2, 3.1, 4]);
    expect(resolution.session.active).not.toBeNull();
  });

  it('gibt seitliches Ziehen nach derselben Freigabestrecke frei', () => {
    const source = createSceneObject('box');
    source.position = [2, 3.2, 4];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [0, 0.2, 0],
      activeSession()
    );

    expect(resolution.result.targetId).toBeNull();
    expect(resolution.result.position).toEqual(source.position);
    expect(resolution.session.active).toBeNull();
  });

  it('gibt beim Wegziehen von der Fläche frei', () => {
    const source = createSceneObject('box');
    source.position = [1.8, 3, 4];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [-0.2, 0, 0],
      activeSession()
    );

    expect(resolution.result.targetId).toBeNull();
    expect(resolution.result.position).toEqual(source.position);
    expect(resolution.session.active).toBeNull();
  });

  it('gibt beim Durchdrücken frei, ohne Snap-Kandidaten zu unterdrücken', () => {
    const source = createSceneObject('box');
    source.position = [2.2, 3, 4];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [0.2, 0, 0],
      activeSession()
    );

    expect(resolution.result.targetId).toBeNull();
    expect(resolution.result.position).toEqual(source.position);
    expect(resolution.session.active).toBeNull();
    expect(resolution.session).toEqual({
      active: null,
      previousCompositeTarget: null
    });
  });
});
