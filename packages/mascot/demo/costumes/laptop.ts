/**
 * «За ноутбуком · Im Homeoffice» v3 (31.10.2026) — GALLERY-ONLY prototype (one costume of demo/costumes).
 *
 * Felix on v2 (a big lid in front of him, he peeked over its back): «выглядит странно, он будто за чемоданом сидит.
 * Может, его развернуть как-то, и чтобы была анимация, как он тапает по клавиатуре». On v1: «совсем не доделан,
 * кривой, да и милости с фоток вообще не передалось». Photo 7: a tiny fluffy bunny next to a BIG open laptop on a
 * table, both paws on the palm rest, the keyboard seen from above, the lid at an angle — all focus.
 *
 * Why v2 read as a suitcase: we saw ONLY the flat back of the lid, square-on. A laptop is recognised by its keyboard
 * deck in perspective and the hinged lid at an angle. So here the laptop is TURNED: one small laptop model (deck,
 * keys, trackpad, lid) seen by a fixed camera — orthographic, a yaw and a look-down pitch, no shading, flat colours
 * of our palette with the puppet's contour (`cs-o`). Three compositions (`&laptop=a|b|c`, `old` = v2 as it was), all
 * with the laptop big on the floor at his front-right, him in the 3/4 turn towards it, a mug of cocoa at his left:
 *
 *   a «Экраном к нему» ⭐  turned towards him: the whole keyboard and the glowing screen at an angle (a word appears on
 *                         it with every tap; the heart pops out of it); the screen's light on his cheek
 *   b «Как на фото»       the photo's angle: from the lid's side — keyboard and the lid's back with our wish star
 *   c «Сбоку»             almost side-on: the lid a thin line, the screen a glowing strip
 *
 * A low desk (the photo's table) was tried and dropped: at this camera pitch a believable desk top is ~45 units deep
 * and covers him up to the cheeks.
 *
 * Depth (rig.ts slots): the laptop is in the static `front` slot (never hops). His paws must lie ON the keys, i.e.
 * OVER the laptop, so they are drawn there too (his own are hidden) — as a TWIN of his paws: three nested groups that
 * get a copy of every animation of his `.hop`, `.body` and `.paws` (rigLaptop wraps their animate(), the same trick as
 * the wardrobe's follow-through). So in his binky the twin paws leave the keys with him and land back on them;
 * nothing stays behind in the air. Where the puppet is a stage actor (peek / carry: no hook there, the actor svg has
 * `peek` / `run`), the laptop is simply not drawn and his own paws show — he is away from the desk.
 *
 * Typing (LaptopTyping): ONE seekable timeline (Track → Web Animations on one Playhead via drive.ts Driver; no rAF, no
 * timers; `seek(t)` = the same frame every time), transform / opacity only, finite: the last frame is the still pose,
 * then every animation is cancelled and every inline style it wrote is removed. Paused while hidden (Watch).
 * Reduced motion: no animate() at all — the still typing pose (freezeAt).
 */

import { Bunny } from '../../src/index';
import { Driver, freezeAt, Watch } from '../../src/drive';
import { star } from '../../src/shapes';
import { Track, type Sampled } from '../../src/timeline';
import type { Costume } from './costumes';
import { MODELS } from './fur';
import { ell, f, outfit as rigOutfit, poly, rrect, shift, type HidePart, type Layer, type Look, type Model, type Pt } from './rig';

// ---- the compositions ----------------------------------------------------------------------------------------------

export type LaptopVariant = 'a' | 'b' | 'c' | 'old';
export const LAPTOP_VARIANTS: readonly LaptopVariant[] = ['a', 'b', 'c', 'old'];
/** My recommendation (the card and the pose grid show it unless `&laptop=` says otherwise). */
export const LAPTOP_PICK: LaptopVariant = 'a';

