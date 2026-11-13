/**
 * Ink drawings of the v4 manga (31.10; Felix: «надо такое в манге, но наши персонажи, есть анимации»; in the package
 * since 31.10 — the app's reader and the gallery share them):
 * black & white with dot screen-tones on white paper, and ONE spot colour — the warm orange of our palette — only on
 * what matters in the story: the wish star (and its glow), door 14, the "+1" and the heart at the end. Every drawing
 * that uses the spot colour is wrapped in an element with `data-spot` (star / door14 / plus1 / heart); everything else
 * is neutral grey (tests check this). Our own drawings only; general manga conventions, nothing copied.
 *
 * World px (0, 0 = top left of the ribbon) unless a function says "centred on (0, 0)".
 */

import { rnd, starPath } from './util';

const f1 = (v: number): string => v.toFixed(1);

export const INK = '#141414';
export const PAPER = '#FFFFFF';
/** The one spot colour (our palette's warm orange) and its shades. */
export const SPOT = '#F39A3D';
export const SPOT_DARK = '#C9671B';
export const SPOT_LIGHT = '#FFD39C';

// ---- screen-tones (one set of patterns per ribbon) ----------------------------------------------------------------

/** The tone patterns + masks, ids prefixed with `p`. Put once into the ribbon. */
export function toneDefs(p: string): string {
  const dots = (id: string, r: number, step = 4.6, rot = 45) =>
    `<pattern id="${p}-${id}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rot})"><circle cx="${step / 2}" cy="${step / 2}" r="${r}" fill="${INK}"/></pattern>`;
  return `${dots('t1', 0.8)}${dots('t2', 1.15)}${dots('t3', 1.6)}${dots('t4', 2.05)}
    <pattern id="${p}-h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 0 V4" stroke="${INK}" stroke-width=".9"/></pattern>
    <pattern id="${p}-hx" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 0 V5 M0 0 H5" stroke="${INK}" stroke-width=".7"/></pattern>
    <linearGradient id="${p}-down" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#000000"/></linearGradient>
    <linearGradient id="${p}-up" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>
    <mask id="${p}-mdown" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#${p}-down)"/></mask>
    <mask id="${p}-mup" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#${p}-up)"/></mask>
    <radialGradient id="${p}-glowW"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
    <g data-spot="star"><radialGradient id="${p}-glowS"><stop offset="0" stop-color="${SPOT}" stop-opacity=".55"/><stop offset=".55" stop-color="${SPOT}" stop-opacity=".18"/><stop offset="1" stop-color="${SPOT}" stop-opacity="0"/></radialGradient></g>`;
}

/** A tone fill over a rectangle; `fade` = 'up' (darkest at the top) / 'down' (darkest at the bottom) / none. */
export function toneRect(p: string, x: number, y: number, w: number, h: number, tone: 't1' | 't2' | 't3' | 't4', fade?: 'up' | 'down'): string {
  return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="url(#${p}-${tone})"${fade ? ` mask="url(#${p}-m${fade === 'up' ? 'down' : 'up'})"` : ''}/>`;
}

/** A night sky in a box: dark tone fading downwards, white stars (dots and ✧), optional extra density at the top. */
export function nightTone(p: string, x: number, y: number, w: number, h: number, seed: number, stars = 16): string {
  const dots = Array.from({ length: stars }, (_, i) => {
    const sx = x + rnd(i, seed) * w;
    const sy = y + rnd(i, seed + 3) * h * 0.85;
    const r = 0.9 + rnd(i, seed + 5) * 1.2;
    return i % 4 === 0
      ? `<g transform="translate(${f1(sx)} ${f1(sy)})"><circle r="${f1(r * 3)}" fill="#FFFFFF"/>${sparkleInk(r * 2.8, false)}</g>`
      : `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="${f1(r * 1.3)}" fill="#FFFFFF"/>`;
  }).join('');
  return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${PAPER}"/>
    ${toneRect(p, x, y, w, h, 't4', 'up')}${toneRect(p, x, y, w, h * 0.6, 't2', 'up')}${dots}`;
}

