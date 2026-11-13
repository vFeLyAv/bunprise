/**
 * «Живые анимации» (approved 31.10: «Всё остальное хорошо») — the moments, authored on the mascot timeline. Moved here
 * from the gallery prototype (demo/alive/moves.ts re-exports it and keeps the dropped flop / slump in its archive).
 *
 * Every moment is a Shot: Tracks (src/timeline.ts) on the puppet's own parts, starting AND ending in the plain rest
 * pose (the puppet's idle life takes over without a jump). Only transform and opacity; one finite timeline each,
 * seek(t) gives the same frame every time (the gallery's frame strips and `&t=` rely on it).
 *
 * Round 2 (Felix's review 31.10): the whole puppet is never squashed or stretched (head and ears keep their shape),
 * and no part ever appears out of nowhere — parts move on their own, the body shape changes only through pieces that
 * are always attached (the rear / hips behind the body, rig.ts).
 *
 * Pompon (the lop-eared bunny):
 *   groom      Умывашки   — washes his face with both paws, licks them, pulls his right ear down in front of his face
 *                           and cleans it, lets it spring back
 *   periscope  Перископ   — rises from his planted feet (no legs), paws at the chest, looks left and right, sniffs
 *   stretch    Потягушки  — 3/4: front paws far forward low, the front of the body down, the rear stays up, the body
 *                           gets longer (its rear slides back); a small yawn, back, a gentle shake
 *   loaf       Буханочка  — paws tucked under (they slide under the body's edge), feet in, the bottom a little wider,
 *                           ears close, eyes half closed, two tiny breaths, one slow blink, an ear twitch
 *   sneeze     Чих        — nose twitches in pairs, "а-а…", the sneeze (a head jerk, a small bounce, the ears fling out
 *                           and swing back twice), then round surprised eyes, a glance, two blinks
 *   dig        Копает     — looks down and digs quickly with both front paws in turn, dust puffs
 * Tapsi (the hamster):
 *   hwash      Умывается  — sits up, licks his paws, rubs his face with tiny fast paws, one big stroke over the ears
 *   post       Столбик    — stands up like a little post, paws together at the chest, sniffs the air, drops down
 * (Dropped by Felix 31.10, gallery archive only: the flop «ваще странно» and the slump «сполз убрать».)
 */

import { Track, type ChannelInput, type Channels } from '../timeline';
import { BODY_ORIGIN, DUST_NAMES, NEUTRAL, PUFF_DIRS, PUFF_NAMES, type AliveKind, type AliveRig, type Extra, type PartName, type Pose } from './rig';

export type AliveId = 'groom' | 'periscope' | 'stretch' | 'loaf' | 'sneeze' | 'dig' | 'hwash' | 'post';

/** cubic-bezier only (the puppet's own curves): Track.sample evaluates exactly these. */
export const EZ = {
  out: 'cubic-bezier(.2,.7,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.5)',
  inOut: 'cubic-bezier(.45,0,.2,1)',
  ease: 'ease-in-out',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
  turn: 'cubic-bezier(.3,.7,.3,1)',
  lin: 'linear',
} as const;

/** One moment (I: its id — the gallery's archive adds its own). */
export interface Shot<I extends string = AliveId> {
  readonly id: I;
  readonly tracks: readonly Track[];
  readonly duration: number;
  /** beats for the frame labels (s) */
  readonly marks: Readonly<Record<string, number>>;
  /** the round-2 helpers it needs while it runs (rig.setExtras) */
  readonly extras?: readonly Extra[];
}

export type Key = readonly [number, ChannelInput, string?];

/** Lazily made tracks of the parts (one track per part: two tracks never drive the same element). */
export class Builder {
  private readonly made = new Map<PartName, Track>();
  readonly marks: Record<string, number> = {};
  constructor(readonly rig: AliveRig) {}

  get geo() {
    return this.rig.geo;
  }

  t(name: PartName): Track {
    const hit = this.made.get(name);
    if (hit) return hit;
    const tr = new Track(this.rig.els(name), `alive.${name}`, { ...NEUTRAL[name] });
    this.made.set(name, tr);
    return tr;
  }

  /** Keys from `t0` on (or from where the part's track already ends, whichever is later). Absent parts are skipped. */
  p(name: PartName, t0: number, keys: readonly Key[]): void {
    if (!this.rig.has(name)) return;
    const tr = this.t(name);
    tr.path(Math.max(t0, tr.end), keys.map(([t, v, e]) => [t, { ...NEUTRAL[name], ...v }, e] as const));
  }

  /** An instant switch at `t` (while the part is hidden or the switch is covered by a blink). */
  set(name: PartName, t: number, v: ChannelInput): void {
    if (!this.rig.has(name)) return;
    this.t(name).set(t, { ...NEUTRAL[name], ...v });
  }

  shot<I extends string>(id: I, duration: number, extras: readonly Extra[] = []): Shot<I> {
    // every part ends at rest (the puppet's idle life takes over without a jump); an author slip glides home
    for (const [name, tr] of this.made) {
      const v = tr.sample(duration);
      const z = NEUTRAL[name];
      const off = (Object.keys(z) as (keyof Channels)[]).some((c) => Math.abs((v[c] ?? 0) - (z[c] ?? 0)) > 1e-3);
      if (off || tr.end > duration + 1e-6) console.warn(`[alive] ${id}: ${name} does not end at rest by ${duration} s`);
      if (off) tr.move(Math.max(tr.end, duration - 0.2), Math.max(duration, tr.end + 0.05), { ...z }, EZ.ease);
    }
    return { id, tracks: [...this.made.values()], duration, marks: { ...this.marks }, ...(extras.length ? { extras } : {}) };
  }
}

// ------------------------------------------------------------------------------------------------ small helpers

export const EYES = ['eyeL', 'eyeR'] as const;

export function blink(b: Builder, t: number, d = 0.15): void {
  for (const n of EYES) b.p(n, t, [[t + d * 0.45, { sx: 1, sy: 0.12 }, EZ.in], [t + d, { sx: 1, sy: 1 }, EZ.out]]);
}

/** Round eyes close and ^ ^ shows at once (the approved greet does the same: a blink hides the switch). */
export function toHappy(b: Builder, t: number): void {
  for (const n of EYES) b.p(n, t, [[t + 0.06, { sx: 1, sy: 0.12 }, EZ.in]]);
  b.set('eyesG', t + 0.065, { o: 0 });
  b.set('happy', t + 0.065, { o: 1 });
  for (const n of EYES) b.set(n, t + 0.07, { sx: 1, sy: 1 });
}

/** ^ ^ goes, the round eyes open from a blink. */
export function toOpen(b: Builder, t: number): void {
  b.set('happy', t, { o: 0 });
  b.set('eyesG', t, { o: 1 });
  for (const n of EYES) {
    b.set(n, t, { sx: 1, sy: 0.12 });
    b.p(n, t, [[t + 0.1, { sx: 1, sy: 1 }, EZ.out]]);
  }
}

/** The nose wiggles n times (the approved sniff: wider and flatter). */
export function wiggleNose(b: Builder, t0: number, n: number, period = 0.1, amp = 1): void {
  const keys: Key[] = [];
  for (let i = 0; i < n; i++) {
    keys.push([t0 + period * (i + 0.5), { sx: 1 + 0.12 * amp, sy: 1 - 0.18 * amp }, EZ.ease], [t0 + period * (i + 1), { sx: 1, sy: 1 }, EZ.ease]);
  }
  b.p('nose', t0, keys);
}

