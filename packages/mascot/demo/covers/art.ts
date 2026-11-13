/**
 * The cover pictures (26.10, GALLERY-ONLY prototype, demo/covers/): sixteen flat "paper cut" illustrations drawn in
 * code — no photo, no file, nothing loaded. Colours only through the palette (palette.ts `C`, CSS variables), so the
 * light and the dark theme recolour every picture; no text in a picture (nothing to translate).
 *
 * Geometry: one canvas 480 × 320 shown with `preserveAspectRatio="xMidYMid slice"`, so ONE drawing serves both places:
 *   - the Start card's cover (16 : 7, features/feed: full width, the lower third dissolves into the card) shows
 *     x 0–480, y ≈ 55–265;
 *   - the occasion screen's hero (1 : 1.08, photo/coverGeometry.ts) shows y 0–320, x ≈ 92–388.
 * The motif therefore lives in the middle (x 120–360, y 60–212) and stands on the table line y = 212 (T); garlands,
 * balloons and the like fill the edges, which only the wide card shows. The day pill and the title of the hero sit on
 * the faded lower part — nothing important below T.
 * Small guests: Pompon (the bunny, his head from the app icon apps/web/public/icons/icon.svg) and Tapsi (the hamster)
 * peek over an edge in five pictures — that peek is the app's signature, so a picture reads as "ours", never as
 * somebody's photo.
 */

import { C, type PaletteKey } from './palette';
import { THEMES, type CoverTone, type ThemeId } from './themes';

export const VIEW_W = 480;
export const VIEW_H = 320;
/** the table / ground line every motif stands on */
export const T = 212;

// ---- tiny SVG writer -------------------------------------------------------------------------------------------------

type Attrs = Record<string, string | number | undefined>;

function num(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function tag(name: string, attrs: Attrs, inner?: string): string {
  let a = '';
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) a += ` ${k}="${typeof v === 'number' ? num(v) : v}"`;
  return inner === undefined ? `<${name}${a}/>` : `<${name}${a}>${inner}</${name}>`;
}

const circle = (cx: number, cy: number, r: number, fill: string, more: Attrs = {}) => tag('circle', { cx, cy, r, fill, ...more });
const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, more: Attrs = {}) => tag('ellipse', { cx, cy, rx, ry, fill, ...more });
const rect = (x: number, y: number, width: number, height: number, fill: string, rx?: number, more: Attrs = {}) =>
  tag('rect', { x, y, width, height, rx, fill, ...more });
