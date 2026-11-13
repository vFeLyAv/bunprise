/**
 * Drawings of the v2 strip (30.10, GALLERY-ONLY, docs/design/2026-10-26-manga-episode-1.md «v2»): one tall night
 * picture, W px wide, in world px (0, 0 = top left of the strip). Puppet-worn bits are in puppet units (0 0 = between
 * the feet, head top ≈ -163), as in props.ts. Colours: the promo film's night page + the gift / mascot palette
 * (props.ts NIGHT, the cookie star, the gift box colours). Placeholders until Felix's own sketches (concept §2.2).
 */

import type { Pt } from './panels';
import { NIGHT, rnd, sparkle, starPath } from './props';
// the roll's way (wayPieces, sampleWay) lives in the package's comic module since 31.10
export { sampleWay, wayPieces } from '../../src/comic/util';

const f1 = (v: number): string => v.toFixed(1);

/** One night sky for the whole strip: a long gradient, soft colour fields at the given heights, small stars. */
export function nightSky(w: number, h: number, fields: ReadonlyArray<{ y: number; warm?: boolean; x?: number; r?: number }>, starCount = 150): string {
  const stops = [
    [0, '#2B201B'], [0.16, '#1E1613'], [0.2, '#191210'], [0.26, '#231A20'], [0.4, '#1C1714'], [0.55, '#1A1310'], [0.7, '#231A1E'], [0.86, '#1F1714'], [1, '#150F0C'],
  ] as const;
  const grad = `<linearGradient id="sp2-sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${h}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>
    <radialGradient id="sp2-warm"><stop offset="0" stop-color="rgba(255,150,84,.22)"/><stop offset="1" stop-color="rgba(255,150,84,0)"/></radialGradient>
    <radialGradient id="sp2-cool"><stop offset="0" stop-color="rgba(150,132,226,.17)"/><stop offset="1" stop-color="rgba(150,132,226,0)"/></radialGradient>`;
  const glows = fields.map((f) => `<circle cx="${f.x ?? (f.warm ? 40 : w - 30)}" cy="${f.y}" r="${f.r ?? 260}" fill="url(#sp2-${f.warm ? 'warm' : 'cool'})"/>`).join('');
  const dots = Array.from({ length: starCount }, (_, i) => {
    const x = rnd(i, 51) * w;
    const y = rnd(i, 57) * h;
    const r = 0.6 + rnd(i, 53) * 1.1;
    return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r.toFixed(2)}" fill="#F3DDB0" opacity="${(0.22 + rnd(i, 55) * 0.45).toFixed(2)}"/>`;
  }).join('');
  return `<defs>${grad}</defs><rect width="${w}" height="${h}" fill="url(#sp2-sky)"/>${glows}${dots}`;
}

/** The moon with its glow and two craters. */
export function moon(x: number, y: number, r: number): string {
  return `<defs><radialGradient id="sp2-moonglow"><stop offset="0" stop-color="rgba(246,231,200,.3)"/><stop offset="1" stop-color="rgba(246,231,200,0)"/></radialGradient></defs>
    <circle cx="${x}" cy="${y}" r="${r * 2.8}" fill="url(#sp2-moonglow)"/><circle cx="${x}" cy="${y}" r="${r}" fill="${NIGHT.moon}"/>
    <circle cx="${f1(x - r * 0.32)}" cy="${f1(y - r * 0.18)}" r="${f1(r * 0.16)}" fill="#E9D3AC" opacity=".7"/><circle cx="${f1(x + r * 0.28)}" cy="${f1(y + r * 0.3)}" r="${f1(r * 0.11)}" fill="#E9D3AC" opacity=".6"/>`;
}

/** Grass tufts (deterministic); `k` scales them (bigger = closer to the camera). */
export function tufts2(points: ReadonlyArray<readonly [number, number]>, color: string = NIGHT.mossLight, k = 1): string {
  return points.map(([x, y], i) => {
    const h = (6 + rnd(i, 11) * 6) * k;
    const s = 4 * k;
    return `<path d="M${f1(x - s)} ${f1(y)} Q${f1(x - s * 0.75)} ${f1(y - h * 0.7)} ${f1(x - s * 1.25)} ${f1(y - h)} M${f1(x)} ${f1(y)} Q${f1(x + s * 0.12)} ${f1(y - h)} ${f1(x + s * 0.25)} ${f1(y - h * 1.15)} M${f1(x + s)} ${f1(y)} Q${f1(x + s)} ${f1(y - h * 0.6)} ${f1(x + s * 1.5)} ${f1(y - h * 0.85)}"
      fill="none" stroke="${color}" stroke-width="${(1.6 * Math.sqrt(k)).toFixed(2)}" stroke-linecap="round"/>`;
  }).join('');
}

