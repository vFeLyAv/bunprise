/**
 * «Живые анимации» (approved 31.10: «Всё остальное хорошо») — the puppet rig. Moved here from the gallery prototype
 * (demo/alive/rig.ts re-exports it and adds the archived flop's lying drawing through `lying`).
 *
 * The puppet is the app's OWN Bunny / Hamster (src/bunny.ts, src/hamster.ts), Pompon with the fluffy cheeks the app
 * gives him (setBunnyFur({ fawn: ['cheeks'] }), as apps/web/src/features/mascot-ui/pompon.ts does). Nothing in src/
 * changes: the rig ADDS a few things to the puppet's own shadow root (like src/buddy/rig.ts does) — either to its own
 * puppet (`mountAlive`: the gallery, tests) or to a puppet a host already shows (`dressAlive`: the app's Start corner,
 * the Lists buddy, …):
 *
 *   .al-floor  a still wrapper around everything above the floor, clipped at the floor line: a body that presses
 *              down (the stretch's chest) flattens on the floor instead of going under it
 *   .al-roll   a wrapper around `.hop` that turns about the body's middle (the gallery's archived flop / slump)
 *   .al-legs   (Tapsi only) two haunches behind his body, for his "post"
 *   .al-rear / .al-hip-*  (bunny) rounded bits of the body hidden behind it: the rear slides back when he stretches
 *              (the body gets LONGER — never squashed), the hips spread a little in the loaf. Each is drawn twice: once
 *              behind the body (its outline = the new silhouette) and once over it, clipped to outside the body (it
 *              covers the body's own outline there, so no seam line shows)
 *   .al-pawclip  (bunny) the front paws clipped to the body outline, only in the loaf: tucked under, they slide below
 *              the body's edge and are hidden by it (nothing fades)
 *   .al-lid-*  upper eyelids, clipped to each eye: half-closed, content eyes (the loaf)
 *   .al-tongue a tiny tongue (grooming)
 *   .al-puff-* the sneeze rays around the nose
 *   .al-dust-* dust puffs on the floor (digging)
 *
 * While a moment runs, the class `al` on `.hm` switches the puppet's own CSS loops and transitions off and the
 * moment's timeline (src/timeline.ts Tracks → Web Animations, transform / opacity only) moves the parts. After it,
 * every inline style goes and the puppet's own idle life (blink, glance, ear sway) goes on. At rest every added part
 * is hidden or still: the puppet renders exactly as before.
 */

// the puppets by file, not the package index (the index registers <bunprise-mascot> and is the app's lazy mascot
// chunk — the same reason as src/buddy/buddy.ts and src/night/rig.ts)
import { Bunny } from '../bunny';
import { Hamster } from '../hamster';
import { BODY } from '../shapes';
import type { Channels } from '../timeline';

export type AliveKind = 'bunny' | 'hamster';

export const DUST_N = 6;
export const PUFF_N = 4;
export type DustName = `dust${0 | 1 | 2 | 3 | 4 | 5}`;
export type PuffName = `puff${0 | 1 | 2 | 3}`;

/** Every part a moment may move (`lf*`: the gallery's archived lying drawing, only when a rig was given `lying`). */
export type PartName =
  | 'roll' | 'hop' | 'body' | 'squash'
  | 'footL' | 'footR' | 'tfootL' | 'tfootR'
  | 'earL' | 'earR' | 'teL' | 'teR' | 'tip'
  | 'tf' | 'tp' | 'tcL' | 'tcR' | 'tailL'
  | 'face' | 'eyesG' | 'eyeL' | 'eyeR' | 'happy' | 'lidL' | 'lidR'
  | 'nose' | 'mouth' | 'yawn' | 'tongue'
  | 'pawL' | 'pawR' | 'lineL' | 'lineR' | 'cheekL' | 'cheekR' | 'shadow'
  | 'rear' | 'hipL' | 'hipR'
  | 'lf' | 'lfBody' | 'lfHead' | 'lfFeet' | 'lfFootU' | 'lfEarU' | 'lfEarD' | 'lfPaws'
  | DustName | PuffName;

export type Pose = Partial<Record<PartName, Channels>>;

/** Round-2 helpers a moment can switch on for its run (rig.setExtras). */
export type Extra = 'floor' | 'rear' | 'hips' | 'lf' | 'pawClip';

