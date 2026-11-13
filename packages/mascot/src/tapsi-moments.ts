/**
 * Tapsi's approved moments (Felix 26.10, moved from the gallery prototype demo/tapsi/ into the package 27.10.2026):
 *
 *   «Psst»     — the reservation moment M17 (the guest's wish sheet, after the server's yes) with its new ending:
 *                jump → the wish star drops into his paws → nine bites → both paws cover his mouth, ^ ^, a head tilt
 *                and a small nod ("Ich sag nix") → paws down, eyes open. Hamster scene 'secret' (≈ 5.65 s).
 *   «Пылинка»  — the binoculars come down, one paw brushes a speck off a lens, the glint crosses the clean lenses,
 *                binoculars up again. Hamster scene 'speck' (1.6 s; the empty "Freunde" card, on tap / Enter only).
 *
 * This module is loaded lazily by the puppet (hamster.ts: `import('./tapsi-moments')`) the first time one of the two
 * scenes plays, so the mascot chunk of every other screen does not carry it.
 *
 * Every moving part is ONE Track (timeline.ts): keys at absolute seconds, compiled into Web Animations that run on
 * one Playhead — deterministic (the same keys sample to the same frame; tests and the gallery seek them). Only
 * transform and opacity; finite, no loops. While a scene runs the puppet is in its 'driven' mode (hamster.ts CSS:
 * its own loops and transitions step aside), afterwards every inline style the scene wrote is removed again.
 * Reduced motion never comes here: the puppet shows its still pose (pose('psst'); the binoculars lowered, ^ ^).
 */

import { applyStyle } from './drive';
import { Playhead, splitEase, Track, type ChannelInput } from './timeline';

const LINEAR_OK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)');

/** The app's springs (apps/web/src/styles/tokens.css --ease-*) plus the puppet's own curves (core.ts EASINGS). */
export const EZ = {
  snappy: LINEAR_OK ? 'linear(0, 0.036, 0.123, 0.234, 0.352, 0.468, 0.573, 0.665, 0.744, 0.808, 0.860, 0.901, 0.932, 0.956, 0.973, 0.985, 0.994, 0.999, 1.003, 1.004, 1.005, 1.005, 1.005, 1.005, 1)' : 'cubic-bezier(.25,.8,.3,1)',
  smooth: LINEAR_OK ? 'linear(0, 0.023, 0.081, 0.159, 0.248, 0.340, 0.429, 0.514, 0.591, 0.660, 0.721, 0.773, 0.818, 0.856, 0.887, 0.913, 0.934, 0.950, 0.964, 0.974, 0.982, 0.988, 0.993, 0.996, 1)' : 'cubic-bezier(.2,.7,.3,1)',
  bouncy: LINEAR_OK ? 'linear(0, 0.069, 0.237, 0.449, 0.662, 0.849, 0.994, 1.092, 1.146, 1.163, 1.153, 1.127, 1.092, 1.057, 1.026, 1.002, 0.986, 0.977, 0.973, 0.975, 0.979, 0.985, 0.990, 0.995, 1)' : 'cubic-bezier(.34,1.56,.64,1)',
  out: 'cubic-bezier(.2,.7,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.5)',
  inOut: 'cubic-bezier(.45,0,.2,1)',
  /** the puppet's overshooting spring (cookie drop, paws down, cheeks) — core.ts SPRING */
  spring: 'cubic-bezier(.34, 1.56, .64, 1)',
  /** core.ts EASINGS.jumpUp / jumpDown / lift / crumb */
  jumpUp: 'cubic-bezier(.2,.7,.3,1)',
  jumpDown: 'cubic-bezier(.5,0,.8,.5)',
  lift: 'cubic-bezier(.3,.7,.3,1)',
  crumb: 'cubic-bezier(.4,0,1,1)',
  ease: 'ease-in-out',
  linear: 'linear',
} as const;

