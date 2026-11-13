/**
 * The puppet of «Переел» (redrawn 23.10.2026): the SAME sitting bunny as the app mascot — bunnyMarkup() and
 * BUNNY_CSS from bunny.ts, unchanged, in the mascot's own 400 × 260 viewBox — plus a few small props (the
 * shared carrot of props.ts, a bitten carrot, carrot crumbs, the approved sleepy "z"). Nothing about the
 * bunny is redrawn: every move is a Track on one of its own parts (the same parts the approved scenes move:
 * cheeks, paws, eyes, ears, face, the body's squash), so it is clearly the same character.
 *
 * Felix's review of the lying versions (22.10 / 23.10): "the lying pose looks like a human, ridiculous,
 * crooked" — so he sits, like everywhere else in the app, and "stuffed" is told by what he liked: round
 * cheeks (eating), closed happy / sleepy eyes, a slow sigh, a nod and a little "z" (sleep).
 */

import { BUNNY_COATS, BUNNY_CSS, bunnyMarkup } from './bunny';
import { BASE_CSS as MASCOT_CSS } from './mascot';
import { propMarkup } from './props';
import { LoopTrack, Track, type ChannelInput, type Sampled } from './timeline';
import { applyCoat } from './welcome-actors';
import type { BunnyCoat } from './types';

/** The mascot's own box: the bunny's feet stand at (200, 246); bunny units are scaled 1.2. */
export const OVERFED_VIEWBOX = { x: 0, y: 0, w: 400, h: 260 } as const;
const FEET = 'translate(200 246) scale(1.2)';

/** Easings (the approved ones: core.ts EASINGS / welcome-actors E). */
export const EASE = {
  out: 'cubic-bezier(.2,.7,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.5)',
  face: 'cubic-bezier(.25,.8,.3,1)',
  lift: 'cubic-bezier(.3,.7,.3,1)',
  fall: 'cubic-bezier(.55,.085,.68,.53)',
  /** a long, soft settle (a sigh going out) */
  settle: 'cubic-bezier(.3,0,.25,1)',
  inOut: 'ease-in-out',
} as const;

// ---------- props (bunny units: x = 0 is the centre line, y = 0 the floor, y < 0 is up) ----------

/** The inner drawing of a shared prop (props.ts) without its own <svg> wrapper, as a plain group. */
function propInner(kind: 'carrot' | 'carrot-crumb'): string {
  const s = propMarkup(kind);
  return s.slice(s.indexOf('>') + 1, s.lastIndexOf('</svg>'));
}

/** A carrot crumb (props.ts 'carrot-crumb'), centred on (x, y). */
const crumb = (x: number, y: number, r: number, s: number) =>
  `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-3.2 -3)" d="M1 2.4 L3.4 .6 L5.4 2.2 L4.8 5 L1.8 5.4 Z"/>`;
const CRUMB_STYLE = 'fill="#F28A34" stroke="rgba(160,80,20,.4)" stroke-width=".6" stroke-linejoin="round"';

/** Crumbs on the floor in front of the feet: [x, y, rotation, scale]. */
const FLOOR_CRUMBS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-11, 1.2, 20, 1.05],
  [8, 2.2, -35, 0.9],
  [66, 0.4, 60, 1.1],
  [-63, 1.6, 10, 0.85],
];
/** Two tiny crumbs at the corner of the mouth (Felix's first idea: "carrot bits at his mouth"). */
const MOUTH_CRUMBS: ReadonlyArray<readonly [number, number, number, number]> = [
  [8.2, -72.2, 20, 0.62],
  [-7.6, -69.6, -30, 0.5],
];

/** The whole carrot (props.ts) lying on the floor: length in bunny units, mirrored = leaves to the right. */
export const DROP_LEN = 58;
const DROP_K = DROP_LEN / 84;
/** How high its centre is when it lies on the floor (the underside of the carrot body touches y = 0). */
export const DROP_REST_Y = -(22.4 - 15) * DROP_K;

