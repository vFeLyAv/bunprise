/**
 * «Ночью маскоты спят» (approved 31.10) — the puppet rig. Moved here from the gallery prototype
 * (demo/night/rig.ts re-exports it).
 *
 * The puppet is the app's OWN Bunny / Hamster (src/bunny.ts, src/hamster.ts: the approved shapes, coats, idle life),
 * created exactly as the app creates it. Nothing else in src/ changes: while a night moment runs, the rig adds one
 * class (`nn`) on the puppet's `.hm` and one <style> inside its shadow root that switches the puppet's own CSS loops
 * and transitions off — the night timelines (src/timeline.ts Tracks → Web Animations, transform / opacity only) move
 * its parts instead. Awake again, the class goes, every inline style goes, and the puppet's own idle life goes on.
 *
 * Two HTML wrappers around the puppet carry the sleeping loop (compositor-only: no SVG repaint while he sleeps):
 *   breath — the slow breathing (scale about the feet + a tiny sway), one Web Animation;
 *   z      — the approved sleepy "z" (welcome-actors sleepIdle path), one Web Animation, in --buddy-z.
 *
 * `hit` (the app): the box lets every touch through (pointer-events: none) except his body — a box that ends at his
 * feet, so the card he sleeps on stays tappable right up to its edge.
 */

// the puppets by file, not the package index (the index registers <bunprise-mascot> and is the app's lazy mascot
// chunk — the same reason as src/buddy/buddy.ts)
import { Bunny } from '../bunny';
import { Hamster } from '../hamster';
import type { Channels } from '../timeline';
import type { BunnyCoat, HamsterCoat } from '../types';

export type NightKind = 'bunny' | 'hamster';

/** Every part a night moment may move. */
export type PartName =
  | 'hop' | 'body' | 'squash' | 'earL' | 'earR' | 'tip' | 'face' | 'tf' | 'te'
  | 'eyesG' | 'eyeL' | 'eyeR' | 'sleepL' | 'sleepR' | 'happy' | 'mouth' | 'yawn'
  | 'pawL' | 'pawR' | 'snot' | 'bino' | 'binoPaw' | 'glint'
  | 'breath' | 'z';

export type Pose = Partial<Record<PartName, Channels>>;

