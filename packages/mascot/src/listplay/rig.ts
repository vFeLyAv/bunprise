/**
 * «Помпон в открытом списке» (approved 31.10: «Мне все анимации нравятся») — the puppet rig. Moved here from the
 * gallery prototype (demo/listplay/rig.ts re-exports it).
 *
 * Pompon is the app's OWN Bunny (src/bunny.ts: the approved shapes, the fawn coat, lop ears, the fluffy cheeks of
 * src/fur.ts — the host switches them on: the gallery page itself, the app apps/web/src/features/mascot-ui/pompon.ts)
 * at the app's size (96 px). Nothing else in src/ changes. What this rig adds at runtime, into the puppet's own shadow
 * root (the way src/buddy/rig.ts does it):
 *   - one <style>: while `.hm.lp` (a moment runs) the puppet's own CSS loops and transitions step aside;
 *   - a few small parts: two hearts, three "purr" strokes at the cheek (soft teeth chatter), the breath of a sigh,
 *     three dust puffs (dusting off the paws), worried brows (selection mode), the dizzy spirals and stars, the "ай"
 *     squint (an ear is pulled).
 * Around the puppet, three HTML wrappers: `box` (where he is: travel, composited), `lean` (follows a stroking finger,
 * a CSS transition on transform), `duck` (placement B: slips behind the tab bar while cards pass under him).
 *
 * `dressPompon(puppet)` adds the parts to ANY Pompon puppet the host already has (the app: an ear pull and the dizzy
 * shake on every Pompon — the Start corner, the Lists buddy, the new-wish peek …); `mountPompon` builds his own one.
 */

// the puppet by file, not the package index (the index registers <bunprise-mascot> and is the app's lazy mascot
// chunk — the same reason as src/buddy/buddy.ts and src/night/rig.ts)
import { Bunny } from '../bunny';
import type { Channels } from '../timeline';

/** Pompon in the app (Lists buddy, Start corner, the "+" menu, the list header): 96 px wide. */
export const SIZE = 96;
const VIEW_H = 260;
const FEET_Y = 246;
const SCALE = 1.2;
/** px of the host box per puppet unit (x = 0 centre line, y = 0 feet) at `size` px. */
export const unitOf = (size: number): number => (size / 400) * SCALE;
/** px of the host box per puppet unit (x = 0 centre line, y = 0 feet). */
export const UNIT = unitOf(SIZE);
/** the feet point inside the host box (px) */
export const FEET = { x: SIZE / 2, y: (FEET_Y * SIZE) / 400 } as const;
export const BOX_H = Math.round((VIEW_H * SIZE) / 400);
/** the feet point inside a puppet's host box of `size` px (any Pompon) */
export const feetIn = (size: number): { x: number; y: number } => ({ x: size / 2, y: (FEET_Y * size) / 400 });
/** his body as a tap target, around the feet point (px): ≥ 44 × 44 (the visible bunny is ≈ 48 × 50). */
export const HIT = { left: -26, top: -54, width: 52, height: 58 } as const;

export type PartName =
  | 'box'
  | 'hop' | 'body' | 'squash' | 'earL' | 'earR' | 'face'
  | 'eyesG' | 'eyeL' | 'eyeR' | 'happy' | 'star' | 'spiral' | 'spinL' | 'spinR' | 'squint' | 'brows'
  | 'nose' | 'mouth' | 'mouthO' | 'blush' | 'cheekL' | 'cheekR'
  | 'paws' | 'pawL' | 'pawR' | 'footL' | 'footR' | 'shadow'
  | 'tf' | 'tp' | 'teL' | 'teR' | 'tcL' | 'tcR' | 'tfootL' | 'tfootR' | 'tailL' | 'tailR'
  | 'heart1' | 'heart2' | 'purr1' | 'purr2' | 'purr3' | 'breath' | 'dust1' | 'dust2' | 'dust3'
  | 'star1' | 'star2' | 'star3';

