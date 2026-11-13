/**
 * «Обновка» v2 — every item has its OWN put-on moment (Felix 26.10: «больше креатива»), instead of v1's one
 * generic drop. Each moment is ONE seekable timeline: every part (the item, its moving bits, his face, eyes, ears,
 * cheeks, paws, body) is one Web Animation over the whole moment (fill both), seek(t) sets the same currentTime
 * on all of them. Transform and opacity only, finite, ≤ 1.6 s, no timers, no rAF, no randomness. After it the item
 * is simply there; every part ends exactly at rest (the cancelled animations hand back the puppet's own state).
 * Rules every moment keeps (tests): his eyes are shut whenever any part of the item covers them; a moment-only
 * extra (horn, confetti, petals) appears by moving out of something, never pops in still; reduced motion = no
 * animation at all, the item is simply on.
 *
 *   scarf     lands on his neck → the long end winds once round his neck → he snuggles his chin into it, ^ ^
 *   witch     drops too low, over his eyes («о!») → he pushes it up with a paw → the bent tip flops
 *   nikolaus  lands → he shakes himself like a wet puppy, eyes shut → the floppy end and the bobble swing, settle
 *   party     pops on with a «boing» → he blows a party horn (cheeks puffed) → two confetti bits fly out
 *   wreath    lands a little crooked → he sniffs the flowers → «а-а-апчхи!» → it jumps up, two petals fly, it lands straight
 *   ring      falls over his head and gets stuck on his CHEEKS → he wriggles, sucks his cheeks in → it drops to
 *             his waist, cheeks pop out, a happy hop (the approved hop())
 *   beanie    lands perched too high and askew → he hops up INTO it (the approved hop()) → it sits snug, the
 *             bobble boings on its spring, the upright ear springs up, paws to his cheeks: cosy
 */

import { EASINGS } from '../../src/core';
import { WEAR, type WearId, type WearKind } from './items';

const LINEAR_OK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)');
/** The app's springs (apps/web/src/styles/tokens.css --ease-bouncy / --ease-in), with the same fallbacks. */
export const EASE = {
  bouncy: LINEAR_OK
    ? 'linear(0, 0.069, 0.237, 0.449, 0.662, 0.849, 0.994, 1.092, 1.146, 1.163, 1.153, 1.127, 1.092, 1.057, 1.026, 1.002, 0.986, 0.977, 0.973, 0.975, 0.979, 0.985, 0.990, 0.995, 1)'
    : 'cubic-bezier(.34,1.56,.64,1)',
  snappy: LINEAR_OK
    ? 'linear(0, 0.036, 0.123, 0.234, 0.352, 0.468, 0.573, 0.665, 0.744, 0.808, 0.860, 0.901, 0.932, 0.956, 0.973, 0.985, 0.994, 0.999, 1.003, 1.004, 1.005, 1.005, 1.005, 1.005, 1)'
    : 'cubic-bezier(.25,.8,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.5)',
  out: 'cubic-bezier(.2,.7,.3,1)',
} as const;

/** Shared numbers of the moments (seconds, puppet units). */
export const UPDATE = {
  /** the longest moment allowed */
  max: 1.6,
  /** the longest moment there is (gallery slider) */
  total: 1.5,
  /** the approved hop() = jumpMotion(10, 560) */
  hopS: 0.56,
  hopH: 10,
  fadeS: 0.08,
  /** eyes close / open */
  blinkS: 0.06,
  /** his glance up at the falling thing (the puppet's own look-up: face 2.5 units up) */
  lookUp: 2.5,
} as const;

export type PuppetPart =
  | 'hop' | 'body' | 'footL' | 'footR' | 'paws' | 'pawL' | 'pawR' | 'shadow' | 'cheeks' | 'earL' | 'earR' | 'tip'
  | 'eyes' | 'happy' | 'star' | 'face' | 'nose' | 'mouth' | 'mouthOpen';
/** Parts of the worn item: the slot group's fade, its main motion, and its own moving bits (by class). */
export type ItemPart = 'wear' | 'fall' | 'wr-m-wrap' | 'wr-m-knot' | 'wr-m-tip' | 'wr-m-bob'
  | 'wr-fx-horn' | 'wr-fx-conf-a' | 'wr-fx-conf-b' | 'wr-fx-petal-a' | 'wr-fx-petal-b';
export type Part = PuppetPart | ItemPart;
export type UpdateFrames = Partial<Record<Part, Keyframe[]>>;

/** Rest of an item part: its canonical transform (translate, rotate, scale — always in this order). */
export const REST = 'translate(0px, 0px) rotate(0deg) scale(1, 1)';
const n = (v: number) => String(Math.round(v * 1000) / 1000);
/** An item part's transform in the canonical order (about its own transform-origin). */
export const tf = (x = 0, y = 0, r = 0, sx = 1, sy = sx) => `translate(${n(x)}px, ${n(y)}px) rotate(${n(r)}deg) scale(${n(sx)}, ${n(sy)})`;
/** His face's offset (a look). */
const tr = (x: number, y: number) => `translate(${n(x)}px, ${n(y)}px)`;
/** His body: tilt and squash, from his feet. */
export const BODY_REST = 'rotate(0deg) scale(1, 1)';
const bd = (r: number, sx = 1, sy = sx) => `rotate(${n(r)}deg) scale(${n(sx)}, ${n(sy)})`;
const rot = (deg: number) => (deg === 0 ? 'none' : `rotate(${n(deg)}deg)`);

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** [seconds, values, easing of the segment that starts here] */
type Key = readonly [number, Keyframe, string?];
const T = (transform: string): Keyframe => ({ transform });
const O = (opacity: number): Keyframe => ({ opacity });
const TO = (transform: string, opacity: number): Keyframe => ({ transform, opacity });

/**
 * Keys in seconds → keyframes over the whole moment (offsets 0..1), holding the first values before the first
 * key and the last values after the last one. Segments ease in-out unless a key says otherwise.
 */
