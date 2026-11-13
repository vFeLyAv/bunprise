/**
 * Props and stage plumbing of Felix's new moves (2026-10-20, "все эти идеи создавай"): the celery stalk of
 * the chase, the carrot of the overfed bunny, the letter and the tiny calendar card of the carry, crumbs —
 * all inline SVG (no images, no network) — and `MoveStage`, the small base the new stages share.
 *
 * MoveStage follows the CarryStage pattern: it attaches to a host element (its own Shadow DOM), authors ONE
 * timeline (timeline.ts: every animated part is a Track compiled to Web Animations, no requestAnimationFrame,
 * no timers while animating), play() runs it, seek(t) freezes an exact frame (tests, frame review), skip()
 * jumps to the calm end, stop() leaves at once (a 160 ms fade, then empty), destroy() / dispose() removes
 * every animation and node. It pauses while the page is hidden or the host is off-screen (IdleScheduler) and
 * continues from the same frame. Only transform and opacity are animated. Under reduced motion a stage
 * builds its calm alternative (a still pose that fades in) or nothing.
 */

import { IdleScheduler, ReducedMotion } from './core';
import { cardOutline } from './welcome';
import type { StageGeo, Vec } from './welcome-actors';
import { Playhead, type Sampled, type StyleOut } from './timeline';
import type { ReducedMotionMode, StageEdge } from './types';

// ---------- props (inline SVG) ----------

/** The props of the new moves. */
export type PropKind = 'celery' | 'carrot' | 'letter' | 'calendar' | 'crumb' | 'carrot-crumb' | 'celery-bit';

/** Size of each prop's viewBox (its own units); the stages scale them to px. */
export const PROP_BOX: Readonly<Record<PropKind, { w: number; h: number }>> = {
  celery: { w: 96, h: 30 },
  carrot: { w: 84, h: 30 },
  letter: { w: 44, h: 30 },
  calendar: { w: 40, h: 38 },
  crumb: { w: 8, h: 7 },
  'carrot-crumb': { w: 6, h: 6 },
  'celery-bit': { w: 30, h: 14 },
};

/** The apricot accent of the app (--accent-ui): the letter's heart seal, the calendar band. */
export const PROP_ACCENT = '#F0A04B';

let propSeq = 0;

/**
 * The inner SVG of a prop (with its own viewBox, aria-hidden). `tint` colours the letter's seal and the
 * calendar's band (default the apricot accent), the crumb's fill (default warm cream).
 */
