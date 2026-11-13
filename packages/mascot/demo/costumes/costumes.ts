/**
 * Costumes from Felix's photos (31.10, folder «D:\Bunnys - Bunprise», 18 photos) — GALLERY-ONLY prototype.
 * Felix: «Там лежат разные идеи костюмов, кроликов и т.д. Сделай по этим идеям новые костюмы … Надо сохранить милость».
 *
 * Every costume is our own flat drawing in the puppet's units, put on through the slots of rig.ts. No logos, no brand
 * names, no text on anything (the noodle cup is a generic paper cup; the tank top has no swoosh; the laptop lid wears
 * our own wish star). Photos are referenced by number (the list in docs/design/2026-10-31-costumes-bunnies.md).
 *
 * Anchors of the puppet (bunny / hamster): eyes (±29, -93) / (±32, -96); mouth bottom -75.6 / -83.2; front paws
 * (±16, -44) / (±16, -46), they cover x ±6.5…±25.5, y -56…-32; cheeks ±53…±77 / ±51…±81 down to y -63 / -61;
 * lop ears hang from (±24, -160) to y -83 at x ±53…±75; head top -163.
 */

import { place } from '../wardrobe/items';
import { at, ell, f, flipX, line, mirror, poly, rrect, smooth, type HidePart, type Kind, type Layer, type Look, type Pt } from './rig';
import { laptop } from './laptop';
import { strawberryStill } from './strawberry';

export type CostumeId =
  | 'sport' | 'groom' | 'bride' | 'pancake' | 'knight' | 'bandana' | 'headphones' | 'lily' | 'noodles'
  | 'samurai' | 'reading' | 'strawberry' | 'bunnyhood' | 'sunglasses' | 'spa' | 'shark' | 'laptop';

/** Who can wear a costume (rig Model ids; fur.ts builds them). */
export type WearerId = 'pompon' | 'tapsi' | 'mila' | 'leo' | 'knopf' | 'hasel';

export interface Costume {
  id: CostumeId;
  /** Russian name (the gallery) */
  ru: string;
  /** German name */
  de: string;
  /** the photos it comes from (numbers in the design doc's list) */
  photos: readonly number[];
  /** one line for Felix: what it is and what changed against the photo */
  note: string;
  /** who wears it; the first one is shown in the pose grid */
  who: readonly WearerId[];
  layers: (kind: Kind) => Layer[];
  hide?: readonly HidePart[];
  /** resting eyes while worn (headphones: dreamy) */
  eyes?: 'happy' | 'sleep';
  /** the card / sheet shows it in this 3/4 turn (the laptop: he looks at the screen) */
  turn?: 'l' | 'r';
  /** only this part of his body silhouette shows while worn (rig.ts Look.bodyClip; the noodle cup) */
  bodyClip?: string;
}

export function lookOf(c: Costume, kind: Kind): Look {
  return { id: c.id, layers: c.layers(kind), hide: c.hide, eyes: c.eyes, bodyClip: c.bodyClip };
}

/**
 * 31.10, Felix's 2nd review: «Костюм наушники убери … оно с ушами криво выглядит» — off the page. The code stays
 * (reversible): the gallery shows them only with &archived=1, like the archived bunnies.
 */
export const ARCHIVED_COSTUMES: readonly CostumeId[] = ['headphones'];

// ---- shared bits ----------------------------------------------------------------------------------------------

const O = 'class="cs-o"';
const EYE: Record<Kind, { x: number; y: number }> = { bunny: { x: 29, y: -93 }, hamster: { x: 32, y: -96 } };
/** Held props sit 2 units lower on Tapsi (his paws are at -46). */
const PAW_DY: Record<Kind, number> = { bunny: 0, hamster: -2 };

const p = (d: string, fill: string, o = false, extra = '') => `<path ${o ? `${O} ` : ''}d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const stroke = (d: string, color: string, w: number, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra ? ` ${extra}` : ''}/>`;
const g = (cls: string, inner: string, extra = '') => `<g class="${cls}"${extra ? ` ${extra}` : ''}>${inner}</g>`;
const wob = (x: number, y: number, amp: number, inner: string) => `<g class="wr-wob" data-wob="${amp}" ${at(x, y)}>${inner}</g>`;
const clipped = (clip: string, inner: string) => `<g clip-path="${clip}">${inner}</g>`;
/** Moves every point of a drawing by dy (held props on Tapsi). */
const dy = (d: string, by: number) => (by ? d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_m, a: string, b: string) => `${a} ${f(Number(b) + by)}`) : d);
/** A small five-petal flower (dots on fabric, crowns), radius r. */
function blossom(x: number, y: number, r: number): string {
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    d += `${ell(x + r * 0.55 * Math.cos(a), y + r * 0.55 * Math.sin(a), r * 0.48)} `;
  }
  return d.trim();
}

// ---- 1 · Sport: tank top + sweatband + mini dumbbell (photos 1, 2) ------------------------------------------------

const LAV = '#B9A7E8';
const LAV_D = '#9A86D6';
const TANK = 'M-110 -50 L-47 -55 C-47 -61 -46 -66 -44 -68.5 Q-38.5 -72.5 -33 -68.5 C-31.6 -65 -30.6 -62 -28.6 -59.4 Q0 -40 28.6 -59.4 C30.6 -62 31.6 -65 33 -68.5 Q38.5 -72.5 44 -68.5 C46 -66 47 -61 47 -55 L110 -50 L110 -16 Q0 -6 -110 -16 Z';
const TANK_HEM = 'M-110 -26 Q0 -16 110 -26 L110 -16 Q0 -6 -110 -16 Z';
const TANK_TRIM = 'M-29 -61.5 Q0 -42.5 29 -61.5';
const BAND = 'M-92 -147 Q0 -162 92 -147 L92 -131 Q0 -146 -92 -131 Z';
const BAND_STRIPE = 'M-92 -141.4 Q0 -156.4 92 -141.4 L92 -136.6 Q0 -151.6 -92 -136.6 Z';

function dumbbell(by: number): string {
  const plate = (s: number) => [
    p(dy(rrect(s > 0 ? 26 : -36, -57, 10, 26, 3), by), '#5D5764', true),
    p(dy(rrect(s > 0 ? 36 : -42, -52.5, 6, 17, 2), by), '#716B79', true),
    p(dy(rrect(s > 0 ? 42 : -45.5, -47, 3.5, 6, 1.5), by), '#A8A2AE'),
    p(dy(rrect(s > 0 ? 28 : -34, -55, 2.6, 22, 1.3), by), '#FFFFFF', false, 'opacity=".22"'),
  ].join('');
  return p(dy(rrect(-34, -47, 68, 6, 3), by), '#A8A2AE', true) + plate(-1) + plate(1);
}

const sport: Costume = {
  id: 'sport',
  ru: 'Спорт',
  de: 'Sportler',
  photos: [1, 2],
  note: 'Майка (без логотипа), напульсник на лбу — уши висят поверх него, маленькая гантель в лапках.',
  who: ['pompon'],
  layers: (kind) => [
    { slot: 'body', draw: (c) => clipped(c.clip, g('cs-band', p(TANK, LAV) + p(TANK_HEM, LAV_D) + stroke(TANK_TRIM, '#FFFFFF', 3.4, 'opacity=".8"'))) },
    { slot: 'under-ears', draw: (c) => clipped(c.clip, g('cs-head', p(BAND, '#FFFDF7') + p(BAND_STRIPE, LAV))) },
    { slot: 'paws', draw: () => dumbbell(PAW_DY[kind]) },
  ],
};

// ---- 2 · Wedding: the groom (photos 3, 12) and the bride (photo 3, Mila) ---------------------------------------------

const TUX = '#34303B';
const TUX_SATIN = '#4C4656';
const SHIRT = '#FFFDF8';
const JACKET = 'M-110 -56 Q-62 -67 -24 -67 L24 -67 Q62 -67 110 -56 L110 10 L-110 10 Z';
const SHIRT_V = 'M-24 -67 L24 -67 L0 -25 Z';