const path = (d: string, fill: string, more: Attrs = {}) => tag('path', { d, fill, ...more });
const line = (d: string, color: string, width: number, more: Attrs = {}) =>
  tag('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...more });
const group = (inner: string, transform?: string, more: Attrs = {}) => tag('g', { transform, ...more }, inner);
const poly = (pts: readonly (readonly [number, number])[], fill: string, more: Attrs = {}) =>
  path(`M${pts.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')} Z`, fill, more);

/** A small deterministic random (mulberry32): the same picture every time. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- shared pieces ---------------------------------------------------------------------------------------------------

function base(tone: CoverTone): string {
  // the evening sky gets only a faint light (a white glow would turn the navy grey)
  const night = tone === 6;
  return rect(-20, -20, VIEW_W + 40, VIEW_H + 40, C[`bg${tone}` as PaletteKey]) + circle(110, 20, 200, C.glow, { opacity: night ? 0.18 : 1 }) + circle(450, 300, 160, C.glow, { opacity: night ? 0.1 : 0.6 });
}

function table(): string {
  return rect(-20, T, VIEW_W + 40, VIEW_H - T + 20, C.table) + rect(-20, T, VIEW_W + 40, 2.5, C.glow);
}

function grass(): string {
  let tufts = '';
  for (let x = -6; x < VIEW_W + 10; x += 23) {
    const h = 7 + ((x * 7) % 5);
    tufts += `M${num(x)} ${T + 2} l3 ${-h} l3 ${h} l3 ${-h + 2} l3 ${h - 2}`;
  }
  return rect(-20, T, VIEW_W + 40, VIEW_H - T + 20, C.green, undefined, { opacity: 0.5 }) + path(tufts, C.green, { opacity: 0.9 });
}

function shadow(cx: number, rx: number, y = T + 2): string {
  return ellipse(cx, y, rx, 5, C.shade);
}

function sparkle(x: number, y: number, r: number, fill: string, opacity = 1): string {
  const s = r * 0.3;
  return path(`M${num(x)} ${num(y - r)}L${num(x + s)} ${num(y - s)}L${num(x + r)} ${num(y)}L${num(x + s)} ${num(y + s)}L${num(x)} ${num(y + r)}L${num(x - s)} ${num(y + s)}L${num(x - r)} ${num(y)}L${num(x - s)} ${num(y - s)}Z`, fill, { opacity });
}

function star5(cx: number, cy: number, r: number, fill: string): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return poly(pts, fill, { 'stroke-linejoin': 'round' });
}

function heart(cx: number, cy: number, s: number, fill: string): string {
  return path(`M${num(cx)} ${num(cy + s)}C${num(cx - s * 1.6)} ${num(cy)} ${num(cx - s)} ${num(cy - s)} ${num(cx)} ${num(cy - s * 0.35)}C${num(cx + s)} ${num(cy - s)} ${num(cx + s * 1.6)} ${num(cy)} ${num(cx)} ${num(cy + s)}Z`, fill);
}

/** A rope from (-10, y0) to (490, y0) sagging by `sag` in the middle: the point and the slope at t. */
function rope(y0: number, sag: number, t: number): { x: number; y: number; a: number } {
  const p0 = [-10, y0];
  const p1 = [240, y0 + 2 * sag];
  const p2 = [490, y0];
  const u = 1 - t;
  const x = u * u * (p0[0] ?? 0) + 2 * u * t * (p1[0] ?? 0) + t * t * (p2[0] ?? 0);
  const y = u * u * (p0[1] ?? 0) + 2 * u * t * (p1[1] ?? 0) + t * t * (p2[1] ?? 0);
  const dx = 2 * u * ((p1[0] ?? 0) - (p0[0] ?? 0)) + 2 * t * ((p2[0] ?? 0) - (p1[0] ?? 0));
  const dy = 2 * u * ((p1[1] ?? 0) - (p0[1] ?? 0)) + 2 * t * ((p2[1] ?? 0) - (p1[1] ?? 0));
  return { x, y, a: Math.atan2(dy, dx) };
}

function ropeLine(y0: number, sag: number): string {
  return line(`M-10 ${y0}Q240 ${y0 + 2 * sag} 490 ${y0}`, C.ink, 1.6, { opacity: 0.7 });
}

/** A pennant garland across the top. */
function garland(y0: number, sag: number, colors: readonly string[], n = 13): string {
  let out = ropeLine(y0, sag);
  for (let i = 0; i < n; i += 1) {
    const { x, y, a } = rope(y0, sag, (i + 0.5) / n);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (px: number, py: number): [number, number] => [x + px * c - py * s, y + px * s + py * c];
    out += poly([at(-10, 0), at(10, 0), at(0, 21)], colors[i % colors.length] ?? C.rose);
  }
  return out;
}

/** String lights across the top: round bulbs with a soft halo. */
function bulbs(y0: number, sag: number, colors: readonly string[], n = 11): string {
  let out = ropeLine(y0, sag);
  for (let i = 0; i < n; i += 1) {
    const { x, y } = rope(y0, sag, (i + 0.5) / n);
    const col = colors[i % colors.length] ?? C.butter;
    out += circle(x, y + 9, 13, col, { opacity: 0.22 }) + rect(x - 2.5, y, 5, 4, C.ink, 1, { opacity: 0.7 }) + circle(x, y + 9, 5.5, col);
  }
  return out;
}

type Box = readonly [number, number, number, number];

/** Confetti in a box, never over the motif's own middle (`keep`); `dotsOnly` = round flakes (snow). */
function confetti(seed: number, count: number, box: Box, colors: readonly string[], keep?: Box, dotsOnly = false): string {
  const rnd = random(seed);
  let out = '';
  let placed = 0;
  for (let guard = 0; placed < count && guard < count * 6; guard += 1) {
    const x = box[0] + rnd() * (box[2] - box[0]);
    const y = box[1] + rnd() * (box[3] - box[1]);
    const col = colors[Math.floor(rnd() * colors.length)] ?? C.rose;
    const kind = rnd();
    const angle = Math.round(rnd() * 180);
    if (keep && x > keep[0] && x < keep[2] && y > keep[1] && y < keep[3]) continue;
    placed += 1;
    if (dotsOnly) out += circle(x, y, 1.6 + kind * 2.4, col, { opacity: 0.9 });
    else out += kind < 0.62 ? rect(x - 4, y - 1.6, 8, 3.2, col, 1.2, { transform: `rotate(${angle} ${num(x)} ${num(y)})` }) : circle(x, y, 2.6, col);
  }
  return out;
}

function flame(x: number, y: number, s = 1): string {
  const d = (k: number) =>
    `M${num(x)} ${num(y - 11 * s * k)}C${num(x + 6 * s * k)} ${num(y - 4 * s * k)} ${num(x + 5 * s * k)} ${num(y + 3 * s * k)} ${num(x)} ${num(y + 4 * s * k)}C${num(x - 5 * s * k)} ${num(y + 3 * s * k)} ${num(x - 6 * s * k)} ${num(y - 4 * s * k)} ${num(x)} ${num(y - 11 * s * k)}Z`;
  return circle(x, y - 3 * s, 12 * s, C.flame, { opacity: 0.28 }) + path(d(1), C.flame) + path(d(0.55), C.butter);
}

/** A wrapped present standing on the table, its centre at x. */
function present(x: number, w: number, h: number, box: string, ribbon: string, base = T): string {
  const top = base - h;
  return (
    shadow(x, w * 0.6, base + 2) +
    rect(x - w / 2, top, w, h, box, 3) +
    rect(x - w / 2 - 2, top - 7, w + 4, 9, box, 3) +
    rect(x - w / 2 - 2, top - 7, w + 4, 3, C.white, 1.5, { opacity: 0.25 }) +
    rect(x - 3.5, top - 7, 7, h + 7, ribbon) +
    path(`M${num(x)} ${num(top - 7)}C${num(x - 6)} ${num(top - 19)} ${num(x - 17)} ${num(top - 17)} ${num(x - 14)} ${num(top - 10)}C${num(x - 12)} ${num(top - 6)} ${num(x - 5)} ${num(top - 7)} ${num(x)} ${num(top - 7)}Z`, ribbon) +
    path(`M${num(x)} ${num(top - 7)}C${num(x + 6)} ${num(top - 19)} ${num(x + 17)} ${num(top - 17)} ${num(x + 14)} ${num(top - 10)}C${num(x + 12)} ${num(top - 6)} ${num(x + 5)} ${num(top - 7)} ${num(x)} ${num(top - 7)}Z`, ribbon)
  );
}

/** A champagne flute standing at (x, base), tilted by `tilt` degrees around its foot. */
function flute(x: number, base: number, tilt: number, drink: string): string {
  const g =
    ellipse(x, base - 1, 9, 2.6, C.cream, { opacity: 0.95 }) +
    rect(x - 1.2, base - 30, 2.4, 29, C.cream, 1) +
    path(`M${num(x - 9)} ${num(base - 76)}L${num(x + 9)} ${num(base - 76)}L${num(x + 6)} ${num(base - 34)}Q${num(x)} ${num(base - 28)} ${num(x - 6)} ${num(base - 34)}Z`, C.cream, { opacity: 0.7 }) +
    path(`M${num(x - 8.2)} ${num(base - 62)}L${num(x + 8.2)} ${num(base - 62)}L${num(x + 5.6)} ${num(base - 35)}Q${num(x)} ${num(base - 30)} ${num(x - 5.6)} ${num(base - 35)}Z`, drink) +
    circle(x - 2, base - 50, 1.3, C.white, { opacity: 0.8 }) +
    circle(x + 2.5, base - 42, 1, C.white, { opacity: 0.8 }) +
    rect(x - 6, base - 74, 2.5, 30, C.white, 1.2, { opacity: 0.4 });
  return group(g, `rotate(${tilt} ${num(x)} ${num(base)})`);
}

// ---- the small guests ---------------------------------------------------------------------------------------------

interface Peek {
  /** drawn BEFORE the edge (the head behind it) */
  back: string;
  /** drawn AFTER the edge (the paws gripping it) */
  front: string;
}

/**
 * Pompon peeking over an edge at y = `edge` (the app icon's pose, in the mascot's own units: x = 0 the middle, the
 * edge line at y = −60; only the part of the head above the edge is drawn, so any edge colour works).
 */
function pompon(x: number, edge: number, s: number, hat: 'party' | 'santa' | null = null): Peek {
  const at = `translate(${num(x)} ${num(edge + 60 * s)}) scale(${s})`;
  const head =
    path('M-67 -60C-66 -72 -70 -92 -67 -112C-64 -140 -40 -163 0 -163C40 -163 64 -140 67 -112C70 -92 66 -72 67 -60Z', C.fur) +
    ellipse(-65, -82, 12, 19, C.fur) +
    ellipse(65, -82, 12, 19, C.fur) +
    ellipse(0, -70, 50, 14, C.white, { opacity: 0.35 }) +
    ellipse(-43, -81, 9, 5.5, C.cheek) +
    ellipse(43, -81, 9, 5.5, C.cheek) +
    ellipse(-29, -97, 8.3, 9.9, C.eye) +
    circle(-26, -101.8, 2.6, C.white) +
    circle(-32, -93.6, 1.1, C.white, { opacity: 0.7 }) +
    ellipse(29, -97, 8.3, 9.9, C.eye) +
    circle(32, -101.8, 2.6, C.white) +
    circle(26, -93.6, 1.1, C.white, { opacity: 0.7 }) +
    ellipse(-4.6, -80.6, 5.4, 4, C.white, { opacity: 0.9 }) +
    ellipse(4.6, -80.6, 5.4, 4, C.white, { opacity: 0.9 }) +
    path('M-3.6 -88Q0 -90 3.6 -88Q2.8 -84.8 0 -83.8Q-2.8 -84.8 -3.6 -88Z', C.nose) +
    line('M0 -83.8L0 -81.6M0 -81.6Q-2.2 -79.2 -4.6 -80.2M0 -81.6Q2.2 -79.2 4.6 -80.2', C.mouth, 1.4) +
    path('M-24 -160C-44 -170 -67 -155 -75 -128C-81 -107 -77 -86 -66 -83C-56 -81 -53 -96 -53 -111C-53 -129 -44 -145 -29 -151Z', C.ear) +
    path('M-29 -151C-44 -145 -53 -129 -53 -111C-53 -99 -55 -90 -61 -86C-58 -95 -57.5 -108 -58 -118C-58.5 -134 -50 -146 -37 -153Z', C.earIn, { opacity: 0.6 }) +
    path('M24 -160C44 -170 67 -155 75 -128C81 -107 77 -86 66 -83C56 -81 53 -96 53 -111C53 -129 44 -145 29 -151Z', C.ear) +
    path('M29 -151C44 -145 53 -129 53 -111C53 -99 55 -90 61 -86C58 -95 57.5 -108 58 -118C58.5 -134 50 -146 37 -153Z', C.earIn, { opacity: 0.6 });
  let cap = '';
  if (hat === 'party') {
    cap = group(
      path('M-24 -152L26 -152L4 -226Z', C.blue) +
        path('M-16.8 -176L18.6 -176L14 -190.5L-12.4 -190.5Z', C.butter) +
        path('M-7.7 -207L12 -207L8.6 -218L-4.5 -218Z', C.butter) +
        ellipse(1, -152, 26, 6, C.blue) +
        circle(4, -228, 9, C.berry),
      'rotate(10 0 -152)',
    );
  } else if (hat === 'santa') {
    cap = group(
      path('M-42 -150C-40 -196 -6 -214 30 -204C48 -199 60 -184 62 -168C52 -178 40 -184 30 -182C30 -170 34 -160 36 -150Z', C.berry) +
        rect(-50, -160, 92, 18, C.cream, 9) +
        circle(64, -164, 11, C.cream),
      'rotate(-8 0 -152)',
    );
  }
  const paws =
    ellipse(-25, -56, 13.3, 6.2, C.shade) +
    ellipse(-25, -61.5, 13, 10, C.paw) +
    line('M-30.5 -59.5v5.5M-25 -59.5v5.5M-19.5 -59.5v5.5', C.pawLine, 1.3) +
    ellipse(25, -56, 13.3, 6.2, C.shade) +
    ellipse(25, -61.5, 13, 10, C.paw) +
    line('M19.5 -59.5v5.5M25 -59.5v5.5M30.5 -59.5v5.5', C.pawLine, 1.3);
  return { back: group(head + cap, at), front: group(paws, at) };
}

/**
 * Tapsi (the golden hamster, coat "golden": a cream face with an apricot cap and apricot ears, like the puppet)
 * peeking over an edge at y = `edge`, the same units as Pompon.
 */
function tapsi(x: number, edge: number, s: number): Peek {
  const at = `translate(${num(x)} ${num(edge + 60 * s)}) scale(${s})`;
  const head =
    circle(-42, -128, 16, C.ham) +
    circle(-42, -128, 8.5, C.hamIn) +
    circle(42, -128, 16, C.ham) +
    circle(42, -128, 8.5, C.hamIn) +
    path('M-62 -60C-64 -104 -40 -140 0 -140C40 -140 64 -104 62 -60Z', C.hamLight) +
    path('M-56 -96C-50 -124 -28 -140 0 -140C28 -140 50 -124 56 -96C44 -110 30 -116 16 -112C10 -120 -10 -120 -16 -112C-30 -116 -44 -110 -56 -96Z', C.ham) +
    ellipse(-37, -78, 9, 6, C.cheek) +
    ellipse(37, -78, 9, 6, C.cheek) +
    ellipse(-23, -102, 6.6, 7.8, C.eye) +
    circle(-21, -105.5, 2.1, C.white) +
    ellipse(23, -102, 6.6, 7.8, C.eye) +
    circle(25, -105.5, 2.1, C.white) +
    ellipse(0, -88, 4.6, 3.4, C.hamIn) +
    line('M0 -84.6V-82M0 -82Q-3 -79 -6 -80.5M0 -82Q3 -79 6 -80.5', C.mouth, 1.5);
  const paws =
    ellipse(-21, -56, 11, 5.5, C.shade) +
    ellipse(-21, -61, 11, 8.5, C.hamLight) +
    line('M-25 -59.5v4M-21 -59.5v4M-17 -59.5v4', C.pawLine, 1.2) +
    ellipse(21, -56, 11, 5.5, C.shade) +
    ellipse(21, -61, 11, 8.5, C.hamLight) +
    line('M17 -59.5v4M21 -59.5v4M25 -59.5v4', C.pawLine, 1.2);
  return { back: group(head, at), front: group(paws, at) };
}

// ---- the sixteen pictures ---------------------------------------------------------------------------------------------

const PARTY_COLORS = [C.rose, C.blue, C.butter, C.green, C.orange, C.lilac];

function balloon(x: number, y: number, r: number, fill: string, toX: number): string {
  const knot = y + r * 1.18;
  return (
    line(`M${num(x)} ${num(knot)}C${num(x - 8)} ${num(knot + 40)} ${num(toX + 10)} ${num(T - 50)} ${num(toX)} ${num(T)}`, C.ink, 1.3, { opacity: 0.6 }) +
    ellipse(x, y, r, r * 1.18, fill) +
    ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.34, C.white, { opacity: 0.45, transform: `rotate(28 ${num(x - r * 0.38)} ${num(y - r * 0.42)})` }) +
    path(`M${num(x)} ${num(knot - 2)}L${num(x - 4)} ${num(knot + 5)}L${num(x + 4)} ${num(knot + 5)}Z`, fill)
  );
}

