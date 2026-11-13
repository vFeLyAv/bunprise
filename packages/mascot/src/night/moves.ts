/**
 * «Ночью маскоты спят» (approved 31.10) — the night moments, authored on the mascot timeline. Moved here from the
 * gallery prototype (demo/night/moves.ts re-exports it).
 *
 * Every moment is a Shot: Tracks (src/timeline.ts) on the puppet's own parts that start from ANY pose (`from`, e.g.
 * the frame where a falling-asleep was interrupted by a tap) and end in a known pose. Only transform and opacity;
 * each one-shot is ≤ 2 s (Felix's rule). seek(t) gives the same frame every time (the strips rely on it).
 *
 *   fall   (1.95 s) — a big yawn (eyes squeezed, ears stretch), drowsy eyes, he nods off once and catches himself,
 *                     then settles: eyes closed (the sleeping arcs), the head droops, the ears relax (+ the approved
 *                     drip, running down). Tapsi first lowers his binoculars onto his tummy.
 *   wake   (2.0 s)  — 'tap': a cute startle (eyes pop round, ears pop out, a little hop), a drowsy blink, he rubs one
 *                     eye with one paw (the other peeks, drowsy — Felix approved it 31.10), a small yawn + stretch,
 *                     then waves (the approved greet, ^ ^). Tapsi with
 *                     binoculars: startle → binoculars up "who's there?" → down → small yawn → waves with one paw.
 *                     'morning': the same without the startle (nobody woke him): eyes open slowly, stretch + yawn,
 *                     rubs eyes, waves.
 *   peek   (0.85 s) — the person scrolls elsewhere: one eye opens a crack, glances, closes; an ear twitches; he
 *                     keeps sleeping (the breathing and the "z" go on).
 *
 * The sleeping LOOP is not a Shot: sleepLoops() — two LoopTracks on the HTML wrappers (breath, z; compositor only).
 */

import { LoopTrack, Track, type ChannelInput, type Channels } from '../timeline';
import { BINO_DOWN, GLINT_OFF, NEUTRAL, sleepPose, type NightRig, type PartName, type Pose } from './rig';

/**
 * Easings: cubic-bezier only (the puppet's own curves, core.ts EASINGS / SPRING), never CSS linear() springs — the
 * JS sampler (Track.sample) evaluates exactly these, so the frame where a tap interrupts a moment is exactly the one
 * on screen (the wake-up starts from it without a jump).
 */
export const EZ = {
  out: 'cubic-bezier(.2,.7,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.5)',
  inOut: 'cubic-bezier(.45,0,.2,1)',
  smooth: 'cubic-bezier(.2,.7,.3,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
  ease: 'ease-in-out',
} as const;

export interface Shot {
  readonly name: 'fall' | 'wake' | 'morning' | 'peek';
  readonly tracks: readonly Track[];
  readonly duration: number;
  /** the pose every part is in at `duration` (written inline when the shot ends) */
  readonly end: Pose;
  /** beats for the gallery labels (s) */
  readonly marks: Readonly<Record<string, number>>;
}

/** Lazily made tracks of the parts (one track per part: two tracks never drive the same element). */
class Builder {
  private readonly made = new Map<PartName, Track>();
  readonly marks: Record<string, number> = {};
  constructor(
    readonly rig: NightRig,
    readonly from: Pose,
  ) {}

  has(name: PartName): boolean {
    return this.rig.has(name);
  }

  t(name: PartName): Track {
    const hit = this.made.get(name);
    if (hit) return hit;
    const tr = new Track(this.rig.els(name), `night.${name}`, { ...NEUTRAL[name], ...this.from[name] });
    this.made.set(name, tr);
    return tr;
  }

  /** `t(name)` only when the puppet has that part (binoculars, ear tip …). */
  opt(name: PartName): Track | null {
    return this.has(name) ? this.t(name) : null;
  }

