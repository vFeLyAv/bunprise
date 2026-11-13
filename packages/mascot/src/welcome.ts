/**
 * WelcomeStage — several bunnies climb out from behind the screen edges with
 * their paws, look around, duck back, one hops across, and the main (fawn)
 * bunny ends peeking up from the bottom and waving (Felix's idea, 2026-10-20,
 * after the app icon "кролик выглядывает снизу, лапками цепляется").
 *
 * - The host's own edges are the screen edges; the stage fills the host and
 *   clips everything to it. Sizes follow the host height (min/max clamped).
 * - One timeline: every animated part is one Web Animation (timeline.ts),
 *   no requestAnimationFrame, no timers while animating. seek(t) is exact.
 * - Only transform / opacity are animated. At most 4 actors.
 * - Paused while the page is hidden or the stage is off-screen (IdleScheduler).
 * - Reduced motion: no motion at all — a static composition (the main bunny
 *   peeking from the bottom, paws on the edge) that fades in.
 */

import { IdleScheduler, ReducedMotion } from './core';
import {
  DEFAULT_TILT,
  FLOOR_TILT,
  Peeker,
  placePeek,
  Runner,
  runSchedule,
  type Actor,
  type PeekPlace,
  type RunPlan,
  type RunSchedule,
  type StageGeo,
  type Vec,
} from './welcome-actors';
import { Playhead, type Compiled, type Sampled, type StyleOut } from './timeline';
import type {
  BunnyCoat,
  CalmEyes,
  LookDir,
  LookStep,
  PeekStep,
  ReducedMotionMode,
  RunStep,
  StageEdge,
  WelcomeOptions,
  WelcomePartStyle,
  WelcomePreset,
  WelcomeStep,
} from './types';

/** Never more than this many bunnies on the stage. */
export const MAX_ACTORS = 4;

/** In the order they appear in 'welcome': [0] main (greets at the end), [1] bottom left, [2] right edge, [3] runner. */
export const WELCOME_DEFAULT_BUNNIES: readonly BunnyCoat[] = ['fawn', 'himalayan', 'choc', 'broken'];

export const WELCOME_PRESETS: readonly WelcomePreset[] = [
  'welcome',
  'peek-once',
  'peek-bottom',
  'peek-left',
  'peek-right',
  'run',
  'hop-across',
  'peek-side',
  'pop-up',
  'wave',
  'lost',
  'shrug',
  'sleepy',
  'corner-left', 'corner-right', 'meet', 'ears-only', 'lift', 'surprise', 'peek-sniff',
  'climb-left', 'climb-right',
];

/** Seconds the staying bunny rests before a loop restarts (loop mode only). */
const LOOP_HOLD = 2.6;
/** Reduced-motion fade-in, ms (must match .rm-in in STAGE_CSS). */
const FADE_MS = 450;
/**
 * Side peeks from behind a door frame (`floor`): the centre line this many units BEHIND the edge.
 * With the 3/4 turn the near eye, the nose and the whole muzzle are inside the stage (≥ 2.5 px) and
 * the far eye stays behind the edge (≥ 2 px) in every glance — a half-cut eye or muzzle read as a
 * strange sign (measured like getBoundingClientRect, i.e. the rotated boxes). Works together with the
 * small glances of a turned bunny (welcome-actors SIDE_LOOK_AMP).
 */
const SIDE_REVEAL = -4.4;

/**
 * The steps of a built-in choreography for `count` bunnies.
 * 'welcome' needs 4 for the full show (fewer bunnies = fewer roles; the main bunny always ends it).
 */