function birthday(): string {
  const guest = pompon(352, T, 0.42, 'party');
  const candles = [C.blue, C.butter, C.green, C.rose, C.lilac]
    .map((col, i) => {
      const x = 202 + i * 19;
      return rect(x - 3.5, 120, 7, 30, col, 3.5) + rect(x - 3.5, 128, 7, 3, C.white, 0, { opacity: 0.45 }) + flame(x, 110, 0.8);
    })
    .join('');
  return (
    base(1) +
    garland(18, 26, PARTY_COLORS) +
    confetti(7, 26, [10, 50, 470, 175], PARTY_COLORS, [150, 90, 330, 212]) +
    balloon(80, 104, 27, C.rose, 96) +
    balloon(126, 78, 24, C.blue, 112) +
    balloon(404, 92, 26, C.butter, 392) +
    balloon(446, 128, 20, C.green, 430) +
    guest.back +
    table() +
    guest.front +
    present(112, 40, 30, C.blue, C.butter) +
    shadow(240, 92) +
    ellipse(240, T, 88, 7, C.cream) +
    rect(178, 158, 124, 54, C.cream, 10) +
    rect(178, 186, 124, 7, C.rose, 0, { opacity: 0.55 }) +
    rect(174, 148, 132, 18, C.rose, 9) +
    [188, 210, 234, 258, 282].map((x, i) => circle(x + (i % 2) * 3, 166, 6.5 + (i % 2), C.rose)).join('') +
    rect(184, 151, 40, 4, C.white, 2, { opacity: 0.4 }) +
    candles
  );
}

function party(): string {
  let facets = '';
  const colors = [C.blue, C.cream, C.lilac, C.blue, C.white];
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      const fx = 240 + j * 10;
      const fy = 106 + i * 10;
      if (Math.hypot(fx - 240, fy - 106) > 36) continue;
      facets += rect(fx - 4.2, fy - 4.2, 8.4, 8.4, colors[(i * 3 + j * 7 + 40) % colors.length] ?? C.blue, 1.5, { opacity: 0.85 });
    }
  }
  const popper = group(
    path('M296 212L280 160L318 154Z', C.orange) + path('M291.5 197L286 179L306 176Z', C.butter, { opacity: 0.9 }) + ellipse(299, 157, 19.5, 5, C.deep, { transform: 'rotate(-9 299 157)' }),
  );
  const burst = [
    [262, 120], [276, 108], [296, 100], [318, 106], [336, 120], [270, 136], [330, 140],
  ]
    .map(([x, y], i) => (i % 2 ? circle(x ?? 0, y ?? 0, 3, PARTY_COLORS[i % 6] ?? C.rose) : rect((x ?? 0) - 4, (y ?? 0) - 1.6, 8, 3.2, PARTY_COLORS[i % 6] ?? C.rose, 1.2, { transform: `rotate(${i * 37} ${x} ${y})` })))
    .join('');
  return (
    base(2) +
    bulbs(14, 22, [C.butter, C.rose, C.blue, C.green, C.lilac]) +
    line('M48 40C70 70 30 90 52 120S40 160 60 190', C.rose, 4) +
    line('M430 44C410 74 448 96 426 126S444 162 420 192', C.butter, 4) +
    confetti(3, 30, [10, 40, 470, 200], PARTY_COLORS, [170, 50, 340, 212]) +
    line('M240 -10V66', C.ink, 1.5, { opacity: 0.7 }) +
    rect(233, 62, 14, 8, C.charcoal, 2) +
    circle(240, 106, 38, C.blue) +
    facets +
    circle(226, 92, 9, C.white, { opacity: 0.65 }) +
    sparkle(188, 78, 9, C.butter) +
    sparkle(296, 88, 7, C.white) +
    sparkle(300, 140, 5, C.butter) +
    sparkle(180, 132, 5, C.white) +
    table() +
    shadow(186, 24) +
    flute(178, T, 9, C.butter) +
    flute(198, T, -9, C.butter) +
    shadow(298, 20) +
    popper +
    burst
  );
}