export function track(total: number, keys: readonly Key[], ease = 'ease-in-out'): Keyframe[] {
  const out: Keyframe[] = [];
  let last = -1;
  for (const [t, f, e] of keys) {
    if (t < last - 1e-9) throw new Error(`[wardrobe] keys out of order at ${t}`);
    last = t;
    out.push({ ...f, offset: r3(Math.min(1, t / total)), easing: e ?? ease });
  }
  const first = out[0];
  const end = out[out.length - 1];
  if (first && Number(first.offset) > 0) out.unshift({ ...strip(first), offset: 0 });
  if (end && Number(end.offset) < 1) out.push({ ...strip(end), offset: 1 });
  // the last keyframe's easing means nothing; keep the frames clean
  const tail = out[out.length - 1];
  if (tail) delete tail.easing;
  return out;
}

/** Places keyframes of a sub-animation (offsets 0..1 over `dur`) at `start` inside a moment of `total` s, holding
 *  its first values before and its last values after. Partial keyframes are kept (WAAPI interpolates them). */
export function embed(frames: readonly Keyframe[], start: number, dur: number, total: number): Keyframe[] {
  const count = frames.length;
  const out: Keyframe[] = frames.map((f, i) => {
    const off = f.offset ?? (count > 1 ? i / (count - 1) : 0);
    return { ...f, offset: r3((start + (off as number) * dur) / total) };
  });
  const first = out[0];
  const last = out[out.length - 1];
  if (first && (first.offset as number) > 0) out.unshift({ ...strip(first), offset: 0 });
  if (last && (last.offset as number) < 1) out.push({ ...strip(last), offset: 1 });
  return out;
}

function strip(f: Keyframe): Keyframe {
  const { easing: _e, offset: _o, ...rest } = f;
  return rest;
}

/**
 * Eyes over a moment: `shut` = [from, to, look] — closed from `from` (they close in blinkS) until `to` (open in
 * blinkS), drawn as the happy arcs ^ ^ or star eyes meanwhile. Segments may touch (happy → star).
 */
function eyesOver(total: number, shut: readonly (readonly [number, number, 'happy' | 'star'])[]): UpdateFrames {
  const b = UPDATE.blinkS;
  const eyes: Key[] = [[0, O(1)]];
  const looks: Record<'happy' | 'star', Key[]> = { happy: [[0, O(0)]], star: [[0, O(0)]] };
  shut.forEach(([from, to, look], i) => {
    const prev = shut[i - 1];
    const next = shut[i + 1];
    if (!prev || prev[1] < from - 1e-9) eyes.push([from, O(1)], [from + b, O(0)]);
    if (!next || next[0] > to + 1e-9) eyes.push([to, O(0)], [to + b, O(1)]);
    looks[look].push([from, O(0)], [from + b, O(1)], [to, O(1)], [to + b, O(0)]);
  });
  const out: UpdateFrames = { eyes: track(total, eyes, 'linear'), happy: track(total, looks.happy, 'linear') };
  if (looks.star.length > 1) out.star = track(total, looks.star, 'linear');
  return out;
}

// ---- the approved hop, verbatim from mascot.ts jumpMotion(h, d) + bunny.ts / hamster.ts jumpBodyFrames, jumpEars ----

/** jumpMotion's keyframes for one hop (offsets over its own duration). */
export function hopFrames(kind: WearKind, h: number = UPDATE.hopH): UpdateFrames {
  const foot = (s: number): Keyframe[] => [
    { transform: 'none', offset: 0 },
    { transform: `translateX(${-2 * s}px) scaleX(1.12)`, offset: 0.18 },
    { transform: `translate(${2 * s}px,-8px) rotate(${18 * s}deg) scale(.8)`, offset: 0.4 },
    { transform: `translate(${2 * s}px,-8px) rotate(${18 * s}deg) scale(.8)`, offset: 0.66 },
    { transform: `translateX(${-3 * s}px) scaleX(1.18)`, offset: 0.84 },
    { transform: 'none', offset: 1 },
  ];
  const body: Keyframe[] = kind === 'bunny'
    ? [
        { transform: 'scale(1,1)', offset: 0 },
        { transform: 'scale(1.08,.88)', offset: 0.18 },
        { transform: 'scale(.95,1.07)', offset: 0.3 },
        { transform: 'scale(1,1)', offset: 0.48 },
        { transform: 'scale(.97,1.04)', offset: 0.66 },
        { transform: 'scale(1.07,.9)', offset: 0.84 },
        { transform: 'scale(.98,1.02)', offset: 0.93 },
        { transform: 'scale(1,1)', offset: 1 },
      ]
    : [
        { transform: 'scale(1,1)', offset: 0 },
        { transform: 'scale(1.08,.88)', offset: 0.18 },
        { transform: 'scale(.95,1.07)', offset: 0.3 },
        { transform: 'scale(1,1)', offset: 0.52 },
        { transform: 'scale(.97,1.04)', offset: 0.72 },
        { transform: 'scale(1.07,.9)', offset: 0.84 },
        { transform: 'scale(.98,1.02)', offset: 0.93 },
        { transform: 'scale(1,1)', offset: 1 },
      ];
  const ear = (a: number, b: number, c: number, at = [0.3, 0.55, 0.86]): Keyframe[] => [
    { transform: 'none', offset: 0 },
    { transform: `rotate(${a}deg)`, offset: at[0] },
    { transform: `rotate(${b}deg)`, offset: at[1] },
    { transform: `rotate(${c}deg)`, offset: at[2] },
    { transform: 'none', offset: 1 },
  ];
  const frames: UpdateFrames = {
    hop: [
      { transform: 'translateY(0px)', offset: 0 },
      { transform: 'translateY(0px)', offset: 0.18, easing: EASINGS.jumpUp },
      { transform: `translateY(-${h}px)`, offset: 0.52, easing: EASINGS.jumpDown },
      { transform: 'translateY(0px)', offset: 0.82 },
      { transform: 'translateY(0px)', offset: 1 },
    ],
    body,
    footL: foot(1),
    footR: foot(-1),
    paws: [
      { transform: 'none', offset: 0 },
      { transform: 'translateY(2px)', offset: 0.18 },
      { transform: 'translateY(-7px)', offset: 0.4 },
      { transform: 'translateY(-4px)', offset: 0.66 },
      { transform: 'translateY(3px)', offset: 0.84 },
      { transform: 'none', offset: 1 },
    ],
    cheeks: [
      { transform: 'none', offset: 0 },
      { transform: 'none', offset: 0.8 },
      { transform: 'scale(1.09,.92)', offset: 0.87 },
      { transform: 'scale(.97,1.03)', offset: 0.94 },
      { transform: 'none', offset: 1 },
    ],
    shadow: [
      { transform: 'none', opacity: 1, offset: 0 },
      { transform: 'scale(1.06)', offset: 0.18 },
      { transform: 'scale(.62)', opacity: 0.5, offset: 0.52 },
      { transform: 'scale(1.08)', opacity: 1, offset: 0.84 },
      { transform: 'none', opacity: 1, offset: 1 },
    ],
  };
  if (kind === 'bunny') {
    frames.earL = ear(10, -14, 12);
    frames.earR = ear(-10, 14, -12);
  } else {
    frames.earL = ear(6, -8, 12);
    frames.earR = ear(-6, 8, -10);
    frames.tip = ear(-12, 7, -14, [0.3, 0.56, 0.86]);
  }
  return frames;
}