export function welcomeSteps(name: WelcomePreset, count = WELCOME_DEFAULT_BUNNIES.length): WelcomeStep[] {
  switch (name) {
    case 'corner-left':
    case 'corner-right':
      return [{ type: 'peek', actor: 0, edge: name === 'corner-left' ? 'left' : 'right', at: 0.1, floor: true, reveal: SIDE_REVEAL, look: [['in', 0.4]], sniff: true, hold: 0.7 }];
    case 'meet':
      return [
        { type: 'peek', actor: 0, edge: 'left', at: 0.1, floor: true, reveal: SIDE_REVEAL, lookFrom: 1.05, look: [['at:1', 0.5]], nod: 'pt:0.25,1.2', hold: 1.2 },
        { type: 'peek', actor: 1, edge: 'right', at: 0.65, floor: true, reveal: SIDE_REVEAL, lookFrom: 1.05, look: [['at:0', 0.5]], nod: 'pt:0.75,1.2', hold: 1.2 },
      ];
    case 'ears-only':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.1, pos: 0.75, earsOnly: true }];
    case 'lift':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0, seated: true, lookFrom: 0.35, look: [['in', 0.4]], stay: true }];
    case 'surprise':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.1, lookFrom: 1.05, surprise: true, hold: 0 }];
    case 'peek-sniff':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.1, pos: 0.8, lookFrom: 1.05, look: [['down', 0.4]], sniff: true, hold: 0.6 }];
    // near one end of the card's top edge (not a side door frame: over a floating sheet there is none), the
    // climb of the approved peek; it leans toward the middle and looks along the card, then at you
    case 'climb-left':
    case 'climb-right': {
      const left = name === 'climb-left';
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.1, pos: left ? 0.22 : 0.78, tilt: left ? 7 : -7, face: 'in', lookFrom: 1.05, look: [['in', 0.45], ['viewer', 0.4]], sniff: true, hold: 0.8 }];
    }
    case 'peek-once':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.15, look: [['left', 0.45], ['right', 0.45], ['viewer', 0.3]], stay: true }];
    case 'peek-bottom':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.2, look: [['left', 0.5], ['right', 0.5], ['viewer', 0.45]], hold: 1.6 }];
    // side edges: standing behind the edge like behind a door frame, turned 3/4 into the stage
    // (`floor: false` + `pos` gives the sideways mid-height variant)
    case 'peek-left':
      return [{ type: 'peek', actor: 0, edge: 'left', at: 0.2, floor: true, reveal: SIDE_REVEAL, look: [['in', 0.55]], sniff: true, hold: 2.2 }];
    case 'peek-right':
      return [{ type: 'peek', actor: 0, edge: 'right', at: 0.2, floor: true, reveal: SIDE_REVEAL, look: [['in', 0.55]], sniff: true, hold: 2.2 }];
    case 'run':
      return [{ type: 'run', actor: 0, at: 0.1, from: 'left', pause: 0.42 }];
    // the short moments of wave 1 (apps/web features/mascot-ui BunnyMoment)
    case 'hop-across':
      // across the bottom edge without a stop, a little faster with every hop; as big as a main bunny
      return [{ type: 'run', actor: 0, at: 0.1, from: 'left', pause: null, speed: 1.05, scale: 1 }];
    case 'peek-side':
      return [{ type: 'peek', actor: 0, edge: 'right', at: 0.2, floor: true, reveal: SIDE_REVEAL, look: [['in', 0.6], ['viewer', 0.45]], hold: 1.5 }];
    case 'pop-up':
      // at the right of the card: over a card's top edge it never covers the text that starts at the left
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.15, pos: 0.8, lookFrom: 1.1, look: [['viewer', 0.55], ['left', 0.35], ['viewer', 0.3]], hold: 0.9 }];
    case 'wave':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.15, lookFrom: 1.1, look: [['viewer', 0.3]], greet: true, stay: true }];
    case 'lost':
      return [
        { type: 'peek', actor: 0, edge: 'bottom', at: 0.15, lookFrom: 1.1, look: [['left', 0.55], ['right', 0.6], ['left', 0.35], ['up', 0.45], ['viewer', 0.35]], sniff: true, stay: true },
      ];
    case 'shrug':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.15, lookFrom: 1.1, look: [['viewer', 0.35]], shrug: true, stay: true }];
    case 'sleepy':
      return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.15, lookFrom: 1.1, look: [['viewer', 0.4]], doze: true, stay: true }];
    case 'welcome':
    default:
      return welcomeShow(count);
  }
}

/**
 * The welcome show (4 bunnies, ≈ 8 s; every beat is in the README table). One big move at a time
 * (a climb, a hop, a duck), everything else small (a glance, a blink, an ear); every glance has a reason:
 *   0.25  [1] climbs up at the bottom left; 1.30 looks at [2]'s ear tip, 2.05 at you, 2.30 left (someone is coming) -> ducks 2.40
 *   1.10  [2] behind the right edge (door frame), turned 3/4: climbs up looking at [1]; 2.10 at you; 2.80 sniffs
 *         (the runner just hopped in); ducks 4.14 as the runner hops its way ("made it")
 *   2.55  [3] hops in from the left right over the spot where [1] just vanished, slows down, sits at 36 %
 *         (looks at you: "oops, seen"), hops out faster (out of the frame ≈ 4.75)
 *   4.58  [0] ear tips once the runner is past (its first paw ≈ 0.14 s after the runner is gone), climbs up
 *         watching where it went; 5.73 at you; 6.03 greets; stays
 */
function welcomeShow(n: number): WelcomeStep[] {
  const main: PeekStep = {
    type: 'peek',
    actor: 0,
    edge: 'bottom',
    at: 4.58,
    face: 'right',
    lookFrom: 1.15,
    look: [['viewer', 0.3]],
    greet: true,
    stay: true,
  };
  if (n <= 1) return [{ type: 'peek', actor: 0, edge: 'bottom', at: 0.25, look: [['left', 0.45], ['viewer', 0.3]], greet: true, stay: true }];
  // the same hand-over as in the full show: the runner is out of the frame at ≈ 2.50, the main bunny's first paw ≈ 2.64
  if (n === 2) return [{ type: 'run', actor: 1, at: 0.3, from: 'left', pause: 0.36 }, { ...main, at: 2.33 }];
  const four = n >= 4;
  const steps: WelcomeStep[] = [
    {
      type: 'peek',
      actor: 1,
      edge: 'bottom',
      at: 0.25,
      pos: 0.24,
      tilt: 8,
      lookFrom: 1.05,
      look: four ? [['at:2', 0.75], ['viewer', 0.25], ['left', 0.1]] : [['right', 0.55], ['viewer', 0.45], ['left', 0.1]],
      hold: 0,
    },
  ];
  // the runner reaches [1]'s spot (≈ 2.67) just as its ears go under: no two silhouettes on top of each other
  if (four) {
    // the long look at you puts the sniff after the runner's arrival (a reaction to it, not a third big
    // move at 2.5); it ducks at 4.10, 0.19 s after the runner set off its way, and is gone before it comes by
    steps.push({ type: 'peek', actor: 2, edge: 'right', at: 1.1, floor: true, reveal: SIDE_REVEAL, face: 'at:1', lookFrom: 1.0, look: [['viewer', 0.66]], sniff: true, hold: 1.83 });
    steps.push({ type: 'run', actor: 3, at: 2.55, from: 'left', pause: 0.36 });
  } else {
    steps.push({ type: 'run', actor: 2, at: 2.55, from: 'left', pause: 0.36 });
  }
  steps.push(main);
  return steps;
}