  /** Which eyes show from `t` on (an instant switch, hidden by a squeeze or a blink); `open` = how open the round eyes are. */
  eyes(t: number, mode: 'open' | 'sleep' | 'happy', open = 1): void {
    this.t('eyesG').set(t, { o: mode === 'open' ? 1 : 0 });
    this.t('sleepL').set(t, { o: mode === 'sleep' ? 1 : 0 });
    this.t('sleepR').set(t, { o: mode === 'sleep' ? 1 : 0 });
    this.t('happy').set(t, { o: mode === 'happy' ? 1 : 0 });
    if (mode === 'open') {
      this.t('eyeL').set(t, { sx: 1, sy: open, o: 1 });
      this.t('eyeR').set(t, { sx: 1, sy: open, o: 1 });
    }
  }

  /** Both round eyes through the same keys (squeeze, blink, startle). */
  both(t0: number, points: ReadonlyArray<readonly [number, ChannelInput, string?]>): void {
    this.t('eyeL').path(Math.max(t0, this.t('eyeL').end), points);
    this.t('eyeR').path(Math.max(t0, this.t('eyeR').end), points);
  }

  /** The mouth wide open and closed again (the approved yawn: mouth-open scaled up, the closed mouth hidden). */
  yawn(t: number, open: number, hold: number, close: number, big: { sx: number; sy: number }): void {
    const y = this.t('yawn');
    y.set(t, { o: 1, sx: 1, sy: 1 });
    y.path(t, [[t + open, big, EZ.out], [t + open + hold, { sx: big.sx * 0.95, sy: big.sy * 0.93 }, EZ.ease], [t + open + hold + close, { sx: 1, sy: 1 }, EZ.in]]);
    y.set(t + open + hold + close + 0.02, { o: 0 });
    this.t('mouth').set(t, { o: 0 });
    this.t('mouth').set(t + open + hold + close + 0.02, { o: 1 });
  }

  /** Everything not yet at `end` glides there by `at` (parts the moment did not touch, e.g. the loop's head turn). */
  settle(end: Pose, at: number, from = 0, ease: string = EZ.smooth): void {
    for (const [name, v] of Object.entries(end) as [PartName, Channels][]) {
      if (!this.has(name)) continue;
      const tr = this.t(name);
      const cur = tr.sample(at);
      const target = { ...NEUTRAL[name], ...v };
      const same = (Object.keys(NEUTRAL[name]) as (keyof Channels)[]).every((c) => Math.abs((cur[c] ?? 0) - (target[c] ?? 0)) < 1e-4);
      if (!same) tr.move(Math.max(from, tr.end), Math.max(at, tr.end + 0.06), target, ease);
    }
  }

  shot(name: Shot['name'], duration: number, end: Pose): Shot {
    // a part whose last key is still after `duration` would end elsewhere — never authored that way (tests check it)
    const full: Pose = { ...this.from };
    for (const [n, v] of Object.entries(end) as [PartName, Channels][]) if (this.has(n)) full[n] = { ...NEUTRAL[n], ...v };
    for (const [n, tr] of this.made) full[n] = tr.sample(duration);
    return { name, tracks: [...this.made.values()], duration, end: full, marks: { ...this.marks } };
  }
}

/** The rest pose (awake) of this rig: every part neutral; Tapsi's binoculars lowered (the loop raises them itself). */
export function restPose(rig: NightRig): Pose {
  const out: Pose = {};
  for (const n of Object.keys(NEUTRAL) as PartName[]) if (rig.has(n)) out[n] = { ...NEUTRAL[n] };
  if (rig.binoculars) {
    out.bino = { ...BINO_DOWN };
    out.glint = { x: GLINT_OFF };
  }
  return out;
}

export function asleepPose(rig: NightRig, drip: boolean): Pose {
  return { ...restPose(rig), ...sleepPose(rig.geo, { binoculars: rig.binoculars, drip }) };
}

// ------------------------------------------------------------------------------------------------ fall asleep

export const FALL_S = 1.95;