/** The approved hop as keys starting at `start` s (so a moment can splice it into its own tracks). */
function hopKeys(kind: WearKind, start: number): Partial<Record<PuppetPart, Key[]>> {
  const out: Partial<Record<PuppetPart, Key[]>> = {};
  for (const [part, frames] of Object.entries(hopFrames(kind)) as [PuppetPart, Keyframe[]][]) {
    out[part] = frames.map((f, i): Key => {
      const off = f.offset ?? i / (frames.length - 1);
      const { offset: _o, easing, ...vals } = f;
      // jumpMotion's own segments are linear unless a keyframe says otherwise
      return [start + Number(off) * UPDATE.hopS, vals, easing ?? 'linear'];
    });
  }
  return out;
}

// ---- the moments ------------------------------------------------------------------------------------------------

export interface Moment {
  /** seconds (≤ UPDATE.max) */
  total: number;
  /** Russian name of the moment */
  title: string;
  /** what happens, step by step (gallery and doc) */
  steps: readonly string[];
  frames(): UpdateFrames;
}

const fade = (total: number): Keyframe[] => track(total, [[0, O(0), 'ease-out'], [UPDATE.fadeS, O(1)]]);
/** his glance up at the falling thing until `until`, back down by `back` */
const lookUp = (until: number, back: number): Key[] => [[0, T(tr(0, 0)), EASINGS.face], [0.1, T(tr(0, -UPDATE.lookUp))], [until, T(tr(0, -UPDATE.lookUp)), EASINGS.face], [back, T(tr(0, 0))]];

const scarf: Moment = {
  total: 1.5,
  title: 'Укутался',
  steps: [
    '0,00–0,30 шарф падает (глаза ^ ^ с 0,10 — шарф пролетает мимо мордочки 0,19–0,28)',
    '0,30–0,82 длинный конец обматывается вокруг шеи (справа налево), узелок качается',
    '0,80–1,44 прячет подбородок в шарф: мордочка вниз, щёки пухлее, уши расслаблены, потёрся туда-сюда',
    '1,30 глаза открываются · 1,50 конец',
  ],
  frames() {
    const t = this.total;
    return {
      wear: fade(t),
      fall: track(t, [[0, T(tf(0, -110, -6, 0.94, 1.06)), EASE.in], [0.3, T(tf(0, 0, 0, 1.08, 0.86)), EASE.bouncy], [0.62, T(REST)]]),
      'wr-m-wrap': track(t, [[0, T(tf(120)), EASE.in], [0.3, T(tf(120)), 'cubic-bezier(.3,.55,.25,1)'], [0.72, T(tf(-5))], [0.82, T(REST), 'ease-out'], [0.96, T(tf(0, -2.5, 0, 1, 1.16))], [1.26, T(tf(0, -2.5, 0, 1, 1.16))], [1.42, T(REST)]]),
      'wr-m-knot': track(t, [[0, T(tf(0, 0, 8)), EASE.in], [0.3, T(REST), 'ease-out'], [0.44, T(tf(0, 0, -12))], [0.6, T(tf(0, 0, 8))], [0.74, T(tf(0, 0, -4))], [0.86, T(REST)]]),
      face: track(t, [...lookUp(0.3, 0.46), [0.8, T(tr(0, 0)), 'ease-out'], [0.92, T(tr(0, 5.4))], [1.04, T(tr(-2.2, 5.8))], [1.16, T(tr(2.2, 5.8))], [1.26, T(tr(0, 5.4))], [1.42, T(tr(0, 0))]]),
      body: track(t, [[0.3, T(BODY_REST), 'ease-out'], [0.36, T(bd(0, 1.025, 0.97))], [0.5, T(BODY_REST)], [0.8, T(BODY_REST), 'ease-out'], [0.94, T(bd(0, 1.035, 0.965))], [1.26, T(bd(0, 1.035, 0.965))], [1.44, T(BODY_REST)]]),
      cheeks: track(t, [[0.8, T('none'), 'ease-out'], [0.94, T('scale(1.07, 1.05)')], [1.26, T('scale(1.07, 1.05)')], [1.44, T('none')]]),
      earL: track(t, [[0.8, T('none'), 'ease-out'], [0.96, T(rot(-5))], [1.26, T(rot(-5))], [1.46, T('none')]]),
      earR: track(t, [[0.8, T('none'), 'ease-out'], [0.96, T(rot(5))], [1.26, T(rot(5))], [1.46, T('none')]]),
      ...eyesOver(t, [[0.1, 1.3, 'happy']]),
    };
  },
};