/** The moon: white disc with an ink line, two soft tone craters, a white halo over the tone. */
export function moonInk(p: string, x: number, y: number, r: number): string {
  return `<circle cx="${x}" cy="${y}" r="${f1(r * 2.4)}" fill="url(#${p}-glowW)"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${PAPER}" stroke="${INK}" stroke-width="1.8"/>
    <circle cx="${f1(x - r * 0.3)}" cy="${f1(y - r * 0.2)}" r="${f1(r * 0.2)}" fill="url(#${p}-t1)"/><circle cx="${f1(x + r * 0.32)}" cy="${f1(y + r * 0.28)}" r="${f1(r * 0.13)}" fill="url(#${p}-t1)"/>`;
}

/** Ink grass: tufts of three strokes along points. */
export function grassInk(points: ReadonlyArray<readonly [number, number]>, k = 1): string {
  return points.map(([x, y], i) => {
    const h = (7 + rnd(i, 11) * 6) * k;
    const s = 3.5 * k;
    return `<path d="M${f1(x - s)} ${f1(y)} Q${f1(x - s * 0.8)} ${f1(y - h * 0.7)} ${f1(x - s * 1.4)} ${f1(y - h)} M${f1(x)} ${f1(y)} Q${f1(x + s * 0.1)} ${f1(y - h)} ${f1(x + s * 0.3)} ${f1(y - h * 1.15)} M${f1(x + s)} ${f1(y)} Q${f1(x + s)} ${f1(y - h * 0.6)} ${f1(x + s * 1.6)} ${f1(y - h * 0.85)}"
      fill="none" stroke="${INK}" stroke-width="${f1(1.3 * Math.sqrt(k))}" stroke-linecap="round"/>`;
  }).join('');
}

