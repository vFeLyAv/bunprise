/**
 * Base class shared by Bunny and Hamster: mounts the SVG puppet into an open
 * Shadow DOM, wires the scene queue, idle loops, reduced motion, timers and
 * the parts of the choreography that are identical in both prototypes
 * (jump skeleton, sleep/wake, crumbs, "z" letters, tap counting, coats).
 *
 * Mascot-specific scenes live in bunny.ts / hamster.ts and keep the exact
 * keyframes and timings of the approved prototypes.
 */

import {
  anim,
  EASINGS,
  fxAnimate,
  IdleScheduler,
  nextInstanceId,
  ReducedMotion,
  SceneQueue,
  settled,
  type AnimTarget,
} from './core';
import { applyFur } from './fur';
import type {
  CalmEyes,
  Coat,
  EyeMode,
  MascotHapticKind,
  MascotHaptics,
  MascotKind,
  MascotOptions,
  MascotSceneEventDetail,
  ReducedMotionMode,
  Scene,
} from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Thrown into a scene that was interrupted (wave 3, I-01): every await of the scene helpers (anim, wait,
 * jumpMotion) checks that its run is still current, so the rest of an interrupted scene never runs.
 */
class SceneInterrupted extends Error {
  constructor() {
    super('scene interrupted');
    this.name = 'SceneInterrupted';
  }
}

interface SceneTimer {
  fn: () => void;
  remaining: number;
  started: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** CSS custom properties set on the host; they inherit into the shadow tree. */
export const COAT_VARS = [
  '--mascot-base-top',
  '--mascot-base-bottom',
  '--mascot-belly',
  '--mascot-accent',
  '--mascot-accent-dark',
  '--mascot-paw',
  '--mascot-ear-in',
] as const;

/**
 * Shared host + stage styles (the mascot-specific CSS is appended by the spec).
 *
 * Floor shadow and contour come from two custom properties the app may set on any ancestor (they
 * inherit through the shadow boundary; on cream paper a cream bunny needs an edge):
 *   --mascot-shadow   colour of the floor shadow ellipse (default: the prototype's rgba(70,40,15,.12))
 *   --mascot-outline  colour of a thin contour around the silhouette (default: none = no contour)
 *   --mascot-outline-width (default 1.5px, screen pixels at any size)
 * The contour is each silhouette shape's own stroke painted UNDER its fill (paint-order), so only the
 * outer half shows: body, ears, feet, tails. The cheeks get none — they are drawn over the body and
 * their stroke would show as arcs inside the face. Shared by bunny, hamster and the welcome stage.
 */
export const BASE_CSS = `
:host { display: inline-block; width: 160px; line-height: 0; -webkit-tap-highlight-color: transparent; touch-action: manipulation; user-select: none; -webkit-user-select: none;
  --mascot-blush: #FF9E9E; --mascot-eye: #3A2622; --mascot-nose: #F2899A; --mascot-mouth: #6B4A42; }
:host([hidden]) { display: none; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
.idle-paused *, .visibility-paused * { animation-play-state: paused !important; }
.shadow { fill: var(--mascot-shadow, rgba(70,40,15,.12)); }
.breathe > path, .ear-l > :first-child, .ear-r > :first-child, .tear > :first-child, .tip > :first-child, .foot > ellipse, .tail > :first-child {
  stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px);
  vector-effect: non-scaling-stroke; paint-order: stroke fill; }
`;

/** Everything a concrete mascot hands to the base class. */
export interface MascotSpec<C extends string> {
  kind: MascotKind;
  viewBox: string;
  /** Mascot CSS, placed inside the shadow root after the base styles. */
  css: string;
  /** Inner SVG markup; `id(name)` returns a per-instance unique id for defs. */
  markup: (id: (name: string) => string) => string;
  coats: readonly Coat<C>[];
  /** Every pattern class this mascot uses (all are removed before a coat is applied). */
  patternClasses: readonly string[];
  /** Start position of the sleeping "z" letters. */
  zOrigin: { x: number; y: number };
  /** Y where cookie crumbs appear (mouth height). */
  crumbY: number;
}

export abstract class MascotBase<S extends Scene, C extends string, P extends string> {
  readonly kind: MascotKind;
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** Unique per instance; prefixes every gradient / clipPath id. */
  readonly id: string;

