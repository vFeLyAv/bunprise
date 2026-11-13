/**
 * Flummi v2 — motion (31.10, GALLERY-ONLY). Snappy cartoon timing: anticipation → action (squash & stretch) →
 * overshoot → settle. Never wobbly: every swing has at most one overshoot and comes to rest.
 *
 * Every moment is ONE timeline (src/timeline.ts Track → Web Animations): only transform and opacity, finite, no
 * timers, no requestAnimationFrame; seek(t) gives the same frame every time. The idle cycle is a finite 6.4 s
 * timeline that starts again from its `finished` promise while the stage is on screen and the tab is visible.
 * Reduced motion: no animate() at all — each moment is written as a still at its key pose.
 */

import { Playhead, Track, type ChannelInput, type StyleOut } from '../../../src/timeline';
import { FLUMMI_CSS, flummiMarkup, type StyleId, type ViewId, VIEW_IDS } from './art';

export type MomentId = 'idle' | 'binky' | 'hop' | 'laugh' | 'curious';
export const MOMENT_IDS: readonly MomentId[] = ['idle', 'binky', 'hop', 'laugh', 'curious'];

/** Seconds per moment. */
export const DURATION: Readonly<Record<MomentId, number>> = { idle: 6.4, binky: 1.6, hop: 2.75, laugh: 1.6, curious: 2.0 };
/** The view each moment is made for. */
export const NATIVE_VIEW: Readonly<Record<MomentId, ViewId>> = { idle: 'q', binky: 'side', hop: 'side', laugh: 'front', curious: 'q' };
/** The key pose (s) written as a still under reduced motion. */
export const KEY_POSE: Readonly<Record<MomentId, number>> = { idle: 0, binky: 0.48, hop: 0.27, laugh: 0.5, curious: 0.9 };
/** Beats of the binky (s). */
export const BINKY_BEATS = { crouch: 0.18, push: 0.27, loaf: 0.48, kick: 0.64, land: 0.92, bounce: 1.06, rest: 1.4 } as const;

/** Easings: fast start/soft end, accelerating fall, snappy, overshooting spring. */
const OUT = 'cubic-bezier(.2,.7,.3,1)';
const IN = 'cubic-bezier(.5,0,.8,.5)';
const IO = 'ease-in-out';
const SNAP = 'cubic-bezier(.3,0,.15,1)';
const LIN = 'linear';

// ---- parts --------------------------------------------------------------------------------------------------------

export interface Parts {
  move: Element;
  hop: Element;
  squash: Element;
  tilt: Element;
  sh: Element;
  /** per view: the art group and its floor shadow */
  views: Partial<Record<ViewId, { art: Element; shadow: Element }>>;
}

export interface ViewParts {
  body: Element;
  head: Element;
  earL: Element;
  earR: Element;
  lids: Element[];
  lidlos: Element[];
  pupils: Element[];
  open: Element[];
  happy: Element[];
  browL: Element;
  browR: Element | null;
  nose: Element;
  mouth: Element;
  mRest: Element;
  mOpen: Element;
  mO: Element;
  blush: Element[];
  pawL: Element;
  pawR: Element;
  footL: Element | null;
  footR: Element | null;
  tail: Element | null;
  legNear: Element | null;
  legFar: Element | null;
  footNear: Element | null;
  footFar: Element | null;
  soleNear: Element | null;
  soleFar: Element | null;
}

function need(root: Element, sel: string): Element {
  const e = root.querySelector(sel);
  if (!e) throw new Error(`[flummi] missing ${sel}`);
  return e;
}
const opt = (root: Element, sel: string): Element | null => root.querySelector(sel);
const all = (root: Element, sel: string): Element[] => Array.from(root.querySelectorAll(sel));

export function stageParts(svg: Element): Parts {
  const views: Parts['views'] = {};
  for (const v of VIEW_IDS) {
    const art = svg.querySelector(`.vw-${v}`);
    const shadow = svg.querySelector(`.shv-${v}`);
    if (art && shadow) views[v] = { art, shadow };
  }
  return { move: need(svg, '.move'), hop: need(svg, '.hop'), squash: need(svg, '.squash'), tilt: need(svg, '.tilt'), sh: need(svg, '.sh'), views };
}

export function viewParts(svg: Element, v: ViewId): ViewParts {
  const r = need(svg, `.vw-${v}`);
  return {
    body: need(r, '.body'),
    head: need(r, '.head'),
    earL: need(r, '.ear-l'),
    earR: need(r, '.ear-r'),
    lids: all(r, '.lid'),
    lidlos: all(r, '.lidlo'),
    pupils: all(r, '.pupil'),
    open: all(r, '.eo'),
    happy: all(r, '.eh'),
    browL: need(r, '.brow-l'),
    browR: opt(r, '.brow-r'),
    nose: need(r, '.nose'),
    mouth: need(r, '.mouth'),
    mRest: need(r, '.m-rest'),
    mOpen: need(r, '.m-open'),
    mO: need(r, '.m-o'),
    blush: all(r, '.blush'),
    pawL: need(r, '.paw-l'),
    pawR: need(r, '.paw-r'),
    footL: opt(r, '.foot-l'),
    footR: opt(r, '.foot-r'),
    tail: opt(r, '.tail'),
    legNear: opt(r, '.leg-near'),
    legFar: opt(r, '.leg-far'),
    footNear: opt(r, '.leg-near-foot'),
    footFar: opt(r, '.leg-far-foot'),
    soleNear: opt(r, '.leg-near .sole'),
    soleFar: opt(r, '.leg-far .sole'),
  };
}

