/**
 * The seasons' props (drawn for the gallery's «Листопад / Снегопад», demo/seasons; moved here 31.10 because the
 * Sammlung's maple-leaf outfit is this very leaf — demo/seasons/props.ts re-exports this file): a Norway maple leaf, an
 * English oak leaf and snowflakes, drawn in bunny units. Pure — markup strings and geometry, no DOM — so the gallery's
 * scene.ts can animate them and the tests can check the botany (palmate veins from one point, six-fold flakes).
 *
 * Norway maple (Acer platanoides): five lobes (three big ones, two small basal ones), each lobe and its few long
 * teeth drawn out into fine points, ROUNDED sinuses between the lobes, broader than long, a heart-shaped base,
 * a long petiole; PALMATE venation — five main veins from one point at the top of the petiole, one into each lobe
 * tip, side veins into the teeth. English oak (Quercus robur): obovate, five pairs of rounded lobes, ear-like
 * auricles at the base, a very short petiole, PINNATE veins (a midrib with a side vein into each lobe).
 * Every leaf has two faces: the upper one (glossy, saturated) and the underside (paler, matte, raised pale veins),
 * which shows when the leaf flips over in its fall. Outlines are smooth cubic Béziers, slightly asymmetric.
 */

import type { Vec } from '../welcome-actors';

// ---------- tiny vector helpers ----------

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const norm = (a: Vec): Vec => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const mix = (a: Vec, b: Vec, k: number): Vec => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
/** Unit vector `deg` degrees clockwise from straight up (screen coordinates: y grows downwards). */
const dir = (deg: number): Vec => ({ x: Math.sin((deg * Math.PI) / 180), y: -Math.cos((deg * Math.PI) / 180) });
const f2 = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
const pt = (p: Vec): string => `${f2(p.x)} ${f2(p.y)}`;

// ---------- smooth outlines ----------

/** One corner of an outline: a sharp point (lobe / tooth tip) or a smooth bend (sinus, bay, rounded lobe). */
export interface Vertex {
  p: Vec;
  kind: 'tip' | 'smooth';
  /** tip: the direction it points to (outwards); its sides leave it bent towards this axis = a drawn-out point */
  axis?: Vec;
  /** tip: 0..1 how drawn-out (acuminate) the point is; smooth: handle length (share of the neighbour distance) */
  k?: number;
}

interface Seg {
  a: Vec;
  c1: Vec;
  c2: Vec;
  b: Vec;
}

/** A closed outline through `vs` as cubic Béziers: tangent-continuous at smooth vertices, sharp at tips. */
export function segments(vs: readonly Vertex[]): Seg[] {
  const n = vs.length;
  const handles = vs.map((v, i) => {
    const prev = vs[(i - 1 + n) % n]!.p;
    const next = vs[(i + 1) % n]!.p;
    const dPrev = len(sub(v.p, prev));
    const dNext = len(sub(next, v.p));
    if (v.kind === 'smooth') {
      const t = norm(sub(next, prev));
      const k = v.k ?? 0.36;
      return { hin: sub(v.p, mul(t, k * dPrev)), hout: add(v.p, mul(t, k * dNext)) };
    }
    const back = mul(v.axis ?? { x: 0, y: -1 }, -1);
    const acum = v.k ?? 0.4;
    const dIn = norm(mix(norm(sub(prev, v.p)), back, acum));
    const dOut = norm(mix(norm(sub(next, v.p)), back, acum));
    return { hin: add(v.p, mul(dIn, 0.32 * dPrev)), hout: add(v.p, mul(dOut, 0.32 * dNext)) };
  });
  return vs.map((v, i) => {
    const j = (i + 1) % n;
    return { a: v.p, c1: handles[i]!.hout, c2: handles[j]!.hin, b: vs[j]!.p };
  });
}

export function pathD(segs: readonly Seg[]): string {
  const first = segs[0];
  if (!first) return '';
  return `M${pt(first.a)}${segs.map((s) => ` C${pt(s.c1)} ${pt(s.c2)} ${pt(s.b)}`).join('')}Z`;
}

