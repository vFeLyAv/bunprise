/**
 * «Погоня за сельдереем» (Felix's idea, 20.10; reworked 23.10 after «кривая анимация ушей … выглядит нелепо»).
 *
 * The bunny hops in and sits; a celery stalk rolls in and stops near him. He notices it (eyes wide, a tiny
 * startled hop, the ears perk in like the approved greet `perk`), stretches up and sniffs toward it, crouches —
 * and the stalk rolls away. He bounds after it out of the frame, comes back from the other side with the last bit
 * of celery in his mouth, sits, holds it in his paws and chews it up (the approved `eat`: only paws and cheeks
 * move), then hops home. (Before 23.10 the ears switched to separate tall pink "surprise" ears with a folded tip
 * for the startle and swung ±14° about a pivot off their base — that was the «кривая анимация ушей».)
 *
 * Ears: the SAME lop ears as the app bunny (bunny.ts paths, gradient, colours) in the approved 3/4 turn. They
 * never switch to other shapes. They only turn about their real attachment on the head (the midpoint of the
 * ear's closing edge, the pivot of the approved surprise rig), so the base stays put in every frame, and they
 * follow the head as secondary motion: they stream back a little in each hop and swing slightly forward when the
 * landing stops the head (a small lag, a little overshoot), |angle| ≤ EAR_MAX_DEG. The near ear of the 3/4 turn
 * never swings outward past NEAR_EAR_OUT_MAX (that opens a hairline gap to the head); the far ear follows
 * EAR_LAG s later and a bit softer.
 *
 * Every hop is the approved walk cycle (bunnyhop / hopsquash / tuck / tailbob) scaled to the hop: the body leans
 * only 3°, squash/stretch stays within ±6 %, the shadow stays on the ground. One timeline (Track → WAAPI), only
 * transform / opacity, seek(t) exact. Reduced motion: a calm still (the bunny sits next to the celery), no loop.
 */
import { EASINGS, SPRING } from './core';
import { MoveStage, mountProp, propMarkup, type MountedProp, type MoveOptions, type MoveShow } from './props';
import { Track, type ChannelInput, type Sampled } from './timeline';
import { applyCoat, frameBox, mountBunny, type FrameBox, type Mounted } from './welcome-actors';
import type { BunnyCoat } from './types';

export interface ChaseOptions extends MoveOptions { coat?: BunnyCoat; from?: 'left' | 'right'; loop?: boolean; size?: number }

/** The lop ear's attachment on the head (±26.5, -155.5 in bunny units) in its fill-box = bunny.ts `.surprise-ears`. */
export const EAR_ROOT = { l: '95.352% 9.4816%', r: '4.648% 9.4816%' } as const;
/** The largest ear turn in the whole scene, degrees (the approved jump swings 10–14°, the walk 9°). */
export const EAR_MAX_DEG = 10;
/**
 * In the 3/4 turn the near ear hangs right at the outline of the head: turned outward by more than ≈ 2° a hairline of
 * background opens between ear and head (it reads as a detached ear). So the near ear only ever swings in (over the
 * cheek) or back; outward at most this much.
 */
export const NEAR_EAR_OUT_MAX = 1.5;
/** The far ear (3/4 turn) follows the near one this much later, seconds, and swings 85 % as far. */
export const EAR_LAG = 0.035;
const FAR_AMP = 0.85;

/**
 * One ear pose, degrees. `trail` = both tips swing back (away from where he looks), like ears streaming behind a
 * running head; `flare` = mirrored, + = the tips swing out from the face, − = in (the approved `perk` turns them in).
 */
export interface EarPose { trail?: number; flare?: number }
type EarKey = [number, number, number, string];
/** Pause between two runs in loop mode, seconds. */
export const CHASE_GAP = 1.5;

const OUT = EASINGS.jumpUp;
const IN = EASINGS.jumpDown;
const FACE = EASINGS.face;
const SVG_NS = 'http://www.w3.org/2000/svg';

type Dir = 1 | -1;

/** One bunny puppet on the stage (the same SVG puppet as the mascot) and its tracks. */
class Chaser {
  readonly tracks: Sampled[] = [];
  readonly box: FrameBox;
  readonly m: Mounted;
  private readonly made = new Map<string, Track>();
  /** Ear keys: [time, trail, flare, easing]; near and far ear separately. */
  private readonly earNear: EarKey[] = [];
  private readonly earFar: EarKey[] = [];