  protected readonly svg: SVGSVGElement;
  /** The state-class holder (same role as `.hm` in the prototypes). */
  protected readonly hm: SVGGElement;
  protected readonly mover: SVGGElement;
  /** The `.hop` group (vertical motion of the whole puppet). */
  protected readonly hopG: SVGGElement;
  protected readonly body: SVGGElement;
  protected readonly fx: SVGGElement;
  protected readonly shadow: SVGElement;
  protected readonly paws: SVGGElement;
  protected readonly pawR: SVGGElement;
  protected readonly cookie: SVGGElement;
  protected readonly footL: SVGGElement;
  protected readonly footR: SVGGElement;
  protected readonly cheeks: SVGGElement[];

  protected readonly reduced: ReducedMotion;
  protected readonly idle: IdleScheduler;
  protected readonly queue = new SceneQueue();

  protected sleeping = false;
  protected eyesMode: EyeMode = 'normal';
  private coatId: C;
  private current: S | null = null;
  private angryPending = false;
  private taps: number[] = [];
  private destroyed = false;
  /** The app's haptics wrapper (the package never vibrates by itself). */
  private readonly haptics: MascotHaptics | null;
  /** Eyes shown instead of open ones while reduced motion holds the puppet still. */
  private calm: CalmEyes | null;
  /** The running scene is the puppet's own idle life (the bunny's sniff): it yields to any play(). */
  private own = false;
  /** Bumped by interrupt(): the helpers of an older run stop that run. */
  private runGen = 0;
  /** The scene run in progress (to wait for it after an interrupt). */
  private running: Promise<unknown> | null = null;

  private readonly spec: MascotSpec<C>;
  private readonly timers = new Set<SceneTimer>();
  private visibilityPaused = false;
  private readonly pausedAnimations = new Set<Animation>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();
  private readonly waiters = new Set<() => void>();
  private readonly onClick = () => {
    void this.tap();
  };

