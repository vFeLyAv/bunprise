/**
 * Frozen manga effects of the strip (31.10, v3, GALLERY-ONLY; Felix 30.10: «больше анимаций, именно не персонажей, а как
 * бы анимации, но застывшие — шелест травы, звёздочки над головой, блески, свет»). Drawn marks, not puppet motion:
 * twinkles and glints, light rays and halos, grass rustle, speed lines, dust puffs, emotion marks, fireflies, seeds.
 *
 * Kept apart from the picture on purpose (they must survive the coming restyle of the places): every effect is its own
 * element with the class `sp2-fx` and `data-fx` = its scene, placed in world px over the strip. Most are still; the
 * twinkles of a scene shimmer once when it comes into view (≤ 1.6 s, transform / opacity), the ones tied to the roll
 * appear on the scroll-linked roll timeline. Reduced motion: all of them still, fully there.
 */

import { EZ, type Panel } from './kit';
import { heart, rnd, sparkle } from './props';

export type FxScene = 'burrow' | 'hill' | 'slope' | 'landing' | 'choice' | 'secret' | 'door';
export const FX_SCENES: readonly FxScene[] = ['burrow', 'hill', 'slope', 'landing', 'choice', 'secret', 'door'];

/** Where each scene lies in the strip (world y): its effects shimmer once when this comes into view. */
export const FX_REGIONS: Readonly<Record<FxScene, { y0: number; y1: number }>> = {
  burrow: { y0: 40, y1: 560 },
  hill: { y0: 660, y1: 1220 },
  slope: { y0: 1220, y1: 1880 },
  landing: { y0: 1880, y1: 2110 },
  choice: { y0: 2200, y1: 2640 },
  secret: { y0: 2740, y1: 3200 },
  door: { y0: 3330, y1: 3720 },
};

const f1 = (v: number): string => v.toFixed(1);
const CREAM = '#FFF4DC';
const INK = '#2A231C';

// ---- the marks (centred on 0, 0) -----------------------------------------------------------------------------------

/** A manga twinkle: a slim four-point star with a smaller diagonal one and a bright core, in a soft glow. */
export function twinkle(r: number, id: string, color = CREAM): string {
  const k = r * 0.1;
  const big = `M0 ${-r} Q${k} ${-k} ${r} 0 Q${k} ${k} 0 ${r} Q${-k} ${k} ${-r} 0 Q${-k} ${-k} 0 ${-r} Z`;
  const s = r * 0.42;
  const q = s * 0.12;
  const small = `M${-s} ${-s} Q${-q} 0 ${s} ${s} Q0 ${q} ${-s} ${-s} Z M${s} ${-s} Q${q} 0 ${-s} ${s} Q0 ${q} ${s} ${-s} Z`;
  return `<defs><radialGradient id="sp2fx-tw-${id}"><stop offset="0" stop-color="rgba(255,236,180,.5)"/><stop offset="1" stop-color="rgba(255,236,180,0)"/></radialGradient></defs>
    <circle r="${f1(r * 0.75)}" fill="url(#sp2fx-tw-${id})"/>
    <path d="${big}" fill="${color}"/><path d="${small}" fill="${color}" opacity=".75"/><circle r="${f1(Math.max(1, r * 0.12))}" fill="#FFFFFF"/>`;
}

/** Soft light rays fanning out from (0, 0) between angles a0 … a1 (degrees, 0 = right, 90 = down). */
export function rays(id: string, n: number, r0: number, r1: number, a0: number, a1: number, alpha = 0.22, rgb = '255,214,140'): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((a0 + ((a1 - a0) * (i + 0.5)) / n) * Math.PI) / 180;
    const w = (((a1 - a0) / n) * 0.32 * Math.PI) / 180 * (0.7 + rnd(i, 7) * 0.6);
    const len = r1 * (0.72 + rnd(i, 9) * 0.28);
    const p = (ang: number, r: number) => `${f1(Math.cos(ang) * r)} ${f1(Math.sin(ang) * r)}`;
    out.push(`<path d="M${p(a - w, r0)} L${p(a, len)} L${p(a + w, r0)} Z" fill="url(#sp2fx-ray-${id})"/>`);
  }
  return `<defs><radialGradient id="sp2fx-ray-${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${r1}"><stop offset="${(r0 / r1).toFixed(2)}" stop-color="rgba(${rgb},${alpha})"/><stop offset="1" stop-color="rgba(${rgb},0)"/></radialGradient></defs>${out.join('')}`;
}

