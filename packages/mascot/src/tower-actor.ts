/**
 * One bunny of «Парад» v2 (the tower): the SAME puppet as the mascot and the welcome stage (mountBunny + coat from
 * welcome-actors.ts, the CSS motion off), every part a Track on the stage timeline.
 *
 *  - frame: where the feet are, the lean and the squash — sampled from the rig (tower-plan.ts poseAt → bake), so a bunny in
 *    the tower follows the one below exactly. The frame is an HTML layer: transform only, composited.
 *  - on the edge it moves with the approved hop cycle (Runner.hopOnce's arc on `.hop` + gallop for feet, ears, paws,
 *    tail, shadow); in the air and in the tower the limbs are authored here (air, jolt, binky).
 *  - the quarter turn is animatable (3/4 right, front, 3/4 left — the BUNNY_CSS values as keys), like parade v1's Pompon.
 *
 * Ear physics as everywhere on the stage: only rotation, never more than 14° from rest, the follow-through peaks
 * 50–90 ms after the jolt. Only transform / opacity.
 */

import { gallop } from './gallop';
import { Track, type ChannelInput } from './timeline';
import { applyCoat, E, frameBox, mountBunny, type FrameBox, type Hop, type Mounted } from './welcome-actors';
import type { BunnyCoat } from './types';
import type { BakedKey, Pose } from './tower-plan';

export type Facing = 'r' | 'l' | 'front';

/** The approved quarter turn (BUNNY_CSS .tf …: transition .28s cubic-bezier(.3,.7,.3,1)) as keys. */
export const TURN_S = 0.28;
const TURN_EASE = 'cubic-bezier(.3,.7,.3,1)';
type TurnPart = 'tf' | 'tpatch' | 'tp' | 'teL' | 'teR' | 'tcL' | 'tcR' | 'tfootL' | 'tfootR';
const TURN_SEL: Record<TurnPart, string> = {
  tf: '.tf',
  tpatch: '.tpatch',
  tp: '.tp',
  teL: '.lop .te-l',
  teR: '.lop .te-r',
  tcL: '.tc-l',
  tcR: '.tc-r',
  tfootL: '.tfoot-l',
  tfootR: '.tfoot-r',
};
const ID: ChannelInput = { x: 0, sx: 1, sy: 1 };
/** BUNNY_CSS `.turn-r …` / `.turn-l …` exactly; front = no turn. */
const TURN: Record<Facing, Record<TurnPart, ChannelInput>> = {
  r: {
    tf: { x: 13, sx: 0.88, sy: 1 },
    tpatch: { x: 13, sx: 0.88, sy: 1 },
    tp: { x: 9, sx: 1, sy: 1 },
    teL: { x: 16, sx: 0.86, sy: 0.86 },
    teR: { x: 8, sx: 1, sy: 1 },
    tcL: { x: 0, sx: 0.55, sy: 0.55 },
    tcR: { x: 0, sx: 1.04, sy: 1.04 },
    tfootL: { x: 12, sx: 0.9, sy: 0.9 },
    tfootR: { x: 5, sx: 1, sy: 1 },
  },
  l: {
    tf: { x: -13, sx: 0.88, sy: 1 },
    tpatch: { x: -13, sx: 0.88, sy: 1 },
    tp: { x: -9, sx: 1, sy: 1 },
    teL: { x: -8, sx: 1, sy: 1 },
    teR: { x: -16, sx: 0.86, sy: 0.86 },
    tcL: { x: 0, sx: 1.04, sy: 1.04 },
    tcR: { x: 0, sx: 0.55, sy: 0.55 },
    tfootL: { x: -5, sx: 1, sy: 1 },
    tfootR: { x: -12, sx: 0.9, sy: 0.9 },
  },
  front: { tf: ID, tpatch: ID, tp: ID, teL: ID, teR: ID, tcL: ID, tcR: ID, tfootL: ID, tfootR: ID },
};
/** The tail shows only while turned (BUNNY_CSS .turn-r .tail-l / .turn-l .tail-r). */
const TAILS: Record<Facing, { L: number; R: number }> = { r: { L: 1, R: 0 }, l: { L: 0, R: 1 }, front: { L: 0, R: 0 } };