/** What the choreography needs from a puppet: its parts, a track factory and a way to add a drawing (crumbs). */
export interface TapsiKit {
  query(selector: string): Element[];
  track(els: readonly Element[], base: ChannelInput, name: string): Track;
  /** an extra drawing inside the puppet (puppet units), appended to the first element of `parent` */
  add(markup: string, parent: string): Element;
}

/** Lazily made tracks of the puppet's parts — one per part (two tracks never drive the same element). */
export class TapsiParts {
  private readonly reg = new Map<string, Track>();
  constructor(readonly kit: TapsiKit) {}

  get(name: string, target: string | Element | readonly Element[], base: ChannelInput): Track {
    const hit = this.reg.get(name);
    if (hit) return hit;
    const els = typeof target === 'string' ? this.kit.query(target) : Array.isArray(target) ? (target as readonly Element[]) : [target as Element];
    if (!els.length) throw new Error(`[tapsi] no element for ${name}`);
    const t = this.kit.track(els, base, `tapsi.${name}`);
    this.reg.set(name, t);
    return t;
  }

  get hop() { return this.get('hop', '.hop', { y: 0 }); }
  get body() { return this.get('body', '.body', { y: 0, r: 0, sx: 1, sy: 1 }); }
  /** the nod: a small squash of everything above the feet, about the bottom ('driven' mode moves its origin there) */
  get nod() { return this.get('nod', '.wiggle', { sx: 1, sy: 1 }); }
  get breathe() { return this.get('breathe', '.breathe', { sx: 1, sy: 1 }); }
  get footL() { return this.get('footL', '.foot-l', { x: 0, y: 0, r: 0, sx: 1, sy: 1 }); }
  get footR() { return this.get('footR', '.foot-r', { x: 0, y: 0, r: 0, sx: 1, sy: 1 }); }
  get paws() { return this.get('paws', '.paws', { y: 0 }); }
  get pawL() { return this.get('pawL', '.paw-l', { x: 0, y: 0, r: 0 }); }
  get pawR() { return this.get('pawR', '.paw-r', { x: 0, y: 0, r: 0 }); }
  get earL() { return this.get('earL', '.ear-l', { r: 0 }); }
  get earR() { return this.get('earR', '.ear-r', { r: 0 }); }
  get tip() { return this.get('tip', '.ear-tip', { r: 0 }); }
  /** the chewing wobble (inner cheek groups) */
  get chew() { return this.get('chew', '.cheek-j', { sx: 1, sy: 1 }); }
  /** cheek fullness (the outer groups; the puppet's --puff) */
  get puff() { return this.get('puff', '.cheek', { s: 1 }); }
  get shadow() { return this.get('shadow', '.shadow', { s: 1, o: 1 }); }
  get face() { return this.get('face', '.face', { x: 0, y: 0 }); }
  /** the face group (eyes, nose, mouth, blush): turns for a head tilt */
  get tf() { return this.get('tf', '.tf', { r: 0 }); }
  /** both ear groups: lean with a head tilt */
  get te() { return this.get('te', '.te', { r: 0 }); }
  get round() { return this.get('round', '.eyes', { o: 1 }); }
  get balls() { return this.get('balls', '.eyes .eye', { sy: 1 }); }
  get stars() { return this.get('stars', '.eyes-star', { o: 0 }); }
  get happy() { return this.get('happy', '.eyes-happy', { o: 0 }); }
  get mouth() { return this.get('mouth', '.mouth', { o: 1 }); }
  get open() { return this.get('open', '.mouth-open', { o: 0, s: 1 }); }
  get cookie() { return this.get('cookie', '.cookie', { o: 0, y: 0, r: 0, s: 1 }); }
  get blush() { return this.get('blush', this.kit.query('.tf > ellipse').slice(0, 2), { o: 0.3 }); }
  get bino() { return this.get('bino', '.bino', { x: 0, y: 0, r: 0, sx: 1, sy: 1 }); }
  /** the binoculars' right paw (the one that lets go to brush) */
  get binoPaw() { return this.get('binoPaw', this.kit.query('.bino-paw').slice(1, 2), { x: 0, y: 0, r: 0 }); }
  get glint() { return this.get('glint', '.bino-glint', { x: 0 }); }
  get speck() { return this.get('speck', '.bino-speck', { x: 0, y: 0, r: 0, s: 1, o: 0 }); }