// ---------- step resolution ----------

const EDGES: readonly StageEdge[] = ['bottom', 'left', 'right', 'top'];

function lookSteps(look: readonly LookStep[] | undefined): Array<readonly [LookDir, number]> {
  return (look ?? []).map((l) => (typeof l === 'string' ? ([l, 0.5] as const) : ([l[0], l[1]] as const)));
}

function validStep(s: WelcomeStep): boolean {
  if (!s || (s.type !== 'peek' && s.type !== 'run')) return false;
  if (!Number.isFinite(s.at) || s.at < 0 || !Number.isInteger(s.actor) || s.actor < 0) return false;
  return s.type === 'run' || EDGES.includes(s.edge);
}

function resolveInset(v: WelcomeOptions['edgeInset']): Record<StageEdge, number> {
  const clamp = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  if (typeof v === 'number') {
    const n = clamp(v);
    return { bottom: n, left: n, right: n, top: n };
  }
  return { bottom: clamp(v?.bottom), left: clamp(v?.left), right: clamp(v?.right), top: clamp(v?.top) };
}

/** px per bunny unit for the main bunny: the peek is ~36 % of the stage height, ~half its width, clamped. */
export function stageUnit(W: number, H: number, minSize = 96, maxSize = 300): number {
  const byH = (H * 0.36) / 118;
  const byW = (W * 0.52) / 162;
  const lo = Math.max(10, minSize) / 162;
  const hi = Math.max(lo, maxSize / 162);
  return Math.min(hi, Math.max(lo, Math.min(byH, byW)));
}

/**
 * The clip outline when the card under the stage (or a header over it) has rounded corners: the
 * straight edge line plus the card's own quarter circles, so a bunny near a corner hides behind the
 * curve (not behind an invisible straight line over the background). Clip-box coordinates (px);
 * the card is as wide as the host.
 */
export function cardOutline(geo: StageGeo, boxTop: number, rT: number, rB: number): string {
  const { W, H, inset } = geo;
  const x0 = -inset.left;
  const x1 = W - inset.left;
  const yT = inset.top - boxTop;
  const yB = H - inset.bottom - boxTop;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const d: string[] = [];
  if (rT > 0) d.push(`M${n(x0)} ${n(yT - rT)}`, `A${n(rT)} ${n(rT)} 0 0 0 ${n(x0 + rT)} ${n(yT)}`, `H${n(x1 - rT)}`, `A${n(rT)} ${n(rT)} 0 0 0 ${n(x1)} ${n(yT - rT)}`);
  else d.push(`M${n(x0)} ${n(yT)}`, `H${n(x1)}`);
  if (rB > 0) d.push(`V${n(yB + rB)}`, `A${n(rB)} ${n(rB)} 0 0 0 ${n(x1 - rB)} ${n(yB)}`, `H${n(x0 + rB)}`, `A${n(rB)} ${n(rB)} 0 0 0 ${n(x0)} ${n(yB + rB)}`);
  else d.push(`V${n(yB)}`, `H${n(x0)}`);
  d.push('Z');
  return d.join(' ');
}

function runPlanOf(run: RunStep, u: number, geo: StageGeo): RunPlan {
  const dir: 1 | -1 = run.from === 'right' ? -1 : 1;
  const off = 100 * u;
  const left = -off;
  const right = geo.W + off;
  const pause = run.pause === undefined ? 0.38 : run.pause;
  return {
    at: run.at,
    dir,
    x0: dir === 1 ? left : right,
    xp: pause === null ? null : dir === 1 ? pause * geo.W : (1 - pause) * geo.W,
    x1: dir === 1 ? right : left,
    ground: geo.H - geo.inset.bottom - 4 * u,
    speed: run.speed && run.speed > 0 ? run.speed : 1,
  };
}

/** Where the runner's head is at t (host px), along its hops. */
function runnerAt(run: RunPlan, s: RunSchedule, u: number, t: number): Vec {
  let x = run.x0;
  for (const h of s.hops) {
    if (t <= h.t) break;
    x = t >= h.t + h.d ? h.x + h.dx : h.x + (h.dx * (t - h.t)) / h.d;
  }
  return { x, y: run.ground - 105 * u };
}

