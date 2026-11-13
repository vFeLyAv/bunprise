/**
 * The comic's drawings (26.10, GALLERY-ONLY prototype): night sky, hills, Pompon's burrow with a door for every day,
 * wish stars, the invitation, small effects. Plain SVG markup strings; panel backgrounds are in panel px
 * (0 0 PW PH, kit.ts), puppet-worn props in puppet units (0 0 = between the feet, head top ≈ -163).
 *
 * Colours: the promo film's night page (warm charcoal with dim colour fields; Felix 25.10 «оставляем только тёмную»)
 * — the comic looks like a continuation of the film, whatever the app's theme. New drawings (hill, burrow, doors) are
 * placeholders until Felix's own sketches (manga concept §2.2: the authorship is in his sketches and choices).
 */

import { PH, PW } from './kit';
// rnd + starPath live in the package's comic module since 31.10 (one source for the app and this gallery)
import { rnd, starPath } from '../../src/comic/util';
export { rnd, starPath } from '../../src/comic/util';

export const INK = '#2A231C';
export const NIGHT = {
  top: '#241B17',
  bottom: '#17110E',
  moon: '#F6E7C8',
  far: '#2B2A21',
  near: '#353A2A',
  moss: '#45512F',
  mossLight: '#5A6B3A',
  earth: '#3B2C22',
  earthDark: '#2C2019',
  door: '#9A6A3E',
  doorFrame: '#5E3E24',
  window: '#FFD58A',
  star: '#F6C25B',
  starEdge: '#E3A340',
} as const;

/** The night sky: gradient, two dim colour fields, small stars, optionally the moon at (mx, my). */
export function sky(opts: { moon?: { x: number; y: number; r: number }; stars?: number; seed?: number } = {}): string {
  const seed = opts.seed ?? 1;
  const dots = Array.from({ length: opts.stars ?? 22 }, (_, i) => {
    const x = rnd(i, seed) * PW;
    const y = rnd(i, seed + 7) * PH * 0.55;
    const r = 0.6 + rnd(i, seed + 3) * 1.1;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#F3DDB0" opacity="${(0.25 + rnd(i, seed + 5) * 0.45).toFixed(2)}"/>`;
  }).join('');
  const m = opts.moon;
  const moon = m
    ? `<circle cx="${m.x}" cy="${m.y}" r="${m.r * 2.6}" fill="url(#sp-moonglow-${seed})"/><circle cx="${m.x}" cy="${m.y}" r="${m.r}" fill="${NIGHT.moon}"/>
       <circle cx="${m.x - m.r * 0.32}" cy="${m.y - m.r * 0.18}" r="${m.r * 0.16}" fill="#E9D3AC" opacity=".7"/><circle cx="${m.x + m.r * 0.28}" cy="${m.y + m.r * 0.3}" r="${m.r * 0.11}" fill="#E9D3AC" opacity=".6"/>`
    : '';
  return `<defs>
    <linearGradient id="sp-sky-${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NIGHT.top}"/><stop offset="1" stop-color="${NIGHT.bottom}"/></linearGradient>
    <radialGradient id="sp-warm-${seed}" cx="0" cy="0" r="1"><stop offset="0" stop-color="rgba(255,150,84,.24)"/><stop offset="1" stop-color="rgba(255,150,84,0)"/></radialGradient>
    <radialGradient id="sp-cool-${seed}" cx="1" cy=".35" r=".9"><stop offset="0" stop-color="rgba(150,132,226,.18)"/><stop offset="1" stop-color="rgba(150,132,226,0)"/></radialGradient>
    <radialGradient id="sp-moonglow-${seed}"><stop offset="0" stop-color="rgba(246,231,200,.32)"/><stop offset="1" stop-color="rgba(246,231,200,0)"/></radialGradient>
  </defs>
  <rect width="${PW}" height="${PH}" fill="url(#sp-sky-${seed})"/>
  <rect width="${PW}" height="${PH}" fill="url(#sp-warm-${seed})"/>
  <rect width="${PW}" height="${PH}" fill="url(#sp-cool-${seed})"/>
  ${dots}${moon}`;
}