const DUSTS = Array.from({ length: DUST_N }, (_, i) => `dust${i}` as DustName);
const PUFFS = Array.from({ length: PUFF_N }, (_, i) => `puff${i}` as PuffName);
export const DUST_NAMES: readonly DustName[] = DUSTS;
export const PUFF_NAMES: readonly PuffName[] = PUFFS;

/** The neutral value of every part = the puppet sitting at rest (and the channels each part's track writes). */
export const NEUTRAL: Readonly<Record<PartName, Channels>> = {
  roll: { x: 0, y: 0, r: 0, o: 1 },
  hop: { x: 0, y: 0 },
  body: { x: 0, y: 0, r: 0 },
  squash: { sx: 1, sy: 1 },
  footL: { x: 0, y: 0, r: 0, sx: 1, sy: 1 },
  footR: { x: 0, y: 0, r: 0, sx: 1, sy: 1 },
  tfootL: { x: 0, sx: 1, sy: 1 },
  tfootR: { x: 0, sx: 1, sy: 1 },
  earL: { r: 0 },
  earR: { r: 0 },
  teL: { x: 0, y: 0, sx: 1, sy: 1 },
  teR: { x: 0, y: 0, sx: 1, sy: 1 },
  tip: { r: 0 },
  tf: { x: 0, r: 0, sx: 1, sy: 1 },
  tp: { x: 0, y: 0 },
  tcL: { sx: 1, sy: 1 },
  tcR: { sx: 1, sy: 1 },
  tailL: { x: 0, o: 0 },
  face: { x: 0, y: 0 },
  eyesG: { o: 1 },
  eyeL: { sx: 1, sy: 1 },
  eyeR: { sx: 1, sy: 1 },
  happy: { o: 0 },
  lidL: { y: 0 },
  lidR: { y: 0 },
  nose: { sx: 1, sy: 1 },
  mouth: { o: 1 },
  yawn: { o: 0, sx: 1, sy: 1 },
  tongue: { o: 0, sy: 1 },
  pawL: { x: 0, y: 0, r: 0, sx: 1, sy: 1 },
  pawR: { x: 0, y: 0, r: 0, sx: 1, sy: 1 },
  lineL: { o: 0 },
  lineR: { o: 0 },
  cheekL: { sx: 1, sy: 1 },
  cheekR: { sx: 1, sy: 1 },
  shadow: { x: 0, sx: 1, sy: 1 },
  rear: { x: 0, y: 0 },
  hipL: { x: 0, y: 0 },
  hipR: { x: 0, y: 0 },
  lf: { x: 0, y: 0, r: 0, o: 0 },
  lfBody: { sx: 1, sy: 1 },
  lfHead: { x: 0, y: 0, r: 0 },
  lfFeet: { x: 0, y: 0, r: 0 },
  lfFootU: { x: 0, y: 0 },
  lfEarU: { r: 0 },
  lfEarD: { r: 0 },
  lfPaws: { x: 0, y: 0 },
  ...(Object.fromEntries(DUSTS.map((n) => [n, { x: 0, y: 0, sx: 1, sy: 1, o: 0 }])) as Record<DustName, Channels>),
  ...(Object.fromEntries(PUFFS.map((n) => [n, { x: 0, y: 0, o: 0 }])) as Record<PuffName, Channels>),
};

/** Puppet geometry in its own units (x = 0 centre line, y = 0 feet; the right side; the left one is mirrored). */
export interface Geo {
  kind: AliveKind;
  viewH: number;
  feetY: number;
  scale: number;
  eye: { x: number; y: number; rx: number; ry: number };
  /** a front paw at rest: its centre and the bottom of its box (the paw's CSS pivot, 50% 100%) */
  paw: { x: number; y: number; pivotY: number };
  nose: { x: number; y: number };
  /** centre of the small open mouth (`.mouth-open`) */
  mouthY: number;
  /** the right lop ear: its CSS pivot (20% 4% of `.ear-r`'s box) and its lowest point (bunny) */
  ear: { px: number; py: number; tx: number; ty: number };
}

