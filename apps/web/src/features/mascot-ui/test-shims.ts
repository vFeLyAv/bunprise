/**
 * jsdom shims for mascot tests — the same approach as packages/mascot/test/setup.ts:
 *  - matchMedia + no-op IntersectionObserver (shared with the UI kit tests),
 *  - a minimal Web Animations API (Element.prototype.animate / getAnimations)
 *    whose `finished` promise resolves after `duration` ms (works with fake timers).
 * Only for tests that drive the mascot scenes; motion-based components should
 * import '../../ui/test-shims-dom' instead (see there).
 */
import '../../ui/test-shims-dom';

interface FakeAnimation {
  playState: 'running' | 'finished' | 'idle';
  finished: Promise<FakeAnimation>;
  cancel(): void;
  finish(): void;
  commitStyles(): void;
  play(): void;
  pause(): void;
}

const active = new WeakMap<Element, Set<FakeAnimation>>();

function fakeAnimate(this: Element, _keyframes: unknown, options?: number | KeyframeAnimationOptions): FakeAnimation {
  const duration = typeof options === 'number' ? options : Number(options?.duration ?? 0);
  let resolve!: (a: FakeAnimation) => void;
  let reject!: (e: unknown) => void;
  const finished = new Promise<FakeAnimation>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  finished.catch(() => undefined);

  const set = active.get(this) ?? new Set<FakeAnimation>();
  active.set(this, set);

  const a: FakeAnimation = {
    playState: 'running',
    finished,
    cancel() {
      if (a.playState !== 'running') return;
      a.playState = 'idle';
      clearTimeout(timer);
      set.delete(a);
      reject(new DOMException('The animation was aborted', 'AbortError'));
    },
    finish() {
      if (a.playState !== 'running') return;
      a.playState = 'finished';
      clearTimeout(timer);
      set.delete(a);
      resolve(a);
    },
    commitStyles() {},
    play() {},
    pause() {},
  };
  set.add(a);
  const timer = setTimeout(() => a.finish(), Number.isFinite(duration) ? duration : 0);
  return a;
}

function fakeGetAnimations(this: Element, options?: { subtree?: boolean }): FakeAnimation[] {
  const out: FakeAnimation[] = [];
  const collect = (el: Element) => active.get(el)?.forEach((a) => out.push(a));
  collect(this);
  if (options?.subtree) this.querySelectorAll('*').forEach(collect);
  return out;
}

if (typeof Element.prototype.animate !== 'function') {
  Element.prototype.animate = fakeAnimate as unknown as Element['animate'];
}
if (typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = fakeGetAnimations as unknown as Element['getAnimations'];
}