const witch: Moment = {
  total: 1.5,
  title: 'Ой, не видно!',
  steps: [
    '0,00–0,30 шляпа падает и садится слишком низко — поля на глазах (глаза закрыты с 0,12), рот «о», уши прижаты',
    '0,38–0,58 правая лапка тянется к полям',
    '0,60–0,80 толкает шляпу вверх, шляпа на месте к 0,92; глаза открываются в 0,78',
    '0,80–1,38 загнутый кончик шлёпается и качается; он смотрит вверх на него · 1,50 конец',
  ],
  frames() {
    const t = this.total;
    return {
      wear: fade(t),
      fall: track(t, [
        [0, T(tf(0, -110, -8, 0.94, 1.06)), EASE.in],
        [0.3, T(tf(0, 64, 0, 1.07, 0.9)), 'ease-out'],
        [0.42, T(tf(0, 64, -2))],
        [0.6, T(tf(0, 64, -2)), EASE.out],
        [0.8, T(tf(0, -5, 3))],
        [0.92, T(REST)],
      ]),
      'wr-m-tip': track(t, [
        [0, T(tf(0, 0, -14)), EASE.in], [0.3, T(REST), 'ease-out'], [0.38, T(tf(0, 0, 16))], [0.5, T(tf(0, 0, -5))],
        [0.6, T(REST), 'ease-in'], [0.8, T(tf(0, 0, -10))], [0.9, T(tf(0, 0, 24))], [1.02, T(tf(0, 0, -12))],
        [1.14, T(tf(0, 0, 7))], [1.26, T(tf(0, 0, -3))], [1.38, T(REST)],
      ]),
      pawR: track(t, [[0.38, T('none'), EASE.out], [0.58, T('translate(9px, -46px) rotate(-28deg)'), 'cubic-bezier(.3,.6,.4,1)'], [0.72, T('translate(13px, -62px) rotate(-34deg)')], [0.98, T('none')]]),
      body: track(t, [[0.3, T(BODY_REST), 'ease-out'], [0.34, T(bd(0, 1.04, 0.94))], [0.48, T(BODY_REST)]]),
      earL: track(t, [[0.28, T('none'), 'ease-out'], [0.36, T(rot(9))], [0.66, T(rot(9)), 'ease-out'], [0.8, T(rot(-8))], [0.94, T(rot(4))], [1.08, T('none')]]),
      earR: track(t, [[0.28, T('none'), 'ease-out'], [0.36, T(rot(-9))], [0.66, T(rot(-9)), 'ease-out'], [0.8, T(rot(8))], [0.94, T(rot(-4))], [1.08, T('none')]]),
      mouth: track(t, [[0.32, O(1)], [0.36, O(0)], [0.8, O(0)], [0.84, O(1)]], 'linear'),
      mouthOpen: track(t, [[0.32, O(0)], [0.36, O(1)], [0.8, O(1)], [0.84, O(0)]], 'linear'),
      face: track(t, [...lookUp(0.28, 0.36).slice(0, 3), [0.36, T(tr(0, 1.5))], [0.8, T(tr(0, 1.5)), 'ease-out'], [0.92, T(tr(1.5, -2.5))], [1.24, T(tr(1.5, -2.5))], [1.4, T(tr(0, 0))]]),
      ...eyesOver(t, [[0.12, 0.78, 'happy']]),
    };
  },
};

const nikolaus: Moment = {
  total: 1.45,
  title: 'Отряхнулся',
  steps: [
    '0,00–0,28 шапка падает и садится (глаза зажмурены от радости с 0,28)',
    '0,42–0,88 отряхивается всем телом, как щенок; уши болтаются',
    '0,36–1,28 длинный конец с помпоном качается и успокаивается (помпон ещё чуть-чуть дольше)',
    '1,02 глаза открываются, смотрит на помпон · 1,45 конец',
  ],
  frames() {
    const t = this.total;
    const ears: Key[] = [[0.44, T('none')], [0.54, T(rot(14))], [0.64, T(rot(-14))], [0.74, T(rot(12))], [0.84, T(rot(-8))], [0.94, T(rot(4))], [1.04, T('none')]];
    return {
      wear: fade(t),
      fall: track(t, [[0, T(tf(0, -100, -10, 0.94, 1.06)), EASE.in], [0.28, T(tf(0, 0, 0, 1.08, 0.86)), EASE.bouncy], [0.56, T(REST)]]),
      body: track(t, [[0.28, T(BODY_REST), 'ease-out'], [0.32, T(bd(0, 1.04, 0.94))], [0.42, T(BODY_REST)], [0.5, T(bd(-8))], [0.6, T(bd(8))], [0.7, T(bd(-6))], [0.79, T(bd(3.5))], [0.88, T(BODY_REST)]]),
      earL: track(t, ears),
      earR: track(t, ears),
      'wr-m-tip': track(t, [
        [0, T(tf(0, 0, -22)), EASE.in], [0.28, T(REST), 'ease-out'], [0.36, T(tf(0, 0, 12))], [0.45, T(tf(0, 0, -3))],
        [0.54, T(tf(0, 0, 16))], [0.64, T(tf(0, 0, -18))], [0.74, T(tf(0, 0, 16))], [0.84, T(tf(0, 0, -12))],
        [0.95, T(tf(0, 0, 9))], [1.06, T(tf(0, 0, -5))], [1.17, T(tf(0, 0, 2.5))], [1.28, T(REST)],
      ]),
      'wr-m-bob': track(t, [[0.4, T(REST)], [0.58, T(tf(0, 0, 10))], [0.68, T(tf(0, 0, -12))], [0.78, T(tf(0, 0, 10))], [0.88, T(tf(0, 0, -8))], [0.99, T(tf(0, 0, 6))], [1.1, T(tf(0, 0, -3))], [1.22, T(REST)]]),
      face: track(t, [...lookUp(0.28, 0.4), [1.02, T(tr(0, 0)), 'ease-out'], [1.14, T(tr(2.2, -2.2))], [1.3, T(tr(2.2, -2.2))], [1.42, T(tr(0, 0))]]),
      ...eyesOver(t, [[0.28, 1.02, 'happy']]),
    };
  },
};