function gamenight(): string {
  const guest = tapsi(270, 112, 0.4);
  const pawn = (x: number, col: string) =>
    shadow(x, 12) + path(`M${x - 10} ${T}C${x - 10} ${T - 8} ${x - 5} ${T - 14} ${x - 4} ${T - 24}H${x + 4}C${x + 5} ${T - 14} ${x + 10} ${T - 8} ${x + 10} ${T}Z`, col) + circle(x, T - 30, 8, col) + circle(x - 2.5, T - 33, 2.4, C.white, { opacity: 0.5 });
  const pip = (x: number, y: number) => circle(x, y, 2.4, C.charcoal);
  const die1 = group(rect(312, T - 30, 30, 30, C.cream, 6) + pip(320, T - 22) + pip(334, T - 22) + pip(327, T - 15) + pip(320, T - 8) + pip(334, T - 8), `rotate(10 327 ${T})`);
  const die2 = group(rect(348, T - 22, 22, 22, C.cream, 5) + pip(353.5, T - 16.5) + pip(359, T - 11) + pip(364.5, T - 5.5), `rotate(-12 359 ${T})`);
  const card = (angle: number, mark: string) =>
    group(rect(392, T - 50, 30, 42, C.cream, 4) + rect(392, T - 50, 30, 42, 'none', 4, { stroke: C.ink, 'stroke-width': 0.8, opacity: 0.35 }) + mark, `rotate(${angle} 407 ${T - 4})`);
  return (
    base(7) +
    line('M240 -10V30', C.ink, 2, { opacity: 0.7 }) +
    poly([[198, 58], [282, 58], [380, T], [100, T]], C.glow, { opacity: 0.85 }) +
    path('M214 32H266L284 58H196Z', C.butter) +
    circle(240, 60, 6, C.flame) +
    sparkle(128, 64, 7, C.white, 0.8) +
    sparkle(360, 52, 6, C.white, 0.8) +
    table() +
    shadow(232, 84) +
    rect(52, T - 26, 58, 26, C.blue, 4) + rect(52, T - 26, 58, 6, C.white, 3, { opacity: 0.25 }) +
    rect(58, T - 46, 48, 20, C.green, 4) + rect(58, T - 46, 48, 5, C.white, 3, { opacity: 0.25 }) +
    guest.back +
    rect(158, 112, 148, T - 112, C.orange, 7) +
    rect(158, 112, 148, 20, C.deep, 7) +
    rect(158, 124, 148, 8, C.deep) +
    rect(166, 116, 60, 4, C.white, 2, { opacity: 0.3 }) +
    circle(232, 170, 29, C.cream) +
    star5(232, 171, 20, C.deep) +
    circle(176, 196, 4, C.butter) +
    circle(288, 196, 4, C.butter) +
    guest.front +
    pawn(126, C.rose) +
    pawn(148, C.teal) +
    shadow(330, 22) +
    die1 +
    die2 +
    card(-20, heart(407, T - 29, 6, C.berry)) +
    card(0, path(`M407 ${T - 38}L414 ${T - 29}L407 ${T - 20}L400 ${T - 29}Z`, C.blue)) +
    card(20, circle(407, T - 29, 6, C.green))
  );
}

function dinner(): string {
  const candle = (x: number) =>
    rect(x - 13, T - 10, 26, 10, C.butter, 3) + rect(x - 5, T - 72, 10, 62, C.cream, 3) + rect(x - 3, T - 70, 2.5, 50, C.white, 1, { opacity: 0.5 }) + flame(x, T - 82);
  const wine = (x: number) =>
    ellipse(x, T - 1, 12, 3, C.cream, { opacity: 0.9 }) +
    rect(x - 1.4, T - 34, 2.8, 33, C.cream, 1) +
    path(`M${x - 16} ${T - 80}H${x + 16}C${x + 17} ${T - 54} ${x + 10} ${T - 36} ${x} ${T - 34}C${x - 10} ${T - 36} ${x - 17} ${T - 54} ${x - 16} ${T - 80}Z`, C.cream, { opacity: 0.7 }) +
    path(`M${x - 15.6} ${T - 62}H${x + 15.6}C${x + 14} ${T - 46} ${x + 9} ${T - 37} ${x} ${T - 36}C${x - 9} ${T - 37} ${x - 14} ${T - 46} ${x - 15.6} ${T - 62}Z`, C.berry) +
    rect(x - 12, T - 78, 3, 30, C.white, 1.5, { opacity: 0.45 });
  const lamp = (x: number) =>
    line(`M${x} -10V44`, C.ink, 1.6, { opacity: 0.7 }) + circle(x, 66, 26, C.flame, { opacity: 0.22 }) + path(`M${x - 24} 64C${x - 24} 50 ${x - 13} 42 ${x} 42C${x + 13} 42 ${x + 24} 50 ${x + 24} 64Z`, C.deep) + ellipse(x, 65, 8, 4, C.flame);
  let scallops = '';
  for (let x = -12; x < VIEW_W + 16; x += 16) scallops += circle(x, T + 30, 8.5, C.cream);
  return (
    base(1) +
    lamp(150) +
    lamp(330) +
    line('M222 128C214 112 230 104 222 88S226 64 220 54', C.white, 5, { opacity: 0.55 }) +
    line('M246 124C238 108 254 100 246 84S250 60 244 46', C.white, 5, { opacity: 0.55 }) +
    line('M266 128C260 114 274 106 268 92', C.white, 4, { opacity: 0.45 }) +
    table() +
    rect(-20, T, VIEW_W + 40, 30, C.cream) +
    scallops +
    rect(-20, T, VIEW_W + 40, 3, C.white, 0, { opacity: 0.5 }) +
    shadow(240, 70, T + 1) +
    rect(180, 166, 18, 9, C.deep, 4) +
    rect(282, 166, 18, 9, C.deep, 4) +
    path(`M192 156H288V188C288 204 274 ${T} 260 ${T}H220C206 ${T} 192 204 192 188Z`, C.orange) +
    rect(200, 166, 6, 34, C.white, 3, { opacity: 0.3 }) +
    path('M188 158C188 142 212 130 240 130C268 130 292 142 292 158Z', C.deep) +
    rect(186, 154, 108, 7, C.deep, 3.5) +
    circle(240, 128, 7, C.cream) +
    candle(150) +
    candle(330) +
    wine(104) +
    wine(376) +
    sparkle(120, 104, 5, C.white, 0.8) +
    sparkle(362, 112, 5, C.white, 0.8)
  );
}

function bbq(): string {
  return (
    base(4) +
    circle(400, 64, 30, C.apricot, { opacity: 0.85 }) +
    circle(400, 64, 46, C.apricot, { opacity: 0.18 }) +
    bulbs(12, 18, [C.flame, C.butter, C.apricot], 12) +
    line('M222 132C210 112 232 102 220 82S228 54 218 38', C.white, 7, { opacity: 0.6 }) +
    line('M244 128C234 108 254 98 244 78S250 50 242 30', C.white, 7, { opacity: 0.55 }) +
    line('M266 132C258 116 274 106 266 88', C.white, 6, { opacity: 0.45 }) +
    grass() +
    shadow(240, 72, T + 3) +
    line(`M212 186L196 ${T + 4}M268 186L284 ${T + 4}M240 192V${T + 4}`, C.charcoal, 5) +
    path('M174 150H306C306 182 278 200 240 200C202 200 174 182 174 150Z', C.charcoal) +
    path('M184 156H200C202 176 214 188 230 194C204 192 186 178 184 156Z', C.white, { opacity: 0.16 }) +
    rect(170, 146, 140, 6, C.paper, 3) +
    rect(192, 134, 40, 12, C.berry, 6) +
    rect(236, 135, 36, 11, C.deep, 5.5) +
    line('M202 135l-4 10M214 135l-4 10M248 136l-4 10M260 136l-4 10', C.charcoal, 1.6, { opacity: 0.45 }) +
    ellipse(288, 139, 17, 7, C.butter) +
    path('M300 140C306 134 312 134 316 138C310 140 306 143 300 143Z', C.green) +
    shadow(126, 24) +
    path(`M108 150H146L144 ${T - 4}C144 ${T} 140 ${T} 138 ${T}H116C114 ${T} 110 ${T} 110 ${T - 4}Z`, C.cream, { opacity: 0.85 }) +
    path(`M110 168H144L143.5 ${T - 4}C143.5 ${T - 1} 140 ${T - 1} 138 ${T - 1}H116C114 ${T - 1} 110.5 ${T - 1} 110.5 ${T - 4}Z`, C.butter) +
    line('M146 160C160 160 160 192 145 192', C.cream, 5, { opacity: 0.9 }) +
    circle(122, 160, 7, C.butter) +
    circle(122, 160, 4, C.white, { opacity: 0.5 }) +
    shadow(362, 34) +
    circle(346, 182, 11, C.green) +
    circle(362, 176, 12, C.leaf) +
    circle(378, 184, 10, C.green) +
    circle(354, 178, 4, C.berry) +
    circle(372, 180, 4, C.berry) +
    path(`M326 186H398C398 202 384 ${T} 362 ${T}C340 ${T} 326 202 326 186Z`, C.cream)
  );
}