/** The neutral value of every part = the puppet at rest, awake (and the channels each part uses). */
export const NEUTRAL: Readonly<Record<PartName, Channels>> = {
  hop: { y: 0 },
  body: { r: 0 },
  squash: { r: 0, sx: 1, sy: 1 },
  earL: { r: 0 },
  earR: { r: 0 },
  tip: { r: 0 },
  face: { x: 0, y: 0 },
  tf: { x: 0 },
  te: { x: 0 },
  eyesG: { o: 1 },
  eyeL: { sx: 1, sy: 1, o: 1 },
  eyeR: { sx: 1, sy: 1, o: 1 },
  sleepL: { o: 0 },
  sleepR: { o: 0 },
  happy: { o: 0 },
  mouth: { o: 1 },
  yawn: { o: 0, sx: 1, sy: 1 },
  pawL: { x: 0, y: 0, r: 0 },
  pawR: { x: 0, y: 0, r: 0 },
  snot: { o: 0, sy: 1 },
  bino: { x: 0, y: 0, r: 0, sx: 1, sy: 1 },
  binoPaw: { x: 0, y: 0, r: 0 },
  glint: { x: 0 },
  breath: { r: 0, sx: 1, sy: 1 },
  z: { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
};

/** Puppet geometry (the puppet's own viewBox, feet point and scale; puppet units for the moves). */
export interface Geo {
  kind: NightKind;
  viewH: number;
  feetY: number;
  scale: number;
  /** eye centres (left x is negative), paws at rest */
  eye: { x: number; y: number };
  paw: { x: number; y: number };
  /** the approved wave: paw-r beside the cheek at eye level, partly outside the contour (the welcome greet after Felix's
   *  review: «на фоне, а не светлым по светлому»; hamster: pose 'wave') */
  wave: { x: number; y: number };
  /** the sleeping ears (BUNNY_CSS / HAMSTER_CSS `.sleeping .ear-l / .ear-r`) */
  sleepEars: { l: number; r: number };
  /** where the "z" starts (puppet units: right of the head) */
  zAt: { x: number; y: number };
  /** top of the head (puppet units) — the hit box starts here */
  headTop: number;
}

export const GEO: Readonly<Record<NightKind, Geo>> = {
  bunny: { kind: 'bunny', viewH: 260, feetY: 246, scale: 1.2, eye: { x: 29, y: -93 }, paw: { x: 16, y: -44 }, wave: { x: 56, y: -46 }, sleepEars: { l: 7, r: -7 }, zAt: { x: 60, y: -150 }, headTop: -176 },
  hamster: { kind: 'hamster', viewH: 250, feetY: 236, scale: 1.25, eye: { x: 32, y: -96 }, paw: { x: 16, y: -46 }, wave: { x: 44, y: -30 }, sleepEars: { l: -16, r: 14 }, zAt: { x: 62, y: -128 }, headTop: -170 },
};

/** The binoculars resting lowered on his tummy (the approved "Weniger" pose, HAMSTER_CSS `.rm .hold-binoculars .bino`). */
export const BINO_DOWN: Channels = { x: 0, y: 36, r: 0, sx: 0.97, sy: 0.97 };
/** Where the binocular glint rests after its sweep (off the lens): the look-around loop holds it there from 52.5 %. */
export const GLINT_OFF = 132;
/**
 * The awake binocular loop takes over at this second of its 16 s cycle (HAMSTER_CSS bino-look): binoculars still
 * lowered, both blinks over (83.4 %), the spring up at 85 % — exactly the pose a night moment ends in.
 */
export const BINO_HANDOVER_S = 13.4;

/** Asleep: eyes closed (the sleeping arcs), the head droops to one side, the body settles, the ears relax. */
export function sleepPose(geo: Geo, opts: { binoculars: boolean; drip: boolean }): Pose {
  return {
    body: { r: 4 },
    squash: { r: 0, sx: 1.025, sy: 0.965 },
    earL: { r: geo.sleepEars.l },
    earR: { r: geo.sleepEars.r },
    face: { x: 0, y: 1.6 },
    eyesG: { o: 0 },
    eyeL: { sx: 1, sy: 1, o: 1 },
    eyeR: { sx: 1, sy: 1, o: 1 },
    sleepL: { o: 1 },
    sleepR: { o: 1 },
    happy: { o: 0 },
    // the approved drip (it runs down; never a bubble): a short one while he sleeps
    snot: opts.drip ? { o: 1, sy: 0.7 } : { o: 0, sy: 1 },
    ...(opts.binoculars ? { bino: { ...BINO_DOWN }, glint: { x: GLINT_OFF } } : {}),
  };
}

/** The still "z" of a sleeping mascot under reduced motion / battery saver (no loop): beside his head. */
export const STILL_Z: Channels = { x: 3, y: -7, sx: 1, sy: 1, o: 0.85 };

/** The approved sleepy "z" (welcome-actors sleepIdle / overfed-rig Z), centred on its origin. */
const Z_SVG = '<svg viewBox="-6 -6.5 12 13" aria-hidden="true" focusable="false" style="display:block;width:100%;height:100%;overflow:visible"><path d="M-4 -4.5h8l-8 9h8" fill="none" stroke="var(--buddy-z, #C9845D)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Inside the puppet's shadow root: while `.hm.nn`, the puppet's own CSS motion steps aside (timelines move it). */
const NN_CSS = `
.hm.nn, .hm.nn * { animation: none !important; transition: none !important; }
.hm.nn .eyes-sleep { opacity: 1 !important; }
.hm.nn .wiggle { transform-origin: 50% 100%; }
.hm.nn .squash { transform-origin: 50% 100%; }
.hm.nn .bino-paw { transform-origin: 50% 100%; }
`;

export interface RigOptions {
  kind: NightKind;
  /** width in px (the app: Lists buddy 96, Start corner 96, Tapsi in "Freunde" 160) */
  size: number;
  coat?: BunnyCoat | HamsterCoat;
  binoculars?: boolean;
  /** the puppet's own idle life while awake (false: still frames for the strips) */
  idle?: boolean;
  /** only his body catches a touch (the box itself lets every touch through) — the app */
  hit?: boolean;
}

export interface NightRig {
  readonly kind: NightKind;
  readonly geo: Geo;
  readonly size: number;
  readonly binoculars: boolean;
  readonly puppet: Bunny | Hamster;
  /** the positioned box (the caller sets left / top); the feet line is `feet` px below its top */
  readonly box: HTMLElement;
  readonly feet: number;
  /** px per puppet unit */
  readonly unit: number;
  /** his body's box (RigOptions.hit), null without */
  readonly hit: HTMLElement | null;
  /** the elements of a part ([] when this puppet has none, e.g. binoculars on a bunny) */
  els(name: PartName): Element[];
  has(name: PartName): boolean;
  /** night mode on: the puppet's own CSS motion steps aside (idle stopped first) */
  takeOver(): void;
  /** night mode off: every inline style goes, the puppet's own CSS and idle life go on */
  release(idle: boolean): void;
  readonly driven: boolean;
  /** writes a pose inline (no animation) */
  apply(pose: Pose): void;
  /** the awake puppet's current pose (the binocular look-around loop wherever it is right now) */
  readAwake(): Pose;
  destroy(): void;
}

/**
 * translate / rotate / scale of a computed 2D matrix — the same reading as tapsi-moments.ts readLoopPose (copied, not
 * imported: hamster.ts loads that module lazily, and a static import from this entry turned it into a namespace chunk
 * that pulled the bundler's runtime helpers out of the app's shell — +0.6 KB gz on the first screen /soon).
 */
function decompose(el: Element | undefined): { x: number; y: number; r: number; sx: number; sy: number } {
  const id = { x: 0, y: 0, r: 0, sx: 1, sy: 1 };
  if (!el || typeof getComputedStyle !== 'function') return id;
  const m = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(el).transform || '')?.[1]?.split(',').map(Number);
  if (!m || m.length !== 6 || !m.every(Number.isFinite)) return id;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = m;
  const sx = Math.hypot(a, b);
  if (sx < 1e-6) return id;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r3(e), y: r3(f), r: r3((Math.atan2(b, a) * 180) / Math.PI), sx: r3(sx), sy: r3((a * d - b * c) / sx) };
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

