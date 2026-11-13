/**
 * His signature: the BINKY, exactly like Felix's photos (31.10) — GALLERY-ONLY prototype.
 *
 *   crouch (0–0.2 s) → leap (the feet leave the floor at 0.24) → in the air he is a LOAF: hind feet and front paws
 *   tucked under him, the body a little wider and flatter, a twist (the body rolls one way, the head flicks the other,
 *   the white tail flashes on the far side), the floor shadow shrinks to half and fades → he falls (0.52–0.86) →
 *   lands with a squash, ONE tiny bounce (7 units), the ears flop and spring back → rest at 1.4 s. Plays once (1.5 s).
 *
 * One timeline (src/timeline.ts Track → Web Animations, the same mechanics as every approved scene): only transform
 * and opacity, finite, no requestAnimationFrame, no timers; seek(t) gives the same frame every time.
 * Reduced motion: no animate() at all — the mid-air pose (BINKY_PEAK) is written as a still.
 *
 * The parts are the puppet's own (bunnyMarkup): it runs on our own BinkyShow puppet (frames, contact sheets) and, for
 * the live cards, on a real Bunny puppet (binkyOnPuppet: the animations are cancelled afterwards, nothing stays inline).
 */

import { BUNNY_CSS, bunnyMarkup } from '../../src/bunny';
import { nextInstanceId, SPRING } from '../../src/core';
import { BASE_CSS } from '../../src/mascot';
import { Playhead, Track, type ChannelInput, type StyleOut } from '../../src/timeline';
import { applyBinkyKit, paintBinky, type BkCoat, type EarVariant } from './kit';

/** Seconds the binky takes (the clock; the last part is still at 1.4). */
export const BINKY_S = 1.5;
/** The mid-air pose: the top of the leap (reduced motion shows it as a still). */
export const BINKY_PEAK = 0.52;
/** How high he leaps (bunny units; Pompon's approved binky: 40). */
export const BINKY_H = 50;
/** Beats (s): the crouch is deepest, the feet leave, the top, the feet are down, the bounce's top, settled. */
export const BINKY_BEATS = { crouch: 0.2, leave: 0.24, top: BINKY_PEAK, land: 0.86, bounce: 0.99, settled: 1.24, end: BINKY_S } as const;

/** Easings of the approved jumps (EASINGS.jumpUp / jumpDown): fast take-off, soft top, accelerating fall. */
const OUT = 'cubic-bezier(.2,.7,.3,1)';
const IN = 'cubic-bezier(.5,0,.8,.5)';
const IO = 'ease-in-out';

export type BinkyEyes = 'photo' | 'star';
export type BinkyFace = 'front' | 'r' | 'l';

export interface BinkyParts {
  hop: Element;
  body: Element;
  squash: Element;
  footL: Element;
  footR: Element;
  pawL: Element;
  pawR: Element;
  earL: Element;
  earR: Element;
  shadow: Element;
  eyes: Element;
  star: Element;
  happy: Element;
  mouth: Element;
  mouthOpen: Element;
  cheekL: Element;
  cheekR: Element;
  tailL: Element;
  tailR: Element;
  tf: Element;
  tp: Element;
  teL: Element;
  teR: Element;
  tcL: Element;
  tcR: Element;
  tfootL: Element;
  tfootR: Element;
}

const PART_SEL: Readonly<Record<keyof BinkyParts, string>> = {
  hop: '.hop', body: '.body', squash: '.squash', footL: '.foot-l', footR: '.foot-r', pawL: '.paw-l', pawR: '.paw-r',
  earL: '.up .ear-l', earR: '.up .ear-r', shadow: '.shadow', eyes: '.eyes', star: '.eyes-star', happy: '.eyes-happy',
  mouth: '.mouth', mouthOpen: '.mouth-open', cheekL: '.cheek-l .cheek-j', cheekR: '.cheek-r .cheek-j',
  tailL: '.tail-l', tailR: '.tail-r', tf: '.tf', tp: '.tp', teL: '.up .te-l', teR: '.up .te-r', tcL: '.tc-l', tcR: '.tc-r',
  tfootL: '.tfoot-l', tfootR: '.tfoot-r',
};