/** One part of the show, placed: a peek or a crossing of one bunny. */
type Part =
  | { kind: 'peek'; step: PeekStep; key: string; coat: BunnyCoat; u: number; place: PeekPlace }
  | { kind: 'run'; step: RunStep; key: string; coat: BunnyCoat; u: number; run: RunPlan; sched: RunSchedule };

// ---------- the stage ----------

const STAGE_CSS = `
:host { display: block; position: relative; overflow: hidden; min-height: 120px; contain: layout paint; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
:host([hidden]) { display: none; }
.stage { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.clip { position: absolute; overflow: hidden; }
.layer { position: absolute; inset: 0; }
.frame { position: absolute; left: 0; top: 0; }
.lift, .calm, .actor { position: absolute; inset: 0; }
.grip-svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; overflow: visible; }
.grip { transform-box: view-box; transform-origin: 0 0; }
.clip .grip-sh { display: none; }
.stage.rm-hidden { opacity: 0; }
.stage.rm-in { animation: bp-welcome-in .45s ease-out both; }
@keyframes bp-welcome-in { from { opacity: 0; } to { opacity: 1; } }
`;

type Mode = 'idle' | 'playing' | 'paused';

interface Built {
  geo: StageGeo;
  actors: Actor[];
  sampled: Sampled[];
  playhead: Playhead;
  /** seconds: the choreography is over (onEnd) */
  duration: number;
  /** seconds: loop length (loop mode only) */
  period: number;
  endClock: Animation | null;
  loopClock: Animation | null;
  isStatic: boolean;
  cast: Member[];
}

/**
 * One actor on the stage. Before its part it is hidden behind its edge anyway, so it is
 * `display: none` with no animations yet; a WAAPI clock (`prep`) brings it in a moment before
 * its first move. After its last move it is hidden again. seek(t) sets all of this from t.
 */
interface Member {
  actor: Actor;
  /** s: shown and animated from here (PREP before its first move) */
  on: number;
  /** s: hidden again from here (after its last move; Infinity when it stays) */
  off: number;
  compiled: Compiled[];
  active: boolean;
  shown: boolean;
  prep: Animation | null;
}

/** An actor joins this long before its first move (time to build its animations and style). */
const PREP = 0.6;
/** playWhenIdle(): play at the latest after this long, ms. */
const IDLE_TIMEOUT = 600;

function applyStyle(el: Element, s: StyleOut | null): void {
  if (!s) return;
  const st = (el as HTMLElement).style;
  if (s.transform !== undefined) st.transform = s.transform;
  if (s.opacity !== undefined) st.opacity = s.opacity;
  if (s.d !== undefined) st.setProperty('d', s.d);
}

export class WelcomeStage {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;

  private readonly stageEl: HTMLDivElement;
  private readonly reduced: ReducedMotion;
  private readonly watch: IdleScheduler;
  private ro: ResizeObserver | null = null;
  private readonly coats: readonly BunnyCoat[];
  private readonly choreo: WelcomePreset | readonly WelcomeStep[];
  private readonly loop: boolean;
  private readonly onEnd: (() => void) | undefined;
  private readonly inset: Record<StageEdge, number>;
  private readonly radius: Record<StageEdge, number>;
  private readonly minSize: number;
  private readonly maxSize: number;
  private readonly calmEyes: CalmEyes | undefined;
  private readonly item: 'calendar' | undefined;

  private built: Built | null = null;
  private mode: Mode = 'idle';
  /** stage time while not running (seconds) */
  private held = 0;
  /** paused by visibility / off-screen, will resume */
  private parked = false;
  private gen = 0;
  private endFired = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** cancels a pending playWhenIdle() */
  private idleCancel: (() => void) | null = null;
  private destroyed = false;
  private size = { W: 0, H: 0 };
  private warned = false;