// ---- authoring helpers --------------------------------------------------------------------------------------------

/** One track with "arrive at t" keys: to(t, v, e) moves from the previous key to v, arriving at t. */
class K {
  readonly t: Track;
  private last = 0;
  constructor(el: Element | readonly Element[], name: string, base: ChannelInput) {
    this.t = new Track(el, name, base);
  }
  /** hold until `from`, then move to `v`, arriving at `at` */
  to(at: number, v: ChannelInput, e = IO, from?: number): this {
    const start = Math.max(this.last, from ?? this.last);
    this.t.move(start, at, v, e);
    this.last = at;
    return this;
  }
  /** a switch (while nobody can see the jump, or a cartoon "pop" of an eye / mouth shape) */
  set(at: number, v: ChannelInput): this {
    this.t.set(at, v);
    this.last = at;
    return this;
  }
}

class Author {
  readonly ks: K[] = [];
  k(el: Element | readonly Element[] | null, name: string, base: ChannelInput): K {
    const k = new K(el ?? [], name, base);
    if (el && (!Array.isArray(el) || el.length)) this.ks.push(k);
    return k;
  }
  get tracks(): Track[] {
    return this.ks.map((k) => k.t);
  }
}

/** Opacity switches between the views (art + floor shadow together) at the given times. */
function viewSwitches(A: Author, P: Parts, start: ViewId, steps: ReadonlyArray<readonly [number, ViewId]>): void {
  for (const v of VIEW_IDS) {
    const vp = P.views[v];
    if (!vp) continue;
    const k = A.k([vp.art, vp.shadow], `view.${v}`, { o: v === start ? 1 : 0 });
    let cur = start;
    for (const [t, to] of steps) {
      if (to === cur) continue;
      if (v === to) k.set(t, { o: 1 });
      else if (v === cur) k.set(t, { o: 0 });
      cur = to;
    }
  }
}

/** Blink(s) on the lids at the given times. */
function blinks(k: K, times: readonly number[]): void {
  for (const t of times) k.to(t, { sy: 0 }, LIN, t).to(t + 0.06, { sy: 1 }, IN).to(t + 0.16, { sy: 0 }, OUT);
}

/** Nose twitches (three quick sniffs) starting at t. */
function twitch(k: K, t: number): void {
  const up = { sx: 1.12, sy: 0.82, y: 0.7 };
  const rest = { sx: 1, sy: 1, y: 0 };
  k.to(t, rest, LIN, t).to(t + 0.06, up, SNAP).to(t + 0.12, rest).to(t + 0.18, up, SNAP).to(t + 0.24, rest).to(t + 0.3, { sx: 1.08, sy: 0.88, y: 0.5 }, SNAP).to(t + 0.38, rest);
}

/** An ear flick: snap out, one overshoot back, settle. */
function flick(k: K, t: number, amp: number): void {
  k.to(t, { r: 0 }, LIN, t).to(t + 0.08, { r: amp }, SNAP).to(t + 0.2, { r: -amp * 0.4 }, IO).to(t + 0.32, { r: amp * 0.12 }, IO).to(t + 0.44, { r: 0 }, IO);
}

// ---- the moments --------------------------------------------------------------------------------------------------

/** Idle life (any view): breathing, blinks, nose twitches, an ear flick, a glance. 6.4 s, ends where it starts. */
function idle(A: Author, P: Parts, V: ViewParts, v: ViewId): void {
  const breath = A.k(V.body, 'idle.body', { sy: 1 });
  const head = A.k(V.head, 'idle.head', { y: 0 });
  for (const t0 of [0, 3.2]) {
    breath.to(t0 + 1.6, { sy: 1.022 }, IO).to(t0 + 3.2, { sy: 1 }, IO);
    head.to(t0 + 1.6, { y: -1.8 }, IO).to(t0 + 3.2, { y: 0 }, IO);
  }
  const lids = A.k(V.lids, 'idle.lids', { sy: 0 });
  blinks(lids, [1.3, 4.3, 4.52]);
  const nose = A.k(V.nose, 'idle.nose', { sx: 1, sy: 1, y: 0 });
  twitch(nose, 0.55);
  twitch(nose, 3.6);
  // the ear flicks: the near ear (outwards) and later the other one, smaller
  const side = v === 'side';
  flick(A.k(side ? V.earL : V.earR, 'idle.earA', { r: 0 }), 2.5, side ? -16 : 16);
  flick(A.k(side ? V.earR : V.earL, 'idle.earB', { r: 0 }), 5.5, side ? -9 : -10);
  // a glance forward and back, the brows lift a little with it
  const pupils = A.k(V.pupils, 'idle.pupils', { x: 0, y: 0 });
  pupils.to(3.0, { x: 0, y: 0 }, LIN, 3.0).to(3.12, { x: v === 'front' ? 2.6 : 2.2, y: -0.6 }, SNAP).to(3.9, { x: v === 'front' ? 2.6 : 2.2, y: -0.6 }, LIN).to(4.02, { x: 0, y: 0 }, SNAP);
  const brows = A.k([V.browL, ...(V.browR ? [V.browR] : [])], 'idle.brows', { y: 0 });
  brows.to(3.0, { y: 0 }, LIN, 3.0).to(3.14, { y: -1.6 }, SNAP).to(3.9, { y: -1.6 }, LIN).to(4.04, { y: 0 }, SNAP);
}

