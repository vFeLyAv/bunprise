/**
 * Actors of the welcome stage. Each one is the SAME bunny puppet as the mascot
 * (bunnyMarkup + BUNNY_CSS from bunny.ts, coat colours from BUNNY_COATS) in its
 * own small Shadow DOM, with the CSS motion switched off: every move is a Track
 * on the stage timeline (see timeline.ts), so seek(t) is exact.
 *
 *  - Peeker: the bunny behind an edge — the edge clips everything but the head,
 *    lop ears and face — plus two gripping paws drawn IN FRONT of the edge
 *    (the paw pose Felix liked on the app icon, icon.svg #bunny-paws); behind a
 *    side edge (a door frame) the paws hold on with their toes, inside the clip.
 *    It climbs out WITH ITS PAWS: ear tips, the paws come up and grip the edge,
 *    press on it (the wind-up), then it pulls itself up between them. Ducking:
 *    the head leads, the paws let go after it.
 *  - Runner: the whole bunny in the approved 3/4 turn, hopping along the bottom
 *    edge with the approved hop cycle (bunnyhop / hopsquash / tuck / earhop / tailbob).
 *
 * One ear physics for the whole stage: follow-through stays within ±14° of the
 * resting angle (the approved jump swings 10–14°), peaking 60–90 ms after the
 * head's jolt. Only the sniff lifts an ear further (the approved `alert` pose).
 *
 * Units: "bunny units" = the mascot's own coordinates (x = 0 centre line,
 * y = 0 feet, top of the head at y = -163). `u` = px per bunny unit.
 */

import { gallop } from './gallop';
import { earLifts, type EarLift } from './ear-lift';
import { BUNNY_COATS, BUNNY_CSS, bunnyMarkup, SURPRISE, SURPRISE_S, type SurpriseKey } from './bunny';
import { nextInstanceId, SPRING } from './core';
import { BASE_CSS, COAT_VARS } from './mascot';
import { applyFur } from './fur';
import { LoopTrack, splitEase, Track, type ChannelInput } from './timeline';
import type { BunnyCoat, CalmEyes, LookDir, StageEdge } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface Vec {
  x: number;
  y: number;
}

export interface StageGeo {
  /** Stage size, CSS px. */
  W: number;
  H: number;
  /** px per bunny unit of the main bunny. */
  u0: number;
  /** px between each host edge and the line the bunnies hide behind. */
  inset: Record<StageEdge, number>;
  /** Rounded corners (px) of the card under the stage (bottom) / a header over it (top); 0 = square. */
  radius?: Partial<Record<StageEdge, number>>;
}

/** Easings of the stage (the jump curves and SPRING come from the approved prototypes). */
export const E = {
  /** take-off / fast start, soft arrival (= EASINGS.jumpUp) */
  out: 'cubic-bezier(.2,.7,.3,1)',
  /** falling / accelerating (= EASINGS.jumpDown) */
  in: 'cubic-bezier(.5,0,.8,.5)',
  /** pulling itself up over the edge: quick start, long soft arrival (peak ≈ 24 px per frame for the main bunny) */
  pull: 'cubic-bezier(.25,.9,.35,1)',
  /** ducking away: ease-in-quad, it moves from the very first frame */
  drop: 'cubic-bezier(.55,.085,.68,.53)',
  /** face glances (= EASINGS.face) */
  face: 'cubic-bezier(.25,.8,.3,1)',
  /** overshooting settle (= SPRING) */
  spring: SPRING,
  inOut: 'ease-in-out',
} as const;

// ---------- frame geometry ----------

/** Crop of the mascot viewBox (400 x 260, feet at 200,246, .hm scale 1.2) around one bunny. */
const CROP = { x: 80, y: 0, w: 240, h: 270 } as const;
const FEET = { x: 200, y: 246 } as const;
const HM_SCALE = 1.2;

export interface FrameBox {
  /** frame size, px */
  w: number;
  h: number;
  /** the bunny's feet (local origin) inside the frame, px */
  ox: number;
  oy: number;
}

