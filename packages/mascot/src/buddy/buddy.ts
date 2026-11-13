/**
 * Lists buddy (Felix 25.10, approved for the app the same day): Tapsi the hamster (or Pompon) lives on the
 * "Listen" screen. Public API: src/buddy/index.ts (createBuddy); the app mounts it in apps/web/src/features/lists.
 * He walks on the top edges of the stats row and the wishlist cards, looks at your avatar with heart eyes,
 * inspects your lists, stuffs a gift into his cheeks, naps when nobody plays with him. Hold him (long-press
 * on a phone, just drag with a mouse) and he dangles from your finger like Google Maps' pegman; throw him and
 * he tumbles, rolls, gets up dizzy, glares at you, huffs and shakes the dust off.
 *
 * Layers (light DOM, inside the scrolling content box `stage`, which must be position: relative):
 *   .bd-layer (pointer-events: none) › .bd-actor (moved by rAF) › .bd-pose (gestures: squash, tilt, shake)
 *     › .bd-host (the puppet, shadow DOM) + .bd-hit (only his body catches the finger)
 *   .bd-fx — hearts, stars, dust, "!" and "z" — and .bd-ground (his shadow on the floor while airborne).
 *   .bd-actor carries [data-drag-own]: a touch that starts on him is his, never a page gesture of the host.
 *
 * Rules kept: transform/opacity only; requestAnimationFrame only while he moves (walk, hop, held, flight,
 * roll); timers for everything else; nothing runs while the tab is hidden or he is off screen; reduced motion
 * = he stays put (rests, sits), can still be picked up and is set down gently; decorative (aria-hidden).
 */

// the puppets by file, not the package index: the index registers <bunprise-mascot> and is the app's lazy
// mascot chunk — a static import of it from this separate entry made the bundler split its runtime helpers into
// a shared chunk of the first screen
import { Bunny } from '../bunny';
import { Hamster } from '../hamster';
import type { ReducedMotionMode } from '../types';
import { angerMs, decide, grumpiness, mulberry32, shouldSulk, type ActionKind, type BuddyKind, type Decision } from './brain';
import * as F from './footing';
import * as P from './physics';
import { BuddyRig, geometry, type Geometry, type Point } from './rig';

export type BuddyHaptic = 'select' | 'tap' | 'warning' | 'success';

export interface BuddyOptions {
  /** The scrolling CONTENT box (position: relative). Floors: [data-buddy-floor] (+ data-buddy-card), avatar: [data-buddy-avatar],
   *  ceilings: [data-buddy-ceiling] (he never stands right under one — it would cover him). */
  stage: HTMLElement;
  /** What scrolls: an element, or `window` when the document scrolls (the app). Default: stage.parentElement. */
  scroller?: HTMLElement | Window | null;
  kind?: BuddyKind;
  /** Width of the puppet's box in px (96 = the hamster in the Lists header today). */
  width?: number;
  reducedMotion?: ReducedMotionMode;
  /** Cheeks at rest (1 = normal; the hamster default 1.15). */
  restPuff?: number;
  /** Seed of his random life (screenshots, tests). */
  seed?: number;
  /** The app's haptics wrapper (the buddy never vibrates by itself). */
  haptics?: (kind: BuddyHaptic) => void;
  /** px above the content's bottom where the ground is (a tab bar covers the bottom). */
  groundInset?: number;
  /** His own life on (default true). Off = he only reacts (screenshots of single behaviours). */
  autonomous?: boolean;
  /** Debug line for the gallery. */
  onState?: (info: BuddyInfo) => void;
  /**
   * «Твёрдая почва» (Felix 26.10 «нравится», in the app 27.10; footing.ts): set down softly near a card's rounded
   * end, he touches the card with the foot on the edge side ("oh!"), shifts his weight away from it and takes one
   * small step inward — 1.2 s, at most once per 20 s; in the middle of a card nothing new happens; reduced motion:
   * he is set straight down on the safe spot, eyes ^ ^. The card's top corner radii are read from the page
   * ([data-buddy-floor] or its first / last child). Bunny only. Default false (exactly the behaviour before).
   */
  footing?: boolean;
  /** Debug line for the gallery and tests: what the footing moment decided (play, middle, pause, done, ...). */
  onFooting?: (event: FootingEvent) => void;
  /**
   * Where his feet start: on the floor [data-buddy-floor="<floor>"] at x (stage px). Default (or an unknown floor):
   * 62 % along the stats row — exactly as before. The app: he woke up where he slept at night (src/night/), so the
   * buddy takes over on that very spot.
   */
  start?: { floor: string; x: number };
  /**
   * (the app, 31.10 «Живые анимации», @bunprise/mascot/alive) a living moment of the host as one of his deeds: when
   * `due()` says so the brain picks it next, and he lends his puppet to `play` while he stands facing you. A touch,
   * a throw, his next flow end it at once (`stop()`). Without it: exactly the behaviour before.
   */
  alive?: BuddyAlive;
}

/** BuddyOptions.alive — the host's living moments. */
export interface BuddyAlive {
  /** a moment is due now (the host's mix) */
  due(): boolean;
  /** plays it on his puppet; null = not now (the host's stage, its budget, nothing fits) */
  play(puppet: Bunny | Hamster, ctx: { quietMs: number }): { done: Promise<void>; stop(): void } | null;
}

/** What the footing moment decided (BuddyOptions.onFooting). */
export interface FootingEvent {
  kind: 'play' | 'reduced' | 'middle' | 'pause' | 'done' | 'stopped';
  floor: string;
  side?: -1 | 1;
  /** px he steps in */
  step?: number;
  /** seconds left of the 20 s pause */
  wait?: number;
}

/** The puppet's parts the footing moment drives (transform only). */
interface FootingParts {
  body: SVGGElement;
  outer: SVGGElement;
  inner: SVGGElement;
  shadow: SVGElement;
  face: SVGGElement;
}

interface FootingRun {
  plan: F.Plan;
  parts: FootingParts;
  /** what is shown now (an interruption continues from exactly this) */
  pose: F.Pose;
  raf: number;
  /** a still frame (the gallery's frame strip): stopping it is not an interruption */
  frozen: boolean;
  resolve: () => void;
}

const f3 = (v: number) => (Math.abs(v) < 5e-4 ? '0' : v.toFixed(3));

/**
 * Corner radius of a floor element's top corner (px). An element without one (the app's <li> › .lc-slot › .lc-card)
 * asks the card inside it: the first element, at most three levels down, that is as wide as the floor (≥ 80 %) and
 * has a radius on that corner.
 */
function cornerRadius(el: Element, side: -1 | 1): number {
  const read = (e: Element) => parseFloat(getComputedStyle(e)[side < 0 ? 'borderTopLeftRadius' : 'borderTopRightRadius']) || 0;
  const width = el.getBoundingClientRect().width;
  let level: Element[] = [el];
  for (let depth = 0; depth <= 3 && level.length; depth++) {
    for (const e of level) {
      const r = read(e);
      const w = e.getBoundingClientRect().width;
      // (no layout — jsdom, a hidden tab: any radius counts)
      if (r > 0 && (e === el || !width || !w || w >= 0.8 * width)) return r;
    }
    level = level.flatMap((e) => [...e.children]);
  }
  return 0;
}

export interface BuddyInfo {
  action: string;
  mode: Mode;
  floor: string;
  grumpy: number;
}

type Mode = 'stand' | 'walk' | 'hop' | 'held' | 'fly' | 'roll' | 'getup';

class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

const raf: (cb: FrameRequestCallback) => number =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const cancelRaf: (id: number) => void = typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

const CSS = `
.bd-layer { position: absolute; inset: 0; pointer-events: none; z-index: 5; overflow: visible; }
.bd-actor { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.bd-pose { position: relative; width: 100%; height: 100%; }
.bd-host { position: absolute; left: 0; top: 0; pointer-events: none; }
.bd-hit { position: absolute; pointer-events: auto; touch-action: pan-y; cursor: grab; border-radius: 45% 45% 30% 30%;
  -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.bd-held-cursor .bd-hit, .bd-held-cursor { cursor: grabbing; }
.bd-fx { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.bd-fx > * { position: absolute; left: 0; top: 0; will-change: transform, opacity; }
.bd-ground { position: absolute; left: 0; top: 0; width: 40px; height: 8px; margin: -4px 0 0 -20px; border-radius: 50%;
  background: var(--mascot-shadow, rgba(70, 40, 15, .16)); opacity: 0; pointer-events: none; }
.bd-bang { font: 800 18px/1 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--buddy-bang, #E06A2C);
  text-shadow: 0 1px 0 var(--buddy-halo, #fff), 0 0 6px var(--buddy-halo, #fff); }
.bd-z { font: 800 13px/1 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--buddy-z, #C9845D); }
.bd-hmpf { width: 13px; height: 13px; border-radius: 50%; background: var(--buddy-puff, #FFFFFF);
  box-shadow: 0 0 0 1.3px var(--buddy-puff-rim, rgba(140, 105, 80, .45)), 0 2px 5px rgba(80, 50, 20, .18); }
.bd-dust { width: 6px; height: 6px; border-radius: 50%; background: var(--buddy-dust, rgba(170, 135, 100, .55)); }
`;

const STAR = '<svg width="14" height="14" viewBox="-7 -7 14 14"><path d="M0 -6.5 L1.6 -1.6 L6.5 0 L1.6 1.6 L0 6.5 L-1.6 1.6 L-6.5 0 L-1.6 -1.6 Z" fill="#FFC94D"/></svg>';
const HEART = '<svg width="14" height="13" viewBox="-7 -6.5 14 13"><path d="M0 5.5 C-7.5 0.5 -6 -6.5 0 -2.6 C6 -6.5 7.5 0.5 0 5.5 Z" fill="#F2546B"/></svg>';
const SPARK = '<svg width="18" height="18" viewBox="-9 -9 18 18"><path d="M0 -8 L1.8 -1.8 L8 0 L1.8 1.8 L0 8 L-1.8 1.8 L-8 0 L-1.8 -1.8 Z" fill="#FFD45E"/><circle r="1.6" fill="#fff"/></svg>';

const WALK_SPEED: Record<BuddyKind, number> = { hamster: 46, bunny: 58 };
const PENDULUM_GRAVITY = 1500;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

let cssInjected = false;

const isWindow = (v: HTMLElement | Window): v is Window => typeof window !== 'undefined' && v === window;

/** The id of the screen's bottom edge as a floor (just above the tab bar): only while he flies and after he landed
 *  there — never one of the page's floors (Felix 26.10: on a long page with nothing under him he fell "endlessly"). */
const SCREEN = 'screen';

/** Where an element rests in the flow: a sticky one reports where it floats right now, so it is read as static for a
 *  moment (set, read, reset in one task — never painted). */
function restRect(el: HTMLElement): DOMRect {
  if (getComputedStyle(el).position !== 'sticky') return el.getBoundingClientRect();
  const before = el.style.position;
  el.style.position = 'static';
  const r = el.getBoundingClientRect();
  el.style.position = before;
  return r;
}

