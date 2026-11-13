/**
 * The Sammlung hats (31.10; drawn in the gallery — demo/costumes/hats.ts re-exports this file). Felix rejected all four Sammlung hats of 28.10: «шапки мне все не нравятся, они все
 * кривые и странно выглядят на кролике». What went wrong there: the «A» hats sat low like helmets (forehead covered,
 * winter A nearly down to the eyes), the «B» hats were small thimbles perched on top, none hugged the round head.
 *
 * These six are drawn by the rules that made the costumes sit well (knight helmet, kasa, bandana, lily):
 *  - the hat sits ON the crown (its lower edge ≈ 13–20 units into the head), with real volume above it;
 *  - the brim / cuff arches with the round head (∩) and is a little WIDER than the head where it wraps it, so it reads
 *    as fabric around the head, not a sticker on it; its lower edge stays ≥ 40 units above the eyes (forehead free);
 *  - lop ears hang from UNDER the brim (over-the-ears hats) or lie OVER the cuff (the snug ones between the ears) —
 *    never through the hat;
 *  - one consistent tilt per hat, soft fabric shading (a shade on one side, a light on the other, knit ribs / fur);
 *  - only the tip / bobble / slouch swings (`.wr-wob`), once, after HIS hop; nothing moves by itself.
 * Each hat is a HatSpec (below), so the Sammlung (./outfits.ts — the app and the gallery phones) uses the very same
 * drawing; the gallery's costumes page puts it on through its rig (slot `over` or `under-ears`, turning like the head).
 * Felix picked 31.10: Nikolaus 2 «Набекрень», winter 3 «Мешковатая» (./outfits.ts DEFAULT_HATS); the other variants
 * stay for comparison in the gallery.
 *
 * Units: the puppet's (x = 0 centre, y = 0 feet). Head outline: (0, -163), (±22, -160), (±40, -153), (±47, -148),
 * (±54, -142), (±59, -135), (±63, -128). Lop ear tops ≈ y -163 at x ±42, ear roots (±24…29, -160…-151). Eyes top -100.6.
 */

import { ell, f, shift, smooth, type Pt } from '../geometry';
import { place, placePt, type WearTheme } from './items';

export type HatId = 'nikolaus' | 'winterhat';
/** The 31.10 hats; the gallery also keeps the rejected 28.10 ones ('a' | 'b', demo/sammlung/hats.ts). */
export type NewHatVariant = '1' | '2' | '3';

export interface HatSpec<V extends string = string> {
  id: HatId;
  variant: V;
  de: string;
  ru: string;
  /** over = drawn over the ears (before the paws), under = behind the ears (before `.lop`) */
  layer: 'over' | 'under';
  /** the pivot of the put-on bounce: the hat's bottom middle */
  land: { x: number; y: number };
  colors: Record<WearTheme, readonly [string, string]>;
  /** the hat itself (inside .wr-head) */
  markup: () => string;
  /** optional pieces that live ON each ear (inside .ear-l / .ear-r): side -1 = his right (viewer's left) */
  flap?: (side: -1 | 1) => string;
}

const O = 'class="wr-o"';
const p = (d: string, fill: string, o = false, extra = '') => `<path ${o ? `${O} ` : ''}d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const st = (d: string, color: string, w: number, op = 1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${op < 1 ? ` opacity="${op}"` : ''}/>`;

/** Rotates a drawing made in puppet units by `deg` about (px, py) — the hat's one tilt. */
function tilt(d: string, deg: number, px: number, py: number): string {
  return place(shift(d, -px, -py), px, py, deg);
}
function tiltPt(x: number, y: number, deg: number, px: number, py: number): [number, number] {
  return placePt(x - px, y - py, px, py, deg);
}

/** y of a ∩ arch through (0, yc) and (±w, ys) at x. */
const arch = (x: number, yc: number, ys: number, w: number) => ys + (yc - ys) * (1 - (x / w) ** 2);