export type Pose = Partial<Record<PartName, Channels>>;

/** Every part at rest (and the channels each part uses). */
export const NEUTRAL: Readonly<Record<PartName, Channels>> = {
  box: { x: 0, y: 0 },
  hop: { y: 0 },
  body: { r: 0 },
  squash: { r: 0, sx: 1, sy: 1 },
  // the ear turns and stretches a little as a whole (pulling it): never a new shape
  earL: { r: 0, sx: 1, sy: 1 },
  earR: { r: 0, sx: 1, sy: 1 },
  // (sx / sy only to keep the face's shape while the body squashes: scaled about the eye line, see RIG_CSS)
  face: { x: 0, y: 0, sx: 1, sy: 1 },
  eyesG: { o: 1 },
  eyeL: { sx: 1, sy: 1 },
  eyeR: { sx: 1, sy: 1 },
  happy: { o: 0 },
  star: { o: 0 },
  spiral: { o: 0 },
  spinL: { r: 0 },
  spinR: { r: 0 },
  squint: { o: 0 },
  brows: { o: 0 },
  nose: { sx: 1, sy: 1 },
  mouth: { o: 1 },
  mouthO: { o: 0, sx: 1, sy: 1 },
  blush: { o: 0.3 },
  cheekL: { sx: 1, sy: 1 },
  cheekR: { sx: 1, sy: 1 },
  paws: { y: 0, sx: 1, sy: 1 },
  pawL: { x: 0, y: 0, r: 0 },
  pawR: { x: 0, y: 0, r: 0 },
  footL: { x: 0, y: 0, r: 0, sx: 1, sy: 1 },
  footR: { x: 0, y: 0, r: 0, sx: 1, sy: 1 },
  shadow: { sx: 1, sy: 1, o: 1 },
  tf: { x: 0, sx: 1 },
  tp: { x: 0 },
  teL: { x: 0, sx: 1, sy: 1 },
  teR: { x: 0, sx: 1, sy: 1 },
  tcL: { sx: 1, sy: 1 },
  tcR: { sx: 1, sy: 1 },
  tfootL: { x: 0, sx: 1, sy: 1 },
  tfootR: { x: 0, sx: 1, sy: 1 },
  tailL: { o: 0 },
  tailR: { o: 0 },
  heart1: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  heart2: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  purr1: { x: 0, o: 0 },
  purr2: { x: 0, o: 0 },
  purr3: { x: 0, o: 0 },
  breath: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  dust1: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  dust2: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  dust3: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  star1: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  star2: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
  star3: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
};

/** Where the ears hang from (puppet units): the pivot of the lop ears (BUNNY_CSS `.ears-lop .ear-l` 80 % 4 % of its box). */
export const EAR_PIVOT = { x: 35.4, y: -166.4 } as const;
/** The lop ear's tip at rest (puppet units, right ear; the left one is mirrored). */
export const EAR_TIP = { x: 66, y: -86 } as const;

/**
 * Is a press `dx`, `dy` px from his feet point on an ear tip? The lop ears hang beside the head: 14–24 px from his
 * middle, 27–50 px above his feet at 96 px (scaled with `unit` for other sizes). Returns the ear, or null.
 */
export function earTipAt(dx: number, dy: number, unit: number = UNIT): 'l' | 'r' | null {
  const k = unit / UNIT;
  if (Math.abs(dx) < 14 * k || Math.abs(dx) > 30 * k || dy > -27 * k || dy < -50 * k) return null;
  return dx > 0 ? 'r' : 'l';
}

