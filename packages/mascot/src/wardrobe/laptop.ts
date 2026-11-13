/**
 * «За ноутбуком · Im Homeoffice», composition A «Экраном к нему» (31.10; Felix picked A — feedback §27: «ноутбук —
 * ракурс A „экраном к нему“ (кружка и „строчки“ на экране — по умолчанию остаются)»). Copied from the gallery prototype
 * (demo/costumes/laptop.ts v3, docs/design/2026-10-31-laptop-v2.md) with only composition A; B, C and v2 stay there.
 *
 * Photo 7: a tiny fluffy bunny next to a BIG open laptop, both paws on the keys, all focus. The laptop is one small
 * model (deck, keys, trackpad, lid) seen by a fixed camera — orthographic, a yaw and a look-down pitch, flat colours of
 * our palette with the puppet's contour (`cs-o`). It stands on the floor at his front-right, turned towards him: the
 * whole keyboard and the glowing screen at an angle; he is in the 3/4 turn looking at it; a mug of cocoa at his left.
 *
 * Depth (./costume-rig.ts slots): the laptop is in the static `front` slot (never hops). His paws must lie ON the keys,
 * i.e. OVER the laptop, so they are drawn there too (his own are hidden) — as a TWIN of his paws: three nested groups
 * that ECHO his `.hop`, `.body` and `.paws` (core.ts echoMotion: every move the puppet gives those groups, the twins
 * make too — in his binky the twin paws leave the keys with him and land back on them; nothing stays in the air). The
 * gallery did this by wrapping animate(); here it is the package's own mechanism.
 *
 * Typing (LaptopTyping): ONE seekable timeline (Track → Web Animations on one Playhead via drive.ts Driver; no rAF, no
 * timers; `seek(t)` = the same frame every time), transform / opacity only, finite: the last frame is the still pose,
 * then every animation is cancelled and every inline style it wrote is removed. Paused while hidden (Watch).
 * Reduced motion: no animate() at all — the still typing pose (freezeAt).
 */

import { Driver, freezeAt, Watch } from '../drive';
import { ell, f, poly, rrect, shift, type Pt } from '../geometry';
import { Track, type Sampled } from '../timeline';
import type { Layer, Look } from './costume-rig';

/** Camera: yaw of the laptop (deg), look-down pitch (deg), the middle of its front edge on the puppet's plane. */
interface Cam {
  psi: number;
  phi: number;
  x: number;
  y: number;
}
/** The laptop: width, depth, deck thickness, lid height, opening angle (deg from closed), lid thickness, corner r. */
interface Box {
  W: number;
  D: number;
  T: number;
  H: number;
  open: number;
  lidT: number;
  r: number;
}
interface Spec {
  cam: Cam;
  box: Box;
  /** where his paws rest on the keys (laptop units: u across, v from the palm rest to the hinge) */
  paws: readonly [readonly [number, number], readonly [number, number]];
  /** the screen glow on his face: centre / radii in face units (the side towards the screen) */
  glow: readonly [number, number, number, number];
}

/** Composition A «Экраном к нему» (the gallery's SPECS.a, unchanged). */
const A: Spec = {
  cam: { psi: 18, phi: 28, x: 2.5, y: -22 },
  box: { W: 112, D: 76, T: 5, H: 66, open: 106, lidT: 3, r: 7 },
  paws: [[-32, 40], [22, 31]],
  glow: [45, -77, 17, 20],
};

// ---- colours: our palette, flat ------------------------------------------------------------------------------------

const COL = {
  shell: '#ECE8F4',
  edge: '#CBC4DB',
  well: '#DAD4E6',
  key: '#5E5771',
  pad: '#DED8EA',
  lidRim: '#C7BFD8',
  bezel: '#4A4458',
  screen: '#DDF1FF',
  light: '#E4F5FF',
  heart: '#F4879F',
  heartHi: '#FFD0DB',
  tongue: '#EE8F9C',
  word: '#9DC6EC',
  mug: '#F6BFCB',
  mugRim: '#FBDDE4',
  cocoa: '#A8714E',
  shadow: 'var(--mascot-shadow, rgba(70,40,15,.12))',
  toe: 'rgba(150,90,40,.35)',
} as const;

// ---- the projection --------------------------------------------------------------------------------------------------

const rad = (d: number) => (d * Math.PI) / 180;
type Proj = (u: number, v: number, w: number) => Pt;