/** The bitten carrot in his paws (prop units like props.ts 'carrot', the tip bitten off at x ≈ 57): scale along / across. */
export const HELD_K = { along: 0.75, across: 1.1 } as const;
function bittenCarrot(id: string): string {
  return `
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB45C"/><stop offset=".6" stop-color="#F28A34"/><stop offset="1" stop-color="#DE7027"/></linearGradient></defs>
    <path d="M18 13.6 C11 5.6 5 3.4 1.6 5.4 C5.6 8.6 10 11.8 16 15 Z" fill="#6DBE4B"/>
    <path d="M18 15.4 C10 13.8 3.6 14.8 .6 16.8 C5.6 18 10.6 17.6 16.6 16.6 Z" fill="#5FAE45"/>
    <path d="M18 17.2 C12 23.2 6.6 26.2 3.4 25.2 C7.4 22.2 11.4 19.6 16.4 17 Z" fill="#7AC75A"/>
    <path d="M18 8.6 C34 7.9 46 8.9 56.6 10.4 Q52.8 12.6 56 14.9 Q52.6 17.3 56.6 19.8 C46 21.6 34 22.8 18 22.4 C12.6 21.4 12 9.8 18 8.6 Z" fill="url(#${id})" stroke="rgba(160,80,20,.38)" stroke-width="1"/>
    <path d="M55.6 11.2 Q52.6 12.8 54.9 14.9 Q52.4 17 55.5 19" fill="none" stroke="#FFD49E" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M30 11.4 l3 2.2 M43 19.6 l3 -2" fill="none" stroke="rgba(150,70,15,.42)" stroke-width="1.15" stroke-linecap="round"/>
    <path d="M22 11.4 C32 10.6 42 10.8 50 11.8" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.1" stroke-linecap="round"/>`;
}

/** The approved sleepy "z" (welcome-actors sleepIdle), centred on its origin. */
const Z = '<path d="M-4 -4.5h8l-8 9h8" fill="none" stroke="var(--mascot-accent-dark)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';

export interface PropSet {
  floorCrumbs?: boolean;
  mouthCrumbs?: boolean;
  drop?: boolean;
  held?: boolean;
  z?: boolean;
}

// ---------- CSS ----------

/**
 * The mascot's own styles (BASE_CSS: contour + shadow tokens; BUNNY_CSS: pivots, coats), with every CSS
 * animation and transition switched off: all motion is the stage timeline (seekable, transform/opacity).
 * The host rule comes again after them (BASE_CSS sizes a mascot host; this host is the stage).
 */
export const OVERFED_CSS = `${MASCOT_CSS}${BUNNY_CSS}
:host { display: block; position: relative; overflow: hidden; pointer-events: none; width: auto; min-height: 120px; line-height: normal; }
svg.ovf { position: absolute; inset: 0; display: block; width: 100%; height: 100%; overflow: visible; }
svg.ovf, svg.ovf * { animation: none !important; transition: none !important; }
.ovf .eyes { transform-box: fill-box; transform-origin: center; }
.ovf .body, .ovf .squash, .ovf .breathe { transform-box: view-box; transform-origin: 0px -1px; }
.ovf .ov-drop, .ovf .ov-held, .ovf .ov-z { transform-box: view-box; transform-origin: 0px 0px; }
`;

// ---------- the rig ----------

/** Every part a show may move, its selector and its neutral value. */
const PARTS = {
  fig: ['.ov-fig', { o: 1 }],
  hop: ['.hop', { y: 0 }],
  body: ['.body', { r: 0 }],
  squash: ['.squash', { sx: 1, sy: 1 }],
  shadow: ['.shadow', { sx: 1, sy: 1 }],
  footL: ['.foot-l', { y: 0 }],
  footR: ['.foot-r', { y: 0 }],
  earL: ['.lop .ear-l', { r: 0 }],
  earR: ['.lop .ear-r', { r: 0 }],
  /** face glances (the approved look-l / look-r: only the face moves) */
  face: ['.face', { x: 0, y: 0 }],
  /** the approved quarter turn (BUNNY_CSS .turn-r / .turn-l) as tracks, partly: face + blush, ears, cheeks */
  head: ['.tf', { x: 0, sx: 1, sy: 1 }],
  tpatch: ['.tpatch', { x: 0, sx: 1, sy: 1 }],
  teL: ['.lop .te-l', { x: 0, s: 1 }],
  teR: ['.lop .te-r', { x: 0, s: 1 }],
  tcL: ['.tc-l', { s: 1 }],
  tcR: ['.tc-r', { s: 1 }],
  eyes: ['.eyes', { o: 1, sx: 1, sy: 1 }],
  eye: ['.eyes .eye', { s: 1 }],
  happy: ['.eyes-happy', { o: 0 }],
  sleep: ['.eyes-sleep', { o: 0 }],
  mouth: ['.mouth', { o: 1 }],
  yawn: ['.mouth-open', { o: 0, sx: 1, sy: 1 }],
  nose: ['.nose', { y: 0, sx: 1, sy: 1 }],
  cheeks: ['.cheek', { s: 1 }],
  chew: ['.cheek-j', { sx: 1, sy: 1 }],
  paws: ['.paws', { x: 0, y: 0 }],
  pawL: ['.paw-l', { x: 0, y: 0, r: 0 }],
  pawR: ['.paw-r', { x: 0, y: 0, r: 0 }],
  drop: ['.ov-drop', { x: 0, y: 0, r: 0, o: 0 }],
  held: ['.ov-held', { x: 0, y: 0, r: 0 }],
  z: ['.ov-z', { x: 0, y: 0, s: 1, o: 0 }],
} as const satisfies Record<string, readonly [string, ChannelInput]>;
export type PartName = keyof typeof PARTS;