export class ListsBuddy {
  readonly kind: BuddyKind;
  private readonly stage: HTMLElement;
  private readonly scroller: HTMLElement | Window | null;
  private readonly layer: HTMLDivElement;
  private readonly actor: HTMLDivElement;
  private readonly pose: HTMLDivElement;
  private readonly hostEl: HTMLDivElement;
  private readonly hit: HTMLDivElement;
  private readonly fx: HTMLDivElement;
  private readonly ground: HTMLDivElement;
  private readonly rig: BuddyRig;
  private readonly g: Geometry;
  private readonly rng: () => number;
  private readonly opts: BuddyOptions;
  private reducedMode: ReducedMotionMode;
  private readonly mql: MediaQueryList | null;

  private world: P.World = { width: 0, top: 0, bottom: 0, floors: [], gravity: P.GRAVITY };
  private floor: P.Floor = { id: 'ground', y: 0, x0: 0, x1: 0 };
  private avatar: DOMRect | null = null;
  private cards: P.Floor[] = [];

  private mode: Mode = 'stand';
  private feet: Point = { x: 0, y: 0 };
  private facing: -1 | 1 = 1;
  private body: P.Body = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0, r: 20 };
  private rollState: P.Roll = { x: 0, v: 0, angle: 0 };
  private pend: P.Pendulum = P.pendulumAt({ x: 0, y: 0 }, 20);
  private pivot: Point = { x: 0, y: 0 };
  private pointer: Point = { x: 0, y: 0 };
  private swingPrev = 0;
  private samples: P.PointerSample[] = [];

  private walkTarget = 0;
  private hopFrom: Point = { x: 0, y: 0 };
  private hopEnd: Point = { x: 0, y: 0 };
  private hopV = { vx: 0, vy: 0, t: 0.5 };
  private hopS = 0;
  private hopFloor: P.Floor | null = null;
  private getupFrom = { angle: 0, cy: 0 };
  private getupS = 0;

  private motion: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private rafId = 0;
  private lastT = 0;
  private gen = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private gazeTimer: ReturnType<typeof setInterval> | null = null;
  private action: string = 'idle';
  private lastDone: Partial<Record<ActionKind, number>> = {};
  private last: ActionKind | null = null;
  private lastCard: number | null = null;
  private throwTimes: number[] = [];
  private lastInteraction = Date.now();
  private lastPointerAt = 0;
  private lastScroll = { y: 0, t: 0, wobbleAt: 0 };
  private visible = true;
  private onScreen = true;
  /** Paused by the host (a sheet is open, another mascot has the stage): his own life stops like off screen. */
  private paused = false;
  /** Cheeks at rest (the app: fuller with more wishes — wishCheeks()). */
  private restPuff = 1;
  /** «Твёрдая почва»: when it last played (Date.now(); the 20 s pause counts from here) and the run in progress. */
  private lastFooting = -Infinity;
  private footingRun: FootingRun | null = null;
  /** his feet were told to come back from dangling quickly (readyFeet) */
  private fastFeet = false;
  private destroyed = false;
  /** (the app) his puppet is lent to a moment of the host (lend()): his own life waits */
  private lent = false;
  /** (the app) the host's living moment on his puppet right now (BuddyOptions.alive) */
  private aliveRun: { done: Promise<void>; stop(): void } | null = null;
  private press: { id: number; x: number; y: number; t: number; touch: boolean; timer: ReturnType<typeof setTimeout> | null; grabbed: boolean } | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private puffTimer: ReturnType<typeof setTimeout> | null = null;
  /** the check after a scroll while he stands on the screen's bottom (screenCheck) */
  private screenTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly io: IntersectionObserver | null;
  private readonly ro: ResizeObserver | null;

  constructor(options: BuddyOptions) {
    this.opts = options;
    this.kind = options.kind ?? 'hamster';
    this.stage = options.stage;
    this.scroller = options.scroller === undefined ? options.stage.parentElement : options.scroller;
    this.reducedMode = options.reducedMotion ?? 'auto';
    this.mql = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.rng = mulberry32(options.seed ?? 20261025);
    this.g = geometry(this.kind, options.width ?? 96);

    if (!cssInjected) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.append(style);
      cssInjected = true;
    }
    this.layer = this.div('bd-layer');
    this.layer.setAttribute('aria-hidden', 'true');
    this.ground = this.div('bd-ground');
    this.fx = this.div('bd-fx');
    this.actor = this.div('bd-actor');
    // a touch on him (his body .bd-hit, or the puppet's shadow host it is retargeted to) is his own drag: the host's
    // page gestures (the app's swipe between tabs) leave it alone — no margin around him, he moves (Felix 27.10)
    this.actor.setAttribute('data-drag-own', '');
    this.pose = this.div('bd-pose');
    this.hostEl = this.div('bd-host');
    this.hit = this.div('bd-hit');
    this.actor.style.width = `${this.g.w}px`;
    this.actor.style.height = `${this.g.h}px`;
    Object.assign(this.hit.style, { left: `${this.g.hit.x}px`, top: `${this.g.hit.y}px`, width: `${this.g.hit.w}px`, height: `${this.g.hit.h}px` });
    this.pose.append(this.hostEl, this.hit);
    this.actor.append(this.pose);
    this.layer.append(this.ground, this.actor, this.fx);
    this.stage.append(this.layer);

    const puppetOptions = { size: this.g.w, idle: true, interactive: false, reducedMotion: this.reducedMode, calmEyes: 'happy' as const };
    const puppet = this.kind === 'hamster' ? new Hamster(this.hostEl, puppetOptions) : new Bunny(this.hostEl, puppetOptions);
    this.rig = new BuddyRig(puppet, this.kind);
    this.restPuff = options.restPuff ?? (this.kind === 'hamster' ? 1.15 : 1);
    puppet.setPuff(this.restPuff);

    this.hit.addEventListener('pointerdown', this.onDown);
    this.hit.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.hit.addEventListener('contextmenu', (e) => e.preventDefault());
    this.stage.addEventListener('pointermove', this.onStageMove);
    this.scroller?.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.mql?.addEventListener?.('change', this.onReducedChange);

    this.io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last) this.setOnScreen(last.isIntersecting);
      })
      : null;
    this.io?.observe(this.hit);
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.remeasure()) : null;
    this.ro?.observe(this.stage);

    this.measure();
    const home = this.home();
    const start = options.start ? this.world.floors.find((f) => f.id === options.start?.floor) : undefined;
    this.floor = start ?? home;
    this.feet = { x: P.clampToFloor(this.floor, start && options.start ? options.start.x : home.x0 + (home.x1 - home.x0) * 0.62, this.margin()), y: this.floor.y };
    this.render();
    this.startLife();
  }

  // ---------- public (gallery buttons, tests) ----------

  get info(): BuddyInfo {
    return { action: this.action, mode: this.mode, floor: this.floor.id, grumpy: Number(grumpiness(this.throwTimes, Date.now()).toFixed(2)) };
  }

  /** Where his feet are (content px) and on which floor — tests and screenshots. */
  get position(): { x: number; y: number; floor: string; mode: Mode } {
    return { x: this.feet.x, y: this.feet.y, floor: this.floor.id, mode: this.mode };
  }

  get reduced(): boolean {
    return this.reducedMode === 'force' || (this.reducedMode === 'auto' && (this.mql?.matches ?? false));
  }

  setReducedMotion(mode: ReducedMotionMode): void {
    this.reducedMode = mode;
    this.rig.puppet.setReducedMotion(mode);
    this.onReducedChange();
  }

  /** The host pauses his life (a sheet is open, another mascot needs the stage) — like being off screen. */
  setPaused(paused: boolean): void {
    if (this.destroyed || paused === this.paused) return;
    this.paused = paused;
    this.setVisible(typeof document === 'undefined' || !document.hidden);
  }

  /** Hidden = not drawn and paused (another Tapsi is on screen); shown again where he stood. */
  setHidden(hidden: boolean): void {
    if (this.destroyed) return;
    this.layer.style.visibility = hidden ? 'hidden' : '';
    this.setPaused(hidden);
    // the puppet's own breathing/blinking stops too while nobody can see him
    if (hidden) this.rig.puppet.stopIdle();
    else this.rig.puppet.startIdle();
  }

  /** Cheeks at rest (the app: fuller with more wishes). */
  setRestPuff(puff: number): void {
    if (this.destroyed) return;
    this.restPuff = puff;
    if (!this.puffTimer) this.rig.puppet.setPuff(puff);
  }

  /**
   * (the app, 31.10 «Помпон в открытом списке»: the ear pull and the shake on every Pompon) Lends his puppet to a short
   * moment of the host (@bunprise/mascot/listplay): only while he stands on a floor, not held, not paused, nothing in
   * his hands. His own life stops where he stands (facing you) and goes on with `giveBack()`. null = not now.
   */
  lend(): { puppet: Bunny | Hamster; giveBack(): void } | null {
    if (this.destroyed || this.lent || this.paused || !this.visible || this.mode !== 'stand' || this.press) return null;
    this.cancel();
    this.resetPose();
    if (this.gazeTimer) clearInterval(this.gazeTimer);
    this.gazeTimer = null;
    this.lent = true;
    let back = false;
    return {
      puppet: this.rig.puppet,
      giveBack: () => {
        if (back) return;
        back = true;
        this.lent = false;
        this.lastInteraction = Date.now();
        if (!this.destroyed) this.startLife();
      },
    };
  }

  /** Plays one behaviour now (gallery buttons; the app: 'wish' when a wish was added). */
  trigger(kind: ActionKind | 'wave' | 'giggle' | 'wish' | 'throw'): void {
    if (this.destroyed || this.mode === 'held' || this.lent) return;
    // a footing moment ends first: a throw reads his position, which is where his body is now
    this.stopFooting();
    if (kind === 'throw') {
      this.throwFrom({ x: this.feet.x, y: this.feet.y - (this.g.foot.y - this.g.center.y) }, { vx: this.facing * 900, vy: -1100 });
      return;
    }
    if (kind === 'wish') {
      void this.flow((gen) => this.happyHop(gen));
      return;
    }
    if (kind === 'wave' || kind === 'giggle') {
      void this.flow((gen) => (kind === 'wave' ? this.wave(gen) : this.giggle(gen)));
      return;
    }
    const d: Decision = kind === 'inspect'
      ? { kind, duration: 4000, card: this.pickCard() }
      : kind === 'wander'
        ? { kind, duration: 0, floor: Math.floor(this.rng() * this.world.floors.length), at: this.rng() }
        : { kind, duration: kind === 'nap' ? 9000 : kind === 'sit' ? 4000 : kind === 'sulk' ? 6000 : 3800 };
    void this.flow((gen) => this.perform(d, gen));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancel();
    clearTimeout(this.screenTimer);
    if (this.gazeTimer) clearInterval(this.gazeTimer);
    this.hit.removeEventListener('pointerdown', this.onDown);
    this.hit.removeEventListener('touchmove', this.onTouchMove);
    this.stage.removeEventListener('pointermove', this.onStageMove);
    this.scroller?.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.mql?.removeEventListener?.('change', this.onReducedChange);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('blur', this.onLostCapture);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.rig.puppet.destroy();
    this.layer.remove();
  }

  // ---------- world ----------

  private div(cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  }

  private margin(): number {
    return this.g.radius * 0.9;
  }

  private measure(): void {
    const st = this.stage.getBoundingClientRect();
    const floors: P.Floor[] = [];
    this.stage.querySelectorAll<HTMLElement>('[data-buddy-floor]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const card = el.dataset.buddyCard;
      floors.push({ id: el.dataset.buddyFloor || `floor-${floors.length}`, y: r.top - st.top, x0: r.left - st.left, x1: r.right - st.left, ...(card !== undefined ? { card: Number(card) } : {}) });
    });
    const ceilings: P.Ceiling[] = [];
    this.stage.querySelectorAll<HTMLElement>('[data-buddy-ceiling]').forEach((el) => {
      const r = restRect(el);
      ceilings.push({ top: r.top - st.top, bottom: r.bottom - st.top, x0: r.left - st.left, x1: r.right - st.left });
    });
    const usable = P.roomyFloors(floors, ceilings, this.g.foot.y - this.g.hit.y);
    const width = this.stage.clientWidth || st.width;
    const height = Math.max(this.stage.scrollHeight, this.stage.clientHeight, st.height);
    const bottom = height - (this.opts.groundInset ?? 0);
    usable.push({ id: 'ground', y: bottom, x0: 0, x1: width });
    this.world = { width, top: 0, bottom, floors: usable.sort((a, b) => a.y - b.y), gravity: P.GRAVITY };
    this.cards = usable.filter((f) => f.card !== undefined).sort((a, b) => (a.card ?? 0) - (b.card ?? 0));
    const av = this.stage.querySelector<HTMLElement>('[data-buddy-avatar]');
    if (av) {
      const r = av.getBoundingClientRect();
      this.avatar = new DOMRect(r.left - st.left, r.top - st.top, r.width, r.height);
    } else this.avatar = null;
  }

  private remeasure(): void {
    if (this.destroyed) return;
    this.measure();
    // standing on the screen's bottom: not a page floor, it stays where it is (the scroll check moves him)
    if (this.floor.id === SCREEN) return;
    const same = this.world.floors.find((f) => f.id === this.floor.id)
      // his floor is gone (the section changed): back home on the stats row, or the first floor
      ?? (this.mode === 'stand' || this.mode === 'walk' ? this.home() : undefined);
    if (same) {
      this.floor = same;
      if (this.mode === 'stand' || this.mode === 'walk') {
        this.feet = { x: P.clampToFloor(same, this.feet.x, this.margin()), y: same.y };
        this.render();
      }
    }
  }

  private home(): P.Floor {
    return this.world.floors.find((f) => f.id === 'stats') ?? this.world.floors[0] ?? P.groundFloor(this.world);
  }

  private floorIndex(): number {
    return Math.max(0, this.world.floors.findIndex((f) => f.id === this.floor.id));
  }

  private pickCard(): number {
    if (!this.cards.length) return 0;
    let c = Math.floor(this.rng() * this.cards.length);
    if (this.cards.length > 1 && c === this.lastCard) c = (c + 1) % this.cards.length;
    return c;
  }

  /** The part of the content you can see now (content px), minus the room under the tab bar. */
  private visibleRange(): { top: number; bottom: number } {
    const sc = this.scroller;
    if (!sc) return { top: 0, bottom: this.world.bottom };
    const stageTop = this.stage.getBoundingClientRect().top;
    const [viewTop, viewH] = isWindow(sc) ? [0, sc.innerHeight] : [sc.getBoundingClientRect().top, sc.clientHeight];
    const top = viewTop - stageTop;
    return { top, bottom: top + viewH - (this.opts.groundInset ?? 0) };
  }

  /** He only goes where you can watch him: a floor with room above it inside the visible part. */
  private visibleFloor(f: P.Floor): boolean {
    const v = this.visibleRange();
    return f.y - (this.g.foot.y - this.g.hit.y) >= v.top + 8 && f.y <= v.bottom - 8;
  }

  /** The screen's bottom edge (just above the tab bar) as a floor while he flies: on a long page with nothing under
   *  him he lands where you can see him, never down past the screen's edge. Null when the page's ground is visible. */
  private screenFloor(): P.Floor | null {
    if (!this.scroller) return null;
    const y = this.visibleRange().bottom;
    return y < this.world.bottom - 1 ? { id: SCREEN, y, x0: 0, x1: this.world.width } : null;
  }

  /** On the screen's bottom (no page floor there): back up onto the nearest floor you can see; none = he stays. */
  private async climbBack(gen: number): Promise<void> {
    if (this.floor.id !== SCREEN) return;
    const to = this.world.floors.filter((f) => f.y < this.floor.y && this.visibleFloor(f)).sort((a, b) => b.y - a.y)[0];
    if (!to) return;
    await this.sleep(300, gen);
    await this.goTo(to, clamp(this.feet.x, to.x0 + this.margin(), to.x1 - this.margin()), gen);
  }

  /** After a scroll, while he stands on the screen's bottom: a floor came into view = back onto it; the bottom moved
   *  down (scrolled on) = he hops down to it; it moved up past him (scrolled back) = he waits out of sight. */
  private screenCheck(): void {
    clearTimeout(this.screenTimer);
    this.screenTimer = setTimeout(() => {
      if (this.destroyed || this.reduced || this.mode !== 'stand' || this.floor.id !== SCREEN) return;
      const seen = this.world.floors.some((f) => f.y < this.floor.y && this.visibleFloor(f));
      const screen = this.screenFloor();
      if (seen) void this.flow((gen) => this.climbBack(gen));
      else if (screen && screen.y > this.floor.y + 1) void this.flow((gen) => this.hopTo(screen, this.feet.x, gen));
    }, 300);
  }

  // ---------- rendering ----------

  private place(world: Point, origin: Point, angle = 0): void {
    this.actor.style.transform = `translate(${world.x.toFixed(2)}px, ${world.y.toFixed(2)}px) rotate(${angle.toFixed(4)}rad) translate(${(-origin.x).toFixed(2)}px, ${(-origin.y).toFixed(2)}px)`;
  }

  private render(): void {
    switch (this.mode) {
      case 'held':
        this.place(this.pivot, this.g.scruff, -P.pendulumAngle(this.pend, this.pivot));
        this.showGround(this.pend.x, this.pend.y);
        break;
      case 'fly':
      case 'roll':
      case 'getup':
        this.place({ x: this.body.x, y: this.body.y }, this.g.center, this.body.angle);
        if (this.mode === 'fly') this.showGround(this.body.x, this.body.y);
        else this.ground.style.opacity = '0';
        break;
      default:
        this.place(this.feet, this.g.foot);
        if (this.mode === 'hop') this.showGround(this.feet.x, this.feet.y - (this.g.foot.y - this.g.center.y));
        else this.ground.style.opacity = '0';
    }
  }

  /** His shadow on the floor under him while he is in the air: smaller and fainter the higher he is. */
  private showGround(x: number, y: number): void {
    const f = P.floorBelow(this.world, x, y);
    const h = Math.max(0, f.y - y);
    const s = clamp(1 - h / 260, 0.35, 1);
    this.ground.style.transform = `translate(${x.toFixed(1)}px, ${f.y.toFixed(1)}px) scale(${s.toFixed(2)})`;
    this.ground.style.opacity = String((0.9 * s).toFixed(2));
  }

  private emit(): void {
    this.opts.onState?.(this.info);
  }

  // ---------- the motion loop (rAF only while something moves) ----------

  private kick(): void {
    // no visibility check: a flight or a hold always finishes (a hidden tab pauses rAF by itself)
    if (this.rafId || this.destroyed) return;
    this.lastT = performance.now();
    this.rafId = raf(this.frame);
  }

  private readonly frame = (t: number): void => {
    this.rafId = 0;
    const dt = clamp((t - this.lastT) / 1000, 0, 1 / 30);
    this.lastT = t;
    const more = this.step(dt);
    this.render();
    if (more) this.kick();
  };

  /** Advances the current motion by dt; false = nothing moves any more (the loop stops). */
  private step(dt: number): boolean {
    switch (this.mode) {
      case 'walk': {
        const dir = Math.sign(this.walkTarget - this.feet.x);
        const next = this.feet.x + dir * WALK_SPEED[this.kind] * dt;
        if (dir === 0 || Math.sign(this.walkTarget - next) !== dir) {
          this.feet.x = this.walkTarget;
          this.finishMotion('stand');
          return false;
        }
        this.feet.x = next;
        return true;
      }
      case 'hop': {
        this.hopS += dt;
        if (this.hopS >= this.hopV.t) {
          this.feet = { ...this.hopEnd };
          if (this.hopFloor) this.floor = this.hopFloor;
          this.squash(0.12, 260);
          this.finishMotion('stand');
          return false;
        }
        this.feet = P.hopPoint(this.hopFrom, this.hopV, P.GRAVITY, this.hopS);
        return true;
      }
      case 'held': {
        // the finger point eases in (he is lifted up to it), the body swings behind it
        const k = 1 - Math.exp(-dt * 28);
        this.pivot = { x: this.pivot.x + (this.pointer.x - this.pivot.x) * k, y: this.pivot.y + (this.pointer.y - this.pivot.y) * k };
        if (this.reduced) {
          this.pend = P.pendulumAt(this.pivot, this.pend.len);
        } else {
          const n = Math.max(1, Math.ceil(dt / (1 / 240)));
          for (let i = 0; i < n; i++) this.pend = P.stepPendulum(this.pend, this.pivot, PENDULUM_GRAVITY, dt / n);
        }
        let a = P.pendulumAngle(this.pend, this.pivot);
        if (Math.abs(a) > P.MAX_SWING) {
          a = Math.sign(a) * P.MAX_SWING;
          const x = this.pivot.x + Math.sin(a) * this.pend.len;
          const y = this.pivot.y + Math.cos(a) * this.pend.len;
          this.pend = { ...this.pend, x, y, px: x, py: y };
        }
        const w = dt > 0 ? (a - this.swingPrev) / dt : 0;
        this.swingPrev = a;
        const deg = (a * 180) / Math.PI;
        this.rig.swing(clamp(w * 9, -28, 28), clamp(-deg * 0.7 + w * 6, -34, 34));
        return true;
      }
      case 'fly': {
        const n = Math.max(1, Math.ceil(dt / (1 / 240)));
        // the screen's bottom counts as a floor in the air (screenFloor)
        const screen = this.screenFloor();
        const world = screen ? { ...this.world, floors: [...this.world.floors, screen] } : this.world;
        for (let i = 0; i < n; i++) {
          const s = P.stepFlight(this.body, world, dt / n);
          let landed = s.landed;
          // already below the screen's bottom (the page scrolled during the flight): he lands on it all the same
          if (!landed && screen && s.body.vy > 0 && s.body.y + s.body.r >= screen.y) {
            landed = screen;
            s.body.y = screen.y - s.body.r;
          }
          this.body = s.body;
          if (s.bumped) this.haptic('tap');
          if (landed) {
            this.land(landed, s.body);
            const now = this.mode as Mode;
            return now === 'roll' || now === 'fly';
          }
        }
        return true;
      }
      case 'roll': {
        const s = P.stepRoll(this.rollState, this.floor, this.world, this.body.r, dt);
        this.rollState = s.roll;
        this.body = { ...this.body, x: s.roll.x, y: this.floor.y - this.body.r, angle: s.roll.angle };
        if (s.offEdge) {
          // rolled off the end of a card: he drops to the next floor below
          this.body = { ...this.body, vx: s.roll.v, vy: 0, spin: s.roll.v / this.body.r };
          this.mode = 'fly';
          return true;
        }
        if (s.stopped) {
          this.mode = 'getup';
          this.getupS = 0;
          this.getupFrom = { angle: this.body.angle, cy: this.body.y };
        }
        return true;
      }
      case 'getup': {
        this.getupS += dt;
        const t = clamp(this.getupS / 0.42, 0, 1);
        const target = P.uprightAngle(this.getupFrom.angle);
        const standCy = this.floor.y - (this.g.foot.y - this.g.center.y);
        const e = easeOutBack(t);
        this.body = { ...this.body, angle: this.getupFrom.angle + (target - this.getupFrom.angle) * e, y: this.getupFrom.cy + (standCy - this.getupFrom.cy) * e };
        if (t >= 1) {
          this.feet = { x: this.body.x, y: this.floor.y };
          this.finishMotion('stand');
          return false;
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** Ends a scripted motion (walk, hop, roll+get-up) and wakes up whoever awaits it. */
  private finishMotion(mode: Mode): void {
    this.mode = mode;
    const m = this.motion;
    this.motion = null;
    m?.resolve();
  }

  private awaitMotion(gen: number): Promise<void> {
    if (gen !== this.gen) return Promise.reject(new Cancelled());
    return new Promise<void>((resolve, reject) => {
      this.motion = { resolve, reject };
      this.kick();
    });
  }

  // ---------- flows (a behaviour, an answer to a touch) ----------

  /** Stops whatever runs now: the behaviour, its timers, its motion, the puppet's scene. */
  private cancel(): void {
    // a living moment of the host ends at once (back to the rest pose): the engine takes over from there
    const run = this.aliveRun;
    this.aliveRun = null;
    run?.stop();
    // a footing moment stops first: the engine takes over from where his body is (no jump)
    this.stopFooting();
    this.slowFeet();
    this.gen += 1;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    const m = this.motion;
    this.motion = null;
    m?.reject(new Cancelled());
    this.pose.getAnimations().forEach((a) => a.cancel());
    if (this.rig.puppet.busy) void this.rig.puppet.interrupt();
  }

  /** Runs one flow on a fresh generation; when it ends normally his own life goes on. */
  private async flow(run: (gen: number) => Promise<void>): Promise<void> {
    this.cancel();
    this.resetPose();
    const gen = this.gen;
    try {
      await run(gen);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
      return;
    }
    if (gen === this.gen) this.startLife();
  }

  private sleep(ms: number, gen: number): Promise<void> {
    if (gen !== this.gen) return Promise.reject(new Cancelled());
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        if (gen !== this.gen) reject(new Cancelled());
        else resolve();
      }, ms);
      this.timers.add(t);
    });
  }

  private resetPose(): void {
    this.rig.clearPose();
    this.rig.eyes('normal');
    this.rig.turn(0);
    this.rig.puppet.setPuff(this.restPuff);
    this.hostEl.style.opacity = '';
    this.pose.style.transform = '';
    this.layer.classList.remove('bd-held-cursor');
  }

  private startLife(): void {
    if (this.destroyed || !this.visible || !this.onScreen || this.lent) return;
    this.cancel();
    const gen = this.gen;
    this.startGaze();
    this.setAction('idle');
    if (this.opts.autonomous === false) return;
    void (async () => {
      try {
        // a short breath before the first decision, so the screen settles
        await this.sleep(700 + this.rng() * 900, gen);
        while (gen === this.gen) {
          const d = decide(
            {
              now: Date.now(),
              kind: this.kind,
              reduced: this.reduced,
              cards: this.cards.length,
              hasAvatar: this.avatar !== null,
              floors: this.world.floors.length,
              floor: this.floorIndex(),
              lastInteraction: this.lastInteraction,
              throwTimes: this.throwTimes,
              lastDone: this.lastDone,
              last: this.last,
              lastCard: this.lastCard,
              alive: !this.reduced && (this.opts.alive?.due() ?? false),
            },
            this.rng,
          );
          await this.perform(d, gen);
          this.lastDone[d.kind] = Date.now();
          this.last = d.kind;
        }
      } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
      }
    })();
  }

  private setAction(name: string): void {
    this.action = name;
    this.emit();
  }

  // ---------- behaviours ----------

  private async perform(d: Decision, gen: number): Promise<void> {
    this.setAction(d.kind);
    switch (d.kind) {
      case 'idle':
        await this.sleep(d.duration, gen);
        return;
      case 'wander': {
        const floors = this.world.floors;
        let to = floors[clamp(d.floor ?? this.floorIndex(), 0, floors.length - 1)] ?? this.floor;
        // never off into a part of the page nobody sees (he would freeze there: offscreen = paused)
        if (to.id !== this.floor.id && !this.visibleFloor(to)) {
          const seen = floors.filter((f) => f.id !== this.floor.id && this.visibleFloor(f));
          to = seen.length && (d.at ?? 0) < 0.6 ? (seen[Math.floor(this.rng() * seen.length)] ?? this.floor) : this.floor;
        }
        const x = to.x0 + this.margin() + (to.x1 - to.x0 - 2 * this.margin()) * (d.at ?? 0.5);
        await this.goTo(to, x, gen);
        this.rig.turn(0);
        return;
      }
      case 'sniff':
        return this.sniff(gen);
      case 'sit':
        return this.sit(d.duration, gen);
      case 'scratch':
        return this.scratch(gen);
      case 'lookAround':
        return this.lookAround(gen);
      case 'inspect':
        return this.inspect(d.card ?? 0, d.duration, gen);
      case 'admire':
        return this.admire(d.duration, gen);
      case 'stuff':
        return this.stuff(gen);
      case 'nap':
        return this.nap(d.duration, gen);
      case 'sulk':
        return this.sulk(d.duration, gen);
      case 'alive':
        return this.alive(gen);
    }
  }

  /** Walks (and hops floor to floor, card by card) to x on `to`. */
  private async goTo(to: P.Floor, x: number, gen: number): Promise<void> {
    if (this.reduced) return;
    const path = P.route(this.world, this.floor, to, clamp(x, to.x0, to.x1));
    for (const f of path) {
      if (f.id === this.floor.id) {
        await this.walkTo(P.clampToFloor(f, x, this.margin()), gen);
      } else {
        // walk to a take-off spot that both floors share, then hop
        const lo = Math.max(this.floor.x0, f.x0) + this.margin();
        const hi = Math.min(this.floor.x1, f.x1) - this.margin();
        const takeoff = clamp(this.feet.x, lo, Math.max(lo, hi));
        if (Math.abs(takeoff - this.feet.x) > 2) await this.walkTo(takeoff, gen);
        const land = f.id === to.id ? P.clampToFloor(f, x, this.margin()) : clamp(takeoff + (x - takeoff) * 0.3, lo, Math.max(lo, hi));
        await this.hopTo(f, land, gen);
      }
    }
  }

  private async walkTo(x: number, gen: number): Promise<void> {
    if (Math.abs(x - this.feet.x) < 2) return;
    this.facing = x > this.feet.x ? 1 : -1;
    this.rig.turn(this.facing);
    await this.sleep(120, gen);
    this.rig.walking(true);
    this.walkTarget = x;
    this.mode = 'walk';
    try {
      await this.awaitMotion(gen);
    } finally {
      this.rig.walking(false);
    }
  }

  private async hopTo(f: P.Floor, x: number, gen: number): Promise<void> {
    this.facing = x >= this.feet.x ? 1 : -1;
    this.rig.turn(this.facing);
    await this.squash(-0.1, 160);
    if (gen !== this.gen) throw new Cancelled();
    this.hopFrom = { ...this.feet };
    this.hopEnd = { x, y: f.y };
    this.hopV = P.hopVelocity(this.hopFrom, this.hopEnd, P.GRAVITY);
    this.hopS = 0;
    this.hopFloor = f;
    this.mode = 'hop';
    this.rig.set('bd-air', true);
    try {
      await this.awaitMotion(gen);
    } finally {
      this.rig.set('bd-air', false);
    }
  }

  /** Squash (positive) or stretch (negative) around the feet, then a springy settle. */
  private squash(amount: number, ms: number): Promise<void> {
    if (this.reduced || typeof this.pose.animate !== 'function') return Promise.resolve();
    this.pose.style.transformOrigin = `${this.g.foot.x}px ${this.g.foot.y}px`;
    const a = this.pose.animate(
      [
        { transform: 'scale(1, 1)' },
        { transform: `scale(${1 + amount}, ${1 - amount})`, offset: 0.35 },
        { transform: `scale(${1 - amount * 0.3}, ${1 + amount * 0.3})`, offset: 0.7 },
        { transform: 'scale(1, 1)' },
      ],
      { duration: ms, easing: 'ease-out' },
    );
    return a.finished.then(() => undefined, () => undefined);
  }

  /** A gesture of the whole puppet around his feet (tilt, nod, shake, wobble). */
  private gesture(frames: Keyframe[], ms: number, gen: number, iterations = 1): Promise<void> {
    if (gen !== this.gen) return Promise.reject(new Cancelled());
    if (this.reduced || typeof this.pose.animate !== 'function') return Promise.resolve();
    this.pose.style.transformOrigin = `${this.g.foot.x}px ${this.g.foot.y}px`;
    const a = this.pose.animate(frames, { duration: ms, iterations, easing: 'ease-in-out' });
    return a.finished.then(
      () => { if (gen !== this.gen) throw new Cancelled(); },
      () => { throw new Cancelled(); },
    );
  }

  /** (the app) the host's living moment: he stands, faces you, nothing in his paws; it ends in his rest pose. */
  private async alive(gen: number): Promise<void> {
    const host = this.opts.alive;
    if (!host || this.reduced || this.mode !== 'stand') return;
    this.resetPose();
    const run = host.play(this.rig.puppet, { quietMs: Date.now() - this.lastInteraction });
    if (!run) return this.sleep(300, gen);
    this.aliveRun = run;
    try {
      await run.done;
    } finally {
      if (this.aliveRun === run) this.aliveRun = null;
    }
    if (gen !== this.gen) throw new Cancelled();
  }

  private async sniff(gen: number): Promise<void> {
    this.rig.set('look-up', true);
    for (let i = 0; i < 3; i++) {
      this.rig.look(this.facing * 1.2, -2.6);
      await this.sleep(150, gen);
      this.rig.look(this.facing * 1.2, -1.2);
      await this.sleep(150, gen);
    }
    this.rig.set('look-up', false);
    this.rig.look(null);
    await this.sleep(500, gen);
  }

  private async sit(ms: number, gen: number): Promise<void> {
    this.rig.set('bd-sit', true);
    this.pose.style.transformOrigin = `${this.g.foot.x}px ${this.g.foot.y}px`;
    this.pose.style.transform = this.reduced ? '' : 'scale(1.05, .94)';
    await this.sleep(500, gen);
    this.rig.eyes('happy');
    await this.sleep(ms * 0.6, gen);
    this.rig.eyes('normal');
    await this.sleep(ms * 0.4, gen);
    this.pose.style.transform = '';
    this.rig.set('bd-sit', false);
  }

  private async scratch(gen: number): Promise<void> {
    this.rig.eyes('happy');
    this.rig.set('twitch', true);
    if (!this.reduced && typeof this.rig.pawR.animate === 'function') {
      const up = 'translate(26px, -62px) rotate(-40deg)';
      const a = this.rig.pawR.animate(
        [{ transform: 'none' }, { transform: up, offset: 0.2 }, { transform: 'translate(29px, -66px) rotate(-30deg)', offset: 0.32 }, { transform: up, offset: 0.44 }, { transform: 'translate(29px, -66px) rotate(-30deg)', offset: 0.56 }, { transform: up, offset: 0.68 }, { transform: 'none' }],
        { duration: 1300, easing: 'ease-in-out' },
      );
      await a.finished.catch(() => undefined);
    } else await this.sleep(1300, gen);
    if (gen !== this.gen) throw new Cancelled();
    this.rig.set('twitch', false);
    this.rig.eyes('normal');
    await this.sleep(300, gen);
  }

  private async lookAround(gen: number): Promise<void> {
    this.rig.turn(-1);
    this.rig.look(-3, 0);
    await this.sleep(700, gen);
    this.rig.turn(1);
    this.rig.look(3, 0);
    await this.sleep(700, gen);
    this.rig.turn(0);
    this.rig.set('look-up', true);
    this.rig.look(0, -3);
    await this.sleep(700, gen);
    this.rig.set('look-up', false);
    this.rig.look(null);
    await this.sleep(400, gen);
  }

  /** Walks onto a wishlist card's top edge, leans over it, nods: "oh yes — great idea!" */
  private async inspect(card: number, ms: number, gen: number): Promise<void> {
    let f = this.cards[card] ?? this.cards[0];
    if (f && !this.visibleFloor(f)) {
      // that list is scrolled out of view: take one you can see, or just look around
      const seen = this.cards.filter((c) => this.visibleFloor(c));
      f = seen.length ? seen[Math.floor(this.rng() * seen.length)] : undefined;
      if (f?.card !== undefined) card = f.card;
    }
    if (!f) return this.lookAround(gen);
    this.lastCard = card;
    const mid = (f.x0 + f.x1) / 2;
    const side = this.rng() < 0.5 ? -1 : 1;
    await this.goTo(f, mid + side * (f.x1 - f.x0) * 0.22, gen);
    // face the card's middle and look down into it
    const dir: -1 | 1 = mid >= this.feet.x ? 1 : -1;
    this.facing = dir;
    this.rig.turn(dir);
    await this.sleep(250, gen);
    this.rig.look(dir * 1.6, 3.2);
    await this.gesture([{ transform: 'rotate(0deg)' }, { transform: `rotate(${dir * 11}deg)` }], 380, gen);
    this.pose.style.transform = this.reduced ? '' : `rotate(${dir * 11}deg)`;
    await this.sleep(ms * 0.25, gen);
    // two nods
    await this.gesture([{ transform: `rotate(${dir * 11}deg)` }, { transform: `rotate(${dir * 17}deg) translateY(1px)` }, { transform: `rotate(${dir * 11}deg)` }], 330, gen, 2);
    this.rig.eyes('star');
    this.rig.blush(true);
    const head = this.headPoint();
    this.bang(head.x + dir * 6, head.y - 14);
    this.sparkle(mid + side * 30, f.y + 26);
    this.sparkle(mid - side * 40, f.y + 44, 160);
    this.haptic('select');
    await this.sleep(ms * 0.35, gen);
    this.rig.eyes('normal');
    this.rig.blush(false);
    this.rig.look(null);
    await this.gesture([{ transform: `rotate(${dir * 11}deg)` }, { transform: 'rotate(0deg)' }], 300, gen);
    this.pose.style.transform = '';
    this.rig.turn(0);
  }

  /** Goes under your avatar, turns to it, heart eyes, little stars: he adores you. */
  private async admire(ms: number, gen: number): Promise<void> {
    const av = this.avatar;
    if (!av) return;
    const target = P.floorBelow(this.world, av.x + av.width / 2, av.y + av.height);
    const x = av.x + av.width * 1.15;
    await this.goTo(target, x, gen);
    const dir: -1 | 1 = av.x + av.width / 2 >= this.feet.x ? 1 : -1;
    this.facing = dir;
    this.rig.turn(dir);
    this.rig.set('look-up', true);
    this.rig.look(dir * 2.4, -3);
    await this.sleep(350, gen);
    this.rig.eyes('heart');
    this.rig.blush(true);
    this.haptic('select');
    const head = this.headPoint();
    for (let i = 0; i < 4; i++) this.star(head.x + (i - 1.5) * 16, head.y - 8 - (i % 2) * 12, i * 140);
    this.heart(head.x - dir * 4, head.y - 4, 0);
    this.heart(head.x + dir * 10, head.y - 2, 420);
    await this.gesture([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(0deg)' }], ms * 0.55, gen);
    this.heart(head.x, head.y - 6, 0);
    await this.sleep(ms * 0.35, gen);
    this.rig.eyes('normal');
    this.rig.blush(false);
    this.rig.set('look-up', false);
    this.rig.look(null);
    this.rig.turn(0);
    await this.sleep(300, gen);
  }

  /** The hamster's own: a tiny gift goes into his cheeks. */
  private async stuff(gen: number): Promise<void> {
    if (this.kind !== 'hamster') return this.sniff(gen);
    const gift = this.rig.gift;
    const anim = (el: Element, frames: Keyframe[], o: KeyframeAnimationOptions) => (typeof el.animate === 'function' ? el.animate(frames, { fill: 'forwards', ...o }).finished.catch(() => undefined) : Promise.resolve());
    this.rig.turn(0);
    this.rig.set('look-up', true);
    gift.style.opacity = '1';
    await anim(gift, [{ transform: 'translateY(-120px) scale(.6) rotate(-30deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: this.reduced ? 1 : 520, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    if (gen !== this.gen) throw new Cancelled();
    this.rig.set('look-up', false);
    this.rig.eyes('star');
    await this.sleep(350, gen);
    await anim(this.rig.paws, [{ transform: 'none' }, { transform: 'translateY(-30px)' }], { duration: this.reduced ? 1 : 300, easing: 'ease-out' });
    await anim(gift, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-4px) scale(.15)', opacity: 0 }], { duration: this.reduced ? 1 : 360, easing: 'ease-in' });
    if (gen !== this.gen) throw new Cancelled();
    this.rig.puppet.setPuff(1.38);
    this.rig.eyes('happy');
    this.rig.set('chewing', true);
    await this.sleep(900, gen);
    this.rig.set('chewing', false);
    await anim(this.rig.paws, [{ transform: 'translateY(-30px)' }, { transform: 'none' }], { duration: this.reduced ? 1 : 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    this.rig.paws.getAnimations().forEach((a) => a.cancel());
    gift.getAnimations().forEach((a) => a.cancel());
    gift.style.opacity = '';
    await this.sleep(700, gen);
    this.rig.eyes('normal');
    // the cheeks stay full a while, then slowly back to "wishes in the cheeks"
    if (this.puffTimer) clearTimeout(this.puffTimer);
    this.puffTimer = setTimeout(() => { this.puffTimer = null; if (!this.destroyed) this.rig.puppet.setPuff(this.restPuff); }, 5000);
  }

  private async nap(ms: number, gen: number): Promise<void> {
    this.rig.turn(0);
    this.rig.set('m-yawn', true);
    this.rig.eyes('happy');
    await this.gesture([{ transform: 'scale(1,1)' }, { transform: 'scale(.97,1.05)' }, { transform: 'scale(1,1)' }], 1100, gen);
    this.rig.set('m-yawn', false);
    this.rig.eyes('sleep');
    this.rig.set('sleeping', true);
    const until = Date.now() + ms;
    try {
      while (Date.now() < until) {
        if (!this.reduced) this.zzz();
        await this.sleep(1900, gen);
      }
    } finally {
      this.rig.set('sleeping', false);
    }
    this.rig.eyes('normal');
    this.rig.set('startle', true);
    await this.squash(-0.08, 300);
    this.rig.set('startle', false);
  }

  /** Thrown too often: he turns his back on you and sits there, offended. */
  private async sulk(ms: number, gen: number): Promise<void> {
    const away: -1 | 1 = this.pointer.x > this.feet.x ? -1 : 1;
    this.facing = away;
    this.rig.turn(away);
    this.rig.angry(true);
    this.puff(away);
    await this.sleep(1200, gen);
    this.rig.angry(false);
    this.rig.set('bd-sit', true);
    this.rig.set('bd-crossed', true);
    this.rig.set('bd-pout', true);
    this.rig.look(away * 3, -0.5);
    await this.sleep(ms - 1200, gen);
    this.rig.set('bd-pout', false);
    this.rig.set('bd-crossed', false);
    this.rig.set('bd-sit', false);
    this.rig.look(null);
    this.rig.eyes('happy');
    await this.sleep(500, gen);
    this.rig.eyes('normal');
    this.rig.turn(0);
  }

  // ---------- answers to touches ----------

  private async giggle(gen: number): Promise<void> {
    this.setAction('giggle');
    this.rig.eyes('happy');
    this.rig.blush(true);
    this.rig.set('m-open', true);
    const head = this.headPoint();
    this.heart(head.x + 8, head.y, 0);
    await this.gesture([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(0deg)' }], 560, gen);
    this.rig.set('m-open', false);
    await this.sleep(500, gen);
    this.rig.blush(false);
    this.rig.eyes('normal');
  }

  private async wave(gen: number): Promise<void> {
    this.setAction('wave');
    this.rig.turn(0);
    await this.rig.puppet.play('greet');
    if (gen !== this.gen) throw new Cancelled();
  }

  /** A new wish was added: a happy jump with sparkles. */
  private async happyHop(gen: number): Promise<void> {
    this.setAction('wish');
    this.rig.turn(0);
    const head = this.headPoint();
    this.sparkle(head.x - 20, head.y - 6);
    this.sparkle(head.x + 22, head.y - 12, 120);
    await this.rig.puppet.play('jump');
    if (gen !== this.gen) throw new Cancelled();
  }

  // ---------- holding and throwing ----------

  private readonly onDown = (e: PointerEvent): void => {
    if (this.destroyed || (e.pointerType === 'mouse' && e.button !== 0) || this.press || this.lent) return;
    const p = this.toStage(e);
    this.press = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), touch: e.pointerType !== 'mouse', timer: null, grabbed: false };
    this.pointer = p;
    this.samples = [{ t: performance.now(), x: p.x, y: p.y }];
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    if (this.press.touch) {
      // a phone: only a long press picks him up, so a swipe that starts on him still scrolls the page
      this.press.timer = setTimeout(() => { if (this.press && !this.press.grabbed) this.grab(); }, 250);
    } else {
      e.preventDefault();
    }
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    if (this.press?.grabbed) e.preventDefault();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const press = this.press;
    if (!press || e.pointerId !== press.id) return;
    const p = this.toStage(e);
    this.pointer = p;
    const now = performance.now();
    this.samples.push({ t: now, x: p.x, y: p.y });
    if (this.samples.length > 12) this.samples.shift();
    if (!press.grabbed) {
      const moved = Math.hypot(p.x - press.x, p.y - press.y);
      if (press.touch && moved > 10) this.endPress(); // a scroll, not a grab
      else if (!press.touch && moved > 4) this.grab();
    }
  };

  /** Held, but the pointer is gone without a pointerup: a gentle drop where he is, never stuck in the air. */
  private readonly onLostCapture = (): void => {
    if (!this.press?.grabbed) return;
    this.endPress();
    this.release({ vx: 0, vy: 0 });
  };

  private readonly onUp = (e: PointerEvent): void => {
    const press = this.press;
    if (!press || e.pointerId !== press.id) return;
    if (press.grabbed) {
      const v = e.type === 'pointercancel' ? { vx: 0, vy: 0 } : P.releaseVelocity(this.samples, performance.now());
      this.endPress();
      this.release(v);
    } else {
      const short = performance.now() - press.t < 450;
      this.endPress();
      if (short && e.type !== 'pointercancel') this.onTap();
    }
  };

  private endPress(): void {
    if (this.press?.timer) clearTimeout(this.press.timer);
    this.press = null;
    this.hit.removeEventListener('lostpointercapture', this.onLostCapture);
    window.removeEventListener('blur', this.onLostCapture);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }

  private toStage(e: { clientX: number; clientY: number }): Point {
    const r = this.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onTap(): void {
    this.lastInteraction = Date.now();
    if (this.mode !== 'stand' && this.mode !== 'walk') return;
    if (this.tapTimer) {
      // the second tap of a double tap: he waves
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
      this.haptic('tap');
      void this.flow((gen) => this.wave(gen));
      return;
    }
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      if (this.action === 'sulk') {
        this.puff(this.facing);
        return;
      }
      this.haptic('tap');
      void this.flow((gen) => this.giggle(gen));
    }, 280);
  }

  /** Picked up: he is lifted to the finger by his scruff and dangles. */
  private grab(): void {
    const press = this.press;
    if (!press || this.destroyed) return;
    press.grabbed = true;
    this.lastInteraction = Date.now();
    this.cancel();
    this.resetPose();
    this.setAction('held');
    try { this.hit.setPointerCapture?.(press.id); } catch { /* the pointer may be gone */ }
    // safety net: the capture is lost without a pointerup (window lost focus, system gesture) → set him down
    this.hit.addEventListener('lostpointercapture', this.onLostCapture);
    window.addEventListener('blur', this.onLostCapture);
    // where his scruff and his body's centre are right now, so the lift starts from there
    const scruffNow = this.worldOf(this.g.scruff);
    const centreNow = this.worldOf(this.g.center);
    this.pivot = scruffNow;
    const len = Math.hypot(this.g.center.x - this.g.scruff.x, this.g.center.y - this.g.scruff.y);
    this.pend = { x: centreNow.x, y: centreNow.y, px: centreNow.x, py: centreNow.y, len };
    this.swingPrev = P.pendulumAngle(this.pend, this.pivot);
    this.mode = 'held';
    this.rig.set('bd-held', true);
    this.rig.worry(true);
    this.rig.set('m-open', true);
    this.layer.classList.add('bd-held-cursor');
    this.haptic('select');
    this.kick();
  }

  /** Where a point of his host box is in the content right now (any mode). */
  private worldOf(local: Point): Point {
    switch (this.mode) {
      case 'held': {
        const a = -P.pendulumAngle(this.pend, this.pivot);
        return rotateAround(local, this.g.scruff, a, this.pivot);
      }
      case 'fly':
      case 'roll':
      case 'getup':
        return rotateAround(local, this.g.center, this.body.angle, { x: this.body.x, y: this.body.y });
      default:
        return { x: this.feet.x + (local.x - this.g.foot.x), y: this.feet.y + (local.y - this.g.foot.y) };
    }
  }

  private release(v: { vx: number; vy: number }): void {
    this.layer.classList.remove('bd-held-cursor');
    this.rig.set('bd-held', false);
    this.rig.swing(0, 0);
    this.rig.set('m-open', false);
    const centre = { x: this.pend.x, y: this.pend.y };
    this.lastInteraction = Date.now();
    if (this.reduced) {
      // calm: set down gently under the spot where he was let go (inside the screen, on a floor you can see),
      // no flight, no tumble
      const x = clamp(centre.x, this.margin(), this.world.width - this.margin());
      const below = P.allFloors(this.world).filter((f) => f.y >= centre.y - 0.5 && x >= f.x0 && x <= f.x1);
      const f = below.find((fl) => this.visibleFloor(fl)) ?? [...P.allFloors(this.world)].reverse().find((fl) => this.visibleFloor(fl) && x >= fl.x0 && x <= fl.x1) ?? below[0] ?? P.groundFloor(this.world);
      this.floor = f;
      this.feet = { x: P.clampToFloor(f, x, this.margin()), y: f.y };
      this.setAction('idle');
      this.mode = 'stand';
      this.rig.worry(false);
      this.render();
      this.haptic('tap');
      // near a card's end: straight on to the safe spot (the calm footing)
      if (!this.footingSafeSpot()) this.startLife();
      return;
    }
    const angle = -P.pendulumAngle(this.pend, this.pivot);
    const swingSpin = (this.pend.x - this.pend.px) * 4;
    this.throwFrom(centre, v, angle, swingSpin);
    this.readyFeet();
  }

  /** Starts a free flight of his body from `centre` (the gallery's "throw" button uses it too). */
  private throwFrom(centre: Point, v: { vx: number; vy: number }, angle = 0, extraSpin = 0): void {
    this.cancel();
    this.resetPose();
    this.setAction('flying');
    // a real throw (not a gentle drop) counts towards his grudge
    if (Math.hypot(v.vx, v.vy) >= 320) this.throwTimes = [...this.throwTimes.filter((t) => Date.now() - t < 120000), Date.now()];
    this.rig.worry(true);
    this.rig.set('bd-tuck', Math.hypot(v.vx, v.vy) > 500);
    this.rig.set('bd-air', true);
    const r = this.g.radius;
    this.body = { x: clamp(centre.x, r, this.world.width - r), y: Math.max(this.world.top + r, centre.y), vx: v.vx, vy: v.vy, angle, spin: P.throwSpin(v.vx, r) + extraSpin, r };
    this.mode = 'fly';
    this.kick();
  }

  /** Touched down on a floor: on his feet (gentle) or tumbling into a roll. */
  private land(f: P.Floor, b: P.Body): void {
    this.floor = f;
    this.rig.set('bd-air', false);
    this.rig.set('bd-tuck', false);
    const kind = P.landingKind(b.vx, b.vy);
    if (kind === 'gentle') {
      // lands on his feet: the body turns upright on the way down
      this.body = { ...b, angle: 0 };
      this.feet = { x: P.clampToFloor(f, b.x, this.margin() * 0.6), y: f.y };
      this.mode = 'stand';
      this.haptic('tap');
      void this.flow(async (gen) => {
        // near a card's rounded end he checks the ground first (footing); else the usual relieved sigh
        await (this.footing(gen) ?? this.afterGentle(gen));
        await this.climbBack(gen);
      });
      return;
    }
    this.haptic('warning');
    this.rollState = { x: b.x, v: P.rollStart(b.vx, this.rng() < 0.5 ? 1 : -1), angle: b.angle };
    this.mode = 'roll';
    this.body = { ...b, y: f.y - b.r };
    void this.flow(async (gen) => {
      await this.afterTumble(gen);
      await this.climbBack(gen);
    });
  }

  private async afterGentle(gen: number): Promise<void> {
    this.setAction('landed softly');
    this.rig.worry(false);
    await this.squash(0.14, 360);
    this.rig.eyes('happy');
    // a relieved sigh
    const head = this.headPoint();
    this.hmpf(head.x + this.facing * 10, head.y + 26, this.facing, 0.7);
    await this.gesture([{ transform: 'scale(1,1)' }, { transform: 'scale(1.03,.97)' }, { transform: 'scale(1,1)' }], 700, gen);
    await this.sleep(400, gen);
    this.rig.eyes('normal');
  }

  private async afterTumble(gen: number): Promise<void> {
    this.setAction('tumbling');
    // roll + get up (the physics loop resolves the motion when he stands)
    await this.awaitMotion(gen);
    if (this.mode !== 'stand') await this.awaitMotion(gen);
    this.rig.worry(false);
    void this.squash(0.16, 300);
    // dizzy
    this.setAction('dizzy');
    this.rig.eyes('dizzy');
    this.dizzyStars(1100);
    await this.gesture([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(0deg)' }], 550, gen, 2);
    // angry at you: turns to where your finger let him go, brows down, cheeks puffed, huffs
    this.setAction('angry');
    const dir: -1 | 1 = this.pointer.x >= this.feet.x ? 1 : -1;
    this.facing = dir;
    this.rig.turn(dir);
    this.rig.eyes('normal');
    this.rig.angry(true);
    this.rig.look(dir * 2.6, clamp((this.pointer.y - this.feet.y) / 60, -3, 2));
    this.puff(dir);
    await this.sleep(Math.min(900, angerMs(this.throwTimes, Date.now()) / 2), gen);
    this.puff(dir);
    await this.sleep(Math.max(500, angerMs(this.throwTimes, Date.now()) / 2), gen);
    // shakes the dust off
    this.setAction('shakes off');
    this.rig.angry(false);
    this.rig.eyes('sleep');
    this.dust();
    await this.gesture(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-10deg) scaleX(.96)' }, { transform: 'rotate(9deg) scaleX(.97)' }, { transform: 'rotate(-7deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(0deg)' }],
      620,
      gen,
    );
    this.rig.look(null);
    this.rig.eyes('happy');
    await this.sleep(500, gen);
    this.rig.eyes('normal');
    this.rig.turn(0);
    if (shouldSulk(this.throwTimes, Date.now())) {
      this.setAction('sulk');
      await this.sulk(6000, gen);
      this.lastDone.sulk = Date.now();
    }
  }

  // ---------- «Твёрдая почва»: the footing moment near a card's end (footing.ts) ----------

  /** The floor as the eye sees it (its card's rounded top corners); null for the ground / the screen's edge. */
  private footingShape(f: P.Floor): F.FloorShape | null {
    const el = Array.from(this.stage.querySelectorAll<HTMLElement>('[data-buddy-floor]')).find((e) => e.dataset.buddyFloor === f.id);
    if (!el) return null;
    const half = (f.x1 - f.x0) / 2;
    return { id: f.id, y: f.y, x0: f.x0, x1: f.x1, rL: Math.min(half, cornerRadius(el, -1)), rR: Math.min(half, cornerRadius(el, 1)) };
  }

  private footingOn(): boolean {
    return Boolean(this.opts.footing) && this.kind === 'bunny';
  }

  private footingEvent(e: FootingEvent): void {
    try {
      this.opts.onFooting?.(e);
    } catch {
      /* a debug listener must never break him */
    }
  }

  /** Near a card's end and allowed by the 20 s pause: the plan of the moment (it spends the pause); else null. */
  private footingPlan(): F.Plan | null {
    if (!this.footingOn()) return null;
    const shape = this.footingShape(this.floor);
    if (!shape) return null;
    const edge = F.nearEdge(shape, this.feet.x, this.g.w);
    if (!edge) {
      this.footingEvent({ kind: 'middle', floor: shape.id });
      return null;
    }
    const now = Date.now();
    if (!F.allowed(this.lastFooting, now)) {
      this.footingEvent({ kind: 'pause', floor: shape.id, wait: Math.ceil((F.COOLDOWN_MS - (now - this.lastFooting)) / 1000) });
      return null;
    }
    this.lastFooting = now;
    return F.plan(shape, this.feet.x, this.g.w, edge);
  }

  /** A soft landing: near a card's end the moment (a Promise the flow awaits), else null = the usual sigh. */
  private footing(gen: number): Promise<void> | null {
    this.slowFeet();
    const p = this.footingPlan();
    if (!p) return null;
    this.footingEvent({ kind: 'play', floor: p.floor.id, side: p.side, step: p.step });
    return this.playFooting(p, gen);
  }

  /** Reduced motion: the engine has just set him down under the finger. Near an end: straight to the safe spot. */
  private footingSafeSpot(): boolean {
    if (this.mode !== 'stand') return false;
    const p = this.footingPlan();
    if (!p) return false;
    // the same task as the engine's own set-down: only the safe spot is ever painted
    this.feet = { x: F.safeX(p), y: this.feet.y };
    this.render();
    this.footingEvent({ kind: 'reduced', floor: p.floor.id, side: p.side, step: p.step });
    void this.flow(async (gen) => {
      this.setAction('firm ground');
      this.rig.eyes('happy');
      await this.sleep(F.DURATION * 1000, gen);
      this.rig.eyes('normal');
    });
    return true;
  }

  /** Whether the flight that starts now lands softly near a card's end with the pause over (nothing is spent). */
  private footingWillPlay(): boolean {
    if (!this.footingOn() || !F.allowed(this.lastFooting, Date.now())) return false;
    const end = P.simulateFlight(this.body, this.world);
    if (P.landingKind(end.body.vx, end.body.vy) !== 'gentle') return false;
    const shape = this.footingShape(end.landed);
    const x = P.clampToFloor(end.landed, end.body.x, this.g.radius * 0.54);
    return Boolean(shape && F.nearEdge(shape, x, this.g.w));
  }

  /**
   * Let go above a card's end: his feet come back from dangling quicker than the puppet's own .28 s, so they are
   * under him when he touches down (otherwise they would still hang a pixel into the card at the landing).
   */
  private readyFeet(): void {
    if (this.mode !== 'fly' || !this.footingWillPlay()) return;
    for (const el of this.rig.puppet.root.querySelectorAll<SVGGElement>('.tfoot')) el.style.transition = 'transform .12s cubic-bezier(.3,.7,.3,1)';
    this.fastFeet = true;
  }

  private slowFeet(): void {
    if (!this.fastFeet) return;
    this.fastFeet = false;
    for (const el of this.rig.puppet.root.querySelectorAll<SVGGElement>('.tfoot')) el.style.transition = '';
  }

  private footingParts(p: F.Plan): FootingParts {
    const root = this.rig.puppet.root;
    const q = <T extends Element>(sel: string): T => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`[lists-buddy] missing ${sel}`);
      return el;
    };
    const left = q<SVGGElement>('.tfoot-l');
    const right = q<SVGGElement>('.tfoot-r');
    return {
      body: q<SVGGElement>('.hop > .body'),
      outer: p.side < 0 ? left : right,
      inner: p.side < 0 ? right : left,
      shadow: q<SVGElement>('.hm .shadow'),
      face: this.rig.face,
    };
  }

  /** Writes a pose onto the puppet (transform only; the feet's and the face's CSS transitions are off while driven). */
  private footingApply(run: FootingRun, pose: F.Pose, from?: { outer: F.PartPose; inner: F.PartPose; k: number }): void {
    const { parts } = run;
    const foot = (el: SVGGElement, part: F.PartPose, start?: F.PartPose): F.PartPose => {
      const k = from?.k ?? 1;
      const v = start && k < 1 ? { x: start.x + (part.x - start.x) * k, y: start.y + (part.y - start.y) * k, r: start.r + (part.r - start.r) * k } : part;
      el.style.transition = 'none';
      el.style.transform = `translate(${f3(v.x)}px, ${f3(v.y)}px) rotate(${f3(v.r)}deg)`;
      return v;
    };
    const shown: F.Pose = { ...pose, outer: foot(parts.outer, pose.outer, from?.outer), inner: foot(parts.inner, pose.inner, from?.inner) };
    const b = pose.body;
    parts.body.style.transform = `translate(${f3(b.x)}px, ${f3(b.y)}px) rotate(${f3(b.r)}deg) scale(${b.sx.toFixed(4)}, ${b.sy.toFixed(4)})`;
    parts.shadow.style.transform = `translateX(${f3(pose.shadowX)}px)`;
    parts.face.style.transition = 'none';
    parts.face.style.transform = `translate(${f3(pose.look.x)}px, ${f3(pose.look.y)}px)`;
    if (run.pose.eyes !== pose.eyes) this.rig.eyes(pose.eyes);
    if (run.pose.startle !== pose.startle) this.rig.set('bd-oh', pose.startle);
    run.pose = shown;
  }

  /** A foot's current transform (it may still be gliding back from the dangling pose): the start to blend from. */
  private footingFoot(el: SVGGElement): F.PartPose {
    const m = getComputedStyle(el).transform;
    const n = /^matrix\(([^)]+)\)$/.exec(m ?? '')?.[1]?.split(',').map(Number);
    if (!n || n.length !== 6 || !n.every(Number.isFinite)) return { x: 0, y: 0, r: 0 };
    const [a = 1, b = 0, , , e = 0, f = 0] = n;
    return { x: e, y: f, r: (Math.atan2(b, a) * 180) / Math.PI };
  }

  /** Plays the moment (rAF only while it runs); at its end the engine stands him on the safe spot. */
  private playFooting(p: F.Plan, gen: number): Promise<void> {
    this.setAction('firm ground');
    this.rig.worry(false);
    const parts = this.footingParts(p);
    // a body still relaxing from an interrupted moment must not cover the new pose
    parts.body.getAnimations?.().forEach((a) => a.cancel());
    const start = { outer: this.footingFoot(parts.outer), inner: this.footingFoot(parts.inner) };
    const first = F.poseAt(p, 0);
    let committed = false;
    const done = new Promise<void>((resolve) => {
      const run: FootingRun = { plan: p, parts, pose: { ...first, eyes: 'normal', startle: false }, raf: 0, frozen: false, resolve };
      this.footingRun = run;
      // the feet may still be gliding back from dangling: blend from there within the first 0.1 s
      const blend = (t: number) => {
        const k = Math.min(1, t / 0.1);
        return { ...start, k: k * k * (3 - 2 * k) };
      };
      this.footingApply(run, first, blend(0));
      const t0 = performance.now();
      let touched = false;
      const frame = () => {
        if (this.footingRun !== run) return;
        const t = Math.max(0, (performance.now() - t0) / 1000);
        if (t >= F.DURATION + F.HOLD) {
          this.commitFooting(run);
          committed = true;
          resolve();
          return;
        }
        this.footingApply(run, F.poseAt(p, t), blend(t));
        if (!touched && t >= F.BEATS.touch[1]) {
          touched = true;
          this.haptic('select');
        }
        run.raf = raf(frame);
      };
      run.raf = raf(frame);
    });
    return done.then(async () => {
      if (!committed || gen !== this.gen) return;
      this.footingEvent({ kind: 'done', floor: p.floor.id, side: p.side, step: p.step });
      await this.sleep(450, gen);
      this.rig.eyes('normal');
    });
  }

  /** The end: the engine stands him on the new spot, the driven transforms go to zero — the same frame, the same picture. */
  private commitFooting(run: FootingRun): void {
    this.footingRun = null;
    this.feet = { x: F.safeX(run.plan), y: this.feet.y };
    this.render();
    const { parts } = run;
    for (const el of [parts.body, parts.outer, parts.inner, parts.shadow, parts.face]) el.style.transform = '';
    this.rig.set('bd-oh', false);
    // the feet's and the face's own CSS transitions stay off for this frame (the values changed together with the
    // engine's position, nothing may glide), back on in the next
    raf(() => {
      for (const el of [parts.outer, parts.inner, parts.face]) el.style.transition = '';
    });
  }

  /**
   * Interrupted (picked up, hidden, off screen, paused, a throw, reduced switched, destroy): the engine takes over from
   * where his body is. His feet point absorbs the body's sideways shift; the feet keep their place in the world and
   * glide to whatever comes next with the puppet's own transition; the body's rise, lean and squash relax in 0.22 s.
   */
  private stopFooting(): void {
    const run = this.footingRun;
    if (!run) return;
    this.footingRun = null;
    cancelRaf(run.raf);
    const shift = run.pose.body.x;
    if (this.mode === 'stand') {
      this.feet = { x: this.feet.x + shift * run.plan.u, y: this.feet.y };
      this.render();
    }
    const { parts } = run;
    for (const [el, part] of [[parts.outer, run.pose.outer], [parts.inner, run.pose.inner]] as const) {
      el.style.transform = `translate(${f3(part.x - shift)}px, ${f3(part.y)}px) rotate(${f3(part.r)}deg)`;
    }
    void getComputedStyle(parts.outer).transform;
    void getComputedStyle(parts.inner).transform;
    for (const el of [parts.outer, parts.inner, parts.face]) {
      el.style.transition = '';
      el.style.transform = '';
    }
    const b = run.pose.body;
    parts.body.style.transform = '';
    if (!this.destroyed && typeof parts.body.animate === 'function' && Math.abs(b.y) + Math.abs(b.r) + Math.abs(b.sx - 1) + Math.abs(b.sy - 1) > 0.01) {
      parts.body.animate(
        [{ transform: `translate(0px, ${f3(b.y)}px) rotate(${f3(b.r)}deg) scale(${b.sx.toFixed(4)}, ${b.sy.toFixed(4)})` }, { transform: 'none' }],
        { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
    }
    parts.shadow.style.transform = '';
    this.rig.set('bd-oh', false);
    if (!run.frozen) this.footingEvent({ kind: 'stopped', floor: run.plan.floor.id });
    run.resolve();
  }

  // ---------- small reactions ----------

  private readonly onStageMove = (e: PointerEvent): void => {
    if (this.press) return;
    this.pointer = this.toStage(e);
    this.lastPointerAt = performance.now();
  };

  /** While he rests, his eyes follow a finger / cursor near him; far to one side, he turns to it. */
  private startGaze(): void {
    if (this.gazeTimer) clearInterval(this.gazeTimer);
    this.gazeTimer = null;
    if (this.reduced) return;
    this.gazeTimer = setInterval(() => {
      if (this.lent || this.mode !== 'stand' || !(this.action === 'idle' || this.action === 'sit')) return;
      if (performance.now() - this.lastPointerAt > 1500) return;
      const head = this.headPoint();
      const dx = this.pointer.x - head.x;
      const dy = this.pointer.y - head.y;
      const d = Math.hypot(dx, dy);
      if (d > 220) return;
      this.rig.look((dx / Math.max(d, 1)) * 3, (dy / Math.max(d, 1)) * 3);
      this.rig.turn(Math.abs(dx) > 60 ? (dx > 0 ? 1 : -1) : 0);
    }, 200);
  }

  private readonly onScroll = (): void => {
    const el = this.scroller;
    if (!el || this.reduced || this.mode !== 'stand') return;
    if (this.floor.id === SCREEN) this.screenCheck();
    const now = performance.now();
    const y = isWindow(el) ? el.scrollY : el.scrollTop;
    const dt = now - this.lastScroll.t;
    const v = dt > 0 && dt < 200 ? ((y - this.lastScroll.y) / dt) * 1000 : 0;
    this.lastScroll.y = y;
    this.lastScroll.t = now;
    if (Math.abs(v) < 700 || now - this.lastScroll.wobbleAt < 1200) return;
    this.lastScroll.wobbleAt = now;
    // "hold on!": the page jerks, he leans against it, worried, ears up
    const dir = v > 0 ? 1 : -1;
    void this.flow(async (gen) => {
      this.setAction('hold on');
      this.rig.worry(true);
      this.rig.set('perk', true);
      await this.gesture([{ transform: 'translateY(0) scale(1,1)' }, { transform: `translateY(${dir * -3}px) scale(1.06,.92)` }, { transform: `translateY(${dir * 2}px) scale(.97,1.04)` }, { transform: 'translateY(0) scale(1,1)' }], 520, gen);
      this.rig.worry(false);
      this.rig.set('perk', false);
      await this.sleep(250, gen);
    });
  };

  private readonly onVisibility = (): void => {
    this.setVisible(!document.hidden);
  };

  private setOnScreen(on: boolean): void {
    if (on === this.onScreen) return;
    this.onScreen = on;
    this.setVisible(!document.hidden);
  }

  /** Being held, flying, rolling, getting up: physics that always plays to its end (and then he rests). */
  private get inPhysics(): boolean {
    return this.mode === 'held' || this.mode === 'fly' || this.mode === 'roll' || this.mode === 'getup';
  }

  /**
   * Hidden tab or scrolled off screen: his own life stops (behaviours, timers, the gaze). A hold or a throw
   * in progress plays on — it ends by itself, and a hidden tab pauses its frames anyway; afterwards he rests
   * until he is on screen again.
   */
  private setVisible(pageVisible: boolean): void {
    const v = pageVisible && this.onScreen && !this.paused;
    if (v === this.visible) return;
    this.visible = v;
    if (!v) {
      if (this.gazeTimer) clearInterval(this.gazeTimer);
      this.gazeTimer = null;
      if (this.inPhysics) return;
      if (this.rafId) cancelRaf(this.rafId);
      this.rafId = 0;
      if (this.mode === 'hop') {
        this.feet = { ...this.hopEnd };
        if (this.hopFloor) this.floor = this.hopFloor;
      }
      this.mode = 'stand';
      this.cancel();
      this.resetPose();
      this.render();
    } else if (!this.inPhysics) {
      this.startLife();
    }
  }

  private readonly onReducedChange = (): void => {
    if (this.destroyed) return;
    if (this.reduced && this.mode !== 'held') {
      if (this.mode !== 'stand') {
        const f = this.mode === 'fly' ? P.floorBelow(this.world, this.body.x, this.body.y) : this.floor;
        this.floor = f;
        this.feet = { x: P.clampToFloor(f, this.mode === 'walk' || this.mode === 'hop' ? this.feet.x : this.body.x, this.margin()), y: f.y };
        this.mode = 'stand';
      }
      this.render();
    }
    this.startLife();
  };

  private haptic(kind: BuddyHaptic): void {
    try {
      this.opts.haptics?.(kind);
    } catch {
      /* the app's wrapper must never break him */
    }
  }

  // ---------- effects (content px; transform/opacity only; every one finite and removed) ----------

  private headPoint(): Point {
    return this.worldOf({ x: this.g.scruff.x, y: this.g.scruff.y + 4 });
  }

  private spawn(html: string, cls: string, x: number, y: number, frames: Keyframe[], ms: number, delay = 0): void {
    if (this.reduced || typeof this.fx.animate !== 'function') return;
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.opacity = '0';
    this.fx.append(el);
    const a = el.animate(frames, { duration: ms, delay, easing: 'ease-out', fill: 'both' });
    a.finished.then(() => el.remove(), () => el.remove());
  }

  private star(x: number, y: number, delay: number): void {
    const t = (dx: number, dy: number, s: number, r: number) => `translate(${x - 7 + dx}px, ${y - 7 + dy}px) scale(${s}) rotate(${r}deg)`;
    this.spawn(STAR, '', x, y, [
      { transform: t(0, 4, 0.2, 0), opacity: 0 },
      { transform: t(0, 0, 1.1, 40), opacity: 1, offset: 0.35 },
      { transform: t(0, -4, 0.8, 90), opacity: 1, offset: 0.7 },
      { transform: t(0, -8, 0.3, 140), opacity: 0 },
    ], 1100, delay);
  }

  private heart(x: number, y: number, delay: number): void {
    const drift = (this.rng() - 0.5) * 18;
    this.spawn(HEART, '', x, y, [
      { transform: `translate(${x - 7}px, ${y - 6}px) scale(.3)`, opacity: 0 },
      { transform: `translate(${x - 7 + drift * 0.3}px, ${y - 18}px) scale(1.1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${x - 7 + drift}px, ${y - 46}px) scale(.8)`, opacity: 0 },
    ], 1300, delay);
  }

  private sparkle(x: number, y: number, delay = 0): void {
    this.spawn(SPARK, '', x, y, [
      { transform: `translate(${x - 9}px, ${y - 9}px) scale(.2) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${x - 9}px, ${y - 9}px) scale(1.15) rotate(45deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${x - 9}px, ${y - 9}px) scale(.4) rotate(90deg)`, opacity: 0 },
    ], 760, delay);
  }

  private bang(x: number, y: number): void {
    this.spawn('!', 'bd-bang', x, y, [
      { transform: `translate(${x - 4}px, ${y}px) scale(.3)`, opacity: 0 },
      { transform: `translate(${x - 4}px, ${y - 12}px) scale(1.25)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${x - 4}px, ${y - 12}px) scale(1)`, opacity: 1, offset: 0.75 },
      { transform: `translate(${x - 4}px, ${y - 16}px) scale(.9)`, opacity: 0 },
    ], 1100);
  }

  private zzz(): void {
    const head = this.headPoint();
    const x = head.x + 14;
    const y = head.y;
    this.spawn('z', 'bd-z', x, y, [
      { transform: `translate(${x}px, ${y}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x + 6}px, ${y - 10}px) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${x + 16}px, ${y - 30}px) scale(1.3)`, opacity: 0 },
    ], 2400);
  }

  /** "Hmpf": two little clouds puff out of his nose to the side he faces. */
  private puff(dir: number): void {
    this.hmpf(this.headPoint().x + dir * 12, this.headPoint().y + 24, dir, 1);
  }

  private hmpf(x: number, y: number, dir: number, size: number): void {
    for (let i = 0; i < 2; i++) {
      const dy = i * 7;
      this.spawn('', 'bd-hmpf', x, y, [
        { transform: `translate(${x - 6}px, ${y - 6 + dy}px) scale(${0.3 * size})`, opacity: 0 },
        { transform: `translate(${x - 6 + dir * 10}px, ${y - 7 + dy}px) scale(${0.9 * size})`, opacity: 0.95, offset: 0.35 },
        { transform: `translate(${x - 6 + dir * 26}px, ${y - 10 + dy}px) scale(${1.25 * size})`, opacity: 0 },
      ], 650, i * 90);
    }
  }

  private dust(): void {
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      const spread = 16 + this.rng() * 22;
      const x = this.feet.x + dir * (6 + this.rng() * 10);
      const y = this.feet.y - 4;
      this.spawn('', 'bd-dust', x, y, [
        { transform: `translate(${x - 3}px, ${y - 3}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${x - 3 + dir * spread * 0.5}px, ${y - 3 - 8 - this.rng() * 6}px) scale(1.1)`, opacity: 0.9, offset: 0.4 },
        { transform: `translate(${x - 3 + dir * spread}px, ${y - 3 - 4}px) scale(1.4)`, opacity: 0 },
      ], 700, i * 50);
    }
  }

  /** Three little stars circling his head while he is dizzy. */
  private dizzyStars(ms: number): void {
    const head = this.headPoint();
    for (let i = 0; i < 3; i++) {
      const frames: Keyframe[] = [];
      const turns = 1.6;
      for (let k = 0; k <= 8; k++) {
        const a = ((i / 3) + (k / 8) * turns) * 2 * Math.PI;
        const x = head.x + Math.cos(a) * 20 - 7;
        const y = head.y - 6 + Math.sin(a) * 6 - 7;
        frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(0.75 + 0.25 * Math.sin(a)).toFixed(2)})`, opacity: k === 0 || k === 8 ? 0 : 1 });
      }
      this.spawn(STAR, '', head.x, head.y, frames, ms);
    }
  }
}

function rotateAround(local: Point, origin: Point, angle: number, world: Point): Point {
  const dx = local.x - origin.x;
  const dy = local.y - origin.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: world.x + dx * c - dy * s, y: world.y + dx * s + dy * c };
}