/** The binky (side profile): crouch → push → a loaf in the air → the twist + kick → land, one bounce → rest. */
function binky(A: Author, P: Parts, V: ViewParts): void {
  A.k(P.squash, 'binky.squash', { sx: 1, sy: 1 })
    .to(0.18, { sx: 1.1, sy: 0.84 }, OUT)
    .to(0.27, { sx: 0.9, sy: 1.14 }, SNAP)
    .to(0.42, { sx: 1.05, sy: 0.96 }, IO)
    .to(0.74, { sx: 1.05, sy: 0.96 }, LIN)
    .to(0.9, { sx: 0.96, sy: 1.05 }, IO)
    .to(0.97, { sx: 1.13, sy: 0.85 }, OUT)
    .to(1.1, { sx: 0.97, sy: 1.04 }, IO)
    .to(1.24, { sx: 1.03, sy: 0.98 }, IO)
    .to(1.4, { sx: 1, sy: 1 }, IO);
  A.k(P.hop, 'binky.hop', { y: 0 })
    .to(0.24, { y: 0 }, LIN)
    .to(0.54, { y: -64 }, OUT)
    .to(0.92, { y: 0 }, IN)
    .to(1.05, { y: -7 }, OUT)
    .to(1.17, { y: 0 }, IN);
  // the whole body rolls: nose up on the take-off, the rear flips up in the twist, level for the landing
  A.k(P.tilt, 'binky.tilt', { r: 0 })
    .to(0.18, { r: 3 }, OUT)
    .to(0.34, { r: -12 }, OUT)
    .to(0.5, { r: -4 }, IO)
    .to(0.64, { r: 11 }, IO)
    .to(0.82, { r: 1 }, IO)
    .to(0.93, { r: -3 }, IO)
    .to(1.06, { r: 1.2 }, IO)
    .to(1.22, { r: 0 }, IO);
  // the head counters the body: down in the crouch, whips up, flicks back in the twist, dips on the landing
  A.k(V.head, 'binky.head', { r: 0, y: 0 })
    .to(0.18, { r: 8, y: 3 }, OUT)
    .to(0.3, { r: -10, y: -2 }, SNAP)
    .to(0.5, { r: -3, y: 0 }, IO)
    .to(0.63, { r: -17, y: -1 }, OUT)
    .to(0.8, { r: 3, y: 0 }, IO)
    .to(0.97, { r: 7, y: 3.5 }, IO)
    .to(1.12, { r: -2.5, y: -1 }, IO)
    .to(1.3, { r: 0, y: 0 }, IO);
  // hind legs: gather, push back, TUCKED under the loaf (photo 1), the KICK out back (soles + pads show), under again.
  // The foot swings back by flipping about its heel (sx 1 → −1: the flat 2D way to show a leg swinging out sideways
  // and back), then a small rotation points the toes back-down (push) or back-up (kick).
  const leg = (el: Element | null, foot: Element | null, sole: Element | null, name: string, d: number, amp: number) => {
    A.k(el, `binky.${name}`, { r: 0 })
      .to(0.18, { r: -6 }, OUT)
      .to(0.27 + d, { r: 20 }, SNAP)
      .to(0.42 + d, { r: -6 }, OUT)
      .to(0.52 + d, { r: -6 }, LIN)
      .to(0.64 + d, { r: amp }, OUT)
      .to(0.82 + d, { r: -4 }, IO)
      .to(0.94, { r: 0 }, IO)
      .to(1.0, { r: -3 }, IO)
      .to(1.14, { r: 0 }, IO);
    A.k(foot, `binky.${name}Foot`, { r: 0, sx: 1 })
      .to(0.18, { r: 0, sx: 1 }, LIN)
      .to(0.27 + d, { r: -14, sx: -0.85 }, SNAP)
      .to(0.42 + d, { r: -8, sx: 1 }, OUT)
      .to(0.52 + d, { r: -8, sx: 1 }, LIN)
      .to(0.64 + d, { r: -6, sx: -0.8 }, OUT)
      .to(0.84 + d, { r: 0, sx: 1 }, IO);
    // the soles only show while the foot is swung back (push, kick) — never peeking out under the tucked loaf
    A.k(sole, `binky.${name}Sole`, { o: 0 }).set(0.22 + d, { o: 1 }).set(0.36 + d, { o: 0 }).set(0.56 + d, { o: 1 }).set(0.8 + d, { o: 0 });
  };
  leg(V.legNear, V.footNear, V.soleNear, 'legNear', 0, 14);
  leg(V.legFar, V.footFar, V.soleFar, 'legFar', 0.05, 12);
  // front paws: swing back on the push, tucked forward under the chest in the air, reach for the landing
  for (const [el, name, d] of [[V.pawL, 'pawL', 0], [V.pawR, 'pawR', 0.03]] as const) {
    A.k(el, `binky.${name}`, { r: 0 })
      .to(0.18 + d, { r: -8 }, OUT)
      .to(0.28 + d, { r: 36 }, SNAP)
      .to(0.44 + d, { r: -24 }, OUT)
      .to(0.76, { r: -24 }, LIN)
      .to(0.9, { r: 8 }, IO)
      .to(1.02, { r: 0 }, IO);
  }
  // ears (rotation about the root only): back in the crouch, trail on the push, flop on the landing, settle
  for (const [el, name, d] of [[V.earL, 'earL', 0], [V.earR, 'earR', 0.03]] as const) {
    A.k(el, `binky.${name}`, { r: 0 })
      .to(0.18 + d, { r: -14 }, OUT)
      .to(0.32 + d, { r: -26 }, SNAP)
      .to(0.5 + d, { r: 6 }, IO)
      .to(0.66 + d, { r: -16 }, IO)
      .to(0.9 + d, { r: 14 }, IO)
      .to(1.02 + d, { r: -12 }, OUT)
      .to(1.16 + d, { r: 5 }, IO)
      .to(1.36, { r: 0 }, IO);
  }
  A.k(V.tail, 'binky.tail', { s: 1 })
    .to(0.3, { s: 1 }, LIN)
    .to(0.5, { s: 1.22 }, OUT)
    .to(0.64, { s: 0.92 }, IO)
    .to(0.8, { s: 1.12 }, IO)
    .to(1.0, { s: 1 }, IO);
  A.k(P.sh, 'binky.shadow', { sx: 1, sy: 1, o: 1 })
    .to(0.18, { sx: 1.08, sy: 1.08, o: 1 }, OUT)
    .to(0.24, { sx: 1.06, sy: 1.06, o: 1 }, LIN)
    .to(0.54, { sx: 0.55, sy: 0.55, o: 0.55 }, OUT)
    .to(0.92, { sx: 1.08, sy: 1.08, o: 1 }, IN)
    .to(1.05, { sx: 0.9, sy: 0.9, o: 0.9 }, OUT)
    .to(1.17, { sx: 1.03, sy: 1.03, o: 1 }, IN)
    .to(1.3, { sx: 1, sy: 1, o: 1 }, IO);
  // face: a squint in the crouch, eyes wide open in the air (as in the photos), happy ^ ^ after the landing
  A.k(V.lids, 'binky.lids', { sy: 0 }).to(0.14, { sy: 0.32 }, OUT).to(0.26, { sy: 0 }, SNAP).to(0.95, { sy: 0 }, LIN).to(0.99, { sy: 0.4 }, OUT).to(1.42, { sy: 0.4 }, LIN).to(1.52, { sy: 0 }, OUT);
  A.k(V.open, 'binky.open', { o: 1 }).set(1.0, { o: 0 }).set(1.42, { o: 1 });
  A.k(V.happy, 'binky.happy', { o: 0 }).set(1.0, { o: 1 }).set(1.42, { o: 0 });
  A.k(V.mRest, 'binky.mRest', { o: 1 }).set(0.28, { o: 0 }).set(1.3, { o: 1 });
  A.k(V.mOpen, 'binky.mOpen', { o: 0 }).set(0.28, { o: 1 }).set(1.3, { o: 0 });
  A.k(V.mouth, 'binky.mouth', { s: 1 }).to(0.28, { s: 0.6 }, LIN).to(0.38, { s: 0.82 }, SNAP).to(1.3, { s: 0.82 }, LIN).to(1.32, { s: 1 }, LIN);
  A.k([V.browL, ...(V.browR ? [V.browR] : [])], 'binky.brows', { y: 0 }).to(0.3, { y: -3.5 }, SNAP).to(0.96, { y: -3.5 }, LIN).to(1.1, { y: 0 }, IO);
  A.k(V.blush, 'binky.blush', { o: 0.42 }).to(0.4, { o: 0.75 }, IO).to(1.3, { o: 0.75 }, LIN).to(1.5, { o: 0.42 }, IO);
}