/** A filled ground shape from a path (with a faint moonlit rim on its top edge). */
export function ground(d: string, fill: string, rim = 'rgba(255,226,170,.16)'): string {
  return `<path d="${d}" fill="${fill}"/><path d="${d}" fill="none" stroke="${rim}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

/** Small grass tufts along a line (deterministic). */
export function tufts(points: ReadonlyArray<readonly [number, number]>, color: string = NIGHT.mossLight): string {
  return points.map(([x, y], i) => {
    const h = 6 + rnd(i, 11) * 6;
    return `<path d="M${x - 4} ${y} Q${x - 3} ${y - h * 0.7} ${x - 5} ${y - h} M${x} ${y} Q${x + 0.5} ${y - h} ${x + 1} ${y - h * 1.15} M${x + 4} ${y} Q${x + 4} ${y - h * 0.6} ${x + 6} ${y - h * 0.85}"
      fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`;
  }).join('');
}

/** A glowing wish star centred on (0, 0), radius r (the app's wish star: src/shapes.ts cookie colours). */
export function wishStar(r: number, glow = true, id = 'w'): string {
  const halo = glow
    ? `<defs><radialGradient id="sp-halo-${id}"><stop offset="0" stop-color="rgba(255,214,120,.55)"/><stop offset="1" stop-color="rgba(255,214,120,0)"/></radialGradient></defs><circle r="${r * 2.4}" fill="url(#sp-halo-${id})"/>`
    : '';
  return `${halo}<path d="${starPath(0, 0, r, r * 0.5)}" fill="${NIGHT.star}" stroke="${NIGHT.starEdge}" stroke-width="${(r * 0.12).toFixed(2)}" stroke-linejoin="round"/>
    <circle cx="${(-r * 0.22).toFixed(2)}" cy="${(-r * 0.18).toFixed(2)}" r="${(r * 0.11).toFixed(2)}" fill="#FFF3D6"/>`;
}

/** A four-point sparkle centred on (0, 0). */
export function sparkle(r: number, color = '#FFF3D6'): string {
  return `<path d="${starPath(0, 0, r, r * 0.24, 4)}" fill="${color}"/>`;
}

/** A dandelion clock (stem from (0, 0) up to the head). */
export function dandelion(h: number): string {
  const head = -h;
  const seeds = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const x = Math.cos(a) * 11;
    const y = head + Math.sin(a) * 11;
    return `<line x1="0" y1="${head}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(245,237,227,.55)" stroke-width=".8"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="rgba(245,237,227,.8)"/>`;
  }).join('');
  return `<path d="M0 0 Q3 ${head * 0.5} 0 ${head}" fill="none" stroke="#6F8A4A" stroke-width="2" stroke-linecap="round"/>
    <path d="M0 -8 Q-9 -14 -12 -22 Q-4 -18 0 -12 Z" fill="#5F7A3E"/>${seeds}<circle cx="0" cy="${head}" r="2.4" fill="#D9CBB0"/>`;
}

/**
 * Pompon's burrow: a mound of earth cut open, with a round door for every day — seven to a row like a month in the
 * app's calendar. `lit` = the day whose window glows (with the invitation's cake above it).
 */
export function burrow(x: number, y: number, w: number, rows: number, opts: { lit?: number; first?: number; door?: number } = {}): { markup: string; doorAt: (day: number) => { x: number; y: number } } {
  const cols = 7;
  const door = opts.door ?? (w - 40) / cols * 0.72;
  const gapX = (w - 40) / cols;
  const gapY = door * 1.42;
  const first = opts.first ?? 1;
  const h = rows * gapY + 46;
  const doorAt = (day: number) => {
    const i = day - first;
    return { x: x + 20 + gapX * (i % cols) + gapX / 2, y: y + 34 + gapY * Math.floor(i / cols) + door * 0.6 };
  };
  const doors: string[] = [];
  for (let i = 0; i < rows * cols; i++) {
    const day = first + i;
    const c = doorAt(day);
    const lit = day === opts.lit;
    const r = door / 2;
    // a round-topped door: arch + straight sides, a knob, the number on a tiny plate above
    doors.push(`<g>
      <path d="M${c.x - r} ${c.y + r * 0.9} V${c.y} A${r} ${r} 0 0 1 ${c.x + r} ${c.y} V${c.y + r * 0.9} Z" fill="${lit ? NIGHT.window : NIGHT.door}" stroke="${NIGHT.doorFrame}" stroke-width="2"/>
      ${lit ? '' : `<path d="M${c.x} ${c.y - r + 1.5} V${c.y + r * 0.9}" stroke="${NIGHT.doorFrame}" stroke-width="1" opacity=".55"/>`}
      <circle cx="${c.x + r * 0.45}" cy="${c.y + r * 0.25}" r="1.4" fill="${lit ? '#B8742E' : '#E8C27A'}"/>
      <text x="${c.x}" y="${c.y - r - 3}" text-anchor="middle" font-size="${Math.max(7, r * 0.62).toFixed(1)}" font-weight="700" fill="${lit ? '#FFE3A8' : 'rgba(245,237,227,.62)'}" font-family="system-ui, sans-serif">${day}</text>
    </g>`);
  }
  const lit = opts.lit !== undefined ? doorAt(opts.lit) : null;
  const glow = lit
    ? `<defs><radialGradient id="sp-door-glow"><stop offset="0" stop-color="rgba(255,213,138,.55)"/><stop offset="1" stop-color="rgba(255,213,138,0)"/></radialGradient></defs><circle cx="${lit.x}" cy="${lit.y}" r="${door * 1.7}" fill="url(#sp-door-glow)"/>`
    : '';
  const top = `M${x - 14} ${y + h} C${x - 10} ${y + 6} ${x + 30} ${y - 18} ${x + w / 2} ${y - 20} C${x + w - 30} ${y - 18} ${x + w + 10} ${y + 6} ${x + w + 14} ${y + h}`;
  // the earth, a band of moss along its top, and darker roots between the rows
  const roots = Array.from({ length: rows - 1 }, (_, r) => {
    const yy = y + 34 + gapY * (r + 1) - door * 0.12;
    return `<path d="M${x + 6} ${yy.toFixed(1)} q${(w / 4).toFixed(1)} 6 ${(w / 2).toFixed(1)} 0 t${(w / 2).toFixed(1)} 0" fill="none" stroke="${NIGHT.earthDark}" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`;
  }).join('');
  const markup = `${ground(`${top} Z`, NIGHT.earth)}${roots}
    <path d="${top}" fill="none" stroke="${NIGHT.moss}" stroke-width="9" stroke-linecap="round"/>
    <path d="${top}" fill="none" stroke="${NIGHT.mossLight}" stroke-width="2" stroke-linecap="round" transform="translate(0 -4)" opacity=".8"/>
    ${glow}${doors.join('')}`;
  return { markup, doorAt };
}

/** A birthday cake with one candle, centred on (0, 0), about 16 wide. */
export const CAKE = `<path d="M-8 6.5h16" stroke="#C2661E" stroke-width="1.5" stroke-linecap="round"/>
  <rect x="-6.8" y="-1.5" width="13.6" height="7.5" rx="1.6" fill="#F7C9A0" stroke="#C2661E" stroke-width="1.4"/>
  <path d="M-6.8 0.6 q1.7 2 3.4 0 t3.4 0 t3.4 0 t3.4 0" fill="none" stroke="#C2661E" stroke-width="1.3" stroke-linecap="round"/>
  <rect x="-0.8" y="-7" width="1.6" height="5.5" rx=".6" fill="#6C8CFF"/>
  <path d="M0 -12 C1.8 -9.6 1.6 -7.8 0 -7.6 C-1.6 -7.8 -1.8 -9.6 0 -12 Z" fill="#F0A04B"/>`;

/** Mila's invitation, 68 × 44 with its top-left corner at (0, 0): the cake (as in the app), "14" and "+1". */
const CARD = `<rect x="0" y="0" width="68" height="44" rx="9" fill="#fff" stroke="rgba(70,45,20,.18)"/>
  <rect x="0" y="0" width="68" height="7" rx="3.5" fill="#F0A04B" opacity=".9"/>
  <rect x="5" y="11" width="24" height="25" rx="6" fill="#FDE8D0"/>
  <g transform="translate(17 25)">${CAKE}</g>
  <text x="46" y="25" text-anchor="middle" font-size="16" font-weight="800" fill="#2A231C" font-family="system-ui, sans-serif">14</text>
  <text x="46" y="38.5" text-anchor="middle" font-size="10" font-weight="800" fill="#B65F1A" font-family="system-ui, sans-serif">+1</text>`;

/** The invitation carried in the mouth (puppet units: the mouth is at about y -78). */
export const MOUTH_CARD = `<g transform="translate(-30 -80) rotate(-8 34 0)">${CARD}</g>`;

/** The same invitation lying flat, centred on (0, 0), for the panel (not worn). */
export const CARD_FLAT = `<g transform="translate(-34 -22)">${CARD}</g>`;

/** A watering can (Mila's wish) centred on (0, 0), about 2 × s wide. */
export function wateringCan(s: number, color = '#7A4416'): string {
  const k = s / 10;
  const p = (v: number) => (v * k).toFixed(2);
  return `<g fill="none" stroke="${color}" stroke-width="${p(1.6)}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${p(-6)} ${p(-3)} h${p(9)} l${p(1)} ${p(9)} h${p(-11)} Z" fill="${color}" fill-opacity=".85"/>
    <path d="M${p(4)} ${p(0)} L${p(9)} ${p(-6)}"/><path d="M${p(8)} ${p(-8)} l${p(3)} ${p(3)}"/>
    <path d="M${p(-5)} ${p(-3)} C${p(-5)} ${p(-8)} ${p(2)} ${p(-8)} ${p(2)} ${p(-3)}"/></g>`;
}

/** Mila's wish: a glowing star with the watering can in it, centred on (0, 0). */
export function wishWithCan(r: number, id: string, glow = true): string {
  return `${wishStar(r, glow, id)}<g transform="translate(0 ${(r * 0.08).toFixed(2)})">${wateringCan(r * 0.42)}</g>`;
}

/**
 * The star glowing through Tapsi's cheek once it is swallowed (= reserved, as in the app), puppet units, on the
 * puppet's left cheek (screen left, src/hamster.ts .cheek-l at -66 -86).
 */
export function cheekGlow(id: string): string {
  return `<defs><radialGradient id="sp-cheek-${id}"><stop offset="0" stop-color="rgba(255,214,120,.95)"/><stop offset=".55" stop-color="rgba(255,200,100,.45)"/><stop offset="1" stop-color="rgba(255,200,100,0)"/></radialGradient></defs>
    <circle cx="-64" cy="-84" r="30" fill="url(#sp-cheek-${id})"/>
    <path d="${starPath(-64, -84, 8, 3.8)}" fill="#FFF0C2" opacity=".95"/>`;
}

/** Manga focus lines: thin rays from the panel edge towards (cx, cy), leaving a clear centre of radius `clear`. */
export function focusLines(cx: number, cy: number, clear: number, n = 44, color = 'rgba(245,237,227,.13)'): string {
  const far = Math.hypot(PW, PH);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd(i, 31) * 0.08;
    const r0 = clear + rnd(i, 33) * 40;
    const w = 1 + rnd(i, 35) * 2.2;
    const x0 = cx + Math.cos(a) * r0;
    const y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * far;
    const y1 = cy + Math.sin(a) * far;
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${(x1 + nx).toFixed(1)} ${(y1 + ny).toFixed(1)} L${(x1 - nx).toFixed(1)} ${(y1 - ny).toFixed(1)} Z" fill="${color}"/>`;
  }).join('');
}