export function propMarkup(kind: PropKind, tint?: string): string {
  const { w, h } = PROP_BOX[kind];
  const id = `bp-prop-${++propSeq}`;
  const svg = (inner: string) => `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">${inner}</svg>`;
  switch (kind) {
    case 'celery':
      // a pale green stalk lying on its side: three leaves at the right end, the cut end at the left, two light ridges
      return svg(`
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D6EFB8"/><stop offset=".55" stop-color="#ABD78A"/><stop offset="1" stop-color="#86BE63"/></linearGradient></defs>
        <path d="M66 15 C71 5 81 1.5 88 5.5 C84 8 80 11 74 14.5 Z" fill="#6CB84C"/>
        <path d="M66 16.2 C76 12 88 13.6 95 19.6 C86 21.2 78 20.2 69 18 Z" fill="#5EA944"/>
        <path d="M66 17.4 C72 24.4 80 28.6 86.5 27.4 C80.5 23.4 74.5 20.4 68 18.2 Z" fill="#7AC458"/>
        <path d="M6 10.6 C20 8.8 50 8.8 70 10.8 C73.6 11.6 73.6 21.4 70 22.2 C50 24.2 20 24.2 6 22.4 C2.6 21.6 2.6 11.4 6 10.6 Z" fill="url(#${id})" stroke="rgba(70,110,40,.38)" stroke-width="1"/>
        <path d="M9 14.4 C27 13.4 50 13.4 67.5 14.4 M9 18.8 C27 19.5 50 19.5 67.5 18.8" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.2" stroke-linecap="round"/>
        <ellipse cx="5.6" cy="16.5" rx="2.7" ry="5.6" fill="#EAF7DC" stroke="rgba(70,110,40,.38)" stroke-width=".8"/>`);
    case 'carrot':
      // a carrot: the thick end with its leaves at the left, the tip at the right, a few ring lines
      return svg(`
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB45C"/><stop offset=".6" stop-color="#F28A34"/><stop offset="1" stop-color="#DE7027"/></linearGradient></defs>
        <path d="M18 13.6 C11 5.6 5 3.4 1.6 5.4 C5.6 8.6 10 11.8 16 15 Z" fill="#6DBE4B"/>
        <path d="M18 15.4 C10 13.8 3.6 14.8 .6 16.8 C5.6 18 10.6 17.6 16.6 16.6 Z" fill="#5FAE45"/>
        <path d="M18 17.2 C12 23.2 6.6 26.2 3.4 25.2 C7.4 22.2 11.4 19.6 16.4 17 Z" fill="#7AC75A"/>
        <path d="M18 8.6 C40 7.6 62 11.6 81 15.4 C62 19.2 40 23.4 18 22.4 C12.6 21.4 12 9.8 18 8.6 Z" fill="url(#${id})" stroke="rgba(160,80,20,.38)" stroke-width="1"/>
        <path d="M30 11.4 l3 2.2 M43 19.6 l3 -2 M55 13 l3 1.7 M66 17.8 l2.6 -1.3" fill="none" stroke="rgba(150,70,15,.42)" stroke-width="1.15" stroke-linecap="round"/>
        <path d="M22 11.4 C34 10.6 48 11.6 60 13.4" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.1" stroke-linecap="round"/>`);
    case 'letter':
      // a cream envelope with a heart seal in the accent colour (the invite link "like a letter into the chat")
      return svg(`
        <rect x="1" y="1" width="42" height="28" rx="4" fill="#FFF7EC" stroke="rgba(150,90,40,.4)" stroke-width="1.1"/>
        <path d="M2.6 27.4 L16.4 15.6 M41.4 27.4 L27.6 15.6" fill="none" stroke="rgba(150,90,40,.22)" stroke-width="1"/>
        <path d="M2.6 3 L22 17.2 L41.4 3" fill="none" stroke="rgba(150,90,40,.4)" stroke-width="1.1" stroke-linejoin="round"/>
        <path d="M22 23.2 C17 19.8 15.4 17.2 17.4 15.2 C18.9 13.8 21 14.3 22 15.9 C23 14.3 25.1 13.8 26.6 15.2 C28.6 17.2 27 19.8 22 23.2 Z" fill="${tint ?? PROP_ACCENT}" stroke="rgba(150,80,30,.3)" stroke-width=".8"/>`);
    case 'calendar':
      // a tiny calendar page: a coloured band with two rings, a grid of days, one of them marked
      return svg(`
        <rect x="1" y="4" width="38" height="33" rx="5.5" fill="#FFFDF8" stroke="rgba(150,90,40,.38)" stroke-width="1.1"/>
        <path d="M1 9.5 A5.5 5.5 0 0 1 6.5 4 H33.5 A5.5 5.5 0 0 1 39 9.5 V14 H1 Z" fill="${tint ?? PROP_ACCENT}"/>
        <rect x="10" y=".8" width="3.4" height="7.4" rx="1.7" fill="#9A6A42"/><rect x="26.6" y=".8" width="3.4" height="7.4" rx="1.7" fill="#9A6A42"/>
        <g fill="rgba(120,80,45,.32)"><circle cx="9" cy="20.5" r="1.9"/><circle cx="16.3" cy="20.5" r="1.9"/><circle cx="23.7" cy="20.5" r="1.9"/><circle cx="31" cy="20.5" r="1.9"/><circle cx="9" cy="28" r="1.9"/><circle cx="16.3" cy="28" r="1.9"/><circle cx="31" cy="28" r="1.9"/></g>
        <circle cx="23.7" cy="28" r="4" fill="${tint ?? PROP_ACCENT}"/><path d="M23.7 30.2 C21.6 28.8 21 27.8 21.8 27 C22.4 26.4 23.3 26.7 23.7 27.3 C24.1 26.7 25 26.4 25.6 27 C26.4 27.8 25.8 28.8 23.7 30.2 Z" fill="#FFFDF8"/>`);
    case 'crumb':
      // a bitten-off crumb of a card: warm cream with a soft rim (or the given tint)
      return svg(`<path d="M1.4 2.6 L4.4 .8 L7.2 2.4 L6.6 5.6 L3 6.4 L.8 4.8 Z" fill="${tint ?? '#FFF6E8'}" stroke="rgba(150,95,45,.45)" stroke-width=".8" stroke-linejoin="round"/>`);
    case 'carrot-crumb':
      return svg(`<path d="M1 2.4 L3.4 .6 L5.4 2.2 L4.8 5 L1.8 5.4 Z" fill="#F28A34" stroke="rgba(160,80,20,.4)" stroke-width=".6" stroke-linejoin="round"/>`);
    case 'celery-bit':
    default:
      // what is left of the celery in his mouth: a short stub with one leaf
      return svg(`
        <path d="M17 6.4 C21 1.8 26 .8 29 2.6 C26 4.2 22.6 5.8 19 7.4 Z" fill="#6CB84C"/>
        <path d="M2.4 4.4 C8 3.6 14 3.6 19.6 4.4 C21 4.8 21 9.6 19.6 10 C14 10.8 8 10.8 2.4 10 C1 9.6 1 4.8 2.4 4.4 Z" fill="#ABD78A" stroke="rgba(70,110,40,.4)" stroke-width=".8"/>
        <path d="M3.6 6.8 C9 6.4 14 6.4 18.6 6.8" fill="none" stroke="rgba(255,255,255,.6)" stroke-width=".9" stroke-linecap="round"/>`);
  }
}

