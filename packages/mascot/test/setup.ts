/**
 * Test environment shims for jsdom:
 *  - a minimal Web Animations API (Element.prototype.animate / getAnimations)
 *    whose `finished` promise resolves after delay + duration × iterations ms
 *    (works with fake timers; Infinity iterations never finish), with
 *    pause() / play() / currentTime and the keyframes + timing kept for tests,
 *  - matchMedia (never reduced by default),
 *  - a no-op IntersectionObserver.
 */

export interface FakeAnimation {
  id: string;
  playState: 'running' | 'paused' | 'finished' | 'idle';
  readonly finished: Promise<FakeAnimation>;
  currentTime: number | null;
  readonly effect: { getKeyframes(): Keyframe[]; getTiming(): KeyframeAnimationOptions; readonly target: Element };
  cancel(): void;
  finish(): void;
  commitStyles(): void;
  persist(): void;
  /** 'persisted' once persist() was called (real browsers would otherwise drop replaced, filling animations) */
  replaceState: 'active' | 'persisted';
  play(): void;
  pause(): void;
}

const active = new WeakMap<Element, Set<FakeAnimation>>();

function fakeAnimate(this: Element, keyframes: unknown, options?: number | KeyframeAnimationOptions): FakeAnimation {
  const timing: KeyframeAnimationOptions = typeof options === 'number' ? { duration: options } : { ...(options ?? {}) };
  const duration = Number(timing.duration ?? 0);
  const delay = Number(timing.delay ?? 0);
  const iterations = timing.iterations ?? 1;
  const end = delay + (Number.isFinite(duration) ? duration : 0) * iterations;
  const frames = Array.isArray(keyframes) ? (keyframes as Keyframe[]) : [];
  const target = this;

  let resolve!: (a: FakeAnimation) => void;
  let reject!: (e: unknown) => void;
  let settledPromise = false;
  let finished!: Promise<FakeAnimation>;
  const renew = () => {
    settledPromise = false;
    finished = new Promise<FakeAnimation>((res, rej) => {
      resolve = (v) => {
        settledPromise = true;
        res(v);
      };
      reject = (e) => {
        settledPromise = true;
        rej(e);
      };
    });
    finished.catch(() => undefined); // nobody listening is fine
  };
  renew();

  const set = active.get(this) ?? new Set<FakeAnimation>();
  active.set(this, set);

  // currentTime = now - origin while running; `hold` while paused / finished
  let origin = Date.now();
  let hold: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = undefined;
    if (a.playState !== 'running' || !Number.isFinite(end)) return;
    timer = setTimeout(() => a.finish(), Math.max(0, end - (Date.now() - origin)));
  };

  const a: FakeAnimation = {
    id: '',
    playState: 'running',
    get finished() {
      return finished;
    },
    get currentTime() {
      if (a.playState === 'idle') return null;
      return hold ?? Date.now() - origin;
    },
    set currentTime(v: number | null) {
      if (v === null || a.playState === 'idle') return;
      if (a.playState === 'running') {
        origin = Date.now() - v;
        arm();
      } else if (a.playState === 'finished' && v < end) {
        hold = null;
        origin = Date.now() - v;
        a.playState = 'running';
        set.add(a);
        if (settledPromise) renew();
        arm();
      } else hold = v;
    },
    effect: { getKeyframes: () => frames, getTiming: () => timing, target },
    cancel() {
      if (a.playState === 'idle') return;
      a.playState = 'idle';
      clearTimeout(timer);
      set.delete(a);
      hold = null;
      reject(new DOMException('The animation was aborted', 'AbortError'));
    },
    finish() {
      if (a.playState !== 'running' && a.playState !== 'paused') return;
      a.playState = 'finished';
      clearTimeout(timer);
      hold = end;
      set.delete(a);
      resolve(a);
    },
    commitStyles() {},
    replaceState: 'active',
    persist() {
      a.replaceState = 'persisted';
    },
    play() {
      if (a.playState === 'running') return;
      let t = hold ?? Date.now() - origin;
      if (t >= end || t < 0) t = 0; // WAAPI auto-rewind
      hold = null;
      origin = Date.now() - t;
      if (a.playState === 'finished' || a.playState === 'idle' || settledPromise) renew();
      a.playState = 'running';
      set.add(a);
      arm();
    },
    pause() {
      if (a.playState === 'paused' || a.playState === 'idle') return;
      if (a.playState === 'running') hold = Date.now() - origin;
      clearTimeout(timer);
      a.playState = 'paused';
      set.add(a);
    },
  };
  set.add(a);
  arm();
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

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (typeof globalThis.IntersectionObserver !== 'function') {
  class NoopIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