function rose(x: number, y: number, r: number, fill: string, line: string): string {
  return p(ell(x, y, r), fill, true) + stroke(`M${f(x - r * 0.45)} ${f(y + r * 0.1)} C${f(x - r * 0.45)} ${f(y - r * 0.55)} ${f(x + r * 0.5)} ${f(y - r * 0.55)} ${f(x + r * 0.45)} ${f(y + r * 0.05)} C${f(x + r * 0.4)} ${f(y + r * 0.5)} ${f(x - r * 0.15)} ${f(y + r * 0.45)} ${f(x - r * 0.1)} ${f(y)}`, line, Math.max(1.4, r * 0.2));
}

// 31.10, Felix: «Смокинг будто чуть не доделан» → finished: sleeves with white shirt cuffs (the paws come out of
// them, like in photo 12), peak satin lapels with a highlight, a pleated shirt front with studs, the jacket's one button
// and its fronts parting below it, a neat bow tie with folds.
const LAPEL = 'M-21 -68.5 L-33.5 -65 L-29 -56.5 L-38 -52.5 L-13 -34 L-2 -27 Z';
const LAPEL_HI = 'M-21 -67.4 L-6 -32 L-3.6 -30.6 L-18.6 -66 Z';
const SLEEVE: readonly Pt[] = [[-62, -57], [-47, -59], [-30, -53], [-21, -45], [-27.6, -38.6], [-44, -44], [-63, -47]];
const BOW_W = 'M-3.6 -69.6 C-9 -74.8 -17.4 -76.4 -19 -70.6 C-20 -67 -20 -63.4 -19 -59.8 C-17.4 -54 -9 -55.6 -3.6 -60.8 Z';

const groom: Costume = {
  id: 'groom',
  ru: 'Жених (смокинг)',
  de: 'Bräutigam',
  photos: [3, 12],
  note: 'Смокинг: рукава с белыми манжетами (лапки выходят из них, как на фото 12), атласные лацканы, манишка со складками и запонками, пуговица пиджака, бабочка со складочками, белая розочка в петлице. Пара — Мила-невеста.',
  who: ['pompon'],
  layers: () => [
    {
      slot: 'body',
      draw: (c) => clipped(c.clip, g('cs-band', p(JACKET, TUX) + p(SHIRT_V, SHIRT)
        + stroke('M-7 -64 L-2.6 -33 M7 -64 L2.6 -33', '#E9E2D8', 1.6) + p(ell(0, -56, 1.9), '#2A2630') + p(ell(0, -47, 1.9), '#2A2630')
        + p(LAPEL, TUX_SATIN) + p(flipX(LAPEL), TUX_SATIN) + p(LAPEL_HI, '#FFFFFF', false, 'opacity=".1"') + p(flipX(LAPEL_HI), '#FFFFFF', false, 'opacity=".1"')
        + stroke('M0 -25 Q-5 -10 -16 6 M0 -25 Q5 -10 16 6', '#1D1A21', 1.8)
        + p(ell(0, -24.5, 3.4), '#26222C', true) + p(ell(-0.8, -25.4, 1.2), '#FFFFFF', false, 'opacity=".35"')
        + stroke('M24 -36 L36 -38', '#1D1A21', 2.2)
        + rose(-30, -58, 5.6, '#FFFDF8', '#E6DCCF') + p(ell(-24.4, -53.4, 4.4, 2.1, 40), '#7FB069')))
        + g('cs-front', p(BOW_W, TUX, true) + p(flipX(BOW_W), TUX, true) + stroke('M-8.6 -70.4 Q-12.4 -65.2 -8.6 -60 M8.6 -70.4 Q12.4 -65.2 8.6 -60', '#5A5266', 1.6)
          + p(rrect(-4.4, -70, 8.8, 9.6, 3), '#25222B', true)),
    },
    {
      // the sleeves end under the paws, the white cuffs peek out round each paw's base
      slot: 'paws',
      draw: () => p(smooth(SLEEVE), TUX) + p(smooth(mirror(SLEEVE)), TUX)
        + p(ell(-21.6, -46.4, 7.6, 5.4, 58), SHIRT) + p(ell(21.6, -46.4, 7.6, 5.4, -58), SHIRT),
    },
  ],
};

/**
 * 31.10, Felix: «Мила в фате чуть намешано выглядит» → simpler: ONE clean short veil behind her head (both sides,
 * down to her shoulders, a soft scalloped hem), no crown (her blossom on the ear is her flower), a tiny bouquet.
 */
const VEIL_PTS: readonly Pt[] = [[0, -176], [30, -173], [56, -160], [76, -138], [88, -112], [92, -92], [84, -88], [76, -94], [68, -89]];
const VEIL = smooth([...VEIL_PTS, [0, -120], ...mirror(VEIL_PTS)]);
const VEIL_HEM = 'M92 -92 C88 -86 80 -90 76 -94 C72 -88 64 -87 62 -92';

function bouquet(by: number): string {
  const leaves = [ell(-13.6, -55, 6.4, 3, -30), ell(13.6, -55, 6.4, 3, 30)].map((d) => p(dy(d, by), '#86B86D', true)).join('');
  const roses = ([[-6.6, -54, 5.8, 'blush'], [6.6, -54, 5.8, 'blush'], [0, -60, 6.4, 'cream']] as const)
    .map(([x, y, r, t]) => rose(x, y + by, r, t === 'cream' ? '#FFF7EC' : '#F7D5CF', t === 'cream' ? '#E8D9C6' : '#E5AFA6')).join('');
  const bow = p(dy(ell(-4.6, -46, 4.4, 2.8, -20), by), '#D4C2EE', true) + p(dy(ell(4.6, -46, 4.4, 2.8, 20), by), '#D4C2EE', true) + p(dy(ell(0, -46, 2.3), by), '#B9A2DE');
  return leaves + roses + bow;
}

const bride: Costume = {
  id: 'bride',
  ru: 'Невеста (Мила)',
  de: 'Braut',
  photos: [3],
  note: 'Мила как в комиксе (висячие ушки, розовый цветочек на ушке). Проще, чем было: одна короткая фата за головой до плеч (лёгкий сиреневый тюль, мягкий край), без веночка — её цветочек и так на ушке, маленький букетик из трёх розочек.',
  who: ['mila'],
  layers: (kind) => [
    { slot: 'behind', draw: () => g('cs-back', wob(0, -170, 5, p(VEIL, '#F4ECF7', true, 'opacity=".95"') + stroke(VEIL_HEM, '#DCCBE6', 2.6) + stroke(flipX(VEIL_HEM), '#DCCBE6', 2.6))) },
    { slot: 'paws', draw: () => bouquet(PAW_DY[kind]) },
  ],
};

// ---- 3 · Pancake on the head (photo 4) ---------------------------------------------------------------------------

const pancake: Costume = {
  id: 'pancake',
  ru: 'Блинчик на голове',
  de: 'Pfannkuchen',
  photos: [4],
  note: 'Тёплый блинчик лежит на макушке чуть набок, на нём кусочек масла и капля сиропа; уши висят из-под него, как на фото.',
  who: ['pompon'],
  layers: () => [
    {
      slot: 'over',
      draw: () => g('cs-head',
        p(ell(3, -163, 48, 13.5, -6), '#C98638', true)
        + p(ell(3, -167.5, 46, 10.5, -6), '#EDB866')
        + p(ell(-19, -167, 8, 3, -6), '#D99C4C', false, 'opacity=".75"') + p(ell(13, -171, 6.5, 2.6, -6), '#D99C4C', false, 'opacity=".75"') + p(ell(30, -167, 5, 2.2, -6), '#D99C4C', false, 'opacity=".75"')
        + p(ell(-4, -172, 4, 1.6, -6), '#F8D49A', false, 'opacity=".9"')
        + p('M41 -164 C43 -158 43 -152 46 -149 C49 -147 51 -150 50 -154 C49 -158 47 -161 47 -166 Z', '#C46A1F', true)
        + p('M-2 -175.5 L12 -177 L15 -170 L1 -168.5 Z', '#FFE68E', true) + p('M1 -168.5 L15 -170 L15.6 -167.4 L1.6 -165.8 Z', '#F2C95A')),
    },
  ],
};