/** A prop as three nested boxes (frame: travel > spin: rotation about `pivot` > body: squash), sized in px. */
export interface MountedProp {
  frame: HTMLDivElement;
  spin: HTMLDivElement;
  body: HTMLDivElement;
  /** px size */
  w: number;
  h: number;
}

/**
 * Mounts a prop `width` px wide. `pivot` (0..1 of its box, default the centre) is where it spins and squashes
 * (the celery tumbles about its middle, the letter swings about the edge held in the mouth).
 */
export function mountProp(parent: HTMLElement, kind: PropKind, width: number, opts: { tint?: string; pivot?: Vec; cls?: string } = {}): MountedProp {
  const { w: vw, h: vh } = PROP_BOX[kind];
  const w = width;
  const h = (width * vh) / vw;
  const frame = document.createElement('div');
  frame.className = `prop prop-${kind}${opts.cls ? ` ${opts.cls}` : ''}`;
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  const spin = document.createElement('div');
  const body = document.createElement('div');
  const p = opts.pivot ?? { x: 0.5, y: 0.5 };
  spin.style.transformOrigin = `${p.x * 100}% ${p.y * 100}%`;
  body.style.transformOrigin = `${p.x * 100}% ${p.y * 100}%`;
  body.innerHTML = propMarkup(kind, opts.tint);
  spin.append(body);
  frame.append(spin);
  parent.append(frame);
  return { frame, spin, body, w, h };
}

// ---------- geometry helpers ----------

/** Point on the quadratic Bézier P0 → C → P1 at s. */
export function bez(p0: Vec, c: Vec, p1: Vec, s: number): Vec {
  const a = (1 - s) * (1 - s);
  const b = 2 * (1 - s) * s;
  const d = s * s;
  return { x: a * p0.x + b * c.x + d * p1.x, y: a * p0.y + b * c.y + d * p1.y };
}