export const GEO: Readonly<Record<AliveKind, Geo>> = {
  bunny: {
    kind: 'bunny', viewH: 260, feetY: 246, scale: 1.2,
    eye: { x: 29, y: -93, rx: 6.2, ry: 7.4 }, paw: { x: 16, y: -44, pivotY: -32.8 }, nose: { x: 0, y: -82 }, mouthY: -75.8,
    ear: { px: 35, py: -161, tx: 63, ty: -83 },
  },
  hamster: {
    kind: 'hamster', viewH: 250, feetY: 236, scale: 1.25,
    eye: { x: 32, y: -96, rx: 5.8, ry: 7.2 }, paw: { x: 16, y: -46, pivotY: -34.4 }, nose: { x: 0, y: -89.5 }, mouthY: -83.4,
    ear: { px: 0, py: 0, tx: 0, ty: 0 },
  },
};

/** The body's middle: `.al-roll` turns about it (view-box origin). */
export const ROLL_ORIGIN = { x: 0, y: -75 } as const;
/** `.body` / `.squash` pivot (CSS 50% 100% of their box): the bottom of the body. */
export const BODY_ORIGIN = { x: 0, y: -1 } as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inside the puppet's shadow root. `.hm.al` = a moment runs: the puppet's own CSS motion steps aside. */
const AL_CSS = `
.al-roll { transform-box: view-box; transform-origin: ${ROLL_ORIGIN.x}px ${ROLL_ORIGIN.y}px; }
.al-legs ellipse, .al-under { stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke; paint-order: stroke fill; }
/* the round-2 helpers exist in the drawing only while a moment that needs them runs (setExtras): at rest the puppet
   renders exactly as before, pixel for pixel */
.al-rear, .al-hip, .al-overs, .al-lf { display: none; }
.hm.al-x-rear .al-rear, .hm.al-x-hips .al-hip, .hm.al-x-rear .al-overs, .hm.al-x-hips .al-overs, .hm.al-x-lf .al-lf { display: inline; }
.al-lid, .al-tongue, .al-puff, .al-dust, .al-nose { transform-box: fill-box; }
.al-tongue { opacity: 0; transform-origin: 50% 0%; }
.al-puff, .al-pawline { opacity: 0; }
.al-dust { opacity: 0; transform-origin: 50% 50%; }
.al-nose { transform-origin: 50% 0%; }
.hm.al, .hm.al * { animation: none !important; transition: none !important; }
.hm.al .wiggle { transform-origin: 50% 100%; }
`;

/** An extra drawing a rig may carry (the gallery's archived flop: Pompon lying on his side, demo/alive/lying.ts). */
export interface LyingDrawing {
  css: string;
  markup: (id: (n: string) => string) => string;
}

export interface RigOptions {
  kind: AliveKind;
  /** width in px (the app: card corner / Lists buddy 96, empty states 148–160) */
  size: number;
  /** the puppet's own idle life between moments (false: still frames) */
  idle?: boolean;
  /** reduced motion: the calm still pose (^ ^), never an animation */
  reduced?: boolean;
  /** (the gallery's archive) the lying drawing for the flop */
  lying?: LyingDrawing;
}

export interface AliveRig {
  readonly kind: AliveKind;
  readonly geo: Geo;
  readonly size: number;
  readonly reduced: boolean;
  readonly puppet: Bunny | Hamster;
  /** the positioned box (mountAlive: the caller sets left / top; dressAlive: the puppet's own host) */
  readonly box: HTMLElement;
  /** px from the box's top to the feet line */
  readonly feet: number;
  readonly height: number;
  els(name: PartName): Element[];
  has(name: PartName): boolean;
  readonly driven: boolean;
  /** a moment starts: the puppet's own motion steps aside (its idle stopped, its own sniff interrupted) */
  takeOver(): void;
  /**
   * The moment is over: every inline style goes, the puppet's own CSS goes on; its idle life again when it ran
   * before takeOver() (or as `idle` says — the host of a lent puppet decides).
   */
  release(idle?: boolean): void;
  /**
   * The helpers a moment needs, on for its run (all off again on release): 'floor' clips everything at the floor line,
   * 'rear' / 'hips' show the body's rear / hip pieces, 'lf' the lying drawing, 'pawClip' clips the front paws to the
   * body outline (the loaf: tucked under, they slide below its edge).
   */
  setExtras(list: readonly Extra[]): void;
  /** writes a pose inline (no animation) */
  apply(pose: Pose): void;
  /** mountAlive: the puppet and its box go; dressAlive: only the rig's own state (the host's puppet stays) */
  destroy(): void;
}

function svgEl(tag: string, cls: string, markup = ''): SVGElement {
  const e = document.createElementNS(SVG_NS, tag) as SVGElement;
  e.setAttribute('class', cls);
  if (markup) e.innerHTML = markup;
  return e;
}