const bez = (s: Seg, t: number): Vec => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * s.a.x + b * s.c1.x + c * s.c2.x + d * s.b.x, y: a * s.a.y + b * s.c1.y + c * s.c2.y + d * s.b.y };
};

/** The outline as a dense polygon (`per` points per segment), for hit tests. */
export function sampleOutline(segs: readonly Seg[], per = 8): Vec[] {
  const out: Vec[] = [];
  for (const s of segs) for (let i = 0; i < per; i++) out.push(bez(s, i / per));
  return out;
}

// ---------- the leaves ----------

export type LeafKind = 'maple' | 'oak';

export interface Vein {
  from: Vec;
  /** control point of the (slightly bowed) quadratic vein */
  c: Vec;
  to: Vec;
}

export interface LeafShape {
  kind: LeafKind;
  vertices: Vertex[];
  segs: Seg[];
  /** the blade's outline, dense (bunny units around the leaf's middle) */
  outline: Vec[];
  /** where the petiole meets the blade (maple: where all main veins start) */
  base: Vec;
  /** main veins: maple = palmate, all from `base`; oak = the midrib */
  main: Vein[];
  /** side veins (into the teeth / lobes) */
  side: Vein[];
  /** the petiole: a quadratic from `base` (start, control, end) */
  petiole: readonly [Vec, Vec, Vec];
  petioleWidth: number;
  /** the radius of a circle around the origin that holds blade and petiole */
  radius: number;
}

/** One traced point of the maple's outline (scan pixels): a sharp tip pointing `ax`° (clockwise from up), or a smooth bend. */
interface Traced {
  x: number;
  y: number;
  /** a tip: the direction it points to; absent = a smooth bend (bay, sinus, margin) */
  ax?: number;
  /** tip: how drawn-out; smooth: handle length */
  k?: number;
  /** the tip of a lobe: a main vein runs into it */
  lobe?: true;
}

/**
 * Norway maple (Acer platanoides), traced from a herbarium scan — Wikimedia Commons, "2020 year. Herbarium. Acer
 * platanoides. img-014.jpg" (500 px wide): five lobes (the side lobes at about -45° / +39°, the basal ones almost
 * level at -84° / +76°, a small lobule under each at -120° / +113°), SHALLOW round sinuses so the blade is full and
 * the lobes are broad triangles, a few long teeth with fine points high on each lobe; asymmetric like the real
 * leaf (its left half is the larger one). Clockwise from the notch at the petiole; the veins meet at MAPLE_J.
 */
const MAPLE_TRACE: readonly Traced[] = [
  { x: 228, y: 383, k: 0.34 },
  { x: 170, y: 416, ax: -125, k: 0.5 },
  { x: 138, y: 378, k: 0.3 },
  { x: 103, y: 361, ax: -105, k: 0.4 },
  { x: 70, y: 345, k: 0.3 },
  { x: 14, y: 328, ax: -86, k: 0.5, lobe: true },
  { x: 72, y: 313, k: 0.32 },
  { x: 117, y: 293, k: 0.4 },
  { x: 38, y: 224, ax: -80, k: 0.45 },
  { x: 73, y: 205, k: 0.3 },
  { x: 28, y: 108, ax: -48, k: 0.5, lobe: true },
  { x: 92, y: 139, k: 0.3 },
  { x: 123, y: 149, k: 0.3 },
  { x: 140, y: 133, ax: 18, k: 0.45 },
  { x: 166, y: 166, k: 0.3 },
  { x: 192, y: 178, k: 0.4 },
  { x: 207, y: 88, ax: -30, k: 0.45 },
  { x: 226, y: 110, k: 0.3 },
  { x: 276, y: 15, ax: 0, k: 0.5, lobe: true },
  { x: 321, y: 112, k: 0.3 },
  { x: 348, y: 97, ax: 30, k: 0.45 },
  { x: 345, y: 180, k: 0.4 },
  { x: 397, y: 141, ax: 4, k: 0.45 },
  { x: 418, y: 148, k: 0.3 },
  { x: 480, y: 106, ax: 50, k: 0.5, lobe: true },
  { x: 457, y: 185, k: 0.3 },
  { x: 470, y: 212, ax: 86, k: 0.45 },
  { x: 433, y: 236, k: 0.3 },
  { x: 425, y: 272, k: 0.4 },
  { x: 488, y: 300, ax: 80, k: 0.5, lobe: true },
  { x: 452, y: 329, k: 0.3 },
  { x: 438, y: 357, ax: 115, k: 0.4 },
  { x: 406, y: 366, k: 0.3 },
  { x: 395, y: 407, ax: 135, k: 0.5 },
  { x: 335, y: 378, k: 0.34 },
  { x: 276, y: 366, ax: 180, k: 0.75 },
];