/** A ground / hill shape: white with an ink line along its top `d` (an open path from left to right), closed below. */
export function groundInk(d: string, bottom: number, x0 = -10, x1 = 400): string {
  return `<path d="${d} L${x1} ${bottom} L${x0} ${bottom} Z" fill="${PAPER}"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
}

/** Hatching strokes in a band (shade on a ground), short parallel lines. */
export function hatch(x: number, y: number, w: number, n: number, seed: number, len = 9, angle = -35): string {
  const a = (angle * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => {
    const sx = x + (i / n) * w + rnd(i, seed) * 4;
    const sy = y + rnd(i, seed + 1) * 6;
    const l = len * (0.7 + rnd(i, seed + 2) * 0.5);
    return `<path d="M${f1(sx)} ${f1(sy)} l${f1(Math.cos(a) * l)} ${f1(Math.sin(a) * l)}" stroke="${INK}" stroke-width="1" stroke-linecap="round" opacity=".7"/>`;
  }).join('');
}

// ---- the door wall -------------------------------------------------------------------------------------------------

/** One ink door, arch-topped, centred on (x, y): white, ink line, planks, knob, its number on a little white plate. */
export function doorInk(x: number, y: number, w: number, h: number, day: number): string {
  const r = w / 2;
  const top = y - h / 2 + r;
  const d = `M${f1(x - r)} ${f1(y + h / 2)} V${f1(top)} A${f1(r)} ${f1(r)} 0 0 1 ${f1(x + r)} ${f1(top)} V${f1(y + h / 2)} Z`;
  return `<path d="${d}" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/>
    <path d="M${f1(x - r * 0.35)} ${f1(top - r * 0.5)} V${f1(y + h / 2)} M${f1(x + r * 0.35)} ${f1(top - r * 0.5)} V${f1(y + h / 2)}" stroke="${INK}" stroke-width=".7" opacity=".55"/>
    <circle cx="${f1(x + r * 0.55)}" cy="${f1(y + h * 0.12)}" r="1.5" fill="${INK}"/>
    <rect x="${f1(x - 8)}" y="${f1(y - h / 2 - 12)}" width="16" height="10" rx="2" fill="${PAPER}" stroke="${INK}" stroke-width="1"/>
    <text x="${x}" y="${f1(y - h / 2 - 4.2)}" text-anchor="middle" font-size="8" font-weight="800" fill="${INK}" font-family="system-ui, sans-serif">${day}</text>`;
}

/** Door 14 in the spot colour, with its glow and a cake inside (data-spot="door14"). */
export function door14(p: string, x: number, y: number, w: number, h: number, glow = 1): string {
  const r = w / 2;
  const top = y - h / 2 + r;
  const d = `M${f1(x - r)} ${f1(y + h / 2)} V${f1(top)} A${f1(r)} ${f1(r)} 0 0 1 ${f1(x + r)} ${f1(top)} V${f1(y + h / 2)} Z`;
  return `<g data-spot="door14"><circle cx="${x}" cy="${y}" r="${f1(w * 1.9 * glow)}" fill="url(#${p}-glowS)"/>
    <path d="${d}" fill="${SPOT}" stroke="${INK}" stroke-width="1.8"/><path d="M${f1(x - r * 0.6)} ${f1(y + h / 2 - 2)} V${f1(top)} A${f1(r * 0.6)} ${f1(r * 0.6)} 0 0 1 ${f1(x + r * 0.6)} ${f1(top)} V${f1(y + h / 2 - 2)} Z" fill="${SPOT_LIGHT}"/>
    <g transform="translate(${x} ${f1(y + 3)}) scale(${f1(w / 30)})">${cakeInk()}</g>
    <rect x="${f1(x - 8)}" y="${f1(y - h / 2 - 12)}" width="16" height="10" rx="2" fill="${SPOT}" stroke="${INK}" stroke-width="1"/>
    <text x="${x}" y="${f1(y - h / 2 - 4.2)}" text-anchor="middle" font-size="8" font-weight="900" fill="${INK}" font-family="system-ui, sans-serif">14</text></g>`;
}

/** Light rays from door 14 (spot colour, data-spot="door14"), centred on (0, 0). */
export function doorRays(n: number, r0: number, r1: number): string {
  return `<g data-spot="door14">${Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + 0.1;
    const w = 0.07 + rnd(i, 21) * 0.05;
    const l = r1 * (0.7 + rnd(i, 23) * 0.3);
    const p = (ang: number, r: number) => `${f1(Math.cos(ang) * r)} ${f1(Math.sin(ang) * r)}`;
    return `<path d="M${p(a - w, r0)} L${p(a, l)} L${p(a + w, r0)} Z" fill="${SPOT}" opacity=".32"/>`;
  }).join('')}</g>`;
}

/** A small ink cake (as in the app), centred on (0, 0), ~16 wide. */
export function cakeInk(): string {
  return `<path d="M-8 6.5h16" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
    <rect x="-6.8" y="-1.5" width="13.6" height="7.5" rx="1.6" fill="${PAPER}" stroke="${INK}" stroke-width="1.3"/>
    <path d="M-6.8 0.6 q1.7 2 3.4 0 t3.4 0 t3.4 0 t3.4 0" fill="none" stroke="${INK}" stroke-width="1.1"/>
    <rect x="-0.8" y="-7" width="1.6" height="5.5" rx=".6" fill="${INK}"/><path d="M0 -12 C1.8 -9.6 1.6 -7.8 0 -7.6 C-1.6 -7.8 -1.8 -9.6 0 -12 Z" fill="${PAPER}" stroke="${INK}" stroke-width=".9"/>`;
}

// ---- the story's objects -------------------------------------------------------------------------------------------

/** The wish star with the watering can in it, spot colour, ink outline, centred on (0, 0); `glow` adds its halo. */
export function starSpot(p: string, r: number, glow = true): string {
  // a watering can that reads as one (not a padlock): a WHITE tank with an ink line, a handle on its back (left), a long
  // spout to the upper right ending in a sprinkler rose, and three falling drops
  const can = (s: number) => {
    const k = s / 10;
    const q = (v: number) => f1(v * k);
    return `<g stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${q(-11)} ${q(-1)} C${q(-16)} ${q(-1)} ${q(-16)} ${q(7)} ${q(-10)} ${q(7)}" fill="none" stroke-width="${q(1.8)}"/>
      <path d="M${q(2)} ${q(4)} L${q(10.5)} ${q(-5)}" fill="none" stroke-width="${q(2.6)}"/>
      <path d="M${q(9)} ${q(-7.5)} L${q(14.5)} ${q(-2.5)} L${q(12.4)} ${q(-1)} L${q(8.2)} ${q(-5.6)} Z" fill="${INK}" stroke-width="${q(0.8)}"/>
      <path d="M${q(-10)} ${q(-3)} L${q(3)} ${q(-3)} L${q(4)} ${q(9)} L${q(-11)} ${q(9)} Z" fill="#FFFFFF" stroke-width="${q(1.5)}"/>
      <path d="M${q(-10.4)} ${q(1)} L${q(3.4)} ${q(1)}" fill="none" stroke-width="${q(1)}"/>
      ${[[15.5, 1.5], [14, 4.5], [17, 4]].map(([x = 0, y = 0]) => `<circle cx="${q(x)}" cy="${q(y)}" r="${q(0.9)}" fill="${INK}" stroke="none"/>`).join('')}</g>`;
  };
  return `<g data-spot="star">${glow ? `<circle r="${f1(r * 2.5)}" fill="url(#${p}-glowS)"/>` : ''}
    <path d="${starPath(0, 0, r, r * 0.5)}" fill="${SPOT}" stroke="${INK}" stroke-width="${f1(Math.max(1.4, r * 0.07))}" stroke-linejoin="round"/>
    <path d="${starPath(0, -r * 0.06, r * 0.62, r * 0.31)}" fill="${SPOT_LIGHT}" opacity=".55"/>
    <g transform="translate(${f1(-r * 0.04)} ${f1(r * 0.02)})">${can(r * 0.45)}</g></g>`;
}

/**
 * Mila's invitation in ink, 68 × 44 centred on (0, 0): white card, ink line, a toned header band, the cake, "14" and
 * "+1" — the "+1" in the spot colour only when `plus` (the end: the "+1" is Tapsi).
 */
export function cardInk(p: string, plus = false): string {
  return `<g transform="translate(-34 -22)"><rect x="0" y="0" width="68" height="44" rx="7" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/>
    <rect x="1" y="1" width="66" height="7" rx="3" fill="url(#${p}-t2)"/>
    <rect x="5" y="12" width="24" height="25" rx="5" fill="${PAPER}" stroke="${INK}" stroke-width="1"/>
    <g transform="translate(17 26)">${cakeInk()}</g>
    <text x="46" y="26" text-anchor="middle" font-size="16" font-weight="900" fill="${INK}" font-family="system-ui, sans-serif">14</text>
    ${plus
      ? `<g data-spot="plus1"><rect x="35" y="29" width="22" height="13" rx="6" fill="${SPOT}" stroke="${INK}" stroke-width="1"/><text x="46" y="39" text-anchor="middle" font-size="10" font-weight="900" fill="${INK}" font-family="system-ui, sans-serif">+1</text></g>`
      : `<text x="46" y="39" text-anchor="middle" font-size="10" font-weight="900" fill="${INK}" font-family="system-ui, sans-serif">+1</text>`}</g>`;
}

/** A heart in the spot colour with an ink line (data-spot="heart"), centred on (0, 0). */
export function heartSpot(r: number): string {
  return `<g data-spot="heart"><path d="M0 ${f1(r * 0.9)} C${f1(-r * 1.4)} ${f1(-r * 0.1)} ${f1(-r * 0.7)} ${f1(-r * 1.1)} 0 ${f1(-r * 0.35)} C${f1(r * 0.7)} ${f1(-r * 1.1)} ${f1(r * 1.4)} ${f1(-r * 0.1)} 0 ${f1(r * 0.9)} Z" fill="${SPOT}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/></g>`;
}