/** A box in a layer's own CSS px. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A target (element or rect) as a box relative to `layer` (viewport px → the layer's own px; zoomed dev frames too). */
export function boxIn(layer: HTMLElement, target: Element | Box): Box {
  const r = typeof Element !== 'undefined' && target instanceof Element ? target.getBoundingClientRect() : (target as Box);
  const l = layer.getBoundingClientRect();
  const scale = layer.offsetWidth > 0 && l.width > 0 ? l.width / layer.offsetWidth : 1;
  return { left: (r.left - l.left) / scale, top: (r.top - l.top) / scale, width: r.width / scale, height: r.height / scale };
}

/**
 * The edge clip and the paw layer of a peeking bunny (the same layering as WelcomeStage: the edge clip <
 * paws on the edge < runners): the host minus the inset strips; with a corner radius it follows the card's
 * rounded corners (cardOutline).
 */
export function peekLayers(parent: HTMLElement, geo: StageGeo): { clip: HTMLDivElement; clipOrigin: Vec; paws: HTMLDivElement; runners: HTMLDivElement } {
  const { top, right, bottom, left } = geo.inset;
  const rT = top > 0 ? Math.min(geo.radius?.top ?? 0, geo.W / 2) : 0;
  const rB = bottom > 0 ? Math.min(geo.radius?.bottom ?? 0, geo.W / 2) : 0;
  const boxTop = rT > 0 ? 0 : top;
  const boxBottom = rB > 0 ? 0 : bottom;
  const clip = document.createElement('div');
  clip.className = 'clip';
  clip.style.inset = `${boxTop}px ${right}px ${boxBottom}px ${left}px`;
  if (rT > 0 || rB > 0) clip.style.setProperty('clip-path', `path('${cardOutline(geo, boxTop, rT, rB)}')`);
  const paws = document.createElement('div');
  paws.className = 'layer paws';
  const runners = document.createElement('div');
  runners.className = 'layer runners';
  parent.append(clip, paws, runners);
  return { clip, clipOrigin: { x: left, y: boxTop }, paws, runners };
}

/** Insets as a full record (numbers > 0 only). */
export function insetOf(v: number | Partial<Record<StageEdge, number>> | undefined): Record<StageEdge, number> {
  const c = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  if (typeof v === 'number') return { bottom: c(v), left: c(v), right: c(v), top: c(v) };
  return { bottom: c(v?.bottom), left: c(v?.left), right: c(v?.right), top: c(v?.top) };
}

// ---------- MoveStage: the plumbing the new stages share ----------

/** Options every new move takes. */
export interface MoveOptions {
  /** 'force' = the calm alternative (or nothing), 'off' = never reduce, 'auto' (default) = the OS setting. */
  reducedMotion?: ReducedMotionMode;
  /** Called once when the show is over (also after skip / stop; not after destroy, not for loop repeats). */
  onEnd?: () => void;
}

/** What a stage hands to MoveStage after authoring. */
export interface MoveShow {
  /** every animated part */
  tracks: Sampled[];
  /** seconds: the show is over */
  duration: number;
  /** loop mode: seconds per cycle (≥ duration); the show restarts after it */
  period?: number;
  /** extra animations made elsewhere (e.g. the bite mark on the target), with their end (ms) */
  extra?: ReadonlyArray<{ animation: Animation; end: number }>;
  /** the calm alternative: no animations, the tracks' values at `staticAt` are written inline and fade in */
  isStatic?: boolean;
  staticAt?: number;
  /** nothing to show at all (decorations under reduced motion) */
  empty?: boolean;
}

interface Built {
  playhead: Playhead;
  tracks: Sampled[];
  duration: number;
  period: number;
  loop: boolean;
  endClock: Animation | null;
  loopClock: Animation | null;
  isStatic: boolean;
  empty: boolean;
}

type Mode = 'idle' | 'playing' | 'paused';

/** Reduced-motion fade-in of a still pose, ms (= .rm-in). */
export const MOVE_FADE_MS = 450;
/** stop(): the stage fades out this fast, ms. */
export const MOVE_STOP_MS = 160;