/** Where the five main veins meet (the top of the petiole), in the scan's pixels. */
const MAPLE_J: Vec = { x: 276, y: 355 };
/** Scan pixels -> bunny units (the blade ≈ 36 units across, as wide as the v1 leaf). */
const MAPLE_K = 0.076;

function mapleShape(): LeafShape {
  const raw = (p: Vec): Vec => ({ x: (p.x - MAPLE_J.x) * MAPLE_K, y: (p.y - MAPLE_J.y) * MAPLE_K });
  const vs: Vertex[] = MAPLE_TRACE.map((t) => t.ax === undefined
    ? { p: raw(t), kind: 'smooth', k: t.k }
    : { p: raw(t), kind: 'tip', axis: dir(t.ax), k: t.k });
  // move the blade's middle to the origin (it turns about its middle when it falls)
  const pts0 = sampleOutline(segments(vs));
  const minX = Math.min(...pts0.map((p) => p.x));
  const maxX = Math.max(...pts0.map((p) => p.x));
  const minY = Math.min(...pts0.map((p) => p.y));
  const maxY = Math.max(...pts0.map((p) => p.y));
  const shift: Vec = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 };
  const mv = (p: Vec) => add(p, shift);
  const vertices = vs.map((v) => ({ ...v, p: mv(v.p) }));
  const segs = segments(vertices);
  const outline = sampleOutline(segs);
  const base = mv(raw(MAPLE_J));
  // PALMATE: one main vein from the junction into each lobe tip, bowed a hair
  const tips = vertices.filter((_, i) => MAPLE_TRACE[i]?.lobe);
  const main: Vein[] = tips.map((t, i) => {
    const d = sub(t.p, base);
    const n = { x: -d.y, y: d.x };
    return { from: base, c: add(mix(base, t.p, 0.5), mul(n, i % 2 ? -0.025 : 0.025)), to: t.p };
  });
  const side: Vein[] = [];
  // a side vein into every tooth / lobule, leaving the main vein it belongs to (the nearest in angle)
  vertices.forEach((v, i) => {
    if (v.kind !== 'tip' || MAPLE_TRACE[i]?.lobe || i === vertices.length - 1) return;
    const dv = sub(v.p, base);
    let best = main[0]!;
    let bestCos = -2;
    for (const m of main) {
      const dm = sub(m.to, base);
      const c = (dv.x * dm.x + dv.y * dm.y) / (len(dv) * len(dm) || 1);
      if (c > bestCos) {
        bestCos = c;
        best = m;
      }
    }
    const dm = sub(best.to, base);
    const along = Math.max(0.12, Math.min(0.75, ((dv.x * dm.x + dv.y * dm.y) / (len(dm) ** 2 || 1)) * 0.62));
    const from = add(base, mul(dm, along));
    side.push({ from, c: mix(from, v.p, 0.5), to: mix(from, v.p, 0.9) });
  });
  // and a pair of finer secondary veins along each of the three big lobes' main veins
  main.forEach((m) => {
    const dm = sub(m.to, base);
    // only the middle and the two side lobes (the basal veins run too close to the lower margin)
    if (len(dm) < 22) return;
    const deg = (Math.atan2(dm.x, -dm.y) * 180) / Math.PI;
    for (const f of [0.32, 0.55]) {
      for (const sg of [-1, 1]) {
        const from = add(base, mul(dm, f));
        const to = add(from, mul(dir(deg + sg * 52), 0.2 * len(dm)));
        side.push({ from, c: mix(from, to, 0.5), to });
      }
    }
  });
  // a long petiole (Norway maple: about as long as the blade), gently curved
  const petiole: [Vec, Vec, Vec] = [base, add(base, { x: -1.4, y: 8 }), add(base, { x: 1.6, y: 15.5 })];
  const radius = Math.max(...[...outline, petiole[2]].map(len)) + 0.6;
  return { kind: 'maple', vertices, segs, outline, base, main, side, petiole, petioleWidth: 1.3, radius };
}