  constructor(
    stage: HTMLElement,
    readonly name: string,
    coat: BunnyCoat,
    /** px per bunny unit */
    readonly u: number,
    /** where the face looks: +1 = right (the approved 3/4 turn `.turn-r`) */
    readonly face: Dir,
    readonly ground: number,
  ) {
    this.box = frameBox(u);
    this.m = mountBunny(stage, this.box, 'run');
    const hm = this.m.q('.hm');
    applyCoat(this.m.host, hm, coat);
    hm.classList.add(face === 1 ? 'turn-r' : 'turn-l');
    // turn the ears about the line where they meet the head (not the CSS default near their top edge)
    this.m.q('.lop .ear-l').style.transformOrigin = EAR_ROOT.l;
    this.m.q('.lop .ear-r').style.transformOrigin = EAR_ROOT.r;
  }

  /** The track of one part (or several elements that move together), created on first use. */
  tr(part: string, target: string | Element, base: ChannelInput = {}, all = false): Track {
    const hit = this.made.get(part);
    if (hit) return hit;
    const els = typeof target === 'string' ? (all ? this.m.qa(target) : [this.m.q(target)]) : [target];
    const t = new Track(els, `${this.name}.${part}`, base);
    this.made.set(part, t);
    this.tracks.push(t);
    return t;
  }

  get travel(): Track {
    return this.tr('travel', this.m.frame, { o: 0 });
  }

  /** Frame position that puts the feet at stage x on the ground. */
  feet(x: number): ChannelInput {
    return { x: x - this.box.ox, y: this.ground - this.box.oy };
  }

  /** Stands still at x from t (shown). */
  place(t: number, x: number): void {
    this.travel.set(t, { ...this.feet(x), o: 1 });
  }

  /** Leaves the stage for good at t (it is out of the frame by then). */
  hide(t: number): void {
    this.travel.set(t, { o: 0 });
  }

  /** One ear beat for both ears (the far one a little later and softer). */
  ear(t: number, pose: EarPose, ease = 'ease-in-out'): void {
    const add = (keys: EarKey[], at: number, k: number) => {
      // a new beat replaces the settle that was still pending after it
      while (keys.length && (keys[keys.length - 1]?.[0] ?? 0) >= at) keys.pop();
      keys.push([at, (pose.trail ?? 0) * k, (pose.flare ?? 0) * k, ease]);
    };
    add(this.earNear, t, 1);
    add(this.earFar, t + EAR_LAG, FAR_AMP);
  }

  /** Ear angle (CSS rotate, degrees) of one side for a key. */
  private earAngle(side: 'l' | 'r', trail: number, flare: number): number {
    // CSS rotate is clockwise on screen: + moves a hanging tip to the left. Facing right, "back" = left (+);
    // "out" = left on the left ear (+), right on the right ear (−).
    return this.face * trail + (side === 'l' ? flare : -flare);
  }