/** CSS transform / opacity of a part's channels (the same function list as timeline.ts formatStyles). */
function styleOf(name: PartName, v: Channels): { transform?: string; opacity?: string } {
  const used = NEUTRAL[name];
  const n = (x: number | undefined, d: number) => String(Math.round((x ?? d) * 1000) / 1000);
  const parts: string[] = [];
  if ('x' in used || 'y' in used) parts.push(`translate(${n(v.x, 0)}px, ${n(v.y, 0)}px)`);
  if ('r' in used) parts.push(`rotate(${n(v.r, 0)}deg)`);
  if ('sx' in used || 'sy' in used) parts.push(`scale(${n(v.sx, 1)}, ${n(v.sy, 1)})`);
  const out: { transform?: string; opacity?: string } = {};
  if (parts.length) out.transform = parts.join(' ');
  if ('o' in used) out.opacity = n(v.o, 1);
  return out;
}

/** The sneeze rays: direction of each, around the nose (an "x" — level ones read as whiskers); they start 9 units out. */
export const PUFF_DIRS: ReadonlyArray<readonly [number, number]> = [[-0.8, -0.6], [-0.75, 0.66], [0.8, -0.6], [0.75, 0.66]];

/** Adds the rig's parts to the puppet's own shadow root (once per puppet: a second call finds them there). */
function addParts(puppet: Bunny | Hamster, geo: Geo, lying?: LyingDrawing): void {
  const root = puppet.root;
  if (root.querySelector('style[data-alive]')) return;
  const id = (n: string) => `${puppet.id}-${n}`;
  const q = (sel: string) => root.querySelector(sel);
  const style = document.createElement('style');
  style.dataset['alive'] = '';
  style.textContent = AL_CSS + (lying ? lying.css : '');
  root.append(style);

  const defs = q('defs');
  const bunny = geo.kind === 'bunny';
  // the floor clip (everything above y = 4: nothing at rest reaches it, the feet's outline included) and the "outside
  // the body" clip (a big rectangle with the body as a hole: the over-copies of the rear / hips only show beyond it)
  defs?.insertAdjacentHTML('beforeend', `<clipPath id="${id('al-floorclip')}"><rect x="-400" y="-500" width="800" height="504"/></clipPath>`
    + `<clipPath id="${id('al-outside')}"><path clip-rule="evenodd" d="M-400 -500 H400 V100 H-400 Z ${BODY}"/></clipPath>`);

  // the roll wrapper around .hop (the shadow stays on the floor, outside it), inside the still floor wrapper
  const hop = q('.hop');
  if (hop) {
    // (its floor clip is switched on only by the moments that need it: setExtras(['floor']))
    const floor = svgEl('g', 'al-floor');
    const roll = svgEl('g', 'al-roll');
    hop.before(floor);
    floor.append(roll);
    roll.append(hop);
    if (!bunny) {
      // Tapsi's haunches for his "post" (round 1, unchanged): first in .hop, behind his feet and body
      const lx = 31;
      const leg = (x: number) => `<ellipse cx="${x}" cy="-25" rx="17" ry="22" fill="url(#${id('g-body')})"/>`;
      hop.prepend(svgEl('g', 'al-legs', `${leg(-lx)}${leg(lx)}`));
    }
    if (bunny && lying) {
      // (the gallery's archived flop) Pompon lying on his side: in front of the sitting puppet, hidden until a swap
      floor.append(svgEl('g', 'al-lf', lying.markup(id)));
    }
  }

  // the rear and the hips (bunny): under-copy behind the body path (its outline is the new silhouette), over-copy
  // right after it, clipped to outside the body (covers the body's own outline where they reach out: no seam)
  const bodyPath = q('.breathe > path');
  if (bunny && bodyPath) {
    const g = `url(#${id('g-body')})`;
    const shapes: ReadonlyArray<[string, string]> = [
      // the rear (left in the 3/4 turn to the right): a round piece of the lower body, ≥ 3 units inside the outline
      ['al-rear', '<ellipse cx="-24" cy="-38" rx="47" ry="33"/>'],
      ['al-hip al-hip-l', '<ellipse cx="-50" cy="-22" rx="21" ry="18"/>'],
      ['al-hip al-hip-r', '<ellipse cx="50" cy="-22" rx="21" ry="18"/>'],
    ];
    const under = shapes.map(([cls, s]) => `<g class="${cls}">${s.replace('<ellipse', `<ellipse class="al-under" fill="${g}"`)}</g>`).join('');
    const over = shapes.map(([cls, s]) => `<g class="${cls}">${s.replace('<ellipse', `<ellipse fill="${g}"`)}</g>`).join('');
    bodyPath.insertAdjacentHTML('beforebegin', under);
    bodyPath.insertAdjacentHTML('afterend', `<g class="al-overs" clip-path="url(#${id('al-outside')})">${over}</g>`);
  }
  // the paw clip (bunny, loaf only): a still wrapper around .paws inside .tp — the clip itself is switched by setExtras
  const paws = q('.paws');
  if (bunny && paws) {
    const wrap = svgEl('g', 'al-pawclip');
    paws.before(wrap);
    wrap.append(paws);
  }
  const face = q('.face');
  const eyes = q('.eyes');
  if (defs && face && eyes) {
    // upper eyelids, each clipped to its eye (slightly larger than the eye: the lid's fur covers the eye's edge too)
    const { x: ex, y: ey, rx, ry } = geo.eye;
    let lids = '';
    for (const [side, cx] of [['l', -ex], ['r', ex]] as const) {
      defs.insertAdjacentHTML('beforeend', `<clipPath id="${id(`al-eye-${side}`)}"><ellipse cx="${cx}" cy="${ey}" rx="${rx + 0.5}" ry="${ry + 0.5}"/></clipPath>`);
      const edge = `M${cx - 8.5} ${ey - 11} Q${cx} ${ey - 8} ${cx + 8.5} ${ey - 11}`;
      lids += `<g clip-path="url(#${id(`al-eye-${side}`)})"><g class="al-lid al-lid-${side}"><path d="${edge} L${cx + 8.5} ${ey - 28} L${cx - 8.5} ${ey - 28} Z" fill="url(#${id('g-body')})"/><path d="${edge}" fill="none" stroke="var(--mascot-eye)" stroke-width="2.1" stroke-linecap="round"/></g></g>`;
    }
    eyes.insertAdjacentHTML('afterend', lids);
    // the tongue, just under the small open mouth
    const mouthOpen = q('.mouth-open');
    mouthOpen?.insertAdjacentHTML('afterend', `<ellipse class="al-tongue" cx="0" cy="${geo.mouthY + 1.4}" rx="2.2" ry="2.5" fill="#F39AA7"/>`);
    // the sneeze rays (in the face: they nod and hop with it)
    const { x: nx, y: ny } = geo.nose;
    face.insertAdjacentHTML('beforeend', PUFF_DIRS.map(([dx, dy], i) => {
      const k = 1 / Math.hypot(dx, dy);
      const ux = dx * k;
      const uy = dy * k;
      const f = (v: number) => String(Math.round(v * 100) / 100);
      return `<g class="al-puff al-puff-${i}"><path d="M${f(nx + ux * 9)} ${f(ny + uy * 9)} l${f(ux * 6)} ${f(uy * 6)}" fill="none" stroke="var(--mascot-accent-dark)" stroke-width="2" stroke-linecap="round"/></g>`;
    }).join(''));
  }
  // the belly's soft light reaches 5 units below the body (invisible while he sits, behind his feet); once he leans
  // over it would show as a haze beside him — keep it inside his own outline (the puppet's body clip)
  root.querySelector(`ellipse[fill="url(#${id('g-belly')})"]`)?.setAttribute('clip-path', `url(#${id('clip-body')})`);
  // the hamster's nose has no class of its own: give it one (to wiggle it)
  if (geo.kind === 'hamster') face?.querySelector('path[fill="var(--mascot-nose)"]')?.classList.add('al-nose');
  // a soft contour for each front paw, faded in only while the paws are over the face (a cream paw on a cream face
  // is invisible otherwise); the same ellipse, so the paw's box (its pivot) does not change
  for (const side of ['l', 'r'] as const) {
    const paw = q(`.paw-${side}`);
    const shape = paw?.querySelector('ellipse');
    if (!paw || !shape) continue;
    const line = shape.cloneNode(false) as SVGElement;
    line.setAttribute('class', `al-pawline al-pawline-${side}`);
    line.setAttribute('fill', 'none');
    line.setAttribute('style', 'stroke: var(--mascot-accent-dark); stroke-opacity: .6; stroke-width: 1.2px; vector-effect: non-scaling-stroke');
    paw.append(line);
  }

  // dust puffs on the floor, in front of him (in .mover, not in .hop: they stay on the floor)
  const mover = q('.mover');
  if (mover) {
    const dust = (i: number) => `<g class="al-dust al-dust-${i}" fill="var(--alive-dust, #D9BE98)"><circle cx="0" cy="-5" r="5.4"/><circle cx="6" cy="-9" r="3.5"/><circle cx="-5" cy="-10.5" r="2.7"/></g>`;
    mover.insertAdjacentHTML('beforeend', Array.from({ length: DUST_N }, (_, i) => dust(i)).join(''));
  }
}