/** The parts of a bunny puppet's <svg> the binky moves (every one must exist). */
export function binkyParts(svg: Element): BinkyParts {
  const out = {} as Record<keyof BinkyParts, Element>;
  for (const [k, sel] of Object.entries(PART_SEL) as Array<[keyof BinkyParts, string]>) {
    const el = svg.querySelector(sel);
    if (!el) throw new Error(`[binky] missing part ${sel}`);
    out[k] = el;
  }
  return out;
}

type Keys = ReadonlyArray<readonly [number, ChannelInput, string?]>;

/** The approved quarter turn (BUNNY_CSS .turn-l / .turn-r), `k` of the way from the front; up-ears variant. */
function turnPose(side: 'l' | 'r' | null, k = 1): Record<'tf' | 'tp' | 'teL' | 'teR' | 'tcL' | 'tcR' | 'tfootL' | 'tfootR', ChannelInput> {
  const id: ChannelInput = { x: 0, sx: 1, sy: 1 };
  if (!side) return { tf: id, tp: id, teL: id, teR: id, tcL: id, tcR: id, tfootL: id, tfootR: id };
  const r = side === 'r';
  const full = {
    tf: { x: r ? 13 : -13, sx: 0.88, sy: 1 },
    tp: { x: r ? 9 : -9, sx: 1, sy: 1 },
    teL: r ? { x: 16, sx: 0.86, sy: 0.86 } : { x: -8, sx: 1, sy: 1 },
    teR: r ? { x: 8, sx: 1, sy: 1 } : { x: -16, sx: 0.86, sy: 0.86 },
    tcL: r ? { x: 0, sx: 0.55, sy: 0.55 } : { x: 0, sx: 1.04, sy: 1.04 },
    tcR: r ? { x: 0, sx: 1.04, sy: 1.04 } : { x: 0, sx: 0.55, sy: 0.55 },
    tfootL: r ? { x: 12, sx: 0.9, sy: 0.9 } : { x: -5, sx: 1, sy: 1 },
    tfootR: r ? { x: 5, sx: 1, sy: 1 } : { x: -12, sx: 0.9, sy: 0.9 },
  };
  const part = (v: ChannelInput): ChannelInput => ({ x: (v.x ?? 0) * k, sx: 1 + ((v.sx ?? 1) - 1) * k, sy: 1 + ((v.sy ?? 1) - 1) * k });
  return { tf: part(full.tf), tp: part(full.tp), teL: part(full.teL), teR: part(full.teR), tcL: part(full.tcL), tcR: part(full.tcR), tfootL: part(full.tfootL), tfootR: part(full.tfootR) };
}

export interface AuthorOptions {
  /** start (s) on the timeline; default 0 */
  at?: number;
  /** 'photo' (default): his big dark eyes stay open in the air, as in the photos; happy ^ ^ after the landing.
   *  'star': the family's joy eyes (Pompon's approved binky) from the take-off to the landing. */
  eyes?: BinkyEyes;
  /** 'front' (default): sitting facing you; 'r' / 'l': in the approved 3/4 turn, like photo 3. */
  face?: BinkyFace;
}