/** A band between two arches (cuff / fur brim) with soft round ends; the bulge of the ends is `end` units. */
function band(top: { yc: number; ys: number; w: number }, bot: { yc: number; ys: number; w: number }, end = 4, n = 10): string {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = -top.w + (2 * top.w * i) / n;
    pts.push([x, arch(x, top.yc, top.ys, top.w)]);
  }
  pts.push([bot.w + end * 0.6, (top.ys + bot.ys) / 2]);
  for (let i = n; i >= 0; i--) {
    const x = -bot.w + (2 * bot.w * i) / n;
    pts.push([x, arch(x, bot.yc, bot.ys, bot.w)]);
  }
  pts.push([-bot.w - end * 0.6, (top.ys + bot.ys) / 2]);
  return smooth(pts);
}

/** Knit ribs: short vertical strokes across a band, following its arches. */
function ribs(top: { yc: number; ys: number; w: number }, bot: { yc: number; ys: number; w: number }, step: number, inset = 2.5): string {
  let d = '';
  const w = Math.min(top.w, bot.w) - 4;
  for (let x = -w + step / 2; x < w; x += step) d += `M${f(x)} ${f(arch(x, top.yc, top.ys, top.w) + inset)} L${f(x * 1.01)} ${f(arch(x, bot.yc, bot.ys, bot.w) - inset)} `;
  return d.trim();
}

/** A soft fluffy ball (pom-pom, bobble): a circle with gentle bumps. */
function fluff(cx: number, cy: number, r: number, bumps = 9): string {
  const pts: Pt[] = [];
  for (let i = 0; i < bumps * 2; i++) {
    const a = (i / (bumps * 2)) * Math.PI * 2;
    const k = i % 2 === 0 ? 1 : 0.9;
    pts.push([cx + r * k * Math.cos(a), cy + r * k * Math.sin(a)]);
  }
  return smooth(pts);
}

/** A fluffy fur brim: the band with small soft bumps along its top edge (fur, not a stiff band). */
function furBrim(top: { yc: number; ys: number; w: number }, bot: { yc: number; ys: number; w: number }, n = 12): string {
  const pts: Pt[] = [];
  for (let i = 0; i <= n * 2; i++) {
    const x = -top.w + (2 * top.w * i) / (n * 2);
    pts.push([x, arch(x, top.yc, top.ys, top.w) - (i % 2 === 0 ? 1.8 : 0)]);
  }
  pts.push([bot.w + 3.6, (top.ys + bot.ys) / 2]);
  for (let i = n; i >= 0; i--) {
    const x = -bot.w + (2 * bot.w * i) / n;
    pts.push([x, arch(x, bot.yc, bot.ys, bot.w) + (i % 2 === 0 ? 1.2 : 0)]);
  }
  pts.push([-bot.w - 3.6, (top.ys + bot.ys) / 2]);
  return smooth(pts);
}

// ---- colours: the Sammlung's rule — two tokens (--mascot-wear-1 / -2, a theme may change them) + shades of them;
// the values below are the fallbacks (the costumes page sets no tokens) and the Sammlung's per-theme colours ----------

const mix = (c: string, k: number, with_: string) => `color-mix(in srgb, ${c} ${k}%, ${with_})`;
const T1 = (fb: string) => `var(--mascot-wear-1, ${fb})`;
const T2 = (fb: string) => `var(--mascot-wear-2, ${fb})`;
const RED_HEX = '#D84A4A';
const FUR_HEX = '#FFF9F2';
const KNIT_HEX = '#4BA79B';
const CREAM_HEX = '#FFF4E4';
const RED = T1(RED_HEX);
const RED_D = mix(RED, 80, '#3A1F0A');
const RED_L = mix(RED, 66, '#FFFFFF');
const FUR = T2(FUR_HEX);
const FUR_D = mix(FUR, 88, '#5A4030');
const KNIT = T1(KNIT_HEX);
const KNIT_D = mix(KNIT, 76, '#10302C');
const KNIT_L = mix(KNIT, 66, '#FFFFFF');
const CREAM = T2(CREAM_HEX);
const CREAM_D = mix(CREAM, 86, '#5A4030');
const RIB = mix(KNIT, 58, '#0E2A26');

