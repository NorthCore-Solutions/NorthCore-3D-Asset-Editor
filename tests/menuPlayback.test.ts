import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { pauseMenuPlayback } from '../src/app/menuPlayback';
import { animationStore as raster } from '../src/animation/store';
import { restoreSession, serializeSession } from '../src/animation/files';

beforeEach(() => {
  vi.useFakeTimers();
  raster.pause(false);
  restoreSession(raster, serializeSession(raster));
  raster.addFrame(true); raster.frameAt(0); raster.markSaved(raster.captureContent());
});
afterEach(() => { raster.pause(false); vi.useRealTimers(); });

for (const mode of ['raster'] as const) {
  const store = raster;
  it(`${mode}: pause/resume is one-shot, preserves dirty/history and has exactly one timer`, () => {
    const past = [...store.past], future = [...store.future], dirty = store.dirty;
    store.play(); expect(vi.getTimerCount()).toBe(1);
    const finish = pauseMenuPlayback();
    expect(store.playing).toBe(false); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(raster.state.index).toBe(0);
    finish(true); finish(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(400);
    expect(raster.state.index).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(store.past).toEqual(past); expect(store.future).toEqual(future); expect(store.dirty).toBe(dirty);
  });
  it(`${mode}: paused remains paused and a discarded resume cannot be used later`, () => {
    pauseMenuPlayback()(true);
    expect(store.playing).toBe(false); expect(vi.getTimerCount()).toBe(0);
    store.play(); const finish = pauseMenuPlayback();
    finish(false); finish(true);
    expect(store.playing).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['new', 'load'] as const)(`${mode}: %s document replacement invalidates the resume`, (action) => {
    store.play(); const finish = pauseMenuPlayback();
    {
      if (action === 'new') raster.newAnimation('New document', 'empty', false);
      else restoreSession(raster, serializeSession(raster));
    }
    finish(true); expect(store.playing).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it(`${mode}: navigation or edits in the same document do not count as a session switch`, () => {
    store.play(); const finish = pauseMenuPlayback();
    raster.frameAt(1); raster.duration(600);
    finish(true); expect(store.playing).toBe(true); expect(vi.getTimerCount()).toBe(1);
  });
  it(`${mode}: repeated opening and closing never accumulates timers`, () => {
    store.play();
    for (let i = 0; i < 10; i++) {
      const finish = pauseMenuPlayback();
      expect(vi.getTimerCount()).toBe(0);
      finish(true); expect(vi.getTimerCount()).toBe(1);
    }
  });
}