// ---- 4 · Knight: helmet with plume, cape, wooden sword (photo 5) ------------------------------------------------------

const CAPE = '#D9534F';
const CAPE_D = '#B4403D';
const HELM = 'M-58 -136 C-60 -168 -32 -190 0 -190 C32 -190 60 -168 58 -136 Q0 -146 -58 -136 Z';
const HELM_RIM = 'M-61 -141 Q0 -153 61 -141 L61 -131 Q0 -143 -61 -131 Z';
const PLUME = 'M-1 -188 C-4 -203 -17 -217 -35 -220 C-27 -212 -21 -203 -19 -193 C-25 -199 -31 -203 -40 -205 C-28 -195 -15 -187 -4 -183 Z';
const CAPE_BACK = 'M-30 -74 C-64 -72 -94 -40 -106 -2 Q0 10 106 -2 C94 -40 64 -72 30 -74 Z';
const CAPE_FRONT_L = 'M-12 -67 C-30 -71 -54 -67 -76 -54 L-78 -38 C-58 -51 -34 -58 -16 -59 Z';

const knight: Costume = {
  id: 'knight',
  ru: 'Рыцарь',
  de: 'Ritter',
  photos: [5],
  note: 'Котёнок-рыцарь → маленький шлем-котелок с красным пером (уши из-под шлема), плащ за спиной и деревянный меч остриём вниз — лапки лежат на гарде, мордочка свободна.',
  who: ['pompon'],
  layers: (kind) => [
    { slot: 'behind', draw: () => g('cs-back', wob(0, -72, 6, p(CAPE_BACK, CAPE, true) + p('M-40 -70 C-70 -60 -90 -30 -98 -2 L-86 -1 C-80 -28 -64 -54 -40 -66 Z', CAPE_D, false, 'opacity=".6"'))) },
    { slot: 'body', draw: (c) => clipped(c.clip, g('cs-band', p(CAPE_FRONT_L, CAPE) + p(flipX(CAPE_FRONT_L), CAPE))) + g('cs-front', p(ell(0, -64, 5.6), '#E7B54A', true) + p(ell(-1.4, -65.6, 1.9), '#FFF1C2')) },
    {
      slot: 'over',
      draw: () => g('cs-head',
        wob(-1, -186, 9, p(PLUME, '#E25B5B', true) + p('M-4 -190 C-10 -202 -20 -210 -30 -213 C-22 -206 -16 -198 -13 -190 Z', '#F08080', false, 'opacity=".7"'))
        + p(HELM, '#C9D0D8', true)
        + p('M-4.6 -189.6 L4.6 -189.6 L5.4 -145.5 L-5.4 -145.5 Z', '#B3BCC7')
        + p(ell(-28, -168, 7.5, 13, 32), '#FFFFFF', false, 'opacity=".45"')
        + p(HELM_RIM, '#A3ADBA', true)
        + [-46, -24, 24, 46].map((x) => p(ell(x, -140.5 - 4 * (1 - (x / 61) ** 2) + 1, 2.1), '#EEF2F6')).join('')),
    },
    {
      slot: 'paws',
      draw: () => {
        const by = PAW_DY[kind];
        // a wooden practice sword resting point-down in front of him, the paws on the crossguard (the knight's pose)
        return p(dy('M-6.4 -42 L6.4 -42 L6.4 -6 Q0 3 -6.4 -6 Z', by), '#E2B77A', true) + p(dy('M-1.4 -40 L2 -40 L2 -6 L-1.4 -6 Z', by), '#F3D3A2', false, 'opacity=".9"')
          + p(dy(rrect(-21, -49, 42, 8, 4), by), '#8A5F32', true)
          + p(dy(rrect(-3.8, -59, 7.6, 11, 2.6), by), '#6B4A33', true) + p(dy(ell(0, -61, 5.2), by), '#B98843', true);
      },
    },
  ],
};

// ---- 5 · Bandana with a bow (photo 6) --------------------------------------------------------------------------

const PINK = '#F4A9BD';
const PINK_D = '#E585A1';
const BANDANA = 'M-92 -151 Q0 -167 92 -151 L92 -134 Q0 -150 -92 -134 Z';
const LOOP = 'M0 0 C-7 -11 -22 -17 -27 -8 C-30 -1 -26 6 -18 7 C-11 8 -5 5 0 0 Z';
const TAIL = 'M1 2 C4 9 7 16 11 23 L18 19 C13 13 9 7 5 1 Z';

const bandana: Costume = {
  id: 'bandana',
  ru: 'Бандана с бантом',
  de: 'Haarband mit Schleife',
  photos: [6],
  note: 'Розовая бандана в цветочек вокруг лба (уши висят поверх неё) и большой бант на макушке, хвостики банта качаются после прыжка.',
  who: ['pompon'],
  layers: () => {
    const B = { x: 25, y: -163, r: 12 };
    const pl = (d: string) => place(d, B.x, B.y, B.r);
    const dots = [[-48, -142], [-20, -150], [10, -151], [40, -145], [-66, -134], [64, -134]].map(([x, y]) => p(blossom(x as number, y as number, 4.4), '#FFFFFF', false, 'opacity=".9"')).join('');
    return [
      { slot: 'under-ears', draw: (c) => clipped(c.clip, g('cs-head', p(BANDANA, PINK) + dots + p('M-92 -137.5 Q0 -153.5 92 -137.5 L92 -134 Q0 -150 -92 -134 Z', PINK_D, false, 'opacity=".6"'))) },
      {
        slot: 'over',
        draw: () => g('cs-head',
          wob(B.x, B.y, 12, p(pl(TAIL), PINK_D, true) + p(pl(flipX(TAIL)), PINK_D, true))
          + p(pl(LOOP), PINK, true) + p(pl(flipX(LOOP)), PINK, true)
          + p(pl(blossom(-15, -3, 3.6)), '#FFFFFF', false, 'opacity=".9"') + p(pl(blossom(15, -3, 3.6)), '#FFFFFF', false, 'opacity=".9"')
          + p(pl(ell(0, 0, 6.4, 5.8)), PINK_D, true)),
      },
    ];
  },
};

// ---- 6 · Headphones (photo 8) — 31.10 redone from scratch ----------------------------------------------------------
// Felix: «Наушники вообще нет, полный провал» (the first ones: a thin cream band on cream fur, small cups floating at
// the sides). Photo 8: BIG soft over-ear headphones on a lop: the padded band rests ON the crown, the cups are pressed
// onto the ear roots and the ears hang out below them, the cable dangles; he is cosy and dreamy (eyes closed ^ ^).
// Soft pink (no cream on cream), white cushions, every part touches the next (band → cups), nothing floats.

const PH = '#F3B3C5';
const PH_D = '#DB8BA2';
const PH_L = '#FCDDE6';
const CUSH = '#FFF8F4';
/** the band's inner edge rests on the head (1–2 units above its outline), 10 units thick */
const PH_IN: readonly Pt[] = [[-55, -146], [-50, -155], [-38, -164], [-20, -169.5], [0, -170.5], [20, -169.5], [38, -164], [50, -155], [55, -146]];
const PH_OUT: readonly Pt[] = [[67, -146], [62, -160], [48, -173], [24, -181], [0, -182.5], [-24, -181], [-48, -173], [-62, -160], [-67, -146]];
const PH_BAND = smooth([...PH_IN, ...PH_OUT]);
const PH_PAD = 'M-26 -170 C-14 -173.4 14 -173.4 26 -170 L25 -165.6 C12 -168.8 -12 -168.8 -25 -165.6 Z';

function phonesCup(s: number): string {
  // a deep soft cup seen from the front: the shell (pink), the cushion between shell and head (white), a lighter rim
  const x = s * 58;
  return p(rrect(x - 16, -153, 32, 48, 16), PH, true)
    + p(rrect(s > 0 ? x - 18 : x + 9, -149, 9, 40, 4.5), CUSH, true)
    + p(rrect(s > 0 ? x + 3 : x - 13, -146, 10, 34, 5), PH_D, false, 'opacity=".45"')
    + p(ell(x - s * 2, -141, 3.6, 5.6, -10 * s), '#FFFFFF', false, 'opacity=".6"');
}