let current: LaptopVariant = LAPTOP_PICK;
/** The composition the costume draws from now on (the gallery sets it from `&laptop=`; unknown → my pick). */
export function setLaptopVariant(v: string | null | undefined): LaptopVariant {
  current = (LAPTOP_VARIANTS as readonly string[]).includes(v ?? '') ? (v as LaptopVariant) : LAPTOP_PICK;
  return current;
}

/** Camera: yaw of the laptop (deg; < 0 = its hinge end turned towards us, > 0 = away), look-down pitch (deg), where
 * the middle of its front edge (palm rest, deck bottom) is on the puppet's plane (puppet units). */
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
  id: Exclude<LaptopVariant, 'old'>;
  ru: string;
  note: string;
  cam: Cam;
  box: Box;
  /** a mug of cocoa on the floor at his left (the home office; it stays put like the laptop) */
  mug: boolean;
  /** where his paws rest on the keys (laptop units: u across, v from the palm rest to the hinge) */
  paws: readonly [readonly [number, number], readonly [number, number]];
  turn: 'l' | 'r' | undefined;
  hide: readonly HidePart[];
  /** the screen glow on his face: centre / radii in face units (the side towards the screen) */
  glow: readonly [number, number, number, number];
}

const SPECS: Readonly<Record<Spec['id'], Spec>> = {
  a: {
    id: 'a',
    ru: 'Экраном к нему',
    note: 'Большой ноутбук на полу справа-спереди, повёрнут к Помпону: видна вся клавиатура и светящийся экран под углом. Помпон в повороте 3/4 смотрит в экран, обе лапки на клавишах, свет экрана на щёчке. Слева — кружка какао.',
    cam: { psi: 18, phi: 28, x: 2.5, y: -22 },
    box: { W: 112, D: 76, T: 5, H: 66, open: 106, lidT: 3, r: 7 },
    mug: true,
    paws: [[-32, 40], [22, 31]],
    turn: 'r',
    hide: ['paws', 'tail'],
    glow: [45, -77, 17, 20],
  },
  b: {
    id: 'b',
    ru: 'Как на фото',
    note: 'Ракурс фото 7: камера со стороны крышки — видна клавиатура и спинка крышки с нашей звёздочкой (никаких логотипов), экран смотрит на Помпона. Лапки на клавишах, слева кружка.',
    cam: { psi: -30, phi: 30, x: -14, y: -42 },
    box: { W: 116, D: 80, T: 5, H: 68, open: 104, lidT: 3, r: 7 },
    mug: true,
    paws: [[-34, 36], [14, 30]],
    turn: 'r',
    hide: ['paws', 'tail'],
    glow: [45, -77, 17, 20],
  },
  c: {
    id: 'c',
    ru: 'Сбоку',
    note: 'Ноутбук почти сбоку, справа от него: крышка — тонкой линией, экран светится узкой полоской, клавиатура видна сверху. Самый «строгий» силуэт.',
    cam: { psi: 7, phi: 34, x: 6, y: -20 },
    box: { W: 96, D: 78, T: 5, H: 64, open: 100, lidT: 3, r: 7 },
    mug: true,
    paws: [[-26, 37], [16, 31]],
    turn: 'r',
    hide: ['paws', 'tail'],
    glow: [45, -77, 17, 20],
  },
};