/** The approved 3/4 turn of the puppet (BUNNY_CSS `.turn-r` / `.turn-l`), as values of the turn parts. */
export function turnPose(dir: -1 | 0 | 1): Pose {
  if (dir === 0) {
    return { tf: { x: 0, sx: 1 }, tp: { x: 0 }, teL: { x: 0, sx: 1, sy: 1 }, teR: { x: 0, sx: 1, sy: 1 }, tcL: { sx: 1, sy: 1 }, tcR: { sx: 1, sy: 1 }, tfootL: { x: 0, sx: 1, sy: 1 }, tfootR: { x: 0, sx: 1, sy: 1 }, tailL: { o: 0 }, tailR: { o: 0 } };
  }
  const r = dir === 1;
  return {
    tf: { x: 13 * dir, sx: 0.88 },
    tp: { x: 9 * dir },
    teL: r ? { x: 16, sx: 0.86, sy: 0.86 } : { x: -8, sx: 1, sy: 1 },
    teR: r ? { x: 8, sx: 1, sy: 1 } : { x: -16, sx: 0.86, sy: 0.86 },
    tcL: r ? { sx: 0.55, sy: 0.55 } : { sx: 1.04, sy: 1.04 },
    tcR: r ? { sx: 1.04, sy: 1.04 } : { sx: 0.55, sy: 0.55 },
    tfootL: r ? { x: 12, sx: 0.9, sy: 0.9 } : { x: -5, sx: 1, sy: 1 },
    tfootR: r ? { x: 5, sx: 1, sy: 1 } : { x: -12, sx: 0.9, sy: 0.9 },
    tailL: { o: r ? 1 : 0 },
    tailR: { o: r ? 0 : 1 },
  };
}

const heart = `<path d="M0 6 C-8.5 0.6 -6.8 -8 0 -3.2 C6.8 -8 8.5 0.6 0 6 Z" fill="#F2667E"/><circle cx="-3" cy="-3.1" r="1.3" fill="#fff" opacity=".85"/>`;
/** the buddy's dizzy spiral (src/buddy/rig.ts), centred on the eye */
const spiral = (x: number, y: number) =>
  `<path d="M${x} ${y} m-5.5 0 a5.5 5.5 0 1 1 11 0 a4.4 4.4 0 1 1 -8.8 0 a3.2 3.2 0 1 1 6.4 0 a2 2 0 1 1 -4 0" fill="none" stroke="var(--mascot-eye)" stroke-width="2.2" stroke-linecap="round"/>`;
/** the buddy's little dizzy star (src/buddy/buddy.ts STAR), in puppet units */
const STAR = '<path d="M0 -9 L2.2 -2.2 L9 0 L2.2 2.2 L0 9 L-2.2 2.2 L-9 0 L-2.2 -2.2 Z" fill="#FFC94D"/>';

const RIG_CSS = `
/* ---- «Помпон в списке» (@bunprise/mascot/listplay) ---- */
.hm.lp, .hm.lp * { animation: none !important; transition: none !important; }
.lp-heart, .lp-purr, .lp-breath, .lp-dust, .lp-brows, .lp-dizzy, .lp-squint, .lp-dstar { opacity: 0; }
.lp-heart, .lp-breath, .lp-dust, .lp-spin, .lp-dstar { transform-box: fill-box; transform-origin: 50% 50%; }
/* the face is scaled (only to undo the body's squash) about the eye line, in puppet units */
.hm.lp .face { transform-origin: 0px -90px; }
.lp-squint { fill: none; stroke: var(--mascot-eye); stroke-width: 2.8; stroke-linecap: round; stroke-linejoin: round; }
.lp-purr path { fill: none; stroke: var(--mascot-accent-dark); stroke-width: 4; stroke-linecap: round; }
.lp-breath path { fill: none; stroke: var(--mascot-accent-dark); stroke-width: 3.6; stroke-linecap: round; opacity: .7; }
.lp-dust { fill: var(--lp-dust, #E8D5BC); }
.lp-brows { fill: none; stroke: var(--mascot-eye); stroke-width: 2.5; stroke-linecap: round; }
`;

/** What a moment needs from a puppet: its parts (the timelines move them). */
export interface PomponParts {
  els(name: PartName): Element[];
}