/** Hop (side): two hops right, a snappy turnaround (via the front view), two hops left, turn back. Ends where it began. */
function hop(A: Author, P: Parts, V: ViewParts, F: ViewParts | null): void {
  const move = A.k(P.move, 'hop.move', { x: 0, sx: 1 });
  const hopY = A.k(P.hop, 'hop.hop', { y: 0 });
  const sq = A.k(P.squash, 'hop.squash', { sx: 1, sy: 1 });
  const sh = A.k(P.sh, 'hop.shadow', { sx: 1, sy: 1, o: 1 });
  const legN = A.k(V.legNear, 'hop.legNear', { r: 0 });
  const legF = A.k(V.legFar, 'hop.legFar', { r: 0 });
  const footN = A.k(V.footNear, 'hop.footNear', { r: 0, sx: 1 });
  const footF = A.k(V.footFar, 'hop.footFar', { r: 0, sx: 1 });
  const soles = A.k([V.soleNear, V.soleFar].filter((e): e is Element => !!e), 'hop.soles', { o: 0 });
  const paws = A.k([V.pawL, V.pawR], 'hop.paws', { r: 0 });
  const ears = A.k([V.earL, V.earR], 'hop.ears', { r: 0 });
  const head = A.k(V.head, 'hop.head', { r: 0 });
  const fLids = F ? A.k(F.lids, 'hop.frontLids', { sy: 0 }) : null;
  let x = 0;
  let dir = 1;
  const one = (t: number, dx: number) => {
    sq.to(t + 0.08, { sx: 1.08, sy: 0.88 }, OUT, t).to(t + 0.14, { sx: 0.92, sy: 1.1 }, SNAP).to(t + 0.26, { sx: 1.02, sy: 0.98 }, IO).to(t + 0.36, { sx: 0.97, sy: 1.04 }, IO).to(t + 0.42, { sx: 1.1, sy: 0.88 }, OUT).to(t + 0.54, { sx: 1, sy: 1 }, IO);
    hopY.to(t + 0.1, { y: 0 }, LIN, t).to(t + 0.25, { y: -26 }, OUT).to(t + 0.38, { y: 0 }, IN);
    move.to(t + 0.1, { x, sx: dir }, LIN, t).to(t + 0.38, { x: x + dx, sx: dir }, IO);
    x += dx;
    sh.to(t + 0.1, { sx: 1.04, sy: 1.04, o: 1 }, OUT, t).to(t + 0.25, { sx: 0.74, sy: 0.74, o: 0.75 }, OUT).to(t + 0.38, { sx: 1.06, sy: 1.06, o: 1 }, IN).to(t + 0.5, { sx: 1, sy: 1, o: 1 }, IO);
    legN.to(t + 0.08, { r: -5 }, OUT, t).to(t + 0.15, { r: 30 }, SNAP).to(t + 0.3, { r: 8 }, IO).to(t + 0.38, { r: -4 }, IO).to(t + 0.5, { r: 0 }, IO);
    legF.to(t + 0.1, { r: -5 }, OUT, t).to(t + 0.17, { r: 26 }, SNAP).to(t + 0.32, { r: 6 }, IO).to(t + 0.4, { r: -3 }, IO).to(t + 0.52, { r: 0 }, IO);
    footN.to(t + 0.08, { r: 0, sx: 1 }, LIN, t).to(t + 0.15, { r: -10, sx: -0.7 }, SNAP).to(t + 0.3, { r: -6, sx: 1 }, IO).to(t + 0.38, { r: 0, sx: 1 }, IO);
    footF.to(t + 0.1, { r: 0, sx: 1 }, LIN, t).to(t + 0.17, { r: -10, sx: -0.6 }, SNAP).to(t + 0.32, { r: -6, sx: 1 }, IO).to(t + 0.4, { r: 0, sx: 1 }, IO);
    soles.set(t + 0.12, { o: 1 }).set(t + 0.24, { o: 0 });
    paws.to(t + 0.1, { r: 6 }, OUT, t).to(t + 0.2, { r: -26 }, SNAP).to(t + 0.34, { r: 10 }, IO).to(t + 0.46, { r: 0 }, IO);
    ears.to(t + 0.1, { r: -8 }, OUT, t).to(t + 0.18, { r: -18 }, SNAP).to(t + 0.38, { r: 8 }, IO).to(t + 0.48, { r: -4 }, IO).to(t + 0.58, { r: 0 }, IO);
    head.to(t + 0.08, { r: 5 }, OUT, t).to(t + 0.16, { r: -6 }, SNAP).to(t + 0.38, { r: 3 }, IO).to(t + 0.5, { r: 0 }, IO);
  };
  // the turnaround: squash, the front view for a beat (a blink), the mirrored profile, a little overshoot
  const turn = (t: number) => {
    sq.to(t + 0.06, { sx: 1.07, sy: 0.92 }, OUT, t).to(t + 0.16, { sx: 0.96, sy: 1.04 }, SNAP).to(t + 0.26, { sx: 1, sy: 1 }, IO);
    hopY.to(t + 0.06, { y: 0 }, LIN, t).to(t + 0.13, { y: -6 }, OUT).to(t + 0.2, { y: 0 }, IN);
    dir = -dir;
    move.set(t + 0.15, { x, sx: dir });
    fLids?.to(t + 0.06, { sy: 0 }, LIN, t + 0.06).to(t + 0.1, { sy: 1 }, IN).to(t + 0.16, { sy: 0 }, OUT);
  };
  one(0, 34);
  turn(0.52);
  one(0.8, -34);
  one(1.3, -34);
  turn(1.82);
  one(2.1, 34);
}