/** English oak: obovate, rounded lobes, auricles at the base, a stub of a petiole, pinnate veins. */
function oakShape(): LeafShape {
  // along the midrib: y from +13 (base) to -15 (apex); lobes per side as [y, half-width], base to apex
  const right: ReadonlyArray<readonly [number, number]> = [[9.2, 4.6], [4.4, 7.4], [-1.6, 9.4], [-7.4, 8.6], [-12, 5.6]];
  const left: ReadonlyArray<readonly [number, number]> = [[9.6, 4.2], [4.9, 7], [-1, 8.8], [-7, 8.9], [-11.6, 5.9]];
  const sinusIn = 0.5;
  const vs: Vertex[] = [];
  const side: Vein[] = [];
  // the base: two auricles (small ear-like lobes) folded around the petiole
  vs.push({ p: { x: 0, y: 13.6 }, kind: 'tip', axis: { x: 0, y: 1 }, k: 0.6 });
  vs.push({ p: { x: 2.2, y: 14 }, kind: 'smooth', k: 0.5 });
  // up the right side: sinus, lobe, sinus, lobe … (rounded lobes; the sinuses are narrower rounded bends)
  right.forEach(([y, w], i) => {
    const prevY = i === 0 ? 13.2 : right[i - 1]![0];
    const sy = (y + prevY) / 2;
    const sw = (w + (i === 0 ? 2.4 : right[i - 1]![1])) / 2;
    vs.push({ p: { x: sw * sinusIn, y: sy }, kind: 'smooth', k: 0.22 });
    vs.push({ p: { x: w, y }, kind: 'smooth', k: 0.42 });
    side.push({ from: { x: 0, y: y + 3.2 }, c: { x: w * 0.45, y: y + 1.4 }, to: { x: w * 0.82, y: y + 0.2 } });
  });
  vs.push({ p: { x: 2.4, y: -14.1 }, kind: 'smooth', k: 0.3 });
  // the rounded apex
  vs.push({ p: { x: 0.3, y: -15.6 }, kind: 'smooth', k: 0.45 });
  vs.push({ p: { x: -2.2, y: -14.3 }, kind: 'smooth', k: 0.3 });
  for (let i = left.length - 1; i >= 0; i--) {
    const [y, w] = left[i]!;
    const prevY = i === 0 ? 13.2 : left[i - 1]![0];
    const sw = (w + (i === 0 ? 2.4 : left[i - 1]![1])) / 2;
    vs.push({ p: { x: -w, y }, kind: 'smooth', k: 0.42 });
    vs.push({ p: { x: -sw * sinusIn, y: (y + prevY) / 2 }, kind: 'smooth', k: 0.22 });
    side.push({ from: { x: 0, y: y + 3.2 }, c: { x: -w * 0.45, y: y + 1.4 }, to: { x: -w * 0.82, y: y + 0.2 } });
  }
  vs.push({ p: { x: -2.2, y: 14 }, kind: 'smooth', k: 0.5 });
  const segs = segments(vs);
  const outline = sampleOutline(segs);
  const base: Vec = { x: 0, y: 13.6 };
  const petiole: [Vec, Vec, Vec] = [base, { x: 0.2, y: 15.4 }, { x: 0.5, y: 17.2 }];
  const radius = Math.max(...[...outline, petiole[2]].map(len)) + 0.6;
  return {
    kind: 'oak', vertices: vs, segs, outline, base,
    main: [{ from: base, c: { x: 0.4, y: 0 }, to: { x: 0.3, y: -14.2 } }],
    side, petiole, petioleWidth: 1.5, radius,
  };
}