/** Ears never swing further than this from rest (deg). */
export const EAR_MAX = 14;
const ear = (r: number) => Math.max(-EAR_MAX, Math.min(EAR_MAX, r));

export class TowerBunny {
  readonly tracks: Track[] = [];
  private readonly made = new Map<string, Track>();
  private readonly m: Mounted;
  private readonly box: FrameBox;
  private readonly turnParts: TurnPart[];
  private facing: Facing;

  constructor(
    readonly name: string,
    readonly coat: BunnyCoat,
    readonly u: number,
    layer: HTMLElement,
    start: Facing,
    first: Pose,
  ) {
    this.box = frameBox(u);
    this.m = mountBunny(layer, this.box, 'run');
    applyCoat(this.m.host, this.m.q('.hm'), coat);
    this.facing = start;
    this.turnParts = (Object.keys(TURN_SEL) as TurnPart[]).filter((k) => k !== 'tpatch' || coat === 'broken');
    for (const k of this.turnParts) this.tr(`turn.${k}`, this.m.q(TURN_SEL[k]), TURN[start][k]);
    this.tr('tailL', this.m.q('.tail-l'), { o: TAILS[start].L });
    this.tr('tailR', this.m.q('.tail-r'), { o: TAILS[start].R });
    this.tr('frame', this.m.frame, this.frameValue(first));
  }

  get frames(): readonly HTMLElement[] {
    return [this.m.frame];
  }

  get svg(): SVGSVGElement {
    return this.m.svg;
  }

  remove(): void {
    this.m.frame.remove();
  }

  private tr(part: string, target: Element, base: ChannelInput = {}): Track {
    const hit = this.made.get(part);
    if (hit) return hit;
    const t = new Track(target, `${this.name}.${part}`, base);
    this.made.set(part, t);
    this.tracks.push(t);
    return t;
  }

  private part(part: string, sel: string, base: ChannelInput = {}): Track {
    return this.tr(part, this.m.q(sel), base);
  }

  private frameValue(p: Pose): ChannelInput {
    return { x: p.x - this.box.ox, y: p.y - this.box.oy, r: p.r, sx: p.sx, sy: p.sy };
  }

  // ---------- placement ----------

  /** The frame follows the rig: one key per baked sample (linear in between). */
  place(keys: readonly BakedKey[]): void {
    const frame = this.tr('frame', this.m.frame);
    let prev: number | null = null;
    for (const k of keys) {
      if (prev === null) frame.hold(k.t);
      else frame.move(prev, k.t, this.frameValue(k.pose), 'linear');
      prev = k.t;
    }
  }

  // ---------- on the edge ----------

  /** One hop of the approved walk cycle (Runner.hopOnce: the arc on `.hop`, gallop for the rest); x is in the frame. */
  hop(hp: Hop, dir: 1 | -1): void {
    const { t, d, h } = hp;
    this.part('hop', '.hop', { y: 0, r: 0 }).path(t, [
      [t + 0.32 * d, { y: -h, r: dir * 3 }, E.out],
      [t + 0.7 * d, { y: 0, r: 0 }, E.in],
    ]);
    gallop(
      {
        squash: this.part('squash', '.squash', { sx: 1, sy: 1 }),
        earL: this.ears().L,
        earR: this.ears().R,
        footL: this.part('footL', '.foot-l', { x: 0, y: 0, r: 0, sx: 1, sy: 1 }),
        footR: this.part('footR', '.foot-r', { x: 0, y: 0, r: 0, sx: 1, sy: 1 }),
        shadow: this.part('shadow', '.shadow', { sx: 1, sy: 1, o: 1 }),
        pawL: this.part('pawL', '.paw-l', { x: 0, y: 0, r: 0 }),
        pawR: this.part('pawR', '.paw-r', { x: 0, y: 0, r: 0 }),
        tail: this.part(dir === 1 ? 'tailBobL' : 'tailBobR', dir === 1 ? '.tail-l' : '.tail-r', { y: 0, r: 0, s: 1 }),
      },
      t,
      d,
      dir,
    );
  }

