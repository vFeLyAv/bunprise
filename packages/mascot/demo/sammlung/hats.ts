/**
 * «Pompons Sammlung» — the two winter hats, redrawn (28.10, GALLERY-ONLY; Felix: «Nikolausmütze» and «Wintermütze»
 * "look not good"). Two variants each, for Felix to pick:
 *
 *   Nikolaus A «Klassik»       a soft red cap pulled down onto his head, a fluffy white brim that follows the head's
 *                              curve OVER the ear roots (the lop ears come out from under it), the tip flops to his
 *                              left (viewer's right) with the pompom hanging beside his ear.
 *   Nikolaus B «Zipfelchen»    a smaller cap tilted between the ears, drawn BEHIND the ears (the ear roots overlap its
 *                              brim), the tip curls back the other way.
 *   Winter A «Ohrenklappen»    a knitted beanie with ear flaps that lie ON the lop ears and swing with them (the flaps
 *                              sit inside the ear groups, within each ear's own box, so the ear's pivot is unchanged),
 *                              a little knit tassel under each flap, a pompom on top.
 *   Winter B «Bommelmütze»     a slouchy bobble hat nestled BETWEEN the ears (drawn behind them), a big soft bobble.
 *
 * Style rules (as the scarf Felix likes): soft rounded shapes, two flat colours (--mascot-wear-1/2) plus shades of
 * them, the silhouette's own contour (--mascot-outline), nothing thinner than 7 units, never down to the eyes.
 * Units: the puppet's own (x = 0 centre, y = 0 feet; head top y = -163; head outline ≈ (±27, -159), (±47, -148),
 * (±61, -132); lop ear roots (±24, -160) – (±29, -151), the ear's top arc peaks ≈ y -165 at x ±40).
 */

// 31.10: the new hats and the HatSpec shape live in the package (src/wardrobe/hats.ts — the app wears Felix's picks);
// the rejected 28.10 hats below stay gallery-only (&hats=old).
import { NEW_HATS, type HatId, type HatSpec as AnyHatSpec, type NewHatVariant } from '../../src/wardrobe/hats';

export type { HatId, NewHatVariant };

/** 'a' | 'b': the 28.10 hats (rejected by Felix 31.10, kept for comparison: &hats=old); '1' | '2' | '3': the new ones (src/wardrobe/hats.ts). */
export type OldHatVariant = 'a' | 'b';
export type HatVariant = OldHatVariant | NewHatVariant;

export type HatSpec = AnyHatSpec<HatVariant>;

const f2 = (v: number) => String(Math.round(v * 100) / 100);
const W1 = (fb: string) => `var(--mascot-wear-1, ${fb})`;
const W2 = (fb: string) => `var(--mascot-wear-2, ${fb})`;
const shade = (fill: string, k = 78) => `color-mix(in srgb, ${fill} ${k}%, #3A1F0A)`;
const light = (fill: string, k = 70) => `color-mix(in srgb, ${fill} ${k}%, #FFFFFF)`;
const o = 'class="wr-o"';
const at = (x: number, y: number) => `style="transform-origin: ${f2(x)}px ${f2(y)}px"`;

/** A circle as a path (cubic arcs, no SVG `A`: every number pair is a point). */
export function circle(cx: number, cy: number, r: number, ry = r): string {
  const k = 0.5523;
  return `M${f2(cx - r)} ${f2(cy)} C${f2(cx - r)} ${f2(cy - ry * k)} ${f2(cx - r * k)} ${f2(cy - ry)} ${f2(cx)} ${f2(cy - ry)}`
    + ` C${f2(cx + r * k)} ${f2(cy - ry)} ${f2(cx + r)} ${f2(cy - ry * k)} ${f2(cx + r)} ${f2(cy)}`
    + ` C${f2(cx + r)} ${f2(cy + ry * k)} ${f2(cx + r * k)} ${f2(cy + ry)} ${f2(cx)} ${f2(cy + ry)}`
    + ` C${f2(cx - r * k)} ${f2(cy + ry)} ${f2(cx - r)} ${f2(cy + ry * k)} ${f2(cx - r)} ${f2(cy)} Z`;
}

/** Points along a quadratic curve. */
function along(p0: readonly [number, number], c: readonly [number, number], p1: readonly [number, number], n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
  return out;
}