/** A soft round halo. */
export function glow(id: string, r: number, alpha = 0.3, rgb = '255,214,140'): string {
  return `<defs><radialGradient id="sp2fx-gl-${id}"><stop offset="0" stop-color="rgba(${rgb},${alpha})"/><stop offset="1" stop-color="rgba(${rgb},0)"/></radialGradient></defs><circle r="${r}" fill="url(#sp2fx-gl-${id})"/>`;
}

/** A sweat drop (manga «oops»), tip up, leaning by `turn` degrees. */
export function sweat(r: number, turn = -20): string {
  const d = `M0 ${f1(-r * 1.7)} C${f1(r * 0.85)} ${f1(-r * 0.45)} ${f1(r)} ${f1(r * 0.3)} 0 ${f1(r)} C${f1(-r)} ${f1(r * 0.3)} ${f1(-r * 0.85)} ${f1(-r * 0.45)} 0 ${f1(-r * 1.7)} Z`;
  return `<g transform="rotate(${turn})"><path d="${d}" fill="#BFE3FF" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
    <ellipse cx="${f1(-r * 0.32)}" cy="${f1(r * 0.05)}" rx="${f1(r * 0.2)}" ry="${f1(r * 0.38)}" fill="#FFFFFF" opacity=".9"/></g>`;
}

/** Grass rustle: three short strokes flicking up (mirrored with side = -1). */
export function rustle(k = 1, side: 1 | -1 = 1): string {
  const s = (v: number) => f1(v * k * side);
  const y = (v: number) => f1(v * k);
  return `<g fill="none" stroke="rgba(255,240,205,.72)" stroke-width="${f1(1.7 * Math.sqrt(k))}" stroke-linecap="round">
    <path d="M${s(0)} ${y(0)} Q${s(2)} ${y(-6)} ${s(7)} ${y(-10)}"/><path d="M${s(5)} ${y(3)} Q${s(9)} ${y(-2)} ${s(15)} ${y(-4)}"/><path d="M${s(-4)} ${y(-2)} Q${s(-4)} ${y(-8)} ${s(-1)} ${y(-14)}"/></g>`;
}

/** A dust puff, drawn the manga way: a light outlined cloud (bumps along its top), barely filled, three specks. */
export function dust(k = 1, id = 'd'): string {
  const p = (v: number) => f1(v * k);
  const cloud = `M${p(-22)} ${p(5)} A${p(7)} ${p(7)} 0 0 1 ${p(-14)} ${p(-5)} A${p(9)} ${p(9)} 0 0 1 ${p(-1)} ${p(-12)} A${p(9)} ${p(9)} 0 0 1 ${p(13)} ${p(-6)} A${p(7)} ${p(7)} 0 0 1 ${p(21)} ${p(5)} Z`;
  const specks = [[-26, -9, 1.6], [24, -12, 1.3], [28, -2, 1.1]].map(([x = 0, y = 0, r = 1]) => `<circle cx="${p(x)}" cy="${p(y)}" r="${p(r)}" fill="rgba(255,244,222,.8)"/>`).join('');
  return `<g data-puff="${id}"><path d="${cloud}" fill="rgba(255,244,222,.2)" stroke="rgba(255,244,222,.82)" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M${p(-12)} ${p(1)} A${p(5)} ${p(5)} 0 0 1 ${p(-3)} ${p(-4)}" fill="none" stroke="rgba(255,244,222,.55)" stroke-width="1.2" stroke-linecap="round"/>${specks}</g>`;
}

/** Surprise lines: short strokes radiating around a head, between angles a0 … a1 (degrees). */
export function surprise(r0: number, r1: number, a0: number, a1: number, n = 7): string {
  return Array.from({ length: n }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
    const len = (r1 - r0) * (0.75 + rnd(i, 13) * 0.25);
    return `<path d="M${f1(Math.cos(a) * r0)} ${f1(Math.sin(a) * r0)} L${f1(Math.cos(a) * (r0 + len))} ${f1(Math.sin(a) * (r0 + len))}" stroke="${CREAM}" stroke-width="2.6" stroke-linecap="round"/>`;
  }).join('');
}

/** A firefly: a tiny warm-green core in a soft glow. */
export function firefly(id: string, r = 2): string {
  return `${glow(`ff-${id}`, r * 4.2, 0.45, '226,255,150')}<circle r="${r}" fill="#F4FFC2"/>`;
}