/** Happy laugh (front): anticipation, eyes ^ ^, a big open mouth, three little giggle bounces, paws up, settle. */
function laugh(A: Author, P: Parts, V: ViewParts): void {
  A.k(P.squash, 'laugh.squash', { sx: 1, sy: 1 })
    .to(0.12, { sx: 1.06, sy: 0.92 }, OUT)
    .to(0.2, { sx: 0.95, sy: 1.07 }, SNAP)
    .to(0.32, { sx: 1.04, sy: 0.96 }, IO)
    .to(0.44, { sx: 0.98, sy: 1.02 }, IO)
    .to(0.56, { sx: 1.03, sy: 0.97 }, IO)
    .to(0.68, { sx: 0.99, sy: 1.01 }, IO)
    .to(0.8, { sx: 1.02, sy: 0.98 }, IO)
    .to(0.96, { sx: 1, sy: 1 }, IO)
    .to(1.2, { sx: 1, sy: 1 }, LIN)
    .to(1.3, { sx: 1.02, sy: 0.98 }, IO)
    .to(1.44, { sx: 1, sy: 1 }, IO);
  A.k(P.hop, 'laugh.hop', { y: 0 })
    .to(0.14, { y: 0 }, LIN)
    .to(0.26, { y: -11 }, OUT)
    .to(0.38, { y: 0 }, IN)
    .to(0.5, { y: -6 }, OUT)
    .to(0.62, { y: 0 }, IN)
    .to(0.74, { y: -3.5 }, OUT)
    .to(0.86, { y: 0 }, IN);
  A.k(P.sh, 'laugh.shadow', { s: 1 })
    .to(0.14, { s: 1.03 }, IO)
    .to(0.26, { s: 0.88 }, OUT)
    .to(0.38, { s: 1.02 }, IN)
    .to(0.5, { s: 0.93 }, OUT)
    .to(0.62, { s: 1 }, IN)
    .to(0.74, { s: 0.96 }, OUT)
    .to(0.86, { s: 1 }, IN);
  // the head tips back with the laugh and comes forward again with one small overshoot
  A.k(V.head, 'laugh.head', { r: 0, y: 0 })
    .to(0.12, { r: 2, y: 3 }, OUT)
    .to(0.24, { r: -5, y: -3 }, SNAP)
    .to(1.12, { r: -4, y: -2.4 }, LIN)
    .to(1.28, { r: 1.5, y: 0.6 }, IO)
    .to(1.42, { r: 0, y: 0 }, IO);
  A.k(V.lids, 'laugh.lids', { sy: 0 }).to(0.1, { sy: 0.4 }, OUT).to(0.16, { sy: 0.4 }, LIN).set(1.24, { sy: 0.45 }).to(1.4, { sy: 0 }, OUT);
  A.k(V.open, 'laugh.open', { o: 1 }).set(0.16, { o: 0 }).set(1.24, { o: 1 });
  A.k(V.happy, 'laugh.happy', { o: 0 }).set(0.16, { o: 1 }).set(1.24, { o: 0 });
  A.k(V.mRest, 'laugh.mRest', { o: 1 }).set(0.16, { o: 0 }).set(1.22, { o: 1 });
  A.k(V.mOpen, 'laugh.mOpen', { o: 0 }).set(0.16, { o: 1 }).set(1.22, { o: 0 });
  A.k(V.mouth, 'laugh.mouth', { s: 1 }).to(0.16, { s: 0.8 }, LIN).to(0.28, { s: 1.08 }, SNAP).to(0.4, { s: 1 }, IO).to(0.5, { s: 1.04 }, IO).to(0.62, { s: 1 }, IO).to(0.74, { s: 1.03 }, IO).to(0.86, { s: 1 }, IO);
  A.k([V.browL, ...(V.browR ? [V.browR] : [])], 'laugh.brows', { y: 0 }).to(0.22, { y: -4.5 }, SNAP).to(1.2, { y: -4.5 }, LIN).to(1.36, { y: 0 }, IO);
  A.k(V.blush, 'laugh.blush', { o: 0.42 }).to(0.26, { o: 0.8 }, IO).to(1.2, { o: 0.8 }, LIN).to(1.45, { o: 0.42 }, IO);
  // ears flop outwards with the first bounce, one swing back, settle (left ear out = negative)
  for (const [el, name, s] of [[V.earL, 'earL', -1], [V.earR, 'earR', 1]] as const) {
    A.k(el, `laugh.${name}`, { r: 0 })
      .to(0.12, { r: -4 * s }, OUT)
      .to(0.28, { r: 14 * s }, SNAP)
      .to(0.46, { r: -3 * s }, IO)
      .to(0.62, { r: 6 * s }, IO)
      .to(0.9, { r: 0 }, IO);
  }
  // paws come up in front of the chest (a giggle) and go down again
  for (const [el, name, s] of [[V.pawL, 'pawL', 1], [V.pawR, 'pawR', -1]] as const) {
    A.k(el, `laugh.${name}`, { x: 0, y: 0, r: 0 })
      .to(0.14, { x: 0, y: 1, r: 0 }, OUT)
      .to(0.28, { x: 4 * s, y: -13, r: -18 * s }, SNAP)
      .to(1.14, { x: 4 * s, y: -13, r: -18 * s }, LIN)
      .to(1.3, { x: 0, y: 1, r: 0 }, IO)
      .to(1.4, { x: 0, y: 0, r: 0 }, IO);
  }
}