const NIKO_COLORS = { light: [RED_HEX, FUR_HEX], dark: ['#E05858', FUR_HEX], navy: ['#E05858', FUR_HEX] } as const;
const KNIT_COLORS = { light: [KNIT_HEX, CREAM_HEX], dark: ['#5BB7AA', CREAM_HEX], navy: ['#5BB7AA', CREAM_HEX] } as const;

type Spec = HatSpec<NewHatVariant> & { note: string };

// ---- Nikolaus ---------------------------------------------------------------------------------------------------

/** 1 «Между ушками» · Zwischen den Ohren: a small cap nestled on the crown, the lop ears lie OVER its brim. */
function niko1(): string {
  const T = 6;
  const P = [0, -158] as const;
  const t = (d: string) => tilt(d, T, P[0], P[1]);
  // a deeper fur brim (it showed as a thin line between the ears), a fuller cap
  const top = { yc: -170, ys: -162, w: 45 };
  const bot = { yc: -150, ys: -146, w: 47 };
  const cap = t('M-41 -165 C-43 -190 -26 -210 -2 -215 C11 -218 24 -213 32 -204 C39 -195 42 -180 41 -165 Z');
  const sock = t('M-4 -212 C-16 -225 -34 -224 -44 -212 C-48 -207 -50 -201 -50 -195 L-41 -194 C-40 -201 -36 -208 -28 -210 C-20 -212 -12 -209 -6 -204 Z');
  const [bx, by] = tiltPt(-45, -189, T, P[0], P[1]);
  const [wx, wy] = tiltPt(-6, -210, T, P[0], P[1]);
  return `<g class="wr-wob" data-wob="12" style="transform-origin: ${f(wx)}px ${f(wy)}px">${p(sock, RED_D, true)}${p(fluff(bx, by, 9.5), FUR, true)}${p(ell(bx + 2.4, by + 2.6, 5, 4), FUR_D, false, 'opacity=".6"')}</g>`
    + p(cap, RED, true) + p(t('M14 -212 C28 -206 37 -190 38 -163 L28 -163 C29 -184 24 -200 14 -212 Z'), RED_D, false, 'opacity=".55"')
    + st(t('M-24 -170 C-26 -186 -18 -199 -8 -205'), RED_L, 3.4, 0.6)
    + p(t(furBrim(top, bot, 9)), FUR, true) + p(t(band({ yc: -155, ys: -151, w: 44 }, bot, 2, 8)), FUR_D, false, 'opacity=".7"');
}

/** 2 «Набекрень» · Keck: pulled over the ear roots but pushed back (forehead free), tilted, the tip flops to his left. */
function niko2(): string {
  const T = 8;
  const P = [0, -160] as const;
  const t = (d: string) => tilt(d, T, P[0], P[1]);
  const top = { yc: -172, ys: -156, w: 66 };
  const bot = { yc: -152, ys: -138, w: 69 };
  const cap = t('M-58 -163 C-59 -192 -34 -215 2 -218 C30 -220 52 -205 59 -186 C62 -178 62 -170 59 -163 Z');
  const sock = t('M-6 -216 C16 -233 48 -229 63 -207 C70 -197 73 -186 72 -175 L62 -175 C62 -186 58 -197 49 -204 C36 -213 18 -213 4 -207 Z');
  const [bx, by] = tiltPt(68, -168, T, P[0], P[1]);
  const [wx, wy] = tiltPt(2, -214, T, P[0], P[1]);
  return `<g class="wr-wob" data-wob="12" style="transform-origin: ${f(wx)}px ${f(wy)}px">${p(sock, RED_D, true)}${p(t('M10 -212 C28 -222 50 -218 62 -204 L57 -201 C46 -212 28 -215 14 -208 Z'), RED_L, false, 'opacity=".35"')}${p(fluff(bx, by, 11.5), FUR, true)}${p(ell(bx + 3, by + 3.2, 6.4, 5), FUR_D, false, 'opacity=".55"')}</g>`
    + p(cap, RED, true) + p(t('M24 -214 C46 -206 58 -188 59 -163 L46 -163 C47 -184 40 -201 24 -214 Z'), RED_D, false, 'opacity=".5"')
    + st(t('M-40 -170 C-42 -190 -28 -206 -10 -212'), RED_L, 3.6, 0.55)
    + p(t(furBrim(top, bot, 13)), FUR, true) + p(t(band({ yc: -158, ys: -144, w: 68 }, bot, 2.6, 10)), FUR_D, false, 'opacity=".7"')
    + [-40, -8, 26, 52].map((x) => p(t(ell(x, arch(x, -165, -150, 66), 5.5, 3)), '#FFFFFF', false, 'opacity=".7"')).join('');
}