/** Authors the binky on these parts; returns one Track per moving part (names `binky.<part>`). */
export function authorBinky(P: BinkyParts, o: AuthorOptions = {}): Track[] {
  const t0 = o.at ?? 0;
  const tracks: Track[] = [];
  const tr = (el: Element, name: string, base: ChannelInput, keys: Keys) => {
    const t = new Track(el, `binky.${name}`, base);
    let from = t0;
    for (const [at, v, e] of keys) {
      t.move(from, t0 + at, v, e ?? IO);
      from = t0 + at;
    }
    tracks.push(t);
    return t;
  };

  // up and down (on .hop, the shadow stays on the floor): still in the crouch, the top at .52, down at .86, one tiny bounce
  tr(P.hop, 'hop', { y: 0 }, [[0.24, { y: 0 }, 'linear'], [BINKY_PEAK, { y: -BINKY_H }, OUT], [0.86, { y: 0 }, IN], [0.99, { y: -7 }, OUT], [1.1, { y: 0 }, IN]]);
  // in the 3/4 turn a little longer: you see more of his side
  const loaf: ChannelInput = (o.face ?? 'front') === 'front' ? { sx: 1.065, sy: 0.94 } : { sx: 1.085, sy: 0.925 };
  // the body's shape (about its feet): crouch, push (stretch), a LOAF in the air (wider, flatter), reach, squash, bounce
  tr(P.squash, 'squash', { sx: 1, sy: 1 }, [
    [0.2, { sx: 1.09, sy: 0.88 }],
    [0.3, { sx: 0.94, sy: 1.08 }, OUT],
    [0.42, loaf],
    [0.7, loaf, 'linear'],
    [0.84, { sx: 0.97, sy: 1.04 }],
    [0.9, { sx: 1.1, sy: 0.87 }, OUT],
    [0.99, { sx: 0.97, sy: 1.04 }],
    [1.1, { sx: 1.05, sy: 0.95 }],
    [1.24, { sx: 1, sy: 1 }, SPRING],
  ]);
  const turnKeys = ['tf', 'tp', 'teL', 'teR', 'tcL', 'tcR', 'tfootL', 'tfootR'] as const;
  const face = o.face ?? 'front';
  if (face === 'front') {
    // the twist: the body rolls one way about its feet, the head flicks the other way (a part of the quarter turn)
    tr(P.body, 'body', { r: 0 }, [[0.3, { r: 0 }, 'linear'], [0.47, { r: 6 }], [0.67, { r: -5 }], [0.86, { r: 0 }]]);
    const front = turnPose(null);
    const flickL = turnPose('l', 0.55);
    const flickR = turnPose('r', 0.42);
    for (const k of turnKeys) tr(P[k], k, front[k], [[0.3, front[k], 'linear'], [0.47, flickL[k]], [0.67, flickR[k]], [0.86, front[k]]]);
    // the white tail shows on the far side of each flick (photo 2's fluffy tail); fully there or gone, never grey
    tr(P.tailR, 'tailR', { o: 0 }, [[0.34, { o: 0 }, 'linear'], [0.42, { o: 1 }], [0.56, { o: 1 }, 'linear'], [0.62, { o: 0 }]]);
    tr(P.tailL, 'tailL', { o: 0 }, [[0.6, { o: 0 }, 'linear'], [0.66, { o: 1 }], [0.74, { o: 1 }, 'linear'], [0.82, { o: 0 }]]);
  } else {
    // in the 3/4 turn (photo 3): the nose goes up on the take-off and down before the landing — the arc of a real
    // hop — while the head flicks further to the side and back towards you: the twist; his tail puffs up at the top
    const s = face === 'r' ? 1 : -1;
    tr(P.body, 'body', { r: 0 }, [[0.3, { r: 0 }, 'linear'], [0.44, { r: -5.5 * s }], [0.68, { r: 4.5 * s }], [0.86, { r: 0 }]]);
    const base = turnPose(face);
    const far = turnPose(face, 1.22);
    const back = turnPose(face, 0.55);
    for (const k of turnKeys) tr(P[k], k, base[k], [[0.3, base[k], 'linear'], [0.47, far[k]], [0.67, back[k]], [0.86, base[k]]]);
    tr(face === 'r' ? P.tailL : P.tailR, 'tail', { o: 1, sx: 1, sy: 1 }, [[0.3, { o: 1, sx: 1, sy: 1 }, 'linear'], [0.5, { o: 1, sx: 1.18, sy: 1.18 }], [0.86, { o: 1, sx: 1, sy: 1 }]]);
  }
  // hind feet: push off wide, TUCKED under the loaf in the air (only their rounded ends peek out), spread on the landing
  for (const [el, name, s] of [[P.footL, 'footL', 1], [P.footR, 'footR', -1]] as const) {
    tr(el, name, { x: 0, y: 0, sx: 1, sy: 1 }, [
      [0.2, { x: -2 * s, y: 0, sx: 1.14, sy: 1 }],
      [0.3, { x: -1 * s, y: 0, sx: 1.06, sy: 1 }],
      [0.42, { x: 11 * s, y: -3, sx: 0.72, sy: 0.72 }, OUT],
      [0.72, { x: 11 * s, y: -3, sx: 0.72, sy: 0.72 }, 'linear'],
      [0.86, { x: -3 * s, y: 0, sx: 1.16, sy: 1 }, IN],
      [0.99, { x: 2 * s, y: -3, sx: 0.92, sy: 0.92 }],
      [1.1, { x: -2 * s, y: 0, sx: 1.08, sy: 1 }],
      [1.24, { x: 0, y: 0, sx: 1, sy: 1 }],
    ]);
  }
  // front paws: tucked down under the chest of the loaf, a little smaller (the photos' paws just peek out under him)
  for (const [el, name, s] of [[P.pawL, 'pawL', 1], [P.pawR, 'pawR', -1]] as const) {
    tr(el, name, { x: 0, y: 0, sx: 1, sy: 1 }, [
      [0.2, { x: 0, y: 2, sx: 1, sy: 1 }],
      [0.42, { x: 3 * s, y: 16, sx: 0.8, sy: 0.8 }, OUT],
      [0.72, { x: 3 * s, y: 16, sx: 0.8, sy: 0.8 }, 'linear'],
      [0.86, { x: 0, y: -2, sx: 1, sy: 1 }, IN],
      [0.93, { x: 0, y: 2, sx: 1, sy: 1 }],
      [1.06, { x: 0, y: 0, sx: 1, sy: 1 }],
    ]);
  }
  // the tiny ears (rotation about their roots only — never a shape change): back in the crouch, up and together in the
  // air, they flop on the landing and spring back; the right one a little later
  tr(P.earL, 'earL', { r: 0 }, [[0.2, { r: -12 }], [0.44, { r: 8 }], [0.66, { r: 3 }], [0.88, { r: -13 }], [1.02, { r: 7 }], [1.18, { r: -3 }], [1.4, { r: 0 }, SPRING]]);
  tr(P.earR, 'earR', { r: 0 }, [[0.21, { r: 12 }], [0.47, { r: -8 }], [0.69, { r: -3 }], [0.9, { r: 13 }], [1.05, { r: -7 }], [1.21, { r: 3 }], [1.4, { r: 0 }, SPRING]]);
  // the floor shadow: wide in the crouch, half the size and faint under the top, wide on the landing
  tr(P.shadow, 'shadow', { sx: 1, sy: 1, o: 1 }, [
    [0.2, { sx: 1.08, sy: 1.08, o: 1 }],
    [0.24, { sx: 1.06, sy: 1.06, o: 1 }, 'linear'],
    [BINKY_PEAK, { sx: 0.56, sy: 0.56, o: 0.72 }, OUT],
    [0.86, { sx: 1.1, sy: 1.1, o: 1 }, IN],
    [0.99, { sx: 0.88, sy: 0.88, o: 0.85 }, OUT],
    [1.1, { sx: 1.06, sy: 1.06, o: 1 }, IN],
    [1.24, { sx: 1, sy: 1, o: 1 }],
  ]);
  // the face: a small open mouth in the air; eyes as chosen
  tr(P.mouth, 'mouth', { o: 1 }, [[0.28, { o: 1 }, 'linear'], [0.31, { o: 0 }], [0.94, { o: 0 }, 'linear'], [0.97, { o: 1 }]]);
  tr(P.mouthOpen, 'mouthOpen', { o: 0 }, [[0.28, { o: 0 }, 'linear'], [0.31, { o: 1 }], [0.94, { o: 1 }, 'linear'], [0.97, { o: 0 }]]);
  if (o.eyes === 'star') {
    tr(P.eyes, 'eyes', { o: 1 }, [[0.27, { o: 1 }, 'linear'], [0.3, { o: 0 }], [1.28, { o: 0 }, 'linear'], [1.32, { o: 1 }]]);
    tr(P.star, 'star', { o: 0 }, [[0.27, { o: 0 }, 'linear'], [0.3, { o: 1 }], [1.28, { o: 1 }, 'linear'], [1.32, { o: 0 }]]);
  } else {
    tr(P.eyes, 'eyes', { o: 1 }, [[0.95, { o: 1 }, 'linear'], [0.98, { o: 0 }], [1.3, { o: 0 }, 'linear'], [1.33, { o: 1 }]]);
    tr(P.happy, 'happy', { o: 0 }, [[0.95, { o: 0 }, 'linear'], [0.98, { o: 1 }], [1.3, { o: 1 }, 'linear'], [1.33, { o: 0 }]]);
  }
  // the fluffy cheeks wobble on the landing
  for (const [el, name] of [[P.cheekL, 'cheekL'], [P.cheekR, 'cheekR']] as const) {
    tr(el, name, { sx: 1, sy: 1 }, [[0.86, { sx: 1, sy: 1 }, 'linear'], [0.92, { sx: 1.1, sy: 0.9 }], [1.0, { sx: 0.97, sy: 1.03 }], [1.12, { sx: 1.04, sy: 0.96 }], [1.24, { sx: 1, sy: 1 }]]);
  }
  return tracks;
}