/** Curious head tilt (3/4): a counter-tilt, the tilt with one overshoot, one ear perks, pupils widen, an "o", sniff. */
function curious(A: Author, P: Parts, V: ViewParts): void {
  A.k(V.head, 'curious.head', { r: 0, y: 0 })
    .to(0.14, { r: 4, y: 1 }, OUT)
    .to(0.36, { r: -18, y: -2 }, SNAP)
    .to(0.5, { r: -14, y: -1.6 }, IO)
    .to(1.42, { r: -14, y: -1.6 }, LIN)
    .to(1.62, { r: 2.5, y: 0.4 }, SNAP)
    .to(1.78, { r: 0, y: 0 }, IO);
  A.k(P.tilt, 'curious.lean', { r: 0 }).to(0.36, { r: -2.2 }, IO).to(1.42, { r: -2.2 }, LIN).to(1.7, { r: 0 }, IO);
  A.k(V.earL, 'curious.earL', { r: 0 }).to(0.14, { r: 3 }, OUT).to(0.36, { r: -8 }, SNAP).to(0.5, { r: -5 }, IO).to(1.42, { r: -5 }, LIN).to(1.66, { r: 0 }, IO);
  A.k(V.earR, 'curious.earR', { r: 0 })
    .to(0.14, { r: -3 }, OUT)
    .to(0.36, { r: 16 }, SNAP)
    .to(0.5, { r: 12 }, IO)
    .to(0.9, { r: 12 }, LIN)
    .to(0.98, { r: 24 }, SNAP)
    .to(1.1, { r: 10 }, IO)
    .to(1.2, { r: 12 }, IO)
    .to(1.42, { r: 12 }, LIN)
    .to(1.66, { r: 0 }, IO);
  A.k(V.pupils, 'curious.pupils', { x: 0, y: 0, s: 1 }).to(0.22, { x: 0, y: 0, s: 1 }, LIN).to(0.36, { x: 2, y: -2.4, s: 1.12 }, SNAP).to(1.42, { x: 2, y: -2.4, s: 1.12 }, LIN).to(1.58, { x: 0, y: 0, s: 1 }, IO);
  if (V.browR) A.k(V.browR, 'curious.browR', { y: 0, r: 0 }).to(0.36, { y: -4.5, r: 10 }, SNAP).to(1.42, { y: -4.5, r: 10 }, LIN).to(1.6, { y: 0, r: 0 }, IO);
  A.k(V.browL, 'curious.browL', { y: 0, r: 0 }).to(0.36, { y: -1.5, r: -4 }, SNAP).to(1.42, { y: -1.5, r: -4 }, LIN).to(1.6, { y: 0, r: 0 }, IO);
  A.k(V.mRest, 'curious.mRest', { o: 1 }).set(0.34, { o: 0 }).set(1.5, { o: 1 });
  A.k(V.mO, 'curious.mO', { o: 0 }).set(0.34, { o: 1 }).set(1.5, { o: 0 });
  const nose = A.k(V.nose, 'curious.nose', { sx: 1, sy: 1, y: 0 });
  twitch(nose, 0.6);
  twitch(nose, 1.08);
  blinks(A.k(V.lids, 'curious.lids', { sy: 0 }), [1.24]);
}