const party: Moment = {
  total: 1.45,
  title: 'Ту-ту!',
  steps: [
    '0,00–0,20 колпак падает, «бо-ойнг»: отскакивает вверх и садится второй раз (0,44), уши подпрыгивают',
    '0,20 глаза ^ ^ · 0,50–0,60 щёки надуваются',
    '0,54–0,70 из рта разворачивается дудка (бумажная трубочка), 0,75–0,94 «ту-ту» — дрожит',
    '0,76–1,43 два кусочка конфетти вылетают из дудки и падают, тают · 0,94–1,12 дудка сворачивается обратно',
    '1,18 глаза открываются · 1,45 конец',
  ],
  frames() {
    const t = this.total;
    const horn = (sx: number, sy = 1) => tf(0, 0, 0, sx, sy);
    return {
      wear: fade(t),
      fall: track(t, [
        [0, T(tf(0, -90, -12, 0.92, 1.08)), EASE.in],
        [0.2, T(tf(0, 0, 0, 1.14, 0.8)), EASE.out],
        [0.32, T(tf(0, -20, 4, 0.94, 1.08)), EASE.in],
        [0.44, T(tf(0, 0, 0, 1.06, 0.92)), EASE.bouncy],
        [0.62, T(REST)],
      ]),
      earL: track(t, [[0.18, T('none'), 'ease-out'], [0.24, T(rot(9))], [0.36, T(rot(-5))], [0.46, T(rot(6))], [0.58, T('none')]]),
      earR: track(t, [[0.18, T('none'), 'ease-out'], [0.24, T(rot(-9))], [0.36, T(rot(5))], [0.46, T(rot(-6))], [0.58, T('none')]]),
      body: track(t, [
        [0.2, T(BODY_REST), 'ease-out'], [0.24, T(bd(0, 1.04, 0.95))], [0.34, T(BODY_REST)], [0.44, T(BODY_REST), 'ease-out'],
        [0.48, T(bd(0, 1.02, 0.97))], [0.58, T(BODY_REST)], [0.76, T(BODY_REST)], [0.8, T(bd(0, 1.02, 0.98))], [0.86, T(BODY_REST)],
        [0.9, T(bd(0, 1.02, 0.98))], [0.96, T(BODY_REST)],
      ]),
      cheeks: track(t, [[0.5, T('none'), 'ease-out'], [0.6, T('scale(1.16, 1.08)')], [0.96, T('scale(1.16, 1.08)')], [1.1, T('none')]]),
      mouth: track(t, [[0.52, O(1)], [0.56, O(0)], [1.08, O(0)], [1.12, O(1)]], 'linear'),
      'wr-fx-horn': track(t, [
        [0.54, TO(horn(0.1), 0), 'ease-out'], [0.58, TO(horn(0.35), 1), EASE.out], [0.7, TO(horn(1.06), 1)], [0.75, T(horn(1))],
        [0.79, T(horn(1, 1.18))], [0.84, T(horn(1, 0.9))], [0.89, T(horn(1, 1.12))], [0.94, TO(horn(1), 1), EASE.in],
        [1.08, TO(horn(0.2), 1), 'ease-out'], [1.12, TO(horn(0.1), 0)], [1.16, TO(REST, 0)],
      ]),
      'wr-fx-conf-a': track(t, [
        [0.74, TO(tf(0, 0, 0, 0.6), 0), EASE.out], [0.78, TO(tf(4, -8, 40), 1), EASE.out], [0.98, T(tf(18, -40, 190)), 'cubic-bezier(.4,0,.7,.6)'],
        [1.3, TO(tf(28, -16, 330), 1), 'ease-in'], [1.42, TO(tf(30, -8, 360), 0)], [1.45, TO(REST, 0)],
      ]),
      'wr-fx-conf-b': track(t, [
        [0.76, TO(tf(0, 0, 0, 0.6), 0), EASE.out], [0.8, TO(tf(2, -6, -30), 1), EASE.out], [1.0, T(tf(4, -46, -160)), 'cubic-bezier(.4,0,.7,.6)'],
        [1.32, TO(tf(-2, -22, -300), 1), 'ease-in'], [1.43, TO(tf(-3, -14, -340), 0)], [1.45, TO(REST, 0)],
      ]),
      face: track(t, lookUp(0.2, 0.3)),
      ...eyesOver(t, [[0.2, 1.18, 'happy']]),
    };
  },
};