/** A Pompon puppet with the rig's parts added: a moment can take it over and give it back. */
export interface Dress extends PomponParts {
  readonly puppet: Bunny;
  /** a moment takes the puppet: its own idle and CSS motion step aside */
  takeOver(): void;
  /** the moment is over: every inline style goes, the puppet's own life goes on (a held pose can stay inline) */
  release(keep?: Pose, idle?: boolean): void;
  readonly driven: boolean;
  /** writes a pose inline (no animation) */
  apply(pose: Pose): void;
  /** takes the added parts out of the puppet again (the puppet itself stays) */
  undress(): void;
}

export interface Rig extends PomponParts {
  readonly puppet: Bunny;
  /** the positioned box (travel); its parent is the layer the moments use for coordinates */
  readonly box: HTMLElement;
  /** follows a stroking finger (CSS transition, transform only) */
  readonly lean: HTMLElement;
  /** placement B: slips down behind the tab bar */
  readonly duck: HTMLElement;
  /** his body as a tap target (pointer events only here) */
  readonly hit: HTMLElement;
  /** a moment takes the puppet: its own idle and CSS motion step aside */
  takeOver(): void;
  /** the moment is over: every inline style goes, the puppet's own life goes on (a held pose can stay inline) */
  release(keep?: Pose): void;
  readonly driven: boolean;
  /** writes a pose inline (no animation) */
  apply(pose: Pose): void;
  /** the feet are at `p` (px of the box's parent) */
  place(p: { x: number; y: number }): void;
  readonly at: { x: number; y: number };
  setStill(still: boolean): void;
  destroy(): void;
}

/** CSS transform / opacity for a part's channels (the same function list as timeline.ts formatStyles). */
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Adds the rig's parts into `puppet`'s shadow root (any Pompon: his own one, or one the host already shows). The
 * puppet keeps its own life; only while a moment runs (`takeOver` … `release`) the timelines move it. `box` = the
 * element that travels (his own box; for a borrowed puppet nothing travels: none).
 */