/**
 * A moss floor from `y` (its wavy top) down to `y1`, then fading into the night over `fade` px: the way one place
 * melts into the next one down the strip (no frame, no gutter).
 */
export function mossFloor(w: number, y: number, y1: number, fade: number, seed: number, color: string = NIGHT.moss): string {
  const id = `sp2-mfade-${seed}`;
  const d = `M-10 ${y1} L-10 ${y + 6} C${f1(w * 0.22)} ${y - 5} ${f1(w * 0.58)} ${y + 9} ${w + 10} ${y - 3} L${w + 10} ${y1} Z`;
  const pts = Array.from({ length: 15 }, (_, i) => [6 + i * 27 + rnd(i, seed) * 10, y + 9 + rnd(i, seed + 2) * 8] as const);
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}" fill="${color}"/><path d="M-10 ${y + 6} C${f1(w * 0.22)} ${y - 5} ${f1(w * 0.58)} ${y + 9} ${w + 10} ${y - 3}" fill="none" stroke="rgba(255,226,170,.16)" stroke-width="1.6"/>
    <rect x="-10" y="${y1 - 2}" width="${w + 20}" height="${fade + 2}" fill="url(#${id})"/>${tufts2(pts)}`;
}

/** A band that fades from `from` (opaque at y0) into nothing at y1 (or the other way round with `up`). */
export function fadeBand(w: number, y0: number, y1: number, color: string, id: string, up = false): string {
  return `<defs><linearGradient id="sp2-fb-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${up ? 0 : 1}"/><stop offset="1" stop-color="${color}" stop-opacity="${up ? 1 : 0}"/></linearGradient></defs>
    <rect x="-10" y="${y0}" width="${w + 20}" height="${y1 - y0}" fill="url(#sp2-fb-${id})"/>`;
}

/** The hill: summit line, its face down to `bottom`, terrain lines, a footpath along the way (wider when nearer). */
export function hill(w: number, summit: string, bottom: number, way: ReadonlyArray<{ x: number; y: number; tx: number; ty: number }>, y0: number, y1: number): string {
  const face = `${summit} L${w + 10} ${bottom} L-10 ${bottom} Z`;
  // the footpath: a ribbon along the way, 10 px wide at the top, 40 px at the bottom (nearer the camera)
  const width = (y: number): number => 10 + 30 * Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  const left: string[] = [];
  const right: string[] = [];
  way.forEach((p, i) => {
    if (i % 2) return;
    const hw = width(p.y) / 2;
    left.push(`${f1(p.x - p.ty * hw)} ${f1(p.y + p.tx * hw * 0.55 + 2)}`);
    right.push(`${f1(p.x + p.ty * hw)} ${f1(p.y - p.tx * hw * 0.55 + 2)}`);
  });
  const ribbon = `M${left.join(' L')} L${right.reverse().join(' L')} Z`;
  // terrain: a few soft darker contours across the face, and tufts / tiny flowers scattered over it
  // short knolls, alternating sides: the face is not flat
  const contours = [0.2, 0.42, 0.64].map((k, i) => {
    const y = y0 + (y1 - y0) * k;
    const [a, b] = i % 2 ? [w * 0.5, w + 10] : [-10, w * 0.46];
    return `<path d="M${f1(a)} ${f1(y + 26)} C${f1(a + (b - a) * 0.3)} ${f1(y - 14)} ${f1(a + (b - a) * 0.7)} ${f1(y - 14)} ${f1(b)} ${f1(y + 26)}" fill="none" stroke="rgba(255,236,190,.07)" stroke-width="2" stroke-linecap="round"/><path d="M${f1(a)} ${f1(y + 30)} C${f1(a + (b - a) * 0.3)} ${f1(y - 10)} ${f1(a + (b - a) * 0.7)} ${f1(y - 10)} ${f1(b)} ${f1(y + 30)}" fill="none" stroke="rgba(18,20,12,.22)" stroke-width="6" stroke-linecap="round"/>`;
  }).join('');
  const spots = Array.from({ length: 26 }, (_, i) => [rnd(i, 71) * w, y0 + 40 + rnd(i, 73) * (y1 - y0 - 60)] as const)
    .filter(([x, y]) => !way.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 22));
  const flowers = spots.filter((_, i) => i % 4 === 1).map(([x, y], i) => `<g transform="translate(${f1(x)} ${f1(y)})"><circle r="2.2" fill="${i % 2 ? '#FFD7E0' : '#FFF1C9'}" opacity=".85"/><circle r=".9" fill="#F0A04B"/></g>`).join('');
  return `<defs><linearGradient id="sp2-face" gradientUnits="userSpaceOnUse" x1="0" y1="${y0}" x2="0" y2="${bottom}">
      <stop offset="0" stop-color="#3F4831"/><stop offset=".55" stop-color="#343B29"/><stop offset="1" stop-color="#2A3021"/></linearGradient></defs>
    <path d="${face}" fill="url(#sp2-face)"/>${contours}
    <path d="${summit}" fill="none" stroke="rgba(255,226,170,.22)" stroke-width="2" stroke-linejoin="round"/>
    <path d="${ribbon}" fill="#56553B" opacity=".9"/><path d="${ribbon}" fill="none" stroke="rgba(255,236,190,.12)" stroke-width="1.2"/>
    ${tufts2(spots.filter((_, i) => i % 4 !== 1))}${flowers}`;
}

/** Manga focus lines towards (cx, cy) inside the band y0 … y1, leaving a clear centre of radius `clear`. */
export function focusRays(w: number, cx: number, cy: number, clear: number, y0: number, y1: number, n = 46, color = 'rgba(245,237,227,.12)'): string {
  const far = Math.hypot(w, y1 - y0);
  const rays = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd(i, 31) * 0.08;
    const r0 = clear + rnd(i, 33) * 40;
    const wd = 1 + rnd(i, 35) * 2.2;
    const [x0, y0p] = [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0];
    const [x1, y1p] = [cx + Math.cos(a) * far, cy + Math.sin(a) * far];
    const [nx, ny] = [-Math.sin(a) * wd, Math.cos(a) * wd];
    return `<path d="M${f1(x0)} ${f1(y0p)} L${f1(x1 + nx)} ${f1(y1p + ny)} L${f1(x1 - nx)} ${f1(y1p - ny)} Z" fill="${color}"/>`;
  }).join('');
  return `<defs><clipPath id="sp2-rays-${Math.round(cy)}"><rect x="0" y="${y0}" width="${w}" height="${y1 - y0}"/></clipPath></defs><g clip-path="url(#sp2-rays-${Math.round(cy)})">${rays}</g>`;
}

/** A wish star alone (no halo), centred on (0, 0): crisp, with the cookie colours. */
export function starOnly(r: number): string {
  return `<path d="${starPath(0, 0, r, r * 0.5)}" fill="${NIGHT.star}" stroke="${NIGHT.starEdge}" stroke-width="${(r * 0.12).toFixed(2)}" stroke-linejoin="round"/>
    <circle cx="${(-r * 0.22).toFixed(2)}" cy="${(-r * 0.18).toFixed(2)}" r="${(r * 0.11).toFixed(2)}" fill="#FFF3D6"/>`;
}

/** A soft round glow (drawn BEHIND the puppets so it never washes anyone out). */
export function halo(r: number, id: string, alpha = 0.5): string {
  return `<defs><radialGradient id="sp2-halo-${id}"><stop offset="0" stop-color="rgba(255,214,120,${alpha})"/><stop offset="1" stop-color="rgba(255,214,120,0)"/></radialGradient></defs><circle r="${r}" fill="url(#sp2-halo-${id})"/>`;
}

/** A small glowing wish star with its halo (the other friends' wishes in the sky). */
export function skyWish(r: number, id: string): string {
  return `${halo(r * 2.6, id, 0.42)}${starOnly(r)}`;
}

/**
 * Pompon's thought: three little circles from his head up to a cloud with an empty gift box and a "?" in it
 * (language-neutral). Centred on the cloud; the circles go down-left towards (dx, dy).
 */
export function thought(dx: number, dy: number): string {
  const bumps: ReadonlyArray<readonly [number, number, number]> = [[-34, 2, 20], [-14, -14, 22], [12, -16, 22], [34, -2, 20], [24, 16, 18], [-2, 18, 19], [-26, 16, 17]];
  const ring = (stroke: boolean) => bumps.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" ${stroke ? 'fill="#2A231C"' : 'fill="#FFFFFF"'}/>`).join('');
  const tail = [[0.42, 7.5], [0.68, 5.2], [0.88, 3.4]].map(([k = 0, r = 0]) => `<circle cx="${f1(dx * k)}" cy="${f1(dy * k)}" r="${r + 2}" fill="#2A231C"/><circle cx="${f1(dx * k)}" cy="${f1(dy * k)}" r="${r}" fill="#FFFFFF"/>`).join('');
  // a tiny gift box (the gift palette) and the question mark
  const gift = `<g transform="translate(-16 4)"><rect x="-13" y="-10" width="26" height="20" rx="3.5" fill="#F28C7A"/><rect x="-3" y="-10" width="6" height="20" fill="#FFE08A"/>
    <rect x="-15" y="-15" width="30" height="7" rx="2.5" fill="#F6A291"/><rect x="-3" y="-15" width="6" height="7" fill="#FFE08A"/>
    <path d="M0 -15 C-6 -24 -12 -20 -7 -15 M0 -15 C6 -24 12 -20 7 -15" fill="none" stroke="#E8B54A" stroke-width="2" stroke-linecap="round"/></g>`;
  return `${tail}<g transform="translate(0 0)">${ring(true).replace(/r="(\d+)"/g, (_, r: string) => `r="${Number(r) + 2.4}"`)}${ring(false)}</g>${gift}
    <text x="20" y="13" text-anchor="middle" font-size="34" font-weight="900" fill="#2A231C" font-family="system-ui, sans-serif">?</text>`;
}