export interface Authored {
  tracks: Track[];
  duration: number;
}

/** Authors `m` on the stage `svg` currently showing view `from`; returns its tracks. */
export function authorMoment(svg: Element, m: MomentId, from: ViewId): Authored {
  const P = stageParts(svg);
  const A = new Author();
  const native = m === 'idle' ? from : NATIVE_VIEW[m];
  const V = viewParts(svg, native);
  const dur = DURATION[m];
  if (m === 'idle') idle(A, P, V, native);
  else if (m === 'binky') binky(A, P, V);
  else if (m === 'hop') hop(A, P, V, P.views.front ? viewParts(svg, 'front') : null);
  else if (m === 'laugh') laugh(A, P, V);
  else curious(A, P, V);
  // the views: the moment's own view for its whole length (a snappy switch at the start and back at the end when
  // it was started from another view); the hop's turnarounds show the front view for one beat
  const steps: Array<readonly [number, ViewId]> = [];
  if (native !== from) steps.push([0.05, native]);
  if (m === 'hop' && P.views.front) steps.push([0.58, 'front'], [0.67, native], [1.88, 'front'], [1.97, native]);
  if (native !== from) steps.push([dur - 0.05, from]);
  if (steps.length) viewSwitches(A, P, from, steps);
  return { tracks: A.tracks, duration: dur };
}

/** Writes each track's style at `t` inline (stills: reduced motion, no animate()). */
export function writeStill(tracks: readonly Track[], t: number): void {
  for (const tr of tracks) {
    const st = tr.styleAt(t);
    for (const el of tr.els) applyStyle(el, st);
  }
}

function applyStyle(el: Element, st: StyleOut): void {
  const s = (el as SVGElement).style;
  if (st.transform !== undefined) s.transform = st.transform;
  if (st.opacity !== undefined) s.opacity = st.opacity;
}

// ---- the stage ----------------------------------------------------------------------------------------------------

let seq = 0;

export interface StageOptions {
  /** stage width in px (the viewBox is 400 × 260, the same scale as Pompon / Tapsi at that size) */
  size: number;
  style?: StyleId;
  /** the views drawn (default all three) */
  views?: readonly ViewId[];
  /** the view shown at rest (default 3/4, or the first drawn) */
  view?: ViewId;
  /** reduced motion: nothing ever animates; moments are stills at their key pose */
  reduced?: boolean;
}

/**
 * One Flummi. seek(m, t) freezes a frame of a moment (strips, &t=); play(m) plays it once; startIdle() runs the idle
 * cycle (finite timelines, again from `finished` while visible); paused when the tab is hidden or off screen.
 */
export class FlummiStage {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly svg: SVGSVGElement;
  readonly reduced: boolean;
  view: ViewId;
  private playhead: Playhead | null = null;
  private clock: Animation | null = null;
  private touched: Element[] = [];
  private current: MomentId | null = null;
  /** a running timeline (play() / idle), not a frozen seek() */
  private playing = false;
  private idleOn = false;
  private visible = true;
  private onScreen = true;
  private destroyed = false;
  private runId = 0;
  private readonly io: IntersectionObserver | null = null;
  private readonly onVis = () => this.syncPause();