/** Writes each track's style at `t` inline (the reduced-motion still; no animate()). */
export function writeStill(tracks: readonly Track[], t: number): void {
  for (const tr of tracks) {
    const st = tr.styleAt(t);
    for (const el of tr.els) {
      const s = (el as HTMLElement).style;
      if (st.transform !== undefined) s.transform = st.transform;
      if (st.opacity !== undefined) s.opacity = st.opacity;
    }
  }
}

// ---------- our own puppet for frames and the live stage ----------

/** The puppet's CSS without any motion of its own (like the welcome stage's actors): only the timeline moves him. */
const STILL_CSS = `*, *::before, *::after { animation: none !important; transition: none !important; }
.eyes, .eyes-star, .eyes-happy { transform-box: fill-box; transform-origin: center; }`;

export interface BinkyShowOptions {
  /** stage width in px (like Bunny `size`: the viewBox is 400 × 260, the same scale as Pompon / Tapsi at that size) */
  size: number;
  ears?: EarVariant;
  coat?: BkCoat;
  reduced?: boolean;
  eyes?: BinkyEyes;
  face?: BinkyFace;
}

/** A binky bunny that can only do one thing: his binky. seek(t) for frames; play() plays it once. */
export class BinkyShow {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly svg: SVGSVGElement;
  readonly tracks: readonly Track[];
  readonly reduced: boolean;
  readonly duration = BINKY_S;
  private readonly playhead = new Playhead();
  private readonly clock: Animation | null = null;
  private destroyed = false;