function headphones(kind: Kind): Layer[] {
  if (kind === 'hamster') {
    // Tapsi: round his neck (on his head they would cover his folded ear, his signature)
    const cup = (s: number) => p(ell(s * 42, -60, 15, 16), PH, true) + p(ell(s * 44.5, -60, 10.6, 12), CUSH, true) + p(ell(s * 41, -66, 3.4, 2.4, -20), '#FFFFFF', false, 'opacity=".75"');
    return [{ slot: 'body', draw: () => g('cs-front', p('M-40 -66 C-30 -47 30 -47 40 -66 L40 -58 C30 -39 -30 -39 -40 -58 Z', PH, true) + cup(-1) + cup(1)) }];
  }
  const cable = 'M-56 -106 C-60 -92 -74 -84 -78 -70 C-82 -56 -70 -52 -73 -40 C-75 -31 -84 -26 -83 -14';
  return [{
    slot: 'over',
    draw: () => g('cs-head',
      wob(-56, -106, 6, stroke(cable, PH_D, 3.2))
      + p(PH_BAND, PH, true) + p(PH_PAD, CUSH, true) + stroke(line([[-58, -150], [-50, -165], [-30, -176], [-10, -179]]), PH_L, 2.6, 'opacity=".8"')
      + phonesCup(-1) + phonesCup(1)),
  }];
}

const phones: Costume = {
  id: 'headphones',
  ru: 'Наушники',
  de: 'Kopfhörer',
  photos: [8],
  note: 'Переделаны с нуля (31.10): большие мягкие розовые наушники, дужка лежит на макушке, чашки прижаты к корням ушей — висячие уши выглядывают снизу, провод свисает; глаза мечтательно закрыты ^ ^. У Тапси — на шее (на голове закрыли бы его загнутое ушко).',
  who: ['pompon', 'tapsi'],
  eyes: 'happy',
  layers: headphones,
};

// ---- 7 · Lily hat (photo 9) ------------------------------------------------------------------------------------

const PETAL = 'M0 -5 C12 -12 30 -13 44 -6 C49 -3 52 -6 55 -10 C55 -3 52 3 45 5 C32 9 14 8 0 5 Z';
const PETAL_VEIN = 'M3 -1 C16 -4 30 -4 42 -1 C30 1.6 16 2 3 1.4 Z';

const lily: Costume = {
  id: 'lily',
  ru: 'Шляпка-лилия',
  de: 'Lilienhut',
  photos: [9],
  note: 'Розовая лилия вверх тормашками, как шляпка: лепестки расходятся в стороны и загибаются кончиками вверх, сверху зелёный стебелёк.',
  who: ['pompon'],
  layers: () => {
    // the open lily hangs over his head like a soft brim: back petals level, side petals droop, front ones short
    const R: Array<[number, number, number, string]> = [[8, 1.18, 0, '#EC92B0'], [38, 1.3, 1, '#F6A9C2'], [74, 0.7, 2, '#F8B4CB']];
    const petals = (front: boolean) => R.filter(([, , i]) => (front ? i > 0 : i === 0)).map(([deg, k, , fill]) => {
      const d = place(PETAL, 4, -168, deg, k);
      const v = place(PETAL_VEIN, 4, -168, deg, k);
      return p(flipX(d), fill, true) + p(flipX(v), '#FDD6E3', false, 'opacity=".85"') + p(d, fill, true) + p(v, '#FDD6E3', false, 'opacity=".85"');
    }).join('');
    return [{
      slot: 'over',
      draw: () => g('cs-head', petals(false) + p('M-27 -164 C-26 -178 -12 -184 0 -184 C12 -184 26 -178 27 -164 Q0 -158 -27 -164 Z', '#F29DBA', true) + petals(true)
        + p('M-2.6 -177 C-3.4 -187 -0.6 -197 5.4 -205 L9.6 -202 C4.6 -195 2.4 -187 2.6 -177 Z', '#79B062', true)
        + [[-8, -166], [0, -163], [8, -166]].map(([x, y]) => p(ell(x as number, y as number, 2.6), '#E3A043')).join('')),
    }];
  },
};

// ---- 8 · Noodle cup (photo 10) — a generic paper cup, no text; 31.10 finished -------------------------------------
// Felix: «Стаканчик лапши неплохо, но не до конца доделан и будто не такой милый, как был на референсе». Photo 10: a
// TALL cup, only the head peeks over the rim, the paws hang on the rim, the cheeks rest on it. So: a taller cup whose
// rim is right under his cheeks, his own paws hidden and drawn ON the rim (his paws sit lower than the rim), a few
// noodles over the edge, the fork, a little bowl picture instead of any brand.

const CUP = 'M-74 -62 Q0 -44 74 -62 L61 0 Q59 8 52 8 L-52 8 Q-59 8 -61 0 Z';
const CUP_LIP = 'M-75.6 -64.4 Q0 -46.4 75.6 -64.4 L74.8 -57.4 Q0 -39.4 -74.8 -57.4 Z';
const CUP_BAND = 'M-74.2 -55.4 Q0 -37.4 74.2 -55.4 L71.8 -42.6 Q0 -24.6 -71.8 -42.6 Z';
const CUP_LOW = 'M-63.6 -8 Q0 0 63.6 -8 L63 -3 Q0 5 -63 -3 Z';

function cupDots(): string {
  // one row of small white dots along the middle of the red band (y follows the curve)
  let d = '';
  for (let x = -62; x <= 62; x += 10.4) {
    const t = (x + 74.2) / 148.4;
    d += ell(x, -49 + 36 * t * (1 - t), 2.1) + ' ';
  }
  return d.trim();
}

// 31.10, Felix's 2nd review: «бока вылазят за стакан, вилка летает». His body is ±75 wide at y -31, the cup only
// ±67.5 there — so while it is worn his own body silhouette is clipped to the part above the cup's front lip
// (CUP_KEEP, rig.ts Look.bodyClip): the clip sits on his body path, so it holds in every pose, every frame of the binky
// (squash, twist) and every breath. The fork is no longer beside the cup: it stands IN the cup, stuck into the noodles
// behind him, leans on the left rim and comes out behind his cheek (like the photo) — it belongs to the cup's layer,
// so it moves only with the cup.
/** what stays of his body: everything above the lower edge of the cup's front lip (CUP_LIP) */
const CUP_KEEP = 'M-200 -330 L200 -330 L200 -57.4 L74.8 -57.4 Q0 -39.4 -74.8 -57.4 L-200 -57.4 Z';
/** a plastic fork drawn upright (its foot at 0 0, tines up): handle, neck, head, three tines — one outline */
const FORK = [rrect(-3, -88, 6, 88, 3), 'M-3 -86 L3 -86 L7.4 -97 L-7.4 -97 Z', rrect(-7.4, -101, 14.8, 7, 3), rrect(-7.4, -116, 3.2, 18, 1.6), rrect(-1.6, -117, 3.2, 19, 1.6), rrect(4.2, -116, 3.2, 18, 1.6)].join(' ');
/** stuck into the noodles inside the cup (its foot hidden by the cup's front), leaning out over the left rim */
const FORK_AT = { x: -55, y: -30, deg: -24 } as const;
/** his paws resting on the rim (his own are hidden: they sit lower than the rim) */
function rimPaw(s: number): string {
  return p(ell(s * 21, -61.6, 10.4, 7.4, s * 8), 'var(--mascot-paw)', true)
    + stroke(`M${f(s * 15.4)} -58.2 l${f(s * 0.6)} 2.2 M${f(s * 20.4)} -57.2 l${f(s * 0.3)} 2.4 M${f(s * 25.4)} -57.6 l${f(-s * 0.2)} 2.3`, 'rgba(150,90,40,.35)', 1.2);
}

