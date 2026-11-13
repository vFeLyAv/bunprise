/**
 * Shared animation plumbing for the mascots: the anim() helper, the easing
 * strings used by the prototypes, reduced-motion detection, the idle-loop
 * scheduler and the scene queue. No mascot-specific markup lives here.
 */

import type { ReducedMotionMode } from './types';

/** The spring curve both prototypes use for bouncy settles (ears, cookie, paws). */
export const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';

/** Every cubic-bezier string that appears in the prototypes, by role. */
export const EASINGS = {
  /** Overshooting spring: ear/cheek transitions, cookie drop, paws back down. */
  spring: SPRING,
  /** Quarter-turn of the face/paws/ears (`.tf`, `.tp`, `.te` ...). */
  turn: 'cubic-bezier(.3, .7, .3, 1)',
  /** Face glances (`.face` transition). */
  face: 'cubic-bezier(.25, .8, .3, 1)',
  /** Take-off segment of a jump. */
  jumpUp: 'cubic-bezier(.2,.7,.3,1)',
  /** Landing segment of a jump. */
  jumpDown: 'cubic-bezier(.5,0,.8,.5)',
  /** Paws lifting the cookie. */
  lift: 'cubic-bezier(.3,.7,.3,1)',
  /** Falling crumbs. */
  crumb: 'cubic-bezier(.4,0,1,1)',
  /** Bunny hop keyframes while walking. */
  bunnyHop: 'cubic-bezier(.3, .6, .4, 1)',
} as const;

/** Elements we can animate: anything with a CSSStyleDeclaration and animate(). */
export type AnimTarget = HTMLElement | SVGElement;

// ---- echoes (31.10, the laptop costume, src/wardrobe/laptop.ts) ------------------------------------------------------
// One puppet group can have one ECHO: another element that makes every move the group makes. The laptop costume draws
// his paws ON its keys (over the laptop, which stands still in front of him), so those «twin» paws must hop, squash and
// lift exactly with his own `.hop`, `.body` and `.paws`. Every motion the puppet gives a group goes through anim() /
// fxAnimate() below, so an echo there is enough: the same keyframes and timing start on the echo in the same call (and
// it is cancelled with the original); its inline transform (a committed pose, a reset) is copied by a MutationObserver.
// Nothing is patched; a group without an echo costs one WeakMap lookup.

interface Echo {
  target: () => AnimTarget | null;
  watch: MutationObserver | null;
}
const echoes = new WeakMap<Element, Echo>();

/**
 * From now on `target()` (looked up at every move; null = nobody) repeats every animation anim() / fxAnimate() start
 * on `source`, and keeps `source`'s inline transform. `target = null` ends the echo.
 */
export function echoMotion(source: Element, target: (() => AnimTarget | null) | null): void {
  echoes.get(source)?.watch?.disconnect();
  echoes.delete(source);
  if (!target) return;
  const copy = () => {
    const t = target();
    if (t) t.style.transform = (source as AnimTarget).style.transform;
  };
  const watch = typeof MutationObserver === 'function' ? new MutationObserver(copy) : null;
  watch?.observe(source, { attributes: true, attributeFilter: ['style'] });
  echoes.set(source, { target, watch });
  copy();
}

/** Does `source` have an echo now (tests, the costume's undress)? */
export function hasEcho(source: Element): boolean {
  return echoes.has(source);
}

/** The echo of animation `a` (null: no echo); it is cancelled together with `a`. */
function echoAnimation(el: Element, a: Animation, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  const t = echoes.get(el)?.target();
  if (!t || typeof t.animate !== 'function') return null;
  const b = t.animate(frames, opts);
  if (typeof a.addEventListener === 'function') a.addEventListener('cancel', () => b.cancel());
  return b;
}

/**
 * Runs a Web Animation on `el`, waits for it and then commits the final
 * transform as an inline style (so the pose stays after the animation is
 * cancelled). With `reduced` the element jumps straight to the end state.
 * A cancelled animation (e.g. destroy() mid-scene) resolves quietly.
 */
export async function anim(
  el: AnimTarget,
  frames: Keyframe[],
  opts: KeyframeAnimationOptions = {},
  reduced = false,
): Promise<void> {
  const last = frames[frames.length - 1];
  const fin = typeof last?.transform === 'string' ? last.transform : '';
  const commit = () => {
    el.style.transform = !fin || fin === 'none' ? '' : fin;
  };
  if (reduced || typeof el.animate !== 'function') {
    commit();
    return;
  }
  const o: KeyframeAnimationOptions = { fill: 'forwards', ...opts };
  const a = el.animate(frames, o);
  // (its echo fills forwards too: it is cancelled right here as well, so it never outlives the committed pose)
  const echo = echoAnimation(el, a, frames, o);
  try {
    await a.finished;
  } catch {
    echo?.cancel();
    return; // cancelled
  }
  commit();
  a.cancel();
  echo?.cancel();
}