/** A little lick: the mouth opens, the tongue flicks out and back (0.15 s). */
export function lick(b: Builder, t: number): void {
  b.set('mouth', t, { o: 0 });
  b.set('yawn', t, { o: 1, sx: 0.95, sy: 1.15 });
  b.set('tongue', t + 0.01, { o: 1, sy: 0.3 });
  b.p('tongue', t + 0.01, [[t + 0.07, { o: 1, sy: 1.15 }, EZ.out], [t + 0.13, { o: 1, sy: 0.3 }, EZ.in]]);
  b.set('tongue', t + 0.14, { o: 0, sy: 1 });
  b.set('yawn', t + 0.15, { o: 0, sx: 1, sy: 1 });
  b.set('mouth', t + 0.15, { o: 1 });
}

/** The approved yawn (night/moves.ts): mouth-open scaled up, the closed mouth hidden. */
export function yawn(b: Builder, t: number, open: number, hold: number, close: number, big: { sx: number; sy: number }): void {
  b.set('mouth', t, { o: 0 });
  b.set('yawn', t, { o: 1, sx: 1, sy: 1 });
  b.p('yawn', t, [[t + open, { o: 1, ...big }, EZ.out], [t + open + hold, { o: 1, sx: big.sx * 0.95, sy: big.sy * 0.93 }, EZ.ease], [t + open + hold + close, { o: 1, sx: 1, sy: 1 }, EZ.in]]);
  b.set('yawn', t + open + hold + close + 0.02, { o: 0, sx: 1, sy: 1 });
  b.set('mouth', t + open + hold + close + 0.02, { o: 1 });
}

/**
 * Where a paw must be translated so its CENTRE lands at (cx, cy) with rotation r (the paw turns about the bottom of
 * its box, CSS 50% 100%). side: -1 = his right paw on the viewer's left (`.paw-l`), 1 = `.paw-r`.
 */
export function pawAt(b: Builder, side: -1 | 1, cx: number, cy: number, r = 0, s = 1): Channels {
  const g = b.geo.paw;
  // the centre relative to the pivot (straight above it), scaled and turned with the paw: R(r)·(0, vy)
  const vy = (g.y - g.pivotY) * s;
  const a = (r * Math.PI) / 180;
  const ox = -vy * Math.sin(a);
  const oy = vy * Math.cos(a);
  return { x: cx - side * g.x - ox, y: cy - g.pivotY - oy, r, sx: s, sy: s };
}

// ---- 2D affine (only to place the stretch's paws on the floor while the body is turned) ----
type M = readonly [number, number, number, number, number, number];
const mul = (A: M, B: M): M => [
  A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
];
const inv = (A: M): M => {
  const d = A[0] * A[3] - A[1] * A[2];
  return [A[3] / d, -A[1] / d, -A[2] / d, A[0] / d, (A[2] * A[5] - A[3] * A[4]) / d, (A[1] * A[4] - A[0] * A[5]) / d];
};
const ap = (A: M, x: number, y: number): [number, number] => [A[0] * x + A[2] * y + A[4], A[1] * x + A[3] * y + A[5]];
/** CSS `translate(x, y) rotate(r) scale(sx, sy)` about the origin (ox, oy). */
function cssM(c: Channels, ox: number, oy: number): M {
  const a = ((c.r ?? 0) * Math.PI) / 180;
  const co = Math.cos(a);
  const si = Math.sin(a);
  let m: M = [1, 0, 0, 1, ox + (c.x ?? 0), oy + (c.y ?? 0)];
  m = mul(m, [co, si, -si, co, 0, 0]);
  m = mul(m, [c.sx ?? 1, 0, 0, c.sy ?? 1, 0, 0]);
  return mul(m, [1, 0, 0, 1, -ox, -oy]);
}

/** The right lop ear's lowest point, the ear turned by r (degrees) and its wrapper moved by (tx, ty). */
export function earTip(b: Builder, r: number, tx = 0, ty = 0): { x: number; y: number } {
  const e = b.geo.ear;
  const a = (r * Math.PI) / 180;
  const dx = e.tx - e.px;
  const dy = e.ty - e.py;
  return { x: e.px + dx * Math.cos(a) - dy * Math.sin(a) + tx, y: e.py + dx * Math.sin(a) + dy * Math.cos(a) + ty };
}

// ------------------------------------------------------------------------------------------------ Pompon

export const GROOM_S = 3.75;

function authorGroom(b: Builder): Shot {
  // 1 · both paws up to the face, eyes ^ ^
  b.marks.paws = 0;
  toHappy(b, 0.16);
  b.p('pawL', 0, [[0.3, pawAt(b, -1, -10, -74, 12), EZ.out]]);
  b.p('pawR', 0.03, [[0.33, pawAt(b, 1, 13, -88, -30), EZ.out]]);
  b.p('lineL', 0, [[0.22, { o: 1 }, EZ.ease]]);
  b.p('lineR', 0.03, [[0.25, { o: 1 }, EZ.ease]]);
  b.p('squash', 0, [[0.3, { sx: 1.01, sy: 0.985 }, EZ.out]]);

  // 2 · three strokes over the face: each paw in turn up along the side of the muzzle and down over the cheek
  //     (in turn, tilted in: two round paws side by side at eye height would read as glasses)
  b.marks.wash = 0.34;
  for (let i = 0; i < 3; i++) {
    const t = 0.34 + i * 0.34;
    b.p('pawL', t, [[t + 0.17, pawAt(b, -1, -13, -88, 30), EZ.ease], [t + 0.34, pawAt(b, -1, -10, -74, 12), EZ.ease]]);
    b.p('pawR', t, [[t + 0.17, pawAt(b, 1, 10, -74, -12), EZ.ease], [t + 0.34, pawAt(b, 1, 13, -88, -30), EZ.ease]]);
    b.p('face', t, [[t + 0.17, { x: -0.6, y: 0.6 }, EZ.ease], [t + 0.34, { x: 0.6, y: 0.6 }, EZ.ease]]);
    b.p('body', t, [[t + 0.17, { r: 1.2 }, EZ.ease], [t + 0.34, { r: -1.2 }, EZ.ease]]);
  }

  // 3 · licks his paws: together at the mouth, two little licks
  const l0 = 1.42;
  b.marks.lick = l0;
  b.p('pawL', l0, [[l0 + 0.12, pawAt(b, -1, -6.5, -62, 22), EZ.out]]);
  b.p('pawR', l0, [[l0 + 0.12, pawAt(b, 1, 6.5, -62, -22), EZ.out]]);
  b.p('face', l0, [[l0 + 0.12, { y: 1.6 }, EZ.out]]);
  b.p('body', l0, [[l0 + 0.12, { r: 0 }, EZ.out]]);
  lick(b, l0 + 0.13);
  lick(b, l0 + 0.31);

  // 4 · reaches for his right ear (on the viewer's right) and pulls it down in front of his face
  const e0 = 1.86;
  const ER = 30;
  const te = { x: -3, y: 2.5 };
  b.marks.ear = e0;
  const tip = earTip(b, ER, te.x, te.y);
  b.p('body', e0, [[e0 + 0.3, { r: 6 }, EZ.inOut]]);
  b.p('face', e0, [[e0 + 0.3, { x: 1.5, y: 1 }, EZ.inOut]]);
  b.p('earR', e0 + 0.06, [[e0 + 0.36, { r: ER }, EZ.inOut]]);
  b.p('teR', e0 + 0.06, [[e0 + 0.36, te, EZ.inOut]]);
  b.p('pawR', e0, [[e0 + 0.2, pawAt(b, 1, tip.x + 9, tip.y - 16, -12), EZ.out], [e0 + 0.36, pawAt(b, 1, tip.x + 7, tip.y - 5, -18), EZ.inOut]]);
  b.p('pawL', e0, [[e0 + 0.2, pawAt(b, -1, tip.x - 5, tip.y - 13, 20), EZ.out], [e0 + 0.36, pawAt(b, -1, tip.x - 8, tip.y + 1, 30), EZ.inOut]]);

  // 5 · cleans it: two pulls through his paws, a lick each time
  for (let j = 0; j < 2; j++) {
    const t = 2.24 + j * 0.38;
    const tip2 = earTip(b, ER + 4, te.x, te.y + 2);
    b.p('earR', t, [[t + 0.16, { r: ER + 4 }, EZ.ease], [t + 0.38, { r: ER }, EZ.ease]]);
    b.p('teR', t, [[t + 0.16, { x: te.x, y: te.y + 2 }, EZ.ease], [t + 0.38, te, EZ.ease]]);
    b.p('pawR', t, [[t + 0.16, pawAt(b, 1, tip2.x + 7, tip2.y - 5, -18), EZ.ease], [t + 0.38, pawAt(b, 1, tip.x + 7, tip.y - 5, -18), EZ.ease]]);
    b.p('pawL', t, [[t + 0.16, pawAt(b, -1, tip2.x - 8, tip2.y + 1, 30), EZ.ease], [t + 0.38, pawAt(b, -1, tip.x - 8, tip.y + 1, 30), EZ.ease]]);
    b.p('face', t, [[t + 0.16, { x: 2.4, y: 1.8 }, EZ.ease], [t + 0.38, { x: 1.5, y: 1 }, EZ.ease]]);
    lick(b, t + 0.1);
  }

  // 6 · lets go: the ear springs back (overshoot ≤ 9°), paws down, head up, eyes open
  const r0 = 3.02;
  b.marks.release = r0;
  b.p('earR', r0, [[r0 + 0.12, { r: -9 }, EZ.out], [r0 + 0.26, { r: 4 }, EZ.ease], [r0 + 0.38, { r: -1.5 }, EZ.ease], [r0 + 0.48, { r: 0 }, EZ.ease]]);
  b.p('teR', r0, [[r0 + 0.12, {}, EZ.out]]);
  b.p('pawL', r0, [[r0 + 0.3, {}, EZ.spring]]);
  b.p('pawR', r0 + 0.03, [[r0 + 0.33, {}, EZ.spring]]);
  b.p('lineL', r0 + 0.12, [[r0 + 0.32, {}, EZ.ease]]);
  b.p('lineR', r0 + 0.15, [[r0 + 0.35, {}, EZ.ease]]);
  b.p('body', r0, [[r0 + 0.3, { r: 0 }, EZ.inOut]]);
  b.p('face', r0, [[r0 + 0.24, {}, EZ.inOut]]);
  b.p('squash', r0, [[r0 + 0.3, {}, EZ.inOut]]);
  toOpen(b, r0 + 0.3);
  blink(b, 3.5, 0.14);
  return b.shot('groom', GROOM_S);
}