  constructor(host: HTMLElement, o: BinkyShowOptions) {
    this.host = host;
    this.reduced = !!o.reduced;
    host.style.width = `${o.size}px`;
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const id = nextInstanceId('binky');
    this.root.innerHTML = `<style>${BASE_CSS}${BUNNY_CSS}${STILL_CSS}</style><svg viewBox="0 0 400 260" aria-hidden="true" focusable="false">${bunnyMarkup((n) => `${id}-${n}`)}</svg>`;
    const svg = this.root.querySelector('svg');
    if (!svg) throw new Error('[binky] svg failed to mount');
    this.svg = svg;
    paintBinky(host, o.coat ?? 'ginger', svg.querySelector('.hm'));
    applyBinkyKit(svg, o.ears ?? 'b');
    this.tracks = authorBinky(binkyParts(svg), { eyes: o.eyes ?? 'photo', face: o.face ?? 'front' });
    if (this.reduced) {
      // no animation at all: the mid-air pose, still
      writeStill(this.tracks, BINKY_PEAK);
      return;
    }
    for (const tr of this.tracks) {
      const base = tr.baseStyle();
      for (const el of tr.els) {
        const s = (el as HTMLElement).style;
        if (base.transform !== undefined) s.transform = base.transform;
        if (base.opacity !== undefined) s.opacity = base.opacity;
      }
      for (const c of tr.compile()) this.playhead.add(c, tr.name);
    }
    const h = host as HTMLElement & { animate?: HTMLElement['animate'] };
    if (typeof h.animate === 'function') this.clock = this.playhead.adopt(h.animate([], { duration: BINKY_S * 1000 }), BINKY_S * 1000);
    this.playhead.seek(0);
  }