  /**
   * One hop of the approved walk cycle, from x0 to x1 (stage px), h bunny units high: push-off, an even flight,
   * the landing sticks (the squash takes the momentum). The ears float out a little in the air and drop back
   * after the landing, each a beat after the head.
   */
  hop(at: number, d: number, x0: number, x1: number, h: number): void {
    const f = this.face;
    const T = (k: number) => at + k * d;
    const dx = x1 - x0;
    this.travel.set(at, { ...this.feet(x0), o: 1 });
    this.travel.path(at, [
      [T(0.1), this.feet(x0 + 0.06 * dx), 'cubic-bezier(.5,0,1,1)'],
      [T(0.7), this.feet(x0 + 0.98 * dx), 'linear'],
      [T(1), this.feet(x1), 'cubic-bezier(0,0,.2,1)'],
    ]);
    // up and down in SVG units (the shadow stays on the ground); the body leans 3° like the approved bunnyhop
    this.tr('hop', '.hop', { y: 0, r: 0 }).path(at, [
      [T(0.32), { y: -h, r: f * 3 }, OUT],
      [T(0.7), { y: 0, r: 0 }, IN],
    ]);
    this.tr('squash', '.squash', { sx: 1, sy: 1 }).path(at, [
      [T(0.12), { sx: 1.05, sy: 0.95 }],
      [T(0.32), { sx: 0.96, sy: 1.05 }, 'ease-out'],
      [T(0.7), { sx: 0.99, sy: 1.01 }],
      [T(0.8), { sx: 1.06, sy: 0.94 }, 'ease-out'],
      [T(1), { sx: 1, sy: 1 }],
    ]);
    for (const [side, lag] of [['l', 0], ['r', 0.035]] as const) {
      this.tr(`foot-${side}`, `.foot-${side}`, { x: 0, y: 0, r: 0, s: 1 }).path(at, [
        [T(0.32 + lag), { x: f * -4, y: -5, r: f * 14, s: 0.86 }, 'ease-out'],
        [T(0.7 + lag), { x: 0, y: 0, r: 0, s: 1 }, 'ease-in'],
      ]);
    }
    this.tr('paws', '.paws', { x: 0, y: 0 }).path(at, [
      [T(0.32), { x: f * 2, y: -2.5 }, 'ease-out'],
      [T(0.72), { x: f * 2.5, y: 1 }],
      [T(0.9), { x: 0, y: 0 }],
    ]);
    // the tail on the back (`.turn-r` shows `.tail-l`) bobs a little, as in the approved tailbob
    this.tr('tail', f === 1 ? '.tail-l' : '.tail-r', { y: 0, s: 1 }).path(at, [
      [T(0.3), { y: -2, s: 1.06 }],
      [T(0.62), { y: 0.5, s: 0.98 }],
      [T(0.88), { y: 0, s: 1 }],
    ]);
    this.tr('shadow', '.shadow', { sx: 1, sy: 1, o: 1 }).path(at, [
      [T(0.32), { sx: 0.8, sy: 0.8, o: 0.6 }, 'ease-out'],
      [T(0.7), { sx: 1, sy: 1, o: 1 }, 'ease-in'],
      [T(0.8), { sx: 1.05, sy: 1.05, o: 1 }],
      [T(1), { sx: 1, sy: 1, o: 1 }],
    ]);
    // ears: they lag behind the push-off and stream back in the air (peak just after the top of the hop), then
    // the landing stops the head and they swing a little forward past rest and settle
    const a = Math.min(8, 3 + h / 7);
    this.ear(T(0.12), { trail: 0.15 * a });
    this.ear(T(0.42), { trail: a }, 'ease-out');
    this.ear(T(0.7), { trail: 0.35 * a });
    this.ear(T(0.84), { trail: -NEAR_EAR_OUT_MAX }, 'ease-out');
    this.ear(T(1), { trail: 0 });
  }

  /** Several hops from x0 to x1: [duration s, share of the distance, height in bunny units]. */
  hops(at: number, x0: number, x1: number, specs: ReadonlyArray<readonly [number, number, number]>): number {
    const total = specs.reduce((sum, s) => sum + s[1], 0);
    let t = at;
    let x = x0;
    for (const [d, share, h] of specs) {
      const nx = x + ((x1 - x0) * share) / total;
      this.hop(t, d, x, nx, h);
      t += d;
      x = nx;
    }
    // the ears settle after the last landing: a soft swing back, then rest
    this.ear(t + 0.1, { trail: 1 });
    this.ear(t + 0.24, { trail: 0 });
    return t;
  }

  /** The near ear of the 3/4 turn (the one on the side he looks to). */
  get nearEar(): 'l' | 'r' {
    return this.face === 1 ? 'r' : 'l';
  }

  /** Builds the ear tracks from the collected beats (call once, after all beats). */
  finishEars(): void {
    for (const side of ['l', 'r'] as const) {
      const keys = side === this.nearEar ? this.earNear : this.earFar;
      const track = this.tr(`ear-${side}`, `.lop .ear-${side}`, { r: 0 });
      const first = keys[0]?.[0] ?? 0;
      track.path(Math.max(0, first - 0.12), keys.map(([t, trail, flare, ease]) => [t, { r: this.earAngle(side, trail, flare) }, ease] as const));
    }
  }
}

/** The last bit of celery, drawn into the face group of a puppet: it moves with the head, the turn and the hops. */
function mountBite(m: Mounted, face: Dir): SVGGElement {
  const doc = new DOMParser().parseFromString(propMarkup('celery-bit').replace('<svg ', `<svg xmlns="${SVG_NS}" `), 'image/svg+xml');
  const bite = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  bite.setAttribute('class', 'bite');
  const art = document.createElementNS(SVG_NS, 'g');
  // 30 x 14 units, the stub's middle on the mouth, the leaf toward the back of the head
  art.setAttribute('transform', `translate(0 -74) scale(${face === -1 ? 1.05 : -1.05} 1.05) translate(-11 -7)`);
  for (const child of doc.documentElement.childNodes) art.append(document.importNode(child, true));
  bite.append(art);
  bite.style.transformBox = 'fill-box';
  bite.style.transformOrigin = face === -1 ? '75% 50%' : '25% 50%';
  m.q('.tf').append(bite);
  return bite;
}