  constructor(host: HTMLElement, o: StageOptions) {
    this.host = host;
    const views = o.views ?? VIEW_IDS;
    this.view = o.view && views.includes(o.view) ? o.view : views.includes('q') ? 'q' : (views[0] ?? 'q');
    const osReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reduced = !!o.reduced || osReduced;
    host.style.width = `${o.size}px`;
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    seq += 1;
    const id = `flm${seq}`;
    this.root.innerHTML = `<style>${FLUMMI_CSS}</style><svg viewBox="0 0 400 260" aria-hidden="true" focusable="false">${flummiMarkup((nm) => `${id}-${nm}`, { style: o.style ?? 'a', views, shown: this.view })}</svg>`;
    const svg = this.root.querySelector('svg');
    if (!svg) throw new Error('[flummi] svg failed to mount');
    this.svg = svg;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVis);
      this.visible = document.visibilityState !== 'hidden';
    }
    if (typeof IntersectionObserver === 'function') {
      this.io = new IntersectionObserver((es) => {
        for (const e of es) this.onScreen = e.isIntersecting;
        this.syncPause();
      });
      this.io.observe(host);
    }
  }

  get busy(): boolean {
    return this.current !== null && this.current !== 'idle';
  }

  get animations(): Animation[] {
    return this.playhead?.animations ?? [];
  }

  /** Puts the stage into view `v` at rest (no animation). */
  setView(v: ViewId): void {
    this.view = v;
    const P = stageParts(this.svg);
    for (const [id, vp] of Object.entries(P.views) as Array<[ViewId, { art: Element; shadow: Element }]>) {
      for (const el of [vp.art, vp.shadow]) (el as SVGElement).style.opacity = id === v ? '1' : '0';
    }
  }

  /** Frozen frame of `m` at `t` seconds (deterministic). Reduced motion: the still at `t` without animate(). */
  seek(m: MomentId, t: number): void {
    if (this.destroyed) return;
    this.clear();
    const a = authorMoment(this.svg, m, this.view);
    const tt = Math.max(0, Math.min(a.duration, t));
    if (this.reduced || !this.canAnimate()) {
      writeStill(a.tracks, tt);
      this.touched = a.tracks.flatMap((tr) => [...tr.els]);
      return;
    }
    this.mount(a);
    this.current = m;
    this.playhead?.seek(tt * 1000);
  }

  /** The key pose of `m` as a still (reduced motion; poses grid). */
  pose(m: MomentId): void {
    if (this.destroyed) return;
    this.clear();
    const a = authorMoment(this.svg, m, this.view);
    writeStill(a.tracks, KEY_POSE[m]);
    this.touched = a.tracks.flatMap((tr) => [...tr.els]);
  }

  /** Plays `m` once from the start; resolves when it is over. Reduced motion: shows the key pose, resolves at once. */
  play(m: MomentId): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.reduced || !this.canAnimate()) {
      this.pose(m);
      return Promise.resolve();
    }
    const resumeIdle = this.idleOn;
    this.idleOn = false;
    this.clear();
    const a = authorMoment(this.svg, m, this.view);
    this.mount(a);
    this.current = m;
    this.playing = true;
    const run = ++this.runId;
    this.playhead?.playFrom(0);
    this.syncPause();
    const clock = this.clock;
    return (clock ? clock.finished.then(() => undefined, () => undefined) : Promise.resolve()).then(() => {
      if (run !== this.runId || this.destroyed) return;
      this.clear();
      if (resumeIdle) this.startIdle();
    });
  }

  /** The idle cycle: one finite timeline, started again from its end while the stage is visible. */
  startIdle(): void {
    if (this.destroyed || this.reduced || !this.canAnimate()) return;
    this.idleOn = true;
    if (this.busy) return;
    this.clear();
    const a = authorMoment(this.svg, 'idle', this.view);
    this.mount(a);
    this.current = 'idle';
    this.playing = true;
    const run = ++this.runId;
    const loop = () => {
      if (run !== this.runId || !this.idleOn || this.destroyed) return;
      this.playhead?.playFrom(0);
      this.syncPause();
      void this.clock?.finished.then(loop, () => undefined);
    };
    loop();
  }

  stopIdle(): void {
    this.idleOn = false;
    if (this.current === 'idle') {
      this.runId += 1;
      this.clear();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.runId += 1;
    this.clear();
    this.io?.disconnect();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVis);
    this.root.innerHTML = '';
  }

  // ---- internals ----

  private canAnimate(): boolean {
    return typeof (this.host as HTMLElement & { animate?: unknown }).animate === 'function';
  }

  /** Base styles inline, every track compiled into one playhead, plus an empty clock animation for `finished`. */
  private mount(a: Authored): void {
    const ph = new Playhead();
    for (const tr of a.tracks) {
      const base = tr.baseStyle();
      for (const el of tr.els) applyStyle(el, base);
      for (const c of tr.compile()) ph.add(c, tr.name);
    }
    this.clock = ph.adopt(this.host.animate([], { duration: a.duration * 1000 }), a.duration * 1000);
    this.playhead = ph;
    this.touched = a.tracks.flatMap((tr) => [...tr.els]);
    ph.seek(0);
  }

  /** Cancels everything and removes every inline style a timeline wrote; the view is put back. */
  private clear(): void {
    this.playhead?.cancel();
    this.playhead = null;
    this.clock = null;
    this.current = null;
    this.playing = false;
    for (const el of this.touched) {
      const s = (el as SVGElement).style;
      s.removeProperty('transform');
      s.removeProperty('opacity');
    }
    this.touched = [];
    this.setView(this.view);
  }

  /** Pauses a playing timeline while the tab is hidden or the stage is off screen; resumes it where it stopped. */
  private syncPause(): void {
    if (typeof document !== 'undefined') this.visible = document.visibilityState !== 'hidden';
    const ph = this.playhead;
    const clock = this.clock;
    if (!ph || !clock || !this.playing) return;
    if (!this.visible || !this.onScreen) {
      if (clock.playState === 'running') ph.pause();
    } else if (clock.playState === 'paused') {
      ph.playFrom(Number(clock.currentTime ?? 0));
    }
  }
}