  protected constructor(host: HTMLElement, options: MascotOptions<C>, spec: MascotSpec<C>) {
    this.host = host;
    this.spec = spec;
    this.kind = spec.kind;
    this.id = nextInstanceId(spec.kind);
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${BASE_CSS}${spec.css}</style><svg viewBox="${spec.viewBox}" aria-hidden="true" focusable="false">${spec.markup((n) => `${this.id}-${n}`)}</svg>`;

    const svg = this.root.querySelector('svg');
    if (!svg) throw new Error('[mascot] svg failed to mount');
    this.svg = svg;
    this.hm = this.$('.hm');
    this.mover = this.$('.mover');
    this.hopG = this.$('.hop');
    this.body = this.$('.body');
    this.fx = this.$('.fx');
    this.shadow = this.$('.shadow');
    this.paws = this.$('.paws');
    this.pawR = this.$('.paw-r');
    this.cookie = this.$('.cookie');
    this.footL = this.$('.foot-l');
    this.footR = this.$('.foot-r');
    this.cheeks = this.$$('.cheek-j');
    this.haptics = options.haptics ?? null;
    this.calm = options.calmEyes ?? null;

    this.reduced = new ReducedMotion(options.reducedMotion ?? 'auto');
    this.reduced.subscribe(() => this.applyReduced());
    this.applyReduced();

    this.idle = new IdleScheduler(() => this.isIdle() && !this.reduced.matches, undefined, (visible) => this.onVisibility(visible));
    this.idle.observe(host);

    const first = spec.coats[0];
    if (!first) throw new Error('[mascot] spec has no coats');
    this.coatId = first.id;
    this.setCoat(options.coat ?? first.id);
    this.setSize(options.size ?? 160);

    if (options.interactive ?? true) {
      host.addEventListener('click', this.onClick);
      host.style.cursor = 'pointer';
    }
  }

  // ---------- subclass hooks ----------

  /** Register the idle loops of this mascot (called once from finishSetup()). */
  protected abstract registerIdleLoops(): void;
  /** Run one non-sleep scene; the queue guarantees exclusivity. */
  protected abstract runScene(scene: S): Promise<void>;
  /** Body squash/stretch keyframes for a jump (the bunny adds a binky roll). */
  protected abstract jumpBodyFrames(binky: boolean): Keyframe[];
  /** Ear (and ear-tip) keyframes for a jump. */
  protected abstract jumpEars(o: KeyframeAnimationOptions): void;
  /** Debug: set a static pose for screenshots (no timers, no races). */
  abstract pose(name: P): void;

  /** Subclasses call this at the end of their constructor, once their fields exist. */
  protected finishSetup(options: MascotOptions<C>): void {
    this.registerIdleLoops();
    if (options.idle ?? true) this.idle.start();
  }

  // ---------- public state ----------

  get busy(): boolean {
    return this.queue.isBusy;
  }

  get isSleeping(): boolean {
    return this.sleeping;
  }

  /** The scene currently playing ('sleep' while asleep), or null when resting. */
  get scene(): S | null {
    return this.current;
  }

  get coat(): C {
    return this.coatId;
  }

  get eyes(): EyeMode {
    return this.eyesMode;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** An offscreen/hidden scene holds its exact frame but yields to a new visible response. */
  get suspended(): boolean {
    return this.visibilityPaused;
  }

  get idleRunning(): boolean {
    return this.idle.isRunning;
  }

  get reducedMotion(): boolean {
    return this.reduced.matches;
  }

  /**
   * The running scene is the puppet's own idle life (the bunny's sniff every 16–26 s), not one the app
   * asked for: it yields to any play() (wave 3, I-01). The app's one-mascot arbiter treats it as not busy.
   */
  get ownScene(): boolean {
    return this.busy && this.own;
  }

  // ---------- public API ----------

  /**
   * Plays a scene. One scene at a time: while a scene the APP started is running, a new play() is ignored
   * and resolves immediately (same as the prototypes). The puppet's own idle scene (its sniff) is
   * interrupted instead: it snaps back to rest and the requested scene plays (wave 3, I-01).
   * 'sleep' toggles (asleep -> wakes up); any other scene wakes him first.
   */
  async play(scene: S): Promise<void> {
    if (this.destroyed) return;
    if (this.ownScene) await this.interrupt();
    // one scene at a time: ignored while a scene the app started is running
    if (this.busy || this.destroyed) return;
    this.svg.classList.remove('idle-paused');
    await this.run(scene, false);
  }

  /** The puppet's own idle life (the bunny's sniff): any play() interrupts it. Ignored while busy. */
  protected playOwn(scene: S): Promise<void> {
    if (this.destroyed || this.busy) return Promise.resolve();
    return this.run(scene, true);
  }

  private async run(scene: S, own: boolean): Promise<void> {
    const task = this.queue.run(async () => {
      this.own = own;
      const gen = this.runGen;
      try {
        if (scene === 'sleep') {
          if (this.sleeping) await this.wakeUp();
          else await this.fallAsleep();
          return;
        }
        if (this.sleeping) await this.wakeUp();
        if (scene === 'idle') return;
        this.beginScene(scene);
        try {
          await this.runScene(scene);
        } finally {
          this.endScene(scene);
        }
      } catch (err) {
        if (!(err instanceof SceneInterrupted)) throw err;
      } finally {
        if (gen === this.runGen) this.own = false;
      }
    });
    this.running = task;
    const ran = await task;
    if (this.running === task) this.running = null;
    if (ran && this.angryPending && !this.destroyed) {
      this.angryPending = false;
      this.timeout(() => void this.touchAngry(), 0);
    }
  }

  /**
   * Ends the running scene at once — the puppet snaps back to its rest pose (an asleep one stays asleep).
   * The app's arbiter uses it when a more important moment needs the stage (work beats decoration); play()
   * uses it for the puppet's own sniff. Resolves when the puppet is free again.
   */
  async interrupt(): Promise<void> {
    if (this.destroyed || !this.busy) return;
    const running = this.running;
    this.runGen += 1;
    this.own = false;
    // the helpers of the old run throw on their next step (SceneInterrupted); its timers and animations go
    this.timers.forEach((t) => { if (t.timer !== null) clearTimeout(t.timer); });
    this.timers.clear();
    this.waiters.forEach((w) => w());
    this.waiters.clear();
    if (typeof this.svg.getAnimations === 'function') {
      this.svg.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    }
    const asleep = this.sleeping;
    this.resetPose();
    if (asleep) this.hm.classList.add('sleeping');
    if (asleep) this.setEyes('sleep');
    if (running) await running.catch(() => undefined);
  }

  /**
   * A tap on the mascot: jumps; 5 taps within 2.5 s make him angry
   * (queued after the running scene if busy); a tap while asleep wakes him.
   * The only moments the package asks the app to vibrate for: 'tap' (jump, wake) and 'warning' (anger).
   */
  tap(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.sleeping) {
      if (!this.busy) this.haptic('tap');
      return this.play('sleep' as S);
    }
    const now = Date.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length >= 5) {
      this.taps = [];
      if (this.busy && !this.own) {
        this.angryPending = true;
        return Promise.resolve();
      }
      return this.touchAngry();
    }
    // a jump that would be ignored (an app scene runs) gets no vibration either: never a haptic without a visible answer
    if (this.busy && !this.own) return Promise.resolve();
    this.haptic('tap');
    return this.play('jump' as S);
  }

  /** The 5-taps anger (now or after the scene that was running). */
  private touchAngry(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.haptic('warning');
    return this.play('angry' as S);
  }

  /** Small hop without stars — the prototypes do this when a coat or ear style is switched. Ignored while busy or asleep. */
  hop(): Promise<void> {
    if (this.destroyed || this.busy || this.sleeping) return Promise.resolve();
    this.svg.classList.remove('idle-paused');
    return this.jumpMotion(10, 560).catch(() => undefined);
  }

  setCoat(id: C): void {
    const c = this.spec.coats.find((x) => x.id === id) ?? this.spec.coats[0];
    if (!c) return;
    const [top, bottom, belly, accent, accentDark, paw, earIn] = c.colors;
    const s = this.host.style;
    s.setProperty('--mascot-base-top', top);
    s.setProperty('--mascot-base-bottom', bottom);
    s.setProperty('--mascot-belly', belly);
    s.setProperty('--mascot-accent', accent);
    s.setProperty('--mascot-accent-dark', accentDark);
    s.setProperty('--mascot-paw', paw);
    s.setProperty('--mascot-ear-in', earIn);
    this.hm.classList.remove(...this.spec.patternClasses);
    if (c.pattern !== 'none') this.hm.classList.add(`pat-${c.pattern}`);
    this.coatId = c.id;
    // the coat's own fur (fur.ts, opt-in: setBunnyFur) — without a setting nothing changes
    if (this.kind === 'bunny') applyFur(this.hm, c.id);
  }

  setEyes(mode: EyeMode): void {
    this.eyesMode = mode;
    this.paintEyes();
  }

  /**
   * Eyes for the still puppet under reduced motion ('happy' arcs / 'sleep'; null = keep them open). While
   * reduced, open eyes are drawn as these (the Weniger contract: nobody keeps staring at you); a scene that
   * sets other eyes (stars, sleep) still shows them.
   */
  setCalmEyes(eyes: CalmEyes | null): void {
    this.calm = eyes;
    this.paintEyes();
  }

  private paintEyes(): void {
    const shown: EyeMode = this.calm && this.reduced.matches && this.eyesMode !== 'sleep' ? this.calm : this.eyesMode;
    this.hm.classList.remove('m-star', 'm-happy', 'm-sleep');
    if (shown !== 'normal') this.hm.classList.add(`m-${shown}`);
  }

  /** Cheek fullness (1 = normal; the prototypes use 1.2–1.35 after eating / when angry). */
  setPuff(p: number): void {
    this.hm.style.setProperty('--puff', String(p));
  }

  /** Stage width in CSS px; the height follows the viewBox ratio. */
  setSize(px: number): void {
    this.host.style.width = `${px}px`;
  }

  setReducedMotion(mode: ReducedMotionMode): void {
    this.reduced.setMode(mode);
  }

  startIdle(): void {
    this.svg.classList.remove('idle-paused');
    this.idle.start();
    if (this.sleeping) this.startSleepEffects();
  }

  /** Stops the idle loop — and the puppet's own idle scene, if one is running (another mascot takes the stage). */
  stopIdle(): void {
    this.idle.stop();
    this.svg.classList.add('idle-paused');
    if (this.sleeping) this.stopSleepEffects();
    if (this.ownScene) void this.interrupt();
  }

  /** Stops everything, removes the shadow content and all listeners/timers. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.idle.destroy();
    this.reduced.destroy();
    this.host.removeEventListener('click', this.onClick);
    this.timers.forEach((t) => { if (t.timer !== null) clearTimeout(t.timer); });
    this.timers.clear();
    this.clearIntervals();
    this.waiters.forEach((w) => w());
    this.waiters.clear();
    if (typeof this.svg.getAnimations === 'function') {
      this.svg.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    }
    this.pausedAnimations.clear();
    this.root.innerHTML = '';
    for (const k of COAT_VARS) this.host.style.removeProperty(k);
    this.host.style.removeProperty('width');
    this.host.style.removeProperty('cursor');
  }

  // ---------- helpers for scenes ----------

  protected $<T extends SVGElement = SVGElement>(sel: string): T {
    const el = this.svg.querySelector<T>(sel);
    if (!el) throw new Error(`[mascot] missing part: ${sel}`);
    return el;
  }

  protected $$<T extends SVGElement = SVGElement>(sel: string): T[] {
    return [...this.svg.querySelectorAll<T>(sel)];
  }

  /**
   * anim() from core, bound to this mascot's reduced-motion state. Rejects (SceneInterrupted) when the
   * scene was interrupted meanwhile, so the rest of that scene never runs; a call nobody awaits stays quiet.
   */
  protected anim(el: AnimTarget, frames: Keyframe[], opts?: KeyframeAnimationOptions): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const gen = this.runGen;
    const promise = anim(el, frames, opts, this.reduced.matches);
    if (this.visibilityPaused) this.pauseRunningAnimations();
    return this.guard(promise, gen);
  }

  protected wait(ms: number): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const gen = this.runGen;
    if (this.visibilityPaused) this.pauseRunningAnimations();
    const p = new Promise<void>((resolve) => {
      const done = () => {
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      this.timeout(done, ms);
    });
    return this.guard(p, gen);
  }

  /** `p`, but rejecting with SceneInterrupted when run `gen` was interrupted by the time it settles. */
  private guard(p: Promise<void>, gen: number): Promise<void> {
    const out = p.then(() => {
      if (gen !== this.runGen) throw new SceneInterrupted();
    });
    out.catch(() => undefined);
    return out;
  }

  /** Awaits `p` inside a scene (e.g. a lazily loaded scene module); the rest of the scene never runs when it was interrupted meanwhile. */
  protected async after<T>(p: Promise<T>): Promise<T> {
    const gen = this.runGen;
    const value = await p;
    if (gen !== this.runGen || this.destroyed) throw new SceneInterrupted();
    return value;
  }

  /**
   * A timeline scene (27.10, tapsi-moments.ts): `start` authors and starts its Web Animations on the puppet's parts
   * and hands back the end clock and a cleanup. While it runs the puppet is in its 'driven' mode (the mascot CSS
   * switches its own loops and transitions off for those parts); the animations pause and resume with the puppet
   * (offscreen, hidden tab); interrupt() cancels them (the clock settles, the rest of the scene does not run).
   * Afterwards the cleanup removes every inline style the scene wrote.
   */
  protected async drive(start: (svg: SVGSVGElement) => { clock: Animation | null; cleanup: () => void }): Promise<void> {
    if (this.destroyed) return;
    const gen = this.runGen;
    this.hm.classList.add('driven');
    const run = start(this.svg);
    if (this.visibilityPaused) this.pauseRunningAnimations();
    try {
      await this.guard(settled(run.clock ?? undefined), gen);
    } finally {
      run.cleanup();
      this.hm.classList.remove('driven');
    }
  }

  /** Asks the app to vibrate (MascotOptions.haptics); never navigator.vibrate itself. */
  protected haptic(kind: MascotHapticKind): void {
    if (this.destroyed || !this.haptics) return;
    try {
      this.haptics(kind);
    } catch {
      /* the app's wrapper must never break a scene */
    }
  }

  protected timeout(fn: () => void, ms: number): void {
    const task: SceneTimer = { fn, remaining: ms, started: 0, timer: null };
    this.timers.add(task);
    this.armTimer(task);
  }

  private armTimer(task: SceneTimer): void {
    if (this.visibilityPaused || this.destroyed) return;
    task.started = Date.now();
    task.timer = setTimeout(() => {
      task.timer = null;
      this.timers.delete(task);
      if (!this.destroyed) task.fn();
    }, task.remaining);
  }

  private pauseRunningAnimations(): void {
    this.svg.getAnimations?.({ subtree: true }).forEach((animation) => {
      if (animation.playState !== 'running') return;
      animation.pause();
      this.pausedAnimations.add(animation);
    });
  }

  private onVisibility(visible: boolean): void {
    this.visibilityPaused = !visible;
    this.svg.classList.toggle('visibility-paused', !visible);
    if (!visible) {
      this.pauseRunningAnimations();
      for (const task of this.timers) {
        if (task.timer === null) continue;
        clearTimeout(task.timer);
        task.timer = null;
        task.remaining = Math.max(0, task.remaining - (Date.now() - task.started));
      }
      if (this.sleeping) this.stopSleepEffects();
    } else {
      for (const animation of this.pausedAnimations) {
        if (animation.playState === 'paused') animation.play();
      }
      this.pausedAnimations.clear();
      for (const task of this.timers) this.armTimer(task);
      if (this.sleeping) this.startSleepEffects();
    }
  }

  protected interval(fn: () => void, ms: number): void {
    this.intervals.add(setInterval(fn, ms));
  }

  protected clearIntervals(): void {
    this.intervals.forEach((t) => clearInterval(t));
    this.intervals.clear();
  }

  /** Adds a state class for `ms` milliseconds. */
  protected pulse(cls: string, ms: number): void {
    this.hm.classList.add(cls);
    this.timeout(() => this.hm.classList.remove(cls), ms);
  }

  protected mouthOpen(on: boolean): void {
    this.hm.classList.toggle('m-open', on);
  }

  protected get isReduced(): boolean {
    return this.reduced.matches;
  }

  /** "Alive" idle loops only run while resting with normal eyes (as in the prototypes). */
  protected isIdle(): boolean {
    return !this.busy && !this.sleeping && this.eyesMode === 'normal';
  }

  protected addIdleLoop(fn: () => void, min: number, spread: number): void {
    this.idle.add(fn, min, spread);
  }

  // ---------- shared choreography ----------

  /** Squash -> stretch -> tucked feet -> landing slap. Skipped entirely under reduced motion. */
  protected async jumpMotion(h = 36, d = 900, binky = false): Promise<void> {
    if (this.reduced.matches || this.destroyed) return;
    const gen = this.runGen;
    const o: KeyframeAnimationOptions = { duration: d };
    fxAnimate(
      this.hopG,
      [
        { transform: 'translateY(0px)', offset: 0 },
        { transform: 'translateY(0px)', offset: 0.18, easing: EASINGS.jumpUp },
        { transform: `translateY(-${h}px)`, offset: 0.52, easing: EASINGS.jumpDown },
        { transform: 'translateY(0px)', offset: 0.82 },
        { transform: 'translateY(0px)', offset: 1 },
      ],
      o,
    );
    fxAnimate(this.body, this.jumpBodyFrames(binky), o);
    const foot = (s: number): Keyframe[] => [
      { transform: 'none', offset: 0 },
      { transform: `translateX(${-2 * s}px) scaleX(1.12)`, offset: 0.18 },
      { transform: `translate(${2 * s}px,-8px) rotate(${18 * s}deg) scale(.8)`, offset: 0.4 },
      { transform: `translate(${2 * s}px,-8px) rotate(${18 * s}deg) scale(.8)`, offset: 0.66 },
      { transform: `translateX(${-3 * s}px) scaleX(1.18)`, offset: 0.84 },
      { transform: 'none', offset: 1 },
    ];
    fxAnimate(this.footL, foot(1), o);
    fxAnimate(this.footR, foot(-1), o);
    fxAnimate(
      this.paws,
      [
        { transform: 'none' },
        { transform: 'translateY(2px)', offset: 0.18 },
        { transform: 'translateY(-7px)', offset: 0.4 },
        { transform: 'translateY(-4px)', offset: 0.66 },
        { transform: 'translateY(3px)', offset: 0.84 },
        { transform: 'none' },
      ],
      o,
    );
    this.jumpEars(o);
    this.cheeks.forEach((c) =>
      fxAnimate(
        c,
        [
          { transform: 'none', offset: 0 },
          { transform: 'none', offset: 0.8 },
          { transform: 'scale(1.09,.92)', offset: 0.87 },
          { transform: 'scale(.97,1.03)', offset: 0.94 },
          { transform: 'none', offset: 1 },
        ],
        o,
      ),
    );
    const landing = fxAnimate(
        this.shadow,
        [
          { transform: 'none', opacity: 1 },
          { transform: 'scale(1.06)', offset: 0.18 },
          { transform: 'scale(.62)', opacity: 0.5, offset: 0.52 },
          { transform: 'scale(1.08)', opacity: 1, offset: 0.84 },
          { transform: 'none', opacity: 1 },
        ],
        o,
      );
    if (this.visibilityPaused) this.pauseRunningAnimations();
    await settled(landing);
    if (gen !== this.runGen) throw new SceneInterrupted();
  }

  /** A cookie crumb falling from the mouth. */
  protected crumb(): void {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', (1 + Math.random() * 1.2).toFixed(1));
    c.setAttribute('fill', '#E9B04E');
    this.fx.appendChild(c);
    const dx = (Math.random() - 0.5) * 34;
    fxAnimate(
      c,
      [
        { transform: `translate(0px,${this.spec.crumbY}px)`, opacity: 1 },
        { transform: `translate(${dx}px,-4px)`, opacity: 0 },
      ],
      { duration: 650 + Math.random() * 300, easing: EASINGS.crumb },
      () => c.remove(),
    );
  }

  /** One floating "z". */
  protected spawnZ(): void {
    const { x, y } = this.spec.zOrigin;
    const t = document.createElementNS(SVG_NS, 'text');
    t.textContent = 'z';
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.setAttribute('font-size', '15');
    t.setAttribute('font-weight', '700');
    t.setAttribute('fill', 'var(--mascot-accent-dark)');
    t.setAttribute('font-family', '-apple-system, Segoe UI, system-ui, sans-serif');
    this.fx.appendChild(t);
    fxAnimate(
      t,
      [
        { transform: 'translate(0px,0px) scale(.6)', opacity: 0 },
        { transform: 'translate(10px,-16px) scale(1)', opacity: 1, offset: 0.3 },
        { transform: 'translate(26px,-48px) scale(1.25)', opacity: 0 },
      ],
      { duration: 2600, easing: 'ease-out' },
      () => t.remove(),
    );
  }

  /** Sniffs the snot drip back in. */
  protected sniff(): void {
    this.pulse('sniff', 700);
  }

  /** Yawn -> nods off twice -> sleeps (snot drip + "z" letters until woken). */
  protected async fallAsleep(): Promise<void> {
    this.beginScene('sleep' as S);
    this.hm.classList.add('m-yawn');
    this.setEyes('happy');
    await this.anim(
      this.body,
      [{ transform: 'none' }, { transform: 'scale(.97,1.05)', offset: 0.5 }, { transform: 'none' }],
      { duration: 1100, easing: 'ease-in-out' },
    );
    this.hm.classList.remove('m-yawn');
    this.setEyes('sleep');
    for (let k = 0; k < 2; k++) {
      await this.anim(
        this.body,
        [{ transform: 'none' }, { transform: 'translateY(3px) scale(1.02,.97)', offset: 0.4 }, { transform: 'none' }],
        { duration: 760, easing: 'ease-in-out' },
      );
      await this.wait(160);
    }
    if (this.destroyed) return;
    this.sleeping = true;
    this.hm.classList.add('sleeping');
    this.startSleepEffects();
  }

  private startSleepEffects(): void {
    if (this.reduced.matches || !this.idle.active || this.intervals.size > 0) return;
    this.spawnZ();
    this.interval(() => { if (this.idle.active) this.spawnZ(); }, 1900);
    this.interval(() => { if (this.idle.active) this.sniff(); }, 10200);
  }

  private stopSleepEffects(): void {
    this.clearIntervals();
    this.fx.getAnimations?.({ subtree: true }).forEach((a) => a.cancel());
    this.fx.replaceChildren();
    this.hm.classList.remove('sniff');
  }

  /** Startled awake: sniff, wide eyes, a small hop, then stars. */
  protected async wakeUp(): Promise<void> {
    this.sleeping = false;
    this.clearIntervals();
    this.sniff();
    this.hm.classList.remove('sleeping');
    this.setEyes('normal');
    this.hm.classList.add('startle');
    await this.jumpMotion(16, 650);
    this.hm.classList.remove('startle');
    this.setEyes('star');
    await this.wait(500);
    this.setEyes('normal');
    this.endScene('sleep' as S);
  }

  /** Debug helper for pose(): clears every transient state (not the lasting ones: ears, coat pattern, what he holds). */
  protected resetPose(): void {
    for (const c of [...this.hm.classList]) {
      if (!(c === 'hm' || c.startsWith('ears-') || c.startsWith('pat-') || c.startsWith('hold-'))) this.hm.classList.remove(c);
    }
    this.setEyes('normal');
    this.setPuff(1);
    for (const el of [this.body, this.pawR, this.paws, this.cookie, this.mover]) el.style.transform = '';
    this.cookie.style.opacity = '';
  }

  // ---------- scene bookkeeping ----------

  private beginScene(scene: S): void {
    this.current = scene;
    this.emit('mascot-scene-start', scene);
  }

  private endScene(scene: S): void {
    if (this.current === scene) this.current = null;
    this.emit('mascot-scene-end', scene);
  }

  private emit(name: 'mascot-scene-start' | 'mascot-scene-end', scene: S): void {
    if (this.destroyed) return;
    const detail: MascotSceneEventDetail = { kind: this.kind, scene };
    this.host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  private applyReduced(): void {
    this.svg.classList.toggle('rm', this.reduced.matches);
    if (this.reduced.matches && this.busy) void this.interrupt();
    if (this.sleeping) {
      this.stopSleepEffects();
      if (!this.reduced.matches) this.startSleepEffects();
    }
    this.paintEyes();
  }
}