/** The empty gift box (ink), base centre (0, 0), lid open. */
export function giftInk(p: string): string {
  return `<rect x="-26" y="-36" width="52" height="36" rx="4" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>
    <rect x="-5" y="-36" width="10" height="36" fill="url(#${p}-t3)" stroke="${INK}" stroke-width="1.2"/>
    <path d="M-26 -36 L-20 -42 H20 L26 -36" fill="url(#${p}-t1)" stroke="${INK}" stroke-width="1.6"/>
    <g transform="translate(-34 -50) rotate(-30)"><rect x="-28" y="-9" width="56" height="10" rx="3" fill="${PAPER}" stroke="${INK}" stroke-width="1.8"/><rect x="-5" y="-9" width="10" height="10" fill="url(#${p}-t3)"/></g>`;
}

/** A paw (ink), centred on (0, 0), turned by `turn`, with an arm reaching back along -y. */
export function pawInk(p: string, turn: number, tone: 't1' | 't2' | null, k = 1): string {
  const arm = `<path d="M${f1(-15 * k)} ${f1(4 * k)} C${f1(-17 * k)} ${f1(40 * k)} ${f1(-14 * k)} ${f1(90 * k)} ${f1(-16 * k)} ${f1(140 * k)} L${f1(16 * k)} ${f1(140 * k)} C${f1(14 * k)} ${f1(90 * k)} ${f1(17 * k)} ${f1(40 * k)} ${f1(15 * k)} ${f1(4 * k)} Z" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`;
  const patch = tone ? `<ellipse cx="${f1(4 * k)}" cy="${f1(70 * k)}" rx="${f1(9 * k)}" ry="${f1(16 * k)}" fill="url(#${p}-${tone})"/>` : '';
  return `<g transform="rotate(${turn})">${arm}${patch}<ellipse rx="${f1(17 * k)}" ry="${f1(20 * k)}" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>
    <path d="M${f1(-6 * k)} ${f1(-12 * k)} l${f1(1.5 * k)} ${f1(5 * k)} M0 ${f1(-14 * k)} l0 ${f1(5 * k)} M${f1(6 * k)} ${f1(-12 * k)} l${f1(-1.5 * k)} ${f1(5 * k)}" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/></g>`;
}