export function dressPompon(puppet: Bunny, box: HTMLElement | null = null): Dress {
  const root = puppet.root;
  const added: Element[] = [];
  const style = document.createElement('style');
  style.textContent = RIG_CSS;
  root.append(style);
  added.push(style);
  const q = (sel: string): Element[] => [...root.querySelectorAll(sel)];
  const one = (sel: string, i: number): Element[] => {
    const e = q(sel)[i];
    return e ? [e] : [];
  };
  const add = (parentEl: Element | undefined, markup: string, cls: string): SVGGElement => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', cls);
    g.innerHTML = markup;
    parentEl?.append(g);
    added.push(g);
    return g;
  };
  // hearts and dust in the puppet's own effect layer (it travels with him, but not with the hop or the lean of the body)
  const fx = root.querySelector('.fx') ?? undefined;
  const breathe = root.querySelector('.breathe') ?? undefined;
  const face = root.querySelector('.face') ?? undefined;
  // (sizes in puppet units: 1 unit = 0.29 px at 96 px — a heart of 36 units is ≈ 10 px on the phone)
  const h1 = add(fx, `<g transform="translate(44 -182) scale(2.1)">${heart}</g>`, 'lp-heart lp-heart-1');
  const h2 = add(fx, `<g transform="translate(-34 -190) scale(1.7)">${heart}</g>`, 'lp-heart lp-heart-2');
  // the purr: soft teeth chatter shows as short strokes beside the cheeks, one after another (they move with the head)
  const p1 = add(breathe, '<path d="M90 -98 q8 8 0 17"/>', 'lp-purr');
  const p2 = add(breathe, '<path d="M101 -103 q11 13 0 27"/>', 'lp-purr');
  const p3 = add(breathe, '<path d="M-90 -98 q-8 8 0 17"/>', 'lp-purr');
  // the sigh: a small curl of breath from the mouth
  const br = add(breathe, '<path d="M10 -73 q7 -5 13 0 q6 5 12 0"/>', 'lp-breath');
  const dusts = [0, 1, 2].map((i) => add(fx, `<circle cx="${[-8, 6, 18][i]}" cy="${[-30, -36, -27][i]}" r="${[8, 6.5, 5.5][i]}"/>`, 'lp-dust'));
  // worried brows (selection mode): tilted up in the middle, like the buddy's
  const brows = add(face, '<path d="M-38 -104 L-22 -110"/><path d="M22 -110 L38 -104"/>', 'lp-brows');
  // dizzy (the phone was shaken): the buddy's spiral eyes, each spinning about its own centre
  const dizzy = add(face, '', 'lp-dizzy');
  const spinL = add(dizzy, spiral(-29, -93), 'lp-spin');
  const spinR = add(dizzy, spiral(29, -93), 'lp-spin');
  // "ай" (an ear is pulled): squeezed eyes > <
  const squint = add(face, '<path d="M-36 -99.5 L-23.5 -93 L-36 -86.5"/><path d="M36 -99.5 L23.5 -93 L36 -86.5"/>', 'lp-squint');
  // three little stars that circle his head while he is dizzy
  const stars = [0, 1, 2].map(() => add(fx, `<g transform="translate(0 -176) scale(2.3)">${STAR}</g>`, 'lp-dstar'));

  const bunnyParts: Record<Exclude<PartName, 'box'>, Element[]> = {
    hop: q('.hop'),
    body: q('.body'),
    squash: q('.squash'),
    earL: q('.lop .ear-l'),
    earR: q('.lop .ear-r'),
    face: q('.face'),
    eyesG: q('.eyes'),
    eyeL: one('.eyes .eye', 0),
    eyeR: one('.eyes .eye', 1),
    happy: q('.eyes-happy'),
    star: q('.eyes-star'),
    spiral: [dizzy],
    spinL: [spinL],
    spinR: [spinR],
    squint: [squint],
    brows: [brows],
    nose: q('.nose'),
    mouth: q('.mouth'),
    mouthO: q('.mouth-open'),
    blush: q('.tf > ellipse'),
    cheekL: q('.cheek-l .cheek-j'),
    cheekR: q('.cheek-r .cheek-j'),
    paws: q('.paws'),
    pawL: q('.paw-l'),
    pawR: q('.paw-r'),
    footL: q('.foot-l'),
    footR: q('.foot-r'),
    shadow: q('.shadow'),
    tf: q('.tf'),
    tp: q('.tp'),
    teL: q('.te-l'),
    teR: q('.te-r'),
    tcL: q('.tc-l'),
    tcR: q('.tc-r'),
    tfootL: q('.tfoot-l'),
    tfootR: q('.tfoot-r'),
    tailL: q('.tail-l'),
    tailR: q('.tail-r'),
    heart1: [h1],
    heart2: [h2],
    purr1: [p1],
    purr2: [p2],
    purr3: [p3],
    breath: [br],
    dust1: dusts[0] ? [dusts[0]] : [],
    dust2: dusts[1] ? [dusts[1]] : [],
    dust3: dusts[2] ? [dusts[2]] : [],
    star1: stars[0] ? [stars[0]] : [],
    star2: stars[1] ? [stars[1]] : [],
    star3: stars[2] ? [stars[2]] : [],
  };
  const els: Record<PartName, Element[]> = { box: box ? [box] : [], ...bunnyParts };
  const hm = root.querySelector('.hm');
  let driven = false;
  let gone = false;

  const dress: Dress = {
    puppet,
    els: (name) => els[name],
    get driven() {
      return driven;
    },
    takeOver() {
      if (driven || gone || puppet.isDestroyed) return;
      if (puppet.busy) void puppet.interrupt();
      if (puppet.idleRunning) puppet.stopIdle();
      // the puppet's own idle may have left classes (blink, glance): back to the plain rest pose
      puppet.pose('idle');
      hm?.classList.add('lp');
      driven = true;
    },
    release(keep, idle = true) {
      if (gone || puppet.isDestroyed) return;
      for (const list of Object.values(bunnyParts)) {
        for (const e of list) {
          for (const a of e.getAnimations?.() ?? []) a.cancel();
          const st = (e as HTMLElement).style;
          st.transform = '';
          st.opacity = '';
        }
      }
      if (keep) dress.apply(keep);
      hm?.classList.remove('lp');
      driven = false;
      if (idle) puppet.startIdle();
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
    undress() {
      if (gone) return;
      if (driven) dress.release(undefined, false);
      gone = true;
      for (const e of added) e.remove();
    },
  };
  return dress;
}