export const PERISCOPE_S = 2.7;

/**
 * Round 2 (Felix: «лапки очень странные, будто ноги появляются»): no legs any more. His own hind feet stay planted
 * and visible as when he sits; the body rises a little from them (10 units — the feet still reach up into it, nothing
 * opens between them and the body), front paws up at the chest, nose up, looks left and right, sniffs, sits down.
 * Nothing is squashed or stretched.
 */
function authorPeriscope(b: Builder): Shot {
  const H = 10;
  // a little dip before the rise
  b.marks.crouch = 0;
  b.p('body', 0, [[0.16, { y: 1.5 }, EZ.out]]);
  b.p('earL', 0.02, [[0.16, { r: 3 }, EZ.out]]);
  b.p('earR', 0.02, [[0.16, { r: -3 }, EZ.out]]);
  // up on his hind feet: the body rises from them, the feet stay on the floor (a hair narrower: on their toes)
  const u0 = 0.16;
  const u1 = 0.42;
  b.marks.up = u0;
  b.p('body', u0, [[u1, { y: -H - 1.5 }, EZ.out], [u1 + 0.14, { y: -H }, EZ.ease]]);
  b.p('footL', u0, [[u1, { x: 1, y: -2, sx: 0.95 }, EZ.out]]);
  b.p('footR', u0, [[u1, { x: -1, y: -2, sx: 0.95 }, EZ.out]]);
  b.p('pawL', u0 + 0.03, [[u1, { x: 3, y: -12, r: 24 }, EZ.out]]);
  b.p('pawR', u0 + 0.05, [[u1 + 0.02, { x: -3, y: -12, r: -24 }, EZ.out]]);
  b.p('face', u0, [[u1, { y: -1.5 }, EZ.out]]);
  b.p('earL', u0, [[u0 + 0.12, { r: 7 }, EZ.out], [u1 + 0.08, { r: -3 }, EZ.ease], [u1 + 0.2, { r: 1 }, EZ.ease], [u1 + 0.3, { r: 0 }, EZ.ease]]);
  b.p('earR', u0, [[u0 + 0.12, { r: -7 }, EZ.out], [u1 + 0.08, { r: 3 }, EZ.ease], [u1 + 0.2, { r: -1 }, EZ.ease], [u1 + 0.3, { r: 0 }, EZ.ease]]);
  b.p('shadow', u0, [[u1, { sx: 0.93, sy: 0.96 }, EZ.out]]);
  // looks around: left, right, sniffs on the right
  const L = 0.66;
  b.marks.look = L;
  b.p('face', L, [[L + 0.24, { x: -3.4, y: -2 }, EZ.inOut], [L + 0.52, { x: -3.4, y: -2 }], [L + 0.82, { x: 3.4, y: -2 }, EZ.inOut], [L + 1.16, { x: 3.4, y: -2 }], [L + 1.36, { y: -1.5 }, EZ.inOut]]);
  b.p('body', L, [[L + 0.24, { y: -H, r: -2.5 }, EZ.inOut], [L + 0.52, { y: -H, r: -2.5 }], [L + 0.82, { y: -H, r: 2.5 }, EZ.inOut], [L + 1.16, { y: -H, r: 2.5 }], [L + 1.36, { y: -H, r: 0 }, EZ.inOut]]);
  b.p('earL', L, [[L + 0.3, { r: -3 }, EZ.ease], [L + 0.5, { r: 0 }, EZ.ease], [L + 0.88, { r: 3 }, EZ.ease], [L + 1.08, { r: 0 }, EZ.ease]]);
  b.p('earR', L, [[L + 0.3, { r: -3 }, EZ.ease], [L + 0.5, { r: 0 }, EZ.ease], [L + 0.88, { r: 3 }, EZ.ease], [L + 1.08, { r: 0 }, EZ.ease]]);
  blink(b, L + 0.58, 0.14);
  b.marks.sniff = L + 0.88;
  wiggleNose(b, L + 0.88, 4, 0.09);
  // sits down again: the body back onto its feet, a tiny settle (no squash), the ears answer
  const d1 = 2.22;
  b.marks.down = d1 - 0.2;
  b.p('body', d1 - 0.2, [[d1, { y: 0.8 }, EZ.in], [d1 + 0.16, {}, EZ.out]]);
  b.p('face', d1 - 0.2, [[d1, {}, EZ.ease]]);
  b.p('pawL', d1 - 0.2, [[d1, {}, EZ.in]]);
  b.p('pawR', d1 - 0.2, [[d1, {}, EZ.in]]);
  b.p('footL', d1 - 0.16, [[d1, {}, EZ.ease]]);
  b.p('footR', d1 - 0.16, [[d1, {}, EZ.ease]]);
  b.p('earL', d1, [[d1 + 0.06, { r: 7 }, EZ.out], [d1 + 0.18, { r: -3 }, EZ.ease], [d1 + 0.3, { r: 1 }, EZ.ease], [d1 + 0.4, { r: 0 }, EZ.ease]]);
  b.p('earR', d1, [[d1 + 0.06, { r: -7 }, EZ.out], [d1 + 0.18, { r: 3 }, EZ.ease], [d1 + 0.3, { r: -1 }, EZ.ease], [d1 + 0.4, { r: 0 }, EZ.ease]]);
  b.p('shadow', d1 - 0.2, [[d1, { sx: 1.03 }, EZ.in], [d1 + 0.2, {}, EZ.out]]);
  return b.shot('periscope', PERISCOPE_S);
}