// ---- manga marks (ink) ---------------------------------------------------------------------------------------------

/** ✧ a four-point sparkle: white with an ink line (or filled ink with `solid`), centred on (0, 0). */
export function sparkleInk(r: number, line = true, solid = false): string {
  const k = r * 0.13;
  const d = `M0 ${f1(-r)} Q${f1(k)} ${f1(-k)} ${f1(r)} 0 Q${f1(k)} ${f1(k)} 0 ${f1(r)} Q${f1(-k)} ${f1(k)} ${f1(-r)} 0 Q${f1(-k)} ${f1(-k)} 0 ${f1(-r)} Z`;
  return `<path d="${d}" fill="${solid ? INK : PAPER}"${line ? ` stroke="${INK}" stroke-width="${f1(Math.max(0.9, r * 0.12))}" stroke-linejoin="round"` : ''}/>`;
}

/** Focus lines: thin ink wedges from the edges of a box towards (cx, cy), a clear centre of radius `clear`. */
export function focusInk(cx: number, cy: number, clear: number, far: number, n = 60, seed = 1): string {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd(i, seed) * 0.06;
    const r0 = clear + rnd(i, seed + 3) * 40;
    const w = 0.6 + rnd(i, seed + 5) * 1.8;
    const [x0, y0] = [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0];
    const [x1, y1] = [cx + Math.cos(a) * far, cy + Math.sin(a) * far];
    const [nx, ny] = [-Math.sin(a) * w, Math.cos(a) * w];
    return `<path d="M${f1(x0)} ${f1(y0)} L${f1(x1 + nx)} ${f1(y1 + ny)} L${f1(x1 - nx)} ${f1(y1 - ny)} Z" fill="${INK}"/>`;
  }).join('');
}