  /** Lands after its hops in: the squash springs back (Runner.sit's start). */
  settle(t: number): void {
    this.part('squash', '.squash', { sx: 1, sy: 1 }).move(t, t + 0.16, { sx: 1, sy: 1 }, E.spring);
  }

  // ---------- turning, looking ----------

  /** The approved quarter turn to `to` (3/4 right, front, 3/4 left), starting at t. */
  turn(t: number, to: Facing): number {
    if (to === this.facing) return t;
    for (const k of this.turnParts) this.tr(`turn.${k}`, this.m.q(TURN_SEL[k])).move(t, t + TURN_S, TURN[to][k], TURN_EASE);
    // the tail goes behind it as it comes round / shows as it turns away
    const tl = this.tr('tailL', this.m.q('.tail-l'));
    const tR = this.tr('tailR', this.m.q('.tail-r'));
    const a = TAILS[this.facing];
    const b = TAILS[to];
    if (a.L !== b.L) tl.move(t + (b.L ? 0.14 : 0), t + (b.L ? 0.24 : 0.1), { o: b.L }, b.L ? 'ease-in' : 'ease-out');
    if (a.R !== b.R) tR.move(t + (b.R ? 0.14 : 0), t + (b.R ? 0.24 : 0.1), { o: b.R }, b.R ? 'ease-in' : 'ease-out');
    this.facing = to;
    return t + TURN_S;
  }

  get facingNow(): Facing {
    return this.facing;
  }

  /** The face glances (units; the mascot's glance is 2.4, "far" 5) from t0, arriving at t1. */
  look(t0: number, t1: number, x: number, y: number): void {
    const face = this.part('face', '.face', { x: 0, y: 0 });
    face.move(Math.max(t0, face.end), Math.max(t1, face.end + 0.04), { x, y }, E.face);
  }

  /** A blink (the eyes close for ≈ 3 frames). */
  blink(t: number): void {
    const eyes = this.eyes();
    eyes.path(Math.max(t, eyes.end), [
      [t + 0.05, { sy: 0.1 }, E.in],
      [t + 0.12, { sy: eyes.value.sx ?? 1 }, E.out],
    ]);
  }

  /** Being landed on: the eyes squeeze shut a moment ("oof") and open again. */
  squeeze(t: number, hold = 0.06): void {
    const eyes = this.eyes();
    const s = eyes.value.sx ?? 1;
    eyes.path(Math.max(t, eyes.end), [
      [t + 0.04, { sx: s * 1.06, sy: 0.12 }, E.in],
      [t + 0.04 + hold, { sx: s * 1.06, sy: 0.12 }],
      [t + 0.12 + hold, { sx: s, sy: s }, E.out],
    ]);
  }

  /** Eyes a little wider ("uh-oh"), from t over 0.1 s. */
  widen(t: number, s = 1.12): void {
    const eyes = this.eyes();
    eyes.move(Math.max(t, eyes.end), Math.max(t, eyes.end) + 0.1, { sx: s, sy: s }, E.out);
  }

  private eyes(): Track {
    return this.part('eyes', '.eyes', { o: 1, sx: 1, sy: 1 });
  }

  /** Normal eyes → stars on a blink (the greet's star eyes), mouth open. */
  stars(t: number): void {
    const eyes = this.eyes();
    const star = this.part('star', '.eyes-star', { o: 0, sx: 1, sy: 1 });
    eyes.move(Math.max(t, eyes.end), t + 0.06, { sy: 0.1 }, E.in);
    eyes.set(t + 0.06, { o: 0, sx: 1, sy: 1 });
    star.set(t + 0.06, { o: 1, sy: 0.1 });
    star.path(t + 0.06, [
      [t + 0.15, { sy: 1.12 }, E.out],
      [t + 0.23, { sy: 1 }],
    ]);
    this.mouth(t + 0.06, 'open');
  }