/** The elements of every part (the puppet's own and the rig's). */
function partsOf(root: ShadowRoot, kind: AliveKind): Record<PartName, Element[]> {
  const q = (sel: string): Element[] => [...root.querySelectorAll(sel)];
  const one = (sel: string, i: number): Element[] => {
    const e = q(sel)[i];
    return e ? [e] : [];
  };
  const bunny = kind === 'bunny';
  return {
    roll: q('.al-roll'),
    hop: q('.hop'),
    body: q('.body'),
    squash: q(bunny ? '.squash' : '.wiggle'),
    footL: q('.foot-l'),
    footR: q('.foot-r'),
    tfootL: q('.tfoot-l'),
    tfootR: q('.tfoot-r'),
    earL: q(bunny ? '.lop .ear-l' : '.ear-l'),
    earR: q(bunny ? '.lop .ear-r' : '.ear-r'),
    teL: q(bunny ? '.lop .te-l' : '.te-l'),
    teR: q(bunny ? '.lop .te-r' : '.te-r'),
    tip: bunny ? [] : q('.ear-tip'),
    tf: q('.tf'),
    tp: q('.tp'),
    tcL: q('.tc-l'),
    tcR: q('.tc-r'),
    tailL: bunny ? q('.tail-l') : [],
    face: q('.face'),
    eyesG: q('.eyes'),
    eyeL: one('.eyes .eye', 0),
    eyeR: one('.eyes .eye', 1),
    happy: q('.eyes-happy'),
    lidL: q('.al-lid-l'),
    lidR: q('.al-lid-r'),
    nose: q(bunny ? '.nose' : '.al-nose'),
    mouth: q('.mouth'),
    yawn: q('.mouth-open'),
    tongue: q('.al-tongue'),
    pawL: q('.paw-l'),
    pawR: q('.paw-r'),
    lineL: q('.al-pawline-l'),
    lineR: q('.al-pawline-r'),
    cheekL: q('.cheek-l .cheek-j'),
    cheekR: q('.cheek-r .cheek-j'),
    shadow: q('.shadow'),
    rear: q('.al-rear'),
    hipL: q('.al-hip-l'),
    hipR: q('.al-hip-r'),
    lf: q('.al-lf'),
    lfBody: q('.al-lf-body'),
    lfHead: q('.al-lf-head'),
    lfFeet: q('.al-lf-feet'),
    lfFootU: q('.al-lf-footu'),
    lfEarU: q('.al-lf-earu'),
    lfEarD: q('.al-lf-eard'),
    lfPaws: q('.al-lf-paws'),
    ...Object.fromEntries(DUSTS.map((n, i) => [n, q(`.al-dust-${i}`)])),
    ...Object.fromEntries(PUFFS.map((n, i) => [n, q(`.al-puff-${i}`)])),
  } as Record<PartName, Element[]>;
}

