/**
 * «Помпон в открытом списке» (approved 31.10) — every moment as ONE timeline. Moved here from the gallery prototype:
 * the package holds Pompon's side of every moment; the list's own elements (the gallery's mock tiles that drop in,
 * leave, glide; the count) join the same timeline through a `list` hook (demo/listplay/moves.ts), the app leaves its
 * list to React (apps/web features/wishes/listPompon.ts).
 *
 * A moment is a Shot: Tracks (src/timeline.ts) on Pompon's parts (+ the hook's own), so seek(t) gives the whole frame,
 * always the same. Only transform and opacity. Every moment starts from ANY pose (`from`: e.g. holding his ears in
 * selection mode) and ends at rest on his seat (or, `keep`, in a pose that stays: holding his ears). Finite: nothing
 * loops.
 *
 *   stroke   rub him: leans into the hand, ^ ^, blush, a tiny purr (teeth chatter: strokes at the cheek), two hearts,
 *            then a contented sigh (chest up and down, a small breath curl)
 *   boop     tap his nose: nose squish + fast wiggle, round eyes, ears flick up — then a giggle
 *   wish     he hops over to the new tile, pats it into place with both paws, a proud hop, back
 *   received he hops onto the tile, stamps a ✓ with his paw ("Erhalten"), a mini binky, back; then the tile leaves
 *   delete   the tile shrinks away while he waves "bye", he dusts off his paws
 *   select   selection mode starts (the tiles wobble): a little startle, he holds his ears, trembles a bit — and stays so
 *   relax    selection mode ends ("Fertig"): lets go of his ears, a relieved sigh
 *   move     «Verschieben»: the chosen tiles fly to the edge, he hops after them, looks after them (ear up), waves, back
 *   bulk     selection «Erhalten» / «Löschen»: lets go of his ears, the tiles leave
 *   end      the end of the list: he looks up the list, at you, waves, «Das war’s!»
 *   bounce   overscroll at the end: one tiny bounce
 *   peek     the empty list: he waits in a closed gift box; now and then the lid lifts a crack and his eyes look out
 *   pop      "+": the box wiggles, his head knocks the lid off (it lands beside the box), he jumps out (stars, once)
 *   pull     pull his ear: "ай" (> <), the ear turns and stretches a little as a whole, springs back, giggle, a shake
 *   grab / release   the live halves of `pull` (the finger holds the ear in between)
 *   dizzy    the phone was shaken: jostled, spiral eyes, stars around his head, a gentle wobble, shakes it off
 *
 * Shorter trips (Felix 31.10: «4,5 с — можно короче»): at most two hops each way (0.32 s each, the approved keys),
 * the pats and the proud hop closer together — "new wish" and "Erhalten" ≈ 3.2 s instead of 4.3–4.6 s.
 */

import { Track, type ChannelInput, type Channels } from '../timeline';
import type { Mark } from './player';
import { feetAt, NEUTRAL, turnPose, UNIT, type PartName, type PomponParts, type Pose } from './rig';

export type Moment =
  | 'stroke' | 'boop' | 'wish' | 'received' | 'delete' | 'select' | 'relax' | 'move' | 'bulk'
  | 'end' | 'bounce' | 'pop' | 'peek' | 'pull' | 'grab' | 'release' | 'dizzy' | 'plain';

export type Haptic = 'tap' | 'select' | 'success' | 'warning';

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Ctx {
  /** his parts (src/listplay/rig.ts: his own rig, or a borrowed puppet dressed with dressPompon) */
  rig: PomponParts;
  /** his feet at rest (px of the layer his box lives in) */
  seat: Vec;
  /** a ghost finger shows the gesture (button / frames); false when a real finger does it (live) */
  ghost: boolean;
  /** the ghost finger's element (the gallery's played moments) */
  finger?: HTMLElement | null;
  haptic: (kind: Haptic, what: string) => void;
}

export interface Shot {
  readonly name: Moment;
  readonly tracks: readonly Track[];
  readonly duration: number;
  /** Pompon's pose at the end (written inline when the moment ends; `box` = where he stands) */
  readonly end: Pose;
  /** the end pose stays (selection mode: he keeps holding his ears) */
  readonly keep: boolean;
  /** live stroke: the moment waits here while the finger still strokes */
  readonly hold?: number;
  readonly marks: readonly Mark[];
  /** the beats (s) — the gallery's key frames */
  readonly beats: Readonly<Record<string, number>>;
  /** where it happens (layer px; the frames crop to it) */
  readonly focus: Rect;
  /** the list's own change after the end (a tile gone, the count) — never called for a frozen frame */
  commit(): void;
}

/**
 * The host's own list elements in the same timeline (the gallery's mock: a tile drops in, leaves, glides; the count):
 * called with the builder once Pompon's side is authored, with its exact times (the beats and a few more:
 * `contact` of the stamp …); returns when its own tracks end (s).
 */
export type ListHook = (b: Builder, times: Readonly<Record<string, number>>) => number | void;

/** Easings: cubic-bezier only (the puppet's own curves, core.ts EASINGS / SPRING): Track.sample evaluates exactly these. */
export const EZ = {
  out: 'cubic-bezier(.2,.7,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.5)',
  inOut: 'cubic-bezier(.45,0,.2,1)',
  soft: 'cubic-bezier(.3,.7,.3,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
  face: 'cubic-bezier(.25,.8,.3,1)',
  ease: 'ease-in-out',
  up: 'cubic-bezier(.2,.7,.3,1)',
  down: 'cubic-bezier(.5,0,.8,.5)',
} as const;

/** One hop of a trip (s): the approved hop keys, a little quicker than the gallery's first 0.34 (31.10). */
export const TRIP_HOP_S = 0.32;
/** A trip takes at most this many hops each way (the gallery's first version: three). */
export const TRIP_HOPS = 2;
/** px one hop of a trip covers before a second one is needed. */
export const TRIP_REACH = 240;

type EyeMode = 'open' | 'happy' | 'star' | 'spiral' | 'squint';
const EYE_GROUP: Record<EyeMode, PartName> = { open: 'eyesG', happy: 'happy', star: 'star', spiral: 'spiral', squint: 'squint' };
const TURN_PARTS: readonly PartName[] = ['tf', 'tp', 'teL', 'teR', 'tcL', 'tcR', 'tfootL', 'tfootR', 'tailL', 'tailR'];
const PUFF = { sx: 1.06, sy: 1.06 } as const;

export type Pts = ReadonlyArray<readonly [number, ChannelInput, string?]>;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const xy = (p: Vec): ChannelInput => ({ x: p.x, y: p.y });

function close(a: Channels, b: Channels, keys: readonly string[]): boolean {
  return keys.every((k) => Math.abs(((a as Record<string, number | undefined>)[k] ?? 0) - ((b as Record<string, number | undefined>)[k] ?? 0)) < 1e-3);
}

function modeOf(p: Pose): EyeMode {
  for (const m of ['happy', 'star', 'spiral', 'squint'] as const) if ((p[EYE_GROUP[m]]?.o ?? 0) > 0.5) return m;
  return 'open';
}