/** The approved 3/4 turn to the right (BUNNY_CSS `.turn-r …`), as track values. */
const TURN_R: Pose = {
  tf: { x: 13, sx: 0.88 },
  tp: { x: 9 },
  teL: { x: 16, sx: 0.86, sy: 0.86 },
  teR: { x: 8 },
  tcL: { sx: 0.55, sy: 0.55 },
  tcR: { sx: 1.04, sy: 1.04 },
  tfootL: { x: 12, sx: 0.9, sy: 0.9 },
  tfootR: { x: 5 },
  tailL: { o: 1 },
};

function turn(b: Builder, t0: number, t1: number, to: 'right' | 'front'): void {
  for (const n of Object.keys(TURN_R) as PartName[]) b.p(n, t0, [[t1, to === 'right' ? (TURN_R[n] ?? {}) : {}, EZ.turn]]);
}

export const STRETCH_S = 3.3;

/**
 * Round 2 (Felix: «будто его плющит, выглядит не натурально»): no squash at all. Seen 3/4: the front paws slide far
 * forward low along the floor, the front of the body goes down — the body turns forward about its REAR-bottom, so the
 * rear stays up where it sits (and lifts a hair), the chest meets the floor (the floor clip flattens it there) — and the
 * body gets LONGER: its rear slides back (the round rear piece behind the body, rig.ts). Head and ears only turn with
 * it, never flattened. A small yawn, back, turns to you, a gentle shake (turns only).
 */
function authorStretch(b: Builder): Shot {
  // 1 · turns 3/4 to the right (the approved turn)
  b.marks.turn = 0;
  turn(b, 0.02, 0.3, 'right');
  // the body turns forward about its rear-bottom (x = -45): front down, rear up; lifted a hair so the chest only touches
  const RX = -45;
  const bodyAt = (deg: number): Channels => {
    const a = (deg * Math.PI) / 180;
    return { x: RX * (1 - Math.cos(a)), y: -RX * Math.sin(a) - deg * 0.6, r: deg };
  };
  // front paws forward on the floor: where they must be in their own (turned) coordinates
  const pawFloor = (side: -1 | 1, deg: number, wx: number, wy: number, r: number): Channels => {
    const g = b.geo.paw;
    const m = mul(cssM(bodyAt(deg), BODY_ORIGIN.x, BODY_ORIGIN.y), cssM({ x: 9 }, 0, 0));
    const [lx, ly] = ap(inv(m), wx, wy);
    return { x: lx - side * g.x, y: ly - g.pivotY, r, sx: 1, sy: 1 };
  };
  const s0 = 0.32;
  const s1 = 0.86;
  const BACK = 16;
  b.marks.reach = s0;
  b.p('body', s0, [[s1, bodyAt(8), EZ.inOut]]);
  b.p('rear', s0, [[s1, { x: -BACK }, EZ.inOut]]);
  b.p('tailL', 0.3, [[s1, { x: -BACK, o: 1 }, EZ.inOut]]);
  b.p('pawR', s0, [[s0 + 0.26, pawFloor(1, 4, 58, -14, 30), EZ.out], [s1, pawFloor(1, 8, 84, -1, 58), EZ.inOut]]);
  b.p('pawL', s0 + 0.06, [[s0 + 0.32, pawFloor(-1, 4.5, 44, -16, 30), EZ.out], [s1 + 0.04, pawFloor(-1, 8, 68, -3, 58), EZ.inOut]]);
  b.p('earL', s0, [[s0 + 0.3, { r: -4 }, EZ.ease], [s1 + 0.1, { r: -2 }, EZ.ease]]);
  b.p('earR', s0, [[s0 + 0.3, { r: -5 }, EZ.ease], [s1 + 0.1, { r: -3 }, EZ.ease]]);
  b.p('shadow', s0, [[s1, { x: 8, sx: 1.18 }, EZ.inOut]]);
  // 2 · the long stretch: a little further, eyes squeezed, a small yawn
  const h1 = 1.84;
  b.marks.stretch = s1;
  b.p('body', s1, [[h1 - 0.1, bodyAt(9.5), EZ.ease]]);
  b.p('rear', s1, [[h1 - 0.1, { x: -BACK - 3 }, EZ.ease]]);
  b.p('tailL', s1, [[h1 - 0.1, { x: -BACK - 3, o: 1 }, EZ.ease]]);
  b.p('pawR', s1 + 0.04, [[h1 - 0.1, pawFloor(1, 9.5, 88, -1, 60), EZ.ease]]);
  b.p('pawL', s1 + 0.08, [[h1 - 0.1, pawFloor(-1, 9.5, 72, -3, 60), EZ.ease]]);
  for (const n of EYES) b.p(n, 0.9, [[1.04, { sx: 1, sy: 0.25 }, EZ.ease], [1.66, { sx: 1, sy: 0.3 }], [1.78, { sx: 1, sy: 0.55 }, EZ.ease]]);
  b.marks.yawn = 1.04;
  yawn(b, 1.04, 0.18, 0.26, 0.16, { sx: 1.6, sy: 2 });
  // 3 · back to sitting (still 3/4)
  const k1 = 2.24;
  b.marks.back = h1;
  b.p('body', h1, [[k1, {}, EZ.inOut]]);
  b.p('rear', h1, [[k1, {}, EZ.inOut]]);
  b.p('tailL', h1, [[k1, { o: 1 }, EZ.inOut]]);
  b.p('pawR', h1, [[k1 - 0.04, {}, EZ.inOut]]);
  b.p('pawL', h1 + 0.04, [[k1, {}, EZ.inOut]]);
  b.p('earL', h1, [[k1, { r: 0 }, EZ.ease]]);
  b.p('earR', h1, [[k1, { r: 0 }, EZ.ease]]);
  b.p('shadow', h1, [[k1, {}, EZ.inOut]]);
  for (const n of EYES) b.p(n, h1 + 0.1, [[h1 + 0.24, { sx: 1, sy: 1 }, EZ.out]]);
  // 4 · turns to you, a gentle shake: the body turns a little left-right, the ears answer (nothing is squashed)
  turn(b, k1 + 0.02, k1 + 0.3, 'front');
  const z0 = 2.6;
  b.marks.shake = z0;
  b.p('body', z0, [[z0 + 0.08, { r: 2 }, EZ.ease], [z0 + 0.17, { r: -1.7 }, EZ.ease], [z0 + 0.26, { r: 1 }, EZ.ease], [z0 + 0.36, { r: 0 }, EZ.ease]]);
  b.p('earL', z0 + 0.03, [[z0 + 0.11, { r: -8 }, EZ.ease], [z0 + 0.2, { r: 6 }, EZ.ease], [z0 + 0.29, { r: -3 }, EZ.ease], [z0 + 0.4, { r: 0 }, EZ.ease]]);
  b.p('earR', z0 + 0.03, [[z0 + 0.11, { r: -7 }, EZ.ease], [z0 + 0.2, { r: 7 }, EZ.ease], [z0 + 0.29, { r: -3 }, EZ.ease], [z0 + 0.4, { r: 0 }, EZ.ease]]);
  b.p('face', z0, [[z0 + 0.08, { x: 1 }, EZ.ease], [z0 + 0.17, { x: -0.8 }, EZ.ease], [z0 + 0.3, {}, EZ.ease]]);
  for (const n of EYES) b.p(n, z0, [[z0 + 0.05, { sx: 1, sy: 0.3 }, EZ.in], [z0 + 0.3, { sx: 1, sy: 0.3 }], [z0 + 0.4, { sx: 1, sy: 1 }, EZ.out]]);
  return b.shot('stretch', STRETCH_S, ['floor', 'rear']);
}