interface RigBase {
  kind: AliveKind;
  size: number;
  reduced: boolean;
  box: HTMLElement;
  feet: number;
  height: number;
  /** destroy(): what goes with the rig (mountAlive: its puppet and box) */
  dispose: () => void;
}

function makeRig(puppet: Bunny | Hamster, base: RigBase): AliveRig {
  const geo = GEO[base.kind];
  const root = puppet.root;
  const hm = root.querySelector('.hm');
  const els = partsOf(root, base.kind);
  const bunny = base.kind === 'bunny';
  let driven = false;
  let destroyed = false;
  let idleWas = false;

  const rig: AliveRig = {
    kind: base.kind,
    geo,
    size: base.size,
    reduced: base.reduced,
    puppet,
    box: base.box,
    feet: base.feet,
    height: base.height,
    els: (name) => els[name],
    has: (name) => els[name].length > 0,
    get driven() {
      return driven;
    },
    takeOver() {
      if (driven || destroyed || puppet.isDestroyed) return;
      idleWas = puppet.idleRunning;
      // its own sniff (the bunny's idle 'alert') yields; then back to the plain rest pose
      if (puppet.busy) void puppet.interrupt();
      if (idleWas) puppet.stopIdle();
      puppet.pose('idle');
      hm?.classList.add('al');
      driven = true;
    },
    release(idle) {
      if (destroyed || !driven) return;
      for (const list of Object.values(els)) {
        for (const e of list) {
          for (const a of e.getAnimations?.() ?? []) a.cancel();
          const st = (e as HTMLElement).style;
          st.transform = '';
          st.opacity = '';
        }
      }
      rig.setExtras([]);
      hm?.classList.remove('al');
      driven = false;
      if ((idle ?? idleWas) && !puppet.isDestroyed) puppet.startIdle();
    },
    setExtras(list) {
      const on = (x: Extra) => list.includes(x);
      const clip = (sel: string, url: string, yes: boolean) => {
        const g = root.querySelector(sel);
        if (!g) return;
        if (yes) g.setAttribute('clip-path', `url(#${puppet.id}-${url})`);
        else g.removeAttribute('clip-path');
      };
      clip('.al-floor', 'al-floorclip', bunny && on('floor'));
      clip('.al-pawclip', 'clip-body', bunny && on('pawClip'));
      hm?.classList.toggle('al-x-rear', on('rear'));
      hm?.classList.toggle('al-x-hips', on('hips'));
      hm?.classList.toggle('al-x-lf', on('lf'));
    },
    apply(pose) {
      for (const [name, v] of Object.entries(pose) as [PartName, Channels][]) {
        const s = styleOf(name, { ...NEUTRAL[name], ...v });
        for (const e of els[name]) {
          const st = (e as HTMLElement).style;
          if (s.transform !== undefined) st.transform = s.transform;
          if (s.opacity !== undefined) st.opacity = s.opacity;
        }
      }
    },
    destroy() {
      if (destroyed) return;
      rig.release(false);
      destroyed = true;
      base.dispose();
    },
  };
  return rig;
}