  /** Stars → normal (wide) eyes on a blink. */
  unstar(t: number, wide = 1.12): void {
    const eyes = this.eyes();
    const star = this.part('star', '.eyes-star', { o: 0, sx: 1, sy: 1 });
    star.move(Math.max(t, star.end), t + 0.05, { sy: 0.1 }, E.in);
    star.set(t + 0.06, { o: 0, sy: 1 });
    eyes.set(t + 0.06, { o: 1, sx: wide, sy: 0.1 });
    eyes.move(t + 0.06, t + 0.15, { sx: wide, sy: wide }, E.out);
  }

  /** The mouth: the line (rest), open (joy) or a small "o" (uh-oh). */
  mouth(t: number, shape: 'rest' | 'open' | 'o'): void {
    const line = this.part('mouth', '.mouth', { o: 1 });
    const open = this.part('mouthOpen', '.mouth-open', { o: 0, sx: 1, sy: 1 });
    line.set(Math.max(t, line.end + 0.002), { o: shape === 'rest' ? 1 : 0 });
    const at = Math.max(t, open.end + 0.002);
    if (shape === 'o') {
      open.set(at, { o: 1 });
      open.move(at, at + 0.1, { sx: 0.85, sy: 1.25 }, E.out);
    } else open.set(at, { o: shape === 'open' ? 1 : 0, sx: 1, sy: 1 });
  }

  /** The body leans (deg, about the feet) from t0, arriving at t1; the ears keep hanging down (they lag a little). */
  lean(t0: number, t1: number, r: number, ease = 'ease-in-out', ears = true): void {
    const body = this.part('body', '.body', { r: 0 });
    body.move(Math.max(t0, body.end), Math.max(t1, body.end + 0.04), { r }, ease);
    if (ears) this.earsTo(t0 + 0.05, t1 + 0.1, 0, -0.8 * r, ease);
  }

  /** A nose twitch (sniff), twice. */
  sniff(t: number): void {
    const twitch = { y: 0.4, sx: 1.1, sy: 0.82 };
    const rest = { y: 0, sx: 1, sy: 1 };
    const nose = this.part('nose', '.nose', rest);
    nose.path(Math.max(t, nose.end), [
      [t + 0.06, twitch],
      [t + 0.12, rest],
      [t + 0.18, twitch],
      [t + 0.24, rest],
    ]);
  }

  // ---------- ears, jumps, landings ----------

  ears(): { L: Track; R: Track } {
    return { L: this.part('earL', '.lop .ear-l', { r: 0 }), R: this.part('earR', '.lop .ear-r', { r: 0 }) };
  }

  /**
   * Ears as rotations: `flare` > 0 = both tips out (weightless in the air), `drag` = both swing the same way
   * (the head moved the other way). Clamped to ±14°.
   */
  private earsTo(t0: number, t1: number, flare: number, drag: number, ease = 'ease-in-out'): void {
    const { L, R } = this.ears();
    L.move(Math.max(t0, L.end), Math.max(t1, L.end + 0.03), { r: ear(flare + drag) }, ease);
    R.move(Math.max(t0, R.end), Math.max(t1, R.end + 0.03), { r: ear(-flare + drag) }, ease);
  }

  /** Before a jump: the ears drop forward a little, the paws come down (the wind-up). */
  windUp(t0: number, t1: number): void {
    this.earsTo(t0, t1, -4, 0);
    const paws = this.paws();
    for (const [p, s] of [
      [paws.L, -1],
      [paws.R, 1],
    ] as const)
      p.move(Math.max(t0, p.end), Math.max(t1, p.end + 0.03), { x: s * 2, y: 4, r: 0 }, 'ease-in-out');
  }