function movie(): string {
  let holes = '';
  for (let x = -20; x < 520; x += 22) holes += rect(x, 20, 9, 6, C.cream, 1.5) + rect(x, 46, 9, 6, C.cream, 1.5);
  let frames = '';
  for (let x = -14; x < 520; x += 66) frames += rect(x, 29, 54, 14, C.blue, 2, { opacity: 0.5 });
  const stripe = (k: number) => {
    const t0 = k / 6;
    const t1 = (k + 1) / 6;
    return poly([[200 + 80 * t0, 124], [200 + 80 * t1, 124], [214 + 52 * t1, T], [214 + 52 * t0, T]], C.berry);
  };
  const corn = [
    [210, 114, 12], [227, 104, 13], [246, 106, 14], [264, 112, 12], [220, 92, 10], [238, 88, 11], [255, 94, 10], [232, 76, 8], [276, 120, 8], [204, 122, 8],
  ]
    .map(([x, y, r], i) => circle(x ?? 0, y ?? 0, r ?? 0, i % 3 === 2 ? C.butter : C.cream))
    .join('');
  const clap =
    group(rect(118, 160, 66, 52, C.charcoal, 4) + rect(124, 176, 54, 3, C.cream, 1, { opacity: 0.35 }) + rect(124, 186, 34, 3, C.cream, 1, { opacity: 0.35 }) + rect(118, 148, 66, 12, C.charcoal, 2) + path('M126 148h10l-6 12h-10zM146 148h10l-6 12h-10zM166 148h10l-6 12h-10z', C.cream) , `rotate(-6 150 ${T})`);
  const clapTop = group(rect(118, 136, 66, 12, C.charcoal, 2) + path('M128 136h10l-6 12h-10zM148 136h10l-6 12h-10zM168 136h10l-6 12h-10z', C.cream), 'rotate(-22 118 146)');
  const ticket = (x: number, y: number, a: number) =>
    group(rect(x, y, 58, 28, C.butter, 4) + line(`M${x + 40} ${y + 4}V${y + 24}`, C.deep, 1.6, { 'stroke-dasharray': '2 3', opacity: 0.7 }) + star5(x + 20, y + 14, 7, C.deep), `rotate(${a} ${x + 29} ${y + 14})`);
  return (
    base(3) +
    group(rect(-30, 14, 540, 44, C.charcoal, 0, { opacity: 0.85 }) + frames + holes, 'rotate(-4 240 36)') +
    sparkle(98, 104, 7, C.butter) +
    sparkle(392, 98, 8, C.butter) +
    sparkle(360, 140, 5, C.white) +
    table() +
    shadow(240, 46) +
    corn +
    poly([[200, 124], [280, 124], [266, T], [214, T]], C.cream) +
    stripe(0) + stripe(2) + stripe(4) +
    rect(196, 118, 88, 10, C.cream, 4) +
    rect(196, 118, 88, 3, C.white, 1.5, { opacity: 0.6 }) +
    shadow(150, 40) +
    clap +
    clapTop +
    ticket(310, 150, 14) +
    ticket(330, 178, -8)
  );
}

function sport(): string {
  return (
    base(5) +
    sparkle(104, 80, 8, C.white) +
    sparkle(378, 70, 7, C.white) +
    line('M150 92C170 70 196 62 220 64', C.white, 4, { opacity: 0.7 }) +
    line('M330 92C310 70 284 62 260 64', C.white, 4, { opacity: 0.7 }) +
    circle(240, 96, 26, C.cream) +
    circle(240, 96, 20, C.white, { opacity: 0.6 }) +
    rect(234, 62, 12, 9, C.charcoal, 2) +
    line('M240 96V82M240 96L250 102', C.charcoal, 3) +
    table() +
    rect(150, T - 3, 180, 7, C.teal, 3.5, { opacity: 0.8 }) +
    shadow(138, 28) +
    line('M123 180C118 140 158 140 153 180', C.charcoal, 7) +
    circle(138, 188, 24, C.charcoal) +
    rect(116, 196, 44, 16, C.charcoal, 4) +
    ellipse(128, 180, 6, 9, C.white, { opacity: 0.22 }) +
    shadow(240, 56) +
    rect(198, T - 25, 84, 7, C.paper, 3) +
    rect(192, T - 33, 8, 23, C.charcoal, 2) +
    rect(280, T - 33, 8, 23, C.charcoal, 2) +
    rect(202, T - 46, 15, 46, C.blue, 4) +
    rect(263, T - 46, 15, 46, C.blue, 4) +
    rect(217, T - 38, 8, 30, C.lilac, 3) +
    rect(255, T - 38, 8, 30, C.lilac, 3) +
    rect(205, T - 42, 3, 36, C.white, 1.5, { opacity: 0.4 }) +
    rect(266, T - 42, 3, 36, C.white, 1.5, { opacity: 0.4 }) +
    shadow(322, 20) +
    rect(306, 132, 32, 80, C.blue, 11, { opacity: 0.85 }) +
    rect(312, 118, 20, 16, C.green, 4) +
    rect(306, 160, 32, 22, C.cream, 0) +
    rect(312, 140, 5, 64, C.white, 2.5, { opacity: 0.4 }) +
    shadow(394, 22) +
    circle(394, 188, 24, C.orange) +
    line('M394 164V212M370 188H418M377 171C388 180 388 196 377 205M411 171C400 180 400 196 411 205', C.charcoal, 1.8, { opacity: 0.55 })
  );
}