/** Orthographic camera: u = across the laptop (his right), v = from the palm rest to the hinge, w = up. */
function projector(c: Cam): Proj {
  const sp = Math.sin(rad(c.psi));
  const cp = Math.cos(rad(c.psi));
  const sf = Math.sin(rad(c.phi));
  const cf = Math.cos(rad(c.phi));
  return (u, v, w) => [c.x + u * sp + v * cp, c.y - w * cf + (u * cp - v * sp) * sf];
}

/** Points of a rounded rectangle (x0..x1 × y0..y1, corner r) in a local 2D frame. */
function rr(x0: number, y0: number, x1: number, y1: number, r: number, n = 4): Pt[] {
  const q = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const out: Pt[] = [];
  const corners: ReadonlyArray<readonly [number, number, number]> = [[x1 - q, y0 + q, -90], [x1 - q, y1 - q, 0], [x0 + q, y1 - q, 90], [x0 + q, y0 + q, 180]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = rad(a0 + (90 * i) / n);
      out.push([cx + q * Math.cos(a), cy + q * Math.sin(a)]);
    }
  }
  return out;
}

/** Convex hull (monotone chain) — the silhouette of an extruded rounded slab. */
function hull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: readonly Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as Pt, out[out.length - 1] as Pt, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

const centre = (pts: readonly Pt[]): Pt => [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
const path = (d: string, fill: string, o = false, extra = '') => `<path ${o ? 'class="cs-o" ' : ''}d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const origin = (x: number, y: number) => `style="transform-origin: ${f(x)}px ${f(y)}px"`;

// ---- the laptop model ----------------------------------------------------------------------------------------------

interface Key {
  id: string;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** A small keyboard: rows from the palm rest (0: the space row) to the hinge (3); a tall enter key on his right. */
function keyboard(b: Box): Key[] {
  const uL = -0.43 * b.W;
  const uR = 0.43 * b.W;
  const vN = 0.42 * b.D;
  const vF = 0.9 * b.D;
  const g = 1.5;
  const rh = (vF - vN) / 4;
  const cw = (uR - uL) / 11;
  const keys: Key[] = [];
  const add = (id: string, a: number, c: number, r0: number, r1: number) => keys.push({ id, u0: uL + a * cw + g / 2, u1: uL + c * cw - g / 2, v0: vN + r0 * rh + g / 2, v1: vN + r1 * rh - g / 2 });
  for (let i = 0; i < 11; i++) add(`3-${i}`, i, i + 1, 3, 4);
  for (const r of [1, 2]) for (let i = 0; i < 9; i++) add(`${r}-${i}`, i, i + 1, r, r + 1);
  add('enter', 9, 11, 1, 3);
  add('0-0', 0, 1.5, 0, 1);
  add('0-1', 1.5, 3, 0, 1);
  add('space', 3, 8, 0, 1);
  add('0-8', 8, 9.5, 0, 1);
  add('0-9', 9.5, 11, 0, 1);
  return keys;
}

interface Built {
  /** the front-slot markup */
  front: string;
  /** screen centre of every key (for the tap choreography) */
  keys: ReadonlyMap<string, Pt>;
  /** where the twin paws rest (screen) and the direction their toes point (deg) */
  paws: readonly [Pt, Pt];
  pawDeg: number;
  /** how far a pressed key sinks on screen */
  dip: Pt;
}

const HEART = 'M0 4 C-4 1 -9 -2.6 -9 -7 C-9 -10.4 -6.4 -12.6 -3.8 -12.6 C-2 -12.6 -0.6 -11.6 0 -10 C0.6 -11.6 2 -12.6 3.8 -12.6 C6.4 -12.6 9 -10.4 9 -7 C9 -2.6 4 1 0 4 Z';
const HEART_HI = 'M-6.2 -8.6 C-6.2 -10 -5 -10.9 -3.8 -10.6 C-3 -10.4 -2.9 -9.4 -3.6 -9 C-4.4 -8.5 -5 -8 -5.4 -7.2 C-5.8 -6.6 -6.3 -7.6 -6.2 -8.6 Z';

/** The "words" on the screen: [line 0..2, from, to] as parts of the line width; one per tap, in tap order. */
const WORDS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0.3], [0, 0.36, 0.58], [0, 0.64, 0.92], [1, 0, 0.42], [1, 0.48, 0.66], [1, 0.72, 0.96], [2, 0, 0.24], [2, 0.3, 0.6], [2, 0.66, 0.78],
];

/**
 * A mug of cocoa on the floor at his left (the home office). Beside him, not in front: it never overlaps him, so it
 * can stand in the static front slot like the laptop. A small heart on it, our motif.
 */
const MUG = (() => {
  const x = -94;
  const handle = path(`${ell(x - 10.6, -10.5, 6.2, 7)} ${ell(x - 10.6, -10.5, 3.2, 4.1)}`, COL.mug, true, 'fill-rule="evenodd"');
  const body = path(rrect(x - 11, -24, 22, 28, 6), COL.mug, true);
  const rim = path(ell(x, -23.6, 11, 3.6), COL.mugRim, true) + path(ell(x, -23.2, 8.4, 2.3), COL.cocoa);
  const small = (d: string) => d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_m, a: string, c: string) => `${f(x + Number(a) * 0.46)} ${f(-6 + Number(c) * 0.46)}`);
  return `<g class="lt-mug">${path(ell(x - 1, 4.4, 15, 2.8), COL.shadow)}${handle}${body}${rim}${path(small(HEART), '#FFFFFF', false, 'opacity=".9"')}</g>`;
})();

/** One paw lying on the keys, toes towards the hinge: his own paw's colour, contour and three toe lines. */
function pawMarkup([x, y]: Pt, deg: number, side: 'l' | 'r'): string {
  const a = rad(deg);
  const T = (along: number, across: number): Pt => [x + along * Math.cos(a) - across * Math.sin(a), y + along * Math.sin(a) + across * Math.cos(a)];
  const toes = [-3.6, 0, 3.6].map((c) => {
    const p0 = T(5.4, c * 1.05);
    const p1 = T(8.2, c * 1.18);
    return `M${f(p0[0])} ${f(p0[1])} L${f(p1[0])} ${f(p1[1])}`;
  }).join(' ');
  const heel = T(-7, 0);
  return `<g class="lt-paw lt-paw-${side} lt-v" ${origin(heel[0], heel[1])}>${path(ell(x, y, 10, 7.6, deg), 'var(--mascot-paw)', true)}<path d="${toes}" fill="none" stroke="${COL.toe}" stroke-width="1.2" stroke-linecap="round"/></g>`;
}

/** The costume's own CSS (one per puppet: undress removes it with the layer). */
function styleOnce(uid: string): string {
  return `<style data-lt="${uid}">
.lt-v { transform-box: view-box; }
svg.peek .lt-root, svg.run .lt-root, svg.peek .lt-face, svg.run .lt-face { display: none; }
svg.peek .hm .paw, svg.run .hm .paw { visibility: visible; }
</style>`;
}

function build(s: Spec, uid: string): Built {
  const P = projector(s.cam);
  const b = s.box;
  const al = rad(b.open);
  // lid frame: (s across, t up the lid, o out of its back)
  const L = (u: number, t: number, o: number): Pt => P(u, b.D - t * Math.cos(al) + o * Math.sin(al), b.T + t * Math.sin(al) + o * Math.cos(al));
  const deckOutline = rr(-b.W / 2, 0, b.W / 2, b.D, b.r);
  const deckTop = deckOutline.map(([u, v]) => P(u, v, b.T));
  const deckAll = [...deckOutline.map(([u, v]) => P(u, v, 0)), ...deckTop];
  const lidOutline = rr(-b.W / 2, 0, b.W / 2, b.H, b.r);
  const lidIn = lidOutline.map(([u, t]) => L(u, t, 0));
  const lidOut = lidOutline.map(([u, t]) => L(u, t, b.lidT));

  // its contact shadow on the floor (the footprint, a little wider), then the deck: silhouette (its edge colour) →
  // top → trackpad → keyboard well → keys → the screen's light on it
  const foot = deckOutline.map(([u, v]) => P(u * 1.04, (v - b.D / 2) * 1.06 + b.D / 2, 0));
  let deck = path(poly(hull(foot).map(([x, y]): Pt => [x + 0.6, y + 1.6])), COL.shadow);
  deck += path(poly(hull(deckAll)), COL.edge, true) + path(poly(deckTop), COL.shell);
  deck += path(poly(rr(-0.17 * b.W, 0.07 * b.D, 0.17 * b.W, 0.34 * b.D, 2.6).map(([u, v]) => P(u, v, b.T))), COL.pad);
  deck += path(poly(rr(-0.455 * b.W, 0.395 * b.D, 0.455 * b.W, 0.925 * b.D, 2.4).map(([u, v]) => P(u, v, b.T))), COL.well);
  const keys = new Map<string, Pt>();
  for (const k of keyboard(b)) {
    const pts = rr(k.u0, k.v0, k.u1, k.v1, 0.9, 2).map(([u, v]) => P(u, v, b.T + 0.25));
    keys.set(k.id, centre(pts));
    deck += `<path class="lt-key lt-v" data-k="${k.id}" d="${poly(pts)}" fill="${COL.key}"/>`;
  }
  deck += `<path class="lt-spill" d="${poly(rr(-0.47 * b.W, 0.52 * b.D, 0.47 * b.W, 0.98 * b.D, 3).map(([u, v]) => P(u, v, b.T + 0.3)))}" fill="${COL.light}" opacity=".32"/>`;

  // the lid: silhouette (rim colour) → the screen we see → the "words" he types (soft bars, no letters; one per tap)
  const lidHull = path(poly(hull([...lidIn, ...lidOut])), COL.lidRim, true);
  const bez = rr(-b.W / 2 + 0.6, 0.6, b.W / 2 - 0.6, b.H - 0.6, b.r - 0.6).map(([u, t]) => L(u, t, -0.1));
  const scr = rr(-b.W / 2 + 4, 4.2, b.W / 2 - 4, b.H - 4, 2).map(([u, t]) => L(u, t, -0.2));
  // the screen, and its light: a white veil whose opacity flickers a little while he types (never darker)
  let lid = lidHull + path(poly(bez), COL.bezel) + path(poly(scr), COL.screen) + `<path class="lt-screen" d="${poly(scr)}" fill="#FFFFFF" opacity=".18"/>`;
  lid += WORDS.map(([line, a, c], i) => {
    const t1 = b.H * (0.76 - line * 0.17);
    const u0 = -b.W / 2 + 9 + a * (b.W - 18);
    const u1 = -b.W / 2 + 9 + c * (b.W - 18);
    return `<path class="lt-word" data-w="${i}" d="${poly(rr(u0, t1 - 4.2, u1, t1, 2.1, 2).map(([u, t]) => L(u, t, -0.3)))}" fill="${COL.word}" opacity="0"/>`;
  }).join('');
  // the heart pops out of the screen
  const top = L(0, b.H * 0.62, -1);
  const heart = `<g class="lt-heart lt-v" ${origin(top[0], top[1])} opacity="0">${path(shift(HEART, top[0], top[1]), COL.heart, true)}${path(shift(HEART_HI, top[0], top[1]), COL.heartHi, false, 'opacity=".9"')}</g>`;

  // his paws on the keys: a twin of his own (same colour, contour and toe lines), inside three echo groups
  const o0 = P(0, 0, 0);
  const v1 = P(0, 1, 0);
  const pawDeg = (Math.atan2(v1[1] - o0[1], v1[0] - o0[0]) * 180) / Math.PI;
  const pa = s.paws[0];
  const pb = s.paws[1];
  const paws: readonly [Pt, Pt] = [P(pa[0], pa[1], b.T + 2.2), P(pb[0], pb[1], b.T + 2.2)];
  const twin = paws.map((p, i) => pawMarkup(p, pawDeg, i === 0 ? 'l' : 'r')).join('');
  const hop = `<g class="lt-m-hop lt-v"><g class="lt-m-body lt-v" ${origin(0, -1)}><g class="lt-m-paws lt-v">${twin}</g></g></g>`;

  const dz = P(0, 0, -1);
  const dip: Pt = [dz[0] - o0[0], dz[1] - o0[1]];
  // we see the screen: the lid stands behind the deck
  return {
    front: `<g class="lt-root" data-variant="a">${MUG}${lid}${deck}${heart}${hop}</g>${styleOnce(uid)}`,
    keys,
    paws,
    pawDeg,
    dip: [dip[0] * 1.3, dip[1] * 1.3],
  };
}

// ---- the face: the screen's light and the concentration tongue ------------------------------------------------------

/** The screen's light on his face: under his eyes, nose and mouth (`face-under`), on the side towards the screen. */
function glowMarkup(s: Spec, uid: string): string {
  const [gx, gy, grx, gry] = s.glow;
  const id = `${uid}-lt-glow`;
  return `<g class="lt-face"><defs><radialGradient id="${id}"><stop offset="0" stop-color="#BFE2FF" stop-opacity=".7"/><stop offset=".55" stop-color="#CBE8FF" stop-opacity=".35"/><stop offset="1" stop-color="${COL.light}" stop-opacity="0"/></radialGradient></defs>`
    + `<path class="lt-glow" d="${ell(gx, gy, grx, gry)}" fill="url(#${id})" opacity=".6"/></g>`;
}

/** The tip of his tongue while he concentrates (`face`: over the muzzle), with his mouth line redrawn over it. */
const TONGUE = `<g class="lt-face"><g class="lt-tongue lt-v" ${origin(3.4, -76)} opacity="0">`
  + `<path d="M1.4 -76.5 C1.4 -74 2.6 -72.1 3.9 -72.1 C5.2 -72.1 6.1 -73.8 5.8 -76.3 Z" fill="${COL.tongue}"/>`
  + '<path d="M0 -77.6 Q2.2 -75.2 4.6 -76.2" fill="none" stroke="var(--mascot-mouth)" stroke-width="1.4" stroke-linecap="round"/></g></g>';

// ---- the costume -------------------------------------------------------------------------------------------------

/** His three groups and the twin-paw groups that echo them (./costume-rig.ts Look.echoes). */
export const LAPTOP_ECHOES: ReadonlyArray<readonly [string, string]> = [['.hop', '.lt-m-hop'], ['.body', '.lt-m-body'], ['.tp .paws', '.lt-m-paws']];

export function laptopLayers(): Layer[] {
  return [
    { slot: 'front', draw: (c) => build(A, c.uid).front },
    { slot: 'face-under', draw: (c) => glowMarkup(A, c.uid) },
    { slot: 'face', draw: () => TONGUE },
  ];
}

/** The laptop look: in front of him, his own paws (and tail) hidden, turned towards the screen, the twin paws echoing. */
export function laptopLook(): Look {
  return { id: 'laptop', layers: laptopLayers(), hide: ['paws', 'tail'], turn: 'r', echoes: LAPTOP_ECHOES };
}

// ---- typing: one seekable timeline -----------------------------------------------------------------------------------

/** Seconds the typing takes; the last frame is the still pose again. */
export const TYPE_S = 4.9;
/** The still typing pose (reduced motion): concentrating, tongue out, words on the screen. */
export const STILL_T = 1.62;

/** [time of the key contact, paw 0 = his left (far) / 1 = right (near), key id] */
const TAPS: ReadonlyArray<readonly [number, 0 | 1, string]> = [
  [0.58, 0, '2-3'], [0.8, 1, '2-6'], [1.0, 0, '1-2'], [1.19, 1, '1-6'], [1.38, 0, '2-2'],
  [1.84, 1, '2-5'], [2.02, 0, '1-3'], [2.2, 1, '2-6'], [2.38, 0, '2-2'], [2.56, 1, '1-5'],
];
const ENTER_T = 3.24;

interface Parts {
  tracks: Sampled[];
  /** every element whose inline transform / opacity the timeline writes (cleaned up at the end) */
  touched: Element[];
}

function q<T extends Element = Element>(root: ShadowRoot, sel: string): T | null {
  return root.querySelector<T>(sel);
}

/** The typing choreography on the laptop-wearing puppet in `root` (the gallery's, composition A). */
function author(root: ShadowRoot): Parts {
  const s = A;
  const geo = build(s, 'x');
  const tracks: Sampled[] = [];
  const touched: Element[] = [];
  const track = (el: Element | null, name: string, base: Record<string, number> = {}): Track | null => {
    if (!el) return null;
    const t = new Track(el, name, base);
    tracks.push(t);
    touched.push(el);
    return t;
  };

  // paws: each tap = lift (heel stays, toes up a little) → contact (a squish on the key) → back to rest
  const pawEls = [q(root, '.lt-paw-l'), q(root, '.lt-paw-r')];
  const paw = pawEls.map((el, i) => track(el, `paw${i}`, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }));
  const keyTracks = new Map<string, Track>();
  const keyTrack = (id: string) => {
    let t = keyTracks.get(id);
    if (!t) {
      const tt = track(q(root, `.lt-key[data-k="${id}"]`), `key ${id}`, { x: 0, y: 0 });
      if (!tt) return null;
      keyTracks.set(id, tt);
      t = tt;
    }
    return t;
  };
  const REST = { x: 0, y: 0, r: 0, sx: 1, sy: 1 } as const;
  const reach = (i: 0 | 1, id: string): Pt => {
    // slide the paw a little towards the key (at most 4.5 units): the toes land on it
    const k = geo.keys.get(id);
    const p0 = geo.paws[i];
    if (!k) return [0, 0];
    const a = rad(geo.pawDeg);
    const tip: Pt = [p0[0] + 6.5 * Math.cos(a), p0[1] + 6.5 * Math.sin(a)];
    const dx = k[0] - tip[0];
    const dy = k[1] - tip[1];
    const len = Math.hypot(dx, dy);
    const m = len > 4.5 ? 4.5 / len : 1;
    return [dx * m, dy * m];
  };
  const ears = [q(root, '.lop .ear-l'), q(root, '.lop .ear-r')].map((el, i) => track(el, `ear${i}`, { r: 0 }));
  const dip = geo.dip;
  for (const [t, i, id] of TAPS) {
    const p = paw[i];
    const [rx, ry] = reach(i, id);
    p?.move(t - 0.16, t - 0.07, { x: rx * 0.6, y: ry * 0.6 - 4.2, r: -7, sx: 1, sy: 1 }, 'cubic-bezier(.3,.7,.4,1)')
      .move(t - 0.07, t, { x: rx, y: ry + 0.4, r: 0, sx: 1.05, sy: 0.9 }, 'cubic-bezier(.5,0,.9,.6)')
      .move(t, t + 0.11, { ...REST, x: rx * 0.35, y: ry * 0.35 }, 'cubic-bezier(.2,.7,.3,1)');
    keyTrack(id)?.move(t - 0.015, t + 0.025, { x: dip[0], y: dip[1] }, 'ease-in').move(t + 0.07, t + 0.17, { x: 0, y: 0 }, 'ease-out');
    // the ear on that side answers softly
    ears[i]?.move(t - 0.02, t + 0.1, { r: i === 0 ? 2.6 : -2.6 }, 'ease-out').move(t + 0.1, t + 0.32, { r: 0 }, 'ease-in-out');
  }
  // the thinking pause, then ENTER with his right paw: a higher wind-up, a firm press, a bigger dip
  const pr = paw[1];
  const [ex, ey] = reach(1, 'enter');
  const enterK = geo.keys.get('enter');
  const p1 = geo.paws[1];
  const far: Pt = enterK ? [enterK[0] - p1[0] - 6.5 * Math.cos(rad(geo.pawDeg)), enterK[1] - p1[1] - 6.5 * Math.sin(rad(geo.pawDeg))] : [ex, ey];
  const toE: Pt = [Math.max(-9, Math.min(9, far[0])), Math.max(-9, Math.min(9, far[1]))];
  pr?.move(2.82, 3.06, { x: toE[0] * 0.8, y: toE[1] * 0.8 - 7.5, r: -12, sx: 1, sy: 1 }, 'cubic-bezier(.3,.7,.3,1)')
    .move(3.06, 3.14, { x: toE[0] * 0.8, y: toE[1] * 0.8 - 8.6, r: -14 }, 'ease-out')
    .move(3.14, ENTER_T, { x: toE[0], y: toE[1] + 0.5, r: 0, sx: 1.08, sy: 0.86 }, 'cubic-bezier(.6,0,1,.6)')
    .move(ENTER_T, ENTER_T + 0.16, { x: toE[0], y: toE[1], sx: 1, sy: 1 }, 'cubic-bezier(.2,.7,.3,1)')
    .move(3.78, 4.18, REST, 'ease-in-out');
  keyTrack('enter')?.move(ENTER_T - 0.02, ENTER_T + 0.03, { x: dip[0] * 1.5, y: dip[1] * 1.5 }, 'ease-in').move(ENTER_T + 0.1, ENTER_T + 0.26, { x: 0, y: 0 }, 'ease-out');
  // his left paw lifts a tiny bit with the joy, then lies down again
  paw[0]?.move(ENTER_T + 0.08, ENTER_T + 0.3, { x: 0, y: -2.2, r: -4 }, 'ease-out').move(3.8, 4.16, REST, 'ease-in-out');

  // ears: the happy perk after enter (± 6°, one soft bounce)
  ears[0]?.move(ENTER_T + 0.12, ENTER_T + 0.34, { r: -6 }, 'cubic-bezier(.3,1.4,.5,1)').move(ENTER_T + 0.34, ENTER_T + 0.6, { r: -3.5 }, 'ease-in-out').move(4.2, 4.6, { r: 0 }, 'ease-in-out');
  ears[1]?.move(ENTER_T + 0.14, ENTER_T + 0.36, { r: 6 }, 'cubic-bezier(.3,1.4,.5,1)').move(ENTER_T + 0.36, ENTER_T + 0.62, { r: 3.5 }, 'ease-in-out').move(4.2, 4.6, { r: 0 }, 'ease-in-out');

  // the face: concentration (eyes a little narrower, looking at the screen, the tongue tip) → a blink in the pause →
  // enter → happy ^ ^ with puffy cheeks → a blink back to his normal eyes (= the still pose of the card)
  const eyes = track(q(root, '.eyes'), 'eyes', { x: 0, y: 0, o: 1 });
  const eye = track(q(root, '.eyes .eye:nth-child(1)'), 'eye0', { sx: 1, sy: 1 });
  const eye2 = track(q(root, '.eyes .eye:nth-child(2)'), 'eye1', { sx: 1, sy: 1 });
  const happy = track(q(root, '.eyes-happy'), 'happy', { o: 0 });
  const tongue = track(q(root, '.lt-tongue'), 'tongue', { o: 0, s: 0.3 });
  const cheeks = [q(root, '.cheek-l .cheek-j'), q(root, '.cheek-r .cheek-j')].map((el, i) => track(el, `cheek${i}`, { s: 1 }));
  for (const e of [eye, eye2]) {
    e?.move(0.22, 0.42, { sx: 1.02, sy: 0.84 }, 'ease-out')
      .move(2.66, 2.72, { sx: 1, sy: 0.12 }, 'ease-in').move(2.72, 2.82, { sx: 1.02, sy: 0.84 }, 'ease-out')
      .move(3.0, 3.12, { sx: 1.04, sy: 1.04 }, 'ease-out')
      .hold(ENTER_T + 0.1).set(ENTER_T + 0.12, { sx: 1, sy: 1 })
      .hold(4.5).move(4.5, 4.56, { sx: 1, sy: 0.12 }, 'ease-in').move(4.56, 4.7, { sx: 1, sy: 1 }, 'ease-out');
  }
  eyes?.move(0.22, 0.42, { x: 1.8, y: 1.2 }, 'ease-out')
    .move(2.84, 3.04, { x: 1.4, y: -0.8 }, 'ease-in-out')
    .move(3.04, ENTER_T, { x: 1.6, y: 0.8 }, 'ease-in')
    .set(ENTER_T + 0.12, { o: 0 })
    .hold(4.5).set(4.52, { x: 0, y: 0, o: 1 });
  happy?.hold(ENTER_T + 0.1).set(ENTER_T + 0.12, { o: 1 }).hold(4.5).set(4.52, { o: 0 });
  tongue?.move(0.4, 0.56, { o: 1, s: 1 }, 'cubic-bezier(.3,1.5,.5,1)').hold(2.6).move(2.6, 2.7, { o: 0, s: 0.4 }, 'ease-in');
  for (const c of cheeks) c?.move(ENTER_T + 0.1, ENTER_T + 0.36, { s: 1.1 }, 'cubic-bezier(.3,1.5,.5,1)').hold(4.3).move(4.3, 4.7, { s: 1 }, 'ease-in-out');

  // a small happy bounce of the whole body (his own squash group, about the feet; the paws stay on the keys)
  track(q(root, '.squash'), 'squash', { sx: 1, sy: 1 })
    ?.move(ENTER_T + 0.1, ENTER_T + 0.22, { sx: 1.025, sy: 0.975 }, 'ease-out')
    .move(ENTER_T + 0.22, ENTER_T + 0.42, { sx: 0.99, sy: 1.015 }, 'ease-in-out')
    .move(ENTER_T + 0.42, ENTER_T + 0.62, { sx: 1, sy: 1 }, 'ease-in-out');

  // the screen's light: a gentle flicker while he types, brighter at enter, back to normal
  const glow = track(q(root, '.lt-glow'), 'glow', { o: 0.6 });
  const spill = track(q(root, '.lt-spill'), 'spill', { o: 0.32 });
  const screen = track(q(root, '.lt-screen'), 'screen', { o: 0.18 });
  const flicker: ReadonlyArray<readonly [number, number]> = [[0.5, 0.62], [0.9, 0.86], [1.3, 0.66], [1.7, 0.9], [2.1, 0.7], [2.5, 0.84], [2.9, 0.74]];
  let last = 0;
  for (const [t, o] of flicker) {
    glow?.move(last, t, { o: o * 0.72 }, 'ease-in-out');
    spill?.move(last, t, { o: o * 0.42 }, 'ease-in-out');
    screen?.move(last, t, { o: 0.08 + (o - 0.62) * 0.9 }, 'ease-in-out');
    last = t;
  }
  glow?.move(ENTER_T, ENTER_T + 0.12, { o: 0.8 }, 'ease-out').move(ENTER_T + 0.4, 4.3, { o: 0.6 }, 'ease-in-out');
  spill?.move(ENTER_T, ENTER_T + 0.12, { o: 0.5 }, 'ease-out').move(ENTER_T + 0.4, 4.3, { o: 0.32 }, 'ease-in-out');
  screen?.move(ENTER_T, ENTER_T + 0.12, { o: 0.55 }, 'ease-out').move(ENTER_T + 0.4, 4.3, { o: 0.18 }, 'ease-in-out');

  // the screen: a word appears with every tap; enter sends them — they fade as the heart pops
  TAPS.forEach(([t], i) => {
    if (i >= WORDS.length) return;
    track(q(root, `.lt-word[data-w="${i}"]`), `word ${i}`, { o: 0 })
      ?.move(t + 0.01, t + 0.07, { o: 1 }, 'ease-out')
      .move(ENTER_T + 0.02 + i * 0.012, ENTER_T + 0.2 + i * 0.012, { o: 0 }, 'ease-in');
  });

  // the heart: out of the screen, a springy pop, floats up, fades
  track(q(root, '.lt-heart'), 'heart', { x: 0, y: 8, s: 0.3, o: 0 })
    ?.hold(ENTER_T + 0.04).move(ENTER_T + 0.04, ENTER_T + 0.1, { o: 1 }, 'linear')
    .move(ENTER_T + 0.04, ENTER_T + 0.36, { x: 1.5, y: -14, s: 1.15 }, 'cubic-bezier(.2,.8,.3,1.2)')
    .move(ENTER_T + 0.36, ENTER_T + 0.56, { s: 1 }, 'ease-in-out')
    .move(ENTER_T + 0.56, 4.5, { x: 3, y: -24 }, 'ease-out')
    .move(4.2, 4.5, { o: 0 }, 'ease-in')
    .set(4.52, { x: 0, y: 8, s: 0.3 });

  for (const t of tracks) if (t instanceof Track) t.hold(TYPE_S);
  return { tracks, touched };
}

/**
 * The typing on a laptop-wearing puppet: play / pause / seek(t) / destroy. Reduced: the still pose only (it stays until
 * destroy()). One mascot moves at a time: the caller keeps that rule (the app: features/sammlung, its stage).
 */
export class LaptopTyping {
  readonly duration = TYPE_S;
  private readonly parts: Parts;
  private readonly driver: Driver | null;
  private readonly watch: Watch | null;
  private destroyed = false;

  constructor(
    root: ShadowRoot,
    host: HTMLElement,
    reduced: boolean,
    private readonly onEnd?: () => void,
  ) {
    this.parts = author(root);
    if (reduced) {
      // no animate() at all: the still typing pose, written inline — and without the puppet's own short CSS
      // transitions on those parts (his eyes have one even under reduced motion): nothing moves, not even 0.1 s
      for (const el of this.parts.touched) (el as HTMLElement).style.transition = 'none';
      freezeAt(this.parts.tracks, STILL_T);
      this.driver = null;
      this.watch = null;
      return;
    }
    this.driver = new Driver(host, this.parts.tracks, TYPE_S, () => this.finish());
    this.watch = new Watch(host, this.driver);
  }

  get time(): number {
    return this.driver?.time ?? STILL_T;
  }

  get playing(): boolean {
    return this.driver?.playing ?? false;
  }

  play(): void {
    if (this.destroyed || !this.driver) return;
    this.watch?.start();
  }

  pause(): void {
    this.driver?.pause();
    this.watch?.stop();
  }

  seek(t: number): void {
    this.watch?.stop();
    this.driver?.seek(t);
  }

  /** Cancels every animation and takes back every inline style it wrote (the puppet is as before). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.watch?.destroy();
    this.driver?.destroy();
    for (const el of this.parts.touched) {
      const st = (el as HTMLElement).style;
      st.removeProperty('transform');
      st.removeProperty('opacity');
      st.removeProperty('transition');
      // his own parts had no style attribute at all: they get none back
      if (!(el.getAttribute('style') ?? '').trim()) el.removeAttribute('style');
    }
  }

  private finish(): void {
    this.watch?.stop();
    this.onEnd?.();
  }
}