const noodles: Costume = {
  id: 'noodles',
  ru: 'В стаканчике лапши',
  de: 'Im Nudelbecher',
  photos: [10],
  note: 'Доделан ещё раз (2-й отзыв, 31.10): бока больше не вылезают — пока он в стаканчике, его тело ниже края просто не рисуется (в любой позе и в каждом кадре прыжка). Вилка воткнута в лапшу ВНУТРИ стаканчика, опирается на левый край и выглядывает из-за щёчки, как на фото — едет только вместе со стаканчиком. Над краем голова и лапки, через край — две ниточки лапши, на стаканчике мисочка (без надписей). Тапси — тоже.',
  who: ['pompon', 'tapsi'],
  hide: ['feet', 'tail', 'paws'],
  bodyClip: CUP_KEEP,
  layers: () => [
    {
      // the cup's inside (behind him): the far wall, the noodles, the fork stuck into them
      slot: 'behind',
      draw: () => p(ell(0, -62, 74, 9), '#E4D7C6', true) + p(ell(0, -62.6, 69, 6.6), '#F2CF6B')
        + stroke('M-70 -62 C-67 -67 -62 -67 -60 -63 C-58 -68 -52 -68 -50 -64 M50 -64 C52 -68 58 -68 60 -63 C62 -67 67 -67 70 -62', '#E2B653', 2.4)
        + p(place(FORK, FORK_AT.x, FORK_AT.y, FORK_AT.deg), '#6DBE7B', true)
        + p(place(rrect(-1.2, -84, 2.4, 54, 1.2), FORK_AT.x, FORK_AT.y, FORK_AT.deg), '#A8DCB0', false, 'opacity=".75"'),
    },
    {
      slot: 'over',
      draw: () => p(CUP, '#FFFDF8', true) + p('M74 -62 L61 0 Q59 8 52 8 L46 8 Q54 4 56 -4 L66 -56 Z', '#EDE5D9', false, 'opacity=".8"')
        + p(CUP_BAND, '#E0524A') + p(cupDots(), '#FFFFFF', false, 'opacity=".95"') + p(CUP_LOW, '#E0524A')
        + p('M-12 -27 L12 -27 Q12 -15 0 -15 Q-12 -15 -12 -27 Z', '#F2A93B', true) + stroke('M-5 -33 Q-3 -36 -5 -39 M1 -33 Q3 -36 1 -39 M7 -33 Q9 -36 7 -39', '#E0B26A', 1.8, 'opacity=".8"')
        + stroke('M4 -27 L16 -40 M8 -27 L19 -38', '#B98A4E', 1.6)
        + p(CUP_LIP, '#F5EEE3', true)
        // two noodles over the lip (one by the fork, one on the right) — short, so the band stays clean
        + stroke('M-58 -62.4 C-59 -57 -54 -55.6 -54 -51.4', '#F2CF6B', 3.4) + stroke('M43 -59.4 C43.4 -55 47.6 -54 47.4 -49.6', '#F2CF6B', 3.4)
        + g('cs-band', rimPaw(-1) + rimPaw(1)),
    },
  ],
};

// ---- 9 · Samurai: straw kasa + wooden practice sword on the back + a blade of grass (photo 11) --------------------------

const KASA = 'M-92 -152 Q-50 -166 -6 -203 Q0 -208 6 -203 Q50 -166 92 -152 Q0 -132 -92 -152 Z';
const KASA_RIM = 'M-92 -152 Q0 -132 92 -152 L90 -147 Q0 -126 -90 -147 Z';

const samurai: Costume = {
  id: 'samurai',
  ru: 'Самурай',
  de: 'Samurai',
  photos: [11],
  note: 'Соломенная шляпа-каса (уши выходят из-под полей), деревянный учебный меч за спиной и травинка во рту — как у львиноголового с фото. Красиво и на Лёве.',
  who: ['pompon', 'leo'],
  layers: () => {
    const weave = [-74, -50, -26, 0, 26, 50, 74].map((x) => `M0 -203 L${x} ${f(-152 + 20 * 2 * ((x + 92) / 184) * (1 - (x + 92) / 184) * 0.98 - 3)}`).join(' ');
    const sword = (d: string) => place(d, -104, -152, 30);
    return [
      {
        slot: 'behind',
        draw: () => g('cs-back', p(sword('M44 -4.4 L226 -4.4 Q238 0 226 4.4 L44 4.4 Z'), '#C99158', true) + p(sword('M46 -1 L224 -1 L224 1.4 L46 1.4 Z'), '#E0B27C', false, 'opacity=".8"')
          + p(sword(rrect(0, -4.8, 38, 9.6, 4.4)), '#4F3E33', true) + p(sword(ell(41, 0, 4.2, 10.5)), '#3E3A36', true)),
      },
      {
        slot: 'over',
        draw: () => g('cs-head', p(KASA, '#E6C483', true) + stroke(weave, '#B88E4A', 2.4, 'opacity=".45"')
          + stroke('M-62 -166 Q0 -150 62 -166', '#B88E4A', 2.2, 'opacity=".4"') + stroke('M-32 -184 Q0 -176 32 -184', '#B88E4A', 2, 'opacity=".4"')
          + p(KASA_RIM, '#C99F5B', true) + p(ell(0, -204, 5, 3.8), '#C99F5B', true)),
      },
      {
        slot: 'face',
        draw: (c) => {
          const y = c.kind === 'bunny' ? 0 : -7.6;
          return p(dy('M3 -77.6 C11 -77 22 -73.5 33 -64.5 C25 -70.5 13 -74.4 3 -75.2 Z', y), '#7FB069', true) + p(dy('M2.4 -77 C8 -74.6 14 -69 18.4 -60.6 C13.4 -67.6 8 -72.6 2.4 -75.2 Z', y), '#679C55', true);
        },
      },
    ];
  },
};

// ---- 10 · Reading: round glasses + a little book (photo 13) ----------------------------------------------------------

const reading: Costume = {
  id: 'reading',
  ru: 'Очки и книжка',
  de: 'Leseratte',
  photos: [13],
  note: 'Круглые очки в черепаховой оправе — на носу (на фото они на макушке; на носу читается лучше) — и раскрытая книжка в лапках.',
  who: ['pompon'],
  layers: (kind) => [
    {
      slot: 'face',
      draw: (c) => {
        const e = EYE[c.kind];
        const lens = (s: number) => `<circle cx="${s * e.x}" cy="${e.y}" r="12.6" fill="#FFFFFF" opacity=".2"/>`
          + `<circle cx="${s * e.x}" cy="${e.y}" r="12.6" fill="none" stroke="#8B5A3C" stroke-width="4.6"/>`
          + stroke(`M${f(s * e.x - 7)} ${f(e.y - 6)} Q${f(s * e.x - 4)} ${f(e.y - 9.4)} ${f(s * e.x + 1)} ${f(e.y - 10)}`, '#FFFFFF', 2, 'opacity=".7"');
        return lens(-1) + lens(1) + stroke(`M${f(-e.x + 12.6)} ${f(e.y - 2)} Q0 ${f(e.y - 9.5)} ${f(e.x - 12.6)} ${f(e.y - 2)}`, '#8B5A3C', 4) + stroke(`M${f(-e.x - 12.4)} ${f(e.y - 3)} L${f(-e.x - 26)} ${f(e.y - 6.5)} M${f(e.x + 12.4)} ${f(e.y - 3)} L${f(e.x + 26)} ${f(e.y - 6.5)}`, '#8B5A3C', 3.8);
      },
    },
    {
      slot: 'paws',
      draw: () => {
        const by = PAW_DY[kind];
        const page = 'M-1.5 -42 C-14 -48 -31 -48 -45 -42 L-45 -14 C-31 -20 -14 -20 -1.5 -14 Z';
        const lines = [-37, -31, -25].map((yy) => `M-39 ${yy} C-29 ${yy - 3.4} -16 ${yy - 3.4} -7 ${yy}`).join(' ');
        return p(dy('M0 -40 C-14 -46 -33 -46 -48 -40 L-48 -10 C-33 -16 -14 -16 0 -10 C14 -16 33 -16 48 -10 L48 -40 C33 -46 14 -46 0 -40 Z', by), '#D6505A', true)
          + p(dy(page, by), '#FFFCF4', true) + p(dy(flipX(page), by), '#FFFCF4', true)
          + stroke(dy(lines, by), '#B8AA9B', 2.4, 'opacity=".55"') + stroke(dy(flipX(lines), by), '#B8AA9B', 2.4, 'opacity=".55"')
          + stroke(dy('M0 -41 L0 -13', by), '#E4D8C8', 1.8);
      },
    },
  ],
};