function picnic(): string {
  const guest = tapsi(242, 166, 0.36);
  // the blanket in perspective: a trapezoid with gingham bands
  const back = T - 2;
  const front = 268;
  const xl = (y: number) => 168 - ((y - back) / (front - back)) * 48;
  const xr = (y: number) => 312 + ((y - back) / (front - back)) * 48;
  let gingham = '';
  for (let k = 0; k < 8; k += 2) {
    const a = k / 8;
    const b = (k + 1) / 8;
    gingham += poly([[168 + 144 * a, back], [168 + 144 * b, back], [120 + 240 * b, front], [120 + 240 * a, front]], C.berry, { opacity: 0.35 });
  }
  for (let k = 0; k < 6; k += 2) {
    const y0 = back + ((front - back) * k) / 6;
    const y1 = back + ((front - back) * (k + 1)) / 6;
    gingham += poly([[xl(y0), y0], [xr(y0), y0], [xr(y1), y1], [xl(y1), y1]], C.berry, { opacity: 0.35 });
  }
  let rays = '';
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    rays += `M${num(400 + 36 * Math.cos(a))} ${num(58 + 36 * Math.sin(a))}L${num(400 + 46 * Math.cos(a))} ${num(58 + 46 * Math.sin(a))}`;
  }
  const cloud = (x: number, y: number, s: number) => group(circle(0, 0, 16, C.cream) + circle(18, -8, 20, C.cream) + circle(38, 0, 15, C.cream) + rect(-14, 0, 64, 15, C.cream, 7.5), `translate(${x} ${y}) scale(${s})`);
  return (
    base(3) +
    circle(400, 58, 26, C.butter) +
    line(rays, C.butter, 4) +
    cloud(96, 52, 1) +
    cloud(280, 30, 0.7) +
    grass() +
    rect(62, 118, 15, T - 116, C.wood, 6) +
    circle(70, 104, 34, C.green) +
    circle(44, 126, 24, C.leaf) +
    circle(98, 122, 26, C.leaf) +
    circle(72, 78, 24, C.green) +
    circle(60, 96, 10, C.white, { opacity: 0.18 }) +
    poly([[168, back], [312, back], [360, front], [120, front]], C.cream) +
    gingham +
    shadow(240, 50, T + 12) +
    line('M206 170C206 132 274 132 274 170', C.wood, 7) +
    guest.back +
    path(`M198 168H282L274 ${T + 10}C273 ${T + 14} 270 ${T + 16} 266 ${T + 16}H214C210 ${T + 16} 207 ${T + 14} 206 ${T + 10}Z`, C.wood) +
    line(`M202 184H278M204 198H276M206 ${T + 8}H274`, C.charcoal, 1.4, { opacity: 0.25 }) +
    rect(192, 162, 96, 11, C.wood, 5.5) +
    rect(196, 164, 60, 3, C.white, 1.5, { opacity: 0.3 }) +
    guest.front +
    circle(318, T + 8, 9, C.berry) +
    path(`M318 ${T - 1}C320 ${T - 7} 325 ${T - 8} 327 ${T - 6}C324 ${T - 3} 321 ${T - 2} 318 ${T - 1}Z`, C.green) +
    circle(334, T + 16, 8, C.butter)
  );
}

function concert(): string {
  const note = (x: number, y: number, col: string) => ellipse(x, y, 7, 5, col, { transform: `rotate(-20 ${x} ${y})` }) + line(`M${x + 6} ${y - 2}V${y - 28}l10 6`, col, 2.6);
  return (
    base(6) +
    poly([[148, -10], [168, -10], [214, T], [92, T]], C.butter, { opacity: 0.2 }) +
    poly([[232, -10], [248, -10], [312, T], [168, T]], C.rose, { opacity: 0.16 }) +
    poly([[318, -10], [338, -10], [392, T], [268, T]], C.blue, { opacity: 0.2 }) +
    sparkle(70, 40, 4, C.white, 0.8) +
    sparkle(420, 30, 5, C.white, 0.8) +
    sparkle(380, 92, 3, C.white, 0.7) +
    sparkle(104, 112, 3, C.white, 0.7) +
    note(172, 104, C.butter) +
    note(198, 66, C.cream) +
    note(302, 80, C.rose) +
    table() +
    rect(-20, T, VIEW_W + 40, 3, C.butter, 0, { opacity: 0.55 }) +
    shadow(140, 34) +
    rect(110, 140, 60, 72, C.lilac, 6) +
    circle(140, 162, 13, C.paper) +
    circle(140, 162, 6, C.lilac) +
    circle(140, 194, 9, C.paper) +
    circle(140, 194, 4, C.lilac) +
    shadow(240, 24) +
    ellipse(240, T - 2, 22, 5, C.paper) +
    rect(237.5, 124, 5, 86, C.paper, 2.5) +
    rect(226, 84, 28, 44, C.paper, 14) +
    line('M231 96H249M230 104H250M231 112H249', C.charcoal, 1.4, { opacity: 0.35 }) +
    rect(226, 116, 28, 6, C.deep, 0) +
    group(
      rect(335, T - 170, 10, 96, C.wood, 2) +
        rect(331, T - 190, 18, 22, C.wood, 4) +
        circle(340, T - 30, 28, C.orange) +
        circle(340, T - 72, 21, C.orange) +
        rect(326, T - 60, 28, 22, C.orange) +
        circle(340, T - 56, 8, C.charcoal) +
        rect(330, T - 26, 20, 5, C.charcoal, 2) +
        line(`M337 ${T - 26}V${T - 176}M343 ${T - 26}V${T - 176}`, C.cream, 0.8, { opacity: 0.7 }),
      `rotate(-22 340 ${T})`,
    )
  );
}

function housewarming(): string {
  const key = group(
    circle(0, 0, 11, 'none', { stroke: C.butter, 'stroke-width': 6 }) + rect(10, -3, 40, 6, C.butter, 3) + rect(38, 2, 5, 9, C.butter, 1.5) + rect(46, 2, 4, 7, C.butter, 1.5) + path('M-6 -10C-18 -22 -26 -8 -12 -6Z', C.berry) + path('M-6 -10C-4 -26 -18 -26 -14 -12Z', C.berry),
    'translate(352 92) rotate(-28)',
  );
  const box = (x: number, y: number, w: number, h: number, a: number) =>
    group(rect(x, y, w, h, C.wood, 3) + rect(x, y, w, 6, C.white, 2, { opacity: 0.18 }) + rect(x + w / 2 - 4, y, 8, h, C.paper, 0, { opacity: 0.55 }), `rotate(${a} ${x + w / 2} ${y + h})`);
  return (
    base(4) +
    sparkle(132, 70, 7, C.white) +
    sparkle(420, 150, 5, C.white) +
    sparkle(160, 40, 4, C.white, 0.8) +
    table() +
    shadow(240, 74) +
    rect(268, 80, 16, 34, C.deep, 2) +
    rect(182, 128, 116, 84, C.cream) +
    path('M166 134L240 70L314 134Z', C.deep) +
    path('M176 134L240 80L304 134Z', C.orange) +
    rect(166, 130, 148, 7, C.deep, 3.5) +
    path(`M226 ${T}V182A14 14 0 0 1 254 182V${T}Z`, C.wood) +
    circle(249, 194, 2.4, C.butter) +
    rect(196, 148, 22, 22, C.butter, 3) +
    line('M207 148V170M196 159H218', C.cream, 2.4) +
    rect(262, 148, 22, 22, C.butter, 3) +
    line('M273 148V170M262 159H284', C.cream, 2.4) +
    circle(240, 106, 9, C.butter) +
    line('M240 97V115M231 106H249', C.cream, 2) +
    heart(240, 166, 5, C.berry) +
    shadow(118, 36) +
    box(88, T - 38, 58, 38, 0) +
    box(98, T - 66, 40, 28, -5) +
    shadow(354, 24) +
    path(`M338 ${T - 30}H370L366 ${T}H342Z`, C.orange) +
    rect(335, T - 34, 38, 7, C.deep, 3) +
    ellipse(346, T - 52, 7, 18, C.green, { transform: `rotate(-24 346 ${T - 52})` }) +
    ellipse(362, T - 54, 7, 18, C.leaf, { transform: `rotate(22 362 ${T - 54})` }) +
    ellipse(354, T - 62, 7, 20, C.green) +
    key
  );
}