  get animations(): Animation[] {
    return this.playhead.animations;
  }

  /** Freezes the frame at `t` seconds (deterministic). Reduced motion: always the still. */
  seek(t: number): void {
    if (this.destroyed || this.reduced) return;
    this.playhead.seek(Math.max(0, Math.min(BINKY_S, t)) * 1000);
  }

  /** Plays the binky once from the start; resolves when it is over (reduced: at once). */
  play(): Promise<void> {
    if (this.destroyed || this.reduced) return Promise.resolve();
    this.playhead.playFrom(0);
    return this.clock ? this.clock.finished.then(() => undefined, () => undefined) : Promise.resolve();
  }

  /** Styles of every track at `t` (tests). */
  sample(t: number): Record<string, StyleOut> {
    const out: Record<string, StyleOut> = {};
    for (const tr of this.tracks) out[tr.name] = tr.styleAt(t);
    return out;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playhead.cancel();
    this.root.innerHTML = '';
  }
}

/**
 * The binky on a REAL Bunny puppet (the live cards: he sits, breathes and blinks, a tap = binky). The animations run
 * over his own CSS state; when it is over (or cancelled) they are cancelled and nothing is left inline.
 * Reduced motion: nothing happens (decoration).
 */
export function binkyOnPuppet(svg: SVGSVGElement, o: { reduced?: boolean; eyes?: BinkyEyes; face?: BinkyFace } = {}): { done: Promise<void>; cancel: () => void } {
  if (o.reduced) return { done: Promise.resolve(), cancel: () => undefined };
  const tracks = authorBinky(binkyParts(svg), { eyes: o.eyes ?? 'photo', face: o.face ?? 'front' });
  const anims: Animation[] = [];
  for (const tr of tracks) for (const c of tr.compile()) {
    const el = c.el as Element & { animate?: Element['animate'] };
    // the compiled runs as they are (fill forwards, in time order): before a part's first run his own CSS state shows,
    // which is the rest pose the track starts from
    if (typeof el.animate === 'function') anims.push(el.animate(c.frames, c.timing));
  }
  const clockEl = svg as SVGSVGElement & { animate?: Element['animate'] };
  const clock = typeof clockEl.animate === 'function' ? clockEl.animate([], { duration: BINKY_S * 1000 }) : null;
  const cancel = () => {
    for (const a of anims) a.cancel();
    clock?.cancel();
  };
  const done = (clock ? clock.finished.then(() => undefined, () => undefined) : Promise.resolve()).then(cancel);
  return { done, cancel };
}