  /** Eyes: 'round' | 'star' | 'happy', switched at t (a 1 ms step, like the puppet's class switch). */
  eyes(t: number, mode: 'round' | 'star' | 'happy'): void {
    this.round.set(t, { o: mode === 'round' ? 1 : 0 });
    this.stars.set(t, { o: mode === 'star' ? 1 : 0 });
    this.happy.set(t, { o: mode === 'happy' ? 1 : 0 });
  }

  /** A blink starting at t (close + open ≈ 0.15 s). */
  blink(t: number): void {
    this.balls.path(t, [[t + 0.06, { sy: 0.1 }, EZ.in], [t + 0.15, { sy: 1 }, EZ.out]]);
  }

  /**
   * The puppet's mouth-open state (hamster.ts `.m-open`), switched at t: the closed mouth goes at once (it has no
   * transition there), the open one fades over its CSS 0.1 s `ease`.
   */
  mouthOpen(t: number, on: boolean, d = 0.1): void {
    this.open.move(t, t + d, { o: on ? 1 : 0 }, 'ease');
    this.mouth.set(t, { o: on ? 0 : 1 });
  }

  /**
   * The approved double flick of the folded ear tip (hamster.ts flick(): the class on at 0 and 0.23 s for 120 / 110 ms,
   * each change a 0.12 s `ease-out` transition).
   */
  flick(t: number): void {
    this.tip.path(t, [[t + 0.12, { r: -12 }, 'ease-out'], [t + 0.23, { r: 0 }, 'ease-out'], [t + 0.34, { r: -12 }, 'ease-out'], [t + 0.46, { r: 0 }, 'ease-out']]);
  }

  /**
   * Quiet breathing from 0 to `until` (the puppet's CSS breathe, ≈ 3.6 s a breath, is off while driven): whole
   * breaths, stretched or squeezed a little so the last one ends exactly at `until` — never longer than the scene.
   */
  breatheUntil(until: number): void {
    const n = Math.max(1, Math.round(until / 3.6));
    const period = until / n;
    for (let i = 0; i < n; i++) {
      const t = i * period;
      this.breathe.path(t, [[t + period / 2, { sx: 0.994, sy: 1.018 }, EZ.ease], [t + period, { sx: 1, sy: 1 }, EZ.ease]]);
    }
  }
}

/** `points` at offsets 0..1 of a `d`-second motion starting at t0 (the puppet's keyframe offsets). */
function keys(track: Track, t0: number, d: number, points: ReadonlyArray<readonly [number, ChannelInput, string?]>): void {
  track.path(t0, points.map(([o, v, e]) => [t0 + o * d, v, e ?? EZ.linear] as const));
}

// ---- the approved jump (mascot.ts jumpMotion + hamster.ts jumpBodyFrames / jumpEars), keyframe for keyframe ----