function wedding(): string {
  const cx = 240;
  const rx = 108;
  const ry = 150;
  let leaves = '';
  let flowers = '';
  const n = 26;
  for (let i = 0; i <= n; i += 1) {
    const a = Math.PI - (i / n) * Math.PI;
    const x = cx + rx * Math.cos(a);
    const y = T - ry * Math.sin(a);
    const tangent = (Math.atan2(-ry * Math.cos(a), -rx * Math.sin(a)) * 180) / Math.PI;
    const side = i % 2 ? 1 : -1;
    leaves += ellipse(x + side * 6, y, 10, 4.5, i % 3 ? C.green : C.leaf, { transform: `rotate(${num(tangent + side * 35)} ${num(x + side * 6)} ${num(y)})` });
    if (i % 3 === 1) {
      const col = [C.rose, C.cream, C.butter, C.berry][Math.floor(i / 3) % 4] ?? C.rose;
      flowers += circle(x, y, 9, col) + circle(x, y, 3.5, i % 2 ? C.butter : C.deep);
    }
  }
  const petals = confetti(11, 16, [20, 20, 460, 190], [C.rose, C.white, C.rose], [120, 50, 360, 212]);
  return (
    base(2) +
    petals +
    table() +
    line(`M${cx - rx} ${T}A${rx} ${ry} 0 0 1 ${cx + rx} ${T}`, C.cream, 7, { opacity: 0.85 }) +
    leaves +
    flowers +
    heart(240, 102, 10, C.berry) +
    circle(226, 150, 21, 'none', { stroke: C.butter, 'stroke-width': 6.5 }) +
    circle(254, 150, 21, 'none', { stroke: C.butter, 'stroke-width': 6.5 }) +
    path('M244.5 132.5A21 21 0 0 1 247 145', 'none', { stroke: C.butter, 'stroke-width': 6.5 }) +
    path('M226 121L233 129L226 135L219 129Z', C.white) +
    path('M226 125L229.5 129L226 132L222.5 129Z', C.blue, { opacity: 0.7 }) +
    sparkle(206, 122, 5, C.white) +
    sparkle(276, 176, 4, C.white) +
    shadow(96, 22) +
    flute(90, T, 6, C.butter) +
    shadow(388, 22) +
    flute(392, T, -6, C.butter)
  );
}

function baby(): string {
  const onesie = (t: number, col: string) => {
    const { x, y } = rope(28, 26, t);
    return (
      path(`M${num(x - 18)} ${num(y)}L${num(x - 8)} ${num(y)}Q${num(x)} ${num(y + 7)} ${num(x + 8)} ${num(y)}L${num(x + 18)} ${num(y)}L${num(x + 24)} ${num(y + 12)}L${num(x + 14)} ${num(y + 17)}L${num(x + 13)} ${num(y + 38)}Q${num(x + 6)} ${num(y + 44)} ${num(x)} ${num(y + 44)}Q${num(x - 6)} ${num(y + 44)} ${num(x - 13)} ${num(y + 38)}L${num(x - 14)} ${num(y + 17)}L${num(x - 24)} ${num(y + 12)}Z`, col) +
      rect(x - 15, y - 4, 4, 9, C.wood, 1) +
      rect(x + 11, y - 4, 4, 9, C.wood, 1)
    );
  };
  const block = (x: number, y: number, a: number, col: string, mark: string) =>
    group(rect(x, y, 40, 40, C.cream, 6) + rect(x + 4, y + 4, 32, 32, col, 4, { opacity: 0.35 }) + mark, `rotate(${a} ${x + 20} ${y + 40})`);
  const cloud = (x: number, y: number, s: number) => group(circle(0, 0, 14, C.cream) + circle(16, -7, 17, C.cream) + circle(33, 0, 13, C.cream) + rect(-12, 0, 56, 13, C.cream, 6.5), `translate(${x} ${y}) scale(${s})`);
  return (
    base(7) +
    cloud(26, 120, 1) +
    cloud(404, 110, 0.9) +
    ropeLine(28, 26) +
    onesie(0.16, C.butter) +
    onesie(0.38, C.rose) +
    onesie(0.62, C.blue) +
    onesie(0.84, C.cream) +
    sparkle(170, 96, 6, C.white) +
    sparkle(320, 104, 5, C.white) +
    table() +
    shadow(240, 50) +
    block(198, 172, 0, C.berry, heart(218, 192, 7, C.berry)) +
    block(242, 172, 0, C.butter, star5(262, 193, 11, C.butter)) +
    block(221, 132, 6, C.blue, path('M246 144A11 11 0 1 0 246 164A8 8 0 1 1 246 144Z', C.blue)) +
    shadow(140, 18) +
    rect(126, 150, 28, 62, C.cream, 9) +
    rect(126, 178, 28, 34, C.white, 9, { opacity: 0.85 }) +
    line('M130 162H138M130 172H138M130 182H138', C.lilac, 1.6) +
    rect(123, 140, 34, 11, C.lilac, 3) +
    path('M131 140C131 128 136 118 140 118C144 118 149 128 149 140Z', C.butter) +
    shadow(336, 26) +
    group(rect(330, 166, 10, 44, C.rose, 5) + circle(335, 214, 8, 'none', { stroke: C.rose, 'stroke-width': 4 }), `rotate(28 335 190)`) +
    circle(318, 160, 22, C.butter) +
    line('M300 152C310 158 326 158 336 150M302 168C312 174 326 174 336 166', C.rose, 3)
  );
}

function christmas(): string {
  const guest = pompon(350, T - 2, 0.4, 'santa');
  const snow = confetti(23, 30, [0, 0, 480, 200], [C.white, C.white, C.cream], [176, 56, 304, 212], true);
  return (
    base(3) +
    snow +
    guest.back +
    path(`M-20 ${T}C40 ${T - 10} 100 ${T + 4} 170 ${T - 2}S300 ${T - 8} 360 ${T}S450 ${T - 6} 500 ${T}V340H-20Z`, C.cream) +
    guest.front +
    shadow(240, 70, T + 1) +
    rect(232, 190, 16, 22, C.wood, 2) +
    path('M176 198Q240 186 304 198L240 128Z', C.leaf) +
    path('M190 164Q240 152 290 164L240 98Z', C.green) +
    path('M204 128Q240 118 276 128L240 70Z', C.leaf) +
    line('M196 184Q240 170 284 160', C.cream, 2.4, { 'stroke-dasharray': '1 6', opacity: 0.95 }) +
    line('M206 152Q240 142 270 132', C.cream, 2.4, { 'stroke-dasharray': '1 6', opacity: 0.95 }) +
    circle(214, 186, 6, C.berry) +
    circle(262, 182, 6, C.butter) +
    circle(240, 172, 5.5, C.blue) +
    circle(226, 150, 5.5, C.butter) +
    circle(256, 150, 5, C.berry) +
    circle(242, 120, 4.5, C.blue) +
    circle(228, 108, 4, C.berry) +
    star5(240, 66, 14, C.butter) +
    present(194, 36, 28, C.berry, C.butter, T + 2) +
    present(286, 30, 22, C.butter, C.berry, T + 4)
  );
}

function newyear(): string {
  const burst = (x: number, y: number, r: number, col: string) => {
    let d = '';
    let dots = '';
    for (let i = 0; i < 12; i += 1) {
      const a = (i * Math.PI) / 6 + 0.13;
      d += `M${num(x + r * 0.32 * Math.cos(a))} ${num(y + r * 0.32 * Math.sin(a))}L${num(x + r * 0.82 * Math.cos(a))} ${num(y + r * 0.82 * Math.sin(a))}`;
      dots += circle(x + r * Math.cos(a), y + r * Math.sin(a), 2.6, col);
    }
    return line(d, col, 3.4) + dots + circle(x, y, 4, col);
  };
  return (
    base(6) +
    burst(128, 86, 46, C.butter) +
    burst(352, 62, 40, C.rose) +
    burst(424, 146, 28, C.teal) +
    burst(58, 152, 24, C.blue) +
    sparkle(220, 40, 5, C.white) +
    sparkle(270, 22, 3.5, C.white, 0.8) +
    sparkle(30, 60, 3.5, C.white, 0.8) +
    sparkle(460, 70, 3, C.white, 0.7) +
    confetti(5, 18, [150, 60, 330, 190], [C.butter, C.rose, C.teal, C.white], [170, 100, 310, 212]) +
    table() +
    shadow(214, 22) +
    path(`M200 ${T}V156C200 144 206 136 208 128V108H220V128C222 136 228 144 228 156V${T}Z`, C.leaf) +
    rect(200, 164, 28, 26, C.butter, 2) +
    star5(214, 177, 7, C.deep) +
    rect(206, 100, 16, 20, C.butter, 2) +
    rect(204, 156, 4, 50, C.white, 2, { opacity: 0.22 }) +
    group(rect(0, 0, 10, 14, C.wood, 3), 'translate(232 64) rotate(30)') +
    line('M216 98C220 86 226 80 232 76M212 96C210 84 204 78 196 76', C.butter, 2, { opacity: 0.8, 'stroke-dasharray': '1 5' }) +
    shadow(282, 26) +
    flute(268, T, 10, C.butter) +
    flute(296, T, -10, C.butter) +
    sparkle(282, 132, 8, C.white)
  );
}