// ---- 11 · Strawberry (photo 14) — 31.10, 2nd review: a little tree, a scene, a messy mouth ------------------------------
// Felix: «Клубничку я бы перевернул и … сделал бы тоже более милее и подробнее, как в примере? Типа деревце, он встаёт
// на задние лапки, чтобы дотянуться до клубнички, и кушает её, вокруг рта чуть краснее становятся пятна или кусочки».
// 3rd review: «чтобы он именно вставал на лапки и ротиком ел с дерева, а не срывал клубнику … сделай пышнее».
// 4th review: «я бы выбрал куст (Б) и убрал бы эту странную висящую клубнику и исправил бы поднятие, как … в перископе».
// The drawings and the scene live in strawberry.ts; the still here: the wide bush, his half-eaten berry on its edge
// right beside his mouth, juice spots round his mouth, content ^ ^.

const strawberry: Costume = {
  id: 'strawberry',
  ru: 'Клубничка',
  de: 'Erdbeere',
  photos: [14],
  note: 'Переделана (4-й отзыв, 31.10): только широкий куст (Б); его ягодка растёт на самом краю куста, прямо у ротика — над головой и у глаз ничего не висит. Сцена ниже: он поднимается, как «Перископ» (задние лапки стоят на месте, тело приподнимается от них, передние лапки у груди, носик вверх), нюхает и ест ягодку ротиком прямо с куста — 3 укуса, щёчки надуваются, вокруг рта остаются пятнышки сока; потом садится. Здесь — кадр «после»: надкусанная ягодка на кусте, мордочка в соке. Куст стоит на земле — в «Переносе» его нет. Тапси — тот же кадр, куст слева (справа его загнутое ушко).',
  who: ['pompon', 'tapsi'],
  eyes: 'happy',
  layers: (kind) => strawberryStill(kind),
};

// ---- 12 · Hoods: bunny-ears hoodie (photo 15) and shark hoodie (photo 18) ----------------------------------------------
// The hood frames the face: one shape for hood + hoodie with an oval opening for the face (evenodd). It is wider than
// his head and body everywhere (so the 9-unit turn shift never shows him from behind it) and moves like the paws
// (cs-band: no narrowing, or the far side would show his head). His own ears are hidden while it is on.

const HOOD_R: readonly Pt[] = [[0, -178], [30, -175], [55, -162], [71, -140], [80, -112], [81, -86], [78, -64], [77, -50], [82, -36], [83, -22], [77, -12], [56, -7], [28, -5]];
const HOOD = smooth([...HOOD_R, [0, -4.6], ...mirror(HOOD_R.slice(1))]);
const HOLE = { cx: 0, cy: -91, rx: 53, ry: 44 } as const;
const HOLE_D = ell(HOLE.cx, HOLE.cy, HOLE.rx, HOLE.ry);
const RIM = `${ell(HOLE.cx, HOLE.cy, HOLE.rx + 6, HOLE.ry + 6)} ${HOLE_D}`;

const HOOD_EAR_L: readonly Pt[] = [[-31, -166], [-41, -190], [-45, -215], [-39, -236], [-28, -239], [-21, -222], [-18, -196], [-15, -168]];
const HOOD_EAR_IN_L: readonly Pt[] = [[-29, -176], [-36, -196], [-38, -216], [-33, -229], [-28, -229], [-25, -215], [-23.4, -195], [-21, -176]];

const bunnyhood: Costume = {
  id: 'bunnyhood',
  ru: 'Худи с ушками',
  de: 'Hasenohren-Kapuze',
  photos: [15],
  note: 'Белое пушистое худи: капюшон обнимает мордочку, на нём свои большие ушки (розовые внутри) и маленькая мордочка :3, как на фото. Свои уши Помпона спрятаны в капюшоне.',
  who: ['pompon'],
  hide: ['ears', 'tail'],
  layers: () => [
    {
      slot: 'over',
      draw: () => g('cs-band',
        wob(-22, -170, 7, p(smooth(HOOD_EAR_L), '#FFFFFF', true) + p(smooth(HOOD_EAR_IN_L), '#F7B6C6'))
        + wob(22, -170, 7, p(smooth(mirror(HOOD_EAR_L)), '#FFFFFF', true) + p(smooth(mirror(HOOD_EAR_IN_L)), '#F7B6C6'))
        + p(`${HOOD} ${HOLE_D}`, '#FFFFFF', true, 'fill-rule="evenodd"') + p(RIM, '#F1ECEA', false, 'fill-rule="evenodd"')
        + p(ell(-13, -157, 3.2, 3.8), '#3A2622') + p(ell(13, -157, 3.2, 3.8), '#3A2622')
        + stroke('M-5.4 -149.4 Q-2.7 -146.2 0 -149.4 Q2.7 -146.2 5.4 -149.4', '#3A2622', 1.8)
        + stroke('M-19 -150 L-29 -151.6 M-19 -147 L-28.6 -146 M19 -150 L29 -151.6 M19 -147 L28.6 -146', '#3A2622', 1.3, 'opacity=".55"')
        + p(ell(-22, -149, 4.4, 2.6), '#F7B6C6', false, 'opacity=".55"') + p(ell(22, -149, 4.4, 2.6), '#F7B6C6', false, 'opacity=".55"')),
    },
  ],
};

function teeth(): string {
  let d = '';
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = 203 + (i * (337 - 203)) / (n - 1);
    const pt = (deg: number, k: number): Pt => [HOLE.cx + HOLE.rx * k * Math.cos((deg * Math.PI) / 180), HOLE.cy + HOLE.ry * k * Math.sin((deg * Math.PI) / 180)];
    d += poly([pt(a - 7.2, 1.02), pt(a, 0.8), pt(a + 7.2, 1.02)]) + ' ';
  }
  return d.trim();
}

const SHARK = '#9AA7B4';
const SHARK_D = '#7E8B99';
const FIN_L = 'M-63 -126 C-81 -118 -95 -92 -97 -62 C-85 -72 -73 -92 -61 -106 Z';

const shark: Costume = {
  id: 'shark',
  ru: 'Акулье худи',
  de: 'Hai-Kapuze',
  photos: [18],
  note: 'Серая акула: белые зубки по краю капюшона, плавник на макушке, два боковых плавника висят, как висячие ушки, глазки по бокам, белое брюшко.',
  who: ['pompon'],
  hide: ['ears', 'tail'],
  layers: () => [
    {
      slot: 'over',
      draw: () => g('cs-band',
        wob(-64, -122, 9, p(FIN_L, SHARK_D, true)) + wob(64, -122, 9, p(flipX(FIN_L), SHARK_D, true))
        + wob(2, -176, 6, p('M-11 -174 C-9 -194 3 -212 18 -217 C13 -202 12 -188 16 -173 Z', SHARK_D, true))
        + p(`${HOOD} ${HOLE_D}`, SHARK, true, 'fill-rule="evenodd"')
        + p(ell(0, -24, 34, 13), '#C3CDD7')
        + p(RIM, '#B4BFCA', false, 'fill-rule="evenodd"') + p(teeth(), '#FFFFFF', true)
        + p(ell(-46, -140, 4.6, 5.4), '#2B2730') + p(ell(46, -140, 4.6, 5.4), '#2B2730')
        + p(ell(-44.6, -142, 1.5), '#FFFFFF') + p(ell(47.4, -142, 1.5), '#FFFFFF')),
    },
  ],
};