function jumpMotion(p: TapsiParts, t0: number, h = 36, d = 0.9): void {
  keys(p.hop, t0, d, [[0.18, { y: 0 }], [0.52, { y: -h }, EZ.jumpUp], [0.82, { y: 0 }, EZ.jumpDown], [1, { y: 0 }]]);
  keys(p.body, t0, d, [
    [0.18, { sx: 1.08, sy: 0.88 }], [0.3, { sx: 0.95, sy: 1.07 }], [0.52, { sx: 1, sy: 1 }], [0.72, { sx: 0.97, sy: 1.04 }],
    [0.84, { sx: 1.07, sy: 0.9 }], [0.93, { sx: 0.98, sy: 1.02 }], [1, { sx: 1, sy: 1 }],
  ]);
  const foot = (s: number): [number, ChannelInput][] => [
    [0.18, { x: -2 * s, y: 0, r: 0, sx: 1.12, sy: 1 }],
    [0.4, { x: 2 * s, y: -8, r: 18 * s, sx: 0.8, sy: 0.8 }],
    [0.66, { x: 2 * s, y: -8, r: 18 * s, sx: 0.8, sy: 0.8 }],
    [0.84, { x: -3 * s, y: 0, r: 0, sx: 1.18, sy: 1 }],
    [1, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }],
  ];
  keys(p.footL, t0, d, foot(1));
  keys(p.footR, t0, d, foot(-1));
  keys(p.paws, t0, d, [[0.18, { y: 2 }], [0.4, { y: -7 }], [0.66, { y: -4 }], [0.84, { y: 3 }], [1, { y: 0 }]]);
  keys(p.earL, t0, d, [[0.3, { r: 6 }], [0.55, { r: -8 }], [0.86, { r: 12 }], [1, { r: 0 }]]);
  keys(p.earR, t0, d, [[0.3, { r: -6 }], [0.55, { r: 8 }], [0.86, { r: -10 }], [1, { r: 0 }]]);
  keys(p.tip, t0, d, [[0.3, { r: -12 }], [0.56, { r: 7 }], [0.86, { r: -14 }], [1, { r: 0 }]]);
  keys(p.chew, t0, d, [[0.8, { sx: 1, sy: 1 }], [0.87, { sx: 1.09, sy: 0.92 }], [0.94, { sx: 0.97, sy: 1.03 }], [1, { sx: 1, sy: 1 }]]);
  // (the .18 key has no opacity there: WAAPI fades it from 1 towards .5 already, ≈ .827 at .18)
  keys(p.shadow, t0, d, [[0.18, { s: 1.06, o: 1 - 0.5 * (0.18 / 0.52) }], [0.52, { s: 0.62, o: 0.5 }], [0.84, { s: 1.08, o: 1 }], [1, { s: 1, o: 1 }]]);
}

/** Deterministic "random" numbers for the crumbs (the old eat scene used Math.random). */
function rnd(i: number): number {
  const v = Math.sin(i * 9301 + 49297) * 233280;
  return v - Math.floor(v);
}

function addCrumb(p: TapsiParts, t: number, i: number): void {
  const c = p.kit.add(`<circle r="${(1 + rnd(i) * 1.2).toFixed(1)}" fill="#E9B04E"/>`, '.fx');
  const dx = (rnd(i + 17) - 0.5) * 34;
  const d = 0.65 + rnd(i + 31) * 0.3;
  p.kit.track([c], { x: 0, y: -80, o: 0 }, `tapsi.crumb${i}`).set(t, { o: 1 }).move(t, t + d, { x: dx, y: -4, o: 0 }, EZ.crumb);
}

// ---- 1 · the reservation moment (M17) with the «Psst» ending ---------------------------------------------------

/** Beats of the reservation moment (s after the server's yes; the same in the old ending and in «Psst»). */
export const RESERVE = {
  /** the jump scene ends (jumpMotion 0.9 s + wait 0.25 s); eat starts */
  eat: 1.15,
  /** the star has dropped into his paws */
  landed: 1.85,
  /** paws up at the mouth, chewing starts */
  chew: 2.39,
  /** nine bites of 0.17 s later: the star is gone */
  swallowed: 3.92,
} as const;

/**
 * The «Psst» pose (puppet units / degrees): both paws close over his mouth (fingers up, tilted with the head), the
 * face and ears tilt to one side, the body leans a hair, the blush warms up. The reduced-motion still is this pose
 * too (hamster.ts pose('psst')), with full cheeks and ^ ^.
 */
