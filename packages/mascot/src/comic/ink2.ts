/**
 * Ink drawings of episode 2 «Zweimal derselbe Schal» (31.10; in the package since 31.10), in the v4 manga language
 * (ink.ts):
 * black & white with screen-tones; the one spot colour only on the wish stars and the glowing birthday door 21
 * (each wrapped in `data-spot` = star / door). Everything else neutral grey. Our own drawings only.
 */

import { rnd, starPath } from './util';
import { INK, PAPER, SPOT, SPOT_DARK, SPOT_LIGHT } from './ink';

const f1 = (v: number): string => v.toFixed(1);

export type WishIcon = 'book' | 'plant' | 'kite';

/** The ink icon inside a wish star (white with an ink line), centred on (0, 0), about 2 × s wide. */
function icon(kind: WishIcon, s: number): string {
  const k = s / 10;
  const q = (v: number) => f1(v * k);
  const line = `stroke="${INK}" stroke-width="${q(1.3)}" stroke-linejoin="round" stroke-linecap="round"`;
  switch (kind) {
    case 'book':
      return `<path d="M0 ${q(-6)} C${q(-4)} ${q(-8.5)} ${q(-8)} ${q(-8)} ${q(-11)} ${q(-6.5)} L${q(-11)} ${q(7)} C${q(-8)} ${q(5.5)} ${q(-4)} ${q(5.5)} 0 ${q(8)} C${q(4)} ${q(5.5)} ${q(8)} ${q(5.5)} ${q(11)} ${q(7)} L${q(11)} ${q(-6.5)} C${q(8)} ${q(-8)} ${q(4)} ${q(-8.5)} 0 ${q(-6)} Z" fill="${PAPER}" ${line}/>
        <path d="M0 ${q(-6)} V${q(8)} M${q(-8)} ${q(-3)} L${q(-3)} ${q(-2)} M${q(-8)} ${q(1)} L${q(-3)} ${q(2)} M${q(3)} ${q(-2)} L${q(8)} ${q(-3)} M${q(3)} ${q(2)} L${q(8)} ${q(1)}" fill="none" ${line}/>`;
    case 'plant':
      return `<path d="M${q(-6)} ${q(2)} L${q(6)} ${q(2)} L${q(4.5)} ${q(10)} L${q(-4.5)} ${q(10)} Z" fill="${INK}" ${line}/>
        <path d="M0 ${q(2)} V${q(-5)}" fill="none" ${line}/>
        <path d="M0 ${q(-3)} C${q(-3)} ${q(-9)} ${q(-9)} ${q(-9)} ${q(-10)} ${q(-6)} C${q(-8)} ${q(-2)} ${q(-3)} ${q(-1)} 0 ${q(-3)} Z" fill="${PAPER}" ${line}/>
        <path d="M0 ${q(-5)} C${q(3)} ${q(-11)} ${q(9)} ${q(-11)} ${q(10)} ${q(-8)} C${q(8)} ${q(-4)} ${q(3)} ${q(-3)} 0 ${q(-5)} Z" fill="${PAPER}" ${line}/>`;
    case 'kite':
      return `<path d="M${q(-2)} ${q(-11)} L${q(7)} ${q(-3)} L${q(1)} ${q(7)} L${q(-8)} ${q(-1)} Z" fill="${PAPER}" ${line}/>
        <path d="M${q(-2)} ${q(-11)} L${q(1)} ${q(7)} M${q(7)} ${q(-3)} L${q(-8)} ${q(-1)}" fill="none" ${line}/>
        <path d="M${q(1)} ${q(7)} C${q(4)} ${q(10)} ${q(0)} ${q(12)} ${q(5)} ${q(14)}" fill="none" ${line}/>
        <path d="M${q(2.5)} ${q(10)} l${q(2)} ${q(-1)} M${q(2.8)} ${q(12.6)} l${q(2)} ${q(-0.6)}" fill="none" ${line}/>`;
  }
}

/** A wish star (spot colour) with an ink icon in it, centred on (0, 0); `glow` adds its halo. */
export function wishSpot(p: string, r: number, kind: WishIcon, glow = true): string {
  return `<g data-spot="star">${glow ? `<circle r="${f1(r * 2.4)}" fill="url(#${p}-glowS)"/>` : ''}
    <path d="${starPath(0, 0, r, r * 0.5)}" fill="${SPOT}" stroke="${INK}" stroke-width="${f1(Math.max(1.4, r * 0.07))}" stroke-linejoin="round"/>
    <path d="${starPath(0, -r * 0.06, r * 0.62, r * 0.31)}" fill="${SPOT_LIGHT}" opacity=".55"/>
    <g transform="translate(0 ${f1(r * 0.04)})">${icon(kind, r * 0.42)}</g></g>`;
}