export function union(...rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Pompon's own box at feet point `p` (layer px). */
export const bodyRect = (p: Vec): Rect => ({ x: p.x - 28, y: p.y - 56, w: 56, h: 60 });

// ------------------------------------------------------------------------------------------------ the builder

/** One timeline under construction: one Track per part (two tracks never drive the same element). */
export class Builder {
  private readonly made = new Map<PartName, Track>();
  readonly doms: Track[] = [];
  readonly marks: Mark[] = [];
  readonly beats: Record<string, number> = {};
  /** exact seconds of the beats (and of moments that are no key frame) — for the host's list hook */
  readonly times: Record<string, number> = {};
  private eye: EyeMode;

  constructor(
    readonly c: Ctx,
    readonly from: Pose,
  ) {
    this.eye = modeOf(from);
    // a part that starts away from rest gets a track, so it is moved back (or held) on purpose
    for (const [n, v] of Object.entries(from) as [PartName, Channels][]) {
      if (n === 'box') continue;
      if (!close({ ...NEUTRAL[n], ...v }, NEUTRAL[n], Object.keys(NEUTRAL[n]))) this.t(n);
    }
  }

  get rig(): PomponParts {
    return this.c.rig;
  }

  t(name: PartName): Track {
    let tr = this.made.get(name);
    if (!tr) {
      const base: ChannelInput = name === 'box' ? { ...(this.from.box ?? feetAt(this.c.seat)) } : { ...NEUTRAL[name], ...this.from[name] };
      tr = new Track(this.rig.els(name), `lp.${name}`, base);
      this.made.set(name, tr);
    }
    return tr;
  }

  /** Keys on a part, from `t0` (or from its last key, whichever is later). */
  at(name: PartName, t0: number, pts: Pts): void {
    const tr = this.t(name);
    tr.path(Math.max(t0, tr.end), pts);
  }

  set(name: PartName, t: number, v: ChannelInput): void {
    this.t(name).set(t, v);
  }

  /** A track on an element that is not Pompon (the lid of his box, the stamp's mark, the gallery's mock tiles). */
  dom(key: string, el: Element, base: ChannelInput): Track {
    const tr = new Track(el, `dom.${key}`, base);
    this.doms.push(tr);
    return tr;
  }

  mark(t: number, kind: Haptic, what: string): void {
    this.marks.push({ t, fn: () => this.c.haptic(kind, what) });
  }

  /** A host callback at second `t` (it pauses with the moment; it never fires for a frozen frame). */
  cue(t: number, fn: () => void): void {
    this.marks.push({ t, fn });
  }

  beat(name: string, t: number): void {
    this.beats[name] = Math.round(t * 100) / 100;
    this.times[name] = t;
  }

  /** An exact time for the host's list hook that is no key frame of the gallery. */
  time(name: string, t: number): void {
    this.times[name] = t;
  }

  /** Feet point (layer px) of puppet units (ux, uy) from his feet at `p`. */
  p(ux: number, uy: number, at: Vec = this.c.seat): Vec {
    return { x: at.x + ux * UNIT, y: at.y + uy * UNIT };
  }

  /** Which eyes show from `t` on (an instant switch). */
  eyes(t: number, mode: EyeMode): void {
    for (const m of Object.keys(EYE_GROUP) as EyeMode[]) this.set(EYE_GROUP[m], t, { o: m === mode ? 1 : 0 });
    this.eye = mode;
  }

  /** A blink that hides a switch of the eyes at `t` (open eyes squeeze shut first, open eyes open again after). */
  blinkTo(t: number, mode: EyeMode, open = 1): void {
    const was = this.eye;
    if (was === 'open') for (const e of ['eyeL', 'eyeR'] as const) this.at(e, t - 0.07, [[t, { sx: 1, sy: 0.12 }, EZ.in]]);
    else for (const e of ['eyeL', 'eyeR'] as const) this.set(e, t, { sx: 1, sy: 0.12 });
    this.eyes(t, mode);
    if (mode === 'open') for (const e of ['eyeL', 'eyeR'] as const) this.at(e, t, [[t + 0.09, { sx: open, sy: open }, EZ.out]]);
  }

  /** Both round eyes through the same keys. */
  both(t0: number, pts: Pts): void {
    this.at('eyeL', t0, pts);
    this.at('eyeR', t0, pts);
  }

  /** The approved 3/4 turn (−1 left, 1 right, 0 to you), over `d` seconds. */
  turn(t0: number, d: number, dir: -1 | 0 | 1): void {
    const pose = turnPose(dir);
    for (const n of TURN_PARTS) {
      const v = pose[n];
      if (v) this.at(n, t0, [[t0 + d, v, 'cubic-bezier(.3,.7,.3,1)']]);
    }
  }

  /**
   * One approved hop (MascotBase.jumpMotion, the same keys): squash, take-off, tucked feet, ears, landing slap, the
   * shadow small in the air. The feet travel from p0 to p1 (layer px) in the air; `h` = arc height in px; `twist` =
   * the binky's turn in the air (deg).
   */
  hop(t0: number, d: number, p0: Vec, p1: Vec, h: number, twist = 0, lean = 0): void {
    const k = (f: number) => t0 + f * d;
    this.at('box', t0, [[k(0.18), feetAt(p0), 'linear'], [k(0.82), feetAt(p1), EZ.inOut]]);
    const hu = h / UNIT;
    this.at('hop', t0, [[k(0.18), { y: 0 }, 'linear'], [k(0.5), { y: -hu }, EZ.up], [k(0.82), { y: 0 }, EZ.down]]);
    this.at('squash', t0, [
      [k(0.18), { r: 0, sx: 1.08, sy: 0.88 }, 'ease-out'],
      [k(0.3), { r: lean, sx: 0.95, sy: 1.07 }, 'ease-out'],
      [k(0.48), { r: twist || lean, sx: 1, sy: 1 }, EZ.ease],
      [k(0.66), { r: twist ? -twist * 0.6 : 0, sx: 0.97, sy: 1.04 }, EZ.ease],
      [k(0.84), { r: 0, sx: 1.07, sy: 0.9 }, 'ease-in'],
      [k(0.93), { r: 0, sx: 0.98, sy: 1.02 }, EZ.ease],
      [k(1), { r: 0, sx: 1, sy: 1 }, EZ.ease],
    ]);
    const foot = (s: number): Pts => [
      [k(0.18), { x: -2 * s, y: 0, r: 0, sx: 1.12, sy: 1 }, EZ.ease],
      [k(0.4), { x: 2 * s, y: -8, r: 18 * s, sx: 0.8, sy: 0.8 }, EZ.ease],
      [k(0.66), { x: 2 * s, y: -8, r: 18 * s, sx: 0.8, sy: 0.8 }, EZ.ease],
      [k(0.84), { x: -3 * s, y: 0, r: 0, sx: 1.18, sy: 1 }, EZ.ease],
      [k(1), { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, EZ.ease],
    ];
    this.at('footL', t0, foot(1));
    this.at('footR', t0, foot(-1));
    this.at('paws', t0, [[k(0.18), { y: 2 }], [k(0.4), { y: -7 }], [k(0.66), { y: -4 }], [k(0.84), { y: 3 }], [k(1), { y: 0 }]]);
    this.at('earL', t0, [[k(0.3), { r: 10 }], [k(0.55), { r: -14 }], [k(0.86), { r: 12 }], [k(1), { r: 0 }]]);
    this.at('earR', t0, [[k(0.3), { r: -10 }], [k(0.55), { r: 14 }], [k(0.86), { r: -12 }], [k(1), { r: 0 }]]);
    this.at('shadow', t0, [[k(0.18), { sx: 1.06, sy: 1.06, o: 1 }], [k(0.52), { sx: 0.62, sy: 0.62, o: 0.35 }, EZ.up], [k(0.84), { sx: 1.08, sy: 1.08, o: 1 }, EZ.down], [k(1), { sx: 1, sy: 1, o: 1 }]]);
    for (const ch of ['cheekL', 'cheekR'] as const) {
      this.at(ch, t0, [[k(0.8), { sx: 1, sy: 1 }, 'linear'], [k(0.87), { sx: 1.09, sy: 0.92 }], [k(0.94), { sx: 0.97, sy: 1.03 }], [k(1), { sx: 1, sy: 1 }]]);
    }
  }

  /**
   * The approved jump for the pop out of the box: the same beats as `hop` (squash, stretch, tucked feet, ears flop,
   * landing), but only the body's outline squashes (≤ 7 %) — the face, the ears, the cheeks and the paws are scaled back
   * at every key, so they keep their shapes (Felix: no squashing of the whole bunny).
   */
  bound(t0: number, d: number, p0: Vec, p1: Vec, h: number): void {
    const k = (f: number) => t0 + f * d;
    this.at('box', t0, [[k(0.18), feetAt(p0), 'linear'], [k(0.82), feetAt(p1), EZ.inOut]]);
    this.at('hop', t0, [[k(0.18), { y: 0 }, 'linear'], [k(0.5), { y: -h / UNIT }, EZ.up], [k(0.82), { y: 0 }, EZ.down]]);
    // [fraction, body sx, body sy, ear flop °, paws y]
    const S: ReadonlyArray<readonly [number, number, number, number, number]> = [
      [0.18, 1.05, 0.93, 4, 2],
      [0.3, 0.97, 1.05, 10, -4],
      [0.48, 1, 1, -8, -7],
      [0.66, 0.99, 1.02, -10, -4],
      [0.84, 1.05, 0.94, 11, 3],
      [0.93, 0.99, 1.01, 5, 1],
      [1, 1, 1, 0, 0],
    ];
    const keys = (fn: (sx: number, sy: number, ear: number, py: number) => ChannelInput): Pts => S.map(([f, sx, sy, e, py]) => [k(f), fn(sx, sy, e, py), EZ.ease] as const);
    this.at('squash', t0, keys((sx, sy) => ({ r: 0, sx, sy })));
    this.at('face', t0, keys((sx, sy) => ({ x: 0, y: 0, sx: 1 / sx, sy: 1 / sy })));
    this.at('earL', t0, keys((sx, sy, e) => ({ r: e, sx: 1 / sx, sy: 1 / sy })));
    this.at('earR', t0, keys((sx, sy, e) => ({ r: -e, sx: 1 / sx, sy: 1 / sy })));
    this.at('paws', t0, keys((sx, sy, _e, py) => ({ y: py, sx: 1 / sx, sy: 1 / sy })));
    this.at('cheekL', t0, keys((sx, sy) => ({ sx: 1 / sx, sy: 1 / sy })));
    this.at('cheekR', t0, keys((sx, sy) => ({ sx: 1 / sx, sy: 1 / sy })));
    const foot = (s: number): Pts => [
      [k(0.18), { x: -2 * s, y: 0, r: 0, sx: 1.12, sy: 1 }, EZ.ease],
      [k(0.4), { x: 2 * s, y: -8, r: 18 * s, sx: 0.8, sy: 0.8 }, EZ.ease],
      [k(0.66), { x: 2 * s, y: -8, r: 18 * s, sx: 0.8, sy: 0.8 }, EZ.ease],
      [k(0.84), { x: -3 * s, y: 0, r: 0, sx: 1.18, sy: 1 }, EZ.ease],
      [k(1), { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, EZ.ease],
    ];
    this.at('footL', t0, foot(1));
    this.at('footR', t0, foot(-1));
    this.at('shadow', t0, [[k(0.18), { sx: 1.06, sy: 1.06, o: 1 }], [k(0.52), { sx: 0.62, sy: 0.62, o: 0.35 }, EZ.up], [k(0.84), { sx: 1.08, sy: 1.08, o: 1 }, EZ.down], [k(1), { sx: 1, sy: 1, o: 1 }]]);
  }

  /**
   * Hops from p0 to p1 (at most TRIP_HOPS hops), turned 3/4 the way he goes; facing you again at the end. Returns the
   * time he stands there, facing you. `label` = a beat at the first hop's top (key frames).
   */
  travel(t0: number, p0: Vec, p1: Vec, label?: string): number {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return t0;
    const dir: -1 | 0 | 1 = dx > 8 ? 1 : dx < -8 ? -1 : 0;
    const n = clamp(Math.ceil(dist / TRIP_REACH), 1, TRIP_HOPS);
    const D = TRIP_HOP_S;
    if (dir) this.turn(t0, 0.12, dir);
    let t = t0 + (dir ? 0.08 : 0);
    for (let i = 0; i < n; i++) {
      const a = { x: p0.x + (dx * i) / n, y: p0.y + (dy * i) / n };
      const b = { x: p0.x + (dx * (i + 1)) / n, y: p0.y + (dy * (i + 1)) / n };
      const seg = dist / n;
      const h = clamp(seg * 0.2, 10, 32) + Math.max(0, a.y - b.y) * 0.45;
      if (i === 0 && label) this.beat(label, t + D * 0.5);
      this.hop(t, D, a, b, h, 0, dir * 2);
      t += D;
    }
    if (dir) this.turn(t - 0.02, 0.14, 0);
    return t + (dir ? 0.1 : 0);
  }

  /** The approved wave (the greet after Felix's review: paw-r beside the cheek, −22° / +16°), with the small open mouth. */
  wave(t0: number, t1: number): void {
    const lift = 0.12;
    const beat = (t1 - t0 - lift - 0.14) / 3;
    const W = { x: 56, y: -46 };
    this.at('pawR', t0, [
      [t0 + lift, { ...W, r: -22 }, EZ.out],
      [t0 + lift + beat, { ...W, r: 16 }, EZ.ease],
      [t0 + lift + 2 * beat, { ...W, r: -22 }, EZ.ease],
      [t0 + lift + 3 * beat, { ...W, r: 12 }, EZ.ease],
      [t1, { x: 0, y: 0, r: 0 }, EZ.soft],
    ]);
    this.at('body', t0, [[t0 + 0.14, { r: -3 }, EZ.out], [t1, { r: 0 }, EZ.ease]]);
    this.mouthOpen(t0 + 0.04, t1 - 0.04, { sx: 1, sy: 1 });
  }

  mouthOpen(t0: number, t1: number, s: { sx: number; sy: number }): void {
    this.set('mouthO', t0, { o: 1, ...s });
    this.set('mouth', t0, { o: 0 });
    this.set('mouthO', t1, { o: 0, sx: 1, sy: 1 });
    this.set('mouth', t1, { o: 1 });
  }

  /** A giggle: little open mouth, shoulders shake three times with tiny bounces, cheeks a bit fuller (≈ 0.55 s). */
  giggle(t0: number): number {
    this.mouthOpen(t0, t0 + 0.5, { sx: 0.9, sy: 0.8 });
    this.at('squash', t0, [[t0 + 0.08, { r: 1.6, sx: 1, sy: 1 }, EZ.ease], [t0 + 0.17, { r: -1.6, sx: 1, sy: 1 }, EZ.ease], [t0 + 0.26, { r: 1.3, sx: 1, sy: 1 }, EZ.ease], [t0 + 0.35, { r: -1, sx: 1, sy: 1 }, EZ.ease], [t0 + 0.46, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
    this.at('hop', t0, [[t0 + 0.05, { y: -4 }, EZ.out], [t0 + 0.1, { y: 0 }, EZ.in], [t0 + 0.15, { y: -3.5 }, EZ.out], [t0 + 0.2, { y: 0 }, EZ.in], [t0 + 0.25, { y: -3 }, EZ.out], [t0 + 0.3, { y: 0 }, EZ.in]]);
    for (const ch of ['cheekL', 'cheekR'] as const) this.at(ch, t0, [[t0 + 0.12, PUFF, EZ.out], [t0 + 0.6, { sx: 1, sy: 1 }, EZ.ease]]);
    return t0 + 0.55;
  }

  /** Notices something at `target` (layer px): ears perk, eyes a little wider, a glance there. */
  notice(t0: number, target: Vec): void {
    const dx = target.x - this.c.seat.x;
    const dy = target.y - (this.c.seat.y - 30);
    this.at('earL', t0, [[t0 + 0.12, { r: -9 }, EZ.out], [t0 + 0.42, { r: 0 }, EZ.ease]]);
    this.at('earR', t0, [[t0 + 0.13, { r: 9 }, EZ.out], [t0 + 0.43, { r: 0 }, EZ.ease]]);
    this.both(t0, [[t0 + 0.1, { sx: 1.14, sy: 1.14 }, EZ.out], [t0 + 0.4, { sx: 1, sy: 1 }, EZ.ease]]);
    this.at('face', t0, [[t0 + 0.16, { x: clamp(dx / 40, -2.6, 2.6), y: clamp(dy / 60, -2, 2) }, EZ.face], [t0 + 0.42, { x: 0, y: 0 }, EZ.ease]]);
  }

  /** The finished Shot: every part of Pompon ends at rest (or holds, `keep`); the box ends on `endAt`. */
  shot(name: Moment, duration: number, o: { focus: Rect; keep?: boolean; endAt?: Vec; hold?: number; commit?: () => void }): Shot {
    let dur = duration;
    const endBox = feetAt(o.endAt ?? this.c.seat);
    if (!o.keep) {
      for (const [n, tr] of this.made) {
        const goal: Channels = n === 'box' ? endBox : NEUTRAL[n];
        const keys = Object.keys(n === 'box' ? NEUTRAL.box : NEUTRAL[n]);
        if (close({ ...goal, ...tr.value }, goal, keys)) continue;
        // a part that is not back yet glides home (should not happen in an authored moment, but never snap)
        const t0 = Math.max(tr.end, dur - 0.2);
        tr.move(t0, t0 + 0.16, goal, EZ.soft);
        dur = Math.max(dur, t0 + 0.16);
      }
    }
    const end: Pose = {};
    for (const [n, tr] of this.made) end[n] = { ...(n === 'box' ? {} : NEUTRAL[n]), ...tr.sample(dur) };
    if (!end.box) end.box = { ...(this.from.box ?? endBox) };
    if (o.keep) for (const [n, v] of Object.entries(this.from) as [PartName, Channels][]) if (!end[n]) end[n] = { ...v };
    return {
      name,
      tracks: [...this.made.values(), ...this.doms],
      duration: dur,
      end,
      keep: !!o.keep,
      ...(o.hold !== undefined ? { hold: o.hold } : {}),
      marks: [...this.marks],
      beats: { ...this.beats, end: Math.round(dur * 100) / 100 },
      focus: o.focus,
      commit: o.commit ?? (() => undefined),
    };
  }
}

/** Runs the host's list hook (if any) with the beats so far; returns the moment's duration (the later end). */
function withList(b: Builder, own: number, list: ListHook | undefined): number {
  if (!list) return own;
  const end = list(b, { ...b.times });
  return typeof end === 'number' && Number.isFinite(end) ? Math.max(own, end) : own;
}

/** A ghost finger (frames and buttons only): a soft dot that shows what the person does. */
function ghost(b: Builder, base: Vec, pts: ReadonlyArray<readonly [number, Vec, number, string?]>, scale = 0.62): void {
  const el = b.c.finger;
  if (!b.c.ghost || !el) return;
  const f = b.dom('finger', el, { ...xy(base), s: scale, o: 0 });
  f.path(0, pts.map(([t, p, o, e]) => [t, { ...xy(p), s: scale, o }, e ?? EZ.ease] as const));
}

// ------------------------------------------------------------------------------------------------ 1. stroke

export const STROKE_HOLD = 1.6;

export function authorStroke(c: Ctx, from: Pose): Shot {
  const b = new Builder(c, from);
  const P = (ux: number, uy: number) => b.p(ux, uy);
  // the ghost finger strokes over his head three times (right → left → right → left)
  ghost(b, P(80, -150), [[0.14, P(46, -158), 0.95, EZ.out], [0.58, P(-42, -160), 0.95], [1.02, P(42, -158), 0.95], [1.46, P(-36, -160), 0.95], [1.62, P(-66, -150), 0, EZ.out]], 0.62);
  b.beat('lean', 0.34);
  // leans INTO the hand: the head pushes up a little, the chin lifts; with the ghost he also sways after the hand
  b.at('squash', 0.08, [[0.34, { r: c.ghost ? 2.2 : 0.6, sx: 0.99, sy: 1.028 }, EZ.out]]);
  if (c.ghost) b.at('squash', 0.34, [[0.62, { r: -1.6, sx: 0.99, sy: 1.028 }, EZ.ease], [1.04, { r: 2, sx: 0.99, sy: 1.028 }, EZ.ease], [1.48, { r: -1, sx: 0.99, sy: 1.028 }, EZ.ease]]);
  b.at('face', 0.1, [[0.34, { x: 0, y: -1.2 }, EZ.out]]);
  // the ears relax outward (the sleeping ears of BUNNY_CSS, a little less)
  b.at('earL', 0.14, [[0.5, { r: 7 }, EZ.soft]]);
  b.at('earR', 0.16, [[0.52, { r: -7 }, EZ.soft]]);
  b.blinkTo(0.3, 'happy');
  b.at('blush', 0.28, [[0.6, { o: 0.72 }, EZ.out]]);
  b.mark(0.3, 'select', 'прильнул к руке');
  // the purr: soft teeth chatter — the cheeks and the nose quiver in tiny steps, three strokes at the cheek
  b.beat('purr', 0.66);
  const chatter: Array<readonly [number, ChannelInput, string?]> = [];
  for (let i = 0; i < 8; i++) {
    const t = 0.62 + i * 0.105;
    chatter.push([t + 0.05, { sx: 1.035, sy: 0.972 }, 'ease-out'], [t + 0.105, { sx: 1, sy: 1 }, 'ease-in']);
  }
  b.at('cheekL', 0.62, chatter);
  b.at('cheekR', 0.62, chatter);
  b.at('nose', 0.62, chatter.map(([t, , e], i) => [t, i % 2 === 0 ? { sx: 1.04, sy: 0.9 } : { sx: 1, sy: 1 }, e] as const));
  for (const [part, t] of [['purr1', 0.66], ['purr2', 0.9], ['purr3', 1.14]] as const) {
    const out = part === 'purr3' ? -1 : 1;
    b.at(part, t, [[t + 0.07, { x: out * 2, o: 0.9 }, EZ.out], [t + 0.32, { x: out * 7, o: 0 }, 'ease-in']]);
  }
  // two hearts rise from above his head
  b.beat('hearts', 0.96);
  b.set('heart1', 0.78, { x: 0, y: 0, sx: 0.5, sy: 0.5, o: 0 });
  b.at('heart1', 0.78, [[0.96, { x: 3, y: -18, sx: 1, sy: 1, o: 1 }, EZ.out], [1.62, { x: 10, y: -66, sx: 1.05, sy: 1.05, o: 0 }, 'ease-in']]);
  b.set('heart2', 1.16, { x: 0, y: 0, sx: 0.5, sy: 0.5, o: 0 });
  b.at('heart2', 1.16, [[1.34, { x: -3, y: -16, sx: 1, sy: 1, o: 1 }, EZ.out], [1.96, { x: -10, y: -58, sx: 1.05, sy: 1.05, o: 0 }, 'ease-in']]);
  // the hand is gone: a contented sigh — chest up, then down with a small breath curl, eyes still ^ ^
  b.beat('sigh', 2.2);
  b.at('squash', 1.66, [[1.96, { r: 0, sx: 0.985, sy: 1.042 }, EZ.ease], [2.4, { r: 0, sx: 1.026, sy: 0.968 }, EZ.ease], [2.76, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('face', 1.66, [[1.96, { x: 0, y: -1.8 }, EZ.ease], [2.4, { x: 0, y: 0.8 }, EZ.ease], [2.76, { x: 0, y: 0 }, EZ.soft]]);
  b.at('paws', 1.66, [[1.96, { y: -3 }, EZ.ease], [2.4, { y: 1 }, EZ.ease], [2.76, { y: 0 }, EZ.soft]]);
  b.at('earL', 1.66, [[1.96, { r: 3 }, EZ.ease], [2.4, { r: 9 }, EZ.ease], [2.78, { r: 0 }, EZ.soft]]);
  b.at('earR', 1.66, [[1.96, { r: -3 }, EZ.ease], [2.4, { r: -9 }, EZ.ease], [2.78, { r: 0 }, EZ.soft]]);
  b.mouthOpen(2.0, 2.34, { sx: 0.75, sy: 0.7 });
  b.set('breath', 2.02, { x: 0, y: 0, sx: 0.8, sy: 0.8, o: 0 });
  b.at('breath', 2.02, [[2.14, { x: 3, y: 0.5, sx: 1, sy: 1, o: 0.85 }, EZ.out], [2.56, { x: 10, y: 2, sx: 1.15, sy: 1.15, o: 0 }, 'ease-in']]);
  b.at('blush', 2.3, [[2.7, { o: 0.3 }, EZ.ease]]);
  b.blinkTo(2.56, 'open');
  return b.shot('stroke', 2.82, { focus: union(bodyRect(c.seat), { x: c.seat.x - 40, y: c.seat.y - 80, w: 80, h: 84 }), hold: STROKE_HOLD });
}

// ------------------------------------------------------------------------------------------------ 2. boop

export function authorBoop(c: Ctx, from: Pose): Shot {
  const b = new Builder(c, from);
  const P = (ux: number, uy: number) => b.p(ux, uy);
  ghost(b, P(80, -30), [[0.06, P(6, -82), 0.95, EZ.out], [0.3, P(64, -44), 0, EZ.out]], 0.7);
  b.beat('boop', 0.08);
  b.mark(0.06, 'tap', 'нос');
  // the nose squishes, then wiggles fast
  const wig: Array<readonly [number, ChannelInput, string?]> = [[0.09, { sx: 1.3, sy: 0.62 }, EZ.out]];
  for (let i = 0; i < 6; i++) wig.push([0.15 + i * 0.065, i % 2 ? { sx: 1.05, sy: 0.86 } : { sx: 0.95, sy: 1.08 }, EZ.ease]);
  wig.push([0.58, { sx: 1, sy: 1 }, EZ.ease]);
  b.at('nose', 0.05, wig);
  // the head pulls back, round eyes, the ears flick up
  b.at('squash', 0.05, [[0.13, { r: -2.4, sx: 1.03, sy: 0.965 }, EZ.out], [0.32, { r: 0.6, sx: 0.99, sy: 1.012 }, EZ.ease], [0.46, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('face', 0.05, [[0.12, { x: 0, y: 1.3 }, EZ.out], [0.3, { x: 0, y: -0.6 }, EZ.ease], [0.44, { x: 0, y: 0 }, EZ.soft]]);
  b.both(0.05, [[0.1, { sx: 1.32, sy: 1.26 }, EZ.out], [0.42, { sx: 1.26, sy: 1.2 }, 'linear']]);
  b.at('earL', 0.05, [[0.11, { r: -18 }, EZ.out], [0.28, { r: 5 }, EZ.ease], [0.44, { r: 0 }, EZ.soft]]);
  b.at('earR', 0.065, [[0.125, { r: 18 }, EZ.out], [0.3, { r: -5 }, EZ.ease], [0.46, { r: 0 }, EZ.soft]]);
  // … and giggles
  b.beat('giggle', 0.7);
  b.blinkTo(0.5, 'happy');
  b.giggle(0.52);
  b.blinkTo(1.14, 'open');
  return b.shot('boop', 1.32, { focus: union(bodyRect(c.seat), { x: c.seat.x - 20, y: c.seat.y - 50, w: 70, h: 54 }) });
}

// ------------------------------------------------------------------------------------------------ 3. a new wish

export interface WishTarget {
  /** his feet on the new tile (on its picture's lower edge: he covers only that tile) */
  feet: Vec;
  /** the tile's picture (layer px): the frames crop to it */
  photo: Rect;
  /** he can hop there (on screen between the bars, not too far) — else he cheers from his seat */
  reach: boolean;
  /** the element that gives a little under each pat (the tile's card / picture); `landAt` = it lands from a drop then */
  press?: { el: HTMLElement; landAt?: number } | null;
  list?: ListHook;
  /** the list's own change after the end (the gallery's mock) */
  commit?: () => void;
}

export function authorWish(c: Ctx, from: Pose, o: WishTarget): Shot {
  const b = new Builder(c, from);
  const { feet, photo } = o;
  const pressEl = o.press?.el ?? null;
  if (pressEl) pressEl.style.transformOrigin = '50% 100%';
  const press = pressEl ? b.dom('newPress', pressEl, { sx: 1, sy: 1 }) : null;
  // the drop's landing (the gallery's mock tile: it lands with a squash)
  const land = o.press?.landAt;
  if (press && land !== undefined) press.path(land, [[land + 0.06, { sx: 1.03, sy: 0.95 }, EZ.out], [land + 0.18, { sx: 0.995, sy: 1.012 }, EZ.ease], [land + 0.28, { sx: 1, sy: 1 }, EZ.soft]]);
  b.beat('drop', 0.5);
  b.notice(0.18, feet);
  const focus = union(bodyRect(c.seat), photo);
  if (!o.reach) {
    // the tile is off screen or far away: he cheers from his seat (^ ^, a proud hop) — no trip
    const tp = 0.62;
    b.beat('proud', tp + 0.24);
    b.blinkTo(tp, 'happy');
    b.hop(tp + 0.05, 0.42, c.seat, c.seat, 12);
    b.blinkTo(tp + 0.72, 'open');
    return b.shot('wish', withList(b, tp + 0.9, o.list), { focus, ...(o.commit ? { commit: o.commit } : {}) });
  }
  const tA = b.travel(0.42, c.seat, feet, 'hop');
  b.beat('arrive', tA);
  // two pats: both paws up (a little wind-up), then down onto the picture — the tile gives a little each time
  const t = tA + 0.02;
  const c1 = t + 0.18;
  const c2 = t + 0.36;
  b.beat('pat', c1 + 0.01);
  b.beat('pat2', c2);
  b.at('paws', t, [[t + 0.1, { y: -12 }, EZ.out], [c1, { y: 30 }, EZ.in], [c1 + 0.08, { y: -8 }, EZ.out], [c2, { y: 30 }, EZ.in], [c2 + 0.16, { y: 0 }, EZ.soft]]);
  b.at('squash', t, [[t + 0.1, { r: 0, sx: 0.98, sy: 1.035 }, EZ.out], [c1, { r: 0, sx: 1.045, sy: 0.94 }, EZ.in], [c1 + 0.08, { r: 0, sx: 0.99, sy: 1.025 }, EZ.out], [c2, { r: 0, sx: 1.045, sy: 0.94 }, EZ.in], [c2 + 0.16, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('pawL', t, [[t + 0.1, { x: -5, y: 0, r: -14 }, EZ.out], [c2 + 0.16, { x: 0, y: 0, r: 0 }, EZ.soft]]);
  b.at('pawR', t, [[t + 0.1, { x: 5, y: 0, r: 14 }, EZ.out], [c2 + 0.16, { x: 0, y: 0, r: 0 }, EZ.soft]]);
  b.at('face', t, [[c1, { x: 0, y: 2.2 }, EZ.in], [c2 + 0.16, { x: 0, y: 0 }, EZ.soft]]);
  press?.path(Math.max(c1 - 0.01, press.end), [[c1 + 0.05, { sx: 1.02, sy: 0.965 }, EZ.out], [c1 + 0.14, { sx: 1, sy: 1 }, EZ.soft], [c2 + 0.05, { sx: 1.02, sy: 0.965 }, EZ.out], [c2 + 0.16, { sx: 1, sy: 1 }, EZ.soft]]);
  // one light tick on the second pat (saving the wish already vibrated on the form)
  b.mark(c2, 'select', 'прихлопнул — на месте');
  // a small proud hop: ^ ^, nose up
  const tp = c2 + 0.18;
  b.beat('proud', tp + 0.2);
  b.blinkTo(tp, 'happy');
  b.at('face', tp, [[tp + 0.13, { x: 0, y: -1.6 }, EZ.out]]);
  b.hop(tp + 0.04, 0.38, feet, feet, 12);
  const tB = tp + 0.42;
  b.at('face', tB, [[tB + 0.14, { x: 0, y: 0 }, EZ.soft]]);
  b.blinkTo(tB + 0.16, 'open');
  const tR = b.travel(tB + 0.08, feet, c.seat);
  b.beat('back', tR);
  return b.shot('wish', withList(b, tR + 0.1, o.list), { focus, ...(o.commit ? { commit: o.commit } : {}) });
}

// ------------------------------------------------------------------------------------------------ 4. received («Erhalten»)

export interface ReceivedTarget {
  /** his feet on the tile (on its picture's lower edge, a little left: the paw comes down to his right) */
  feet: Vec;
  photo: Rect;
  reach: boolean;
  /** the tile's card: it gives a little under the stamp */
  card?: HTMLElement | null;
  /** places the stamp's mark (a green ✓ in an ink ring) at the contact point (layer px) and returns it — or null */
  seal?: (contact: Vec) => HTMLElement | null;
  /** the stamp touches the tile (the host shows «✓ Erhalten» now) */
  onStamp?: () => void;
  /** he is back on his seat (the host lets the tile leave for «Erhalten» now) */
  onBack?: () => void;
  list?: ListHook;
  commit?: () => void;
}

export function authorReceived(c: Ctx, from: Pose, o: ReceivedTarget): Shot {
  const b = new Builder(c, from);
  const { feet, photo } = o;
  const near = o.reach;
  // where the paw comes down (to his right, on the picture): the stamp's mark appears there (far: in the picture)
  const contact = near ? b.p(50, -4, feet) : { x: photo.x + photo.w * 0.62, y: photo.y + photo.h * 0.72 };
  const seal = o.seal?.(contact) ?? null;
  b.notice(0, feet);
  let tc: number;
  let tR: number;
  if (near) {
    const tA = b.travel(0.24, c.seat, feet, 'hop');
    b.beat('arrive', tA);
    // the stamp: paw up beside the cheek (a little lean back), then down onto the picture
    const ts = tA + 0.03;
    tc = ts + 0.26;
    b.beat('stamp', tc + 0.02);
    b.at('pawR', ts, [[ts + 0.18, { x: 12, y: -36, r: -26 }, EZ.out], [tc, { x: 34, y: 38, r: 14 }, EZ.in], [tc + 0.1, { x: 34, y: 38, r: 14 }, 'linear'], [tc + 0.3, { x: 0, y: 0, r: 0 }, EZ.soft]]);
    b.at('squash', ts, [[ts + 0.18, { r: -3, sx: 0.99, sy: 1.03 }, EZ.out], [tc, { r: 4, sx: 1.03, sy: 0.955 }, EZ.in], [tc + 0.3, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
    b.both(ts, [[ts + 0.15, { sx: 1, sy: 0.82 }, EZ.out], [tc, { sx: 1, sy: 0.82 }, 'linear'], [tc + 0.18, { sx: 1, sy: 1 }, EZ.out]]);
    // a mini binky right there (^ ^, a small twist in the air)
    const tb = tc + 0.36;
    b.beat('binky', tb + 0.26);
    b.blinkTo(tb, 'happy');
    b.hop(tb + 0.04, 0.46, feet, feet, 15, 11);
    const tb2 = tb + 0.5;
    b.blinkTo(tb2 + 0.06, 'open');
    tR = b.travel(tb2 + 0.04, feet, c.seat);
  } else {
    // far away (off screen, behind the bars): the stamp lands by itself, he does his mini binky on his seat
    tc = 0.5;
    b.beat('stamp', tc + 0.02);
    const tb = tc + 0.3;
    b.beat('binky', tb + 0.3);
    b.blinkTo(tb, 'happy');
    b.hop(tb + 0.04, 0.5, c.seat, c.seat, 15, 11);
    b.blinkTo(tb + 0.66, 'open');
    tR = tb + 0.8;
  }
  if (seal) b.dom('seal', seal, { o: 0, s: 1.35, r: -16 }).path(tc - 0.01, [[tc + 0.02, { o: 1, s: 1.14, r: -12 }, EZ.out], [tc + 0.2, { o: 1, s: 1, r: -12 }, EZ.spring], [tc + 0.62, { o: 1, s: 1, r: -12 }, 'linear'], [tc + 0.98, { o: 0, s: 0.92, r: -12 }, EZ.ease]]);
  if (o.card) {
    o.card.style.transformOrigin = '50% 100%';
    b.dom('press', o.card, { sx: 1, sy: 1 }).path(tc, [[tc + 0.05, { sx: 1.01, sy: 0.985 }, EZ.out], [tc + 0.22, { sx: 1, sy: 1 }, EZ.soft]]);
  }
  // the app's own «Erhalten» success, played at the stamp's contact (not a second one)
  b.time('contact', tc);
  b.mark(tc, 'success', 'Erhalten — та же вибрация, что уже есть, в момент печати');
  if (o.onStamp) b.cue(tc, o.onStamp);
  if (o.onBack) b.cue(tR, o.onBack);
  b.beat('back', tR);
  b.beat('leave', tR + 0.02);
  const sealEnd = seal ? tc + 0.98 : 0;
  return b.shot('received', withList(b, Math.max(tR + 0.1, sealEnd), o.list), { focus: union(bodyRect(c.seat), photo), ...(o.commit ? { commit: o.commit } : {}) });
}

// ------------------------------------------------------------------------------------------------ 5. delete

export function authorDelete(c: Ctx, from: Pose, o: { target: Rect; list?: ListHook; commit?: () => void }): Shot {
  const b = new Builder(c, from);
  const cr = o.target;
  const centre = { x: cr.x + cr.w / 2, y: cr.y + cr.h / 2 };
  // he looks at the tile and waves "bye" while it shrinks away (the app's exit: scale .86 + fade)
  b.at('face', 0, [[0.2, { x: clamp((centre.x - c.seat.x) / 40, -2.6, 2.6), y: clamp((centre.y - c.seat.y + 30) / 60, -2, 2) }, EZ.face]]);
  b.beat('bye', 0.5);
  b.blinkTo(0.16, 'happy');
  b.wave(0.14, 1.2);
  // … then dusts off his paws: paws together, rubbed three times, a few dust puffs fall
  b.at('face', 1.0, [[1.24, { x: 0, y: 1.4 }, EZ.ease]]);
  b.blinkTo(1.24, 'open');
  const t = 1.26;
  b.beat('dust', t + 0.4);
  b.at('pawL', t, [[t + 0.14, { x: 8, y: -3, r: 20 }, EZ.out]]);
  b.at('pawR', t, [[t + 0.14, { x: -8, y: -3, r: -20 }, EZ.out]]);
  for (let i = 0; i < 4; i++) {
    const tt = t + 0.14 + i * 0.12;
    b.at('pawR', tt, [[tt + 0.06, { x: -6, y: -7, r: -20 }, EZ.ease], [tt + 0.12, { x: -8, y: -2, r: -20 }, EZ.ease]]);
    b.at('pawL', tt, [[tt + 0.06, { x: 8, y: -1, r: 20 }, EZ.ease], [tt + 0.12, { x: 6, y: -6, r: 20 }, EZ.ease]]);
  }
  for (const [part, at, dx] of [['dust1', 0.22, -6], ['dust2', 0.36, 3], ['dust3', 0.5, 9]] as const) {
    const t0 = t + at;
    b.set(part, t0, { x: 0, y: 0, sx: 0.6, sy: 0.6, o: 0 });
    b.at(part, t0, [[t0 + 0.08, { x: dx * 0.6, y: 4, sx: 1, sy: 1, o: 0.9 }, EZ.out], [t0 + 0.52, { x: dx * 2, y: 26, sx: 1.35, sy: 1.35, o: 0 }, 'ease-in']]);
  }
  const tE = t + 0.62;
  b.at('pawL', tE, [[tE + 0.2, { x: 0, y: 0, r: 0 }, EZ.soft]]);
  b.at('pawR', tE, [[tE + 0.2, { x: 0, y: 0, r: 0 }, EZ.soft]]);
  b.at('face', tE, [[tE + 0.2, { x: 0, y: 0 }, EZ.soft]]);
  // done: a satisfied little nod, ^ ^
  b.at('squash', tE, [[tE + 0.12, { r: 0, sx: 1.02, sy: 0.975 }, EZ.ease], [tE + 0.3, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.blinkTo(tE + 0.06, 'happy');
  b.blinkTo(tE + 0.42, 'open');
  return b.shot('delete', withList(b, tE + 0.55, o.list), { focus: union(bodyRect(c.seat), cr), ...(o.commit ? { commit: o.commit } : {}) });
}

// ------------------------------------------------------------------------------------------------ 6. selection mode

/** Holding his ears nervously (selection mode): paws at the ear tips, ears pulled in a little, worried brows. */
export const NERVOUS: Pose = {
  pawL: { x: -40, y: -50, r: -24 },
  pawR: { x: 40, y: -50, r: 24 },
  earL: { r: -6, sx: 1, sy: 1 },
  earR: { r: 6, sx: 1, sy: 1 },
  brows: { o: 1 },
};

export function authorSelect(c: Ctx, from: Pose): Shot {
  const b = new Builder(c, from);
  // a little startle as the tiles start to wobble …
  b.both(0, [[0.08, { sx: 1.22, sy: 1.22 }, EZ.out], [0.5, { sx: 1, sy: 1 }, EZ.ease]]);
  b.at('hop', 0, [[0.07, { y: -5 }, EZ.out], [0.16, { y: 0 }, EZ.in]]);
  b.at('earL', 0, [[0.08, { r: -10 }, EZ.out], [0.4, { r: -6 }, EZ.ease]]);
  b.at('earR', 0, [[0.08, { r: 10 }, EZ.out], [0.4, { r: 6 }, EZ.ease]]);
  // … he holds his ears, worried brows …
  b.beat('ears', 0.42);
  b.at('pawL', 0.1, [[0.4, { ...NERVOUS.pawL }, EZ.soft]]);
  b.at('pawR', 0.12, [[0.42, { ...NERVOUS.pawR }, EZ.soft]]);
  b.at('brows', 0.16, [[0.3, { o: 1 }, EZ.out]]);
  // … and trembles along with the tiles (their wobble period, 0.32 s), a little, then holds still
  b.beat('tremble', 0.74);
  const pts: Array<readonly [number, ChannelInput, string?]> = [];
  for (let i = 0; i < 6; i++) pts.push([0.42 + i * 0.16, { r: (i % 2 ? -1 : 1) * (1.3 - i * 0.12), sx: 1, sy: 1 }, EZ.ease]);
  pts.push([1.38, { r: 0, sx: 1, sy: 1 }, EZ.ease]);
  b.at('squash', 0.3, pts);
  return b.shot('select', 1.42, { focus: bodyRect(c.seat), keep: true });
}

/** Lets go of his ears (selection ends): paws down, brows off, ears back; `then` = when the paws are down. */
function letGo(b: Builder, t0: number): number {
  b.at('pawL', t0, [[t0 + 0.32, { x: 0, y: 0, r: 0 }, EZ.soft]]);
  b.at('pawR', t0 + 0.02, [[t0 + 0.34, { x: 0, y: 0, r: 0 }, EZ.soft]]);
  b.at('earL', t0 + 0.05, [[t0 + 0.4, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('earR', t0 + 0.05, [[t0 + 0.4, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('brows', t0 + 0.1, [[t0 + 0.24, { o: 0 }, EZ.ease]]);
  return t0 + 0.34;
}

export function authorRelax(c: Ctx, from: Pose): Shot {
  const b = new Builder(c, from);
  letGo(b, 0);
  b.beat('sigh', 0.36);
  b.at('squash', 0.1, [[0.34, { r: 0, sx: 1.02, sy: 0.975 }, EZ.ease], [0.62, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.blinkTo(0.22, 'happy');
  b.blinkTo(0.6, 'open');
  return b.shot('relax', 0.74, { focus: bodyRect(c.seat) });
}

/**
 * «Verschieben»: the chosen tiles fly off to the edge (the gallery's mock: the list hook; the app: WishGrid's exit
 * to the edge), he hops after them. `rects` = the tiles (layer px), `width` = the layer's width.
 */
export function authorMove(c: Ctx, from: Pose, o: { rects: readonly Rect[]; width: number; list?: ListHook; commit?: () => void }): Shot {
  const b = new Builder(c, from);
  const W = o.width || 390;
  letGo(b, 0);
  b.beat('fly', 0.55);
  // he turns and hops after them to the edge …
  const edge = { x: Math.min(c.seat.x + 36, W - 30), y: c.seat.y };
  const far = edge.x - c.seat.x > 8;
  b.turn(0.3, 0.13, 1);
  if (far) b.hop(0.4, 0.36, c.seat, edge, 12, 0, 2);
  const stand = far ? edge : c.seat;
  // … looks after them, one ear up (the approved sniff ear), a little sniff, waves
  const t = 0.82;
  b.beat('look', t + 0.3);
  b.at('squash', t, [[t + 0.2, { r: 4, sx: 1, sy: 1 }, EZ.out]]);
  b.at('earR', t, [[t + 0.25, { r: -30, sx: 1, sy: 1 }, EZ.out]]);
  b.at('nose', t + 0.2, [[t + 0.26, { sx: 1.08, sy: 0.84 }], [t + 0.32, { sx: 1, sy: 1 }], [t + 0.38, { sx: 1.08, sy: 0.84 }], [t + 0.44, { sx: 1, sy: 1 }]]);
  b.wave(t + 0.36, t + 1.1);
  const t2 = t + 1.12;
  b.at('earR', t2 - 0.1, [[t2 + 0.2, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('squash', t2, [[t2 + 0.18, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.beat('glide', 1.0);
  b.turn(t2 + 0.05, 0.13, -1);
  if (far) b.hop(t2 + 0.18, 0.36, stand, c.seat, 12, 0, -2);
  b.turn(t2 + (far ? 0.54 : 0.2), 0.14, 0);
  b.beat('back', t2 + 0.6);
  return b.shot('move', withList(b, t2 + (far ? 0.72 : 0.4), o.list), { focus: union(bodyRect(c.seat), bodyRect(edge), ...o.rects), ...(o.commit ? { commit: o.commit } : {}) });
}

/** Selection «Erhalten» / «Löschen»: he lets go of his ears, the chosen tiles leave (the app's exit), the gap closes. */
export function authorBulk(c: Ctx, from: Pose, o: { rects: readonly Rect[]; list?: ListHook; commit?: () => void }): Shot {
  const b = new Builder(c, from);
  letGo(b, 0);
  b.blinkTo(0.22, 'happy');
  b.blinkTo(0.66, 'open');
  b.beat('leave', 0.1);
  return b.shot('bulk', withList(b, 0.86, o.list), { focus: union(bodyRect(c.seat), ...o.rects), ...(o.commit ? { commit: o.commit } : {}) });
}

// ------------------------------------------------------------------------------------------------ 7. the end of the list

/** The gallery's line (the app says it in the person's language: wishes `wish.pompon_end`). */
export const END_TEXT = 'Das war’s!';

export interface EndBubble {
  el: HTMLElement;
  text: string;
  /** px: the bubble's width (the text in one line) */
  width: number;
  /** px: the layer's width (the bubble stays inside it) */
  layerWidth: number;
}

export function authorEnd(c: Ctx, from: Pose, bubble?: EndBubble | null): Shot {
  const b = new Builder(c, from);
  // he looks up the list you just scrolled past, then at you, and waves: «Das war’s!»
  b.at('face', 0, [[0.26, { x: 0, y: -2.6 }, EZ.face], [0.46, { x: 0, y: -2.6 }, 'linear'], [0.62, { x: 0, y: 0 }, EZ.ease]]);
  b.at('earL', 0, [[0.2, { r: -6 }, EZ.out], [0.6, { r: 0 }, EZ.ease]]);
  b.at('earR', 0, [[0.21, { r: 6 }, EZ.out], [0.61, { r: 0 }, EZ.ease]]);
  b.both(0, [[0.2, { sx: 1.06, sy: 1.1 }, EZ.out], [0.5, { sx: 1, sy: 1 }, EZ.ease]]);
  b.beat('up', 0.3);
  b.blinkTo(0.64, 'happy');
  b.wave(0.62, 1.62);
  b.beat('wave', 1.05);
  let focus = bodyRect(c.seat);
  if (bubble) {
    const el = bubble.el;
    el.textContent = bubble.text;
    const W = bubble.layerWidth || 390;
    const bw = bubble.width;
    const right = c.seat.x + 20 + bw < W - 8;
    const bx = right ? c.seat.x + 20 : Math.max(8, c.seat.x - 20 - bw);
    const by = c.seat.y - 84;
    el.style.transformOrigin = right ? '0% 100%' : '100% 100%';
    el.style.width = `${bw}px`;
    el.style.textAlign = 'center';
    b.dom('bubble', el, { x: bx, y: by, s: 0.8, o: 0 }).path(0.66, [[0.88, { x: bx, y: by, s: 1, o: 1 }, EZ.spring], [1.7, { x: bx, y: by, s: 1, o: 1 }, 'linear'], [1.92, { x: bx, y: by - 4, s: 0.96, o: 0 }, EZ.ease]]);
    focus = union(focus, { x: bx, y: by, w: bw, h: 34 });
  }
  b.blinkTo(1.72, 'open');
  return b.shot('end', 2.02, { focus });
}

export function authorBounce(c: Ctx, from: Pose): Shot {
  const b = new Builder(c, from);
  b.beat('up', 0.26);
  b.at('squash', 0, [[0.08, { r: 0, sx: 1.07, sy: 0.92 }, EZ.out], [0.2, { r: 0, sx: 0.96, sy: 1.06 }, EZ.out], [0.4, { r: 0, sx: 1, sy: 1 }, EZ.ease], [0.46, { r: 0, sx: 1.05, sy: 0.95 }, EZ.in], [0.62, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('hop', 0.1, [[0.26, { y: -12 }, EZ.up], [0.42, { y: 0 }, EZ.down]]);
  b.at('earL', 0, [[0.12, { r: 6 }], [0.3, { r: -9 }], [0.48, { r: 5 }], [0.64, { r: 0 }]]);
  b.at('earR', 0, [[0.12, { r: -6 }], [0.3, { r: 9 }], [0.48, { r: -5 }], [0.64, { r: 0 }]]);
  b.at('shadow', 0.1, [[0.26, { sx: 0.8, sy: 0.8, o: 0.6 }, EZ.up], [0.42, { sx: 1, sy: 1, o: 1 }, EZ.down]]);
  return b.shot('bounce', 0.66, { focus: bodyRect(c.seat) });
}

// ------------------------------------------------------------------------------------------------ 8. the empty list

/**
 * The gift box of the empty list (./box.ts builds it; Felix 31.10: box and lid must clearly belong together — the lid
 * is the box's width plus a small overhang, the ribbon runs on from the box over the lid). HTML layers, px of the
 * layer Pompon lives in: back wall < Pompon < front < lid. The lid is two boxes: `lidOuter` shakes with the box,
 * `lidInner` lifts a crack / flies off (about its own centre).
 */
export interface GiftBox {
  back: HTMLElement;
  front: HTMLElement;
  lidOuter: HTMLElement;
  lidInner: HTMLElement;
  /** his feet inside the closed box (all of him hidden) */
  inBox: Vec;
  /** his feet while his eyes look out of the crack under the lifted lid */
  peekAt: Vec;
  /** his feet where he lands beside the box */
  land: Vec;
  /** where the knocked-off lid comes to rest (px and degrees from where it sat) */
  lidLand: { x: number; y: number; r: number };
}

/** The lid lifted a crack (the peek, and the still pose under reduced motion): up, the right side a little more. */
export const LID_CRACK: Channels = { x: 0, y: -10, r: -7 };

/**
 * Now and then (resting in the closed box): the lid lifts a crack, his eyes and the ends of his ears show in it, he looks
 * left and right, blinks, ducks — the lid drops back with one small bounce. A tap on the box plays it at once.
 */
export function authorPeek(c: Ctx, from: Pose, box: GiftBox): Shot {
  const b = new Builder(c, from);
  b.beat('crack', 0.36);
  b.dom('lid', box.lidInner, { x: 0, y: 0, r: 0 }).path(0.02, [
    [0.3, { ...LID_CRACK }, EZ.out],
    [1.26, { ...LID_CRACK }, 'linear'],
    [1.44, { x: 0, y: 0, r: 0 }, EZ.in],
    [1.53, { x: 0, y: -2, r: -0.8 }, EZ.out],
    [1.64, { x: 0, y: 0, r: 0 }, EZ.in],
  ]);
  b.at('box', 0.06, [[0.36, feetAt(box.peekAt), EZ.out], [1.22, feetAt(box.peekAt), 'linear'], [1.42, feetAt(box.inBox), EZ.in]]);
  // a look left, a look right, one blink
  b.beat('look', 0.8);
  b.at('face', 0.4, [[0.58, { x: -2.2, y: 0 }, EZ.face], [0.86, { x: -2.2, y: 0 }, 'linear'], [1.02, { x: 2, y: 0 }, EZ.face], [1.16, { x: 2, y: 0 }, 'linear'], [1.34, { x: 0, y: 0 }, EZ.ease]]);
  b.both(0.88, [[0.93, { sx: 1, sy: 0.12 }, EZ.in], [1.01, { sx: 1, sy: 1 }, EZ.out]]);
  return b.shot('peek', 1.7, { focus: union(bodyRect(box.peekAt), { x: box.inBox.x - 60, y: box.inBox.y - 80, w: 120, h: 84 }), endAt: box.inBox });
}

/**
 * "+": from inside, the closed box wiggles twice and gives a little bump; then his head knocks the lid up and off (a
 * small spin, it lands tilted on the floor beside the box — it stays there) and he jumps out with the approved squash,
 * stretch and tucked feet — his face, ears and paws keep their shapes — and lands on the other side. Stars, once.
 */
export function authorPop(c: Ctx, from: Pose, box: GiftBox): Shot {
  const b = new Builder(c, from);
  // 1. the closed box wiggles (about its bottom middle), twice, then a little bump; the lid hops a hair on the bump
  b.beat('wiggle', 0.14);
  const wig: Pts = [
    [0.08, { r: 2.4, sx: 1, sy: 1 }, EZ.ease],
    [0.18, { r: -2.2, sx: 1, sy: 1 }, EZ.ease],
    [0.28, { r: 1.6, sx: 1, sy: 1 }, EZ.ease],
    [0.38, { r: 0, sx: 1, sy: 1 }, EZ.ease],
    [0.46, { r: 0, sx: 1.025, sy: 0.97 }, EZ.out],
    [0.56, { r: 0, sx: 1, sy: 1 }, EZ.soft],
  ];
  for (const [key, el] of [['back', box.back], ['front', box.front], ['lidOuter', box.lidOuter]] as const) b.dom(`box.${key}`, el, { r: 0, sx: 1, sy: 1 }).path(0, wig);
  // 2. the lid: a hair up on the bump — then knocked up and off with a small spin; it lands tilted on the floor, one bounce
  const L = box.lidLand;
  b.beat('bump', 0.47);
  b.beat('knock', 0.74);
  b.dom('lid', box.lidInner, { x: 0, y: 0, r: 0 }).path(0.4, [
    [0.47, { x: 0, y: -4, r: -1 }, EZ.out],
    [0.55, { x: 0, y: 0, r: 0 }, EZ.in],
    [0.6, { x: 0, y: 0, r: 0 }, 'linear'],
    [0.8, { x: L.x * 0.42, y: -50, r: -36 }, EZ.up],
    [0.98, { x: L.x, y: L.y, r: L.r }, EZ.down],
    [1.05, { x: L.x - 2, y: L.y - 5, r: L.r + 3 }, EZ.out],
    [1.13, { x: L.x - 3, y: L.y, r: L.r }, EZ.in],
  ]);
  // 3. he jumps out (crouches inside first, unseen) and lands beside the box
  b.beat('air', 0.86);
  b.bound(0.52, 0.66, box.inBox, box.land, 76);
  b.beat('land', 1.08);
  // landed: stars in his eyes (once — this is the moment for them), then plain eyes again
  b.beat('stars', 1.4);
  b.blinkTo(1.3, 'star');
  b.blinkTo(1.76, 'open');
  return b.shot('pop', 1.94, {
    focus: union(bodyRect(box.inBox), bodyRect(box.land), { x: box.inBox.x + L.x - 50, y: box.inBox.y - 110, w: box.land.x - box.inBox.x - L.x + 80, h: 120 }),
    endAt: box.land,
  });
}

// ------------------------------------------------------------------------------------------------ 9. pull the ear

export type Side = 'l' | 'r';
const earOf = (side: Side): PartName => (side === 'r' ? 'earR' : 'earL');
const otherOf = (side: Side): PartName => (side === 'r' ? 'earL' : 'earR');
/** Outward = away from the face: the right ear turns negative, the left one positive (their pivots are at the top). */
export const outward = (side: Side) => (side === 'r' ? -1 : 1);

/** "Ай!": > < eyes, a wincing little mouth, the head tilts toward the pulled ear, the other ear perks. */
function ouch(b: Builder, t0: number, side: Side): void {
  const s = side === 'r' ? 1 : -1;
  b.blinkTo(t0 + 0.04, 'squint');
  // the wincing mouth stays open until the ear is let go (springBack closes it)
  b.set('mouthO', t0 + 0.04, { o: 1, sx: 1.15, sy: 0.62 });
  b.set('mouth', t0 + 0.04, { o: 0 });
  b.at('squash', t0, [[t0 + 0.18, { r: s * 3, sx: 1, sy: 1 }, EZ.out]]);
  b.at(otherOf(side), t0, [[t0 + 0.18, { r: -s * 8, sx: 1, sy: 1 }, EZ.out]]);
  for (const ch of ['cheekL', 'cheekR'] as const) b.at(ch, t0, [[t0 + 0.16, { sx: 1.05, sy: 1.05 }, EZ.out]]);
}

/** The live grab: only the face goes "ай" (the finger moves the ear itself, inline). Stays (`keep`). */
export function authorGrab(c: Ctx, from: Pose, side: Side): Shot {
  const b = new Builder(c, from);
  b.mark(0.02, 'tap', 'ушко');
  ouch(b, 0, side);
  return b.shot('grab', 0.2, { focus: bodyRect(c.seat), keep: true });
}

/** The ear springs back from wherever it was (one or two soft settles), "ай" ends, a giggle, a little shake. */
function springBack(b: Builder, t0: number, side: Side, cur: Channels): number {
  const ear = earOf(side);
  const r0 = cur.r ?? 0;
  const sy0 = cur.sy ?? 1;
  b.at(ear, t0, [
    [t0 + 0.12, { r: -r0 * 0.42, sx: 1, sy: 1 - (sy0 - 1) * 0.3 }, EZ.out],
    [t0 + 0.26, { r: r0 * 0.16, sx: 1, sy: 1 + (sy0 - 1) * 0.1 }, EZ.ease],
    [t0 + 0.4, { r: -r0 * 0.05, sx: 1, sy: 1 }, EZ.ease],
    [t0 + 0.52, { r: 0, sx: 1, sy: 1 }, EZ.soft],
  ]);
  b.at('squash', t0, [[t0 + 0.16, { r: side === 'r' ? -1 : 1, sx: 1, sy: 1 }, EZ.out], [t0 + 0.3, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at(otherOf(side), t0, [[t0 + 0.3, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.set('mouthO', t0 + 0.08, { o: 0, sx: 1, sy: 1 });
  b.set('mouth', t0 + 0.08, { o: 1 });
  for (const ch of ['cheekL', 'cheekR'] as const) b.at(ch, t0, [[t0 + 0.36, { sx: 1, sy: 1 }, EZ.ease]]);
  b.blinkTo(t0 + 0.1, 'open');
  // a giggle (^ ^) …
  b.beat('giggle', t0 + 0.7);
  b.blinkTo(t0 + 0.44, 'happy');
  b.giggle(t0 + 0.46);
  // … and a little shake, the ears flop after it
  const ts = t0 + 1.06;
  b.beat('shake', ts + 0.14);
  b.blinkTo(ts, 'open');
  b.at('squash', ts, [[ts + 0.08, { r: 2.6, sx: 1, sy: 1 }, EZ.ease], [ts + 0.17, { r: -2.6, sx: 1, sy: 1 }, EZ.ease], [ts + 0.26, { r: 1.6, sx: 1, sy: 1 }, EZ.ease], [ts + 0.36, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('face', ts, [[ts + 0.08, { x: 1.4, y: 0 }, EZ.ease], [ts + 0.17, { x: -1.4, y: 0 }, EZ.ease], [ts + 0.26, { x: 0.8, y: 0 }, EZ.ease], [ts + 0.36, { x: 0, y: 0 }, EZ.soft]]);
  for (const e of ['earL', 'earR'] as const) b.at(e, ts + 0.03, [[ts + 0.11, { r: -7, sx: 1, sy: 1 }, EZ.ease], [ts + 0.2, { r: 7, sx: 1, sy: 1 }, EZ.ease], [ts + 0.29, { r: -4, sx: 1, sy: 1 }, EZ.ease], [ts + 0.42, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  return ts + 0.48;
}

/** The live release (the finger let go, or pulled too far and the ear slipped out): from the pose on screen. */
export function authorRelease(c: Ctx, from: Pose, side: Side): Shot {
  const b = new Builder(c, from);
  b.beat('spring', 0.14);
  const end = springBack(b, 0, side, from[earOf(side)] ?? {});
  return b.shot('release', end, { focus: bodyRect(c.seat) });
}

/** The button / frames version: a ghost finger takes the ear tip, pulls, lets go — one timeline. */
export function authorPull(c: Ctx, from: Pose, side: Side = 'r'): Shot {
  const b = new Builder(c, from);
  const s = side === 'r' ? 1 : -1;
  const tip = b.p(s * 68, -88);
  const pulled = { x: tip.x + s * 15, y: tip.y + 7 };
  ghost(b, { x: tip.x + s * 12, y: tip.y + 6 }, [[0.12, tip, 0.95, EZ.out], [0.7, pulled, 0.95, EZ.ease], [0.85, { x: pulled.x + s, y: pulled.y }, 0.95], [1.0, { x: pulled.x + s * 22, y: pulled.y + 4 }, 0, EZ.out]], 0.62);
  b.beat('grab', 0.2);
  b.mark(0.14, 'tap', 'ушко');
  ouch(b, 0.14, side);
  const o = outward(side);
  b.beat('pull', 0.7);
  b.at(earOf(side), 0.12, [[0.2, { r: o * 4, sx: 1, sy: 1.02 }, EZ.out], [0.7, { r: o * 16, sx: 0.99, sy: 1.075 }, EZ.ease], [0.78, { r: o * 17, sx: 0.99, sy: 1.08 }, EZ.ease], [0.85, { r: o * 16.4, sx: 0.99, sy: 1.075 }, EZ.ease]]);
  b.beat('spring', 0.98);
  const end = springBack(b, 0.85, side, { r: o * 16.4, sy: 1.075 });
  return b.shot('pull', end, { focus: union(bodyRect(c.seat), { x: pulled.x - 20, y: pulled.y - 20, w: 40, h: 40 }) });
}

/**
 * The live ear (between grab and release): the ear follows the finger elastically — it turns toward it and stretches a
 * little as a whole, softly limited (≤ 24°, ≤ 9 %). `slip` = pulled too far: the ear lets go by itself. `finger` and
 * `feet` in the same px; `unit` = px per puppet unit (a Pompon of another size).
 */
export function earFollow(side: Side, finger: Vec, feet: Vec, unit: number = UNIT): { pose: Channels; slip: boolean } {
  const s = side === 'r' ? 1 : -1;
  const pivot = { x: feet.x + s * 35.4 * unit, y: feet.y - 166.4 * unit };
  const tip = { x: feet.x + s * 66 * unit, y: feet.y - 86 * unit };
  const a0 = Math.atan2(tip.y - pivot.y, tip.x - pivot.x);
  const a1 = Math.atan2(finger.y - pivot.y, finger.x - pivot.x);
  let deg = ((a1 - a0) * 180) / Math.PI;
  if (deg > 180) deg -= 360;
  if (deg < -180) deg += 360;
  const len0 = Math.hypot(tip.x - pivot.x, tip.y - pivot.y);
  const len1 = Math.hypot(finger.x - pivot.x, finger.y - pivot.y);
  const stretch = len1 / len0 - 1;
  const slip = Math.abs(deg) > 55 || stretch > 0.95;
  // soft limits: a rubber band (tanh), never a new shape
  const r = 24 * Math.tanh(deg / 30);
  const sy = 1 + 0.09 * Math.tanh(Math.max(0, stretch) / 0.4);
  return { pose: { r, sx: 1 - (sy - 1) * 0.3, sy }, slip };
}

// ------------------------------------------------------------------------------------------------ 10. shaken: dizzy

export const DIZZY_S = 2.72;

/** `shake` = an element that shakes like the phone (the gallery's "Schütteln": the mock; on a real phone the hand). */
export function authorDizzy(c: Ctx, from: Pose, shake?: HTMLElement | null): Shot {
  const b = new Builder(c, from);
  if (shake) {
    b.dom('phone', shake, { x: 0, r: 0 }).path(0, [[0.06, { x: -6, r: -1.2 }, EZ.ease], [0.13, { x: 6, r: 1.2 }, EZ.ease], [0.2, { x: -5, r: -1 }, EZ.ease], [0.27, { x: 5, r: 1 }, EZ.ease], [0.34, { x: -3, r: -0.5 }, EZ.ease], [0.42, { x: 0, r: 0 }, EZ.soft]]);
  }
  // jostled: the body lags behind the shake, small bumps, the ears flop
  b.beat('shake', 0.2);
  b.at('squash', 0.03, [[0.1, { r: 3, sx: 1.02, sy: 0.97 }, EZ.ease], [0.17, { r: -3, sx: 1.02, sy: 0.97 }, EZ.ease], [0.24, { r: 2.6, sx: 1.01, sy: 0.98 }, EZ.ease], [0.31, { r: -2.4, sx: 1.01, sy: 0.98 }, EZ.ease], [0.38, { r: 1.2, sx: 1, sy: 1 }, EZ.ease], [0.46, { r: 0, sx: 1, sy: 1 }, EZ.ease]]);
  b.at('hop', 0.03, [[0.08, { y: -5 }, EZ.out], [0.13, { y: 0 }, EZ.in], [0.2, { y: -4 }, EZ.out], [0.26, { y: 0 }, EZ.in], [0.33, { y: -2.5 }, EZ.out], [0.4, { y: 0 }, EZ.in]]);
  for (const e of ['earL', 'earR'] as const) b.at(e, 0.06, [[0.13, { r: -10 }], [0.2, { r: 10 }], [0.27, { r: -8 }], [0.34, { r: 8 }], [0.42, { r: -3 }], [0.5, { r: 0 }]]);
  b.both(0.03, [[0.1, { sx: 1.2, sy: 1.2 }, EZ.out], [0.4, { sx: 1.1, sy: 1.1 }, EZ.ease]]);
  // dizzy: spiral eyes (spinning), three stars circle his head, a gentle wobble (≤ 3°)
  b.beat('dizzy', 1.0);
  b.blinkTo(0.48, 'spiral');
  b.at('spinL', 0.48, [[2.0, { r: -620 }, 'linear']]);
  b.at('spinR', 0.48, [[2.0, { r: -560 }, 'linear']]);
  const turns = 1.6;
  const K = 24;
  (['star1', 'star2', 'star3'] as const).forEach((part, i) => {
    const pts: Array<readonly [number, ChannelInput, string?]> = [];
    for (let j = 0; j <= K; j++) {
      const q = j / K;
      const a = (i / 3 + q * turns) * 2 * Math.PI;
      const sc = 0.72 + 0.28 * Math.sin(a);
      pts.push([0.52 + q * 1.44, { x: Math.cos(a) * 64, y: Math.sin(a) * 16, sx: sc, sy: sc, o: j === 0 || j === K ? 0 : 1 }, 'linear']);
    }
    const first = pts[0];
    if (first) b.set(part, 0.52, first[1]);
    b.at(part, 0.52, pts.slice(1));
    // invisible again: back to rest unseen
    b.set(part, 2.0, { ...NEUTRAL[part] });
  });
  b.set('spinL', 2.06, { r: 0 });
  b.set('spinR', 2.06, { r: 0 });
  b.at('squash', 0.5, [[0.86, { r: 3, sx: 1, sy: 1 }, EZ.ease], [1.22, { r: -2.6, sx: 1, sy: 1 }, EZ.ease], [1.54, { r: 1.8, sx: 1, sy: 1 }, EZ.ease], [1.8, { r: -0.9, sx: 1, sy: 1 }, EZ.ease], [1.96, { r: 0, sx: 1, sy: 1 }, EZ.ease]]);
  b.at('face', 0.5, [[0.86, { x: 1, y: 0.6 }, EZ.ease], [1.22, { x: -1, y: 0.6 }, EZ.ease], [1.54, { x: 0.6, y: 0.4 }, EZ.ease], [1.8, { x: -0.4, y: 0.2 }, EZ.ease], [1.96, { x: 0, y: 0 }, EZ.ease]]);
  for (const e of ['earL', 'earR'] as const) b.at(e, 0.56, [[0.92, { r: -5 }, EZ.ease], [1.28, { r: 4 }, EZ.ease], [1.6, { r: -3 }, EZ.ease], [1.86, { r: 1 }, EZ.ease], [2.0, { r: 0 }, EZ.ease]]);
  // shakes it off: a quick head shake, plain eyes again, the ears flop, then he steadies
  const ts = 2.0;
  b.beat('off', ts + 0.12);
  b.blinkTo(ts + 0.02, 'open');
  b.at('squash', ts, [[ts + 0.07, { r: 2.2, sx: 1, sy: 1 }, EZ.ease], [ts + 0.14, { r: -2.2, sx: 1, sy: 1 }, EZ.ease], [ts + 0.21, { r: 1.4, sx: 1, sy: 1 }, EZ.ease], [ts + 0.3, { r: 0, sx: 1, sy: 1 }, EZ.ease], [ts + 0.44, { r: 0, sx: 1.025, sy: 0.975 }, EZ.ease], [ts + 0.66, { r: 0, sx: 1, sy: 1 }, EZ.soft]]);
  b.at('face', ts, [[ts + 0.07, { x: 2, y: 0 }, EZ.ease], [ts + 0.14, { x: -2, y: 0 }, EZ.ease], [ts + 0.21, { x: 1, y: 0 }, EZ.ease], [ts + 0.3, { x: 0, y: 0 }, EZ.ease]]);
  for (const e of ['earL', 'earR'] as const) b.at(e, ts, [[ts + 0.1, { r: -8 }, EZ.ease], [ts + 0.17, { r: 8 }, EZ.ease], [ts + 0.24, { r: -5 }, EZ.ease], [ts + 0.34, { r: 2 }, EZ.ease], [ts + 0.44, { r: 0 }, EZ.soft]]);
  return b.shot('dizzy', DIZZY_S, { focus: union(bodyRect(c.seat), { x: c.seat.x - 30, y: c.seat.y - 72, w: 60, h: 20 }) });
}

/** The pose a moment left on screen at `t` (its Pompon tracks' frame) — to continue from it without a jump. */
export function poseAt(shot: Shot, t: number, base: Pose = {}): Pose {
  const out: Pose = { ...base };
  for (const tr of shot.tracks) {
    if (!tr.name.startsWith('lp.')) continue;
    const part = tr.name.slice(3) as PartName;
    out[part] = { ...NEUTRAL[part], ...tr.sample(t) };
  }
  return out;
}