export function mountPompon(parent: HTMLElement, opts: { still: boolean; label?: string }): Rig {
  const box = document.createElement('div');
  box.className = 'lp-actor';
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = `position:absolute;left:0;top:0;width:${SIZE}px;height:${BOX_H}px;pointer-events:none;`;
  const duck = document.createElement('div');
  duck.className = 'lp-duck';
  duck.style.cssText = 'position:absolute;inset:0;transition:transform .26s cubic-bezier(.2,.7,.3,1);';
  const lean = document.createElement('div');
  lean.className = 'lp-lean';
  lean.style.cssText = `position:absolute;inset:0;transform-origin:${FEET.x}px ${FEET.y}px;transition:transform .2s cubic-bezier(.2,.7,.3,1);`;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;';
  lean.append(host);
  duck.append(lean);
  const hit = document.createElement('div');
  hit.className = 'lp-hit';
  hit.style.cssText = `position:absolute;left:${FEET.x + HIT.left}px;top:${FEET.y + HIT.top}px;width:${HIT.width}px;height:${HIT.height}px;pointer-events:auto;cursor:pointer;touch-action:pan-y;-webkit-tap-highlight-color:transparent;border-radius:40%;`;
  duck.append(hit);
  box.append(duck);
  parent.append(box);

  const puppet = new Bunny(host, { size: SIZE, coat: 'fawn', ears: 'lop', idle: !opts.still, interactive: false, reducedMotion: opts.still ? 'force' : 'off', calmEyes: opts.still ? 'happy' : undefined });
  const dress = dressPompon(puppet, box);
  let destroyed = false;
  let still = opts.still;
  const at = { x: 0, y: 0 };

  const rig: Rig = {
    puppet,
    box,
    lean,
    duck,
    hit,
    els: (name) => dress.els(name),
    get driven() {
      return dress.driven;
    },
    get at() {
      return { ...at };
    },
    takeOver() {
      if (destroyed) return;
      dress.takeOver();
    },
    release(keep) {
      if (destroyed) return;
      // the box (where he stands) is the host's: it stays where the moment left him
      dress.release(keep, !still);
    },
    apply(pose) {
      dress.apply(pose);
      const b = pose.box;
      if (b) {
        at.x = (b.x ?? 0) + FEET.x;
        at.y = (b.y ?? 0) + FEET.y;
      }
    },
    place(p) {
      rig.apply({ box: { x: p.x - FEET.x, y: p.y - FEET.y } });
    },
    setStill(v) {
      still = v;
      puppet.setReducedMotion(v ? 'force' : 'off');
      puppet.setCalmEyes(v ? 'happy' : null);
      if (v) puppet.stopIdle();
      else if (!dress.driven) puppet.startIdle();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      puppet.destroy();
      box.remove();
    },
  };
  if (opts.label) hit.setAttribute('title', opts.label);
  return rig;
}

/** The box translate (px) that puts his feet on `p`. */
export function feetAt(p: { x: number; y: number }): Channels {
  return { x: p.x - FEET.x, y: p.y - FEET.y };
}