/**
 * A fluffy fur brim: overlapping round puffs along a curve, ONE path (with the contour painted first — `paint-order:
 * stroke fill` — the inner contours vanish under the fill, only the scalloped outline remains).
 */
export function fluff(p0: readonly [number, number], c: readonly [number, number], p1: readonly [number, number], r: number, n: number): string {
  return along(p0, c, p1, n).map(([x, y], i) => circle(x, y, r * (i % 2 ? 0.92 : 1.04))).join(' ');
}

// ---- Nikolaus A «Klassik» ---------------------------------------------------------------------------------------
const NA_BRIM: Parameters<typeof fluff> = [[-50, -146], [0, -180], [50, -146], 9.6, 14];
/** the cap: a soft dome-cone pulled down to the brim, leaning to his left */
/** the cap in ONE soft silhouette: up from the brim, a round top, the end flops over to his left and hangs down */
export const NA_CAP = 'M-46 -150 C-49 -178 -31 -200 -1 -206 C22 -210 44 -201 57 -186 C67 -175 75 -160 76.4 -142 L65.6 -140.6 C64.4 -157 56 -174 43 -182 C46.4 -172 47.2 -161 46 -150 Z';
/** the pompom at the hanging end (dangles after his hops: .wr-wob) */
export const NA_POM = { cx: 71.4, cy: -135, r: 11.5 } as const;
/** the shadow under the flop and down the cap's side */
const NA_FOLD = 'M43 -182 C53 -175 62.4 -160 65 -141 L69.4 -141.4 C67.6 -160 58.6 -176 47.4 -185 Z M43 -182 C46.4 -172 47.2 -161 46 -150 L40 -151 C41 -162 41 -173 38 -181 Z';

// ---- Nikolaus B «Zipfelchen» (behind the ears, tilted) --------------------------------------------------------------
const NB_TILT = 'rotate(9 0 -160)';
const NB_BRIM: Parameters<typeof fluff> = [[-36, -152], [0, -176], [36, -152], 8.5, 9];
export const NB_CAP = 'M-31 -158 C-33 -186 -16 -210 6 -215 C16 -217 24 -211 25 -201 C27 -186 31 -170 31 -158 Z';
export const NB_SOCK = 'M10 -214 C-2 -226 -22 -226 -33 -213 C-36 -209 -37 -204 -36.5 -200 L-27.4 -199.6 C-26 -207 -16 -213 -2 -206 Z';
export const NB_POM = { cx: -33, cy: -196, r: 9 } as const;

// ---- Winter A «Ohrenklappen» --------------------------------------------------------------------------------------
/** ribbed band over the forehead and the ear roots */
export const WA_BAND = 'M-52 -140 Q0 -160 52 -140 L50 -153 Q0 -177 -50 -153 Z';
export const WA_DOME = 'M-49 -152 C-51 -182 -28 -200 0 -200 C28 -200 51 -182 49 -152 Q0 -176 -49 -152 Z';
export const WA_POM = { cx: 0, cy: -203, r: 11 } as const;
/** the flap on his right ear (viewer's left); the other is its mirror. Inside the ear's own box (x -78 … -24, y -166 … -82). */
/** a knitted flap that tapers to a point (an «Inka» flap, so it never reads as headphones), a tassel on a string */
export const WA_FLAP = 'M-27 -153 C-42 -160 -62 -151 -70 -129 C-72 -122 -71 -115 -67 -108 C-65 -104 -62 -101 -60.5 -100.5 C-58.4 -104 -56.4 -110 -55.4 -116 C-54.4 -128 -50 -140 -40 -147 Z';
const WA_FLAP_RIB = 'M-70.6 -119 C-69.4 -112 -65.6 -105 -60.6 -100.8 C-58.6 -104.6 -56.8 -110 -55.8 -116.4 C-60.6 -114.4 -66.2 -115.6 -70.6 -119 Z';
export const WA_TASSEL = { cx: -60.6, cy: -89, r: 5.2 } as const;
const WA_STRING = 'M-61.6 -101.6 L-59.6 -101.6 L-59.8 -93.4 L-61.4 -93.4 Z';

// ---- Winter B «Bommelmütze» (behind the ears) -------------------------------------------------------------------
export const WB_BAND = 'M-45 -148 Q0 -168 45 -148 L43 -162 Q0 -186 -43 -162 Z';
export const WB_DOME = 'M-43 -161 C-47 -195 -20 -214 6 -214 C31 -214 47 -195 43 -161 Q0 -185 -43 -161 Z';
export const WB_POM = { cx: 10, cy: -219, r: 15 } as const;