export const PSST = {
  paws: { y: -30 },
  pawL: { x: 5, y: 0, r: 20 },
  pawR: { x: -5, y: 0, r: -36 },
  tf: { r: -8 },
  te: { r: -5 },
  body: { r: -2 },
  blush: { o: 0.62 },
} as const;

/** Cheeks after the star went in (the puppet's setPuff after eating). */
export const FULL_CHEEKS = 1.35;

/**
 * The shared start of the reservation moment: the jump (star eyes), the star drops into his paws, he lifts it to his
 * mouth and nibbles nine times, the cheeks fill. `smoothSwallow`: «Psst» eases the chewing wobble out over 0.06 s
 * (the old ending snapped it back in one frame, as the class switch did).
 */
export function authorReserveStart(p: TapsiParts, smoothSwallow = true): void {
  // jump (star eyes from the first frame, then normal)
  p.get('round', '.eyes', { o: 0 });
  p.get('stars', '.eyes-star', { o: 1 });
  jumpMotion(p, 0);
  p.eyes(RESERVE.eat, 'round');

  // eat: the star drops into his paws (he looks up at it), he lifts it to his mouth and nibbles nine times
  const t0 = RESERVE.eat;
  p.cookie.set(t0, { o: 1, y: -210, r: -60 }).move(t0, t0 + 0.7, { y: 0, r: 0 }, EZ.spring);
  p.face.move(t0, t0 + 0.45, { y: -2.5 }, 'cubic-bezier(.25,.8,.3,1)').move(RESERVE.landed, RESERVE.landed + 0.45, { y: 0 }, 'cubic-bezier(.25,.8,.3,1)');
  p.eyes(RESERVE.landed, 'star');
  p.body.path(RESERVE.landed, [[RESERVE.landed + 0.14, { sx: 1.05, sy: 0.95 }, EZ.linear], [RESERVE.landed + 0.28, { sx: 1, sy: 1 }, EZ.linear]]);
  p.paws.move(RESERVE.landed + 0.26, RESERVE.chew, { y: -30 }, EZ.lift);
  p.eyes(RESERVE.chew, 'happy');
  // one bite = one 0.17 s animation with ONE ease-in-out over its three keyframes: split exactly at the middle key
  const [biteK, biteIn, biteOut] = splitEase('ease-in-out', 0.5);
  let crumb = 0;
  for (let i = 0; i < 9; i++) {
    const ci = RESERVE.chew + i * 0.17;
    p.mouthOpen(ci, i % 2 === 0);
    if (i % 2 === 1) {
      p.cookie.set(ci, { s: 1 - (i + 1) * 0.09, r: i * 6 });
      for (let n = 0; n < 2; n++) addCrumb(p, ci, crumb++);
    }
    p.body.path(ci, [[ci + 0.17 * biteK, { y: 1.6, r: 1.5, sx: 1.012, sy: 0.985 }, biteIn], [ci + 0.17, { y: 0, r: 0, sx: 1, sy: 1 }, biteOut]]);
    p.chew.move(ci, ci + 0.17, i % 2 === 0 ? { sx: 1.07, sy: 0.95 } : { sx: 1, sy: 1 }, EZ.ease);
  }
  const ce = RESERVE.swallowed;
  if (smoothSwallow) p.chew.move(ce, ce + 0.06, { sx: 1, sy: 1 }, EZ.out);
  else p.chew.set(ce, { sx: 1, sy: 1 });
  p.mouthOpen(ce, false);
  p.cookie.set(ce, { o: 0, s: 1, r: 0 });
  // the cheeks fill (the puppet's .cheek transition: 0.7 s on its spring)
  p.puff.move(ce, ce + 0.7, { s: FULL_CHEEKS }, EZ.spring);
}