/** 3 «Длинный колпак» · Langer Zipfel: snug over the ear roots, a long soft tip arching over to his left with the bobble. */
function niko3(): string {
  const T = -4;
  const P = [0, -160] as const;
  const t = (d: string) => tilt(d, T, P[0], P[1]);
  const top = { yc: -171, ys: -155, w: 66 };
  const bot = { yc: -151, ys: -137, w: 69 };
  const cap = t('M-58 -162 C-58 -192 -34 -214 0 -217 C28 -219 50 -204 58 -184 C61 -176 61 -169 58 -162 Z');
  const sock = t('M-4 -215 C22 -242 66 -240 86 -210 C94 -196 96 -178 92 -160 L82 -161 C85 -178 83 -193 76 -203 C62 -222 34 -222 10 -205 Z');
  const [bx, by] = tiltPt(88, -151, T, P[0], P[1]);
  const [wx, wy] = tiltPt(4, -212, T, P[0], P[1]);
  return `<g class="wr-wob" data-wob="10" style="transform-origin: ${f(wx)}px ${f(wy)}px">${p(sock, RED, true)}${p(t('M30 -222 C56 -226 78 -214 87 -196 L82 -194 C72 -210 54 -218 34 -216 Z'), RED_L, false, 'opacity=".35"')}${p(t('M76 -203 C83 -193 85 -178 82 -161 L92 -160 C96 -178 94 -196 86 -210 Z'), RED_D, false, 'opacity=".5"')}${p(fluff(bx, by, 11.5), FUR, true)}${p(ell(bx + 3, by + 3.2, 6.4, 5), FUR_D, false, 'opacity=".55"')}</g>`
    + p(cap, RED, true) + p(t('M22 -213 C46 -206 58 -188 58 -162 L45 -162 C46 -184 40 -200 22 -213 Z'), RED_D, false, 'opacity=".5"')
    + st(t('M-40 -169 C-42 -189 -28 -205 -10 -211'), RED_L, 3.6, 0.55)
    + p(t(furBrim(top, bot, 13)), FUR, true) + p(t(band({ yc: -157, ys: -143, w: 68 }, bot, 2.6, 10)), FUR_D, false, 'opacity=".7"')
    + [-44, -12, 22, 50].map((x) => p(t(ell(x, arch(x, -164, -149, 66), 5.5, 3)), '#FFFFFF', false, 'opacity=".7"')).join('');
}

// ---- winter hats (knitted, our teal + cream) -----------------------------------------------------------------------