export function authorFall(rig: NightRig, from: Pose, drip: boolean): Shot {
  const b = new Builder(rig, from);
  const end = asleepPose(rig, drip);
  const g = rig.geo;
  // whatever the awake loop was doing (Tapsi's look-around: head turn, lean, a blink) glides back to the middle
  b.settle({ tf: { x: 0 }, te: { x: 0 }, squash: { r: 0, sx: 1, sy: 1 }, eyeL: { sx: 1, sy: 1, o: 1 }, eyeR: { sx: 1, sy: 1, o: 1 } }, 0.28, 0.02);
  if (rig.binoculars) {
    // first the binoculars come down onto his tummy (a glint caught mid-sweep finishes its way off the lens)
    b.t('bino').move(0.02, 0.4, { ...BINO_DOWN }, EZ.smooth);
    const gx = b.t('glint').sample(0).x ?? 0;
    if (gx > 0 && gx < GLINT_OFF) b.t('glint').move(0, 0.2, { x: GLINT_OFF }, EZ.inOut);
    else if (gx <= 0) b.t('glint').set(0.4, { x: GLINT_OFF });
  }
  // (Tapsi: after his loop glided back to the middle, while the binoculars pass below his mouth)
  const y0 = rig.binoculars ? 0.3 : 0.08;
  b.marks.yawn = y0;
  // the big yawn: mouth wide, eyes squeezed, the body stretches up a little, the ears stretch out
  b.yawn(y0, 0.28, 0.2, 0.16, { sx: 2.1, sy: 2.6 });
  b.both(y0, [[y0 + 0.14, { sx: 1, sy: 0.25 }, EZ.out], [y0 + 0.48, { sx: 1, sy: 0.3 }], [y0 + 0.66, { sx: 1, sy: 0.55 }, EZ.ease]]);
  b.t('squash').path(Math.max(y0, b.t('squash').end), [[y0 + 0.26, { r: 0, sx: 0.975, sy: 1.04 }, EZ.out], [y0 + 0.62, { r: 0, sx: 1, sy: 1 }, EZ.ease]]);
  b.t('earL').path(y0, [[y0 + 0.24, { r: -6 }, EZ.out], [y0 + 0.62, { r: -2 }, EZ.ease]]);
  b.t('earR').path(y0, [[y0 + 0.26, { r: 6 }, EZ.out], [y0 + 0.64, { r: 2 }, EZ.ease]]);
  // drowsy, then he nods off once — the head dips, he catches himself — and the eyes close
  const n0 = y0 + 0.7;
  b.marks.nod = n0;
  b.both(n0, [[n0 + 0.16, { sy: 0.42 }, EZ.ease], [n0 + 0.3, { sy: 0.12 }, EZ.in]]);
  b.eyes(n0 + 0.31, 'sleep');
  b.t('face').path(n0, [[n0 + 0.26, { x: 0, y: 2.2 }, EZ.in], [n0 + 0.44, { x: 0, y: 1 }, EZ.out]]);
  b.t('body').path(n0, [[n0 + 0.26, { r: 2.4 }, EZ.in], [n0 + 0.44, { r: 1.1 }, EZ.out]]);
  b.t('squash').path(n0, [[n0 + 0.26, { r: 0, sx: 1.02, sy: 0.972 }, EZ.in], [n0 + 0.44, { r: 0, sx: 1.006, sy: 0.99 }, EZ.out]]);
  // … and settles into sleep: the head droops to one side, the body sinks, the ears relax
  const s0 = n0 + 0.5;
  b.marks.settle = s0;
  b.t('face').move(s0, FALL_S, { x: 0, y: 1.6 }, EZ.inOut);
  b.t('body').move(s0, FALL_S, { r: 4 }, EZ.inOut);
  b.t('squash').move(s0, FALL_S, { r: 0, sx: 1.025, sy: 0.965 }, EZ.inOut);
  b.t('earL').move(Math.max(s0 - 0.3, b.t('earL').end), FALL_S, { r: g.sleepEars.l }, EZ.inOut);
  b.t('earR').move(Math.max(s0 - 0.28, b.t('earR').end), FALL_S, { r: g.sleepEars.r }, EZ.inOut);
  if (drip) {
    // the approved drip appears and runs down a little (never a bubble)
    b.t('snot').set(s0 + 0.05, { o: 1, sy: 0.15 });
    b.t('snot').move(s0 + 0.05, FALL_S, { o: 1, sy: 0.7 }, EZ.out);
  }
  b.settle(end, FALL_S, s0);
  return b.shot('fall', FALL_S, end);
}