/** Tuning in the gallery only (the laptop page: &psi=&phi=&lx=&ly=&W=&D=&H=&open=&dx0=…): overrides the current spec. */
const tuned = new Map<Spec['id'], Spec>();
export function tuneLaptop(q: URLSearchParams): void {
  tuned.clear();
  if (current === 'old') return;
  const base = SPECS[current];
  const n = (k: string, d: number) => (q.get(k) !== null && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const cam = { psi: n('psi', base.cam.psi), phi: n('phi', base.cam.phi), x: n('lx', base.cam.x), y: n('ly', base.cam.y) };
  const box = { ...base.box, W: n('W', base.box.W), D: n('D', base.box.D), H: n('H', base.box.H), open: n('open', base.box.open) };
  const paws: Spec['paws'] = [[n('pa', base.paws[0][0]), n('pav', base.paws[0][1])], [n('pb', base.paws[1][0]), n('pbv', base.paws[1][1])]];
  const tq = q.get('turn');
  const turn = tq === 'r' || tq === 'l' ? tq : tq === 'none' ? undefined : base.turn;
  const mug = q.get('mug') === '0' ? false : base.mug;
  tuned.set(current, { ...base, cam, box, paws, turn, mug });
}
const spec = (v: Spec['id']): Spec => tuned.get(v) ?? SPECS[v];

const NOTE_OLD = 'v2 (31.10, отклонён: «будто за чемоданом сидит») — для сравнения: огромная крышка, он выглядывает из-за неё.';

// ---- colours: our palette, flat ------------------------------------------------------------------------------------

const COL = {
  shell: '#ECE8F4',
  edge: '#CBC4DB',
  well: '#DAD4E6',
  key: '#5E5771',
  pad: '#DED8EA',
  lidBack: '#E3DEEE',
  lidRim: '#C7BFD8',
  bezel: '#4A4458',
  screen: '#DDF1FF',
  light: '#E4F5FF',
  starFill: '#F6C25B',
  starHi: '#FFE39A',
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
  const backVisible = s.cam.psi < 0;

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

  // the lid: silhouette (rim colour) → the face we see (its back with our star, or the screen) → the heart behind it
  const lidHull = path(poly(hull([...lidIn, ...lidOut])), COL.lidRim, true);
  let lid: string;
  if (backVisible) {
    const st = star(0, 0, 9, 4.2, 5);
    const onLid = (d: string, t0: number) => {
      const n = d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push(L(n[i] as number, t0 - (n[i + 1] as number), b.lidT + 0.2));
      return poly(pts);
    };
    lid = lidHull + path(poly(lidOut), COL.lidBack) + path(onLid(st, b.H * 0.55), COL.starFill, true) + path(onLid(star(-0.8, -0.9, 3.6, 1.7, 5), b.H * 0.55), COL.starHi, false, 'opacity=".85"');
  } else {
    const bez = rr(-b.W / 2 + 0.6, 0.6, b.W / 2 - 0.6, b.H - 0.6, b.r - 0.6).map(([u, t]) => L(u, t, -0.1));
    const scr = rr(-b.W / 2 + 4, 4.2, b.W / 2 - 4, b.H - 4, 2).map(([u, t]) => L(u, t, -0.2));
    // the screen, and its light: a white veil whose opacity flickers a little while he types (never darker)
    lid = lidHull + path(poly(bez), COL.bezel) + path(poly(scr), COL.screen) + `<path class="lt-screen" d="${poly(scr)}" fill="#FFFFFF" opacity=".18"/>`;
    // what he types: soft bars ("words" — no letters), one appears per tap, all leave with enter
    lid += WORDS.map(([line, a, c], i) => {
      const t1 = b.H * (0.76 - line * 0.17);
      const u0 = -b.W / 2 + 9 + a * (b.W - 18);
      const u1 = -b.W / 2 + 9 + c * (b.W - 18);
      return `<path class="lt-word" data-w="${i}" d="${poly(rr(u0, t1 - 4.2, u1, t1, 2.1, 2).map(([u, t]) => L(u, t, -0.3)))}" fill="${COL.word}" opacity="0"/>`;
    }).join('');
  }
  // the heart rises from the lid's top edge: from behind the lid when we see its back (a, c), out of the screen (b)
  const top = backVisible ? L(0, b.H, 0) : L(0, b.H * 0.62, -1);
  const heart = `<g class="lt-heart lt-v" ${origin(top[0], top[1])} opacity="0">${path(shift(HEART, top[0], top[1]), COL.heart, true)}${path(shift(HEART_HI, top[0], top[1]), COL.heartHi, false, 'opacity=".9"')}</g>`;

  // his paws on the keys: a twin of his own (same colour, contour and toe lines), inside three mirror groups
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
  // we see the lid's back (a, c): it stands in front of the deck's far end; we see the screen (b): it is behind it
  const body = backVisible ? deck + heart + lid : lid + deck + heart;
  return {
    front: `<g class="lt-root" data-variant="${s.id}">${s.mug ? MUG : ''}${body}${hop}</g>${styleOnce(uid)}`,
    keys,
    paws,
    pawDeg,
    dip: [dip[0] * 1.3, dip[1] * 1.3],
  };
}

const HEART = 'M0 4 C-4 1 -9 -2.6 -9 -7 C-9 -10.4 -6.4 -12.6 -3.8 -12.6 C-2 -12.6 -0.6 -11.6 0 -10 C0.6 -11.6 2 -12.6 3.8 -12.6 C6.4 -12.6 9 -10.4 9 -7 C9 -2.6 4 1 0 4 Z';
const HEART_HI = 'M-6.2 -8.6 C-6.2 -10 -5 -10.9 -3.8 -10.6 C-3 -10.4 -2.9 -9.4 -3.6 -9 C-4.4 -8.5 -5 -8 -5.4 -7.2 C-5.8 -6.6 -6.3 -7.6 -6.2 -8.6 Z';

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

/** The costume's own CSS (one per puppet: undress removes it with the layer). */
function styleOnce(uid: string): string {
  return `<style data-lt="${uid}">
.lt-v { transform-box: view-box; }
svg.peek .lt-root, svg.run .lt-root, svg.peek .lt-face, svg.run .lt-face { display: none; }
svg.peek .hm .paw, svg.run .hm .paw { visibility: visible; }
</style>`;
}

// ---- v2 (31.10, rejected) as it was, for comparison ------------------------------------------------------------------

function oldFront(): string {
  const stroke = (d: string, color: string, w: number) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return path(ell(0, -76, 46, 9), '#CFE6FF', false, 'opacity=".45"')
    + path('M-98 -2 L98 -2 L102 4 Q102 8 97 8 L-97 8 Q-102 8 -102 4 Z', '#B9C0C8', true)
    + path(rrect(-92, -74, 184, 74, 10), '#DCE1E6', true)
    + path(rrect(-86, -69, 172, 5, 2.5), '#FFFFFF', false, 'opacity=".55"')
    + path(rrect(66, -66, 20, 62, 8), '#C9CFD6', false, 'opacity=".5"')
    + path(star(0, -40, 15, 7, 5), '#F6C25B', true) + path(star(-1.6, -41.6, 6, 2.8, 5), '#FFE39A', false, 'opacity=".8"')
    + path('M44 -26 C44 -31 50 -33 53 -28 C56 -33 62 -31 62 -26 C62 -20 56 -16 53 -13 C50 -16 44 -20 44 -26 Z', '#F4A9BD', true)
    + path(ell(-24, -76.6, 11, 7.6, -8), 'var(--mascot-paw)', true) + path(ell(24, -76.6, 11, 7.6, 8), 'var(--mascot-paw)', true)
    + stroke('M-30 -73 l.6 2.3 M-24.6 -72.2 l.3 2.4 M-19 -72.8 l-.2 2.3 M30 -73 l-.6 2.3 M24.6 -72.2 l-.3 2.4 M19 -72.8 l.2 2.3', 'rgba(150,90,40,.35)', 1.2);
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

/** The look of one composition (the card, the grid and the laptop page build several side by side). */
export function laptopLayers(v: LaptopVariant): Layer[] {
  if (v === 'old') return [{ slot: 'front', draw: () => oldFront() }];
  const s = spec(v);
  return [
    { slot: 'front', draw: (c) => build(s, c.uid).front },
    { slot: 'face-under', draw: (c) => glowMarkup(s, c.uid) },
    { slot: 'face', draw: () => TONGUE },
  ];
}

export function laptopLook(v: LaptopVariant): Look {
  return { id: 'laptop', layers: laptopLayers(v), hide: v === 'old' ? ['feet', 'tail', 'paws'] : spec(v).hide };
}

export function laptopTurn(v: LaptopVariant): 'l' | 'r' | undefined {
  return v === 'old' ? undefined : spec(v).turn;
}

export function laptopName(v: LaptopVariant): string {
  return v === 'old' ? 'v2 (старый)' : `${v.toUpperCase()} «${SPECS[v].ru}»${v === LAPTOP_PICK ? ' ⭐' : ''}`;
}

/** The costume entry of costumes.ts: everything follows the composition chosen with setLaptopVariant(). */
export const laptop: Costume = {
  id: 'laptop',
  ru: 'За ноутбуком',
  de: 'Im Homeoffice',
  photos: [7],
  get note() {
    return current === 'old' ? NOTE_OLD : `v3 (31.10), композиция ${laptopName(current)}. ${SPECS[current].note} Кнопка «⌨ печатает» — анимация: лапки по очереди стучат по клавишам, Enter — и из экрана выскакивает сердечко.`;
  },
  who: ['pompon'],
  get hide() {
    return current === 'old' ? (['feet', 'tail', 'paws'] as const) : spec(current).hide;
  },
  get turn() {
    return laptopTurn(current);
  },
  layers: () => laptopLayers(current),
};

// ---- the twin paws follow his hop (gallery wiring) -------------------------------------------------------------------

const rigged = new WeakSet<Element>();
const MIRRORS: ReadonlyArray<readonly [string, string]> = [['.hop', '.lt-m-hop'], ['.body', '.lt-m-body'], ['.tp .paws', '.lt-m-paws']];

/**
 * Once per puppet: every animation his `.hop`, `.body` or `.paws` gets is copied onto the twin paws' groups (same
 * keyframes, same timing, started in the same call — so they are paused, seeked and cancelled together). The twin
 * groups are looked up at call time: taking the laptop off (or another composition) needs nothing.
 */
export function rigLaptop(root: ShadowRoot): void {
  for (const [src, dst] of MIRRORS) {
    const el = root.querySelector(src);
    if (!el || rigged.has(el) || typeof el.animate !== 'function') continue;
    rigged.add(el);
    const own = el.animate;
    Object.defineProperty(el, 'animate', {
      configurable: true,
      value(this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
        const a = own.call(this, frames, options);
        const twin = root.querySelector(dst);
        if (twin) {
          const b = Element.prototype.animate.call(twin, frames, options);
          a.addEventListener('cancel', () => b.cancel());
        }
        return a;
      },
    });
  }
}

/** rig.ts outfit + the twin-paw wiring when the look is the laptop (the gallery imports outfit from here). */
export function outfit(root: ShadowRoot, m: Model, look?: Look | null, extra: ReadonlyArray<Look | null> = []): SVGGElement[] {
  const boxes = rigOutfit(root, m, look, extra);
  if (look?.id === 'laptop') rigLaptop(root);
  return boxes;
}

// ---- typing: one seekable timeline -----------------------------------------------------------------------------------

/** Seconds the typing takes; the last frame is the still pose again. */
export const TYPE_S = 4.9;
/** The still typing pose (reduced motion, the frozen frame): concentrating, tongue out. */
export const STILL_T = 1.62;
/** Key frames for the contact sheet (s). */
export const TYPE_FRAMES = [0, 0.42, 0.58, 0.8, 1.62, 2.32, 2.85, 3.12, 3.24, 3.42, 3.75, 4.3, 4.9];

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

/** The typing choreography on the dressed puppet in `root` (composition `v`, a / b / c). */
function author(root: ShadowRoot, v: Exclude<LaptopVariant, 'old'>): Parts {
  const s = spec(v);
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

  // the screen (a, c): a word appears with every tap; enter sends them — they fade as the heart pops
  TAPS.forEach(([t], i) => {
    if (i >= WORDS.length) return;
    track(q(root, `.lt-word[data-w="${i}"]`), `word ${i}`, { o: 0 })
      ?.move(t + 0.01, t + 0.07, { o: 1 }, 'ease-out')
      .move(ENTER_T + 0.02 + i * 0.012, ENTER_T + 0.2 + i * 0.012, { o: 0 }, 'ease-in');
  });

  // the heart: out of the screen (from behind the lid's top edge in a), a springy pop, floats up, fades
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
 * The typing on a dressed, laptop-wearing puppet: play / pause / seek(t) / destroy. Reduced: the still pose only.
 * One mascot moves at a time on the page: the caller keeps that rule (the card button / the player).
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
    v: Exclude<LaptopVariant, 'old'>,
    reduced: boolean,
    private readonly onEnd?: () => void,
  ) {
    this.parts = author(root, v);
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
    }
  }

  private finish(): void {
    this.watch?.stop();
    this.onEnd?.();
  }
}