/**
 * The «Psst» ending (from the swallow): the eyes stay ^ ^; both paws close over his mouth, the head tilts, one small
 * nod and the ear-tip flick — "Ich sag nix" — then the paws go down on the bouncy spring and the eyes open.
 * Returns the moment he is free again (s) and its named beats.
 */
export function authorPsstEnding(p: TapsiParts): { free: number; marks: Record<string, number> } {
  const ce = RESERVE.swallowed;
  const sealed = ce + 0.3;
  p.paws.move(ce, sealed, PSST.paws, EZ.smooth);
  p.pawL.move(ce, sealed, PSST.pawL, EZ.smooth);
  p.pawR.move(ce, sealed, PSST.pawR, EZ.smooth);
  p.blush.move(ce + 0.15, ce + 0.5, PSST.blush, EZ.smooth);
  // the head tilts: the face and the ears turn, the body only leans a hair (its base stays on the feet)
  p.tf.move(ce + 0.12, ce + 0.52, PSST.tf, EZ.smooth);
  p.te.move(ce + 0.12, ce + 0.52, PSST.te, EZ.smooth);
  p.body.move(ce + 0.12, ce + 0.52, PSST.body, EZ.smooth);
  p.nod.path(ce + 0.42, [[ce + 0.6, { sx: 1.012, sy: 0.972 }, EZ.out], [ce + 0.86, { sx: 1, sy: 1 }, EZ.inOut]]);
  p.flick(ce + 0.5);
  const release = ce + 1.25;
  p.paws.move(release, release + 0.4, { y: 0 }, EZ.bouncy);
  p.pawL.move(release, release + 0.3, { x: 0, y: 0, r: 0 }, EZ.smooth);
  p.pawR.move(release, release + 0.3, { x: 0, y: 0, r: 0 }, EZ.smooth);
  p.tf.move(release, release + 0.4, { r: 0 }, EZ.smooth);
  p.te.move(release, release + 0.4, { r: 0 }, EZ.smooth);
  p.body.move(release, release + 0.4, { r: 0 }, EZ.smooth);
  p.blush.move(release + 0.05, release + 0.4, { o: 0.3 }, EZ.smooth);
  // eyes open again (^ ^ → round, the lids lift)
  const open = release + 0.34;
  p.balls.set(open, { sy: 0.2 });
  p.eyes(open + 0.02, 'round');
  p.balls.move(open + 0.02, open + 0.14, { sy: 1 }, EZ.out);
  const free = Math.round((open + 0.14) * 1000) / 1000;
  return { free, marks: { ...RESERVE, sealed, tilted: ce + 0.52, release, free } };
}

/** The whole 'secret' scene (jump → eat → «Psst»). Returns its length (s) and beats. */
export function authorSecret(p: TapsiParts): { duration: number; marks: Record<string, number> } {
  authorReserveStart(p, true);
  const { free, marks } = authorPsstEnding(p);
  return { duration: free, marks };
}

// ---- 2 · «Пылинка на линзе» ---------------------------------------------------------------------------------

/**
 * Where the binocular look-around loop is when the tap comes (hamster.ts bino-look / -face / -ears / -lean, the
 * blink and the glint): the scene starts from exactly there and glides back to the middle, never a jump.
 */
export interface LoopPose {
  bino: { x: number; y: number; r: number; sx: number; sy: number };
  tf: number;
  te: number;
  lean: number;
  eye: number;
  glint: number;
}

export const LOOP_REST: LoopPose = { bino: { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, tf: 0, te: 0, lean: 0, eye: 1, glint: 0 };

/** translate / rotate / scale of a computed 2D matrix (no skew in these loops). */
function decompose(el: Element | undefined): { x: number; y: number; r: number; sx: number; sy: number } {
  const id = { x: 0, y: 0, r: 0, sx: 1, sy: 1 };
  if (!el || typeof getComputedStyle !== 'function') return id;
  const m = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(el).transform || '')?.[1]?.split(',').map(Number);
  if (!m || m.length !== 6 || !m.every(Number.isFinite)) return id;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = m;
  const sx = Math.hypot(a, b);
  if (sx < 1e-6) return id;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r3(e), y: r3(f), r: r3((Math.atan2(b, a) * 180) / Math.PI), sx: r3(sx), sy: r3((a * d - b * c) / sx) };
}