export const LOAF_S = 4.2;

/**
 * Round 2 (Felix: «будто что то не то»): no squash — the head and ears keep their shape. A real loaf: the front paws
 * slide down and tuck under the chest (clipped by his own outline, they go under its edge — nothing fades), the hind
 * feet slip in under the body, the bottom spreads a little (the hip pieces behind the body, rig.ts), the ears lie close
 * and low, eyes half closed and content; two tiny slow breaths, one slow blink, an ear twitch; then out again.
 */
function authorLoaf(b: Builder): Shot {
  // 1 · settles into a loaf
  b.marks.settle = 0;
  b.p('pawL', 0.05, [[0.62, { x: 2, y: 56 }, EZ.inOut]]);
  b.p('pawR', 0.08, [[0.65, { x: -2, y: 56 }, EZ.inOut]]);
  b.p('footL', 0.1, [[0.62, { x: 12, y: -5 }, EZ.inOut]]);
  b.p('footR', 0.12, [[0.64, { x: -12, y: -5 }, EZ.inOut]]);
  b.p('hipL', 0.15, [[0.7, { x: -8, y: 2 }, EZ.inOut]]);
  b.p('hipR', 0.15, [[0.7, { x: 8, y: 2 }, EZ.inOut]]);
  b.p('earL', 0.1, [[0.7, { r: -3 }, EZ.inOut]]);
  b.p('earR', 0.1, [[0.7, { r: 3 }, EZ.inOut]]);
  b.p('teL', 0.1, [[0.7, { y: 2 }, EZ.inOut]]);
  b.p('teR', 0.1, [[0.7, { y: 2 }, EZ.inOut]]);
  b.p('lidL', 0.2, [[0.8, { y: 8.5 }, EZ.inOut]]);
  b.p('lidR', 0.2, [[0.8, { y: 8.5 }, EZ.inOut]]);
  b.p('cheekL', 0.1, [[0.7, { sx: 1.03, sy: 1.03 }, EZ.inOut]]);
  b.p('cheekR', 0.1, [[0.7, { sx: 1.03, sy: 1.03 }, EZ.inOut]]);
  b.p('face', 0.1, [[0.7, { y: 0.8 }, EZ.inOut]]);
  b.p('shadow', 0, [[0.7, { sx: 1.07 }, EZ.inOut]]);
  // 2 · two tiny slow breaths (the hips and the cheeks swell a little), one slow blink, an ear twitch
  b.marks.loaf = 0.75;
  for (let i = 0; i < 2; i++) {
    const tb = 0.75 + i * 1.3;
    b.p('hipL', tb, [[tb + 0.65, { x: -9.3, y: 2 }, EZ.ease], [tb + 1.3, { x: -8, y: 2 }, EZ.ease]]);
    b.p('hipR', tb, [[tb + 0.65, { x: 9.3, y: 2 }, EZ.ease], [tb + 1.3, { x: 8, y: 2 }, EZ.ease]]);
    b.p('cheekL', tb, [[tb + 0.65, { sx: 1.05, sy: 1.045 }, EZ.ease], [tb + 1.3, { sx: 1.03, sy: 1.03 }, EZ.ease]]);
    b.p('cheekR', tb, [[tb + 0.65, { sx: 1.05, sy: 1.045 }, EZ.ease], [tb + 1.3, { sx: 1.03, sy: 1.03 }, EZ.ease]]);
    b.p('face', tb, [[tb + 0.65, { y: 0.5 }, EZ.ease], [tb + 1.3, { y: 0.8 }, EZ.ease]]);
  }
  b.marks.blink = 1.7;
  for (const n of ['lidL', 'lidR'] as const) b.p(n, 1.7, [[2.0, { y: 17 }, EZ.inOut], [2.2, { y: 17 }], [2.5, { y: 8.5 }, EZ.inOut]]);
  b.marks.ear = 2.75;
  b.p('earR', 2.75, [[2.81, { r: -8 }, 'ease-out'], [2.91, { r: 5 }, EZ.ease], [3.01, { r: 3 }, EZ.ease]]);
  // 3 · out of the loaf again
  const w0 = 3.4;
  b.marks.out = w0;
  b.p('lidL', w0, [[w0 + 0.3, {}, EZ.inOut]]);
  b.p('lidR', w0, [[w0 + 0.3, {}, EZ.inOut]]);
  b.p('pawL', w0, [[w0 + 0.5, {}, EZ.out]]);
  b.p('pawR', w0 + 0.03, [[w0 + 0.53, {}, EZ.out]]);
  b.p('footL', w0, [[w0 + 0.5, {}, EZ.inOut]]);
  b.p('footR', w0, [[w0 + 0.5, {}, EZ.inOut]]);
  b.p('hipL', w0, [[w0 + 0.45, {}, EZ.inOut]]);
  b.p('hipR', w0, [[w0 + 0.45, {}, EZ.inOut]]);
  for (const n of ['earL', 'earR', 'teL', 'teR', 'face', 'cheekL', 'cheekR', 'shadow'] as const) b.p(n, w0, [[w0 + 0.45, {}, EZ.inOut]]);
  blink(b, 3.98, 0.15);
  return b.shot('loaf', LOAF_S, ['hips', 'pawClip']);
}

export const SNEEZE_S = 2.25;

/**
 * Round 2 polish (Felix: «чих неплохо, но можно чуть доработать»): no squash any more; the build-up is little
 * nose twitches in pairs with pauses (cuter), the head tips back in small steps; on «апчх» a short head jerk down and
 * forward (the face snaps, the body nods), a tiny bounce, the ears fling out together and swing back twice (cleaner);
 * then the surprised eyes and two blinks as before.
 */