const wreath: Moment = {
  total: 1.5,
  title: 'Апчхи!',
  steps: [
    '0,00–0,28 венок падает и садится чуть набекрень (7°); он смотрит вверх',
    '0,44–0,72 нюхает цветы: носик трижды дёргается, уши навострены',
    '0,80–0,95 «а-а-а…»: тянется вверх, глаза зажмурены, рот открыт',
    '0,95–1,00 «…пчхи!»: сжимается, уши взлетают, венок подпрыгивает, два лепестка улетают и тают к 1,49',
    '1,04–1,34 венок падает обратно — уже ровно; 1,24 глаза открываются · 1,50 конец',
  ],
  frames() {
    const t = this.total;
    const sniff = 'scale(1.12, .84)';
    return {
      wear: fade(t),
      fall: track(t, [
        [0, T(tf(0, -90, -14, 0.94, 1.06)), EASE.in], [0.28, T(tf(0, 0, 7, 1.07, 0.88)), EASE.bouncy], [0.46, T(tf(0, 0, 7))],
        [0.92, T(tf(0, 0, 7)), EASE.out], [1.04, T(tf(0, -16, -5)), EASE.in], [1.16, T(tf(0, 0, 0, 1.05, 0.92)), EASE.bouncy], [1.34, T(REST)],
      ]),
      face: track(t, [...lookUp(0.8, 0.9).slice(0, 3), [0.9, T(tr(0, -4.5))], [0.95, T(tr(0, -4.5)), EASE.out], [1.0, T(tr(0, 3))], [1.16, T(tr(0, 0))]]),
      nose: track(t, [[0.44, T('none')], [0.48, T(sniff)], [0.52, T('none')], [0.58, T(sniff)], [0.62, T('none')], [0.68, T(sniff)], [0.72, T('none')], [0.84, T('none')], [0.9, T('scale(1.18, .8)')], [0.97, T('none')]]),
      earL: track(t, [[0.4, T('none'), 'ease-out'], [0.5, T(rot(-6))], [0.86, T(rot(-6)), 'ease-in'], [0.92, T(rot(-12)), EASE.out], [0.98, T(rot(18))], [1.1, T(rot(-8))], [1.22, T(rot(4))], [1.34, T('none')]]),
      earR: track(t, [[0.4, T('none'), 'ease-out'], [0.5, T(rot(6))], [0.86, T(rot(6)), 'ease-in'], [0.92, T(rot(12)), EASE.out], [0.98, T(rot(-18))], [1.1, T(rot(8))], [1.22, T(rot(-4))], [1.34, T('none')]]),
      body: track(t, [
        [0.28, T(BODY_REST), 'ease-out'], [0.32, T(bd(0, 1.03, 0.96))], [0.42, T(BODY_REST)], [0.8, T(BODY_REST)],
        [0.92, T(bd(0, 0.96, 1.06))], [0.95, T(bd(0, 0.96, 1.06)), EASE.out], [1.0, T(bd(0, 1.1, 0.86))], [1.12, T(bd(0, 0.98, 1.03))], [1.24, T(BODY_REST)],
      ]),
      mouth: track(t, [[0.86, O(1)], [0.9, O(0)], [1.02, O(0)], [1.06, O(1)]], 'linear'),
      mouthOpen: track(t, [[0.86, O(0)], [0.9, O(1)], [1.02, O(1)], [1.06, O(0)]], 'linear'),
      'wr-fx-petal-a': track(t, [
        [0.96, TO(REST, 0), EASE.out], [0.99, TO(tf(-3, -2, -20), 1), EASE.out], [1.14, T(tf(-16, -12, -100)), 'cubic-bezier(.4,0,.7,1)'],
        [1.36, TO(tf(-24, 10, -190), 1), 'ease-in'], [1.48, TO(tf(-27, 22, -230), 0)], [1.5, TO(REST, 0)],
      ]),
      'wr-fx-petal-b': track(t, [
        [0.97, TO(REST, 0), EASE.out], [1.0, TO(tf(3, -2, 20), 1), EASE.out], [1.15, T(tf(15, -15, 110)), 'cubic-bezier(.4,0,.7,1)'],
        [1.38, TO(tf(22, 8, 210), 1), 'ease-in'], [1.49, TO(tf(25, 18, 250), 0)], [1.5, TO(REST, 0)],
      ]),
      ...eyesOver(t, [[0.84, 1.24, 'happy']]),
    };
  },
};

const ring: Moment = {
  total: 1.42,
  title: 'Застрял!',
  steps: [
    '0,00–0,26 круг падает через голову (глаза закрыты 0,10–0,34) и застревает на ЩЕКАХ — щёки сплющены',
    '0,34–0,56 открыл глаза, смотрит вниз на круг; ёрзает туда-сюда',
    '0,56–0,64 втягивает щёки (глаза зажмурены) — круг соскальзывает на пояс (0,62–0,82)',
    '0,82–0,96 щёки выпрыгивают обратно; 0,84–1,40 радостный подскок (одобренный hop()), глаза-звёзды',
    '1,24 глаза обычные · 1,42 конец',
  ],
  frames() {
    const t = this.total;
    const hop = hopKeys('hamster', 0.84);
    const late = (k: Key[] | undefined, after: number) => (k ?? []).filter(([s]) => s >= after);
    return {
      wear: fade(t),
      fall: track(t, [
        [0, T(tf(0, -120, 0, 0.96, 1.04)), EASE.in], [0.26, T(tf(0, -46, 0, 1.07, 0.86)), 'ease-out'], [0.36, T(tf(0, -46, 0, 0.98, 1.04))],
        [0.44, T(tf(0, -46, -2))], [0.52, T(tf(0, -46, 2))], [0.62, T(tf(0, -46, 0, 1.02, 0.98)), EASE.in], [0.82, T(tf(0, 0, 0, 1.08, 0.9)), EASE.bouncy], [1.1, T(REST)],
      ]),
      cheeks: track(t, [
        [0.24, T('none'), 'ease-out'], [0.3, T('scale(.86, 1.1)')], [0.54, T('scale(.86, 1.1)')], [0.64, T('scale(.66, .96)')],
        [0.8, T('scale(.66, .96)'), 'cubic-bezier(.34,1.56,.64,1)'], [0.96, T('scale(1.16, 1.06)')], [1.08, T('scale(.97, 1)')], [1.16, T('none')],
        ...late(hop.cheeks, 1.2),
      ]),
      body: track(t, [
        [0.26, T(BODY_REST), 'ease-out'], [0.3, T(bd(0, 1.02, 0.97))], [0.36, T(BODY_REST)], [0.44, T(bd(-3))], [0.52, T(bd(3))],
        [0.58, T(BODY_REST)], [0.64, T(bd(0, 0.96, 1.04))], [0.8, T(bd(0, 0.96, 1.04))], ...(hop.body ?? []),
      ]),
      hop: track(t, hop.hop ?? []),
      footL: track(t, hop.footL ?? []),
      footR: track(t, hop.footR ?? []),
      paws: track(t, hop.paws ?? []),
      shadow: track(t, hop.shadow ?? []),
      earL: track(t, hop.earL ?? []),
      earR: track(t, hop.earR ?? []),
      tip: track(t, hop.tip ?? []),
      face: track(t, [...lookUp(0.26, 0.36).slice(0, 3), [0.36, T(tr(0, 2))], [0.56, T(tr(0, 2))], [0.66, T(tr(0, 0))]]),
      ...eyesOver(t, [[0.1, 0.34, 'happy'], [0.56, 0.86, 'happy'], [0.86, 1.24, 'star']]),
    };
  },
};