/** Reads the loop's current pose from the puppet's parts (before the scene switches the loop off). */
export function readLoopPose(query: (selector: string) => Element[]): LoopPose {
  return {
    bino: decompose(query('.bino')[0]),
    tf: decompose(query('.tf')[0]).x,
    te: decompose(query('.te')[0]).x,
    lean: decompose(query('.wiggle')[0]).r,
    eye: decompose(query('.eyes .eye')[0]).sy,
    glint: decompose(query('.bino-glint')[0]).x,
  };
}

/**
 * The speck on the right lens (hamster.ts `.bino-speck`, hidden until this scene; the lens: centre 31 −97, r 13):
 * the tap answers at once (the ear tip flicks), the binoculars come down, a blink at the lens, one paw lets go and
 * sweeps the speck off (a second, lighter sweep), the glint crosses the clean lenses, ^ ^, binoculars up again on a
 * soft spring. `from`: where the look-around loop was (it glides back to the middle within the first 0.3 s).
 */
export function authorSpeck(p: TapsiParts, from: LoopPose = LOOP_REST): { duration: number; marks: Record<string, number> } {
  const speck = p.speck;
  const bino = p.get('bino', '.bino', { ...from.bino });
  // the loop's head turn and lean glide back to the middle while the binoculars come down
  if (from.tf) p.get('tf', '.tf', { x: from.tf }).move(0.02, 0.3, { x: 0 }, EZ.smooth);
  if (from.te) p.get('te', '.te', { x: from.te }).move(0.02, 0.3, { x: 0 }, EZ.smooth);
  if (from.lean) p.get('lean', '.wiggle', { r: from.lean }).move(0.02, 0.3, { r: 0 }, EZ.smooth);
  const balls = p.get('balls', '.eyes .eye', { sy: from.eye });
  if (from.eye < 1) balls.move(0, 0.08, { sy: 1 }, EZ.out);
  const glint = p.get('glint', '.bino-glint', { x: from.glint });
  // a glint caught mid-sweep finishes its way off the lens (it is invisible at both ends)
  if (from.glint > 0 && from.glint < 132) glint.move(0, 0.2, { x: 132 }, EZ.inOut);
  if (from.glint > 0) glint.set(0.3, { x: 0 });

  // the tap answers at once: the ear tip flicks, the binoculars come down (he saw something)
  p.flick(0);
  bino.move(0.02, 0.32, { x: 0, y: 36, r: 0, sx: 0.97, sy: 0.97 }, EZ.smooth);
  speck.move(0.16, 0.3, { o: 1 }, EZ.linear);
  p.face.move(0.3, 0.46, { y: 2 }, EZ.smooth);
  p.blink(0.32);
  // one paw lets go (the binoculars tip a little in the other one) and comes to the inner side of the lens …
  const on = 0.44;
  const sweep = on + 0.14;
  const swept = sweep + 0.12;
  bino.move(on, sweep, { r: -3 }, EZ.smooth);
  p.binoPaw.path(on, [
    [sweep, { x: -34, y: -13, r: -30 }, EZ.smooth],
    // … one sweep outwards across the lens (the speck goes ahead of it), a short way back, a second, lighter sweep
    [swept, { x: -6, y: -15, r: -12 }, EZ.inOut],
    [swept + 0.08, { x: -17, y: -14, r: -22 }, EZ.inOut],
    [swept + 0.16, { x: -5, y: -14, r: -12 }, EZ.inOut],
    [swept + 0.3, { x: 0, y: 0, r: 0 }, EZ.smooth],
  ]);
  // the speck: pushed to the rim by the first sweep, then it falls off, turning and fading
  speck.path(sweep + 0.02, [
    [swept, { x: 27, y: -3, r: 30 }, EZ.inOut],
    [swept + 0.1, { x: 33, y: 3, r: 70 }, EZ.out],
    [swept + 0.34, { x: 38, y: 26, r: 130, s: 0.6, o: 0 }, EZ.in],
  ]);
  speck.set(1.4, { x: 0, y: 0, r: 0, s: 1, o: 0 });
  bino.move(swept + 0.16, swept + 0.3, { r: 0 }, EZ.smooth);
  // clean: the glint crosses the lenses, he is pleased (^ ^)
  const clean = swept + 0.22;
  glint.move(clean, clean + 0.3, { x: 132 }, EZ.inOut);
  p.eyes(clean + 0.06, 'happy');
  p.face.move(clean + 0.06, clean + 0.26, { y: 0 }, EZ.smooth);
  // binoculars up again with a soft spring
  const up = 1.14;
  bino.move(up, 1.6, { y: 0, sx: 1, sy: 1 }, EZ.bouncy);
  p.eyes(1.4, 'round');
  glint.set(1.6, { x: 0 });
  return { duration: 1.6, marks: { down: 0.32, brush: on, sweep, clean, up } };
}