/** 1 «Между ушками» · Zwischen den Ohren: a round beanie on the crown, the lop ears lie OVER its cuff; pom-pom on top. */
function winter1(): string {
  const T = -7;
  const P = [0, -158] as const;
  const t = (d: string) => tilt(d, T, P[0], P[1]);
  const top = { yc: -170, ys: -163, w: 43 };
  const bot = { yc: -152, ys: -148, w: 46 };
  const crown = t(smooth([[-42, -164], [-47, -180], [-38, -198], [-18, -208], [4, -210], [24, -206], [40, -194], [46, -178], [42, -164], [0, -170]]));
  const [bx, by] = tiltPt(2, -219, T, P[0], P[1]);
  const [wx, wy] = tiltPt(2, -209, T, P[0], P[1]);
  return p(crown, KNIT, true)
    + p(t('M24 -205 C38 -197 46 -182 43 -165 L33 -167 C36 -182 33 -196 24 -205 Z'), KNIT_D, false, 'opacity=".55"')
    + st(t('M-14 -206 C-18 -194 -19 -180 -17 -168 M2 -209 C1 -196 1 -182 2 -170 M18 -206 C21 -194 22 -180 20 -168'), KNIT_D, 2.4, 0.28)
    + st(t('M-34 -192 C-30 -200 -22 -205 -14 -207'), KNIT_L, 3.2, 0.6)
    + p(t(band(top, bot, 3, 10)), KNIT_D, true) + st(t(ribs(top, bot, 6)), RIB, 2.4, 0.35)
    + `<g class="wr-wob" data-wob="7" style="transform-origin: ${f(wx)}px ${f(wy)}px">${p(fluff(bx, by, 12.5, 10), CREAM, true)}${p(ell(bx + 3, by + 3.4, 7, 5.4), CREAM_D, false, 'opacity=".6"')}</g>`;
}

/** 2 «С отворотом» · Mit Umschlag: a classic beanie with a wide fold-up cuff over the ear roots, set back, tilted. */
function winter2(): string {
  const T = 7;
  const P = [0, -160] as const;
  const t = (d: string) => tilt(d, T, P[0], P[1]);
  // the fold-up cuff is exactly as wide as the crown's base (a wider cuff read as a cap's visor), a tall round crown
  const top = { yc: -173, ys: -157, w: 66 };
  const bot = { yc: -151, ys: -137, w: 67 };
  const crown = t(smooth([[-64, -160], [-67, -180], [-57, -200], [-33, -214], [0, -219], [33, -214], [57, -200], [67, -180], [64, -160], [0, -172]]));
  const [bx, by] = tiltPt(0, -229, T, P[0], P[1]);
  const [wx, wy] = tiltPt(0, -218, T, P[0], P[1]);
  return `<g class="wr-wob" data-wob="7" style="transform-origin: ${f(wx)}px ${f(wy)}px">${p(fluff(bx, by, 15, 11), CREAM, true)}${p(ell(bx + 3.6, by + 4, 8.4, 6.4), CREAM_D, false, 'opacity=".6"')}</g>`
    + p(crown, KNIT, true)
    + p(t('M36 -212 C56 -203 67 -186 64 -162 L52 -164 C55 -184 49 -201 36 -212 Z'), KNIT_D, false, 'opacity=".55"')
    + st(t('M-32 -211 C-38 -197 -40 -182 -38 -166 M-11 -217 C-13 -202 -13 -186 -12 -170 M11 -217 C13 -202 13 -186 12 -170 M32 -211 C38 -197 40 -182 38 -166'), KNIT_D, 2.4, 0.26)
    + st(t('M-52 -194 C-46 -204 -34 -211 -22 -214'), KNIT_L, 3.4, 0.6)
    + p(t(band(top, bot, 3, 12)), KNIT, true) + st(t(ribs(top, bot, 7)), KNIT_D, 2.6, 0.4)
    + p(t(band({ yc: -164.5, ys: -149, w: 66 }, { yc: -159.5, ys: -144.4, w: 66.5 }, 2, 12)), CREAM, false, 'opacity=".95"');
}