const BASE_CSS = `
.layer { position: absolute; inset: 0; }
.frame, .prop { position: absolute; left: 0; top: 0; }
.lift, .calm, .actor { position: absolute; inset: 0; }
.prop > div, .prop > div > div { position: absolute; inset: 0; }
.prop svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; overflow: visible; }
.clip { position: absolute; overflow: hidden; }
.grip-svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; overflow: visible; }
.grip { transform-box: view-box; transform-origin: 0 0; }
.clip .grip-sh { display: none; }
.ground { position: absolute; border-radius: 50%; background: var(--mascot-shadow, rgba(70,40,15,.12)); }
.stage.rm-hidden { opacity: 0; }
.stage.rm-in { animation: bp-move-in .45s ease-out both; }
@keyframes bp-move-in { from { opacity: 0; } to { opacity: 1; } }
`;

export abstract class MoveStage {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** Resolves when the show is over: the natural end, skip(), stop() or destroy(). */
  readonly done: Promise<void>;

  /** The stage element inside the shadow root (aria-hidden; everything is mounted in it). */
  protected readonly stage: HTMLDivElement;
  protected readonly reduced: ReducedMotion;
  protected built: Built | null = null;

  private readonly watch: IdleScheduler;
  private readonly onEnd: (() => void) | undefined;
  private resolveDone!: () => void;
  private destroyed = false;
  private endFired = false;
  private mode: Mode = 'idle';
  private held = 0;
  private parked = false;
  private gen = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping: Animation | null = null;