  constructor(host: HTMLElement, options: WelcomeOptions = {}) {
    this.host = host;
    this.coats = options.bunnies?.length ? [...options.bunnies] : [...WELCOME_DEFAULT_BUNNIES];
    this.choreo = options.choreography ?? 'welcome';
    this.loop = options.loop ?? false;
    this.onEnd = options.onEnd;
    this.inset = resolveInset(options.edgeInset);
    this.radius = resolveInset(options.edgeRadius);
    this.minSize = options.minSize ?? 96;
    this.maxSize = options.maxSize ?? 300;
    this.calmEyes = options.calmEyes;
    this.item = options.item;

    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${STAGE_CSS}</style><div class="stage" aria-hidden="true"></div>`;
    const stage = this.root.querySelector<HTMLDivElement>('.stage');
    if (!stage) throw new Error('[welcome] stage failed to mount');
    this.stageEl = stage;
    if ((options.headroom ?? 0) > 0) {
      host.style.overflow = 'visible';
      host.style.contain = 'layout';
      stage.style.overflow = 'visible';
      stage.style.clipPath = `inset(-${options.headroom}px 0 0)`;
    }

    this.reduced = new ReducedMotion(options.reducedMotion ?? 'auto');
    this.reduced.subscribe(() => this.rebuild());
    this.watch = new IdleScheduler(
      () => true,
      (active) => this.onActive(active),
    );
    this.watch.observe(host);
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.onResize());
      this.ro.observe(host);
    }
    this.build();
    if (options.autoplay === 'idle') this.playWhenIdle();
    else if (options.autoplay) this.play();
  }

  // ---------- state ----------

  /** Seconds until the choreography is over (onEnd). The staying bunny keeps breathing after that. */
  get duration(): number {
    return this.built?.duration ?? 0;
  }

  /** Current stage time in seconds. */
  get time(): number {
    const b = this.built;
    if (this.mode === 'playing' && !this.parked && b?.endClock) {
      const ct = b.endClock.currentTime;
      if (typeof ct === 'number') return ct / 1000;
    }
    return this.held;
  }

  get playing(): boolean {
    return this.mode === 'playing';
  }

  get suspended(): boolean {
    return this.parked;
  }

  /** The choreography reached its end in this run (onEnd has fired). */
  get ended(): boolean {
    return this.endFired;
  }

  get reducedMotion(): boolean {
    return this.reduced.matches;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** How many bunnies the stage built (≤ 4; 1 under reduced motion). */
  get actorCount(): number {
    return this.built?.actors.length ?? 0;
  }

  /** The Web Animations of the stage (read-only; for frame-capture tools and tests). */
  get animations(): readonly Animation[] {
    return this.built?.playhead.animations ?? [];
  }

  // ---------- controls ----------

  /** Plays from the current time; from the start when stopped or already over. */
  play(): void {
    this.cancelIdle();
    const b = this.built;
    if (this.destroyed || !b || this.mode === 'playing') return;
    if (b.isStatic) {
      this.mode = 'playing';
      this.showStatic(true);
      this.clearFade();
      if (!this.endFired) this.fadeTimer = setTimeout(() => this.fireEnd(), FADE_MS);
      return;
    }
    let from = this.mode === 'idle' ? 0 : this.held;
    if (from >= b.duration && !this.loop) from = 0;
    if (from === 0) this.endFired = false;
    this.start(from);
  }

  /**
   * play() once the page is idle (requestIdleCallback; at the latest after `timeout` ms). Use it on
   * app start: most of the motion is SVG transforms on the main thread, and start-up work (hydration,
   * auth) would make the ears and paws stutter against the smooth, composited head.
   */
  playWhenIdle(timeout = IDLE_TIMEOUT): void {
    if (this.destroyed || this.idleCancel || this.mode === 'playing') return;
    const go = () => {
      this.idleCancel = null;
      this.play();
    };
    const g = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof g.requestIdleCallback === 'function') {
      const id = g.requestIdleCallback(go, { timeout });
      this.idleCancel = () => g.cancelIdleCallback?.(id);
    } else {
      const id = setTimeout(go, Math.min(timeout, 200));
      this.idleCancel = () => clearTimeout(id);
    }
  }

  /** Runs from `from` seconds; waits (parked) while the page is hidden or the stage is off-screen. */
  private start(from: number): void {
    this.mode = 'playing';
    this.parked = false;
    this.held = from;
    this.watch.start();
    if (this.watch.active) this.run(from);
    else this.parked = true;
  }

  /** Freezes the current frame. */
  pause(): void {
    this.cancelIdle();
    if (this.destroyed || this.mode !== 'playing') return;
    this.held = this.time;
    this.gen += 1;
    this.mode = 'paused';
    this.parked = false;
    this.watch.stop();
    this.built?.playhead.pause();
  }

  /**
   * The calm end pose (after onEnd) that pause() froze breathes on from where it stopped — play() would restart
   * the whole show. Does nothing before the end, when not paused, or for the static composition.
   */
  resumeCalm(): void {
    const b = this.built;
    if (this.destroyed || !b || b.isStatic || this.mode !== 'paused' || !this.endFired) return;
    this.start(this.held);
  }

  /** Stops and rewinds: the stage is empty again (no onEnd). */
  stop(): void {
    if (this.destroyed) return;
    this.cancelIdle();
    this.gen += 1;
    this.mode = 'idle';
    this.parked = false;
    this.held = 0;
    this.endFired = false;
    this.clearFade();
    this.watch.stop();
    const b = this.built;
    if (!b) return;
    if (b.isStatic) this.hideStatic();
    else {
      b.playhead.seek(0);
      this.castAt(0, false);
    }
  }

  /** Freezes the stage at `seconds` (deterministic: every animation gets the same currentTime). */
  seek(seconds: number): void {
    if (this.destroyed) return;
    this.cancelIdle();
    const b = this.built;
    if (!b) return;
    const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.gen += 1;
    this.mode = 'paused';
    this.parked = false;
    this.held = t;
    this.watch.stop();
    if (b.isStatic) {
      this.clearFade();
      this.showStatic(false);
      return;
    }
    b.playhead.seek(t * 1000);
    this.castAt(t, false);
  }

  /** Switch the reduced-motion policy at runtime. */
  setReducedMotion(mode: ReducedMotionMode): void {
    this.reduced.setMode(mode);
  }

  /** Styles of every animated part at `seconds` (default: now), computed from the same keys as the animations. */
  sample(seconds?: number): Record<string, WelcomePartStyle> {
    const b = this.built;
    const out: Record<string, WelcomePartStyle> = {};
    if (!b) return out;
    const t = b.isStatic ? b.duration : (seconds ?? this.time);
    for (const s of b.sampled) {
      const v = s.styleAt(t);
      if (v && (v.transform !== undefined || v.opacity !== undefined || v.d !== undefined)) out[s.name] = { ...v };
    }
    return out;
  }

  /** Removes everything: animations, observers, timers, the shadow content. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen += 1;
    this.cancelIdle();
    this.clearFade();
    this.watch.destroy();
    this.reduced.destroy();
    this.ro?.disconnect();
    this.ro = null;
    this.teardown();
    this.root.innerHTML = '';
  }

  // ---------- internals ----------

  private cancelIdle(): void {
    this.idleCancel?.();
    this.idleCancel = null;
  }

  /** Actors that have to be on stage at `t`: animations made (at t), shown or hidden as at t. */
  private castAt(t: number, play: boolean): void {
    const b = this.built;
    if (!b) return;
    for (const m of b.cast) {
      if (t >= m.on) this.activate(m, t * 1000, play);
      this.show(m, t >= m.on && t < m.off);
    }
  }

  private activate(m: Member, ms: number, play: boolean): void {
    const b = this.built;
    if (!b || m.active) return;
    m.active = true;
    for (const c of m.compiled) b.playhead.addAt(c, m.actor.name, ms, play);
  }

  private show(m: Member, on: boolean): void {
    if (m.shown === on) return;
    m.shown = on;
    for (const el of m.actor.frames) el.style.display = on ? '' : 'none';
  }

  /** After the last move of `m`: settle its animations (not in loop mode) and hide it. */
  private watchExit(m: Member, gen: number, ms: number): void {
    const b = this.built;
    if (!b || !Number.isFinite(m.off)) return;
    const last = b.playhead.lastOf(m.actor.name);
    if (!last || last.end <= ms) return;
    last.a.finished.then(
      () => {
        if (gen !== this.gen || this.mode !== 'playing') return;
        if (!this.loop) this.built?.playhead.settle(last.end, m.actor.name);
        this.show(m, false);
      },
      () => undefined,
    );
  }

  private run(from: number): void {
    const b = this.built;
    if (!b) return;
    const ms = from * 1000;
    b.playhead.playFrom(ms);
    this.castAt(from, true);
    // an actor whose part is over gives its animations back (final values stay inline)
    if (!this.loop) b.playhead.settle(ms);
    const gen = ++this.gen;
    for (const m of b.cast) {
      if (from >= m.on || !m.prep) {
        this.watchExit(m, gen, ms);
        continue;
      }
      // its part is still ahead (also again after a loop restart): bring it in on time
      m.prep.finished.then(
        () => {
          if (gen !== this.gen || this.mode !== 'playing') return;
          const now = this.time * 1000;
          this.activate(m, now, true);
          this.show(m, true);
          this.watchExit(m, gen, now);
        },
        () => undefined,
      );
    }
    if (b.endClock && !this.endFired && from < b.duration) {
      b.endClock.finished.then(
        () => {
          if (gen !== this.gen || this.mode !== 'playing') return;
          if (!this.loop) this.built?.playhead.settle(b.duration * 1000);
          this.fireEnd();
        },
        () => undefined,
      );
    }
    if (b.loopClock) {
      b.loopClock.finished.then(
        () => {
          if (gen === this.gen && this.mode === 'playing' && !this.parked) this.run(0);
        },
        () => undefined,
      );
    }
  }

  private fireEnd(): void {
    if (this.endFired || this.destroyed) return;
    this.endFired = true;
    this.onEnd?.();
    this.host.dispatchEvent(new CustomEvent('welcome-end', { bubbles: true, composed: true }));
  }

  private onActive(active: boolean): void {
    if (this.destroyed || this.mode !== 'playing') return;
    const b = this.built;
    if (!b || b.isStatic) return;
    if (!active && !this.parked) {
      this.held = this.time;
      this.gen += 1;
      this.parked = true;
      b.playhead.pause();
    } else if (active && this.parked) {
      this.parked = false;
      this.run(this.held);
    }
  }

  private onResize(): void {
    if (this.destroyed) return;
    const { W, H } = this.measure();
    if (Math.abs(W - this.size.W) < 1 && Math.abs(H - this.size.H) < 1) return;
    this.rebuild();
  }

  /** Rebuild for a new size or reduced-motion state, keeping the time and the play state. */
  private rebuild(): void {
    if (this.destroyed) return;
    const t = this.time;
    const wasStatic = this.built?.isStatic ?? false;
    const mode = this.mode;
    this.gen += 1;
    this.clearFade();
    this.teardown();
    this.build();
    const b = this.built;
    if (!b) return;
    if (b.isStatic) {
      if (mode !== 'idle') {
        this.showStatic(false);
        this.mode = 'paused';
        this.watch.stop();
        this.fireEnd();
      }
      return;
    }
    if (wasStatic && mode !== 'idle') {
      // motion allowed again: continue at the calm end pose (the staying bunny breathes)
      this.endFired = true;
      this.start(b.duration);
      return;
    }
    b.playhead.seek(t * 1000);
    this.held = t;
    if (mode === 'playing') this.start(t);
    // paused (seek, pause) or idle: the bunnies that are on stage at t join right away, frozen at t
    else this.castAt(t, false);
  }

  private measure(): { W: number; H: number } {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    return W > 0 && H > 0 ? { W, H } : { W: 360, H: 560 };
  }

  private clearFade(): void {
    if (this.fadeTimer !== null) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
  }

  private showStatic(fade: boolean): void {
    this.stageEl.classList.remove('rm-hidden', 'rm-in');
    if (fade) this.stageEl.classList.add('rm-in');
  }

  private hideStatic(): void {
    this.stageEl.classList.remove('rm-in');
    this.stageEl.classList.add('rm-hidden');
  }

  private teardown(): void {
    const b = this.built;
    if (!b) return;
    b.playhead.cancel();
    for (const a of b.actors) a.remove();
    this.stageEl.textContent = '';
    this.built = null;
  }

  private steps(isStatic: boolean): WelcomeStep[] {
    if (isStatic) return welcomeSteps('peek-once', 1);
    const raw = typeof this.choreo === 'string' ? welcomeSteps(this.choreo, this.coats.length) : [...this.choreo];
    return raw.filter(validStep).sort((a, b) => a.at - b.at);
  }

  /** The edge clip: the host minus the inset strips; with `edgeRadius` it follows the card's rounded corners. */
  private makeClip(geo: StageGeo): { clip: HTMLDivElement; origin: Vec } {
    const { top, right, bottom, left } = geo.inset;
    const rT = top > 0 ? Math.min(this.radius.top, geo.W / 2) : 0;
    const rB = bottom > 0 ? Math.min(this.radius.bottom, geo.W / 2) : 0;
    const boxTop = rT > 0 ? 0 : top;
    const boxBottom = rB > 0 ? 0 : bottom;
    const clip = document.createElement('div');
    clip.className = 'clip';
    clip.style.inset = `${boxTop}px ${right}px ${boxBottom}px ${left}px`;
    if (rT > 0 || rB > 0) clip.style.setProperty('clip-path', `path('${cardOutline(geo, boxTop, rT, rB)}')`);
    return { clip, origin: { x: left, y: boxTop } };
  }

  /** Every part of the show, placed (in time order; bunnies past the 4th are skipped with a warning). */
  private parts(geo: StageGeo, isStatic: boolean): Part[] {
    const parts: Part[] = [];
    const units = new Map<string, number>();
    for (const step of this.steps(isStatic)) {
      const key = `${step.actor}:${step.type}`;
      if (!units.has(key) && units.size >= MAX_ACTORS) {
        this.warnOnce();
        continue;
      }
      const coat = this.coats[step.actor % this.coats.length] ?? 'fawn';
      if (step.type === 'peek') {
        const u = units.get(key) ?? geo.u0 * Math.max(0.2, step.scale ?? (step.actor === 0 ? 1 : 0.8));
        units.set(key, u);
        const floor = step.floor ?? false;
        const place = placePeek(
          {
            edge: step.edge,
            pos: step.pos ?? 0.5,
            tilt: step.tilt ?? (floor ? FLOOR_TILT : DEFAULT_TILT)[step.edge],
            floor,
            reveal: step.reveal ?? 0,
            turn: step.turn ?? true,
          },
          u,
          geo,
        );
        parts.push({ kind: 'peek', step, key, coat, u, place });
      } else {
        const u = units.get(key) ?? geo.u0 * Math.max(0.2, step.scale ?? 0.62);
        units.set(key, u);
        const run = runPlanOf(step, u, geo);
        parts.push({ kind: 'run', step, key, coat, u, run, sched: runSchedule(run, u) });
      }
    }
    return parts;
  }

  private build(): void {
    const size = this.measure();
    this.size = size;
    const geo: StageGeo = {
      W: size.W,
      H: size.H,
      u0: stageUnit(size.W, size.H, this.minSize, this.maxSize),
      inset: this.inset,
      // the corner radius only counts where there is a card (an inset), like in makeClip
      radius: { bottom: this.inset.bottom > 0 ? Math.min(this.radius.bottom, size.W / 2) : 0, top: this.inset.top > 0 ? Math.min(this.radius.top, size.W / 2) : 0 },
    };
    const probe = this.stageEl as HTMLElement & { animate?: unknown };
    const isStatic = this.reduced.matches || typeof probe.animate !== 'function';

    this.stageEl.classList.toggle('rm', isStatic);
    this.stageEl.classList.remove('rm-in');
    this.stageEl.classList.toggle('rm-hidden', isStatic);
    const { clip, origin: clipOrigin } = this.makeClip(geo);
    const pawLayer = document.createElement('div');
    pawLayer.className = 'layer paws';
    const runLayer = document.createElement('div');
    runLayer.className = 'layer runners';
    // paws over the edge, runners over everything: a runner never hops "behind" a paw resting on the edge
    this.stageEl.append(clip, pawLayer, runLayer);

    // pass 1: who is where, when — for 'at:N' glances (a bunny may look at one that comes later)
    const parts = this.parts(geo, isStatic);
    const where = (n: number, t: number): Vec | null => {
      let best: Part | null = null;
      for (const p of parts) {
        // its latest part that has begun (or begins within a second: it is about to come up)
        if (p.step.actor !== n || p.step.at > t + 1) continue;
        if (!best || p.step.at >= best.step.at) best = p;
      }
      if (!best) return null;
      return best.kind === 'peek' ? best.place.headHost : runnerAt(best.run, best.sched, best.u, t);
    };

    // pass 2: author every part, in time order
    const actors = new Map<string, Actor>();
    const order: Actor[] = [];
    let end = 0;
    const stays: Array<{ actor: Peeker; at: number; place: PeekPlace }> = [];
    for (const p of parts) {
      let actor = actors.get(p.key);
      if (p.kind === 'peek') {
        if (!actor) {
          actor = new Peeker(`p${p.step.actor}`, p.coat, p.u, clip, clipOrigin, pawLayer, p.place);
          if (p.step.item === 'calendar' || (p.step.actor === 0 && this.item === 'calendar')) actor.holdCalendar();
          actors.set(p.key, actor);
          order.push(actor);
        }
        if (!(actor instanceof Peeker)) continue;
        const s = p.step;
        const self = s.actor;
        const done = actor.peek({
          at: s.at,
          place: p.place,
          hold: Math.max(0, s.hold ?? 1.4),
          look: lookSteps(s.look),
          sniff: s.sniff ?? false,
          surprise: s.surprise ?? false,
          earsOnly: s.earsOnly ?? false,
          seated: s.seated ?? false,
          nod: s.nod,
          greet: s.greet ?? false,
          shrug: s.shrug ?? false,
          doze: s.doze ?? false,
          stay: s.stay ?? false,
          face: s.face,
          lookFrom: s.lookFrom ?? 1.4,
          target: (n, t) => (n === self ? null : where(n, t)),
        });
        end = Math.max(end, done);
        if (s.stay) stays.push({ actor, at: done, place: p.place });
      } else {
        if (!actor) {
          actor = new Runner(`r${p.step.actor}`, p.coat, p.u, runLayer, p.run);
          actors.set(p.key, actor);
          order.push(actor);
        }
        if (!(actor instanceof Runner)) continue;
        end = Math.max(end, actor.run(p.run));
      }
    }

    const duration = Math.round((end + 0.1) * 1000) / 1000;
    if (isStatic && this.calmEyes) {
      for (const actor of order) if (actor instanceof Peeker) actor.calmEyes(duration, this.calmEyes);
    }
    let period = duration;
    if (!isStatic) {
      if (this.loop) {
        let last = duration;
        for (const s of stays) last = Math.max(last, s.actor.farewell(s.at, duration + LOOP_HOLD - 1.2, s.place));
        period = last + 0.4;
      } else {
        for (const s of stays) s.actor.idle(s.at);
      }
    }

    const sampled: Sampled[] = [];
    for (const a of order) sampled.push(...a.tracks, ...a.loops);
    const playhead = new Playhead();
    let endClock: Animation | null = null;
    let loopClock: Animation | null = null;
    const cast: Member[] = [];
    if (isStatic) {
      for (const s of sampled) {
        const v = s.styleAt(duration);
        for (const el of s.els) applyStyle(el, v);
      }
      for (const actor of order) cast.push({ actor, on: 0, off: Infinity, compiled: [], active: true, shown: true, prep: null });
    } else {
      for (const s of sampled) {
        const v = s.baseStyle();
        for (const el of s.els) applyStyle(el, v);
      }
      for (const actor of order) {
        const compiled = [...actor.tracks, ...actor.loops].flatMap((s) => s.compile());
        const on = Math.max(0, actor.firstKey - PREP);
        const last = actor.lastKey;
        const m: Member = { actor, on, off: Number.isFinite(last) ? last + 0.05 : Infinity, compiled, active: false, shown: true, prep: null };
        cast.push(m);
        if (on <= 0) {
          m.active = true;
          for (const c of compiled) playhead.add(c, actor.name);
        } else {
          for (const el of actor.frames) el.style.display = 'none';
          m.shown = false;
          m.prep = this.clock(playhead, on);
        }
      }
      endClock = this.clock(playhead, duration);
      if (this.loop) loopClock = this.clock(playhead, period);
    }
    this.built = { geo, actors: order, sampled, playhead, duration, period, endClock, loopClock, isStatic, cast };
  }

  /** An empty-keyframe animation on the same timeline: a clock (no rAF, no timers) that finishes at `seconds`. */
  private clock(playhead: Playhead, seconds: number): Animation | null {
    const el = this.stageEl as HTMLElement & { animate?: HTMLElement['animate'] };
    if (typeof el.animate !== 'function') return null;
    return playhead.adopt(el.animate([], { duration: seconds * 1000 }), seconds * 1000);
  }

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[welcome] at most ${MAX_ACTORS} bunnies per stage; extra steps are skipped`);
  }
}