export const MAPLE: LeafShape = mapleShape();
export const OAK: LeafShape = oakShape();
export const LEAVES: Record<LeafKind, LeafShape> = { maple: MAPLE, oak: OAK };

/** Autumn colours of one leaf: upper face (inner → outer), underside, veins, rim, petiole. */
export interface LeafPalette {
  top: readonly [string, string, string];
  under: readonly [string, string];
  vein: string;
  underVein: string;
  rim: string;
  stem: string;
}

export const PALETTES = {
  /** golden at the petiole, orange, flushed red at the lobe tips (Norway maple's warm end) */
  amber: { top: ['#F7C64A', '#EF8E34', '#D9532A'], under: ['#F6D88E', '#E8AE62'], vein: '#FFE29A', underVein: '#FFF4D6', rim: '#A5441E', stem: '#B85A2A' },
  /** clear yellow (the usual Norway maple) */
  gold: { top: ['#F8DC6A', '#F2C043', '#E39A2F'], under: ['#F3E3A4', '#E2C47A'], vein: '#FFF0B0', underVein: '#FFF8E0', rim: '#B07A20', stem: '#B98A3A' },
  /** oak: russet brown with a tan middle */
  russet: { top: ['#D9A25A', '#BF7A3A', '#9A5A2C'], under: ['#E2C08E', '#C99C66'], vein: '#EDC98A', underVein: '#F6E2BE', rim: '#6E3E1C', stem: '#7A4A26' },
} as const satisfies Record<string, LeafPalette>;

export type PaletteName = keyof typeof PALETTES;

/** Veins as quadratic curves; `reach` < 1 stops each a little short of its end (a vein fades out inside a fine tip). */
const veinD = (v: readonly Vein[], reach = 1): string => v.map((x) => {
  // the first `reach` of the curve, by de Casteljau
  const c = mix(x.from, x.c, reach);
  const to = mix(c, mix(x.c, x.to, reach), reach);
  return `M${pt(x.from)} Q${pt(c)} ${pt(to)}`;
}).join(' ');

/**
 * One leaf: `.face-top` (upper face), `.face-under` (underside, starts hidden: opacity 0) and `.shade` (darkens it
 * when it turns edge-on; starts at 0). The caller animates the outer group (transform) and the opacity of the two
 * inner layers. `id` makes the gradient ids unique inside one shadow root.
 */
export function leafMarkup(kind: LeafKind, palette: PaletteName, id: string): string {
  const s = LEAVES[kind];
  const c = PALETTES[palette];
  const d = pathD(s.segs);
  const [p0, p1, p2] = s.petiole;
  const stem = `<path d="M${pt(p0)} Q${pt(p1)} ${pt(p2)}" fill="none" stroke="${c.stem}" stroke-width="${s.petioleWidth}" stroke-linecap="round"/>`;
  const R = s.radius;
  const g = (name: string, stops: readonly string[]) =>
    `<radialGradient id="${id}-${name}" gradientUnits="userSpaceOnUse" cx="${f2(s.base.x - 1)}" cy="${f2(s.base.y - 2)}" r="${f2(R * 0.95)}">`
    + stops.map((col, i) => `<stop offset="${f2(i / (stops.length - 1))}" stop-color="${col}"/>`).join('') + '</radialGradient>';
  const mainW = kind === 'oak' ? 0.95 : 0.8;
  return `<defs>${g('t', c.top)}${g('u', c.under)}</defs>`
    + `<g class="face-top">${stem}<path d="${d}" fill="url(#${id}-t)" stroke="${c.rim}" stroke-opacity=".5" stroke-width=".7" stroke-linejoin="round"/>`
    + `<g fill="none" stroke="${c.vein}" stroke-linecap="round"><path d="${veinD(s.main, 0.93)}" stroke-width="${mainW}" stroke-opacity=".85"/><path d="${veinD(s.side)}" stroke-width=".5" stroke-opacity=".7"/></g></g>`
    + `<g class="face-under" style="opacity: 0">${stem}<path d="${d}" fill="url(#${id}-u)" stroke="${c.rim}" stroke-opacity=".35" stroke-width=".7" stroke-linejoin="round"/>`
    + `<g fill="none" stroke="${c.underVein}" stroke-linecap="round"><path d="${veinD(s.main, 0.93)}" stroke-width="${mainW + 0.15}" stroke-opacity=".9"/><path d="${veinD(s.side)}" stroke-width=".55" stroke-opacity=".75"/></g></g>`
    + `<path class="shade" d="${d}" fill="#3A1C0A" style="opacity: 0"/>`;
}