// ---- the gallery page: ?screens=costumes&view=laptop -----------------------------------------------------------------

type ThemeVars = Readonly<Record<string, Readonly<Record<string, string>>>>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** One dressed Pompon (the laptop of composition v) in a box; frozen like the gallery's cells. */
export function laptopFigure(parent: HTMLElement, v: LaptopVariant, size: number, reduced: boolean, label?: string): { bunny: Bunny; host: HTMLElement } {
  const box = el('div', 'cs-box');
  box.style.width = `${size + 16}px`;
  box.style.height = `${Math.round(size * 0.86)}px`;
  const host = el('div', 'cs-host');
  host.style.left = '8px';
  host.style.bottom = `${Math.round(size * 0.04)}px`;
  box.append(host);
  if (label) box.append(el('small', undefined, label));
  parent.append(box);
  const bunny = new Bunny(host, { size, idle: false, interactive: false, reducedMotion: reduced ? 'force' : 'off', coat: 'fawn', ears: 'lop' });
  outfit(bunny.root, MODELS.pompon, laptopLook(v));
  const turn = laptopTurn(v);
  if (turn) bunny.root.querySelector('.hm')?.classList.add(turn === 'l' ? 'turn-l' : 'turn-r');
  for (const a of bunny.root.querySelector('svg')?.getAnimations?.({ subtree: true }) ?? []) {
    a.pause();
    a.currentTime = 0;
  }
  return { bunny, host };
}