/** A dashed star outline: the place of a wish that is taken (neutral ink), centred on (0, 0). */
export function takenSpot(r: number): string {
  return `<path d="${starPath(0, 0, r, r * 0.5)}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-dasharray="3.5 3" stroke-linejoin="round"/>`;
}

/** Door 21 (the birthday) in the spot colour, its glow and a cake; `open` = the door swung open, light pouring out. */
export function doorSpot(p: string, x: number, y: number, w: number, h: number, day: number, open = false): string {
  const r = w / 2;
  const top = y - h / 2 + r;
  const d = `M${f1(x - r)} ${f1(y + h / 2)} V${f1(top)} A${f1(r)} ${f1(r)} 0 0 1 ${f1(x + r)} ${f1(top)} V${f1(y + h / 2)} Z`;
  const leaf = open
    ? `<path d="M${f1(x - r)} ${f1(y + h / 2)} V${f1(top)} L${f1(x - r - w * 0.45)} ${f1(top + 4)} V${f1(y + h / 2 + 4)} Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/>`
    : '';
  return `<g data-spot="door"><circle cx="${x}" cy="${y}" r="${f1(w * 2)}" fill="url(#${p}-glowS)"/>
    <path d="${d}" fill="${SPOT}" stroke="${INK}" stroke-width="1.8"/><path d="M${f1(x - r * 0.6)} ${f1(y + h / 2 - 2)} V${f1(top)} A${f1(r * 0.6)} ${f1(r * 0.6)} 0 0 1 ${f1(x + r * 0.6)} ${f1(top)} V${f1(y + h / 2 - 2)} Z" fill="${SPOT_LIGHT}"/>
    ${leaf}
    <rect x="${f1(x - 8)}" y="${f1(y - h / 2 - 12)}" width="16" height="10" rx="2" fill="${SPOT}" stroke="${INK}" stroke-width="1"/>
    <text x="${x}" y="${f1(y - h / 2 - 4.2)}" text-anchor="middle" font-size="8" font-weight="900" fill="${INK}" font-family="system-ui, sans-serif">${day}</text>
    <path d="M${f1(x - r * 0.35)} ${f1(y + h * 0.2)} h${f1(r * 0.7)}" stroke="${SPOT_DARK}" stroke-width="1.2" opacity=".5"/></g>`;
}