  protected constructor(host: HTMLElement, options: MoveOptions, hostCss: string, css = '') {
    this.host = host;
    this.onEnd = options.onEnd;
    this.done = new Promise((r) => {
      this.resolveDone = r;
    });
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${hostCss}${BASE_CSS}${css}</style><div class="stage layer" aria-hidden="true"></div>`;
    const stage = this.root.querySelector<HTMLDivElement>('.stage');
    if (!stage) throw new Error('[moves] stage failed to mount');
    this.stage = stage;
    this.reduced = new ReducedMotion(options.reducedMotion ?? 'auto');
    this.reduced.subscribe(() => this.onReducedChange());
    this.watch = new IdleScheduler(
      () => true,
      (active) => this.onActive(active),
    );
    this.watch.observe(host);
  }

  /** Author the show (subclass): mount into `this.stage`, return the tracks. Called by setup() and on a rebuild. */
  protected abstract author(isStatic: boolean): MoveShow;

  /** Subclasses call this at the end of their constructor (their own fields exist by then). */
  protected setup(): void {
    this.build();
  }

  // ---------- state ----------

  /** Seconds until the show is over. */
  get duration(): number {
    return this.built?.duration ?? 0;
  }

  /** Current time in seconds (within the loop cycle in loop mode). */
  get time(): number {
    const b = this.built;
    const clock = b?.loop ? b.loopClock : b?.endClock;
    if (this.mode === 'playing' && !this.parked && clock) {
      const ct = clock.currentTime;
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

  /** Mid-show: the app's one-mascot-at-a-time arbiter asks this. */
  get busy(): boolean {
    return !this.destroyed && this.mode === 'playing' && !this.endFired;
  }

  /** The show reached its end (or was skipped / stopped). */
  get ended(): boolean {
    return this.endFired;
  }

  /** The calm alternative (reduced motion): no animations at all. */
  get reducedMotion(): boolean {
    return this.reduced.matches;
  }

  /** Nothing to show (a decoration under reduced motion). */
  get empty(): boolean {
    return this.built?.empty ?? true;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The Web Animations of the show (read-only; tests and frame tools). */
  get animations(): readonly Animation[] {
    return this.built?.playhead.animations ?? [];
  }

  // ---------- controls ----------

  /** Plays from the current time (from the start when idle or over). */
  play(): void {
    const b = this.built;
    if (this.destroyed || !b || this.mode === 'playing') return;
    this.cancelStop();
    this.stage.classList.remove('rm-hidden');
    if (b.empty) {
      this.mode = 'playing';
      this.fireEnd();
      return;
    }
    if (b.isStatic) {
      this.mode = 'playing';
      this.stage.classList.remove('rm-hidden', 'rm-in');
      this.stage.classList.add('rm-in');
      this.clearTimer();
      if (!this.endFired) this.timer = setTimeout(() => this.fireEnd(), MOVE_FADE_MS);
      return;
    }
    let from = this.mode === 'idle' ? 0 : this.held;
    if (from >= b.duration && !b.loop) from = 0;
    if (from === 0) this.endFired = false;
    this.start(from);
  }

  /** Freezes the current frame. */
  pause(): void {
    if (this.destroyed || this.mode !== 'playing') return;
    this.held = this.time;
    this.gen += 1;
    this.mode = 'paused';
    this.parked = false;
    this.watch.stop();
    this.built?.playhead.pause();
  }

  /** Freezes the show at `seconds` (deterministic: every animation gets the same currentTime). */
  seek(seconds: number): void {
    const b = this.built;
    if (this.destroyed || !b) return;
    this.cancelStop();
    const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.gen += 1;
    this.mode = 'paused';
    this.parked = false;
    this.held = t;
    this.watch.stop();
    this.clearTimer();
    this.stage.classList.remove('rm-hidden');
    if (b.isStatic || b.empty) {
      this.stage.classList.remove('rm-hidden', 'rm-in');
      return;
    }
    b.playhead.seek((b.loop ? t % b.period : t) * 1000);
  }

  /** Jumps to the calm end at once (a tap, a hidden page). */
  skip(): void {
    const b = this.built;
    if (this.destroyed || !b) return;
    this.seek(b.duration);
    this.fireEnd();
  }

  /**
   * Leaves at once (the loading finished, the screen changes): the whole stage fades out in 160 ms (never
   * a pop), then it is empty and `done` resolves. `fade: false` = empty right away.
   */
  stop(fade = true): void {
    const b = this.built;
    if (this.destroyed || !b) return;
    this.gen += 1;
    this.watch.stop();
    this.clearTimer();
    const empty = () => {
      this.stopping = null;
      this.mode = 'idle';
      this.held = 0;
      this.parked = false;
      if (!this.destroyed && this.built === b) {
        b.playhead.seek(0);
        // Not every scene starts off-screen (Overfed already has a full body).
        // Rewinding alone would make it pop back as the fade animation is removed.
        this.stage.classList.remove('rm-in');
        this.stage.classList.add('rm-hidden');
      }
      this.fireEnd();
    };
    const el = this.stage as HTMLElement & { animate?: HTMLElement['animate'] };
    if (!fade || typeof el.animate !== 'function' || this.mode === 'idle') {
      b.playhead.pause();
      empty();
      return;
    }
    b.playhead.pause();
    this.cancelStop();
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOVE_STOP_MS, easing: 'ease-in', fill: 'forwards' });
    this.stopping = a;
    a.finished.then(
      () => {
        if (this.stopping !== a) return;
        empty();
        a.cancel();
      },
      () => undefined,
    );
  }

  /** Styles of every animated part at `seconds` (from the same keys as the animations; tests). */
  sample(seconds?: number): Record<string, StyleOut> {
    const out: Record<string, StyleOut> = {};
    const b = this.built;
    if (!b) return out;
    const t = seconds ?? this.time;
    for (const s of b.tracks) {
      const v = s.styleAt(b.loop ? t % b.period : t);
      if (v && (v.transform !== undefined || v.opacity !== undefined)) out[s.name] = { ...v };
    }
    return out;
  }

  setReducedMotion(mode: ReducedMotionMode): void {
    this.reduced.setMode(mode);
  }

  /** Removes everything: animations, observers, timers, the shadow content. Resolves `done`. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen += 1;
    this.clearTimer();
    this.cancelStop();
    this.watch.destroy();
    this.reduced.destroy();
    this.teardown();
    this.root.innerHTML = '';
    this.resolveDone();
  }

  /** = destroy(). */
  dispose(): void {
    this.destroy();
  }

  // ---------- internals ----------

  /** Reduced motion switched on or off mid-show: rebuild; a running show continues at its calm end. */
  protected onReducedChange(): void {
    if (this.destroyed) return;
    const wasPlaying = this.mode !== 'idle';
    this.gen += 1;
    this.clearTimer();
    this.teardown();
    this.build();
    if (wasPlaying) this.skip();
  }

  /** Removes what the subclass mounted outside `this.stage` (override; called on teardown). */
  protected cleanup(): void {}

  private build(): void {
    const isStatic = this.reduced.matches || typeof (this.stage as HTMLElement & { animate?: unknown }).animate !== 'function';
    this.stage.textContent = '';
    this.stage.classList.toggle('rm', isStatic);
    this.stage.classList.remove('rm-in');
    const show = this.author(isStatic);
    const playhead = new Playhead();
    const loop = !show.empty && !show.isStatic && (show.period ?? 0) > show.duration;
    const period = loop ? (show.period ?? show.duration) : show.duration;
    let endClock: Animation | null = null;
    let loopClock: Animation | null = null;
    if (show.empty) {
      this.stage.textContent = '';
    } else if (show.isStatic) {
      const at = show.staticAt ?? show.duration;
      for (const s of show.tracks) {
        const v = s.styleAt(at);
        for (const el of s.els) applyStyle(el, v);
      }
      this.stage.classList.add('rm-hidden');
    } else {
      for (const s of show.tracks) {
        const base = s.baseStyle();
        for (const el of s.els) applyStyle(el, base);
        for (const c of s.compile()) playhead.add(c, s.name);
      }
      for (const x of show.extra ?? []) playhead.adopt(x.animation, x.end);
      endClock = this.clock(playhead, show.duration);
      if (loop) loopClock = this.clock(playhead, period);
    }
    this.built = { playhead, tracks: show.tracks, duration: show.duration, period, loop, endClock, loopClock, isStatic: Boolean(show.isStatic), empty: Boolean(show.empty) };
  }

  private teardown(): void {
    const b = this.built;
    if (!b) return;
    b.playhead.cancel();
    this.cleanup();
    this.stage.textContent = '';
    this.built = null;
  }

  private clock(playhead: Playhead, seconds: number): Animation | null {
    const el = this.stage as HTMLElement & { animate?: HTMLElement['animate'] };
    if (typeof el.animate !== 'function') return null;
    return playhead.adopt(el.animate([], { duration: seconds * 1000 }), seconds * 1000);
  }

  private start(from: number): void {
    this.mode = 'playing';
    this.parked = false;
    this.held = from;
    this.watch.start();
    if (this.watch.active) this.run(from);
    else this.parked = true;
  }

  private run(from: number): void {
    const b = this.built;
    if (!b) return;
    b.playhead.playFrom(from * 1000);
    const gen = ++this.gen;
    if (!b.loop && b.endClock && from < b.duration) {
      b.endClock.finished.then(
        () => {
          if (gen === this.gen && this.mode === 'playing') this.fireEnd();
        },
        () => undefined,
      );
    }
    if (b.loop && b.loopClock) {
      b.loopClock.finished.then(
        () => {
          if (gen === this.gen && this.mode === 'playing' && !this.parked) this.run(0);
        },
        () => undefined,
      );
    }
  }

  private onActive(active: boolean): void {
    const b = this.built;
    if (this.destroyed || this.mode !== 'playing' || !b || b.isStatic || b.empty) return;
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

  private fireEnd(): void {
    if (this.endFired || this.destroyed) return;
    this.endFired = true;
    this.onEnd?.();
    this.host.dispatchEvent(new CustomEvent('move-end', { bubbles: true, composed: true }));
    this.resolveDone();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelStop(): void {
    if (!this.stopping) return;
    const a = this.stopping;
    this.stopping = null;
    a.cancel();
  }
}

function applyStyle(el: Element, s: StyleOut | null): void {
  if (!s) return;
  const st = (el as HTMLElement).style;
  if (s.transform !== undefined) st.transform = s.transform;
  if (s.opacity !== undefined) st.opacity = s.opacity;
}