/** The «⌨ печатает» button of the laptop card (costume tab): types on the card's big figure. */
export function laptopCardButton(app: HTMLElement, reduced: boolean): void {
  const card = app.querySelector<HTMLElement>('.cs-card[data-item="laptop"]');
  const host = card?.querySelector<HTMLElement>('.cs-host');
  const root = host?.shadowRoot;
  if (!card || !host || !root) return;
  const more = el('a', 'ph', 'все три композиции, старый v2 и анимация по кадрам →');
  more.href = `?screens=costumes&view=laptop${current === LAPTOP_PICK ? '' : `&laptop=${current}`}`;
  if (current === 'old') {
    card.append(more);
    return;
  }
  const b = el('button', undefined, reduced ? '⌨ печатает (меньше движения: поза)' : '⌨ печатает (4,9 с)');
  b.type = 'button';
  b.style.marginTop = '-2px';
  let run: LaptopTyping | null = null;
  b.addEventListener('click', () => {
    // one thing at a time: not while he is in his binky (the card's other button)
    if (run || root.querySelector('.hop')?.getAnimations().some((a) => a.playState === 'running')) return;
    const jump = card.querySelector<HTMLButtonElement>('button:not([data-lt])');
    for (const a of root.querySelector('svg')?.getAnimations?.({ subtree: true }) ?? []) if (a.playState === 'paused') a.play();
    if (jump) jump.disabled = true;
    const v = current as Exclude<LaptopVariant, 'old'>;
    run = new LaptopTyping(root, host, v, reduced, () => {
      run?.destroy();
      run = null;
      if (jump && !reduced) jump.disabled = false;
    });
    if (reduced) return;
    run.play();
  });
  b.dataset['lt'] = '1';
  card.append(b, more);
}