export function frameBox(u: number): FrameBox {
  const k = u / HM_SCALE;
  return { w: CROP.w * k, h: CROP.h * k, ox: (FEET.x - CROP.x) * k, oy: (FEET.y - CROP.y) * k };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Rotate a vector clockwise on screen (y points down). */
export function rotate(v: Vec, deg: number): Vec {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const isSide = (e: StageEdge) => e === 'left' || e === 'right';

// ---------- peek placement ----------

const BASE_ANGLE: Record<StageEdge, number> = { bottom: 0, left: 90, right: -90, top: 180 };
const INWARD: Record<StageEdge, Vec> = { bottom: { x: 0, y: -1 }, left: { x: 1, y: 0 }, right: { x: -1, y: 0 }, top: { x: 0, y: 1 } };
/** Default tilts: side bunnies lie almost sideways (the bun has no neck, so a stronger lean would show its flank). */
export const DEFAULT_TILT: Record<StageEdge, number> = { bottom: 0, left: -12, right: 12, top: 0 };
/** Default tilt for side peeks with `floor`: upright behind the edge, leaning out by 10°. */
export const FLOOR_TILT: Record<StageEdge, number> = { bottom: 0, left: -80, right: 80, top: 0 };

/** Outline points of the lop bunny (ears, head, cheeks, body) for "is it hidden yet?". */
const HULL: readonly Vec[] = [
  { x: 0, y: -165 },
  { x: -42, y: -167 },
  { x: 42, y: -167 },
  { x: -70, y: -146 },
  { x: 70, y: -146 },
  { x: -80, y: -110 },
  { x: 80, y: -110 },
  { x: -79, y: -86 },
  { x: 79, y: -86 },
  { x: -75, y: -45 },
  { x: 75, y: -45 },
  { x: -62, y: -3 },
  { x: 62, y: -3 },
];

/** The edge crosses the bunny's centre line this far above its feet (bunny units). */
const DEPTH = 56;
/** Paw spread along the edge (bunny units; the icon uses 25). */
const SPREAD = 24;
/** How far a glance moves the face (bunny units; the mascot uses 2.4 for a glance, 5 for "far"). */
const LOOK_AMP = 4;
/**
 * Turned 3/4 behind a door frame there is only ≈ 6 px between the muzzle and the far eye at the
 * frame (round-2 review): glances move the face this little (and 'viewer' not at all), the body
 * does not lean with them, the pull does not overshoot.
 */
const SIDE_LOOK_AMP = 1.5;
/** Resting lop-ear angle when hanging from the top edge: 0 = they keep framing the face (tried 40 / 90 / 150°: wings, arms, legs). */
const TOP_EAR = 0;
/**
 * Side edges: the paw is turned around (toes into the stage) and its tip sits this far INSIDE the
 * edge (bunny units): ≈ 55 % of the paw and all three toe lines show — from behind a door frame you
 * see the finger tips (round-2 review: the back of the paw alone read as two bumps).
 */
const SIDE_TIP = 11;
/**
 * Standing behind a side edge next to a rounded card corner, the feet go down behind the card by
 * min(corner radius, FLOOR_DROP_PX, FLOOR_DROP_UNITS u), so the card's own arc hides the bottom of the
 * body (not a straight cut over the background). Capped in bunny units: both paws must stay above the
 * card and below the muzzle.
 */
const FLOOR_DROP_PX = 30;
const FLOOR_DROP_UNITS = 20;

export interface PeekPlace {
  edge: StageEdge;
  /** frame rotation, deg (clockwise) */
  theta: number;
  /** host px of the bunny's feet (its local origin) */
  pivot: Vec;
  /** where the bunny's centre line meets the edge line, host px */
  anchorHost: Vec;
  /** inward normal of the edge in bunny space; the edge line is dot(m, p) = d */
  m: Vec;
  d: number;
  /** along the edge, in bunny space (points to the bunny's own +x side) */
  t: Vec;
  /** the point of the edge line nearest to the bunny's centre line (bunny space) */
  A: Vec;
  /** how far (bunny units, straight out through the edge) the bunny must move to be fully hidden */
  hideDist: number;
  /** ... so that only the ear tips show */
  earDist: number;
  /** rotation that keeps a paw flat on the edge, deg */
  pawTilt: number;
  /** where the left / right paw grip, along `t` from A (bunny units) */
  kL: number;
  kR: number;
  /** resting ear angles: lop ears hang with gravity when the bunny lies sideways */
  earL: number;
  earR: number;
  /** the edge inset in bunny units */
  insetUnits: number;
  /** stage centre, host px (for 'in' glances) */
  centre: Vec;
  /** the approved 3/4 turn toward the stage ('l' = the face turns to the bunny's own left, -x), or none */
  turn: 'l' | 'r' | null;
  /** host px of the eyes / the middle of the head when it is up (glance origin / target) */
  eyeHost: Vec;
  headHost: Vec;
  /** px the feet went down behind a rounded card corner (side edges with `floor`), else 0 */
  drop: number;
}

export interface PeekSpot {
  edge: StageEdge;
  pos: number;
  tilt: number;
  /** side edges: stand on the bottom edge line */
  floor: boolean;
  /** bunny units further out than the usual peek line */
  reveal: number;
  /** side edges with `floor`: turn 3/4 toward the stage */
  turn: boolean;
}

export function placePeek(spot: PeekSpot, u: number, geo: StageGeo): PeekPlace {
  const { edge, tilt } = spot;
  const theta = BASE_ANGLE[edge] + tilt;
  const nIn = INWARD[edge];
  const m = rotate(nIn, -theta);
  const C = { x: 0, y: -DEPTH }; // on the centre line; it sits `reveal` units inside the edge
  const reveal = Math.max(-40, Math.min(60, spot.reveal));
  const A = { x: C.x - m.x * reveal, y: C.y - m.y * reveal };
  const d = dot(m, A);
  const { W, H, inset } = geo;
  const p = Math.min(1, Math.max(0, spot.pos));
  const rc = rotate(C, theta);
  const floor = spot.floor && isSide(edge);
  // a rounded card corner under a side bunny: its feet go down behind the card (see FLOOR_DROP_PX)
  const drop = floor && inset.bottom > 0 ? Math.max(0, Math.min(geo.radius?.bottom ?? 0, W / 2, FLOOR_DROP_PX, FLOOR_DROP_UNITS * u)) : 0;
  let pivot: Vec;
  if (floor) {
    // feet on the bottom edge line (or `drop` px below it), centre line `reveal` units past the side edge
    const lineX = edge === 'left' ? inset.left : W - inset.right;
    pivot = { x: lineX + nIn.x * reveal * u - u * rc.x, y: H - inset.bottom + drop };
  } else {
    const onEdge =
      edge === 'bottom'
        ? { x: p * W, y: H - inset.bottom }
        : edge === 'top'
          ? { x: p * W, y: inset.top }
          : edge === 'left'
            ? { x: inset.left, y: p * H }
            : { x: W - inset.right, y: p * H };
    pivot = { x: onEdge.x + nIn.x * reveal * u - u * rc.x, y: onEdge.y + nIn.y * reveal * u - u * rc.y };
  }
  const toHost = (q: Vec): Vec => {
    const r = rotate(q, theta);
    return { x: pivot.x + u * r.x, y: pivot.y + u * r.y };
  };
  // behind a door frame the bunny turns its face into the stage (the approved quarter turn)
  const turn: 'l' | 'r' | null = floor && spot.turn ? (edge === 'right' ? 'l' : 'r') : null;
  const ts = turn === 'l' ? -1 : turn === 'r' ? 1 : 0;
  // the turn moves the near ear 8 units toward the stage (BUNNY_CSS .turn-l .te-l / .turn-r .te-r)
  const hull = ts ? HULL.map((q) => (q.y < -80 && Math.abs(q.x) > 30 && Math.sign(q.x) === ts ? { x: q.x + ts * 8, y: q.y } : q)) : HULL;
  const maxIn = Math.max(...hull.map((q) => dot(m, q)));
  // host "down" in bunny space: the lower lop ear swings out, the upper one drapes a little
  const g = rotate({ x: 0, y: 1 }, -theta);
  const t = { x: -m.y, y: m.x };
  // standing behind a door frame: one paw at the chin, one lower (on the chest / belly), never over
  // the muzzle; when the feet went down behind a card corner the lower paw stays above the card
  let kL = -SPREAD;
  let kR = SPREAD;
  if (floor) {
    const up = rotate(t, theta).y < 0;
    // heights above the feet (bunny units); `t` runs straight up (right edge) or down (left edge) the screen
    const hA = -rotate(A, theta).y;
    const low = Math.max(hA - 38, drop / u + 13);
    const kUp = 2;
    const kLow = hA - low;
    kL = up ? -kLow : kUp;
    kR = up ? -kUp : kLow;
  }
  return {
    edge,
    theta,
    pivot,
    anchorHost: toHost(A),
    m,
    d,
    t,
    A,
    hideDist: maxIn - d + 12,
    earDist: maxIn - d - 12,
    pawTilt: (Math.atan2(m.x, -m.y) * 180) / Math.PI,
    kL,
    kR,
    // hanging upside down from the top edge, the lop ears flip over and dangle
    earL: edge === 'top' ? TOP_EAR : -g.x * (g.x > 0 ? 8 : 20),
    earR: edge === 'top' ? -TOP_EAR : -g.x * (g.x > 0 ? 20 : 8),
    insetUnits: inset[edge] / u,
    centre: { x: W / 2, y: H / 2 },
    turn,
    eyeHost: toHost({ x: ts * 13, y: -93 }),
    headHost: toHost({ x: ts * 6, y: -105 }),
    drop,
  };
}

// ---------- shared actor plumbing ----------

/** The mascot CSS with every CSS animation / transition off: the stage timeline moves everything. */
const ACTOR_CSS = `${BASE_CSS}${BUNNY_CSS}
:host { display: block; position: absolute; inset: 0; width: auto; }
*, *::before, *::after { animation: none !important; transition: none !important; }
svg { height: 100%; }
.eyes, .eyes-star { transform-box: fill-box; transform-origin: center; }
.peek .paws, .peek .cookie, .peek .anger, .peek .shadow, .peek .tfoot, .peek .tail { display: none; }
.run .cookie, .run .anger { display: none; }
`;

/**
 * Gripping paw (icon.svg #bunny-paws), re-centred: the middle of its bottom edge is the origin.
 * `.grip-sh` = its contact shadow on the card (faded in only while the paw rests on the edge);
 * the toe lines take --grip-line (light lines on dark paws, so they never read as buttons).
 */
const gripPaw = (cls: string) =>
  `<g class="grip ${cls}"><ellipse class="grip-sh" cx="0" cy="-4.5" rx="13.3" ry="6.2" fill="#965A28" fill-opacity=".16"/><ellipse cx="0" cy="-10" rx="13" ry="10" fill="var(--mascot-paw)"/><path d="M-5.46 -8 v5.5 M0 -8 v5.5 M5.46 -8 v5.5" fill="none" stroke="var(--grip-line, rgba(150,90,40,.38))" stroke-width="1.3" stroke-linecap="round"/></g>`;

/** Writes the 7 coat colours on `el` (they inherit into shadow trees) and the pattern class on `.hm`. */
export function applyCoat(el: HTMLElement, hm: Element | null, coat: BunnyCoat): void {
  const c = BUNNY_COATS.find((x) => x.id === coat) ?? BUNNY_COATS[0];
  if (!c) return;
  COAT_VARS.forEach((v, i) => el.style.setProperty(v, c.colors[i] ?? ''));
  if (hm) {
    hm.classList.remove('pat-points', 'pat-broken');
    if (c.pattern !== 'none') hm.classList.add(`pat-${c.pattern}`);
    // the coat's own fur (fur.ts, opt-in: setBunnyFur) — without a setting nothing changes
    applyFur(hm, c.id);
  }
}

/** Toe lines: the icon's brown on light paws, a light line on dark ones (himalayan points). */
export function gripLine(coat: BunnyCoat): string {
  const c = BUNNY_COATS.find((x) => x.id === coat) ?? BUNNY_COATS[0];
  const n = Number.parseInt((c?.colors[5] ?? '#F5D6B0').slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.5 ? 'rgba(255,255,255,.45)' : 'rgba(150,90,40,.38)';
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

export interface Mounted {
  frame: HTMLDivElement;
  lift: HTMLDivElement;
  /** calm breathing, as a composited scale about the feet (no SVG repaint while idle) */
  calm: HTMLDivElement;
  host: HTMLDivElement;
  svg: SVGSVGElement;
  q: <T extends Element = SVGGElement>(sel: string) => T;
  qa: (sel: string) => SVGElement[];
}

// Parsing the puppet (≈ 110 SVG nodes + 9 KB of CSS) is the expensive part of building an actor,
// so it is parsed ONCE: the svg into a <template> (cloned per actor, ids made unique), the CSS into
// one shared constructable stylesheet (or a <style> where adoptedStyleSheets is missing).
const TPL = 'bp-welcome-tpl';
let bunnyTemplate: HTMLTemplateElement | null = null;
let pawTemplate: HTMLTemplateElement | null = null;
let actorSheet: CSSStyleSheet | null | undefined;

function template(kind: 'bunny' | 'paws'): HTMLTemplateElement {
  if (kind === 'bunny') {
    if (!bunnyTemplate) {
      bunnyTemplate = document.createElement('template');
      bunnyTemplate.innerHTML = `<svg viewBox="${CROP.x} ${CROP.y} ${CROP.w} ${CROP.h}" aria-hidden="true" focusable="false">${bunnyMarkup((n) => `${TPL}-${n}`)}</svg>`;
    }
    return bunnyTemplate;
  }
  if (!pawTemplate) {
    pawTemplate = document.createElement('template');
    pawTemplate.innerHTML = `<svg class="grip-svg" viewBox="0 0 ${CROP.w} ${CROP.h}" aria-hidden="true" focusable="false"><g transform="translate(${FEET.x - CROP.x} ${FEET.y - CROP.y}) scale(${HM_SCALE})">${gripPaw('grip-l')}${gripPaw('grip-r')}</g></svg>`;
  }
  return pawTemplate;
}

function cloneSvg(kind: 'bunny' | 'paws'): SVGSVGElement {
  const src = template(kind).content.firstElementChild;
  if (!src) throw new Error('[welcome] template failed to parse');
  return document.importNode(src, true) as SVGSVGElement;
}

/** Gradient / clip ids of a cloned puppet get this actor's own prefix (like every mascot instance). */
function uniqueIds(svg: SVGSVGElement, id: string): void {
  for (const el of svg.querySelectorAll('[id]')) el.id = el.id.replace(TPL, id);
  for (const el of svg.querySelectorAll('[fill^="url(#"], [clip-path^="url(#"]')) {
    for (const attr of ['fill', 'clip-path']) {
      const v = el.getAttribute(attr);
      if (v?.includes(TPL)) el.setAttribute(attr, v.replace(TPL, id));
    }
  }
}

function styleRoot(root: ShadowRoot): void {
  if (actorSheet === undefined) {
    actorSheet = null;
    try {
      if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root && 'replaceSync' in CSSStyleSheet.prototype) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(ACTOR_CSS);
        actorSheet = sheet;
      }
    } catch {
      actorSheet = null;
    }
  }
  if (actorSheet) root.adoptedStyleSheets = [actorSheet];
  else {
    const style = document.createElement('style');
    style.textContent = ACTOR_CSS;
    root.append(style);
  }
}

/** frame (placement) > lift (big moves) > calm (breathing) > actor host (shadow: the bunny svg); lift and calm are composited. */
export function mountBunny(parent: HTMLElement, box: FrameBox, svgClass: string): Mounted {
  const frame = div('frame');
  frame.style.width = `${box.w}px`;
  frame.style.height = `${box.h}px`;
  frame.style.transformOrigin = `${box.ox}px ${box.oy}px`;
  const lift = div('lift');
  const calm = div('calm');
  // breathing scales about the feet, like the mascot's `.breathe` (50% 100% of the bun)
  calm.style.transformOrigin = `${box.ox}px ${box.oy}px`;
  const host = div('actor');
  frame.append(lift);
  lift.append(calm);
  calm.append(host);
  parent.append(frame);
  const root = host.attachShadow({ mode: 'open' });
  styleRoot(root);
  const svg = cloneSvg('bunny');
  svg.setAttribute('class', svgClass);
  uniqueIds(svg, nextInstanceId('welcome'));
  root.append(svg);
  const q = <T extends Element = SVGGElement>(sel: string): T => {
    const el = svg.querySelector<T & Element>(sel);
    if (!el) throw new Error(`[welcome] missing part: ${sel}`);
    return el;
  };
  const qa = (sel: string) => [...svg.querySelectorAll<SVGElement>(sel)];
  return { frame, lift, calm, host, svg, q, qa };
}

/** Common bookkeeping: tracks (one per animated part) and idle loops. */
abstract class ActorBase {
  readonly tracks: Array<Track | EarLift> = [];
  readonly loops: LoopTrack[] = [];
  protected readonly made = new Map<string, Track>();

  constructor(
    /** stable track-name prefix: p<bunny> for a peeker, r<bunny> for a runner */
    readonly name: string,
    readonly coat: BunnyCoat,
    /** px per bunny unit */
    readonly u: number,
  ) {}

  /** The track of `part` (created on first use with `base` as its resting value). */
  protected tr(part: string, el: Element | readonly Element[], base: ChannelInput): Track {
    const hit = this.made.get(part);
    if (hit) return hit;
    const t = new Track(el, `${this.name}.${part}`, base);
    this.made.set(part, t);
    this.tracks.push(t);
    return t;
  }

  /** The outer elements of this actor (shown only around its part of the show). */
  abstract readonly frames: readonly HTMLElement[];

  /** When this actor first moves (s). */
  get firstKey(): number {
    return Math.min(...this.tracks.map((t) => t.start), ...this.loops.map((l) => l.start));
  }

  /** When it is done (s): Infinity while it keeps breathing on stage. */
  get lastKey(): number {
    const loopEnd = Math.max(-Infinity, ...this.loops.map((l) => l.start + l.period * l.iterations));
    return Math.max(loopEnd, ...this.tracks.map((t) => t.end));
  }

  abstract remove(): void;
}

// ---------- Peeker ----------

export interface PeekPlan {
  at: number;
  place: PeekPlace;
  hold: number;
  look: ReadonlyArray<readonly [LookDir, number]>;
  sniff: boolean;
  greet: boolean;
  surprise?: boolean;
  earsOnly?: boolean;
  seated?: boolean;
  nod?: LookDir | undefined;
  /** both paws up off the edge, head tilted, ears flared: "no idea" */
  shrug?: boolean;
  /** yawns and nods off (eyes closed; its calm hold breathes deeply with a floating "z") */
  doze?: boolean;
  stay: boolean;
  /** where the face points while it climbs up */
  face?: LookDir | undefined;
  /** s after `at` when the glances start */
  lookFrom: number;
  /** host px of bunny N at time t (the stage knows everybody's part), for 'at:N' glances */
  target?: ((n: number, t: number) => Vec | null) | undefined;
}

/**
 * The two gripping paws, twice: BACK (inside the edge clip, so a paw coming up or
 * going down really passes behind the edge) and FRONT (over the edge, so a paw
 * resting on it can hang over the line). Only one copy shows at a time.
 */
interface PawFrame {
  frame: HTMLDivElement;
  L: SVGGElement;
  R: SVGGElement;
  /** contact shadows (only the front copy's are ever shown) */
  shL: SVGElement;
  shR: SVGElement;
}

function mountPaws(parent: HTMLElement, box: FrameBox, coat: BunnyCoat): PawFrame {
  const frame = div('frame');
  frame.style.width = `${box.w}px`;
  frame.style.height = `${box.h}px`;
  frame.style.transformOrigin = `${box.ox}px ${box.oy}px`;
  frame.append(cloneSvg('paws'));
  applyCoat(frame, null, coat);
  frame.style.setProperty('--grip-line', gripLine(coat));
  parent.append(frame);
  const L = frame.querySelector<SVGGElement>('.grip-l');
  const R = frame.querySelector<SVGGElement>('.grip-r');
  const shL = frame.querySelector<SVGElement>('.grip-l .grip-sh');
  const shR = frame.querySelector<SVGElement>('.grip-r .grip-sh');
  if (!L || !R || !shL || !shR) throw new Error('[welcome] paws failed to mount');
  return { frame, L, R, shL, shR };
}

type TurnPart = 'tf' | 'tpatch' | 'teL' | 'teR' | 'tcL' | 'tcR';
const TURN_SEL: Record<TurnPart, string> = { tf: '.tf', tpatch: '.tpatch', teL: '.lop .te-l', teR: '.lop .te-r', tcL: '.tc-l', tcR: '.tc-r' };
/**
 * The far ear in the 3/4 turn behind a door frame: 0 = hidden. With the turn it moves toward the
 * stage, and at the 10° lean it only ever showed as a 2–4 px wedge at the edge (round-1 review:
 * "show it ≥ 10 px or not at all"); the turned bunny reads as turned without it.
 */
const FAR_EAR = 0;

/** The approved quarter turn (BUNNY_CSS .turn-r / .turn-l) as track values, so one actor can peek turned and straight. */
function turnValues(turn: 'l' | 'r' | null): Record<TurnPart, ChannelInput> {
  const id: ChannelInput = { x: 0, sx: 1, sy: 1, o: 1 };
  if (!turn) return { tf: id, tpatch: id, teL: id, teR: id, tcL: id, tcR: id };
  const r = turn === 'r';
  const face: ChannelInput = { x: r ? 13 : -13, sx: 0.88, sy: 1, o: 1 };
  return {
    tf: face,
    tpatch: face,
    teL: r ? { x: 16, sx: 0.86, sy: 0.86, o: FAR_EAR } : { x: -8, sx: 1, sy: 1, o: 1 },
    teR: r ? { x: 8, sx: 1, sy: 1, o: 1 } : { x: -16, sx: 0.86, sy: 0.86, o: FAR_EAR },
    tcL: r ? { x: 0, sx: 0.55, sy: 0.55, o: 1 } : { x: 0, sx: 1.04, sy: 1.04, o: 1 },
    tcR: r ? { x: 0, sx: 1.04, sy: 1.04, o: 1 } : { x: 0, sx: 0.55, sy: 0.55, o: 1 },
  };
}

export class Peeker extends ActorBase {
  readonly kind = 'peek' as const;
  private readonly head: Mounted;
  private readonly front: PawFrame;
  private readonly back: PawFrame;
  private readonly box: FrameBox;
  private readonly clipOrigin: Vec;
  private readonly el: {
    hm: SVGGElement;
    hop: SVGGElement;
    body: SVGGElement;
    squash: SVGGElement;
    earL: SVGGElement;
    earR: SVGGElement;
    face: SVGGElement;
    eyes: SVGGElement;
    eye: SVGElement[];
    star: SVGGElement;
    sleep: SVGGElement;
    mouth: SVGElement;
    mouthOpen: SVGElement;
    nose: SVGGElement;
    fx: SVGGElement;
  };
  private readonly turnParts: TurnPart[];
  private puffs = 0;
  /** nodded off (doze): its calm hold sleeps instead of blinking */
  private dozing = false;
  /** Resting ear angles of the current peek (gravity when lying sideways). */
  private bL = 0;
  private bR = 0;
  /** The quarter turn of the current peek. */
  private turned: 'l' | 'r' | null = null;
  /** Where bunny N is at time t (host px), for 'at:N' glances; set per peek. */
  private target: ((n: number, t: number) => Vec | null) | null = null;

  constructor(name: string, coat: BunnyCoat, u: number, clip: HTMLElement, clipOrigin: Vec, pawLayer: HTMLElement, first: PeekPlace) {
    super(name, coat, u);
    this.box = frameBox(u);
    this.clipOrigin = clipOrigin;
    this.head = mountBunny(clip, this.box, 'peek');
    this.back = mountPaws(clip, this.box, coat);
    this.front = mountPaws(pawLayer, this.box, coat);
    const { q, qa } = this.head;
    const hm = q('.hm');
    applyCoat(this.head.host, hm, coat);

    this.el = {
      hm,
      hop: q('.hop'),
      body: q('.body'),
      squash: q('.squash'),
      earL: q('.lop .ear-l'),
      earR: q('.lop .ear-r'),
      face: q('.face'),
      eyes: q('.eyes'),
      eye: qa('.eyes .eye'),
      star: q('.eyes-star'),
      sleep: q('.eyes-sleep'),
      mouth: q<SVGElement>('.mouth'),
      mouthOpen: q<SVGElement>('.mouth-open'),
      nose: q('.nose'),
      fx: q('.fx'),
    };
    // the broken coat's face patch turns with the face; other coats do not show it
    const broken = BUNNY_COATS.find((c) => c.id === coat)?.pattern === 'broken';
    this.turnParts = (['tf', 'tpatch', 'teL', 'teR', 'tcL', 'tcR'] as const).filter((k) => k !== 'tpatch' || broken);

    // resting values = hidden behind the first edge
    this.tr('frame', [this.head.frame, this.back.frame], this.frameXY(first, this.clipOrigin));
    this.tr('pawFrame', this.front.frame, this.frameXY(first, { x: 0, y: 0 }));
    this.tr('lift', this.head.lift, this.liftAt(first, first.hideDist));
    this.tr('pawL', [this.front.L, this.back.L], this.pawHidden(first, first.kL));
    this.tr('pawR', [this.front.R, this.back.R], this.pawHidden(first, first.kR));
    this.tr('pawLf', this.front.L, { o: 0 });
    this.tr('pawLb', this.back.L, { o: 1 });
    this.tr('pawRf', this.front.R, { o: 0 });
    this.tr('pawRb', this.back.R, { o: 1 });
    this.tr('shL', this.front.shL, { o: 0 });
    this.tr('shR', this.front.shR, { o: 0 });
    this.tr('earL', this.el.earL, { r: first.earL });
    this.tr('earR', this.el.earR, { r: first.earR });
    this.bL = first.earL;
    this.bR = first.earR;
    // a bunny whose first peek is turned starts turned: static inline values, nothing animates
    if (first.turn) {
      const v = turnValues(first.turn);
      for (const k of this.turnParts) this.tr(`turn.${k}`, this.head.q(TURN_SEL[k]), v[k]);
      this.turned = first.turn;
    }
  }

  /**
   * From `t` on, show the paw over the edge (front copy) or behind it (back copy). Side edges always
   * use the back copy: a paw around a door frame never overhangs the line, and the edge clip (with a
   * card's rounded corner) then hides whatever of it is behind the card.
   */
  private pawOver(side: 'L' | 'R', t: number, over: boolean, place: PeekPlace): void {
    const front = over && !isSide(place.edge);
    this.tr(`paw${side}f`, this.front[side], {}).set(t, { o: front ? 1 : 0 });
    this.tr(`paw${side}b`, this.back[side], {}).set(t, { o: front ? 0 : 1 });
  }

  /** Switch the quarter turn at `t` (while hidden). */
  private turnTo(t: number, turn: 'l' | 'r' | null): void {
    if (turn === this.turned) return;
    const from = turnValues(null);
    const to = turnValues(turn);
    for (const k of this.turnParts) this.tr(`turn.${k}`, this.head.q(TURN_SEL[k]), from[k]).set(t, to[k]);
    this.turned = turn;
  }

  private eL(r: number): ChannelInput {
    return { r: this.bL + r };
  }
  private eR(r: number): ChannelInput {
    return { r: this.bR + r };
  }

  get frames(): readonly HTMLElement[] {
    return [this.head.frame, this.back.frame, this.front.frame];
  }

  remove(): void {
    this.head.frame.remove();
    this.back.frame.remove();
    this.front.frame.remove();
  }

  // ---- track shortcuts ----
  private get lift() {
    return this.tr('lift', this.head.lift, { x: 0, y: 0 });
  }
  private get hop() {
    return this.tr('hop', this.el.hop, { y: 0 });
  }
  private get body() {
    return this.tr('body', this.el.body, { r: 0 });
  }
  private get squash() {
    return this.tr('squash', this.el.squash, { sx: 1, sy: 1 });
  }
  private get earL() {
    return this.tr('earL', this.el.earL, { r: 0 });
  }
  private get earR() {
    return this.tr('earR', this.el.earR, { r: 0 });
  }
  private get face() {
    return this.tr('face', this.el.face, { x: 0, y: 0 });
  }
  private get eyes() {
    return this.tr('eyes', this.el.eyes, { sx: 1, sy: 1 });
  }
  private get star() {
    return this.tr('star', this.el.star, { o: 0, sx: 1, sy: 1 });
  }
  private get mouth() {
    return this.tr('mouth', this.el.mouth, { o: 1 });
  }
  private get mouthOpen() {
    return this.tr('mouthOpen', this.el.mouthOpen, { o: 0 });
  }
  private get sleepEyes() {
    return this.tr('sleepEyes', this.el.sleep, { o: 0 });
  }
  private get nose() {
    return this.tr('nose', this.el.nose, { y: 0, sx: 1, sy: 1 });
  }
  private get pawL() {
    return this.tr('pawL', [this.front.L, this.back.L], {});
  }
  private get pawR() {
    return this.tr('pawR', [this.front.R, this.back.R], {});
  }

  // ---- geometry helpers ----

  /** Lift offset (px, in the rotated frame): `dist` bunny units straight out through the edge. */
  private liftAt(place: PeekPlace, dist: number): ChannelInput {
    return { x: -place.m.x * dist * this.u, y: -place.m.y * dist * this.u };
  }

  /** Frame translate + rotation that puts the bunny's feet on `place.pivot` (container origin subtracted). */
  private frameXY(place: PeekPlace, origin: Vec): ChannelInput {
    return { x: place.pivot.x - this.box.ox - origin.x, y: place.pivot.y - this.box.oy - origin.y, r: place.theta };
  }

  /**
   * Where a paw rests on the edge: k along the edge. Bottom / top: a little over the line when there
   * is room (on the card, like the icon). Side edges: the paw is turned around and its tip (toes)
   * sits SIDE_TIP inside the line, the rest of it behind the door frame.
   */
  private pawBase(place: PeekPlace, k: number): Vec {
    const over = isSide(place.edge) ? -SIDE_TIP : Math.min(place.insetUnits, 7) + 0.6;
    return {
      x: place.A.x + place.t.x * k - place.m.x * over,
      y: place.A.y + place.t.y * k - place.m.y * over,
    };
  }

  /** The paw's rotation while it holds the edge: flat on it; on a side edge turned around, toes into the stage. */
  private gripTilt(place: PeekPlace): number {
    return place.pawTilt + (isSide(place.edge) ? 180 : 0);
  }

  /** Behind the edge AND outside the host, so it cannot show in the inset strip either. */
  private pawHidden(place: PeekPlace, k: number): ChannelInput {
    const b = this.pawBase(place, k);
    // a turned-around side paw reaches back from its tip, so the tip only has to clear the line
    const back = (isSide(place.edge) ? SIDE_TIP + 4 : 26) + place.insetUnits;
    return { x: b.x - place.m.x * back, y: b.y - place.m.y * back, r: this.gripTilt(place), sx: 1, sy: 1 };
  }

  /** Turned 3/4 behind a side edge (a door frame): glances must keep the face where it is. */
  private turnedSide(place: PeekPlace): boolean {
    return place.turn !== null && isSide(place.edge);
  }

  /** A screen direction (or another bunny) -> face offset in the bunny's own (maybe rotated) frame. */
  private lookOffset(dir: LookDir, place: PeekPlace, t: number): Vec {
    // turned 3/4 behind a door frame the face already points into the stage; "at you" leaves it
    // there (bringing it back from the turn slid the muzzle onto the frame)
    if (dir === 'viewer') return { x: 0, y: 0 };
    // ... and the other glances barely move it (up / down run along the frame, they keep the usual amplitude)
    const amp = this.turnedSide(place) && dir !== 'up' && dir !== 'down' ? SIDE_LOOK_AMP : LOOK_AMP;
    let v: Vec = { x: 0, y: 0 };
    if (dir === 'left') v = { x: -1, y: 0 };
    else if (dir === 'right') v = { x: 1, y: 0 };
    else if (dir === 'up') v = { x: 0, y: -0.75 };
    else if (dir === 'down') v = { x: 0, y: 0.6 };
    else {
      // 'in' = the middle of the stage; 'at:N' = bunny N (its head), wherever it is at that moment
      const n = /^at:(\d+)$/.exec(dir);
      const point = /^pt:(-?[\d.]+),(-?[\d.]+)$/.exec(dir);
      const p = (point ? { x: Number(point[1]) * place.centre.x * 2, y: Number(point[2]) * place.centre.y * 2 } : n ? this.target?.(Number(n[1]), t) : null) ?? place.centre;
      const dx = p.x - place.eyeHost.x;
      const dy = p.y - place.eyeHost.y;
      const len = Math.hypot(dx, dy) || 1;
      v = { x: dx / len, y: (dy / len) * 0.75 };
    }
    const local = rotate(v, -place.theta);
    return { x: local.x * amp, y: local.y * amp };
  }

  // ---- choreography ----

  /** Authors one peek; returns when it is over (hidden again, or settled when it stays). */
  peek(plan: PeekPlan): number {
    const { at: t0, place } = plan;
    this.target = plan.target ?? null;
    // place the frames while everything is hidden
    this.tr('frame', this.head.frame, {}).set(t0, this.frameXY(place, this.clipOrigin));
    this.tr('pawFrame', this.front.frame, {}).set(t0, this.frameXY(place, { x: 0, y: 0 }));
    this.lift.set(t0, this.liftAt(place, place.hideDist));
    this.pawL.set(t0, this.pawHidden(place, place.kL));
    this.pawR.set(t0, this.pawHidden(place, place.kR));
    this.pawOver('L', t0, false, place);
    this.pawOver('R', t0, false, place);
    this.turnTo(t0, place.turn);
    this.bL = place.earL;
    this.bR = place.earR;
    this.earL.set(t0, this.eL(0));
    this.earR.set(t0, this.eR(0));

    if (plan.earsOnly) {
      // Lop-ear tips sit below the forehead: use the tall surprise rig so the face stays fully hidden.
      this.earL.set(t0, { o: 0 }); this.earR.set(t0, { o: 0 });
      const left = this.tr('earTipsL', this.head.q('.tall .tear-l'), { o: 1 });
      const right = this.tr('earTipsR', this.head.q('.tall .tear-r'), { o: 1 });
      this.lift.set(t0, this.liftAt(place, place.hideDist + 130));
      this.lift.path(t0, [[t0 + 0.35, this.liftAt(place, place.hideDist + 15), E.spring], [t0 + 1.25, this.liftAt(place, place.hideDist + 15)], [t0 + 1.55, this.liftAt(place, place.hideDist + 130), E.drop]]);
      left.path(t0 + 0.45, [[t0 + 0.62, { r: -12 }], [t0 + 0.79, { r: 7 }], [t0 + 0.96, { r: 0 }]]);
      right.path(t0 + 0.55, [[t0 + 0.72, { r: 12 }], [t0 + 0.89, { r: -7 }], [t0 + 1.06, { r: 0 }]]);
      return t0 + 1.55;
    }

    // climbs out with its paws: ear tips, the paws come up and grip the edge, press on it (the
    // wind-up), then it pulls itself up between them
    const tUp = plan.seated ? t0 : this.appear(t0, place);
    if (plan.seated) {
      this.lift.set(t0, this.liftAt(place, 0));
      this.pawL.set(t0, { ...this.pawBase(place, place.kL), r: this.gripTilt(place) });
      this.pawR.set(t0, { ...this.pawBase(place, place.kR), r: this.gripTilt(place) });
      this.pawOver('L', t0, true, place);
      this.pawOver('R', t0, true, place);
      this.earL.path(t0 + 0.25, [[t0 + 0.4, this.eL(10)], [t0 + 0.55, this.eL(-5)], [t0 + 0.7, this.eL(0)]]);
      this.earR.path(t0 + 0.3, [[t0 + 0.45, this.eR(-10)], [t0 + 0.6, this.eR(5)], [t0 + 0.75, this.eR(0)]]);
    } else {
      this.gripPaw('L', t0 + 0.28, place, tUp);
      this.gripPaw('R', t0 + 0.36, place, tUp);
    }
    // already looking somewhere while it climbs (the face turns while it is still behind the edge)
    if (plan.face) this.face.move(t0 + 0.48, t0 + 0.6, this.lookOffset(plan.face, place, t0 + 0.48), E.face);

    const seq = t0 + Math.max(0.6, plan.lookFrom);
    // a blink once it is up (with its first glance, if that comes sooner); a greeting blinks by itself
    if (plan.look.length || !plan.greet) this.blink(Math.min(t0 + 1.3, seq));
    let t = seq;
    for (const [dir, dur] of plan.look) t = this.glance(t, dir, dur, place);
    if (plan.sniff) t = this.sniff(t, place);
    if (plan.surprise) t = this.surprise(t);
    if (plan.greet) t = this.greet(t, place);
    if (plan.nod) {
      t = this.glance(t, plan.nod, 0.35, place);
      this.hop.path(t, [[t + 0.12, { y: 3 }], [t + 0.27, { y: 0 }, E.spring]]);
      t += 0.27;
    }
    if (plan.shrug) t = this.shrug(t, place);
    if (plan.doze) t = this.doze(t, place);
    if (plan.stay) {
      if (plan.look.length && !plan.greet && !plan.shrug && !plan.doze) {
        const last = plan.look[plan.look.length - 1];
        if (last && last[0] !== 'viewer') t = this.glance(t, 'viewer', 0.3, place);
      }
      return t;
    }
    const duckAt = Math.max(t, seq + plan.hold);
    if (duckAt - t > 0.6) this.linger(t, duckAt, place);
    return this.duck(duckAt, place);
  }

  calmEyes(t: number, mode: CalmEyes): void {
    this.eyes.set(t, { o: 0 });
    this.star.set(t, { o: 0 });
    this.tr('happyEyes', this.head.q('.eyes-happy'), { o: 0 }).set(t, { o: mode === 'happy' ? 1 : 0 });
    this.sleepEyes.set(t, { o: mode === 'sleep' ? 1 : 0 });
  }

  holdCalendar(): void {
    const prop = document.createElementNS(SVG_NS, 'g');
    prop.setAttribute('transform', 'translate(10 -83) rotate(8)');
    prop.innerHTML = '<rect width="32" height="29" rx="4" fill="#FFF7EC" stroke="rgba(150,90,40,.4)"/><path d="M4 0h24q4 0 4 4v5H0V4q0-4 4-4" fill="#F0A04B"/><path d="M8 0v4M24 0v4" stroke="#9A6A42" stroke-width="2" stroke-linecap="round"/><g fill="#C99161"><circle cx="8" cy="15" r="1.5"/><circle cx="16" cy="15" r="1.5"/><circle cx="24" cy="15" r="1.5"/><circle cx="8" cy="22" r="1.5"/><circle cx="16" cy="22" r="1.5"/></g><circle cx="24" cy="22" r="3" fill="#F0A04B"/>';
    this.head.q('.hm').append(prop);
  }

  /** One ear rig and one score, shared with Bunny.play('surprise'). */
  private surprise(t: number): number {
    // The arrival's ear follow-through can finish after lookFrom. Appending earlier would clamp
    // keys to one instant and produce a visible jump. Let it settle before the surprise begins.
    const start = Math.max(t, this.earL.end, this.earR.end);
    this.el.hm.classList.add('surprise-ears');
    const author = (track: Track, keys: readonly SurpriseKey[], baseR = 0) => {
      const value = (v: ChannelInput): ChannelInput => v.r === undefined ? v : { ...v, r: baseR + v.r };
      const first = keys[0];
      if (first) track.set(start + first[0], value(first[1]));
      for (let i = 1; i < keys.length; i++) {
        const previous = keys[i - 1]!, next = keys[i]!;
        track.move(start + previous[0], start + next[0], value(next[1]), previous[2] ?? 'linear');
      }
    };
    this.earL.set(start, { r: this.bL });
    this.earR.set(start, { r: this.bR });
    this.tracks.push(...earLifts(this.el.earL, this.el.earR, start, this.name));
    author(this.hop, SURPRISE.hop);
    author(this.squash, SURPRISE.squash);
    author(this.eyes, SURPRISE.eyes);
    author(this.mouth, SURPRISE.mouth);
    author(this.mouthOpen, SURPRISE.mouthOpen);
    return start + SURPRISE_S;
  }


  /**
   * Ear tips -> (the paws come up, grip and press on the edge, see gripPaw) -> a tiny dip -> the
   * bunny pulls itself up between its paws with an overshoot and settles; the body swings in a
   * small arc around its paws, the ears lag behind the pull and follow through when the head stops.
   * The head rides on the compositor while the SVG paws stand still, so nothing drifts apart.
   * Returns when the pull starts.
   */
  private appear(t0: number, place: PeekPlace): number {
    // from behind a door frame the pull goes sideways: no body arc (it would swing the head along
    // the pull) and no overshoot (the muzzle and the far eye would slide past the frame) — a little
    // vertical spring takes it instead
    const side = isSide(place.edge);
    const tUp = t0 + 0.66;
    const tTop = tUp + (side ? 0.28 : 0.34);
    // the dip is tiny: only ≈ 8 units of ear tip are above the edge, partly behind the paws, and the
    // bunny must never vanish right before its big move (the anticipation is in the paws pressing on the edge)
    const pull: Array<readonly [number, ChannelInput, string?]> = [
      [t0 + 0.22, this.liftAt(place, place.earDist), E.out],
      [t0 + 0.56, this.liftAt(place, place.earDist - 1.5)],
      [tUp, this.liftAt(place, place.earDist + 1)],
    ];
    if (side) pull.push([tTop, this.liftAt(place, 0), E.pull]);
    else pull.push([tTop, this.liftAt(place, -5), E.pull], [tTop + 0.12, this.liftAt(place, 1.2)], [tTop + 0.22, this.liftAt(place, 0)]);
    this.lift.path(t0, pull);
    // the arc: it leans into the pull, swings past, settles (around its own tilt)
    if (!side) {
      this.body.path(t0 + 0.56, [
        [tUp, { r: 3 }],
        [tTop - 0.02, { r: -1.5 }],
        [tTop + 0.15, { r: 0 }],
      ]);
    }
    this.squash.path(t0 + 0.56, [
      [tUp, { sx: 1.02, sy: 0.99 }],
      [tUp + 0.1, { sx: 0.97, sy: 1.04 }, E.out],
      [tTop + 0.06, { sx: 1.02, sy: 0.98 }],
      [tTop + 0.22, { sx: 1, sy: 1 }],
    ]);
    // left ear: + = the tip flares out / up; the right ear is mirrored, a little late and a little different
    this.earL.path(t0, [
      [t0 + 0.08, this.eL(-4)],
      [t0 + 0.16, this.eL(5)],
      [t0 + 0.26, this.eL(-2)],
      [t0 + 0.36, this.eL(0)],
      [t0 + 0.52, this.eL(2.5)], // the left paw lands (0.48): a little shiver
      [t0 + 0.62, this.eL(0.5)],
      [tUp, this.eL(3)], // the dip: the tips float up
      [tUp + 0.08, this.eL(-6)], // the pull: they lag behind
      [tTop + 0.05, this.eL(12), E.out], // the head stops: follow-through
      [tTop + 0.19, this.eL(-4)],
      [tTop + 0.32, this.eL(1.5)],
      [tTop + 0.44, this.eL(0)],
    ]);
    this.earR.path(t0, [
      [t0 + 0.1, this.eR(4)],
      [t0 + 0.19, this.eR(-5)],
      [t0 + 0.29, this.eR(2)],
      [t0 + 0.39, this.eR(0)],
      [t0 + 0.6, this.eR(-2.5)], // the right paw lands (0.56)
      [tUp + 0.01, this.eR(-3)],
      [tUp + 0.09, this.eR(5)],
      [tTop + 0.07, this.eR(-10), E.out],
      [tTop + 0.21, this.eR(3.5)],
      [tTop + 0.34, this.eR(-1)],
      [tTop + 0.46, this.eR(0)],
    ]);
    return tUp;
  }

  /**
   * A paw comes up from behind the edge in a little arc (out along the edge at the top of its
   * reach), slaps down onto its spot with a squash; then it presses on the edge — the wind-up of the
   * pull, "pushing off" — and stretches as the bunny pulls itself up at `tUp`.
   */
  private gripPaw(which: 'L' | 'R', t: number, place: PeekPlace, tUp: number): void {
    const T = which === 'L' ? this.pawL : this.pawR;
    const k = which === 'L' ? place.kL : place.kR;
    const side = which === 'L' ? -1 : 1;
    const b = this.pawBase(place, k);
    const m = place.m;
    const r0 = this.gripTilt(place);
    // the top of the reach: past the edge, and 4 units further out along it than where it lands
    const reach = { x: b.x + m.x * 10 + place.t.x * side * 4, y: b.y + m.y * 10 + place.t.y * side * 4 };
    const press = { sx: 1.08, sy: 0.9 };
    // behind the edge on the way up; over it from the top of the reach (it is clear of the edge there)
    this.pawOver(which, t + 0.14, true, place);
    const points: Array<readonly [number, ChannelInput, string?]> = [
      [t + 0.14, { x: reach.x, y: reach.y, r: r0 + side * 8, sx: 0.94, sy: 1.06 }, E.out],
      [t + 0.2, { x: b.x, y: b.y, r: r0, sx: 1, sy: 1 }, E.in],
      [t + 0.24, { sx: 1.14, sy: 0.84 }, E.out],
    ];
    const pressAt = tUp - 0.08;
    if (t + 0.29 <= pressAt) {
      // landed early (the first paw): it bounces back, then presses on the edge a second time
      points.push([t + 0.29, { sx: 0.97, sy: 1.03 }], [pressAt, { sx: 0.97, sy: 1.03 }], [tUp, press, 'ease-out']);
    } else {
      // landed late (the second paw): it stays pressed after its slap until the pull
      points.push([Math.min(t + 0.28, tUp), press], [tUp, press]);
    }
    points.push([tUp + 0.06, { sx: 0.97, sy: 1.04 }, E.out], [tUp + 0.16, { sx: 1, sy: 1 }]);
    T.path(t, points);
    this.contact(which, t + 0.2, true, place);
  }

  /** The paw's contact shadow on the card: there only while the paw rests on a bottom / top edge. */
  private contact(which: 'L' | 'R', t: number, on: boolean, place: PeekPlace): void {
    if (isSide(place.edge)) return;
    const el = which === 'L' ? this.front.shL : this.front.shR;
    this.tr(`sh${which}`, el, { o: 0 }).move(t, t + (on ? 0.06 : 0.05), { o: on ? 1 : 0 }, 'ease-out');
  }

  blink(t: number): void {
    const { sx } = this.eyes.value;
    this.eyes.path(t, [
      [t + 0.05, { sx: sx ?? 1, sy: 0.1 }, E.in],
      [t + 0.13, { sx: sx ?? 1, sy: 1 }, E.out],
    ]);
  }

  /** A glance; a long one is a moving hold (it arrives at ~90 % and drifts the rest of the way). */
  private glance(t: number, dir: LookDir, dur: number, place: PeekPlace): number {
    const off = this.lookOffset(dir, place, t);
    const hold = Math.max(0.12, dur);
    // the body leans with a sideways glance; looking at you it stands straight. Behind a door frame
    // it never leans: the head turns around the paws, 3° are ≈ 5 units at the eyes — past the frame
    const lean = dir === 'viewer' || this.turnedSide(place) ? 0 : Math.max(-3, Math.min(3, (off.x / LOOK_AMP) * 3));
    const tb = Math.max(t, this.body.end);
    if (hold > 0.45) {
      const end = t + Math.min(hold, 0.75);
      this.face.path(t, [
        [t + 0.22, { x: off.x * 0.88, y: off.y * 0.88 }, E.face],
        [end, { x: off.x, y: off.y }, E.inOut],
      ]);
      this.body.path(tb, [
        [Math.max(tb + 0.12, t + 0.36), { r: lean * 0.75 }, E.inOut],
        [Math.max(tb + 0.24, end), { r: lean }, E.inOut],
      ]);
    } else {
      this.face.move(t, t + 0.22, { x: off.x, y: off.y }, E.face);
      this.body.move(tb, Math.max(tb + 0.12, t + 0.36), { r: lean }, E.inOut);
    }
    return t + hold;
  }

  /** A long wait before ducking: a slow sway (behind a door frame: of the ears) and a blink, so the pose never freezes. */
  private linger(from: number, to: number, place: PeekPlace): void {
    const r = this.body.value.r ?? 0;
    const tb = Math.max(from, this.turnedSide(place) ? Math.max(this.earL.end, this.earR.end) : this.body.end);
    const mid = Math.max(tb + 0.3, (from + to) / 2);
    if (mid < to - 0.2) {
      if (this.turnedSide(place)) {
        this.earL.path(tb, [
          [mid, this.eL(3)],
          [to, this.eL(0)],
        ]);
        this.earR.path(tb, [
          [mid + 0.06, this.eR(-3)],
          [to, this.eR(0)],
        ]);
      } else {
        this.body.path(tb, [
          [mid, { r: r + 1.2 }],
          [to, { r }],
        ]);
      }
    }
    if (this.eyes.end < mid - 0.1) this.blink(mid);
  }

  /** +1 when the bunny's own right side faces the stage (the approved `alert` lifts the right ear), else -1. */
  private stageSide(place: PeekPlace): 1 | -1 {
    const right = rotate({ x: 1, y: 0 }, place.theta);
    const inward = dot(right, { x: place.centre.x - place.anchorHost.x, y: place.centre.y - place.anchorHost.y });
    return inward < -1 ? -1 : 1;
  }

  /**
   * The approved `alert`, on the edge (≈ 0.9 s): one ear up, eyes a little bigger, nose up, sniff
   * sniff (+ puffs). The lifted ear is a moving hold: it drifts down 41 -> 37° with one quick twitch.
   */
  private sniff(t: number, place: PeekPlace): number {
    // lift the ear on the stage side (behind a right-hand door frame the right ear is hidden)
    const side = this.stageSide(place);
    const ear = side === 1 ? this.earR : this.earL;
    const e = (r: number) => (side === 1 ? this.eR(r) : this.eL(-r));
    const tr = t + 0.92;
    ear.path(t, [
      [t + 0.22, e(-42), E.out],
      [t + 0.34, e(-41)],
      [t + 0.51, e(-39.5)],
      [t + 0.57, e(-43.5), E.out],
      [t + 0.63, e(-39.5)],
      [tr, e(-37)],
    ]);
    this.eyes.move(t + 0.05, t + 0.22, { sx: 1.08, sy: 1.08 }, E.out);
    const up = this.lookOffset('up', place, t);
    this.face.move(t + 0.1, t + 0.32, { x: up.x * 0.7, y: up.y * 0.7 }, E.face);
    this.hop.move(t + 0.1, t + 0.42, { y: -3 }, E.out);
    this.squash.move(t + 0.1, t + 0.42, { sx: 0.985, sy: 1.025 }, E.out);
    let tn = t + 0.32;
    for (let i = 0; i < 6; i++) {
      this.nose.move(tn, tn + 0.1, i % 2 === 0 ? { y: 0.4, sx: 1.1, sy: 0.82 } : { y: 0, sx: 1, sy: 1 }, E.inOut);
      tn += 0.1;
    }
    this.nose.move(tn, tn + 0.1, { y: 0, sx: 1, sy: 1 });
    for (let k = 0; k < 2; k++) this.puff(t + 0.36 + k * 0.3, side);
    ear.path(tr, [
      [tr + 0.16, e(8), E.out],
      [tr + 0.3, e(-3)],
      [tr + 0.42, e(0)],
    ]);
    this.eyes.move(tr, tr + 0.2, { sx: 1, sy: 1 });
    this.face.move(tr, tr + 0.24, { x: 0, y: 0 }, E.face);
    this.body.move(Math.max(tr, this.body.end), tr + 0.3, { r: 0 });
    this.hop.move(tr, tr + 0.3, { y: 0 }, E.spring);
    this.squash.move(tr, tr + 0.3, { sx: 1, sy: 1 }, E.spring);
    return tr + 0.42;
  }

  /** One sniff puff by the nose (same path and motion as in the `alert` scene; mirrored for side -1). */
  private puff(t: number, side: 1 | -1): void {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', side === 1 ? 'M9 -86 q3 -1.5 5 0 M10 -81 q3 -1 5.5 .5' : 'M-9 -86 q-3 -1.5 -5 0 M-10 -81 q-3 -1 -5.5 .5');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'var(--mascot-accent-dark)');
    p.setAttribute('stroke-width', '1.4');
    p.setAttribute('stroke-linecap', 'round');
    this.el.fx.appendChild(p);
    const T = this.tr(`puff${this.puffs++}`, p, { x: 0, y: 0, o: 0 });
    T.path(t, [
      [t + 0.17, { x: 2 * side, y: -1, o: 0.8 }, 'ease-out'],
      [t + 0.42, { x: 6 * side, y: -3, o: 0 }, 'ease-out'],
    ]);
  }

  /**
   * The approved `greet`, on the edge: star eyes (switched in a blink, never tiny), open mouth, ears
   * perk, a lean, and the right paw lets go of the edge, swings up in an arc to beside the cheek —
   * where the approved greet holds it, leaning with the body — and waves.
   */
  private greet(t: number, place: PeekPlace): number {
    // the eyes close and open again as full-size stars (like the end of the greeting, mirrored)
    this.eyes.move(t, t + 0.06, { sx: 1, sy: 0.1 }, E.in);
    const ts = t + 0.06;
    this.eyes.set(ts, { o: 0, sx: 1, sy: 1 });
    this.star.set(ts, { o: 1, sx: 1, sy: 0.1 });
    this.star.path(ts, [
      [ts + 0.09, { sy: 1.12 }, E.out],
      [ts + 0.17, { sy: 1 }],
    ]);
    this.mouth.set(ts, { o: 0 });
    this.mouthOpen.set(ts, { o: 1 });
    this.face.move(t, t + 0.2, { x: 0, y: -1.5 }, E.face);
    this.earL.move(t, t + 0.32, this.eL(-12), E.spring);
    this.earR.move(t, t + 0.32, this.eR(12), E.spring);
    const lean = -4;
    const tb = Math.max(t, this.body.end);
    this.body.move(tb, Math.max(tb + 0.12, t + 0.36), { r: lean }, E.inOut);

    // the right paw: off the edge in an arc (out, then up), up beside the cheek, four swings, back onto the edge
    const P = this.pawR;
    const b = this.pawBase(place, place.kR);
    const m = place.m;
    const r0 = this.gripTilt(place);
    const via = { x: b.x + place.t.x * 20 + m.x * 6, y: b.y + place.t.y * 20 + m.y * 6 };
    // (80, -86) on the bunny, turned with the body's lean around the feet: at eye level, ≈ 40 % of the
    // paw past the outline of the cheek and the ear — a light paw on the light cheek read as rubbing it.
    // Each half swing also moves it 3 units sideways (the wrist turns, the elbow swings)
    const wave = (dx: number) => rotate({ x: 80 + dx, y: -86 }, lean);
    const swungIn = wave(-3);
    const swungOut = wave(3);
    const t1 = t + 0.04;
    const t2 = t + 0.28;
    const [k, e1, e2] = splitEase(E.out, dist(b, via) / (dist(b, via) + dist(via, swungIn)));
    this.contact('R', t1, false, place);
    P.path(t1, [
      [t1 + (t2 - t1) * k, { x: via.x, y: via.y, r: r0 - 8, sx: 0.97, sy: 1.04 }, e1],
      [t2, { x: swungIn.x, y: swungIn.y, r: place.pawTilt - 20, sx: 0.92, sy: 1.1 }, e2],
    ]);
    let tw = t2;
    // the waving shakes the bunny a little (overlapping action): the ears and the lean answer each swing
    for (let i = 0; i < 4; i++) {
      const out = i % 2 === 0;
      const to = out ? swungOut : swungIn;
      P.move(tw, tw + 0.19, { x: to.x, y: to.y, r: place.pawTilt + (out ? 18 : -20) }, E.inOut);
      this.earL.move(Math.max(tw + 0.05, this.earL.end), tw + 0.24, this.eL(out ? -10 : -13.5), E.inOut);
      this.earR.move(Math.max(tw + 0.06, this.earR.end), tw + 0.25, this.eR(out ? 13.5 : 10), E.inOut);
      this.body.move(Math.max(tw + 0.04, this.body.end), tw + 0.23, { r: lean + (out ? -0.6 : 0.5) }, E.inOut);
      tw += 0.19;
    }
    const above = { x: b.x + m.x * 8, y: b.y + m.y * 8 };
    P.path(tw, [
      [tw + 0.12, { x: via.x, y: via.y, r: r0 - 6, sx: 0.97, sy: 1.04 }, 'cubic-bezier(.4,0,.6,1)'],
      [tw + 0.2, { x: above.x, y: above.y, r: r0, sx: 1, sy: 1 }, 'cubic-bezier(.3,.5,.6,1)'],
      [tw + 0.26, { x: b.x, y: b.y }, E.in],
      [tw + 0.3, { sx: 1.14, sy: 0.84 }, E.out],
      [tw + 0.38, { sx: 0.97, sy: 1.03 }],
      [tw + 0.48, { sx: 1, sy: 1 }],
    ]);
    this.contact('R', tw + 0.26, true, place);
    const te = tw + 0.1;
    this.body.move(te, te + 0.4, { r: 0 });
    this.face.move(te, te + 0.3, { x: 0, y: 0 }, E.face);
    this.earL.move(te, te + 0.42, this.eL(0), E.spring);
    this.earR.move(te, te + 0.42, this.eR(0), E.spring);
    this.mouth.set(te + 0.2, { o: 1 });
    this.mouthOpen.set(te + 0.2, { o: 0 });
    // star eyes -> normal eyes in a blink (no grey cross-fade)
    const tc = te + 0.24;
    this.star.move(tc, tc + 0.06, { sy: 0.1 }, E.in);
    this.star.set(tc + 0.06, { o: 0, sx: 1, sy: 1 });
    this.eyes.set(tc + 0.06, { o: 1, sx: 1, sy: 0.1 });
    this.eyes.move(tc + 0.06, tc + 0.15, { sx: 1, sy: 1 }, E.out);
    // the greet scene ends with a small jump: here a happy bounce of the head
    this.hop.path(te + 0.28, [
      [te + 0.42, { y: -9 }, E.out],
      [te + 0.57, { y: 0 }, E.in],
      [te + 0.65, { y: 1.2 }],
      [te + 0.75, { y: 0 }],
    ]);
    this.squash.path(te + 0.28, [
      [te + 0.42, { sx: 0.97, sy: 1.04 }],
      [te + 0.59, { sx: 1.04, sy: 0.965 }],
      [te + 0.75, { sx: 1, sy: 1 }],
    ]);
    return te + 0.78;
  }

  /**
   * "No idea" (error screens, ≈ 1.1 s): both paws come up off the edge and turn outward (palms up), the
   * head tilts, the ears flare out and the eyes look up a little; held with a tiny bob, then the paws slap
   * back onto the edge (squash, contact shadow) and everything settles.
   */
  private shrug(t: number, place: PeekPlace): number {
    const m = place.m;
    const r0 = this.gripTilt(place);
    const up = 12;
    for (const [which, T, k, side] of [
      ['L', this.pawL, place.kL, -1],
      ['R', this.pawR, place.kR, 1],
    ] as const) {
      const b = this.pawBase(place, k);
      const lifted = { x: b.x + m.x * up + place.t.x * side * 7, y: b.y + m.y * up + place.t.y * side * 7 };
      const ts = Math.max(t, T.end);
      this.contact(which, ts, false, place);
      T.path(ts, [
        [ts + 0.2, { x: lifted.x, y: lifted.y, r: r0 + side * 28, sx: 1.04, sy: 1.04 }, E.out],
        [ts + 0.62, { x: lifted.x + m.x * 2, y: lifted.y + m.y * 2, r: r0 + side * 33 }, E.inOut],
        [ts + 0.8, { x: b.x + m.x * 3, y: b.y + m.y * 3, r: r0, sx: 1, sy: 1 }, E.in],
        [ts + 0.86, { x: b.x, y: b.y, sx: 1.14, sy: 0.84 }, E.out],
        [ts + 0.96, { sx: 0.97, sy: 1.03 }],
        [ts + 1.06, { sx: 1, sy: 1 }],
      ]);
      this.contact(which, ts + 0.86, true, place);
    }
    const tb = Math.max(t, this.body.end);
    this.body.path(tb, [
      [tb + 0.24, { r: -6 }, E.out],
      [tb + 0.78, { r: -5 }, E.inOut],
      [tb + 1.05, { r: 0 }, E.inOut],
    ]);
    const tf = Math.max(t, this.face.end);
    this.face.path(tf, [
      [tf + 0.2, { x: -1.5, y: -1.8 }, E.face],
      [tf + 0.8, { x: -1.5, y: -1.8 }],
      [tf + 1.0, { x: 0, y: 0 }, E.face],
    ]);
    // lop ears: + on the left / − on the right = the tips flare outward
    const tl = Math.max(t, this.earL.end);
    this.earL.path(tl, [
      [tl + 0.18, this.eL(9), E.out],
      [tl + 0.7, this.eL(7)],
      [tl + 1.0, this.eL(0), E.spring],
    ]);
    const tr = Math.max(t, this.earR.end);
    this.earR.path(tr, [
      [tr + 0.2, this.eR(-9), E.out],
      [tr + 0.72, this.eR(-7)],
      [tr + 1.02, this.eR(0), E.spring],
    ]);
    const th = Math.max(t, this.hop.end);
    this.hop.path(th, [
      [th + 0.22, { y: -3 }, E.out],
      [th + 0.42, { y: -1.5 }],
      [th + 0.6, { y: -3 }],
      [th + 0.9, { y: 0 }, E.in],
    ]);
    if (this.eyes.end < t + 0.4) this.blink(t + 0.45);
    return t + 1.12;
  }

  /**
   * Nods off on the edge (the legal pages, ≈ 2.3 s): a big yawn (mouth wide, eyes squeezed, ears stretch),
   * then the eyes close, the head droops to one side and sinks a little, the ears relax. Its calm hold
   * (idle) then sleeps: deep breathing, a slow nod and a floating "z" — no blinking.
   */
  private doze(t: number, place: PeekPlace): number {
    void place;
    const ty = Math.max(t, this.eyes.end, this.mouth.end, this.mouthOpen.end);
    // the yawn
    this.mouth.set(ty + 0.05, { o: 0 });
    this.mouthOpen.path(ty, [
      [ty + 0.06, { o: 1, sx: 1, sy: 1 }],
      [ty + 0.42, { sx: 2.1, sy: 2.6 }, E.out],
      [ty + 0.95, { sx: 2, sy: 2.4 }],
      [ty + 1.15, { sx: 1, sy: 1 }, E.in],
      [ty + 1.2, { o: 0 }],
    ]);
    this.mouth.set(ty + 1.2, { o: 1 });
    this.eyes.path(ty, [
      [ty + 0.3, { sx: 1, sy: 0.25 }, E.out],
      [ty + 1.05, { sx: 1, sy: 0.3 }],
      [ty + 1.25, { sx: 1, sy: 0.6 }],
      [ty + 1.42, { sx: 1, sy: 0.12 }, E.in],
    ]);
    // closed: the sleeping arcs instead of the eyes
    this.eyes.set(ty + 1.45, { o: 0 });
    this.sleepEyes.set(ty + 1.45, { o: 1 });
    const tf = Math.max(ty, this.face.end);
    this.face.path(tf, [
      [tf + 0.35, { x: 0, y: -1.8 }, E.face],
      [tf + 1.1, { x: 0, y: -1.5 }],
      [tf + 1.9, { x: 0, y: 1 }, E.inOut],
    ]);
    const tl = Math.max(ty, this.earL.end);
    this.earL.path(tl, [
      [tl + 0.4, this.eL(-6), E.out],
      [tl + 1.1, this.eL(-4)],
      [tl + 2.0, this.eL(7), E.inOut],
    ]);
    const tr = Math.max(ty, this.earR.end);
    this.earR.path(tr, [
      [tr + 0.42, this.eR(6), E.out],
      [tr + 1.12, this.eR(4)],
      [tr + 2.04, this.eR(-7), E.inOut],
    ]);
    // the head droops to one side and sinks a little as it falls asleep
    const tb = Math.max(ty + 1.3, this.body.end);
    this.body.move(tb, tb + 0.9, { r: 5 }, E.inOut);
    const th = Math.max(ty + 1.3, this.hop.end);
    this.hop.move(th, th + 0.9, { y: 2.5 }, E.inOut);
    this.dozing = true;
    return Math.max(ty + 2.3, tb + 0.92);
  }

  /**
   * "Shmyg": a tiny wind-up (up a little, eyes wide, ears perk), then the HEAD drops at once
   * (moving from the first frame) and the paws let go a moment after it — up over the edge's
   * overhang, then down behind it, gone 20–40 ms after the eyes; the ears lag and go last. ≈ 0.3 s.
   */
  private duck(t: number, place: PeekPlace): number {
    this.hop.path(t, [
      [t + 0.08, { y: -4 }, E.out],
      [t + 0.22, { y: 0 }, E.in],
    ]);
    this.eyes.path(t, [
      [t + 0.08, { sx: 1.12, sy: 1.12 }, E.out],
      [t + 0.3, { sx: 1, sy: 1 }],
    ]);
    this.earL.path(t, [
      [t + 0.08, this.eL(-6), E.out],
      [t + 0.22, this.eL(12), E.out],
      [t + 0.42, this.eL(0)],
    ]);
    this.earR.path(t, [
      [t + 0.09, this.eR(6), E.out],
      [t + 0.23, this.eR(-12), E.out],
      [t + 0.43, this.eR(0)],
    ]);
    this.lift.move(t + 0.08, t + 0.28, this.liftAt(place, place.hideDist + 10), E.drop);
    this.squash.path(t + 0.08, [
      [t + 0.2, { sx: 0.96, sy: 1.05 }],
      [t + 0.4, { sx: 1, sy: 1 }],
    ]);
    const m = place.m;
    for (const [which, T, k, ts] of [
      ['L', this.pawL, place.kL, t + 0.12],
      ['R', this.pawR, place.kR, t + 0.15],
    ] as const) {
      const b = this.pawBase(place, k);
      this.contact(which, ts, false, place);
      this.pawOver(which, ts + 0.05, false, place);
      T.path(ts, [
        [ts + 0.05, { x: b.x + m.x * 9, y: b.y + m.y * 9, sx: 0.96, sy: 1.04 }, E.out],
        [ts + 0.15, this.pawHidden(place, k), E.in],
      ]);
    }
    // hidden by now (the head is gone at ≈ 0.27): reset the face and the lean for the next peek
    const tf = Math.max(t + 0.32, this.face.end);
    this.face.move(tf, tf + 0.04, { x: 0, y: 0 });
    const tb = Math.max(t + 0.32, this.body.end);
    this.body.move(tb, tb + 0.04, { r: 0 });
    return Math.max(t + 0.44, tf + 0.04, tb + 0.04);
  }

  /**
   * Calm hold after the show — gentle idle life, loops only (no timers; paused with the stage when the page
   * is hidden or the stage is off-screen): breathing (3.6 s, like the mascot), irregular blinks, an ear
   * twitch now and then and a nose wiggle. A bunny that nodded off (doze) sleeps instead: deeper breathing,
   * a slow nod and a floating "z", eyes closed.
   */
  idle(from: number): void {
    if (this.dozing) {
      this.sleepIdle(from);
      return;
    }
    this.loops.push(
      new LoopTrack(this.head.calm, `${this.name}.breathe`, from, 3.6, [
        [0, { sx: 1, sy: 1 }, E.inOut],
        [0.5, { sx: 0.994, sy: 1.018 }, E.inOut],
        [1, { sx: 1, sy: 1 }],
      ]),
    );
    // an ear twitch every 9.1 s (the far ear behind a door frame never shows: the near one twitches)
    const ear = this.el.earR;
    const rest = this.bR;
    this.loops.push(
      new LoopTrack(ear, `${this.name}.earTwitch`, from, 9.1, [
        [0, { r: rest }],
        [0.55, { r: rest }, 'ease-out'],
        [0.57, { r: rest + 9 }, 'ease-out'],
        [0.6, { r: rest - 3 }, 'ease-in-out'],
        [0.635, { r: rest }],
        [1, { r: rest }],
      ]),
    );
    // a nose wiggle every 6.3 s: three quick twitches (the approved `sniffle`)
    const twitch = { y: 0.4, sx: 1.1, sy: 0.82 };
    const calm = { y: 0, sx: 1, sy: 1 };
    this.loops.push(
      new LoopTrack(this.el.nose, `${this.name}.noseWiggle`, from, 6.3, [
        [0, calm],
        [0.4, calm, 'ease-in-out'],
        [0.415, twitch, 'ease-in-out'],
        [0.43, calm, 'ease-in-out'],
        [0.445, twitch, 'ease-in-out'],
        [0.46, calm, 'ease-in-out'],
        [0.475, twitch, 'ease-in-out'],
        [0.49, calm],
        [1, calm],
      ]),
    );
    const P = 7.4;
    const at = (s: number) => s / P;
    const open = { sx: 1, sy: 1 };
    const shut = { sx: 1, sy: 0.12 };
    const points: ReadonlyArray<readonly [number, ChannelInput, string?]> = [
      [0, open],
      [at(2.4), open, 'ease-in'],
      [at(2.46), shut, 'ease-out'],
      [at(2.55), open],
      [at(6.1), open, 'ease-in'],
      [at(6.16), shut, 'ease-out'],
      [at(6.25), open],
      [at(6.34), open, 'ease-in'],
      [at(6.4), shut, 'ease-out'],
      [at(6.49), open],
      [1, open],
    ];
    this.el.eye.forEach((e, i) => this.loops.push(new LoopTrack(e, `${this.name}.blink${i}`, from, P, points)));
  }

  /** Asleep on the edge: deep breathing (the approved `breathe-deep`), a slow nod, a "z" floating up. */
  private sleepIdle(from: number): void {
    this.loops.push(
      new LoopTrack(this.head.calm, `${this.name}.breathe`, from, 3.4, [
        [0, { sx: 1.012, sy: 0.985 }, E.inOut],
        [0.5, { sx: 1.02, sy: 1.012 }, E.inOut],
        [1, { sx: 1.012, sy: 0.985 }],
      ]),
    );
    this.loops.push(
      new LoopTrack(this.el.body, `${this.name}.nod`, from, 6.8, [
        [0, { r: 5 }, E.inOut],
        [0.5, { r: 6.5 }, E.inOut],
        [1, { r: 5 }],
      ]),
    );
    const z = document.createElementNS(SVG_NS, 'path');
    z.setAttribute('d', 'M30 -152h8l-8 9h8');
    z.setAttribute('fill', 'none');
    z.setAttribute('stroke', 'var(--mascot-accent-dark)');
    z.setAttribute('stroke-width', '2.4');
    z.setAttribute('stroke-linecap', 'round');
    z.setAttribute('stroke-linejoin', 'round');
    z.style.transformBox = 'fill-box';
    z.style.transformOrigin = 'center';
    z.style.opacity = '0';
    this.el.fx.appendChild(z);
    this.loops.push(
      new LoopTrack(z, `${this.name}.z`, from, 2.8, [
        [0, { x: 0, y: 0, s: 0.7, o: 0 }, 'ease-out'],
        [0.18, { x: 2, y: -4, s: 0.85, o: 0.9 }, 'ease-out'],
        [0.8, { x: 10, y: -24, s: 1.15, o: 0 }],
        [1, { x: 10, y: -24, s: 1.15, o: 0 }],
      ]),
    );
  }

  /** Loop mode: the staying bunny (settled at `from`) breathes once, blinks, then ducks away so the restart is seamless. */
  farewell(from: number, t: number, place: PeekPlace): number {
    const duckAt = t + 1.2;
    if (duckAt - from > 1) {
      this.loops.push(
        new LoopTrack(
          this.head.calm,
          `${this.name}.breathe`,
          from,
          duckAt - from,
          [
            [0, { sx: 1, sy: 1 }, E.inOut],
            [0.5, { sx: 0.994, sy: 1.018 }, E.inOut],
            [1, { sx: 1, sy: 1 }],
          ],
          1,
        ),
      );
    }
    this.blink(t);
    return this.duck(duckAt, place);
  }
}

// ---------- Runner ----------

export interface RunPlan {
  at: number;
  dir: 1 | -1;
  /** host px of the feet: start, optional stop, end */
  x0: number;
  xp: number | null;
  x1: number;
  ground: number;
  speed: number;
}

/** One hop: start (s), duration (s), take-off x (host px of the feet), how far (px), how high (bunny units). */
export interface Hop {
  t: number;
  d: number;
  x: number;
  dx: number;
  h: number;
}

export interface RunSchedule {
  hops: Hop[];
  /** the short stop, if any */
  sit: { t: number; d: number } | null;
  /** off-stage again (s) */
  end: number;
}

/** [share of the distance, duration s, height factor]. */
type HopSpec = readonly [number, number, number?];
/** Coming in it slows down (the 2nd hop shorter and lower: steering before it sits)… */
const ENTER: readonly HopSpec[] = [
  [1.15, 0.46],
  [0.85, 0.4, 0.6],
];
/**
 * … going out it speeds up (≈ 200 -> 520 px/s on a phone): out of the frame before the main bunny's
 * ears show. The first hop is a short start, so it lands well clear of a bunny at the right edge.
 */
const LEAVE: readonly HopSpec[] = [
  [0.65, 0.34],
  [1.1, 0.31],
  [1.4, 0.28],
];
/** No stop: a little faster with every hop. */
const ACROSS: readonly HopSpec[] = [
  [0.9, 0.44],
  [1, 0.4],
  [1.05, 0.38],
  [1.1, 0.36],
];
const SIT = 0.5;

/** The hops of one crossing (the stage also uses it to know where the runner is, for 'at:N' glances). */
export function runSchedule(plan: RunPlan, u: number): RunSchedule {
  const hops: Hop[] = [];
  const speed = plan.speed > 0 ? plan.speed : 1;
  let t = plan.at;
  let x = plan.x0;
  const seg = (to: number, specs: readonly HopSpec[]): void => {
    const total = specs.reduce((a, s) => a + s[0], 0);
    const D = to - x;
    for (const [w, dur, k = 1] of specs) {
      const d = dur / speed;
      const dx = (D * w) / total;
      // a real hop, not a glide: about a third as high as it is long (the approved walk is ~1.3 : 1), 24–44 units
      const h = Math.max(24, Math.min(44, (0.3 * Math.abs(dx)) / u)) * k;
      hops.push({ t, d, x, dx, h });
      t += d;
      x += dx;
    }
  };
  let sit: RunSchedule['sit'] = null;
  if (plan.xp !== null) {
    seg(plan.xp, ENTER);
    sit = { t, d: SIT };
    t += SIT;
    seg(plan.x1, LEAVE);
  } else seg(plan.x1, ACROSS);
  return { hops, sit, end: t };
}

export class Runner extends ActorBase {
  readonly kind = 'run' as const;
  private readonly m: Mounted;
  private readonly el: {
    hop: SVGGElement;
    squash: SVGGElement;
    footL: SVGGElement;
    footR: SVGGElement;
    earL: SVGGElement;
    earR: SVGGElement;
    tail: SVGGElement;
    shadow: SVGElement;
    eyes: SVGGElement;
    nose: SVGGElement;
    face: SVGGElement;
  };
  private readonly box: FrameBox;

  constructor(name: string, coat: BunnyCoat, u: number, layer: HTMLElement, first: RunPlan) {
    super(name, coat, u);
    this.box = frameBox(u);
    this.m = mountBunny(layer, this.box, 'run');
    const { q } = this.m;
    const hm = q('.hm');
    applyCoat(this.m.host, hm, coat);
    // the approved 3/4 turn, as a static pose (BUNNY_CSS .turn-r / .turn-l)
    hm.classList.add(first.dir === 1 ? 'turn-r' : 'turn-l');
    this.el = {
      hop: q('.hop'),
      squash: q('.squash'),
      footL: q('.foot-l'),
      footR: q('.foot-r'),
      earL: q('.lop .ear-l'),
      earR: q('.lop .ear-r'),
      tail: q(first.dir === 1 ? '.tail-l' : '.tail-r'),
      shadow: q<SVGElement>('.shadow'),
      eyes: q('.eyes'),
      nose: q('.nose'),
      face: q('.face'),
    };
    this.tr('frame', this.m.frame, { x: first.x0 - this.box.ox, y: first.ground - this.box.oy });
    this.tr('travel', this.m.lift, { x: 0 });
  }

  get frames(): readonly HTMLElement[] {
    return [this.m.frame];
  }

  remove(): void {
    this.m.frame.remove();
  }

  private get travel() {
    return this.tr('travel', this.m.lift, { x: 0 });
  }

  /** Authors one crossing; returns when the bunny is off-stage again. */
  run(plan: RunPlan): number {
    const frame = this.tr('frame', this.m.frame, {});
    frame.set(plan.at, { x: plan.x0 - this.box.ox, y: plan.ground - this.box.oy });
    this.travel.set(plan.at, { x: 0 });
    this.tr('squash', this.el.squash, { sx: 1, sy: 1 }).set(plan.at, { sx: 1.05, sy: 0.95 });
    const s = runSchedule(plan, this.u);
    let sat = false;
    for (const hp of s.hops) {
      // tracks are authored in time order: the stop comes between the hops in and the hops out
      if (s.sit && !sat && hp.t >= s.sit.t - 1e-9) {
        this.sit(s.sit.t, s.sit.d, plan.dir);
        sat = true;
      }
      this.hopOnce(hp, plan.x0, plan.dir);
    }
    if (s.sit && !sat) this.sit(s.sit.t, s.sit.d, plan.dir);
    return s.end;
  }

  /** One hop of the approved walk cycle (bunnyhop 0 -> 32 % up -> 70 % down), scaled to its length. */
  private hopOnce(hp: Hop, x0: number, dir: 1 | -1): void {
    const { t, d, dx, h } = hp;
    const x = hp.x - x0;
    // push off, fly at an even speed, and the landing sticks: the feet do not slide on (≤ 2 % of the
    // hop after touch-down) — the squash takes the momentum
    this.travel.path(t, [
      [t + 0.1 * d, { x: x + 0.06 * dx }, 'cubic-bezier(.5,0,1,1)'],
      [t + 0.7 * d, { x: x + 0.98 * dx }, 'linear'],
      [t + d, { x: x + dx }, 'cubic-bezier(0,0,.2,1)'],
    ]);
    this.tr('hop', this.el.hop, { y: 0, r: 0 }).path(t, [
      [t + 0.32 * d, { y: -h, r: dir * 3 }, E.out],
      [t + 0.7 * d, { y: 0, r: 0 }, E.in],
    ]);
    gallop({
      squash: this.tr('squash', this.el.squash, {}), earL: this.tr('earL', this.el.earL, {}), earR: this.tr('earR', this.el.earR, {}),
      footL: this.tr('footL', this.el.footL, {}), footR: this.tr('footR', this.el.footR, {}), shadow: this.tr('shadow', this.el.shadow, {}),
      pawL: this.tr('pawL', this.m.q('.paw-l'), {}), pawR: this.tr('pawR', this.m.q('.paw-r'), {}), tail: this.tr('tail', this.el.tail, {}),
    }, t, d, dir);
  }

  /**
   * A short stop: "oops, seen!" — the face turns to you at once, eyes wide, and holds it with the eyes
   * open (≈ 14 frames); it blinks as the head turns back (characters blink on a head turn), flicks an
   * ear, sniffs, crouches — and off it goes, faster.
   */
  private sit(t: number, dur: number, dir: 1 | -1): void {
    const sq = this.tr('squash', this.el.squash, { sx: 1, sy: 1 });
    sq.move(t, t + 0.16, { sx: 1, sy: 1 }, E.spring);
    sq.move(t + dur - 0.14, t + dur, { sx: 1.07, sy: 0.93 }, 'ease-in');
    // the face comes back from the 3/4 turn toward you
    this.tr('face', this.el.face, { x: 0, y: 0 }).path(t + 0.04, [
      [t + 0.12, { x: -5 * dir, y: 0 }, E.face],
      [t + 0.36, { x: -5 * dir, y: 0 }],
      [t + 0.44, { x: 0, y: 0 }, E.face],
    ]);
    this.tr('earL', this.el.earL, { r: 0 }).path(t + 0.08, [
      [t + 0.16, { r: -14 }],
      [t + 0.28, { r: 4 }],
      [t + 0.38, { r: 0 }],
    ]);
    this.tr('eyes', this.el.eyes, { sx: 1, sy: 1 }).path(t + 0.04, [
      [t + 0.12, { sx: 1.08, sy: 1.08 }, E.out],
      [t + 0.36, { sx: 1.08, sy: 1.08 }],
      [t + 0.4, { sx: 1.04, sy: 0.1 }, E.in],
      [t + 0.44, { sx: 1, sy: 1 }, E.out],
    ]);
    const twitch = { y: 0.4, sx: 1.1, sy: 0.82 };
    const rest = { y: 0, sx: 1, sy: 1 };
    this.tr('nose', this.el.nose, rest).path(t + 0.2, [
      [t + 0.26, twitch],
      [t + 0.32, rest],
      [t + 0.38, twitch],
      [t + 0.44, rest],
    ]);
  }
}

export type Actor = Peeker | Runner;