/** An impact burst: spiky ink rays around (0, 0) between r0 and r1 (only between angles a0 … a1, degrees). */
export function burstInk(r0: number, r1: number, n = 22, seed = 3, a0 = 0, a1 = 360): string {
  return Array.from({ length: n }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * (i + 0.5)) / n) * Math.PI) / 180 + rnd(i, seed) * 0.12;
    const l = r0 + (r1 - r0) * (0.55 + rnd(i, seed + 1) * 0.45);
    const w = 0.05 + rnd(i, seed + 2) * 0.04;
    const p = (ang: number, r: number) => `${f1(Math.cos(ang) * r)} ${f1(Math.sin(ang) * r)}`;
    return `<path d="M${p(a - w, r0)} L${p(a, l)} L${p(a + w, r0)} Z" fill="${INK}"/>`;
  }).join('');
}

/** Speed lines along +x ending at (0, 0) (rotate the group to the way): n strokes, the middle ones longer. */
export function speedInk(len: number, spread: number, n = 5, seed = 7): string {
  return Array.from({ length: n }, (_, i) => {
    const y = (i - (n - 1) / 2) * (spread / Math.max(1, n - 1));
    const l = len * (0.55 + rnd(i, seed) * 0.45) * (1 - Math.abs(y) / (spread * 1.4));
    return `<path d="M${f1(-l)} ${f1(y)} L0 ${f1(y)}" stroke="${INK}" stroke-width="${f1(1 + rnd(i, seed + 1) * 1.2)}" stroke-linecap="round"/>`;
  }).join('');
}

/** A sweat drop (white, ink line, a tone shine), tip up, turned. */
export function sweatInk(p: string, r: number, turn = -20): string {
  const d = `M0 ${f1(-r * 1.7)} C${f1(r * 0.85)} ${f1(-r * 0.45)} ${f1(r)} ${f1(r * 0.3)} 0 ${f1(r)} C${f1(-r)} ${f1(r * 0.3)} ${f1(-r * 0.85)} ${f1(-r * 0.45)} 0 ${f1(-r * 1.7)} Z`;
  return `<g transform="rotate(${turn})"><path d="${d}" fill="${PAPER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M${f1(r * 0.3)} ${f1(-r * 0.2)} Q${f1(r * 0.55)} ${f1(r * 0.25)} ${f1(r * 0.25)} ${f1(r * 0.6)}" fill="none" stroke="url(#${p}-t3)" stroke-width="${f1(r * 0.35)}" stroke-linecap="round"/></g>`;
}

/** Surprise lines: short ink strokes radiating between angles a0 … a1 (degrees) around (0, 0). */
export function surpriseInk(r0: number, r1: number, a0: number, a1: number, n = 7): string {
  return Array.from({ length: n }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
    const len = (r1 - r0) * (0.7 + rnd(i, 13) * 0.3);
    return `<path d="M${f1(Math.cos(a) * r0)} ${f1(Math.sin(a) * r0)} L${f1(Math.cos(a) * (r0 + len))} ${f1(Math.sin(a) * (r0 + len))}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }).join('');
}

/** A dust puff (manga): an ink-outlined cloud with a few specks, centred on (0, 0). */
export function dustInk(k = 1): string {
  const p = (v: number) => f1(v * k);
  return `<path d="M${p(-24)} ${p(6)} A${p(8)} ${p(8)} 0 0 1 ${p(-15)} ${p(-6)} A${p(10)} ${p(10)} 0 0 1 ${p(-1)} ${p(-13)} A${p(10)} ${p(10)} 0 0 1 ${p(14)} ${p(-6)} A${p(8)} ${p(8)} 0 0 1 ${p(23)} ${p(6)} Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M${p(-13)} ${p(2)} A${p(5)} ${p(5)} 0 0 1 ${p(-4)} ${p(-4)}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>
    ${[[-30, -10, 2], [27, -14, 1.6], [31, -3, 1.3]].map(([x = 0, y = 0, r = 1]) => `<circle cx="${p(x)}" cy="${p(y)}" r="${p(r)}" fill="${INK}"/>`).join('')}`;
}

/** Grass rustle: three short ink strokes flicking up (mirrored with side = -1). */
export function rustleInk(k = 1, side: 1 | -1 = 1): string {
  const s = (v: number) => f1(v * k * side);
  const y = (v: number) => f1(v * k);
  return `<g fill="none" stroke="${INK}" stroke-width="${f1(1.6 * Math.sqrt(k))}" stroke-linecap="round">
    <path d="M${s(0)} ${y(0)} Q${s(2)} ${y(-6)} ${s(7)} ${y(-10)}"/><path d="M${s(5)} ${y(3)} Q${s(9)} ${y(-2)} ${s(15)} ${y(-4)}"/><path d="M${s(-4)} ${y(-2)} Q${s(-4)} ${y(-8)} ${s(-1)} ${y(-14)}"/></g>`;
}

/** A dizzy orbit: a dashed ellipse with three ✧, centred on (0, 0). */
export function orbitInk(): string {
  return `<ellipse rx="36" ry="10" fill="none" stroke="${INK}" stroke-width="1.4" stroke-dasharray="3 3.5"/>
    ${[[-32, 2, 7], [4, -9, 6], [29, 4, 5]].map(([x = 0, y = 0, r = 5]) => `<g transform="translate(${x} ${y})">${sparkleInk(r)}</g>`).join('')}`;
}

/** Wave marks beside a waving paw (two ink arcs), centred on the paw. */
export function waveInk(side: -1 | 1): string {
  return [13, 20].map((r) => {
    const a0 = side < 0 ? Math.PI * 1.05 : -Math.PI * 0.45;
    const a1 = a0 + Math.PI * 0.5;
    const p = (a: number) => `${f1(Math.cos(a) * r)} ${f1(Math.sin(a) * r)}`;
    return `<path d="M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
  }).join('');
}