const ribs = (x0: number, x1: number, step: number, y: (x: number) => readonly [number, number]) => {
  let d = '';
  for (let x = x0; x <= x1; x += step * 2) {
    const [a, b] = y(x);
    const [c, e] = y(x + step);
    d += `M${f2(x)} ${f2(a)} L${f2(x + step)} ${f2(c)} L${f2(x + step)} ${f2(e)} L${f2(x)} ${f2(b)} Z `;
  }
  return d.trim();
};
/** quadratic y of a band edge through (±w, yEnd) and (0, yMid) */
const qy = (w: number, yEnd: number, yMid: number) => (x: number) => yEnd + (yMid - yEnd) * (1 - (x / w) ** 2);

export const HATS: Record<HatId, Record<OldHatVariant, HatSpec>> = {
  nikolaus: {
    a: {
      id: 'nikolaus', variant: 'a', de: 'Klassik', ru: 'Классика', layer: 'over', land: { x: 0, y: -150 },
      colors: { light: ['#D64545', '#FFF9F1'], dark: ['#E05858', '#FFF9F1'], navy: ['#E05858', '#FFF9F1'] },
      markup: () => `
        <path ${o} d="${NA_CAP}" fill="${W1('#D64545')}"/>
        <path d="${NA_FOLD}" fill="${shade(W1('#D64545'), 80)}" opacity=".5"/>
        <path d="M-34 -184 C-26 -195 -14 -200 -2 -202 C-14 -198 -24 -191 -30 -180 Z" fill="#FFFFFF" opacity=".16"/>
        <g class="wr-wob" data-wob="14" ${at(70, -146)}>
          <path ${o} d="${circle(NA_POM.cx, NA_POM.cy, NA_POM.r)}" fill="${W2('#FFF9F1')}"/>
          <path d="${circle(NA_POM.cx + 3, NA_POM.cy + 3.4, 7, 6)}" fill="${shade(W2('#FFF9F1'), 90)}" opacity=".45"/>
        </g>
        <path ${o} d="${fluff(...NA_BRIM)}" fill="${W2('#FFF9F1')}"/>
        <path d="${fluff([-46, -142], [0, -173], [46, -142], 6.5, 9)}" fill="${shade(W2('#FFF9F1'), 92)}" opacity=".35"/>`,
    },
    b: {
      id: 'nikolaus', variant: 'b', de: 'Zipfelchen', ru: 'Колпачок набок', layer: 'under', land: { x: 0, y: -156 },
      colors: { light: ['#D64545', '#FFF9F1'], dark: ['#E05858', '#FFF9F1'], navy: ['#E05858', '#FFF9F1'] },
      markup: () => `<g transform="${NB_TILT}">
        <g class="wr-wob" data-wob="14" ${at(6, -212)}>
          <path ${o} d="${NB_SOCK}" fill="${shade(W1('#D64545'), 92)}"/>
          <path ${o} d="${circle(NB_POM.cx, NB_POM.cy, NB_POM.r)}" fill="${W2('#FFF9F1')}"/>
        </g>
        <path ${o} d="${NB_CAP}" fill="${W1('#D64545')}"/>
        <path d="M14 -208 C21 -196 24 -178 24 -160 L31 -158 C31 -176 28 -194 22 -207 Z" fill="${shade(W1('#D64545'), 82)}" opacity=".5"/>
        <path ${o} d="${fluff(...NB_BRIM)}" fill="${W2('#FFF9F1')}"/>
      </g>`,
    },
  },
  winterhat: {
    a: {
      id: 'winterhat', variant: 'a', de: 'Ohrenklappen', ru: 'С ушками', layer: 'over', land: { x: 0, y: -150 },
      colors: { light: ['#3F8A9C', '#FFF4E4'], dark: ['#5AA3B4', '#FFF4E4'], navy: ['#62AABB', '#FFF4E4'] },
      markup: () => `
        <g class="wr-wob" data-wob="9" ${at(0, -204)}>
          <path ${o} d="${circle(WA_POM.cx, WA_POM.cy, WA_POM.r)}" fill="color-mix(in srgb, ${W2('#FFF4E4')} 72%, ${W1('#3F8A9C')})"/>
          <path d="${circle(WA_POM.cx + 2.6, WA_POM.cy + 3, 6.6, 5.6)}" fill="${shade(W2('#FFF4E4'), 90)}" opacity=".45"/>
        </g>
        <path ${o} d="${WA_DOME}" fill="${W1('#3F8A9C')}"/>
        <path d="${ribs(-38, 38, 6, (x) => [qy(50, -158, -175)(x) - 1, -194 + Math.abs(x) * 0.42])}" fill="${shade(W1('#3F8A9C'), 86)}" opacity=".14"/>
        <path d="M-36 -184 C-28 -193 -16 -197 -4 -197 C-16 -193 -26 -187 -32 -178 Z" fill="#FFFFFF" opacity=".18"/>
        <path ${o} d="${WA_BAND}" fill="${shade(W1('#3F8A9C'), 90)}"/>
        <path d="${ribs(-47, 47, 6, (x) => [qy(51, -153, -176)(x) + 1.5, qy(52, -140, -159.5)(x) - 1.5])}" fill="${shade(W1('#3F8A9C'), 70)}" opacity=".38"/>`,
      flap: (side) => {
        const m = (d: string) => (side < 0 ? d : d.replace(/(-?\d*\.?\d+)(\s+-?\d*\.?\d+)/g, (_s, x: string, y: string) => `${f2(-Number(x))}${y}`));
        return `<path ${o} d="${m(WA_FLAP)}" fill="${W1('#3F8A9C')}"/>
          <path d="${m(WA_FLAP_RIB)}" fill="${shade(W1('#3F8A9C'), 72)}" opacity=".6"/>
          <path d="${m(WA_STRING)}" fill="${shade(W2('#FFF4E4'), 80)}"/>
          <path ${o} d="${circle(side < 0 ? WA_TASSEL.cx : -WA_TASSEL.cx, WA_TASSEL.cy, WA_TASSEL.r)}" fill="color-mix(in srgb, ${W2('#FFF4E4')} 72%, ${W1('#3F8A9C')})"/>`;
      },
    },
    b: {
      id: 'winterhat', variant: 'b', de: 'Bommelmütze', ru: 'С большим помпоном', layer: 'under', land: { x: 0, y: -155 },
      colors: { light: ['#5C7FC0', '#FFF4E4'], dark: ['#7894CF', '#FFF4E4'], navy: ['#7E9AD4', '#FFF4E4'] },
      markup: () => `
        <g class="wr-wob" data-wob="10" ${at(8, -206)}>
          <path ${o} d="${circle(WB_POM.cx, WB_POM.cy, WB_POM.r)}" fill="color-mix(in srgb, ${W2('#FFF4E4')} 70%, ${W1('#5C7FC0')})"/>
          <path d="${circle(WB_POM.cx + 3.6, WB_POM.cy + 4, 9, 8)}" fill="${shade(W2('#FFF4E4'), 90)}" opacity=".45"/>
          <path d="${circle(WB_POM.cx - 4.4, WB_POM.cy - 4.6, 4.4, 3.6)}" fill="#FFFFFF" opacity=".7"/>
        </g>
        <path ${o} d="${WB_DOME}" fill="${W1('#5C7FC0')}"/>
        <path d="${ribs(-34, 34, 6, (x) => [qy(43, -165, -183)(x) - 1, -205 + Math.abs(x) * 0.55])}" fill="${shade(W1('#5C7FC0'), 86)}" opacity=".14"/>
        <path d="M-30 -196 C-22 -205 -10 -209 2 -209 C-10 -205 -20 -199 -26 -190 Z" fill="${light(W1('#5C7FC0'))}" opacity=".35"/>
        <path ${o} d="${WB_BAND}" fill="${shade(W1('#5C7FC0'), 90)}"/>
        <path d="${ribs(-40, 40, 6, (x) => [qy(43, -162, -174)(x) + 1.5, qy(45, -148, -158)(x) - 1.5])}" fill="${shade(W1('#5C7FC0'), 70)}" opacity=".38"/>`,
    },
  },
};

export const HAT_VARIANTS: readonly OldHatVariant[] = ['a', 'b'];

/** Any hat, old (a / b) or new (1 / 2 / 3). */
export function hatSpec(id: HatId, v: HatVariant): HatSpec {
  return v === 'a' || v === 'b' ? HATS[id][v] : NEW_HATS[id][v];
}
