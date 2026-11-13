import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anim, EASINGS, IdleScheduler, SceneQueue, SPRING } from '../src/core';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('easings', () => {
  it('exports the exact prototype curves', () => {
    expect(SPRING).toBe('cubic-bezier(.34, 1.56, .64, 1)');
    expect(EASINGS.spring).toBe(SPRING);
    expect(EASINGS.turn).toBe('cubic-bezier(.3, .7, .3, 1)');
    expect(EASINGS.jumpUp).toBe('cubic-bezier(.2,.7,.3,1)');
    expect(EASINGS.jumpDown).toBe('cubic-bezier(.5,0,.8,.5)');
    expect(EASINGS.bunnyHop).toBe('cubic-bezier(.3, .6, .4, 1)');
  });
});

describe('anim()', () => {
  it('waits for the animation and commits the final transform', async () => {
    const el = document.createElement('div');
    const p = anim(el, [{ transform: 'none' }, { transform: 'translateY(-24px)' }], { duration: 300 });
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(done).toBe(true);
    expect(el.style.transform).toBe('translateY(-24px)');
  });

  it("commits '' for a final 'none' and skips the animation when reduced", async () => {
    const el = document.createElement('div');
    el.style.transform = 'rotate(3deg)';
    const spy = vi.spyOn(el, 'animate');
    await anim(el, [{ transform: 'rotate(3deg)' }, { transform: 'none' }], { duration: 300 }, true);
    expect(spy).not.toHaveBeenCalled();
    expect(el.style.transform).toBe('');
  });

  it('resolves quietly when the animation is cancelled', async () => {
    const el = document.createElement('div');
    const p = anim(el, [{ transform: 'none' }, { transform: 'scale(2)' }], { duration: 300 });
    el.getAnimations().forEach((a) => a.cancel());
    await expect(p).resolves.toBeUndefined();
    expect(el.style.transform).toBe('');
  });
});

describe('SceneQueue', () => {
  it('runs one task at a time and reports ignored calls', async () => {
    const q = new SceneQueue();
    let release!: () => void;
    const first = q.run(() => new Promise<void>((r) => (release = r)));
    expect(q.isBusy).toBe(true);
    await expect(q.run(async () => undefined)).resolves.toBe(false);
    release();
    await expect(first).resolves.toBe(true);
    expect(q.isBusy).toBe(false);
  });
});

describe('IdleScheduler', () => {
  it('fires loops only while idle and pauses when the document is hidden', async () => {
    let idle = true;
    const s = new IdleScheduler(() => idle);
    const fn = vi.fn();
    const el = document.createElement('div');
    document.body.append(el);
    s.observe(el);
    s.add(fn, 100, 0);
    s.start();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(fn).toHaveBeenCalledTimes(2);

    idle = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(2);
    idle = true;

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.active).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(3);

    s.stop();
    expect(vi.getTimerCount()).toBe(0);
    s.destroy();
  });
});