/** Mila's accessory: a small blossom (pink petals, sun centre), puppet units, centred on (x, y). */
export function blossom(x: number, y: number, r = 9): string {
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return `<ellipse cx="${f1(x + Math.cos(a) * r * 0.62)}" cy="${f1(y + Math.sin(a) * r * 0.62)}" rx="${f1(r * 0.5)}" ry="${f1(r * 0.42)}" transform="rotate(${f1((a * 180) / Math.PI + 90)} ${f1(x + Math.cos(a) * r * 0.62)} ${f1(y + Math.sin(a) * r * 0.62)})" fill="#FF8FA3" stroke="#D9667E" stroke-width="1"/>`;
  }).join('');
  return `<g class="blossom">${petals}<circle cx="${x}" cy="${y}" r="${f1(r * 0.32)}" fill="#FFD46B" stroke="#E3A340" stroke-width=".8"/>
    <path d="M${f1(x + r * 0.6)} ${f1(y + r * 0.7)} q${f1(r * 0.9)} ${f1(r * 0.3)} ${f1(r * 1.2)} ${f1(r * 1.1)}" fill="none" stroke="#6CB84C" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="${f1(x + r * 1.45)}" cy="${f1(y + r * 1.25)}" rx="${f1(r * 0.42)}" ry="${f1(r * 0.22)}" transform="rotate(35 ${f1(x + r * 1.45)} ${f1(y + r * 1.25)})" fill="#7AC458"/></g>`;
}