// ---- 13 · Sunglasses (photo 16) ---------------------------------------------------------------------------------

const sunglasses: Costume = {
  id: 'sunglasses',
  ru: 'Солнечные очки',
  de: 'Sonnenbrille',
  photos: [16],
  note: 'Большие тёмные очки с бликами. Чтобы не было «крутой кролик», оправа круглая и мягкая, блики крупные — он всё равно выглядит малышом.',
  who: ['pompon'],
  layers: () => [
    {
      slot: 'face',
      draw: (c) => {
        const e = EYE[c.kind];
        const lens = (s: number) => {
          const x = s * e.x;
          return p(rrect(x - 16.5, e.y - 14.5, 33, 27, 12), '#2B2730', true) + p(rrect(x - 13.8, e.y - 11.8, 27.6, 21.6, 9.6), '#3E3648')
            + p(rrect(x - 13.8, e.y + 1.5, 27.6, 8.3, 5), '#5A4E66', false, 'opacity=".55"')
            + stroke(`M${f(x - 9)} ${f(e.y - 4)} L${f(x - 3)} ${f(e.y - 9)}`, '#FFFFFF', 3, 'opacity=".75"') + stroke(`M${f(x - 7.6)} ${f(e.y + 1.4)} L${f(x - 5.6)} ${f(e.y - 0.4)}`, '#FFFFFF', 2.2, 'opacity=".6"');
        };
        return lens(-1) + lens(1) + p(`M${f(-e.x + 15)} ${f(e.y - 7)} Q0 ${f(e.y - 13)} ${f(e.x - 15)} ${f(e.y - 7)} L${f(e.x - 15)} ${f(e.y - 2.6)} Q0 ${f(e.y - 8.6)} ${f(-e.x + 15)} ${f(e.y - 2.6)} Z`, '#2B2730')
          + stroke(`M${f(-e.x - 16)} ${f(e.y - 7)} L${f(-e.x - 28)} ${f(e.y - 10)} M${f(e.x + 16)} ${f(e.y - 7)} L${f(e.x + 28)} ${f(e.y - 10)}`, '#2B2730', 3.6);
      },
    },
  ],
};

// ---- 14 · Spa: a white towel turban, a white face mask, cucumber slices (photo 17) — 31.10 white ---------------------
// Felix: «Спа-день тоже надо подправить, чтобы был белый, как на референсе» → a WHITE towel (cool grey folds), a soft
// white face mask over forehead and eyes (nose, mouth and blush stay free), two cucumber slices on the eyes. Calm.

// 31.10, Felix's 2nd review: «Шапка выглядит не доделанно, белая штука на глазах тоже не нужна, сделать как на
// примере — много таких огурчиков полупрозрачных и как бы масочку». So the white band is gone; instead a mask of MANY
// thin, see-through cucumber slices overlapping like in photo 17 (eyes closed, relaxed; nose and mouth free), and a
// finished turban: a puffy towel dome around the head (the lop ears come out from UNDER its lower edge), the towel
// gathered at the front into one twisted ridge, its end tucked in at the top.

/** the turban's roll: wider than the head where the ear roots are, tucked in at its lower corners (±62, -134) */
const TOWEL = 'M-62 -134 C-75 -138 -77 -160 -64 -177 C-50 -195 -23 -203 2 -203 C28 -203 54 -193 66 -176 C77 -159 75 -138 62 -134 C42 -141 18 -143 0 -143 C-18 -143 -42 -141 -62 -134 Z';
// 31.10, Felix's 3rd review: «Шапка выглядит … слишком плохо сделана и проработана, в местах даже не понятно, что это».
// Now a towel wrapped round the head in visible layers: the wrap round the forehead with the towel's blue hem stripe,
// two wraps spiralling up from each side and crossing at the front, a rolled knot where they meet, the folded end with
// its stripes tucked out from under the knot; soft shadows under every layer and a hint of terry loops.
/** the wrap round his forehead (its lower edge is the towel's hemmed edge) */
const WRAP_LOW = 'M-66 -134 C-44 -142 -20 -145 0 -145 C20 -145 44 -142 66 -134 C72 -140 73 -148 70 -155 C46 -163 22 -166 0 -166 C-22 -166 -46 -163 -70 -155 C-73 -148 -72 -140 -66 -134 Z';
/** from his right side up across the top to the left (under the other wrap) */
const WRAP_R = 'M71 -153 C52 -164 30 -176 8 -188 C-6 -195 -22 -201 -36 -203 C-30 -210 -18 -212 -6 -209 C14 -203 40 -188 64 -174 C70 -168 73 -161 71 -153 Z';
/** from his left side up to the knot (over the other wrap) */
const WRAP_L = 'M-71 -150 C-50 -158 -24 -168 10 -178 L14 -194 C-14 -186 -44 -176 -70 -164 C-73 -159 -73 -154 -71 -150 Z';
/** the towel's end, folded and tucked out from under the knot */
const TUCK = 'M16 -197 C24 -210 40 -214 47 -206 C50 -201 46 -196 40 -196 C32 -197 24 -195 16 -197 Z';
const HEM = '#9CC4E4';
const TOWEL_SH = '#DCE5EC';

/** One thin cucumber slice: a thin skin rim, pale see-through flesh, a lighter core, a faint ring of seeds. */
function slice(x: number, y: number, r: number, turn = 0): string {
  const seeds = Array.from({ length: 6 }, (_, i) => {
    const a = ((i * 60 + turn) * Math.PI) / 180;
    return ell(x + r * 0.34 * Math.cos(a), y + r * 0.34 * Math.sin(a), r * 0.07, r * 0.13, i * 60 + turn + 90);
  }).join(' ');
  return `<g opacity=".55">${p(ell(x, y, r), '#E2F2C6', false, 'stroke="#86BC6A" stroke-width="1.1"')}${p(ell(x, y, r * 0.64), '#F4FBE8', false, 'opacity=".8"')}${p(seeds, '#C3DEA2')}</g>`;
}
// 31.10, polish («зелёные горошины, а не маска»): first ONE soft cream mask (pale green, see-through) over forehead,
// round the eyes and the cheeks — holes for the closed eyes, a notch that leaves the nose and the mouth free; his blush
// is painted softly back on top — then denser small slices on it, overlapping like scales. The face slot's box:
// |x| ≤ 62, y −124 … −56.
const MASK_R = [[14, -123.5, 34, -121, 47, -113], [56, -107, 61, -97, 61, -86], [61, -74, 58, -64, 50, -60.5], [42, -57.5, 30, -59, 23, -62],
  [17, -65, 15, -77, 13, -84], [11, -89, 5, -91.5, 0, -91.5]] as const;
/** the mask's outline (the right half, then the same mirrored back up), with the two eye holes (even-odd) */
function faceMask(): string {
  let d = 'M0 -123.5';
  for (const [a, b, c, e, x, y] of MASK_R) d += ` C${a} ${b} ${c} ${e} ${x} ${y}`;
  const back = [...MASK_R].reverse();
  for (let i = 0; i < back.length; i++) {
    const [a, b, c, e] = back[i] as readonly number[];
    const end = back[i + 1];
    d += ` C${f(-(c as number))} ${e} ${f(-(a as number))} ${b} ${end ? `${f(-(end[4] as number))} ${end[5]}` : '0 -123.5'}`;
  }
  return `${d} Z ${ell(-29, -93, 8.6, 7.8)} ${ell(29, -93, 8.6, 7.8)}`;
}
/** the slices on the mask: [x, y, r, seed turn] — a forehead row, between the eyes, temples, under the eyes, the cheeks */
const SLICES: ReadonlyArray<readonly [number, number, number, number]> = [
  [-45, -113.4, 10.5, 10], [-27, -113.4, 10.5, 40], [-9, -113.4, 10.5, 25], [9, -113.4, 10.5, 5], [27, -113.4, 10.5, 30], [45, -113.4, 10.5, 15],
  [0, -103, 9, 20], [-13, -96, 5.5, 0], [13, -96, 5.5, 30],
  [-50, -100, 10, 30], [50, -100, 10, 0],
  [-50, -88, 7, 45], [50, -88, 7, 15],
  [-54, -74, 7, 0], [54, -74, 7, 35], [-40, -64, 6, 10], [40, -64, 6, 40],
  [-27, -69, 7, 20], [27, -69, 7, 50],
];