// ------------------------------------------------------------------------------------------------ wake up

export const WAKE_S = 2.0;

/**
 * A sleepy kid's rub: one paw (his right) comes up to his eye and rubs it in small circles, the head leans into it a
 * little; the other eye peeks half open, drowsy. From `t0`; returns when the eyes may open again (t0 + 0.46).
 * (Both paws over both eyes read as "no eyes" at 96 px — cream paws on a cream face; one eye stays readable.)
 */
function rubEyes(b: Builder, t0: number): number {
  const g = b.rig.geo;
  const dx = g.eye.x - g.paw.x;
  const dy = g.eye.y - g.paw.y;
  const up = 0.13;
  b.marks.rub = t0;
  // the rubbed eye is under the paw (nothing of it peeks out); the other one is open a crack
  const sw = t0 + 0.08;
  b.t('eyesG').set(sw, { o: 1 });
  b.t('eyeR').set(sw, { sx: 1, sy: 1, o: 0 });
  b.t('sleepR').set(sw, { o: 0 });
  b.t('sleepL').set(sw, { o: 0 });
  b.t('happy').set(sw, { o: 0 });
  b.t('eyeL').path(Math.max(t0, b.t('eyeL').end), [[sw, { sx: 1, sy: 0.5, o: 1 }, EZ.ease], [t0 + 0.3, { sx: 1, sy: 0.45, o: 1 }], [t0 + 0.36, { sx: 1, sy: 0.12, o: 1 }, EZ.in], [t0 + 0.44, { sx: 1, sy: 0.6, o: 1 }, EZ.out]]);
  const at = (t: number) => t0 + t;
  // the paw comes up to the eye (turned a little towards the nose), rubs it in small circles, goes down again
  b.t('pawR').path(at(0), [
    [at(up), { x: dx, y: dy + 2, r: -30 }, EZ.out],
    [at(up + 0.07), { x: dx - 2.5, y: dy + 0.5, r: -16 }, EZ.ease],
    [at(up + 0.14), { x: dx + 1, y: dy + 2.5, r: -32 }, EZ.ease],
    [at(up + 0.21), { x: dx - 2.5, y: dy + 0.5, r: -16 }, EZ.ease],
    [at(up + 0.28), { x: dx, y: dy + 2, r: -28 }, EZ.ease],
    [at(up + 0.42), { x: 0, y: 0, r: 0 }, EZ.smooth],
  ]);
  // the head leans into the paw a little
  b.t('body').path(Math.max(t0, b.t('body').end), [[at(up), { r: 2.5 }, EZ.out], [at(up + 0.3), { r: 2 }], [at(up + 0.42), { r: 0 }, EZ.smooth]]);
  b.t('face').path(Math.max(t0, b.t('face').end), [[at(up + 0.07), { x: 0.6, y: 0 }, EZ.ease], [at(up + 0.14), { x: -0.4, y: 0 }, EZ.ease], [at(up + 0.21), { x: 0.6, y: 0 }, EZ.ease], [at(up + 0.3), { x: 0, y: 0 }, EZ.ease]]);
  return t0 + 0.46;
}