/** A closed gift box with a bow (ink), base centre (0, 0), ~w wide. Both guests carry exactly this one. */
export function boxInk(p: string, w = 40): string {
  const h = w * 0.8;
  return `<rect x="${f1(-w / 2)}" y="${f1(-h)}" width="${w}" height="${f1(h)}" rx="3" fill="${PAPER}" stroke="${INK}" stroke-width="1.8"/>
    <rect x="${f1(-w * 0.1)}" y="${f1(-h)}" width="${f1(w * 0.2)}" height="${f1(h)}" fill="url(#${p}-t3)" stroke="${INK}" stroke-width="1"/>
    <rect x="${f1(-w / 2)}" y="${f1(-h * 0.6)}" width="${w}" height="${f1(h * 0.16)}" fill="url(#${p}-t3)" stroke="${INK}" stroke-width="1"/>
    <path d="M0 ${f1(-h)} C${f1(-w * 0.32)} ${f1(-h - w * 0.36)} ${f1(-w * 0.42)} ${f1(-h - w * 0.06)} 0 ${f1(-h)} C${f1(w * 0.32)} ${f1(-h - w * 0.36)} ${f1(w * 0.42)} ${f1(-h - w * 0.06)} 0 ${f1(-h)} Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

/**
 * The striped scarf (ink), held in both paws and hanging down, in puppet units centred between the paws. The two
 * guests' scarves are this SAME drawing: identical stripes and fringe — the joke.
 */
export function scarfInk(p: string): string {
  // a sagging drape between the two hands (held at (±56, -16)), striped across, two tails hanging down with fringe
  type Q = readonly [number, number];
  const at = (k: number, a: Q, b: Q, c: Q, d: Q): Q => {
    const u = 1 - k;
    return [u * u * u * a[0] + 3 * u * u * k * b[0] + 3 * u * k * k * c[0] + k * k * k * d[0], u * u * u * a[1] + 3 * u * u * k * b[1] + 3 * u * k * k * c[1] + k * k * k * d[1]];
  };
  const A0: Q = [-56, -16];
  const A1: Q = [-28, 34];
  const A2: Q = [28, 34];
  const A3: Q = [56, -16];
  const band = 'M-56 -24 C-28 26 28 26 56 -24 L56 -8 C28 42 -28 42 -56 -8 Z';
  const stripes = [0.2, 0.38, 0.62, 0.8].map((k) => {
    const [x, y] = at(k, A0, A1, A2, A3);
    const [x2, y2] = at(k + 0.01, A0, A1, A2, A3);
    const len = Math.hypot(x2 - x, y2 - y) || 1;
    const [nx, ny] = [-(y2 - y) / len, (x2 - x) / len];
    return `<path d="M${f1(x - nx * 8)} ${f1(y - ny * 8)} L${f1(x + nx * 8)} ${f1(y + ny * 8)}" stroke="url(#${p}-t4)" stroke-width="7"/>`;
  }).join('');
  const tail = (x: number, dir: number) => `<path d="M${x - dir * 2} -18 l${dir * 13} 0 l${dir * 1} 50 l${dir * -14} 0 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M${x - dir * 1} 2 l${dir * 13} 0 l0 7 l${dir * -13} 0 Z M${x - dir * 1} 18 l${dir * 13} 0 l0 7 l${dir * -13} 0 Z" fill="url(#${p}-t4)"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M${f1(x + dir * (i * 3.6 - 0.5))} 32 l0 7" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`).join('')}`;
  return `${tail(-56, 1)}${tail(56, -1)}<path d="${band}" fill="${PAPER}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>${stripes}<path d="${band}" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
}

/** A party hat (ink, stripes in tone, a white pompom), worn on a bunny's head (puppet units). */
export function partyHat(p: string): string {
  return `<g transform="rotate(-8 0 -160)"><path d="M-18 -158 L2 -212 L20 -158 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M-11 -177 L13 -177 L16 -168 L-14 -168 Z M-4 -196 L8 -196 L10 -189 L-6 -189 Z" fill="url(#${p}-t3)"/>
    <path d="M-18 -158 Q1 -150 20 -158" fill="none" stroke="${INK}" stroke-width="1.8"/>
    <circle cx="2" cy="-214" r="6" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/></g>`;
}

/** A big leaf (ink) lying on the ground, centred on (0, 0), w wide: the board where Tapsi lays out the wishes. */
export function leafInk(p: string, w: number): string {
  const h = w * 0.42;
  const d = `M${f1(-w / 2)} 0 C${f1(-w * 0.3)} ${f1(-h)} ${f1(w * 0.3)} ${f1(-h)} ${f1(w / 2)} 0 C${f1(w * 0.3)} ${f1(h)} ${f1(-w * 0.3)} ${f1(h)} ${f1(-w / 2)} 0 Z`;
  const veins = [-0.3, -0.1, 0.1, 0.3].map((k) => `<path d="M${f1(w * k)} 0 l${f1(w * 0.07)} ${f1(-h * 0.5)} M${f1(w * k)} 0 l${f1(w * 0.07)} ${f1(h * 0.5)}" stroke="${INK}" stroke-width="1" opacity=".6"/>`).join('');
  return `<path d="${d}" fill="${PAPER}" stroke="${INK}" stroke-width="2"/><path d="M${f1(-w * 0.3)} ${f1(h * 0.62)} C${f1(-w * 0.05)} ${f1(h * 0.86)} ${f1(w * 0.3)} ${f1(h * 0.7)} ${f1(w * 0.42)} ${f1(h * 0.3)}" fill="none" stroke="url(#${p}-t3)" stroke-width="${f1(h * 0.16)}" stroke-linecap="round"/>
    <path d="M${f1(-w / 2 - 14)} ${f1(h * 0.18)} Q${f1(-w / 2 - 4)} ${f1(h * 0.04)} ${f1(-w / 2 + 4)} 0 L${f1(w / 2 - 6)} 0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>${veins}`;
}