  private paws(): { L: Track; R: Track } {
    return { L: this.part('pawL', '.paw-l', { x: 0, y: 0, r: 0 }), R: this.part('pawR', '.paw-r', { x: 0, y: 0, r: 0 }) };
  }

  private feet(): { L: Track; R: Track } {
    return {
      L: this.part('footL', '.foot-l', { x: 0, y: 0, r: 0, sx: 1, sy: 1 }),
      R: this.part('footR', '.foot-r', { x: 0, y: 0, r: 0, sx: 1, sy: 1 }),
    };
  }

  /**
   * In the air from takeoff t0 to the landing t1, travelling `dir` (0 = straight up): the hind feet push off, tuck,
   * reach for the landing; the paws swing; the ears float out while it is weightless and slap back on landing.
   */
  air(t0: number, t1: number, dir: -1 | 0 | 1): void {
    const T = t1 - t0;
    const d = dir || 1;
    const sideways = dir !== 0;
    const { L: fl, R: fr } = this.feet();
    for (const [f, ph, side] of [
      [fl, 0, -1],
      [fr, 0.03, 1],
    ] as const) {
      const push = sideways ? { x: d * -6, y: 2, r: d * -16, sx: 1.08, sy: 0.92 } : { x: side * 3, y: 2, r: side * 6, sx: 1.06, sy: 0.94 };
      const tuck = sideways ? { x: d * 8, y: -7, r: d * 18, sx: 0.9, sy: 0.9 } : { x: side * -2, y: -6, r: side * -10, sx: 0.92, sy: 0.92 };
      f.path(Math.max(t0, f.end), [
        [t0 + 0.08 + ph, push, 'ease-out'],
        [t0 + 0.5 * T + ph, tuck, 'ease-in-out'],
        [t1 - 0.04, { x: 0, y: 1, r: 0, sx: 1, sy: 1 }, 'ease-in-out'],
        [t1 + 0.06, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, 'ease-out'],
      ]);
    }
    const { L: pl, R: pr } = this.paws();
    for (const [p, side] of [
      [pl, -1],
      [pr, 1],
    ] as const) {
      const back = sideways ? { x: d * -4, y: 3, r: d * 14 } : { x: side * 2, y: 3, r: side * 8 };
      const reach = sideways ? { x: d * 8, y: -5, r: d * -20 } : { x: side * 3, y: -6, r: side * -14 };
      p.path(Math.max(t0, p.end), [
        [t0 + 0.1, back, 'ease-out'],
        [t0 + 0.6 * T, reach, 'ease-in-out'],
        [t1, { x: 0, y: 3, r: 0 }, 'ease-in'],
        [t1 + 0.14, { x: 0, y: 0, r: 0 }, E.out],
      ]);
    }
    // ears: pressed for the push, float out and trail while weightless, slap back on landing (one ear physics)
    const drag = sideways ? -d * 5 : 0;
    this.earsTo(t0, t0 + 0.08, -3, 0, 'ease-out');
    this.earsTo(t0 + 0.12, t0 + 0.55 * T, 11, drag, 'ease-out');
    this.earsTo(t0 + 0.55 * T, t1, 8, drag * 0.5, 'ease-in-out');
    this.slap(t1, 1);
  }

  /** The ears after a landing jolt of strength k (1 = its own landing): back past rest, a small bounce, rest. */
  slap(t: number, k: number): void {
    this.earsTo(t + 0.01, t + 0.07, -7 * k, 0, 'ease-in');
    this.earsTo(t + 0.07, t + 0.2, 3 * k, 0, 'ease-in-out');
    this.earsTo(t + 0.2, t + 0.36, 0, 0, E.out);
  }