/** An open, EMPTY gift box (lid leaning on it), base centre at (0, 0), ~70 wide. */
export const EMPTY_BOX = `<g>
  <ellipse cx="0" cy="-1" rx="36" ry="4.5" fill="rgba(0,0,0,.25)"/>
  <rect x="-31" y="-44" width="62" height="43" rx="6" fill="#F28C7A"/>
  <path d="M-31 -38 h62" stroke="rgba(0,0,0,.08)" stroke-width="8"/>
  <rect x="-6" y="-44" width="12" height="43" fill="#FFE08A"/>
  <path d="M-27 -44 L-20 -50 H20 L27 -44 Z" fill="#7A4A3A" opacity=".75"/>
  <g transform="translate(40 -10) rotate(68)">
    <rect x="-35" y="-13" width="70" height="13" rx="5" fill="#F6A291"/><rect x="-6.5" y="-13" width="13" height="13" fill="#FFE08A"/>
  </g></g>`;

/** A small heart centred on (0, 0). */
export function heart(r: number, color = '#FF8FA3'): string {
  return `<path d="M0 ${r * 0.9} C${-r * 1.4} ${-r * 0.1} ${-r * 0.7} ${-r * 1.1} 0 ${-r * 0.35} C${r * 0.7} ${-r * 1.1} ${r * 1.4} ${-r * 0.1} 0 ${r * 0.9} Z" fill="${color}"/>`;
}