/** 3 «Мешковатая» · Slouchy: a soft slouch beanie, its extra fabric drooping back over to his right with a little pom-pom. */
function winter3(): string {
  const T = -3;
  const P = [0, -160] as const;
  const t = (d: string) => tilt(d, T, P[0], P[1]);
  const top = { yc: -167, ys: -153, w: 65 };
  const bot = { yc: -151, ys: -138, w: 66 };
  const crown = t(smooth([[63, -156], [65, -174], [53, -194], [30, -207], [2, -212], [-28, -210], [-52, -202], [-63, -190], [-64, -172], [-63, -157], [0, -166]]));
  const slouch = t(smooth([[-20, -208], [-46, -208], [-70, -200], [-86, -186], [-90, -170], [-80, -164], [-70, -176], [-56, -186], [-36, -192], [-18, -194]]));
  const [bx, by] = tiltPt(-88, -164, T, P[0], P[1]);
  const [wx, wy] = tiltPt(-30, -204, T, P[0], P[1]);
  return p(crown, KNIT, true)
    + `<g class="wr-wob" data-wob="9" style="transform-origin: ${f(wx)}px ${f(wy)}px">${p(slouch, KNIT, true)}${p(t('M-30 -194 C-50 -190 -68 -180 -80 -165 L-86 -170 C-74 -186 -56 -196 -34 -200 Z'), KNIT_D, false, 'opacity=".5"')}${p(fluff(bx, by, 9.5, 9), CREAM, true)}${p(ell(bx + 2.4, by + 2.6, 5.2, 4), CREAM_D, false, 'opacity=".6"')}</g>`
    + p(t('M30 -206 C50 -196 63 -180 62 -157 L50 -159 C52 -178 46 -194 30 -206 Z'), KNIT_D, false, 'opacity=".5"')
    + st(t('M-6 -211 C-8 -196 -8 -182 -7 -168 M16 -209 C18 -196 18 -182 17 -168 M36 -202 C42 -190 44 -176 42 -164'), KNIT_D, 2.4, 0.26)
    + st(t('M8 -209 C-6 -204 -20 -200 -30 -200'), KNIT_L, 3.2, 0.5)
    + p(t(band(top, bot, 3.4, 12)), KNIT_D, true) + st(t(ribs(top, bot, 6.5)), RIB, 2.4, 0.35);
}

// ---- the specs ---------------------------------------------------------------------------------------------------

export const NEW_HATS: Record<HatId, Record<NewHatVariant, Spec>> = {
  nikolaus: {
    '1': { id: 'nikolaus', variant: '1', de: 'Zwischen den Ohren', ru: 'Между ушками', layer: 'under', land: { x: 0, y: -151 }, colors: NIKO_COLORS, markup: niko1,
      note: 'маленький колпачок на макушке; висячие уши лежат поверх его мехового края, кончик с помпоном свисает влево над ухом' },
    '2': { id: 'nikolaus', variant: '2', de: 'Keck', ru: 'Набекрень', layer: 'over', land: { x: 0, y: -152 }, colors: NIKO_COLORS, markup: niko2,
      note: 'натянут на корни ушей, но сдвинут назад (лоб открыт), наклонён; кончик падает вправо, помпон у правого уха' },
    '3': { id: 'nikolaus', variant: '3', de: 'Langer Zipfel', ru: 'Длинный колпак', layer: 'over', land: { x: 0, y: -151 }, colors: NIKO_COLORS, markup: niko3,
      note: 'плотно на голове, длинный мягкий кончик дугой уходит вправо, помпон висит рядом с ухом' },
  },
  winterhat: {
    '1': { id: 'winterhat', variant: '1', de: 'Zwischen den Ohren', ru: 'Между ушками', layer: 'under', land: { x: 0, y: -152 }, colors: KNIT_COLORS, markup: winter1,
      note: 'круглая вязаная шапочка на макушке; висячие уши лежат поверх отворота, помпон сверху' },
    '2': { id: 'winterhat', variant: '2', de: 'Mit Umschlag', ru: 'С отворотом', layer: 'over', land: { x: 0, y: -150 }, colors: KNIT_COLORS, markup: winter2,
      note: 'классическая шапка с широким отворотом (кремовая полоска), сидит на корнях ушей, чуть назад и набок, большой помпон' },
    '3': { id: 'winterhat', variant: '3', de: 'Slouchy', ru: 'Мешковатая', layer: 'over', land: { x: 0, y: -151 }, colors: KNIT_COLORS, markup: winter3,
      note: 'мягкая «слауч»-шапка: лишняя ткань свисает назад-влево, маленький помпон на кончике' },
  },
};

export const NEW_HAT_VARIANTS: readonly NewHatVariant[] = ['1', '2', '3'];