  /** Being landed on: the head is pushed down — the ears flick out (follow-through) and settle; the eyes squeeze. */
  jolt(t: number, k: number): void {
    this.earsTo(t, t + 0.07, 8 * k, 0, 'ease-out');
    this.earsTo(t + 0.07, t + 0.2, -3 * k, 0, 'ease-in-out');
    this.earsTo(t + 0.2, t + 0.36, 0, 0, E.out);
    this.squeeze(t, 0.04 + 0.06 * k);
  }

  /** The shadow on the edge: gone as it leaves the edge, back as it lands (it never flies with the bunny). */
  shadow(t: number, on: boolean): void {
    const sh = this.part('shadow', '.shadow', { sx: 1, sy: 1, o: 1 });
    if (on) {
      sh.set(Math.max(t - 0.06, sh.end + 0.002), { sx: 0.6, sy: 0.7, o: 0 });
      sh.move(t - 0.05, t + 0.02, { sx: 1, sy: 1, o: 1 }, 'ease-out');
    } else sh.move(Math.max(t, sh.end), Math.max(t, sh.end) + 0.05, { sx: 0.6, sy: 0.7, o: 0 }, 'ease-in');
  }

  /**
   * The binky on top (front view, t0 takeoff, t1 landing): the hind feet kick out to one side, then the other, the
   * head flicks against the body's twist (that is the rabbit's joy jump), ears fling, paws up.
   */
  binky(t0: number, t1: number): void {
    const T = t1 - t0;
    const a = t0 + 0.38 * T;
    const b = t0 + 0.78 * T;
    const { L: fl, R: fr } = this.feet();
    fl.path(Math.max(t0, fl.end), [
      [a, { x: -12, y: -4, r: -24, sx: 0.92, sy: 0.92 }, 'cubic-bezier(.2,.7,.3,1)'],
      [b, { x: 6, y: -6, r: 12, sx: 0.92, sy: 0.92 }, 'ease-in-out'],
      [t1 - 0.03, { x: 0, y: 1, r: 0, sx: 1, sy: 1 }, 'ease-in-out'],
      [t1 + 0.06, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, 'ease-out'],
    ]);
    fr.path(Math.max(t0, fr.end), [
      [a + 0.02, { x: -4, y: -6, r: -12, sx: 0.92, sy: 0.92 }, 'cubic-bezier(.2,.7,.3,1)'],
      [b + 0.02, { x: 12, y: -4, r: 24, sx: 0.92, sy: 0.92 }, 'ease-in-out'],
      [t1 - 0.02, { x: 0, y: 1, r: 0, sx: 1, sy: 1 }, 'ease-in-out'],
      [t1 + 0.06, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, 'ease-out'],
    ]);
    const face = this.part('face', '.face', { x: 0, y: 0 });
    face.path(Math.max(t0, face.end), [
      [a, { x: -3.5, y: -1 }, E.face],
      [b, { x: 3, y: -1 }, 'ease-in-out'],
      [t1 + 0.12, { x: 0, y: 0 }, E.face],
    ]);
    const { L: pl, R: pr } = this.paws();
    for (const [p, side] of [
      [pl, -1],
      [pr, 1],
    ] as const) {
      p.path(Math.max(t0, p.end), [
        [a, { x: side * 3, y: -8, r: side * -16 }, 'ease-out'],
        [t1, { x: 0, y: 3, r: 0 }, 'ease-in'],
        [t1 + 0.14, { x: 0, y: 0, r: 0 }, E.out],
      ]);
    }
    const { L, R } = this.ears();
    L.path(Math.max(t0, L.end), [
      [t0 + 0.06, { r: -3 }, 'ease-out'],
      [a + 0.03, { r: 13 }, 'ease-out'],
      [b + 0.03, { r: 4 }, 'ease-in-out'],
    ]);
    R.path(Math.max(t0, R.end), [
      [t0 + 0.06, { r: 3 }, 'ease-out'],
      [a + 0.03, { r: -5 }, 'ease-out'],
      [b + 0.03, { r: -13 }, 'ease-in-out'],
    ]);
    this.slap(t1, 1);
  }
}