const beanie: Moment = {
  total: 1.5,
  title: 'Впрыгнул в шапку',
  steps: [
    '0,00–0,26 шапка падает и садится слишком высоко и набекрень; помпон на пружинке качается',
    '0,44–1,00 он подпрыгивает ВВЕРХ в шапку (одобренный hop()): шапка натягивается и садится плотно в 0,90',
    '0,90–1,36 помпон «боингает» на пружинке; стоячее ухо выпрыгивает вверх (1,00–1,30)',
    '0,86–1,30 глаза ^ ^; 1,00–1,44 лапки к щекам, щёки пухлые — уютно · 1,50 конец',
  ],
  frames() {
    const t = this.total;
    const hop = hopKeys('hamster', 0.44);
    return {
      wear: fade(t),
      fall: track(t, [
        [0, T(tf(0, -100, 8, 0.94, 1.06)), EASE.in], [0.26, T(tf(0, -18, 6, 1.06, 0.9)), 'ease-out'], [0.36, T(tf(0, -18, 6))],
        [0.54, T(tf(0, -18, 6)), EASE.out], [0.73, T(tf(0, -6, 2))], [0.9, T(tf(0, 0, 0, 1.05, 0.92)), EASE.bouncy], [1.1, T(REST)],
      ]),
      'wr-m-bob': track(t, [
        [0, T(tf(0, 0, -12)), EASE.in], [0.26, T(REST), 'ease-out'], [0.32, T(tf(0, 0, 14))], [0.4, T(tf(0, 0, -9))], [0.48, T(tf(0, 0, 5))],
        [0.56, T(REST)], [0.9, T(REST), 'ease-out'], [0.96, T(tf(0, 0, 18))], [1.06, T(tf(0, 0, -12))], [1.16, T(tf(0, 0, 8))], [1.26, T(tf(0, 0, -4))], [1.36, T(REST)],
      ]),
      hop: track(t, hop.hop ?? []),
      body: track(t, hop.body ?? []),
      footL: track(t, hop.footL ?? []),
      footR: track(t, hop.footR ?? []),
      paws: track(t, hop.paws ?? []),
      shadow: track(t, hop.shadow ?? []),
      tip: track(t, hop.tip ?? []),
      earR: track(t, hop.earR ?? []),
      earL: track(t, [...(hop.earL ?? []), [1.06, T('rotate(-6deg) scale(1, 1.1)')], [1.18, T('rotate(3deg) scale(1, .98)')], [1.3, T('none')]]),
      cheeks: track(t, [...(hop.cheeks ?? []), [1.1, T('scale(1.1, 1.05)')], [1.3, T('scale(1.1, 1.05)')], [1.42, T('none')]]),
      pawL: track(t, [[1.0, T('none'), 'ease-out'], [1.12, T('translate(-8px, -30px) rotate(20deg)')], [1.3, T('translate(-8px, -30px) rotate(20deg)')], [1.44, T('none')]]),
      pawR: track(t, [[1.0, T('none'), 'ease-out'], [1.12, T('translate(8px, -30px) rotate(-20deg)')], [1.3, T('translate(8px, -30px) rotate(-20deg)')], [1.44, T('none')]]),
      face: track(t, lookUp(0.44, 0.56)),
      ...eyesOver(t, [[0.86, 1.3, 'happy']]),
    };
  },
};

export const MOMENTS: Readonly<Record<WearId, Moment>> = { scarf, beanie, nikolaus, wreath, ring, witch, party };

/** All keyframes of an item's moment, each over the whole moment. */
export function updateFrames(id: WearId): UpdateFrames {
  return MOMENTS[id].frames();
}

/** Seconds of an item's moment. */
export function momentTotal(id: WearId): number {
  return MOMENTS[id].total;
}

// ---- sampling (tests, checks): the value of a canonical transform / opacity track at a time ---------------------

export interface Tf {
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
}

/** Parses translate / translateX / translateY / rotate / scale / none (in any order, each at most once). */
export function parseTf(s: string | undefined): Tf {
  const out: Tf = { x: 0, y: 0, r: 0, sx: 1, sy: 1 };
  if (!s || s === 'none') return out;
  for (const m of s.matchAll(/(translateX|translateY|translate|rotate|scaleX|scaleY|scale)\(([^)]*)\)/g)) {
    const args = (m[2] ?? '').split(',').map((a) => Number.parseFloat(a));
    const a0 = args[0] ?? 0;
    const a1 = args[1];
    switch (m[1]) {
      case 'translate': out.x = a0; out.y = a1 ?? 0; break;
      case 'translateX': out.x = a0; break;
      case 'translateY': out.y = a0; break;
      case 'rotate': out.r = a0; break;
      case 'scale': out.sx = a0; out.sy = a1 ?? a0; break;
      case 'scaleX': out.sx = a0; break;
      case 'scaleY': out.sy = a0; break;
    }
  }
  return out;
}