/** Celery stalk on the ground: frame = travel, spin = bounce + tilt, body = squash, plus its own soft shadow. */
function celeryProp(stage: HTMLElement, ground: number): { prop: MountedProp; tracks: Track[]; at: (x: number) => ChannelInput } {
  const prop = mountProp(stage, 'celery', 64, { pivot: { x: 0.5, y: 0.8 } });
  const shade = document.createElement('div');
  shade.className = 'ground';
  shade.style.cssText = `left:${prop.w * 0.08}px;top:${prop.h - 3}px;width:${prop.w * 0.84}px;height:6px`;
  prop.frame.prepend(shade);
  // the lowest leaf touches the ground (the stalk itself rests ≈ 2 px above it)
  const at = (x: number): ChannelInput => ({ x: x - prop.w / 2, y: ground - prop.h + 1 });
  return { prop, at, tracks: [new Track(prop.frame, 'celery.travel', { o: 1 }), new Track(prop.spin, 'celery.roll', { y: 0, r: 0 }), new Track(prop.body, 'celery.squash', { sx: 1, sy: 1 }), new Track(shade, 'celery.shadow', { sx: 1, o: 1 })] };
}

/**
 * «Погоня за сельдереем»: the celery rolls in from the far side, stops, rocks, then rolls on; the bunny gives chase
 * and comes back from the other side chewing the last bit (see the top of this file). `from: 'right'` mirrors it.
 */
export class ChaseStage extends MoveStage {
  constructor(host: HTMLElement, private readonly options: ChaseOptions = {}) {
    super(host, options, ':host{display:block;position:relative;overflow:hidden;pointer-events:none;min-height:120px}');
    this.setup();
  }