/**
 * The swallowed star INSIDE Tapsi's (left) cheek, drawn in that cheek's own units (src/hamster.ts .cheek-l: ellipse at
 * -66 -86, 15 × 25): a crisp star shape seen through the fur — a warm tint, the star, a fur sheen over its top, and
 * the cheek's bulge outlined. It lives inside .cheek-j, so it puffs and turns with the cheek.
 */
export function cheekStar(id: string): string {
  return `<defs><radialGradient id="${id}-g"><stop offset="0" stop-color="rgba(255,200,104,.55)"/><stop offset=".7" stop-color="rgba(255,206,120,.22)"/><stop offset="1" stop-color="rgba(255,206,120,0)"/></radialGradient>
      <clipPath id="${id}-c"><ellipse cx="-66" cy="-86" rx="15" ry="25"/></clipPath></defs>
    <ellipse cx="-66" cy="-86" rx="15" ry="25" fill="url(#${id}-g)"/>
    <g clip-path="url(#${id}-c)"><path d="${starPath(-66, -85, 12, 5.6)}" fill="#F6C25B" stroke="#E3A340" stroke-width="1.4" stroke-linejoin="round" opacity=".9"/>
    <circle cx="-68.5" cy="-87.5" r="1.4" fill="#FFF3D6" opacity=".9"/>
    <path d="M-82 -101 C-75 -110 -58 -110 -50 -101" fill="none" stroke="var(--mascot-base-top)" stroke-width="6" stroke-linecap="round" opacity=".5"/></g>`;
}

/** Two little sparkles beside the star cheek (puppet units, outside the cheek so they never move its pivot). */
export function cheekSparks(): string {
  return `<g transform="translate(-97 -112) rotate(12)">${sparkle(6, '#FFE7A8')}</g><g transform="translate(-92 -64)">${sparkle(4, '#FFFFFF')}</g>`;
}