// ---------- snowflakes ----------

export type FlakeKind = 'hero' | 'star' | 'dot';

/** The arms of a six-armed flake: ice crystals are hexagonal, so exactly six, 60° apart. */
export const FLAKE_ARMS: readonly number[] = [0, 60, 120, 180, 240, 300];

/** Radius (bunny units, before the flake's own scale) of a circle that holds each kind. */
export const FLAKE_R: Record<FlakeKind, number> = { hero: 9.6, star: 5.2, dot: 2.4 };

/**
 * A snowflake. hero: a soft, round six-armed crystal (rounded arms with a little V of twigs, a hexagonal plate in
 * the middle, icy blue with a highlight; a blue rim so it reads on cream fur and on a dark screen). star: a small
 * simple six-armed flake; dot: a soft round one (far away). Arms carry class "arm".
 */
export function flakeMarkup(kind: FlakeKind, id: string): string {
  if (kind === 'dot') {
    return `<defs><radialGradient id="${id}-d"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".65" stop-color="#F2F8FF"/><stop offset="1" stop-color="#CFE3F6"/></radialGradient></defs>`
      + `<circle r="2" fill="url(#${id}-d)" stroke="#7FA6CF" stroke-opacity=".85" stroke-width=".6"/>`;
  }
  if (kind === 'star') {
    const arm = 'M0 -1 V-4.4 M0 -2.9 L-1.2 -3.9 M0 -2.9 L1.2 -3.9';
    const arms = (cls: string) => FLAKE_ARMS.map((a) => `<path class="${cls}" d="${arm}" transform="rotate(${a})"/>`).join('');
    return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#7FA6CF" stroke-opacity=".85" stroke-width="2.1">${arms('rim')}</g>`
      + `<g stroke="#FBFDFF" stroke-width="1.15">${arms('arm')}</g></g><circle r="1.5" fill="#FBFDFF" stroke="#7FA6CF" stroke-opacity=".85" stroke-width=".5"/>`;
  }
  // the hero: round, fat arms (round caps) with one little V each, a hexagonal plate, a highlight
  const arm = 'M0 -2.6 V-8.3 M0 -4.9 L-2.1 -6.5 M0 -4.9 L2.1 -6.5';
  const arms = (cls: string) => FLAKE_ARMS.map((a) => `<path class="${cls}" d="${arm}" transform="rotate(${a})"/>`).join('');
  const hex = FLAKE_ARMS.map((a) => pt(mul(dir(a + 30), 3.3))).join(' L');
  const hexIn = FLAKE_ARMS.map((a) => pt(mul(dir(a + 30), 1.7))).join(' L');
  return `<defs><radialGradient id="${id}-i" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="8.5"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F1F8FF"/><stop offset="1" stop-color="#D3E8FA"/></radialGradient></defs>`
    + `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#7FA9D3" stroke-width="2.9">${arms('rim')}</g>`
    + `<g stroke="url(#${id}-i)" stroke-width="1.6">${arms('arm')}</g></g>`
    + `<path d="M${hex} Z" fill="#EAF5FF" stroke="#7FA9D3" stroke-width=".8" stroke-linejoin="round"/>`
    + `<path d="M${hexIn} Z" fill="#D6EAFB" opacity=".8"/>`
    + '<ellipse cx="-1.1" cy="-1.3" rx="1.05" ry=".75" transform="rotate(-30 -1.1 -1.3)" fill="#FFFFFF"/>';
}