function authorSneeze(b: Builder): Shot {
  // 1 · it tickles: twitch-twitch … twitch-twitch … «а-а…»
  b.marks.tickle = 0;
  const tw: Key = [0, { sx: 1.07, sy: 0.88 }, EZ.ease];
  const tw2: Key = [0, { sx: 1.1, sy: 0.84 }, EZ.ease];
  const at = (k: Key, t: number): Key => [t, k[1], k[2]];
  b.p('nose', 0.02, [
    at(tw, 0.06), [0.1, {}, EZ.ease], at(tw, 0.14), [0.19, {}, EZ.ease],
    at(tw2, 0.3), [0.34, {}, EZ.ease], at(tw2, 0.38), [0.43, {}, EZ.ease],
    [0.6, { sx: 1.18, sy: 0.78 }, EZ.ease],
  ]);
  b.p('face', 0.1, [[0.2, { y: -1 }, EZ.out], [0.3, { y: -1 }], [0.42, { y: -1.9 }, EZ.out], [0.6, { y: -2.7 }, EZ.ease]]);
  b.p('body', 0.1, [[0.6, { r: -2.5 }, EZ.ease]]);
  for (const n of EYES) b.p(n, 0.12, [[0.32, { sx: 1, sy: 0.72 }, EZ.ease], [0.6, { sx: 1, sy: 0.4 }, EZ.in]]);
  b.set('mouth', 0.42, { o: 0 });
  b.set('yawn', 0.42, { o: 1, sx: 0.8, sy: 1 });
  b.p('earL', 0.1, [[0.58, { r: -3 }, EZ.ease]]);
  b.p('earR', 0.1, [[0.58, { r: 3 }, EZ.ease]]);
  // 2 · «апчх!»: a short head jerk (the face snaps down, the body nods forward), a tiny bounce, eyes shut, the ears
  //     fling out together and swing back twice; four little rays
  const A = 0.64;
  b.marks.achoo = A;
  b.p('face', A, [[A + 0.04, { y: 3.4 }, EZ.out], [A + 0.14, { y: 2 }, EZ.ease], [A + 0.38, {}, EZ.ease]]);
  b.p('body', A, [[A + 0.04, { r: 3.5 }, EZ.out], [A + 0.2, { r: -1 }, EZ.ease], [A + 0.34, { r: 0.3 }, EZ.ease], [A + 0.44, { r: 0 }, EZ.ease]]);
  b.p('hop', A + 0.03, [[A + 0.12, { y: -5 }, EZ.out], [A + 0.22, { y: 0 }, EZ.in], [A + 0.27, { y: -0.8 }, EZ.out], [A + 0.32, { y: 0 }, EZ.in]]);
  for (const n of EYES) b.p(n, A, [[A + 0.03, { sx: 1, sy: 0.1 }, EZ.in]]);
  b.p('yawn', A, [[A + 0.03, { o: 1, sx: 1.25, sy: 1.45 }, EZ.out], [A + 0.14, { o: 1, sx: 0.9, sy: 1 }, EZ.ease]]);
  b.set('yawn', A + 0.16, { o: 0, sx: 1, sy: 1 });
  b.set('mouth', A + 0.16, { o: 1 });
  b.p('nose', A, [[A + 0.04, { sx: 0.86, sy: 1.12 }, EZ.out], [A + 0.2, {}, EZ.ease]]);
  PUFF_NAMES.forEach((n, i) => {
    const [dx, dy] = PUFF_DIRS[i] ?? [0, 0];
    b.set(n, A + 0.02, { o: 1 });
    b.p(n, A + 0.02, [[A + 0.16, { x: dx * 3.5, y: dy * 3.5, o: 1 }, EZ.out], [A + 0.36, { x: dx * 6.5, y: dy * 6.5, o: 0 }, EZ.ease]]);
    b.set(n, A + 0.38, {});
  });
  b.p('earL', A, [[A + 0.06, { r: 12 }, EZ.out], [A + 0.2, { r: -5 }, EZ.ease], [A + 0.33, { r: 2 }, EZ.ease], [A + 0.44, { r: 0 }, EZ.ease]]);
  b.p('earR', A, [[A + 0.06, { r: -12 }, EZ.out], [A + 0.2, { r: 5 }, EZ.ease], [A + 0.33, { r: -2 }, EZ.ease], [A + 0.44, { r: 0 }, EZ.ease]]);
  b.p('shadow', A + 0.03, [[A + 0.12, { sx: 0.92 }, EZ.out], [A + 0.22, { sx: 1.02 }, EZ.in], [A + 0.32, {}, EZ.ease]]);
  // 3 · round surprised eyes ("что это было?"), a glance, two blinks
  const s0 = A + 0.36;
  b.marks.what = s0;
  for (const n of EYES) b.p(n, s0, [[s0 + 0.08, { sx: 1.2, sy: 1.2 }, EZ.out], [s0 + 0.55, { sx: 1.2, sy: 1.2 }], [s0 + 0.65, { sx: 1, sy: 1 }, EZ.ease]]);
  b.p('face', s0 + 0.1, [[s0 + 0.25, { x: -1.8 }, EZ.ease], [s0 + 0.45, { x: 1.8 }, EZ.ease], [s0 + 0.6, {}, EZ.ease]]);
  blink(b, s0 + 0.74, 0.13);
  blink(b, s0 + 0.92, 0.13);
  return b.shot('sneeze', SNEEZE_S);
}

export const DIG_S = 2.55;

function authorDig(b: Builder): Shot {
  // 1 · looks down at the floor, leans in a little
  b.marks.look = 0;
  b.p('face', 0, [[0.24, { y: 2.8 }, EZ.out]]);
  b.p('squash', 0, [[0.24, { sx: 1.02, sy: 0.965 }, EZ.out]]);
  b.p('body', 0, [[0.24, { y: 1.5 }, EZ.out]]);
  b.p('earL', 0, [[0.24, { r: -2 }, EZ.out]]);
  b.p('earR', 0, [[0.24, { r: 2 }, EZ.out]]);
  // 2 · digs: ten quick strokes, the paws in turn — down to the floor, scrape back up; a dust puff each time
  b.marks.dig = 0.26;
  const first = 0.26;
  const P = 0.32;
  const down = (s: number): Channels => ({ x: -s * 1, y: 30, r: -s * 6, sx: 1.05, sy: 0.9 });
  const up = (s: number): Channels => ({ x: s * 4, y: 14, r: s * 12 });
  for (const [n, s, off] of [['pawL', -1, 0], ['pawR', 1, P / 2]] as const) {
    const t0 = first + off;
    b.p(n, t0 - 0.12, [[t0, up(s), EZ.out]]);
    for (let j = 0; j < 5; j++) {
      const t = t0 + j * P;
      b.p(n, t, [[t + 0.08, down(s), EZ.in], [t + P, up(s), EZ.out]]);
      // the dust: from the paw on the floor, out and up, fading (a different puff each stroke)
      const k = DUST_NAMES[(j * 2 + (s > 0 ? 1 : 0)) % DUST_NAMES.length];
      if (k) {
        const ti = t + 0.08;
        // out past his feet and flank (x ≈ ±80), where it shows against the page, and up; a different arc each time
        const far = 80 + (j % 2) * 8;
        b.set(k, ti, { x: s * 16, y: 3, sx: 0.4, sy: 0.4, o: 1 });
        b.p(k, ti, [[ti + 0.16, { x: s * (far - 16), y: -6 - (j % 3) * 2, sx: 0.95, sy: 0.95, o: 1 }, EZ.out], [ti + 0.42, { x: s * far, y: -12 - (j % 3) * 3, sx: 1.25, sy: 1.25, o: 0 }, EZ.ease]]);
        b.set(k, ti + 0.44, {});
      }
    }
  }
  // his shoulders rock with the strokes, the ears bob a little
  for (let i = 0; i < 10; i++) {
    const t = first + i * (P / 2) + 0.08;
    const s = i % 2 === 0 ? -1 : 1;
    b.p('body', t - 0.08, [[t, { y: 1.5, r: s * 1.2 }, EZ.ease]]);
    b.p('earL', t - 0.08, [[t, { r: -2 + s * 2.5 }, EZ.ease]]);
    b.p('earR', t - 0.08, [[t, { r: 2 + s * 2.5 }, EZ.ease]]);
  }
  // 3 · stops, sits up, a satisfied ^ ^
  const e0 = 1.98;
  b.marks.done = e0;
  b.p('pawL', e0, [[e0 + 0.24, {}, EZ.spring]]);
  b.p('pawR', e0 + 0.03, [[e0 + 0.27, {}, EZ.spring]]);
  b.p('body', e0, [[e0 + 0.24, {}, EZ.out]]);
  b.p('squash', e0, [[e0 + 0.24, {}, EZ.out]]);
  b.p('face', e0, [[e0 + 0.24, {}, EZ.out]]);
  b.p('earL', e0, [[e0 + 0.08, { r: 4 }, EZ.out], [e0 + 0.2, { r: -2 }, EZ.ease], [e0 + 0.32, { r: 0 }, EZ.ease]]);
  b.p('earR', e0, [[e0 + 0.08, { r: -4 }, EZ.out], [e0 + 0.2, { r: 2 }, EZ.ease], [e0 + 0.32, { r: 0 }, EZ.ease]]);
  toHappy(b, e0 + 0.06);
  toOpen(b, e0 + 0.42);
  return b.shot('dig', DIG_S);
}