/** The segment of `frames` around progress p (0..1) and the eased fraction inside it. */
function segment(frames: readonly Keyframe[], p: number, ease: (css: string) => (q: number) => number): { a: Keyframe; b: Keyframe; k: number } {
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] as Keyframe;
    const b = frames[i] as Keyframe;
    const o0 = Number(a.offset);
    const o1 = Number(b.offset);
    if (p <= o1 + 1e-12) {
      const q = o1 - o0 < 1e-9 ? 1 : Math.min(1, Math.max(0, (p - o0) / (o1 - o0)));
      return { a, b, k: ease(String(a.easing ?? 'linear'))(q) };
    }
  }
  const last = frames[frames.length - 1] as Keyframe;
  return { a: last, b: last, k: 1 };
}

/** A transform track's value at progress p (the eased segment; `ease` maps a CSS easing to a function). */
export function sampleTf(frames: readonly Keyframe[] | undefined, p: number, ease: (css: string) => (q: number) => number): Tf {
  if (!frames?.length) return parseTf('none');
  const { a, b, k } = segment(frames, p, ease);
  const A = parseTf(a.transform as string | undefined);
  const B = parseTf(b.transform as string | undefined);
  const L = (u: number, v: number) => u + (v - u) * k;
  return { x: L(A.x, B.x), y: L(A.y, B.y), r: L(A.r, B.r), sx: L(A.sx, B.sx), sy: L(A.sy, B.sy) };
}

/** An opacity track's value at progress p (1 when the track has no opacity). */
export function sampleOpacity(frames: readonly Keyframe[] | undefined, p: number, ease: (css: string) => (q: number) => number): number {
  if (!frames?.length) return 1;
  const { a, b, k } = segment(frames, p, ease);
  const A = a.opacity === undefined ? 1 : Number(a.opacity);
  const B = b.opacity === undefined ? A : Number(b.opacity);
  return A + (B - A) * k;
}

// ---- running a moment on a puppet -----------------------------------------------------------------------------

/** Which elements of the puppet / the worn item each part animates. */
function targets(root: ShadowRoot, kind: WearKind, worn: SVGGElement): (part: Part) => Element[] {
  const one = (sel: string): Element[] => {
    const el = root.querySelector(sel);
    return el ? [el] : [];
  };
  const up = root.querySelector('.hm')?.classList.contains('ears-up');
  const ears = kind === 'bunny' ? (up ? '.up' : '.lop') : '';
  const puppet: Record<PuppetPart, () => Element[]> = {
    hop: () => one('.hop'),
    body: () => one('.body'),
    footL: () => one('.foot-l'),
    footR: () => one('.foot-r'),
    paws: () => one('.paws'),
    pawL: () => one('.paw-l'),
    pawR: () => one('.paw-r'),
    shadow: () => one('.shadow'),
    cheeks: () => Array.from(root.querySelectorAll('.cheek-j')),
    earL: () => one(`${ears} .ear-l`.trim()),
    earR: () => one(`${ears} .ear-r`.trim()),
    tip: () => (kind === 'hamster' ? one('.ear-tip') : []),
    eyes: () => one('.eyes'),
    happy: () => one('.eyes-happy'),
    star: () => one('.eyes-star'),
    face: () => one('.face'),
    nose: () => (kind === 'bunny' ? one('.nose') : []),
    mouth: () => one('.mouth'),
    mouthOpen: () => one('.mouth-open'),
  };
  return (part) => {
    if (part === 'wear') return [worn];
    if (part === 'fall') return Array.from(worn.querySelectorAll('.wr-fall'));
    if (part.startsWith('wr-')) return Array.from(worn.querySelectorAll(`.${part}`));
    return puppet[part as PuppetPart]();
  };
}

/**
 * An item's moment on one puppet. `seek(t)` freezes the frame at t (screenshots, the contact sheet); `play()` runs
 * it once and hands the puppet back (every animation cancelled = the puppet's own CSS state, which equals the end
 * frame). Reduced: nothing is animated — the item is simply there.
 */
export class Update {
  readonly animations: Animation[] = [];
  readonly total: number;
  private finishedResolve: (() => void) | null = null;

  constructor(
    readonly root: ShadowRoot,
    readonly id: WearId,
    readonly worn: SVGGElement,
    readonly reduced = false,
  ) {
    this.total = momentTotal(id);
    if (reduced || typeof worn.animate !== 'function') return;
    const frames = updateFrames(id);
    const find = targets(root, WEAR[id].kind, worn);
    for (const [part, list] of Object.entries(frames) as [Part, Keyframe[]][]) {
      for (const el of find(part)) {
        // the prototype's animate: the puppet's `.hop` has the follow-through listener (items.ts), not for this
        const a = Element.prototype.animate.call(el, list, { duration: this.total * 1000, fill: 'both' });
        a.pause();
        a.currentTime = 0;
        this.animations.push(a);
      }
    }
  }

  get duration(): number {
    return this.reduced ? 0 : this.total;
  }

  /** Freeze at t seconds (clamped to the moment). */
  seek(t: number): void {
    const ms = Math.max(0, Math.min(this.total, t)) * 1000;
    for (const a of this.animations) {
      a.pause();
      a.currentTime = ms;
    }
  }

  /** Play from the start; resolves when it is over (the puppet is back to its own state). */
  play(): Promise<void> {
    if (!this.animations.length) return Promise.resolve();
    this.seek(0);
    for (const a of this.animations) a.play();
    const clock = this.animations[0];
    return new Promise<void>((resolve) => {
      this.finishedResolve = resolve;
      const done = () => {
        this.cancel();
      };
      clock?.finished.then(done, done);
    });
  }

  /** Hands the puppet back: no inline animation stays. */
  cancel(): void {
    for (const a of this.animations) a.cancel();
    this.animations.length = 0;
    const r = this.finishedResolve;
    this.finishedResolve = null;
    r?.();
  }
}