/** The approved wave of the greet (paw-r beside the cheek, −22° / +16°), two waves; happy eyes. */
function wave(b: Builder, t0: number, end: number): void {
  const g = b.rig.geo;
  b.marks.wave = t0;
  b.eyes(t0, 'happy');
  const lift = 0.12;
  const beat = (end - t0 - lift - 0.14) / 3;
  if (b.rig.binoculars) {
    // his right paw lets go of the (lowered) binoculars and waves beside his cheek
    b.t('binoPaw').path(t0, [
      [t0 + lift, { x: 15, y: -28, r: -22 }, EZ.out],
      [t0 + lift + beat, { x: 15, y: -28, r: 16 }, EZ.ease],
      [t0 + lift + 2 * beat, { x: 15, y: -28, r: -22 }, EZ.ease],
      [t0 + lift + 3 * beat, { x: 15, y: -28, r: 12 }, EZ.ease],
      [end, { x: 0, y: 0, r: 0 }, EZ.smooth],
    ]);
  } else {
    b.t('pawR').path(Math.max(t0, b.t('pawR').end), [
      [t0 + lift, { x: g.wave.x, y: g.wave.y, r: -22 }, EZ.out],
      [t0 + lift + beat, { x: g.wave.x, y: g.wave.y, r: 16 }, EZ.ease],
      [t0 + lift + 2 * beat, { x: g.wave.x, y: g.wave.y, r: -22 }, EZ.ease],
      [t0 + lift + 3 * beat, { x: g.wave.x, y: g.wave.y, r: 12 }, EZ.ease],
      [end, { x: 0, y: 0, r: 0 }, EZ.smooth],
    ]);
  }
  b.t('body').path(Math.max(t0, b.t('body').end), [[t0 + 0.14, { r: -3 }, EZ.out], [end, { r: 0 }, EZ.ease]]);
  // the small open mouth of the greet
  b.t('yawn').set(t0 + 0.04, { o: 1, sx: 1, sy: 1 });
  b.t('mouth').set(t0 + 0.04, { o: 0 });
  b.t('yawn').set(end - 0.04, { o: 0, sx: 1, sy: 1 });
  b.t('mouth').set(end - 0.04, { o: 1 });
  b.eyes(end - 0.02, 'open');
}