// ---- running a scene on a puppet ----------------------------------------------------------------------------

export interface DrivenScene {
  duration: number;
  marks: Record<string, number>;
  readonly tracks: readonly Track[];
  /** the end clock (an empty animation on the svg): resolves when the scene is over; null without Web Animations */
  clock: Animation | null;
  /** cancels the animations, removes every inline style the scene wrote and the drawings it added */
  cleanup(): void;
}

/** Builds a kit over a puppet's <svg>: its parts, tracks it keeps, and added drawings it removes at the end. */
function kitOver(svg: SVGSVGElement, tracks: Track[], added: Element[]): TapsiKit {
  return {
    query: (sel) => [...svg.querySelectorAll(sel)],
    track: (els, base, name) => {
      const t = new Track(els, name, base);
      tracks.push(t);
      return t;
    },
    add: (markup, parent) => {
      const host = svg.querySelector(parent);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = markup;
      host?.append(g);
      added.push(g);
      return g.firstElementChild ?? g;
    },
  };
}

/** Authors scene `which` on the puppet's <svg> and starts it (the puppet must be in its 'driven' mode). */
export function startScene(svg: SVGSVGElement, which: 'secret' | 'speck', from?: LoopPose): DrivenScene {
  const tracks: Track[] = [];
  const added: Element[] = [];
  const parts = new TapsiParts(kitOver(svg, tracks, added));
  const { duration, marks } = which === 'secret' ? authorSecret(parts) : authorSpeck(parts, from);
  // the puppet's CSS breathing is off while driven: the same quiet breaths on the timeline, ending with the scene
  parts.breatheUntil(duration);
  const playhead = new Playhead();
  const touched = new Set<Element>();
  for (const t of tracks) {
    const base = t.baseStyle();
    for (const el of t.els) {
      applyStyle(el, base);
      touched.add(el);
    }
    for (const c of t.compile()) playhead.add(c, t.name);
  }
  const anchor = svg as SVGSVGElement & { animate?: SVGSVGElement['animate'] };
  const clock = typeof anchor.animate === 'function' ? playhead.adopt(anchor.animate([], { duration: duration * 1000 }), duration * 1000) : null;
  playhead.playFrom(0);
  return {
    duration,
    marks,
    tracks,
    clock,
    cleanup: () => {
      playhead.cancel();
      for (const el of touched) {
        const st = (el as SVGElement).style;
        st.removeProperty('transform');
        st.removeProperty('opacity');
      }
      for (const g of added) g.remove();
    },
  };
}