/** Wave marks: two little arcs beside a waving paw at (x, y), on its outer side (puppet units). */
export function waveMarks(x: number, y: number, side: -1 | 1): string {
  return [15, 23].map((r, i) => {
    const a0 = side < 0 ? Math.PI * 1.05 : -Math.PI * 0.45;
    const a1 = a0 + Math.PI * 0.5;
    const p = (a: number) => `${f1(x + Math.cos(a) * r)} ${f1(y + Math.sin(a) * r)}`;
    return `<path d="M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}" fill="none" stroke="rgba(255,240,210,${(0.9 - i * 0.25).toFixed(2)})" stroke-width="3.6" stroke-linecap="round"/>`;
  }).join('');
}

/** A cluster of glitter on the trail (world px), centred on (x, y). */
export function glitter(x: number, y: number, i: number): string {
  const dots = [0, 1, 2].map((j) => {
    const dx = (rnd(i * 3 + j, 81) - 0.5) * 16;
    const dy = (rnd(i * 3 + j, 83) - 0.5) * 12;
    return `<circle cx="${f1(x + dx)}" cy="${f1(y + dy)}" r="${(1.2 + rnd(i * 3 + j, 85) * 1.4).toFixed(2)}" fill="${j ? '#FFE7A8' : '#FFFFFF'}" opacity="${(0.65 + rnd(i, 87) * 0.35).toFixed(2)}"/>`;
  }).join('');
  const big = i % 3 === 0 ? `<g transform="translate(${f1(x + (rnd(i, 89) - 0.5) * 22)} ${f1(y - 8 - rnd(i, 91) * 8)}) rotate(${Math.round(rnd(i, 93) * 40)})">${sparkle(5 + rnd(i, 95) * 3, i % 2 ? '#FFE7A8' : '#FFFFFF')}</g>` : '';
  return `${dots}${big}`;
}

/** Speed arcs behind a rolling ball: centred on (0, 0), the arcs on the -x side (rotate the group to the way back). */
export function speedArcs(r: number): string {
  return [0, 1, 2].map((i) => {
    const rr = r + 8 + i * 9;
    const span = 0.62 - i * 0.12;
    const at = (a: number) => `${f1(Math.cos(Math.PI + a) * rr)} ${f1(Math.sin(Math.PI + a) * rr)}`;
    return `<path d="M${at(-span)} A${rr} ${rr} 0 0 1 ${at(span)}" fill="none" stroke="rgba(255,240,210,${(0.75 - i * 0.2).toFixed(2)})" stroke-width="${(3.2 - i * 0.7).toFixed(1)}" stroke-linecap="round"/>`;
  }).join('');
}

/** The dizzy ring: a dashed ellipse with three little sparkles, centred on (0, 0). */
export function dizzyRing(): string {
  return `<ellipse rx="34" ry="9" fill="none" stroke="rgba(255,236,190,.55)" stroke-width="1.5" stroke-dasharray="3 4"/>
    ${[[-30, 2], [4, -8], [27, 4]].map(([dx = 0, dy = 0], i) => `<g transform="translate(${dx} ${dy}) rotate(${i * 20})">${sparkle(6 - i, '#FFE7A8')}</g>`).join('')}`;
}

/** A dark mound in the foreground (close-up): covers the bodies below its top line, then melts into the night. */
export function foreMound(w: number, y: number, y1: number, fade: number, id: string): string {
  const c = '#1E2117';
  return `<defs><linearGradient id="sp2-fm-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    <path d="M-10 ${y1} L-10 ${y + 22} C${f1(w * 0.2)} ${y - 4} ${f1(w * 0.45)} ${y + 6} ${f1(w * 0.62)} ${y + 2} C${f1(w * 0.8)} ${y - 2} ${f1(w * 0.92)} ${y + 12} ${w + 10} ${y + 18} L${w + 10} ${y1} Z" fill="${c}"/>
    <path d="M-10 ${y + 22} C${f1(w * 0.2)} ${y - 4} ${f1(w * 0.45)} ${y + 6} ${f1(w * 0.62)} ${y + 2} C${f1(w * 0.8)} ${y - 2} ${f1(w * 0.92)} ${y + 12} ${w + 10} ${y + 18}" fill="none" stroke="rgba(255,226,170,.14)" stroke-width="2"/>
    <rect x="-10" y="${y1 - 2}" width="${w + 20}" height="${fade + 2}" fill="url(#sp2-fm-${id})"/>
    ${tufts2(Array.from({ length: 9 }, (_, i) => [10 + i * 46 + rnd(i, 61) * 14, y + 14 + rnd(i, 63) * 10] as const), '#4A5A32', 2.2)}`;
}