  protected author(reduced: boolean): MoveShow {
    const w = this.host.clientWidth || 390;
    const h = this.host.clientHeight || 180;
    const dir: Dir = this.options.from === 'right' ? -1 : 1;
    const X = (v: number) => (dir === 1 ? v : w - v);
    // the whole bunny (ears and hops included) fits a low host: ≈ 172 units tall + 36 units of hop
    const size = Math.max(72, Math.min(this.options.size ?? 132, (h - 14) * 0.95));
    const u = size / 200;
    const ground = h - 10;
    const coat = this.options.coat ?? 'fawn';
    const off = 100 * u + 6;
    const rest = Math.min(w / 3, size * 0.6 + 8);
    const stop = Math.min(w * 0.7, rest + size * 0.55 + 48);
    const runner = new Chaser(this.stage, 'bunny', coat, u, dir, ground);
    const celery = celeryProp(this.stage, ground);
    const [cTravel, cRoll, cSquash, cShadow] = celery.tracks as [Track, Track, Track, Track];

    if (reduced) {
      // a calm still: he sits and looks at the celery lying next to him
      const x = Math.max(rest, w * 0.36);
      runner.place(0, X(x));
      cTravel.set(0, { ...celery.at(X(x + size * 0.5 + 44)), o: 1 });
      return { tracks: [...runner.tracks, ...celery.tracks], duration: 0, isStatic: true, staticAt: 0 };
    }

    // 1) he hops in and sits down
    runner.travel.set(0, { ...runner.feet(X(-off)), o: 1 });
    const sat = runner.hops(0, X(-off), X(rest), [[0.38, 1.25, 28], [0.32, 1, 18]]);

    // 2) the celery rolls in, bounces twice, stops and rocks
    const c0 = 0.36;
    cTravel.set(0, { ...celery.at(X(w + 60)), o: 1 });
    cTravel.move(c0, c0 + 0.72, celery.at(X(stop)), 'cubic-bezier(.25,.75,.35,1)');
    cRoll.path(c0, [
      [c0 + 0.1, { y: -9, r: -dir * 7 }, OUT],
      [c0 + 0.22, { y: 0, r: -dir * 2 }, IN],
      [c0 + 0.32, { y: -4, r: -dir * 5 }, OUT],
      [c0 + 0.42, { y: 0, r: 0 }, IN],
      [c0 + 0.58, { y: 0, r: dir * 4 }],
      [c0 + 0.72, { y: 0, r: -dir * 2 }],
      [c0 + 0.86, { y: 0, r: 0 }],
    ]);
    cSquash.path(c0 + 0.2, [
      [c0 + 0.22, { sx: 1, sy: 1 }],
      [c0 + 0.26, { sx: 1.06, sy: 0.9 }, 'ease-out'],
      [c0 + 0.32, { sx: 1, sy: 1 }],
      [c0 + 0.42, { sx: 1, sy: 1 }],
      [c0 + 0.45, { sx: 1.03, sy: 0.95 }, 'ease-out'],
      [c0 + 0.5, { sx: 1, sy: 1 }],
    ]);
    cShadow.path(c0, [
      [c0 + 0.1, { sx: 0.8, o: 0.6 }, OUT],
      [c0 + 0.22, { sx: 1, o: 1 }, IN],
      [c0 + 0.32, { sx: 0.9, o: 0.8 }, OUT],
      [c0 + 0.42, { sx: 1, o: 1 }, IN],
    ]);

    // 3) he notices it: eyes wide, a tiny startled hop, the ears perk in a little (the approved greet `perk`);
    //    then he stretches up and sniffs toward it (the approved alert, without lifting an ear in the 3/4 turn)
    const n = sat + 0.04;
    const eyes = runner.tr('eye', '.eyes .eye', { s: 1 }, true);
    eyes.path(n, [[n + 0.1, { s: 1.14 }, OUT]]);
    const hopG = runner.tr('hop', '.hop', { y: 0, r: 0 });
    hopG.path(n, [
      [n + 0.05, { y: 1.5 }, 'ease-out'],
      [n + 0.16, { y: -7 }, OUT],
      [n + 0.28, { y: 0 }, IN],
    ]);
    const squash = runner.tr('squash', '.squash', { sx: 1, sy: 1 });
    squash.path(n, [
      [n + 0.05, { sx: 1.04, sy: 0.96 }],
      [n + 0.16, { sx: 0.97, sy: 1.04 }, 'ease-out'],
      [n + 0.28, { sx: 1.04, sy: 0.96 }],
      [n + 0.42, { sx: 1, sy: 1 }, SPRING],
    ]);
    runner.tr('shadow', '.shadow', { sx: 1, sy: 1, o: 1 }).path(n, [[n + 0.16, { sx: 0.92, sy: 0.92, o: 0.85 }, OUT], [n + 0.28, { sx: 1, sy: 1, o: 1 }, IN]]);
    const look = runner.tr('look', '.face', { x: 0, y: 0 });
    look.path(n, [[n + 0.14, { x: dir * 2.4, y: 0 }, FACE]]);
    runner.ear(n + 0.1, { flare: 1 });
    runner.ear(n + 0.26, { flare: -6 }, SPRING);
    // sniff, sniff, sniff: up a little and toward it
    const s0 = n + 0.34;
    squash.path(n + 0.42, [[n + 0.54, { sx: 0.98, sy: 1.03 }, 'ease-out']]);
    look.path(s0, [[s0 + 0.12, { x: dir * 2.4, y: -1.5 }, FACE]]);
    runner.ear(s0 + 0.16, { flare: -5, trail: -1 });
    const nose = runner.tr('nose', '.nose', { y: 0, sx: 1, sy: 1 });
    for (let i = 0; i < 3; i++) nose.path(s0 + 0.02 + i * 0.1, [[s0 + 0.07 + i * 0.1, { y: 0.4, sx: 1.1, sy: 0.82 }], [s0 + 0.12 + i * 0.1, { y: 0, sx: 1, sy: 1 }]]);
    // crouch (the wind-up): eyes back, face forward, ears relax
    const k = s0 + 0.34;
    eyes.path(k, [[k + 0.1, { s: 1 }]]);
    look.path(k, [[k + 0.1, { x: 0, y: 0 }, FACE]]);
    squash.path(k, [[k + 0.1, { sx: 1.07, sy: 0.93 }, 'ease-in-out']]);
    runner.ear(k + 0.1, { flare: -2, trail: -1 });

    // 4) the stalk rolls on, he bounds after it and out of the frame
    const go = k + 0.1;
    const esc = k - 0.14;
    cRoll.path(esc, [[esc + 0.1, { y: 0, r: -dir * 5 }], [esc + 0.2, { y: -6, r: dir * 8 }, OUT], [esc + 0.32, { y: 0, r: dir * 3 }, IN], [esc + 0.44, { y: -5, r: dir * 8 }, OUT], [esc + 0.56, { y: 0, r: dir * 3 }, IN], [esc + 0.68, { y: -4, r: dir * 7 }, OUT], [esc + 0.8, { y: 0, r: dir * 2 }, IN]]);
    cShadow.path(esc + 0.1, [[esc + 0.2, { sx: 0.85, o: 0.7 }, OUT], [esc + 0.32, { sx: 1, o: 1 }, IN], [esc + 0.44, { sx: 0.88, o: 0.75 }, OUT], [esc + 0.56, { sx: 1, o: 1 }, IN]]);
    cTravel.move(esc + 0.08, esc + 0.78, celery.at(X(w + 60)), 'cubic-bezier(.35,0,.8,.6)');
    cTravel.set(esc + 0.82, { o: 0 });
    const dist = w + off - rest;
    const bounds = dist > size * 3.9 ? 4 : 3;
    const specs: Array<readonly [number, number, number]> = [[0.34, 0.9, 32], [0.32, 1.05, 34], [0.3, 1.1, 34], [0.3, 1.1, 34]];
    const away = runner.hops(go, X(rest), X(w + off), specs.slice(0, bounds));
    runner.hide(away + 0.3);

    // 5) back from the other side with the last bit of celery, facing home; sits, holds it, chews it up
    const back = new Chaser(this.stage, 'back', coat, u, dir === 1 ? -1 : 1, ground);
    mountBite(back.m, back.face);
    back.tr('eyes', '.eyes', { o: 0 });
    back.tr('happy', '.eyes-happy', { o: 1 });
    const ret = away - 0.04;
    const spot = Math.max(rest, w * 0.46);
    back.travel.set(ret, { ...back.feet(X(w + off)), o: 1 });
    const sit = back.hops(ret, X(w + off), X(spot), [[0.34, 1.15, 26], [0.3, 1, 16]]);
    const paws = back.tr('paws', '.paws', { x: 0, y: 0 });
    paws.path(sit, [[sit + 0.12, { x: 0, y: -22 }, EASINGS.lift]]);
    const cheeks = back.tr('chew', '.cheek-j', { sx: 1, sy: 1 }, true);
    const bite = back.tr('bite', '.bite', { y: 0, sx: 1, sy: 1, o: 1 });
    const bnose = back.tr('nose', '.nose', { y: 0, sx: 1, sy: 1 });
    const body = back.tr('squash', '.squash', { sx: 1, sy: 1 });
    let t = sit + 0.12;
    for (let i = 0; i < 3; i++, t += 0.14) {
      cheeks.path(t, [[t + 0.07, { sx: 1.07, sy: 0.95 }], [t + 0.14, { sx: 1, sy: 1 }]]);
      bnose.path(t, [[t + 0.05, { y: 0.4, sx: 1.1, sy: 0.82 }], [t + 0.1, { y: 0, sx: 1, sy: 1 }]]);
      bite.path(t, [[t + 0.07, { y: 0.8, sx: 0.84 - i * 0.2, sy: 1 }], [t + 0.14, { y: 0, sx: 0.84 - i * 0.2, sy: 1 }]]);
    }
    bite.path(t, [[t + 0.08, { y: 0.5, sx: 0.2, sy: 0.8, o: 0 }, 'ease-in']]);
    paws.path(t + 0.02, [[t + 0.24, { x: 0, y: 0 }, SPRING]]);
    body.path(t, [[t + 0.08, { sx: 1.04, sy: 0.96 }], [t + 0.24, { sx: 1, sy: 1 }, SPRING]]);
    back.ear(t + 0.08, { flare: -4 }, OUT);
    back.ear(t + 0.24, { flare: 0 }, SPRING);

    // 6) home: two hops out of the frame
    const home = back.hops(t + 0.26, X(spot), X(-off), [[0.32, 1, 24], [0.3, 1.1, 26]]);
    back.hide(home + 0.24);

    runner.finishEars();
    back.finishEars();
    const duration = Math.round((home + 0.24) * 100) / 100;
    return {
      tracks: [...runner.tracks, ...celery.tracks, ...back.tracks],
      duration,
      ...(this.options.loop ? { period: Math.max(6.3, duration + CHASE_GAP) } : {}),
    };
  }
}