const spa: Costume = {
  id: 'spa',
  ru: 'Спа-день',
  de: 'Wellness',
  photos: [17],
  note: 'Переделан (2-й отзыв, 31.10): белой полосы на глазах больше нет — вместо неё настоящая огуречная маска: мягкий полупрозрачный светло-зелёный крем на лбу, вокруг глаз и на щёчках (нос, ротик и румянец открыты), а на нём много тонких полупрозрачных кружочков огурца, они заходят друг на друга, как чешуйки; глазки закрыты, отдыхает. Тюрбан переделан (3-й отзыв): белое махровое полотенце, обёрнутое вокруг головы слоями — нижний виток вокруг лба с голубой каёмкой полотенца, два витка поднимаются с боков и перекрещиваются спереди, там скрученный узелок, кончик с полосками подоткнут сверху; висячие ушки выходят из-под нижнего края.',
  who: ['pompon'],
  eyes: 'sleep',
  layers: () => [
    {
      slot: 'over',
      draw: () => g('cs-head', p(TOWEL, '#FFFFFF', true)
        // a soft shade on the right side of the dome
        + p('M40 -193 C60 -183 74 -162 70 -140 C66 -137 63 -136 62 -134 C70 -150 66 -172 40 -193 Z', '#EEF2F5')
        // the wrap round the forehead with the towel's hem: one wide and one thin blue stripe along its edge
        + p(WRAP_LOW, '#FFFFFF', true)
        + stroke('M-66 -139.4 C-44 -147.4 -20 -150.4 0 -150.4 C20 -150.4 44 -147.4 66 -139.4', HEM, 2.8)
        + stroke('M-67.6 -144.4 C-44 -152.6 -20 -155.4 0 -155.4 C20 -155.4 44 -152.6 67.6 -144.4', HEM, 1.2)
        // the wrap from the right (its shadow on the layer under it first), then the one from the left over it
        + stroke('M70 -150 C52 -160 30 -172 8 -184', TOWEL_SH, 3) + p(WRAP_R, '#FFFFFF', true)
        + stroke('M-69 -146.6 C-48 -154.6 -22 -164.6 10 -174.6', TOWEL_SH, 3) + p(WRAP_L, '#FFFFFF', true)
        // terry loops: a few tiny soft arcs
        + stroke([[-50, -159], [-30, -170], [-46, -174], [36, -168], [52, -165], [24, -184], [-12, -200], [44, -189], [-40, -186]].map(([x, y]) => `M${x} ${y} Q${f((x as number) + 1.6)} ${f((y as number) + 2)} ${f((x as number) + 3.2)} ${y}`).join(' '), '#E2E9EF', 1.2)
        // the folded end with its stripes, tucked out from under the knot; the knot: a soft rolled twist
        + p(TUCK, '#FFFFFF', true) + stroke('M26.6 -206 C32 -209.6 40 -210.4 44.4 -206.4', HEM, 2.4) + stroke('M24.4 -201.8 C30 -205.4 38 -206.2 42 -203', HEM, 1.1)
        + p(ell(10, -180, 13, 4), '#E3EAF0', false, 'opacity=".9"')
        + p(ell(8, -189, 15, 11.5, -12), '#FFFFFF', true)
        + stroke('M0 -190 C1 -196 11 -198 15 -192 C18 -187 12 -182 6 -184 C2 -185 2 -190 6 -191', '#D5DFE7', 1.8)),
    },
    {
      slot: 'face',
      draw: () => p(faceMask(), '#CDE7AC', false, 'fill-rule="evenodd" opacity=".74" stroke="#AED38A" stroke-width="1.1"')
        + SLICES.map(([x, y, r, t]) => slice(x, y, r, t)).join('')
        + p(`${ell(-43, -77, 9, 5.5)} ${ell(43, -77, 9, 5.5)}`, 'var(--mascot-blush)', false, 'opacity=".38"'),
    },
  ],
};

// ---- 15 · Laptop (photo 7) — 31.10 v3 in its own file: laptop.ts (turned laptop, three compositions, typing) ---------
// v2 (the big lid he peeked over, Felix: «будто за чемоданом сидит») lives on there as the composition `old`.

// ---- the list ------------------------------------------------------------------------------------------------

export const COSTUMES: Readonly<Record<CostumeId, Costume>> = {
  sport, groom, bride, pancake, knight, bandana, headphones: phones, lily, noodles, samurai, reading, strawberry, bunnyhood, sunglasses, spa, shark, laptop,
};

/** In the gallery's order: the photo order, the wedding pair together. */
export const COSTUME_IDS: readonly CostumeId[] = ['sport', 'groom', 'bride', 'pancake', 'knight', 'bandana', 'laptop', 'headphones', 'lily', 'noodles', 'samurai', 'reading', 'strawberry', 'bunnyhood', 'sunglasses', 'spa', 'shark'];

/** The 18 photos (numbers used in the doc) and what became of each. */
export const PHOTOS: ReadonlyArray<{ n: number; file: string; what: string; to: CostumeId | 'bunny' }> = [
  { n: 1, file: '18eaea57e9b0f74d5ecbc5298a5b232a.jpg', what: 'селфи в спортзале, майка', to: 'sport' },
  { n: 2, file: '30fe649fd25529b32e418b6722bd5c2e.jpg', what: 'белый карлик рядом с гантелью', to: 'sport' },
  { n: 3, file: '4a7a77b67873b424e2975ba3e0730b24.jpg', what: 'свадьба: смокинг + фата и букет', to: 'groom' },
  { n: 4, file: '5683975c231a305bc44030ab71d2d876.jpg', what: 'блинчик на голове', to: 'pancake' },
  { n: 5, file: '8f7d7e65d6f5592d8fa4cc3836eae744.jpg', what: 'котёнок-рыцарь с мечом и плащом', to: 'knight' },
  { n: 6, file: 'a4433fd63ab9517b5ca47239b7fa69ce.jpg', what: 'розовая бандана с бантом, язычок', to: 'bandana' },
  { n: 7, file: 'a455bd5d30658c3b18e17343a44cda05.jpg', what: 'за ноутбуком', to: 'laptop' },
  { n: 8, file: 'b00fab9279ada4f36cdc0de95492ae63.jpg', what: 'вислоухий в наушниках', to: 'headphones' },
  { n: 9, file: 'b01c105d9f837b524397ac1a05c7d6e8.jpg', what: 'лилия-шляпка', to: 'lily' },
  { n: 10, file: 'bba5c952372c8c8b8049bb7f32f7c56f.jpg', what: 'в стаканчике лапши', to: 'noodles' },
  { n: 11, file: 'c1a72bf99143df2b5cf2f1aceae2e3de.jpg', what: 'львиноголовый: каса, меч, травинка', to: 'samurai' },
  { n: 12, file: 'c2398d48ce675ef9f62bf6c63c029161.jpg', what: 'карлик в смокинге', to: 'groom' },
  { n: 13, file: 'ea2f5ed54ec586272679832525390c9a.jpg', what: 'круглые очки, книга', to: 'reading' },
  { n: 14, file: 'f181a08fc75954a0f18fbb0a109586b2.jpg', what: 'нюхает клубнику', to: 'strawberry' },
  { n: 15, file: 'f33bb2e970d4dbb99be931921fb0e706.jpg', what: 'худи с ушками', to: 'bunnyhood' },
  { n: 16, file: 'fc9af6d9add8e8c5a80ba7dbfd21aab5.jpg', what: 'большие солнечные очки', to: 'sunglasses' },
  { n: 17, file: 'fea6c8b7d26433f04d7984fd0b101550.jpg', what: 'маска из огурцов', to: 'spa' },
  { n: 18, file: 'feed4f274f1c435dd4e6ca492319450b.jpg', what: 'акулье худи', to: 'shark' },
];