export function authorWake(rig: NightRig, from: Pose, variant: 'tap' | 'morning'): Shot {
  const b = new Builder(rig, from);
  const end = restPose(rig);
  // the sleeping loop on the wrappers stops: breathing back to rest, the "z" fades where it is
  b.t('breath').move(0, 0.22, { ...NEUTRAL.breath }, EZ.smooth);
  b.t('z').move(0, 0.16, { ...(from.z ?? NEUTRAL.z), o: 0 }, EZ.ease);
  // the drip is sniffed back in (the approved sniff: it shrinks up)
  if ((from.snot?.o ?? 0) > 0) {
    b.t('snot').move(0, 0.14, { o: 1, sy: 0.08 }, EZ.in);
    b.t('snot').set(0.16, { o: 0, sy: 1 });
  }
  let t: number;
  if (variant === 'tap') {
    // the startle: eyes pop round and big, ears pop out, a little hop — the head comes up at once
    b.marks.startle = 0;
    b.eyes(0.02, 'open', 1.25);
    b.t('eyeL').set(0.02, { sx: 1.25, sy: 1.25, o: 1 });
    b.t('eyeR').set(0.02, { sx: 1.25, sy: 1.25, o: 1 });
    b.both(0.02, [[0.28, { sx: 1.14, sy: 1.14 }, EZ.ease], [0.4, { sx: 1, sy: 1 }, EZ.ease]]);
    b.t('earL').path(0, [[0.1, { r: rig.kind === 'bunny' ? -14 : 8 }, EZ.out], [0.28, { r: rig.kind === 'bunny' ? 5 : -4 }, EZ.ease], [0.42, { r: 0 }, EZ.ease]]);
    b.t('earR').path(0, [[0.1, { r: rig.kind === 'bunny' ? 14 : -8 }, EZ.out], [0.28, { r: rig.kind === 'bunny' ? -5 : 4 }, EZ.ease], [0.42, { r: 0 }, EZ.ease]]);
    b.opt('tip')?.path(0, [[0.12, { r: -12 }, 'ease-out'], [0.23, { r: 0 }, 'ease-out'], [0.34, { r: -12 }, 'ease-out'], [0.46, { r: 0 }, 'ease-out']]);
    b.t('hop').path(0, [[0.12, { y: -13 }, EZ.out], [0.28, { y: 0 }, EZ.in]]);
    b.t('squash').path(0, [[0.06, { r: 0, sx: 0.96, sy: 1.06 }, EZ.out], [0.28, { r: 0, sx: 1.05, sy: 0.95 }, EZ.in], [0.4, { r: 0, sx: 1, sy: 1 }, EZ.out]]);
    b.t('body').move(0, 0.3, { r: 0 }, EZ.out);
    b.t('face').move(0, 0.2, { x: 0, y: 0 }, EZ.out);
    t = 0.4;
  } else {
    // morning: nobody woke him — the eyes open slowly (a sleepy blink), the head comes up
    b.marks.open = 0.05;
    b.eyes(0.06, 'open', 0.12);
    b.both(0.06, [[0.22, { sx: 1, sy: 0.5 }, EZ.ease], [0.28, { sx: 1, sy: 0.12 }, EZ.in], [0.36, { sx: 1, sy: 0.7 }, EZ.out]]);
    b.t('body').move(0.04, 0.36, { r: 0 }, EZ.smooth);
    b.t('face').move(0.04, 0.36, { x: 0, y: 0 }, EZ.smooth);
    b.t('earL').move(0.04, 0.4, { r: 0 }, EZ.smooth);
    b.t('earR').move(0.04, 0.4, { r: 0 }, EZ.smooth);
    b.t('squash').move(0.04, 0.36, { r: 0, sx: 1, sy: 1 }, EZ.smooth);
    t = 0.36;
  }

  if (rig.binoculars) {
    // Tapsi cannot rub his eyes (his paws hold the binoculars): "who's there?" — binoculars up to his eyes (a soft
    // spring), a look at you, down onto his tummy again
    const t0 = t - 0.32;
    b.marks.look = t0;
    b.t('bino').path(t0, [
      [t - 0.08, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, EZ.spring],
      [t + 0.1, { x: -3, y: 0, r: -3, sx: 1, sy: 1 }, EZ.ease],
      [t + 0.24, { x: 3, y: 0, r: 3, sx: 1, sy: 1 }, EZ.ease],
      [t + 0.3, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, EZ.ease],
      [t + 0.46, { ...BINO_DOWN }, EZ.smooth],
    ]);
    b.t('glint').set(t, { x: 0 });
    b.t('glint').move(t, t + 0.26, { x: GLINT_OFF }, EZ.inOut);
    t += 0.46;
  } else {
    t = rubEyes(b, t);
    b.eyes(t - 0.02, 'open', 0.75);
  }

  // a small yawn and a stretch (eyes squeezed while the mouth is open)
  b.marks.stretch = t;
  b.yawn(t + 0.02, 0.1, 0.06, 0.1, { sx: 1.6, sy: 2 });
  b.both(t + 0.02, [[t + 0.1, { sx: 1, sy: 0.3 }, EZ.out], [t + 0.3, { sx: 1, sy: 1 }, EZ.out]]);
  b.t('squash').path(Math.max(t, b.t('squash').end), [[t + 0.14, { r: 0, sx: 0.975, sy: 1.045 }, EZ.out], [t + 0.32, { r: 0, sx: 1, sy: 1 }, EZ.ease]]);
  b.t('earL').path(Math.max(t, b.t('earL').end), [[t + 0.14, { r: -4 }, EZ.out], [t + 0.32, { r: 0 }, EZ.ease]]);
  b.t('earR').path(Math.max(t, b.t('earR').end), [[t + 0.14, { r: 4 }, EZ.out], [t + 0.32, { r: 0 }, EZ.ease]]);
  t += 0.32;

  // waves hello (the approved greet), then plain eyes again
  wave(b, t, WAKE_S - 0.04);
  b.settle(end, WAKE_S, WAKE_S - 0.3);
  return b.shot(variant === 'tap' ? 'wake' : 'morning', WAKE_S, end);
}

// ------------------------------------------------------------------------------------------------ peek

export const PEEK_S = 0.85;