/** Flag garland (ink, alternating tone) along a sagging line from (x0, y) to (x1, y). */
export function garland(p: string, x0: number, x1: number, y: number, n = 9): string {
  const sag = 16;
  const at = (t: number) => [x0 + (x1 - x0) * t, y + Math.sin(Math.PI * t) * sag] as const;
  const flags = Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    const [x, yy] = at(t);
    return `<path d="M${f1(x - 8)} ${f1(yy)} L${f1(x + 8)} ${f1(yy)} L${f1(x)} ${f1(yy + 16)} Z" fill="${i % 2 ? `url(#${p}-t3)` : PAPER}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`;
  }).join('');
  return `<path d="M${x0} ${y} Q${f1((x0 + x1) / 2)} ${y + sag * 2} ${x1} ${y}" fill="none" stroke="${INK}" stroke-width="1.3"/>${flags}`;
}

/** Despair lines (manga «уныние»): vertical ink strokes hanging from the top of a box. */
export function gloom(x0: number, x1: number, y: number, len: number, n = 16, seed = 5): string {
  return Array.from({ length: n }, (_, i) => {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n + (rnd(i, seed) - 0.5) * 6;
    const l = len * (0.45 + rnd(i, seed + 1) * 0.55);
    return `<path d="M${f1(x)} ${y} V${f1(y + l)}" stroke="${INK}" stroke-width="${f1(0.8 + rnd(i, seed + 2) * 1.2)}" stroke-linecap="round"/>`;
  }).join('');
}

/** A light bulb (ink) with rays, centred on (0, 0): the idea. */
export function bulbInk(p: string): string {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return `<path d="M${f1(Math.cos(a) * 22)} ${f1(Math.sin(a) * 22 - 4)} L${f1(Math.cos(a) * 30)} ${f1(Math.sin(a) * 30 - 4)}" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;
  }).join('');
  return `${rays}<path d="M-9 8 C-9 2 -15 -2 -15 -10 C-15 -19 -8 -24 0 -24 C8 -24 15 -19 15 -10 C15 -2 9 2 9 8 Z" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>
    <path d="M-5 -10 C-5 -16 0 -18 3 -18" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
    <rect x="-8" y="8" width="16" height="8" rx="2" fill="url(#${p}-t3)" stroke="${INK}" stroke-width="1.6"/>`;
}

/** The "!?" over a head (ink, bold), centred on (0, 0). */
export function exclaim(): string {
  return `<text x="0" y="12" text-anchor="middle" font-size="36" font-weight="900" font-style="italic" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round" paint-order="stroke fill" font-family="system-ui, sans-serif">!?</text>`;
}

/** An ink book (the real gift, unwrapped), base centre (0, 0). */
export function bookGift(p: string): string {
  return `<path d="M-24 0 L-24 -26 L22 -30 L24 -4 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M-24 -26 L-18 -32 L28 -36 L22 -30 Z" fill="url(#${p}-t2)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M22 -30 L28 -36 L30 -10 L24 -4 Z" fill="url(#${p}-t1)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M-14 -16 L12 -18 M-14 -10 L6 -12" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`;
}

/** An ink potted plant (the real gift), base centre (0, 0). */
export function plantGift(p: string): string {
  return `<path d="M-14 -22 L14 -22 L10 0 L-10 0 Z" fill="url(#${p}-t2)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <rect x="-16" y="-27" width="32" height="6" rx="2" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/>
    <path d="M0 -27 V-44" stroke="${INK}" stroke-width="1.8"/>
    <path d="M0 -36 C-6 -50 -20 -50 -22 -42 C-16 -34 -6 -33 0 -36 Z M0 -42 C6 -58 20 -58 22 -50 C16 -41 6 -40 0 -42 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

/** Confetti (ink): small strips, dots and ✧ scattered in a box w × h centred on (0, 0). */
export function confetti(w: number, h: number, n: number, seed = 3): string {
  return Array.from({ length: n }, (_, i) => {
    const x = (rnd(i, seed) - 0.5) * w;
    const y = (rnd(i, seed + 1) - 0.5) * h;
    const a = Math.round(rnd(i, seed + 2) * 180);
    return i % 3 === 0
      ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="2" fill="${INK}"/>`
      : `<rect x="${f1(x - 4)}" y="${f1(y - 1.6)}" width="8" height="3.2" fill="${i % 2 ? PAPER : INK}" stroke="${INK}" stroke-width=".9" transform="rotate(${a} ${f1(x)} ${f1(y)})"/>`;
  }).join('');
}