/** A drifting dandelion seed (stem + its little umbrella), turned by `turn`. */
export function seed(turn: number, k = 1): string {
  const fan = [-60, -30, 0, 30, 60].map((a) => {
    const r = ((a - 90) * Math.PI) / 180;
    return `M0 ${f1(-7 * k)} L${f1(Math.cos(r) * 5 * k)} ${f1(-7 * k + Math.sin(r) * 5 * k)}`;
  }).join(' ');
  return `<g transform="rotate(${turn})" stroke="rgba(245,237,227,.8)" stroke-width=".8" stroke-linecap="round" fill="none"><path d="M0 0 L0 ${f1(-7 * k)} ${fan}"/><circle cy="0.5" r="${f1(1.1 * k)}" fill="rgba(245,237,227,.85)" stroke="none"/></g>`;
}

/** A dandelion clock with some seeds already gone (stem from (0, 0) up `h`). */
export function dandelionHalf(h: number): string {
  const head = -h;
  const seeds = Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI * 0.15 + (i / 10) * Math.PI * 1.3;
    const x = Math.cos(a) * 10;
    const y = head - Math.sin(a) * 10;
    return `<line x1="0" y1="${head}" x2="${f1(x)}" y2="${f1(y)}" stroke="rgba(245,237,227,.55)" stroke-width=".8"/><circle cx="${f1(x)}" cy="${f1(y)}" r="1.5" fill="rgba(245,237,227,.8)"/>`;
  }).join('');
  return `<path d="M0 0 Q3 ${f1(head * 0.5)} 0 ${head}" fill="none" stroke="#6F8A4A" stroke-width="2" stroke-linecap="round"/>
    <path d="M0 -8 Q-9 -14 -12 -22 Q-4 -18 0 -12 Z" fill="#5F7A3E"/>${seeds}<circle cx="0" cy="${head}" r="2.4" fill="#D9CBB0"/>`;
}

/** Hush marks: two little wavy strokes («тсс»), drawn rightwards. */
export function hush(): string {
  return `<g fill="none" stroke="${CREAM}" stroke-width="2" stroke-linecap="round"><path d="M0 -6 q4 -4 8 0 t8 0"/><path d="M3 4 q4 -4 8 0 t8 0" opacity=".8"/></g>`;
}

/** Speed lines: three parallel strokes behind something moving along +x (rotate the group to the way). */
export function speedLines(len: number, gap: number): string {
  return [-1, 0, 1].map((j, i) => {
    const l = len * (i === 1 ? 1 : 0.7);
    return `<path d="M${f1(-l)} ${f1(j * gap)} L0 ${f1(j * gap)}" stroke="rgba(255,244,220,${i === 1 ? 0.75 : 0.5})" stroke-width="${i === 1 ? 2.2 : 1.6}" stroke-linecap="round"/>`;
  }).join('');
}