function halloween(): string {
  let web = '';
  for (let i = 0; i < 5; i += 1) {
    const a = (i * Math.PI) / 8;
    web += `M-4 -4L${num(-4 + 120 * Math.cos(a))} ${num(-4 + 120 * Math.sin(a))}`;
  }
  for (const r of [34, 62, 90]) {
    let d = '';
    for (let i = 0; i <= 4; i += 1) {
      const a = (i * Math.PI) / 8;
      d += `${i ? 'L' : 'M'}${num(-4 + r * Math.cos(a))} ${num(-4 + r * Math.sin(a))}`;
    }
    web += d;
  }
  const bat = (x: number, y: number, s: number) =>
    group(path('M0 0C-6 -8 -14 -10 -26 -6C-20 -2 -20 4 -22 8C-16 4 -10 6 -6 10C-4 6 -2 4 0 4C2 4 4 6 6 10C10 6 16 4 22 8C20 4 20 -2 26 -6C14 -10 6 -8 0 0Z', C.lilac) + circle(0, 0, 4, C.lilac), `translate(${x} ${y}) scale(${s})`);
  return (
    base(6) +
    circle(352, 76, 70, C.butter, { opacity: 0.1 }) +
    circle(352, 76, 40, C.butter) +
    circle(338, 66, 7, C.deep, { opacity: 0.16 }) +
    circle(364, 88, 10, C.deep, { opacity: 0.14 }) +
    circle(366, 60, 4.5, C.deep, { opacity: 0.16 }) +
    line(web, C.cream, 1.2, { opacity: 0.4 }) +
    bat(152, 66, 1) +
    bat(198, 96, 0.7) +
    bat(420, 132, 0.6) +
    sparkle(440, 40, 3.5, C.white, 0.8) +
    sparkle(100, 130, 3, C.white, 0.7) +
    table() +
    shadow(240, 62) +
    path('M238 140C236 128 242 120 250 118C248 126 246 132 246 140Z', C.leaf) +
    ellipse(214, 178, 27, 34, C.orange) +
    ellipse(266, 178, 27, 34, C.orange) +
    ellipse(240, 176, 30, 37, C.orange) +
    line('M226 146C218 166 218 192 226 210M254 146C262 166 262 192 254 210', C.deep, 2, { opacity: 0.5 }) +
    path('M218 166L232 166L225 154Z', C.flame) +
    path('M248 166L262 166L255 154Z', C.flame) +
    path('M236 176L244 176L240 169Z', C.flame) +
    path('M214 186L222 194L230 187L240 195L250 187L258 194L266 186C262 200 218 200 214 186Z', C.flame) +
    shadow(168, 26) +
    ellipse(168, 194, 23, 18, C.deep) +
    line('M160 178C156 188 156 202 160 210M176 178C180 188 180 202 176 210', C.orange, 1.6, { opacity: 0.6 }) +
    rect(166, 172, 4, 8, C.leaf, 1.5) +
    shadow(322, 18, T + 4) +
    path('M304 186V150C304 132 314 122 322 122C330 122 340 132 340 150V186L334 180L328 186L322 180L316 186L310 180Z', C.cream) +
    ellipse(315, 146, 3.4, 4.6, C.charcoal) +
    ellipse(329, 146, 3.4, 4.6, C.charcoal) +
    ellipse(322, 158, 3, 3.8, C.charcoal, { opacity: 0.6 })
  );
}

function easter(): string {
  const guest = pompon(346, T, 0.44);
  const egg = (x: number, y: number, rx: number, ry: number, col: string, deco: string, a = 0) =>
    group(path(`M${x} ${y - ry}C${x + rx * 1.1} ${y - ry} ${x + rx} ${y + ry} ${x} ${y + ry}C${x - rx} ${y + ry} ${x - rx * 1.1} ${y - ry} ${x} ${y - ry}Z`, col) + deco, `rotate(${a} ${x} ${y})`);
  const tulip = (x: number, h: number, col: string) =>
    line(`M${x} ${T}V${T - h}`, C.leaf, 3) +
    ellipse(x - 6, T - h * 0.35, 4, 12, C.green, { transform: `rotate(-30 ${x - 6} ${T - h * 0.35})` }) +
    path(`M${x - 9} ${T - h - 14}L${x - 4} ${T - h - 6}L${x} ${T - h - 15}L${x + 4} ${T - h - 6}L${x + 9} ${T - h - 14}C${x + 10} ${T - h + 2} ${x - 10} ${T - h + 2} ${x - 9} ${T - h - 14}Z`, col);
  return (
    base(5) +
    circle(408, 52, 24, C.butter) +
    circle(408, 52, 38, C.butter, { opacity: 0.2 }) +
    sparkle(120, 70, 6, C.white) +
    sparkle(300, 46, 5, C.white) +
    guest.back +
    grass() +
    guest.front +
    tulip(100, 44, C.rose) +
    tulip(124, 58, C.butter) +
    tulip(146, 38, C.berry) +
    tulip(412, 50, C.rose) +
    tulip(436, 40, C.lilac) +
    shadow(228, 62, T + 6) +
    ellipse(228, T - 2, 58, 16, C.wood) +
    egg(204, T - 18, 14, 19, C.butter, line(`M190 ${T - 20}l5 -5l5 5l5 -5l5 5l5 -5l5 5`, C.rose, 2.2), -10) +
    egg(254, T - 18, 14, 19, C.rose, line(`M242 ${T - 24}H266M241 ${T - 14}H267`, C.white, 2.6, { opacity: 0.85 }), 10) +
    egg(229, T - 24, 15, 21, C.blue, circle(223, T - 30, 2.6, C.white) + circle(234, T - 26, 2.6, C.white) + circle(226, T - 16, 2.6, C.white) + circle(236, T - 12, 2, C.white)) +
    path(`M170 ${T - 2}C170 ${T + 10} 196 ${T + 16} 228 ${T + 16}C260 ${T + 16} 286 ${T + 10} 286 ${T - 2}C278 ${T + 4} 256 ${T + 6} 228 ${T + 6}C200 ${T + 6} 178 ${T + 4} 170 ${T - 2}Z`, C.wood) +
    line(`M178 ${T + 4}l12 3M198 ${T + 9}l14 1M240 ${T + 9}l14 -1M262 ${T + 6}l12 -4`, C.charcoal, 1.4, { opacity: 0.3 }) +
    egg(40, T + 6, 9, 12, C.lilac, '', -16) +
    egg(456, T + 4, 9, 12, C.teal, '', 14)
  );
}

const ART: Readonly<Record<ThemeId, () => string>> = {
  birthday,
  party,
  gamenight,
  dinner,
  bbq,
  movie,
  sport,
  picnic,
  concert,
  housewarming,
  wedding,
  baby,
  christmas,
  newyear,
  halloween,
  easter,
};

const cache = new Map<ThemeId, string>();

/** The inner SVG markup of a motif (cached: a pure drawing). */
export function coverMarkup(id: ThemeId): string {
  let markup = cache.get(id);
  if (markup === undefined) {
    markup = ART[id]();
    cache.set(id, markup);
  }
  return markup;
}

/**
 * The window of the canvas a box shows: `cover` = all of it (cut by the box's own shape, see the header);
 * `thumb` = the motif's middle, zoomed in, for the picker's small squares.
 */
export const CROPS = { cover: `0 0 ${VIEW_W} ${VIEW_H}`, thumb: '130 44 220 180' } as const;

/** The whole <svg> of a motif: decorative (the occasion's title says what it is), filling its box like a cover photo. */
export function coverSvg(id: ThemeId, crop: keyof typeof CROPS = 'cover'): string {
  return `<svg class="cv-svg" viewBox="${CROPS[crop]}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-cover="${id}" data-tone="${THEMES[id].tone}">${coverMarkup(id)}</svg>`;
}