export class OverfedRig {
  readonly svg: SVGSVGElement;
  readonly loops: LoopTrack[] = [];
  private readonly made = new Map<PartName, Track>();
  /** the broken coat's face patch turns with the face (as in the approved turn); other coats do not show it */
  private readonly broken: boolean;

  constructor(stage: HTMLElement, prefix: string, coat: BunnyCoat, props: PropSet) {
    this.broken = BUNNY_COATS.find((c) => c.id === coat)?.pattern === 'broken';
    const id = (name: string) => `${prefix}-${name}`;
    const { x, y, w, h } = OVERFED_VIEWBOX;
    const front = [
      props.floorCrumbs ? `<g class="ov-crumbs" ${CRUMB_STYLE}>${FLOOR_CRUMBS.map(([cx, cy, r, s]) => crumb(cx, cy, r, s)).join('')}</g>` : '',
      props.drop ? `<g class="ov-drop"><g transform="scale(${-DROP_K} ${DROP_K}) translate(-42 -15)">${propInner('carrot')}</g></g>` : '',
      props.z ? `<g class="ov-z">${Z}</g>` : '',
    ].join('');
    stage.insertAdjacentHTML(
      'beforeend',
      `<svg class="overfed ovf" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"><g class="ov-fig">${bunnyMarkup(id)}<g class="ov-front" transform="${FEET}">${front}</g></g></svg>`,
    );
    this.svg = stage.lastElementChild as SVGSVGElement;
    // additions inside the puppet: crumbs at the mouth move with the face, the carrot in the paws with the paws
    if (props.mouthCrumbs) this.q('.mouth').insertAdjacentHTML('afterend', `<g class="ov-mouth-crumbs" ${CRUMB_STYLE}>${MOUTH_CRUMBS.map(([cx, cy, r, s]) => crumb(cx, cy, r, s)).join('')}</g>`);
    if (props.held) this.q('.paws').insertAdjacentHTML('afterbegin', `<g class="ov-held"><g transform="rotate(-90) scale(${HELD_K.along} ${HELD_K.across}) translate(-37 -15.5)">${bittenCarrot(id('carrot'))}</g></g>`);
    applyCoat(this.svg as unknown as HTMLElement, this.q('.hm'), coat);
  }

  q(sel: string): Element {
    const el = this.svg.querySelector(sel);
    if (!el) throw new Error(`[overfed] missing part: ${sel}`);
    return el;
  }

  /** The track of a part (made on first use; `start` = its value when the show begins). */
  part(name: PartName, start: ChannelInput = {}): Track {
    const hit = this.made.get(name);
    if (hit) return hit;
    const [sel, neutral] = PARTS[name];
    const els = [...this.svg.querySelectorAll(sel)];
    if (!els.length) throw new Error(`[overfed] missing part: ${sel}`);
    const t = new Track(els, `overfed.${name}`, { ...neutral, ...start });
    this.made.set(name, t);
    return t;
  }

  /** A loop on a part's elements (after the show; LoopTrack: fill 'none', it overrides the track while it runs). */
  loop(name: PartName, from: number, period: number, points: ConstructorParameters<typeof LoopTrack>[4], iterations = Infinity): LoopTrack[] {
    const els = [...this.svg.querySelectorAll(PARTS[name][0])];
    const made = els.map((el, i) => new LoopTrack(el, `overfed.${name}Loop${els.length > 1 ? i : ''}`, from, period, points, iterations));
    this.loops.push(...made);
    return made;
  }

  /** Every track and loop (for MoveStage). */
  get tracks(): Sampled[] {
    return [...this.made.values(), ...this.loops];
  }

  // ---------- shared beats ----------

  /**
   * An instant change of a part at `t`: Track.set, a 1 ms ramp complete at `t` (timeline.ts STEP), so no two
   * keys of a track ever share a time. History (Felix's review 23.10, variant c): a switch used to be two keys
   * at one time, i.e. two keyframes at one offset; Firefox computed that correctly but its compositor did not
   * PAINT it while later runs of the same part were still pending (the blink and the switch to ^ ^ never
   * showed, the round eyes stayed under the arcs). Since 24.10 Track.set does this for every stage.
   */
  step(name: PartName, t: number, v: ChannelInput): void {
    this.part(name).set(t, v);
  }