export function mountNightPuppet(parent: HTMLElement, o: RigOptions): NightRig {
  const geo = GEO[o.kind];
  const k = o.size / 400;
  const unit = k * geo.scale;
  const feet = geo.feetY * k;
  const box = document.createElement('div');
  box.className = 'nt-actor';
  box.style.cssText = `position:absolute;width:${o.size}px;height:${Math.round(geo.viewH * k)}px;${o.hit ? 'pointer-events:none;' : ''}`;
  const breath = document.createElement('div');
  breath.className = 'nt-breath';
  breath.style.cssText = `position:absolute;inset:0;transform-origin:50% ${feet}px;`;
  const host = document.createElement('div');
  host.className = 'nt-host';
  host.style.cssText = 'position:absolute;inset:0;';
  breath.append(host);
  const zPx = Math.max(9, Math.round(o.size * 0.1));
  const z = document.createElement('div');
  z.className = 'nt-z';
  z.setAttribute('aria-hidden', 'true');
  const zx = 200 * k + geo.zAt.x * unit;
  const zy = feet + geo.zAt.y * unit;
  z.style.cssText = `position:absolute;left:${zx - zPx / 2}px;top:${zy - zPx / 2}px;width:${zPx}px;height:${zPx * 1.08}px;opacity:0;pointer-events:none;`;
  z.innerHTML = Z_SVG;
  box.append(breath, z);
  let hit: HTMLElement | null = null;
  if (o.hit) {
    // his body, from the top of the head down to his feet (88 puppet units each side: the buddy's hit box)
    hit = document.createElement('div');
    hit.className = 'nt-hit';
    const half = 88 * unit;
    const top = feet + geo.headTop * unit;
    hit.style.cssText = `position:absolute;left:${200 * k - half}px;top:${top}px;width:${2 * half}px;height:${feet - top}px;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;`;
    box.append(hit);
  }
  parent.append(box);

  const binoculars = o.kind === 'hamster' && !!o.binoculars;
  const idle = o.idle ?? true;
  const puppet =
    o.kind === 'bunny'
      ? new Bunny(host, { size: o.size, idle, interactive: false, reducedMotion: 'off', ...(o.coat ? { coat: o.coat as BunnyCoat } : {}) })
      : new Hamster(host, { size: o.size, idle, interactive: false, reducedMotion: 'off', ...(o.coat ? { coat: o.coat as HamsterCoat } : {}), holding: binoculars ? 'binoculars' : null });
  const style = document.createElement('style');
  style.textContent = NN_CSS;
  puppet.root.append(style);
  const hm = puppet.root.querySelector('.hm');
  const q = (sel: string): Element[] => [...puppet.root.querySelectorAll(sel)];
  const one = (sel: string, i: number): Element[] => {
    const e = q(sel)[i];
    return e ? [e] : [];
  };
  const bunny = o.kind === 'bunny';
  const els: Record<PartName, Element[]> = {
    hop: q('.hop'),
    body: q('.body'),
    squash: q(bunny ? '.squash' : '.wiggle'),
    earL: q(bunny ? '.lop .ear-l' : '.ear-l'),
    earR: q(bunny ? '.lop .ear-r' : '.ear-r'),
    tip: bunny ? [] : q('.ear-tip'),
    face: q('.face'),
    tf: binoculars ? q('.tf') : [],
    te: binoculars ? q('.te') : [],
    eyesG: q('.eyes'),
    eyeL: one('.eyes .eye', 0),
    eyeR: one('.eyes .eye', 1),
    sleepL: one('.eyes-sleep path', 0),
    sleepR: one('.eyes-sleep path', 1),
    happy: q('.eyes-happy'),
    mouth: q('.mouth'),
    yawn: q('.mouth-open'),
    pawL: q('.paw-l'),
    pawR: q('.paw-r'),
    snot: q('.snot'),
    bino: binoculars ? q('.bino') : [],
    binoPaw: binoculars ? one('.bino-paw', 1) : [],
    glint: binoculars ? q('.bino-glint') : [],
    breath: [breath],
    z: [z],
  };
  // the CSS loop parts of the binoculars (they take over at BINO_HANDOVER_S when he is awake again)
  const loopParts = binoculars ? q('.bino, .tf, .te, .wiggle, .eyes .eye, .bino-glint') : [];
  let driven = false;
  let destroyed = false;

  const rig: NightRig = {
    kind: o.kind,
    geo,
    size: o.size,
    binoculars,
    puppet,
    box,
    feet,
    unit,
    hit,
    els: (name) => els[name],
    has: (name) => els[name].length > 0,
    get driven() {
      return driven;
    },
    takeOver() {
      if (driven || destroyed) return;
      // (only an idle that runs is stopped — and started again by release(): the puppet ends as it was)
      if (puppet.idleRunning) puppet.stopIdle();
      // the app scene may have left classes (blink, glance …): back to the plain rest pose, holding what he holds
      puppet.pose('idle');
      hm?.classList.add('nn');
      driven = true;
    },
    release(idleOn) {
      if (destroyed) return;
      for (const list of Object.values(els)) {
        for (const e of list) {
          for (const a of e.getAnimations?.() ?? []) a.cancel();
          const st = (e as HTMLElement).style;
          st.transform = '';
          st.opacity = '';
        }
      }
      z.style.opacity = '0';
      // the binocular loop goes on from the moment that matches the pose he ends in (binoculars lowered)
      for (const e of loopParts) (e as HTMLElement).style.animationDelay = `-${BINO_HANDOVER_S}s`;
      hm?.classList.remove('nn');
      driven = false;
      if (idleOn) puppet.startIdle();
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
    readAwake() {
      if (!binoculars) return {};
      // the binocular look-around loop wherever it is (tapsi-moments.ts readLoopPose)
      const eye = decompose(q('.eyes .eye')[0]).sy;
      return {
        bino: decompose(q('.bino')[0]),
        tf: { x: decompose(q('.tf')[0]).x },
        te: { x: decompose(q('.te')[0]).x },
        squash: { r: decompose(q('.wiggle')[0]).r, sx: 1, sy: 1 },
        eyeL: { sx: 1, sy: eye, o: 1 },
        eyeR: { sx: 1, sy: eye, o: 1 },
        glint: { x: decompose(q('.bino-glint')[0]).x },
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const a of z.getAnimations?.() ?? []) a.cancel();
      for (const a of breath.getAnimations?.() ?? []) a.cancel();
      puppet.destroy();
      box.remove();
    },
  };
  return rig;
}