// ------------------------------------------------------------------------------------------------ Tapsi

export const HWASH_S = 2.45;

function authorHamsterWash(b: Builder): Shot {
  // 1 · sits up a little, paws to his mouth, ^ ^
  b.marks.paws = 0;
  b.p('squash', 0, [[0.22, { sx: 0.985, sy: 1.03 }, EZ.out]]);
  b.p('pawL', 0, [[0.22, pawAt(b, -1, -7, -80, 26), EZ.out]]);
  b.p('pawR', 0.02, [[0.24, pawAt(b, 1, 7, -80, -26), EZ.out]]);
  toHappy(b, 0.12);
  // 2 · two quick licks
  b.marks.lick = 0.26;
  lick(b, 0.27);
  lick(b, 0.43);
  b.p('pawL', 0.26, [[0.34, pawAt(b, -1, -7, -82, 26), EZ.ease], [0.42, pawAt(b, -1, -7, -80, 26), EZ.ease], [0.5, pawAt(b, -1, -7, -82, 26), EZ.ease]]);
  b.p('pawR', 0.26, [[0.34, pawAt(b, 1, 7, -82, -26), EZ.ease], [0.42, pawAt(b, 1, 7, -80, -26), EZ.ease], [0.5, pawAt(b, 1, 7, -82, -26), EZ.ease]]);
  // 3 · the hamster wash: both tiny paws rub the face fast, in small circles (eyes to mouth), the cheeks squish
  b.marks.rub = 0.55;
  for (let i = 0; i < 6; i++) {
    const t = 0.55 + i * 0.175;
    b.p('pawL', t, [[t + 0.08, pawAt(b, -1, -13, -97, 30), EZ.ease], [t + 0.175, pawAt(b, -1, -8, -82, 14), EZ.ease]]);
    b.p('pawR', t + 0.02, [[t + 0.1, pawAt(b, 1, 13, -97, -30), EZ.ease], [t + 0.195, pawAt(b, 1, 8, -82, -14), EZ.ease]]);
    b.p('face', t, [[t + 0.08, { y: -0.8 }, EZ.ease], [t + 0.175, { y: 0.9 }, EZ.ease]]);
    b.p('body', t, [[t + 0.0875, { r: (i % 2 ? 1 : -1) * 1.4 }, EZ.ease]]);
    b.p('cheekL', t + 0.06, [[t + 0.12, { sx: 0.95, sy: 1.02 }, EZ.ease], [t + 0.175, {}, EZ.ease]]);
    b.p('cheekR', t + 0.08, [[t + 0.14, { sx: 0.95, sy: 1.02 }, EZ.ease], [t + 0.195, {}, EZ.ease]]);
  }
  // 4 · one big stroke back over the ears (they flatten and flick back)
  const o0 = 1.62;
  b.marks.ears = o0;
  // (beside the head, outside his golden cap: a golden paw on the golden cap would vanish)
  b.p('pawL', o0, [[o0 + 0.14, pawAt(b, -1, -58, -124, 40), EZ.ease], [o0 + 0.36, pawAt(b, -1, -16, -86, 18), EZ.ease]]);
  b.p('pawR', o0, [[o0 + 0.14, pawAt(b, 1, 60, -118, -40), EZ.ease], [o0 + 0.36, pawAt(b, 1, 16, -86, -18), EZ.ease]]);
  b.p('body', o0, [[o0 + 0.14, { r: 0 }, EZ.ease]]);
  b.p('earL', o0, [[o0 + 0.14, { r: -16 }, EZ.out], [o0 + 0.3, { r: 4 }, EZ.ease], [o0 + 0.42, { r: 0 }, EZ.ease]]);
  b.p('earR', o0, [[o0 + 0.14, { r: 14 }, EZ.out], [o0 + 0.3, { r: -3 }, EZ.ease], [o0 + 0.42, { r: 0 }, EZ.ease]]);
  b.p('tip', o0 + 0.16, [[o0 + 0.3, { r: -14 }, 'ease-out'], [o0 + 0.38, { r: 0 }, 'ease-out'], [o0 + 0.46, { r: -8 }, 'ease-out'], [o0 + 0.54, { r: 0 }, 'ease-out']]);
  b.p('face', o0, [[o0 + 0.14, { y: 1.5 }, EZ.ease], [o0 + 0.36, {}, EZ.ease]]);
  // 5 · done: paws down with a spring, eyes open, a blink
  const d0 = 2.0;
  b.marks.done = d0;
  b.p('pawL', d0, [[d0 + 0.2, {}, EZ.spring]]);
  b.p('pawR', d0 + 0.02, [[d0 + 0.22, {}, EZ.spring]]);
  b.p('squash', d0, [[d0 + 0.2, {}, EZ.ease]]);
  toOpen(b, d0 + 0.08);
  blink(b, d0 + 0.3, 0.13);
  return b.shot('hwash', HWASH_S);
}

export const POST_S = 2.4;