  /**
   * Which eyes show from `t` on (a switch, like setEyes; hidden behind a blink or a squeeze): exactly one set
   * is visible at any time. `open` = how open the normal eyes are when they appear (1 = fully).
   */
  eyesTo(t: number, mode: 'normal' | 'happy' | 'sleep', open = 1): void {
    this.step('eyes', t, { o: mode === 'normal' ? 1 : 0, sx: 1, sy: mode === 'normal' ? open : 1 });
    this.step('happy', t, { o: mode === 'happy' ? 1 : 0 });
    this.step('sleep', t, { o: mode === 'sleep' ? 1 : 0 });
  }

  /**
   * The head turns part of the way (f: -1 = the full approved turn to the left … 1 = to the right), through
   * [time, f, easing] keys from `t0`: the face and blush slide and narrow, the near ear moves in, the far ear
   * moves over and shrinks, the far cheek tucks away — the values of BUNNY_CSS .turn-r / .turn-l, scaled.
   */
  turn(t0: number, keys: ReadonlyArray<readonly [number, number, string?]>): void {
    const at = (f: number) => {
      const g = Math.abs(f);
      const right = f >= 0;
      const face = { x: 13 * f, sx: 1 - 0.12 * g, sy: 1 };
      // the ears and cheeks go less far than in the full turn: the puffed far cheek stays under its ear (a
      // tucked cheek bares the body's waist; an ear that moves away bares a cheek bump) — the silhouette stays
      // the resting one while the face turns
      const near = { x: 6 * f, s: 1 };
      const far = { x: 10 * f, s: 1 - 0.08 * g };
      const tuck = { s: 1 - 0.15 * g };
      const full = { s: 1 + 0.04 * g };
      return { head: face, tpatch: face, teL: right ? far : near, teR: right ? near : far, tcL: right ? tuck : full, tcR: right ? full : tuck };
    };
    const names: ReadonlyArray<'head' | 'tpatch' | 'teL' | 'teR' | 'tcL' | 'tcR'> = ['head', 'teL', 'teR', 'tcL', 'tcR', ...(this.broken ? (['tpatch'] as const) : [])];
    for (const name of names) {
      this.part(name).path(t0, keys.map(([t, f, e]) => [t, at(f)[name], e ?? EASE.inOut] as const));
    }
  }

  /** One blink of the open eyes (140 ms, like the idle blink). */
  blink(t: number): void {
    this.part('eyes').path(t, [[t + 0.06, { sy: 0.12 }, 'ease-in'], [t + 0.15, { sy: 1 }, 'ease-out']]);
  }

  /** Chewing with full cheeks (the approved eat: only the cheeks and the nose work). `n` half-chews of `dt` s. */
  chew(t: number, n: number, dt = 0.15, amount = 1): void {
    const chew = this.part('chew');
    const nose = this.part('nose');
    const keys: Array<[number, ChannelInput, string]> = [];
    const nk: Array<[number, ChannelInput, string]> = [];
    for (let i = 1; i <= n; i++) {
      const on = i % 2 === 1;
      keys.push([t + i * dt, on ? { sx: 1 + 0.07 * amount, sy: 1 - 0.05 * amount } : { sx: 1, sy: 1 }, EASE.inOut]);
      nk.push([t + i * dt, on ? { y: 0.4, sx: 1.1, sy: 0.82 } : { y: 0, sx: 1, sy: 1 }, EASE.inOut]);
    }
    if (n % 2 === 1) {
      keys.push([t + (n + 1) * dt, { sx: 1, sy: 1 }, EASE.inOut]);
      nk.push([t + (n + 1) * dt, { y: 0, sx: 1, sy: 1 }, EASE.inOut]);
    }
    chew.path(Math.max(t, chew.end), keys);
    nose.path(Math.max(t, nose.end), nk);
  }

  /** Calm breathing after the show (the mascot's own `breathe`: 3.6 s, scale about the bottom). */
  breathe(from: number, deep = false, iterations = Infinity): void {
    const el = this.q('.breathe');
    this.loops.push(
      deep
        ? new LoopTrack(el, 'overfed.breathe', from, 3.4, [[0, { sx: 1, sy: 1 }, EASE.inOut], [0.5, { sx: 1.012, sy: 1.026 }, EASE.inOut], [1, { sx: 1, sy: 1 }]], iterations)
        : new LoopTrack(el, 'overfed.breathe', from, 3.6, [[0, { sx: 1, sy: 1 }, EASE.inOut], [0.5, { sx: 0.994, sy: 1.018 }, EASE.inOut], [1, { sx: 1, sy: 1 }]], iterations),
    );
  }
}