export function laptopView(app: HTMLElement, q: URLSearchParams, themes: ThemeVars): void {
  const theme = q.get('theme') && themes[q.get('theme') as string] ? (q.get('theme') as string) : 'light';
  const reduced = q.get('reduced') === '1';
  const v = setLaptopVariant(q.get('laptop'));
  tuneLaptop(q);
  const typing: Exclude<LaptopVariant, 'old'> = v === 'old' ? LAPTOP_PICK as Exclude<LaptopVariant, 'old'> : v;
  const vars = themes[theme] ?? {};
  const panel = (title: string) => {
    const p = el('section', 'cs-panel');
    for (const [k, val] of Object.entries(vars)) p.style.setProperty(k, val);
    p.append(el('h2', undefined, title));
    app.append(p);
    return p;
  };
  const link = (label: string, entries: ReadonlyArray<readonly [string, string]>, key: string) => {
    const bar = el('div', 'cs-bar');
    bar.append(el('b', undefined, label));
    for (const [value, text] of entries) {
      const next = new URLSearchParams(q);
      if (value) next.set(key, value);
      else next.delete(key);
      const a = el('a', undefined, text);
      a.href = `?${next.toString()}`;
      a.setAttribute('aria-current', String((q.get(key) ?? '') === value));
      bar.append(a);
    }
    app.append(bar);
  };

  if (!document.getElementById('lt-page-css')) {
    const css = el('style');
    css.id = 'lt-page-css';
    css.textContent = `.lt-cmp { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 10px; }
.lt-cmp-cell { background: var(--cs-bg); color: var(--cs-text); border-radius: 18px; padding: 10px 12px 12px; box-shadow: 0 0 0 1px var(--cs-line); display: flex; flex-direction: column; gap: 6px; }
.lt-cmp-cell > b { font-size: 15px; }
.lt-cmp-cell .what { font-size: 12.5px; line-height: 1.45; color: var(--cs-text2); }
.cs-panel .cs-note { color: var(--cs-text2); }`;
    document.head.append(css);
  }
  app.append(el('h1', undefined, 'За ноутбуком v3 · Im Homeoffice'));
  app.append(el('p', 'sub', 'Ты про v2: «выглядит странно, он будто за чемоданом сидит. Может, его развернуть как-то, и чтобы была анимация, как он тапает по клавиатуре». Теперь ноутбук повёрнут: сверху видна клавиатура, крышка — под углом, лапки Помпона лежат на клавишах. Три композиции на выбор, старый v2 — для сравнения. Только галерея.'));
  link('Композиция', LAPTOP_VARIANTS.map((x): [string, string] => [x === LAPTOP_PICK ? '' : x, laptopName(x)]), 'laptop');
  link('Тема', Object.keys(themes).map((t): [string, string] => [t === 'light' ? '' : t, t]), 'theme');
  link('Движение', [['', 'Полное'], ['1', 'Меньше движения']], 'reduced');
  const back = el('p', 'cs-note');
  const toCard = el('a', undefined, '← карточка костюма');
  toCard.href = `?screens=costumes&only=laptop${v === LAPTOP_PICK ? '' : `&laptop=${v}`}`;
  const toGrid = el('a', undefined, ' · все позы, пять тем →');
  toGrid.href = `?screens=costumes&view=grid&only=laptop&theme=all${v === LAPTOP_PICK ? '' : `&laptop=${v}`}`;
  back.append(toCard, toGrid);
  app.append(back);

  // 1 · the compositions side by side
  const cmp = panel('Композиции рядом (148 · 96 · 64 px)');
  cmp.dataset['laptop'] = 'compare';
  const grid = el('div', 'lt-cmp');
  cmp.append(grid);
  for (const x of LAPTOP_VARIANTS) {
    const cell = el('div', 'lt-cmp-cell');
    cell.dataset['variant'] = x;
    cell.append(el('b', undefined, laptopName(x)));
    const row = el('div', 'cs-row');
    cell.append(row);
    laptopFigure(row, x, 148, true);
    laptopFigure(row, x, 96, true);
    laptopFigure(row, x, 64, true);
    cell.append(el('div', 'what', x === 'old' ? NOTE_OLD : SPECS[x].note));
    grid.append(cell);
  }

  // 2 · the player
  const play = panel(`Печатает — композиция ${laptopName(typing)} (${TYPE_S.toFixed(1).replace('.', ',')} с, кадр по ползунку)`);
  play.dataset['laptop'] = 'player';
  const stage = el('div', 'cs-row');
  play.append(stage);
  const { bunny: big, host: bigHost } = laptopFigure(stage, typing, 380, reduced);
  const ctrl = el('div', 'cs-bar');
  play.append(ctrl);
  const btn = el('button', undefined, reduced ? 'Меньше движения: неподвижная поза' : '▶ играть');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.max = String(TYPE_S);
  range.step = '0.01';
  range.style.width = '320px';
  const label = el('span', undefined, '');
  ctrl.append(btn, range, label);
  const run = new LaptopTyping(big.root, bigHost, typing, reduced);
  const show = (t: number) => {
    range.value = String(t);
    label.textContent = `t = ${t.toFixed(2)} с`;
  };
  const tq = q.get('t');
  if (reduced) {
    btn.disabled = true;
    range.disabled = true;
    show(STILL_T);
  } else {
    const t0 = tq !== null ? Number(tq) : 0;
    run.seek(Number.isFinite(t0) ? t0 : 0);
    show(run.time);
    btn.addEventListener('click', () => {
      if (run.playing) {
        run.pause();
        btn.textContent = '▶ играть';
        show(run.time);
        return;
      }
      if (run.time >= TYPE_S - 0.01) run.seek(0);
      run.play();
      btn.textContent = '❚❚ пауза';
    });
    range.addEventListener('input', () => {
      run.seek(Number(range.value));
      btn.textContent = '▶ играть';
      show(Number(range.value));
    });
  }
  play.append(el('p', 'cs-note', 'Кадр за кадром: 0–0,4 с сосредоточился (глаза чуть уже, смотрит в экран, кончик язычка) · 0,4–2,6 с лапки по очереди стучат по клавишам, нажатые клавиши проседают, ушко на той стороне чуть кивает, на экране с каждым нажатием появляется «слово» (полоска, без букв), свет экрана мягко мерцает · 2,6–3,1 с пауза «подумать», моргнул, правая лапка замахивается · 3,24 с Enter (крупная клавиша проседает сильнее), слова уходят · 3,3 с из экрана выскакивает сердечко и улетает вверх · 3,35 с радость: глаза ^ ^, щёчки надуваются, ушки торчком, маленький подскок · 4,5 с моргнул — снова обычный, как на карточке.'));

  // 3 · the frames
  const frames = panel(`По кадрам — ${laptopName(typing)} (каждый кадр заморожен: seek)`);
  frames.dataset['laptop'] = 'frames';
  const strip = el('div', 'cs-sheet');
  strip.style.gridTemplateColumns = 'repeat(auto-fill, 196px)';
  frames.append(strip);
  for (const t of TYPE_FRAMES) {
    const fig = el('figure');
    strip.append(fig);
    const row = el('div', 'cs-row');
    fig.append(row);
    const { bunny, host } = laptopFigure(row, typing, 180, false);
    const r = new LaptopTyping(bunny.root, host, typing, false);
    r.seek(t);
    const cap = el('figcaption');
    cap.append(el('b', undefined, `t = ${t.toFixed(2)} с`));
    fig.append(cap);
  }

  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset['ready'] = '1')));
}