function authorPost(b: Builder): Shot {
  const H = 21;
  b.marks.crouch = 0;
  b.p('squash', 0, [[0.18, { sx: 1.04, sy: 0.95 }, EZ.out]]);
  // up like a little post: tall and straight, paws together at the chest, ears perked, nose up
  const u0 = 0.18;
  const u1 = 0.46;
  b.marks.up = u0;
  b.p('body', u0, [[u1, { y: -H - 2 }, EZ.out], [u1 + 0.12, { y: -H }, EZ.ease]]);
  b.p('squash', u0, [[u1 - 0.04, { sx: 0.955, sy: 1.055 }, EZ.out], [u1 + 0.14, { sx: 0.965, sy: 1.045 }, EZ.ease]]);
  // (together at the chest, but two paws: their centres stay ≈ 13 units apart)
  b.p('pawL', u0 + 0.02, [[u1, pawAt(b, -1, -6.5, -59, 20, 0.88), EZ.out]]);
  b.p('pawR', u0 + 0.04, [[u1 + 0.02, pawAt(b, 1, 6.5, -59, -20, 0.88), EZ.out]]);
  b.p('earL', u0, [[u1, { r: -8 }, EZ.out]]);
  b.p('tip', u0 + 0.1, [[u1, { r: -12 }, 'ease-out'], [u1 + 0.1, { r: -4 }, 'ease-out']]);
  b.p('face', u0, [[u1, { y: -2 }, EZ.out]]);
  b.p('shadow', u0, [[u1, { sx: 0.9, sy: 0.95 }, EZ.out]]);
  b.p('footL', u0, [[u1, { sx: 1.05, sy: 0.96 }, EZ.out]]);
  b.p('footR', u0, [[u1, { sx: 1.05, sy: 0.96 }, EZ.out]]);
  for (const n of EYES) b.p(n, u0, [[u1, { sx: 1.08, sy: 1.08 }, EZ.out]]);
  // sniffs the air: two bursts, a look up-left, up-right
  const s0 = 0.56;
  b.marks.sniff = s0;
  wiggleNose(b, s0, 4, 0.085, 1.1);
  b.p('nose', 1.16, [
    [1.2, { sx: 1.13, sy: 0.8 }, EZ.ease], [1.245, {}, EZ.ease], [1.29, { sx: 1.13, sy: 0.8 }, EZ.ease], [1.335, {}, EZ.ease],
    [1.38, { sx: 1.13, sy: 0.8 }, EZ.ease], [1.425, {}, EZ.ease],
  ]);
  b.p('face', s0, [[0.9, { x: -2, y: -3 }, EZ.inOut], [1.3, { x: 2, y: -3 }, EZ.inOut], [1.62, { y: -2 }, EZ.inOut]]);
  b.p('body', s0, [[0.9, { y: -H, r: -1.5 }, EZ.inOut], [1.3, { y: -H, r: 1.5 }, EZ.inOut], [1.62, { y: -H, r: 0 }, EZ.inOut]]);
  b.p('eyeL', 1.0, [[1.06, { sx: 1.08, sy: 0.12 }, EZ.in], [1.14, { sx: 1.08, sy: 1.08 }, EZ.out]]);
  b.p('eyeR', 1.0, [[1.06, { sx: 1.08, sy: 0.12 }, EZ.in], [1.14, { sx: 1.08, sy: 1.08 }, EZ.out]]);
  b.p('earR', 1.4, [[1.46, { r: 10 }, 'ease-out'], [1.56, { r: -3 }, EZ.ease], [1.64, { r: 0 }, EZ.ease]]);
  // drops down
  const d1 = 1.98;
  b.marks.down = d1 - 0.2;
  b.p('body', d1 - 0.2, [[d1, {}, EZ.in]]);
  b.p('squash', d1 - 0.2, [[d1 - 0.04, { sx: 0.975, sy: 1.03 }, EZ.ease], [d1 + 0.07, { sx: 1.06, sy: 0.94 }, EZ.out], [d1 + 0.28, {}, EZ.spring]]);
  b.p('pawL', d1 - 0.18, [[d1, {}, EZ.in]]);
  b.p('pawR', d1 - 0.18, [[d1, {}, EZ.in]]);
  b.p('face', d1 - 0.2, [[d1, {}, EZ.ease]]);
  b.p('footL', d1 - 0.1, [[d1 + 0.1, {}, EZ.ease]]);
  b.p('footR', d1 - 0.1, [[d1 + 0.1, {}, EZ.ease]]);
  for (const n of EYES) b.p(n, d1 - 0.1, [[d1 + 0.1, {}, EZ.ease]]);
  b.p('earL', d1, [[d1 + 0.06, { r: -12 }, EZ.out], [d1 + 0.18, { r: 4 }, EZ.ease], [d1 + 0.3, { r: 0 }, EZ.ease]]);
  b.p('tip', d1, [[d1 + 0.1, { r: -12 }, 'ease-out'], [d1 + 0.2, { r: 0 }, 'ease-out']]);
  b.p('shadow', d1 - 0.2, [[d1, { sx: 1.05 }, EZ.in], [d1 + 0.2, {}, EZ.out]]);
  return b.shot('post', POST_S);
}

// ------------------------------------------------------------------------------------------------ the catalogue

export interface AliveInfo {
  readonly id: AliveId;
  readonly kind: AliveKind;
  /** Russian title (as in Felix's list) and a German name */
  readonly ru: string;
  readonly de: string;
  readonly duration: number;
  /** one line for Felix (RU) */
  readonly line: string;
}

/** The eight approved moments (Felix 31.10: «Всё остальное хорошо»). */
export const ALIVE_MOVES: readonly AliveInfo[] = [
  { id: 'groom', kind: 'bunny', ru: 'Умывашки', de: 'Putzen', duration: GROOM_S, line: 'Трёт мордочку лапками по очереди (три раза), облизывает лапки, наклоняет голову, тянет правое ушко лапками вниз и чистит его, отпускает — ушко пружинит обратно.' },
  { id: 'periscope', kind: 'bunny', ru: 'Перископ', de: 'Männchen', duration: PERISCOPE_S, line: 'Приподнимается на задних лапах (ступни стоят на месте, тело поднимается от них), передние лапки у груди, смотрит влево и вправо, нюхает и садится.' },
  { id: 'stretch', kind: 'bunny', ru: 'Потягушки', de: 'Strecken', duration: STRETCH_S, line: 'Поворот 3/4: передние лапки далеко вперёд по полу, грудь вниз, попа остаётся наверху, тело вытягивается в длину (ничего не сплющивается); маленький зевок, садится, мягко отряхивается.' },
  { id: 'loaf', kind: 'bunny', ru: 'Буханочка', de: 'Brötchen', duration: LOAF_S, line: 'Прячет передние лапки под грудь и задние под себя, книзу чуть шире, ушки прижаты, глаза полузакрыты; два крошечных вдоха, медленное моргание, дёрнул ушком — и снова сидит.' },
  { id: 'sneeze', kind: 'bunny', ru: 'Чих', de: 'Hatschi', duration: SNEEZE_S, line: 'Нос подёргивается парами («щекотно»), голова откидывается назад, «а-а…» — «апчх!»: голова резко кивает вниз, подскок, уши разлетаются и два раза качаются; круглые удивлённые глаза, взгляд, два моргания.' },
  { id: 'dig', kind: 'bunny', ru: 'Копает', de: 'Buddeln', duration: DIG_S, line: 'Смотрит вниз и быстро копает край передними лапками по очереди, из-под лапок летят крошечные облачка пыли; остановился — довольные ^ ^.' },
  { id: 'hwash', kind: 'hamster', ru: 'Тапси умывается', de: 'Putzen', duration: HWASH_S, line: 'Привстаёт, облизывает лапки и очень быстро трёт мордочку крошечными лапками маленькими кругами (щёчки сминаются), потом одним большим движением проводит по ушкам.' },
  { id: 'post', kind: 'hamster', ru: 'Тапси столбик', de: 'Männchen', duration: POST_S, line: 'Встаёт столбиком — прямо и высоко, лапки вместе у груди, ушки торчком, нос вверх, нюхает воздух (два раза), смотрит по сторонам и опускается.' },
];

export const ALIVE_IDS: readonly AliveId[] = ALIVE_MOVES.map((m) => m.id);

/** The approved moment's catalogue line (null: not one of the eight). */
export function aliveInfo(id: string): AliveInfo | null {
  return ALIVE_MOVES.find((m) => m.id === id) ?? null;
}

const AUTHORS: Record<AliveId, (b: Builder) => Shot> = {
  groom: authorGroom,
  periscope: authorPeriscope,
  stretch: authorStretch,
  loaf: authorLoaf,
  sneeze: authorSneeze,
  dig: authorDig,
  hwash: authorHamsterWash,
  post: authorPost,
};

/** The moment's timeline on this rig (pure: the same rig and id always give the same keys). */
export function authorAlive(id: AliveId, rig: AliveRig): Shot {
  const info = aliveInfo(id);
  if (!info) throw new Error(`[alive] unknown moment ${id}`);
  if (info.kind !== rig.kind) throw new Error(`[alive] ${id} is not for the ${rig.kind}`);
  return AUTHORS[id](new Builder(rig));
}

/** Russian labels of the beats (frame strips). */
export const MARK_RU: Readonly<Record<string, string>> = {
  wind: 'замах', flop: 'плюх!', lie: 'лежит', twitch: 'ушко', up: 'встаёт', paws: 'лапки', wash: 'умывается', lick: 'облизывает',
  ear: 'ушко', release: 'отпускает', crouch: 'присел', look: 'смотрит', sniff: 'нюхает', down: 'вниз', turn: '3/4', reach: 'лапки вперёд',
  stretch: 'тянется', yawn: 'зевок', back: 'назад', shake: 'отряхнулся', settle: 'устраивается', loaf: 'буханочка', blink: 'моргает',
  out: 'встаёт', tickle: 'щекотно', achoo: 'апчх!', what: 'что это?', dig: 'копает', done: 'готово', rub: 'трёт', ears: 'по ушкам',
  swap: 'падает', land: 'плюх!', sleepy: 'засыпает', slump: 'сползает',
};