/** A thought cloud outline path (scalloped) centred on (cx, cy), w × h. */
export function cloudPath(cx: number, cy: number, w: number, h: number, bumps = 9): string {
  const pts: string[] = [];
  for (let i = 0; i < bumps; i++) {
    const a0 = (i / bumps) * Math.PI * 2;
    const a1 = ((i + 1) / bumps) * Math.PI * 2;
    const p = (a: number) => [cx + Math.cos(a) * w * 0.5, cy + Math.sin(a) * h * 0.5] as const;
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const r = Math.hypot(x1 - x0, y1 - y0) * 0.62;
    pts.push(`${i === 0 ? `M${f1(x0)} ${f1(y0)} ` : ''}A${f1(r)} ${f1(r)} 0 0 1 ${f1(x1)} ${f1(y1)}`);
  }
  return `${pts.join(' ')} Z`;
}

/** A spiky shout balloon (white, ink line) with its text, centred on (0, 0), w × h. */
export function shoutInk(w: number, h: number, text: string, size: number, seed = 5): string {
  const n = 18;
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 0.78 + rnd(i, seed) * 0.08 : 1.02 + rnd(i, seed + 1) * 0.16;
    return `${f1(Math.cos(a) * w * 0.5 * r)} ${f1(Math.sin(a) * h * 0.5 * r)}`;
  });
  return `<path d="M${pts.join(' L')} Z" fill="${PAPER}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="miter"/>
    <text x="0" y="${f1(size * 0.36)}" text-anchor="middle" font-size="${size}" font-weight="900" font-style="italic" fill="${INK}" font-family="system-ui, sans-serif" letter-spacing="1">${esc(text)}</text>`;
}

/**
 * Sound-effect lettering set into the art: heavy italic capitals, white with a thick ink outline, each letter a little
 * turned and lifted (hand-lettered look), along +x from (0, 0).
 */
export function sfxInk(text: string, size: number, seed = 9, stroke = 6): string {
  const chars = [...text.toUpperCase()];
  const rot = chars.map((_, i) => f1((rnd(i, seed) - 0.5) * 22)).join(' ');
  const dy = chars.map((_, i) => f1(i === 0 ? 0 : (rnd(i, seed + 1) - 0.5) * size * 0.22)).join(' ');
  const t = (fill: string, sw: number) => `<text x="0" y="0" font-size="${size}" font-weight="900" font-style="italic" font-family="system-ui, sans-serif" letter-spacing="${f1(size * 0.02)}"
    rotate="${rot}" dy="${dy}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke fill">${esc(chars.join(''))}</text>`;
  return `${t(PAPER, stroke)}`;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