/** Bokeh: soft warm circles floating in a glow, inside a box w × h centred on (0, 0). */
export function bokeh(w: number, h: number, n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const x = (rnd(i, 101) - 0.5) * w;
    const y = (rnd(i, 103) - 0.5) * h;
    const r = 3 + rnd(i, 105) * 7;
    return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="rgba(255,200,120,${(0.14 + rnd(i, 107) * 0.16).toFixed(2)})"/>`;
  }).join('');
}

// ---- placing them -------------------------------------------------------------------------------------------------

/** One effect as its own element, centred on (x, y): w × h px, `view` its viewBox. */
export function fx(s: Panel, scene: FxScene, markup: string, x: number, y: number, size: number, z = 9, view = size): HTMLElement {
  const e = s.prop(markup, `${-view / 2} ${-view / 2} ${view} ${view}`, x, y, size, size, z);
  e.classList.add('sp2-fx');
  e.dataset['fx'] = scene;
  return e;
}

/** Several still effects of a scene in one SVG over a band of the strip (world px). */
export function fxBand(s: Panel, scene: FxScene, markup: string, y0: number, y1: number, z: number): HTMLElement {
  const e = s.band(markup, y0, y1, z);
  e.classList.add('sp2-fx');
  e.dataset['fx'] = scene;
  return e;
}

const at = (x: number, y: number, inner: string, extra = ''): string => `<g transform="translate(${f1(x)} ${f1(y)})${extra}">${inner}</g>`;

/** A shimmer: the twinkles brighten and pop once, one after the other (the scene came into view). */
function shimmer(s: Panel, els: readonly HTMLElement[], name: string): void {
  els.forEach((el, i) => {
    const d = 0.1 + i * 0.16;
    s.track(el, { o: 0.35, s: 0.6 }, `${name}.${i}`).move(d, d + 0.32, { o: 1, s: 1.22 }, EZ.out).move(d + 0.32, d + 0.7, { s: 1 }, EZ.bouncy);
  });
}

export interface FxPlaces {
  door1: { x: number; y: number };
  door7: { x: number; y: number };
}

/**
 * The still effects of each scene + their one-time shimmer (tracks are made in the panel's current scope: the caller
 * sets it to the scene's own timeline). Returns nothing: the elements carry `data-fx`.
 */
export function sceneFx(s: Panel, scene: FxScene, p: FxPlaces): void {
  const twinkles: HTMLElement[] = [];
  const tw = (x: number, y: number, r: number, z = 9) => twinkles.push(fx(s, scene, twinkle(r, `${scene}${twinkles.length}`), x, y, r * 2.4, z));
  switch (scene) {
    case 'burrow': {
      // the moon's soft light, the light pouring out of door 14, the invitation's glint, fireflies over the moss, a sweat drop
      fxBand(s, scene, `${at(334, 66, glow('moon', 70, 0.2, '246,231,200'))}
        ${at(p.door1.x, p.door1.y, `${glow('d1', 52, 0.28)}${rays('d1', 9, 22, 70, 100, 260, 0.22)}`)}
        ${[[296, 498, 0], [352, 470, 1], [246, 540, 2]].map(([x = 0, y = 0, i = 0]) => at(x, y, firefly(`b${i}`))).join('')}`, 0, 640, 1);
      tw(150, 466, 9);
      tw(p.door1.x + 22, p.door1.y - 22, 7, 3);
      tw(366, 34, 6, 2);
      fx(s, scene, sweat(6, -30), 72, 402, 24);
      break;
    }
    case 'hill': {
      // twinkle crosses on the bigger wish stars, the shine on Mila's blossom, grass rustling at their feet
      tw(74, 830, 11, 3);
      tw(330, 874, 12, 3);
      tw(196, 950, 11, 3);
      tw(104, 1082, 6.5);
      fxBand(s, scene, `${at(50, 1190, rustle(1, -1))}${at(150, 1194, rustle(1))}${at(222, 1190, rustle(0.9, -1))}`, 1150, 1210, 6);
      break;
    }
    case 'slope': {
      // fireflies over the hill, a dandelion he brushed past, its seeds drifting away
      fxBand(s, scene, `${[[58, 1384, 0], [206, 1700, 1], [352, 1560, 2], [300, 1250, 3]].map(([x = 0, y = 0, i = 0]) => at(x, y, firefly(`s${i}`))).join('')}
        ${at(36, 1666, dandelionHalf(38))}
        ${[[52, 1612, -20, 1], [74, 1590, 12, 0.9], [96, 1560, -8, 1.1], [120, 1540, 18, 0.8]].map(([x = 0, y = 0, r = 0, k = 1]) => at(x, y, seed(r, k))).join('')}`, 1200, 1880, 2);
      tw(300, 1252, 5, 2);
      break;
    }
    case 'landing':
      tw(330, 1906, 6, 2);
      break;
    case 'choice': {
      // the star and the invitation glint, warm bokeh in the light, a little heart: he has decided
      fxBand(s, scene, at(200, 2470, bokeh(300, 220, 9)), 2196, 2660, 2);
      tw(170, 2496, 13);
      tw(150, 2556, 7);
      tw(262, 2566, 9);
      twinkles.push(fx(s, scene, heart(7), 52, 2448, 20));
      break;
    }
    case 'secret': {
      // the shine on Mila's blossom, her feet rustling the grass as she waves, the «тсс» marks, fireflies
      tw(290, 2794, 6);
      fxBand(s, scene, `${at(262, 2890, rustle(0.8, -1))}${at(334, 2888, rustle(0.8))}
        ${at(346, 3058, hush())}
        ${[[40, 2900, 0], [150, 3040, 1], [360, 3010, 2]].map(([x = 0, y = 0, i = 0]) => at(x, y, firefly(`c${i}`))).join('')}`, 2840, 3110, 9);
      break;
    }
    case 'door': {
      // door 14 shines, the "+1" glints, two more little hearts, fireflies and twinkling stars over the mound
      fxBand(s, scene, `${at(p.door7.x, p.door7.y, `${glow('d7', 70, 0.3)}${rays('d7', 13, 24, 96, 0, 360, 0.2)}`)}
        ${[[60, 3530, 0], [372, 3540, 1], [226, 3330, 2]].map(([x = 0, y = 0, i = 0]) => at(x, y, firefly(`e${i}`))).join('')}`, 3300, 3620, 1);
      tw(210, 3574, 8);
      tw(56, 3300, 8, 2);
      tw(250, 3290, 6, 2);
      twinkles.push(fx(s, scene, heart(5), 180, 3550, 14, 8), fx(s, scene, heart(4), 220, 3554, 12, 8));
      break;
    }
  }
  shimmer(s, twinkles, `fx-${scene}`);
}

/** At the hand-over: the star glints between their paws (gone once Tapsi has taken it). */
export function handoverFx(s: Panel, star: { x: number; y: number }, taken: number): void {
  const marks = [fx(s, 'hill', twinkle(8, 'ho0'), star.x - 30, star.y - 30, 20), fx(s, 'hill', twinkle(6, 'ho1'), star.x + 32, star.y - 24, 15), fx(s, 'hill', sparkle(4, '#FFFFFF'), star.x + 4, star.y - 40, 10)];
  marks.forEach((m, i) => s.track(m, { o: 1 }, `fx.handover${i}`).move(taken, taken + 0.02, { o: 0 }, EZ.out));
}

/** Along the roll (on its scroll-linked timeline): a sweat drop at "Hicks!", speed lines and rustling grass where he passes, dust puffs and surprise lines at the landing, the fallen card's glint. */
export function rollFx(s: Panel, o: {
  hic: number;
  /** [time, x, y (ball centre), direction in degrees] where speed lines go */
  passes: ReadonlyArray<readonly [number, number, number, number]>;
  /** [time, x, y, side] where the grass rustles (on the path) */
  rustles: ReadonlyArray<readonly [number, number, number, 1 | -1]>;
  land: number;
  feet: { x: number; y: number };
  pomponHead: { x: number; y: number };
  card: { x: number; y: number };
}): void {
  const drop = fx(s, 'slope', sweat(6, 26), 320, 1070, 24);
  s.track(drop, { o: 0, y: 6 }, 'fx.sweat').move(o.hic + 0.01, o.hic + 0.03, { o: 1, y: 0 }, EZ.out);
  o.passes.forEach(([t, x, y, dir], i) => {
    const e = fx(s, 'slope', `<g transform="rotate(${f1(dir)})">${speedLines(34, 13)}</g>`, x, y, 90, 4);
    s.track(e, { o: 0 }, `fx.speed${i}`).move(t + 0.01, t + 0.02, { o: 1 }, EZ.out);
  });
  o.rustles.forEach(([t, x, y, side], i) => {
    const e = fx(s, 'slope', rustle(1.1, side), x, y, 40, 4);
    s.track(e, { o: 0 }, `fx.rustle${i}`).move(t, t + 0.01, { o: 1 }, EZ.out);
  });
  const l = o.land;
  const puffs = [fx(s, 'landing', dust(1, 'l'), o.feet.x - 56, o.feet.y - 8, 64, 6), fx(s, 'landing', `<g transform="scale(-1 1)">${dust(0.9, 'r')}</g>`, o.feet.x + 58, o.feet.y - 6, 60, 6)];
  puffs.forEach((e, i) => s.track(e, { o: 0, s: 0.5 }, `fx.dust${i}`).move(l, l + 0.03, { o: 1, s: 1 }, EZ.out));
  const lines = fx(s, 'landing', surprise(52, 72, -165, -15, 7), o.pomponHead.x, o.pomponHead.y, 160, 8);
  s.track(lines, { o: 0, s: 0.8 }, 'fx.surprise').move(l - 0.02, l + 0.01, { o: 1, s: 1 }, EZ.out);
  const glint = fx(s, 'landing', twinkle(8, 'card4'), o.card.x, o.card.y, 20);
  s.track(glint, { o: 0, s: 0.4 }, 'fx.cardglint').move(l + 0.03, l + 0.06, { o: 1, s: 1 }, EZ.out);
}