/** The person scrolls elsewhere: one eye opens a crack, glances, closes again; an ear twitches. Still asleep after. */
export function authorPeek(rig: NightRig, from: Pose): Shot {
  const b = new Builder(rig, from);
  const end: Pose = { ...from };
  delete end.breath;
  delete end.z;
  b.marks.peek = 0.08;
  // the right eye only: its sleeping arc goes, the round eye shows a crack
  b.t('eyesG').set(0.08, { o: 1 });
  b.t('eyeL').set(0.08, { sx: 1, sy: 1, o: 0 });
  b.t('eyeR').set(0.08, { sx: 1, sy: 0.12, o: 1 });
  b.t('sleepR').set(0.08, { o: 0 });
  b.t('eyeR').path(0.08, [[0.22, { sx: 1, sy: 0.5, o: 1 }, EZ.out], [0.6, { sx: 1, sy: 0.55, o: 1 }], [0.7, { sx: 1, sy: 0.12, o: 1 }, EZ.in]]);
  b.t('sleepR').set(0.71, { o: 1 });
  b.t('eyesG').set(0.71, { o: 0 });
  b.t('eyeL').set(0.72, { sx: 1, sy: 1, o: 1 });
  b.t('eyeR').set(0.72, { sx: 1, sy: 1, o: 1 });
  const f = from.face ?? { x: 0, y: 1.6 };
  b.t('face').path(0.1, [[0.26, { x: 1.4, y: f.y ?? 1.6 }, EZ.out], [0.6, { x: 1.6, y: f.y ?? 1.6 }], [0.82, { x: f.x ?? 0, y: f.y ?? 1.6 }, EZ.ease]]);
  const er = from.earR?.r ?? 0;
  b.t('earR').path(0.12, [[0.2, { r: er - 9 }, 'ease-out'], [0.3, { r: er + 2 }, 'ease-in-out'], [0.4, { r: er }, 'ease-out']]);
  return b.shot('peek', PEEK_S, end);
}

// ------------------------------------------------------------------------------------------------ the sleeping loop

/** Breath period (s): slower than awake (3.6 s) — he is asleep. The "z" floats once every two breaths. */
export const BREATH_S = 4.6;
export const Z_S = 9.2;

/**
 * The sleeping loop: TWO Web Animations, both on HTML wrappers (composited: no SVG repaint, no main-thread work per
 * frame), slow, transform / opacity only. With the drip on, a third, tiny one runs inside the SVG (in step with the breath).
 */
export function sleepLoops(rig: NightRig, drip: boolean): LoopTrack[] {
  const zk = rig.size / 96;
  const out = [
    new LoopTrack(rig.els('breath')[0] as Element, 'night.breathLoop', 0, BREATH_S, [
      [0, { r: 0, sx: 1, sy: 1 }, 'ease-in-out'],
      [0.5, { r: 0.5, sx: 1.006, sy: 1.02 }, 'ease-in-out'],
      [1, { r: 0, sx: 1, sy: 1 }],
    ]),
    new LoopTrack(rig.els('z')[0] as Element, 'night.zLoop', 0, Z_S, [
      [0, { x: 0, y: 0, sx: 0.7, sy: 0.7, o: 0 }, 'ease-out'],
      [0.09, { x: 1.5 * zk, y: -3 * zk, sx: 0.85, sy: 0.85, o: 0.9 }, 'ease-out'],
      [0.44, { x: 8 * zk, y: -17 * zk, sx: 1.15, sy: 1.15, o: 0 }],
      [1, { x: 8 * zk, y: -17 * zk, sx: 1.15, sy: 1.15, o: 0 }],
    ]),
  ];
  const snot = rig.els('snot')[0];
  if (drip && snot) {
    out.push(
      new LoopTrack(snot, 'night.snotLoop', 0, BREATH_S, [
        [0, { o: 1, sy: 0.7 }, 'ease-in-out'],
        [0.5, { o: 1, sy: 1.05 }, 'ease-in-out'],
        [1, { o: 1, sy: 0.7 }],
      ]),
    );
  }
  return out;
}