/** Its own puppet in a positioned box (the gallery, tests). */
export function mountAlive(parent: HTMLElement, o: RigOptions): AliveRig {
  const geo = GEO[o.kind];
  const k = o.size / 400;
  const feet = geo.feetY * k;
  const height = Math.round(geo.viewH * k);
  const box = document.createElement('div');
  box.className = 'al-actor';
  box.style.cssText = `position:absolute;width:${o.size}px;height:${height}px;`;
  const host = document.createElement('div');
  host.className = 'al-host';
  host.style.cssText = 'position:absolute;inset:0;';
  box.append(host);
  parent.append(box);

  const reduced = !!o.reduced;
  const idle = (o.idle ?? true) && !reduced;
  const common = { size: o.size, idle, interactive: false, reducedMotion: reduced ? 'force' : 'off', calmEyes: 'happy' } as const;
  const puppet = o.kind === 'bunny' ? new Bunny(host, { ...common, coat: 'fawn' }) : new Hamster(host, { ...common, coat: 'golden' });
  addParts(puppet, geo, o.lying);
  return makeRig(puppet, {
    kind: o.kind, size: o.size, reduced, box, feet, height,
    dispose: () => {
      puppet.destroy();
      box.remove();
    },
  });
}

/**
 * The rig's parts on a puppet a host already shows (the app: the Start corner Pompon, the Lists buddy, …). The parts
 * stay in its shadow root (hidden and still at rest; a second dress finds them); the host keeps owning the puppet —
 * destroy() only drops the rig. `kind` is the puppet's own (a Hamster → 'hamster').
 */
export function dressAlive(puppet: Bunny | Hamster): AliveRig {
  const kind: AliveKind = puppet.kind === 'hamster' ? 'hamster' : 'bunny';
  const geo = GEO[kind];
  addParts(puppet, geo);
  const box = puppet.host;
  const size = box.getBoundingClientRect().width || 96;
  const k = size / 400;
  return makeRig(puppet, { kind, size, reduced: false, box, feet: geo.feetY * k, height: Math.round(geo.viewH * k), dispose: () => undefined });
}