/** Awaits an animation's end without throwing when it gets cancelled. */
export function settled(a: Animation | undefined): Promise<void> {
  if (!a) return Promise.resolve();
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Fire-and-forget animation with an `onDone` that also runs on cancel. */
export function fxAnimate(
  el: AnimTarget,
  frames: Keyframe[],
  opts: KeyframeAnimationOptions,
  onDone?: () => void,
): Animation | undefined {
  if (typeof el.animate !== 'function') {
    onDone?.();
    return undefined;
  }
  const a = el.animate(frames, opts);
  echoAnimation(el, a, frames, opts);
  if (onDone) void settled(a).then(onDone);
  return a;
}

/**
 * Tracks the "prefers-reduced-motion" media query (mode 'auto') or a fixed
 * answer ('force' / 'off'). `matches` is what the mascot checks before moving.
 */
export class ReducedMotion {
  private mode: ReducedMotionMode;
  private mql: MediaQueryList | null = null;
  private readonly listeners = new Set<(reduced: boolean) => void>();
  private readonly onChange = () => this.emit();

  constructor(mode: ReducedMotionMode = 'auto') {
    this.mode = mode;
    if (typeof matchMedia === 'function') {
      this.mql = matchMedia('(prefers-reduced-motion: reduce)');
      this.mql.addEventListener?.('change', this.onChange);
    }
  }

  get matches(): boolean {
    if (this.mode === 'force') return true;
    if (this.mode === 'off') return false;
    return this.mql?.matches ?? false;
  }

  setMode(mode: ReducedMotionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit();
  }

  subscribe(fn: (reduced: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy(): void {
    this.mql?.removeEventListener?.('change', this.onChange);
    this.listeners.clear();
  }

  private emit(): void {
    const v = this.matches;
    this.listeners.forEach((fn) => fn(v));
  }
}

interface IdleLoop {
  fn: () => void;
  min: number;
  spread: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Random-interval loops for the "alive while resting" behaviour (blinks,
 * glances, ear twitches ...). Each loop re-arms itself after `min + random *
 * spread` ms and calls `fn` only when `canRun()` says the mascot is idle.
 * All loops pause while the page is hidden or the host is outside the
 * viewport, and resume afterwards.
 */
export class IdleScheduler {
  private readonly loops: IdleLoop[] = [];
  private running = false;
  private pageVisible = true;
  private inView = true;
  private wasActive = false;
  private wasVisible = true;
  private io: IntersectionObserver | null = null;
  private observedDoc: Document | null = null;
  private readonly onVisibility = () => {
    this.pageVisible = !(this.observedDoc?.hidden ?? false);
    this.sync();
  };

  /**
   * @param canRun        loops fire only while this says yes
   * @param onActiveChange optional: called whenever `active` flips (started + page visible + in view);
   *                       the welcome stage uses it to pause / resume its animations
   */
  constructor(
    private readonly canRun: () => boolean,
    private readonly onActiveChange?: (active: boolean) => void,
    /** Visibility is independent of idle ownership: explicit scenes pause offscreen too. */
    private readonly onVisibleChange?: (visible: boolean) => void,
  ) {}

  /** Register a loop; it starts right away when the scheduler is active. */
  add(fn: () => void, min: number, spread: number): void {
    const loop: IdleLoop = { fn, min, spread, timer: null };
    this.loops.push(loop);
    if (this.active) this.arm(loop);
  }

  /** Pause while `el` is out of the viewport or its document is hidden. */
  observe(el: Element): void {
    const doc = el.ownerDocument;
    this.observedDoc = doc;
    this.pageVisible = !doc.hidden;
    doc.addEventListener('visibilitychange', this.onVisibility);
    if (typeof IntersectionObserver === 'function') {
      this.io = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        this.inView = last.isIntersecting;
        this.sync();
      });
      this.io.observe(el);
    }
    this.sync();
  }

  get active(): boolean {
    return this.running && this.pageVisible && this.inView;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
    this.sync();
  }

  stop(): void {
    this.running = false;
    this.sync();
  }

  destroy(): void {
    this.stop();
    this.io?.disconnect();
    this.io = null;
    this.observedDoc?.removeEventListener('visibilitychange', this.onVisibility);
    this.observedDoc = null;
    this.loops.length = 0;
  }

  private sync(): void {
    const visible = this.pageVisible && this.inView;
    if (visible !== this.wasVisible) {
      this.wasVisible = visible;
      this.onVisibleChange?.(visible);
    }
    const active = this.active;
    if (active) this.loops.forEach((l) => this.arm(l));
    else this.loops.forEach((l) => this.disarm(l));
    if (active !== this.wasActive) {
      this.wasActive = active;
      this.onActiveChange?.(active);
    }
  }

  private arm(loop: IdleLoop): void {
    if (loop.timer !== null) return;
    loop.timer = setTimeout(() => {
      loop.timer = null;
      if (!this.active) return;
      if (this.canRun()) loop.fn();
      this.arm(loop);
    }, loop.min + Math.random() * loop.spread);
  }

  private disarm(loop: IdleLoop): void {
    if (loop.timer === null) return;
    clearTimeout(loop.timer);
    loop.timer = null;
  }
}

/**
 * One scene at a time. A call to run() while another task is still running is
 * IGNORED (resolves to false immediately) — the same rule as the prototypes'
 * `if (busy) return`. The mascot layers the "angry after 5 taps" follow-up on
 * top of this.
 */
export class SceneQueue {
  private busy = false;

  get isBusy(): boolean {
    return this.busy;
  }

  async run(task: () => Promise<void>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      await task();
    } finally {
      this.busy = false;
    }
    return true;
  }
}

// Haptics (wave 3, I-05): the package never calls navigator.vibrate. The app injects its one wrapper
// (MascotOptions.haptics → apps/web src/lib/haptics.ts), which knows the "Vibration & Ton" switch and the
// iPhone (no vibration there: a visual answer + a short sound instead).

let seq = 0;
/** Per-instance id prefix so gradient/clipPath ids never clash between mascots. */
export function nextInstanceId(kind: string): string {
  seq += 1;
  return `bp-${kind}-${seq}`;
}
