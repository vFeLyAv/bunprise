/**
 * The approved costumes from Felix's photos (31.10; docs/design/2026-10-31-costumes-bunnies.md, Felix's reviews in
 * docs/handoffs/2026-10-30-feedback.md §16 «хорошо как есть», §24 «другие вроде норм», §27 the laptop: composition A).
 * Thirteen for Pompon: sport, groom (tuxedo), pancake, knight, bandana, lily, samurai, reading, bunny-ears hood,
 * sunglasses, shark hood, the laptop (./laptop.ts) and spa (approved last: «Спа отлично»). NOT here (not approved, or
 * not for the app): the noodle cup, the strawberry, the headphones, the bride (Mila), Tapsi's versions.
 *
 * The drawings are copied 1:1 from the gallery prototype (demo/costumes/costumes.ts — another agent still works on the
 * unapproved ones there; de-duplicating comes later). Every costume is our own flat drawing in the puppet's units, put
 * on through the slots of ./costume-rig.ts. No logos, no brand names, no text on anything.
 *
 * Anchors of the puppet (bunny): eyes (±29, -93); mouth bottom -75.6; front paws (±16, -44), they cover x ±6.5…±25.5,
 * y -56…-32; cheeks ±53…±77 down to y -63; lop ears hang from (±24, -160) to y -83 at x ±53…±75; head top -163.
 */

import { at, ell, f, flipX, mirror, poly, rrect, smooth, type Pt } from '../geometry';
import type { CostumeId } from './rules';
import { place } from './items';
import { dressLook, type Kind, type Layer, type Look } from './costume-rig';
import { laptopLook } from './laptop';

export interface Costume {
  id: CostumeId;
  /** Russian name (for Felix; the app's names come from its locales) */
  ru: string;
  /** German name */
  de: string;
  layers: (kind: Kind) => Layer[];
  hide?: Look['hide'];
  /** resting eyes while worn (spa: closed) */
  eyes?: Look['eyes'];
}

// ---- shared bits ----------------------------------------------------------------------------------------------

const O = 'class="cs-o"';
const EYE: Record<Kind, { x: number; y: number }> = { bunny: { x: 29, y: -93 }, hamster: { x: 32, y: -96 } };
/** Held props sit 2 units lower on a hamster (his paws are at -46). */
const PAW_DY: Record<Kind, number> = { bunny: 0, hamster: -2 };

const p = (d: string, fill: string, o = false, extra = '') => `<path ${o ? `${O} ` : ''}d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const stroke = (d: string, color: string, w: number, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra ? ` ${extra}` : ''}/>`;
const g = (cls: string, inner: string, extra = '') => `<g class="${cls}"${extra ? ` ${extra}` : ''}>${inner}</g>`;
const wob = (x: number, y: number, amp: number, inner: string) => `<g class="wr-wob" data-wob="${amp}" ${at(x, y)}>${inner}</g>`;
const clipped = (clip: string, inner: string) => `<g clip-path="${clip}">${inner}</g>`;
/** Moves every point of a drawing by dy (held props on a hamster). */
const dy = (d: string, by: number) => (by ? d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_m, a: string, b: string) => `${a} ${f(Number(b) + by)}`) : d);
/** A small five-petal flower (dots on fabric), radius r. */
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
  layers: (kind) => [
    { slot: 'body', draw: (c) => clipped(c.clip, g('cs-band', p(TANK, LAV) + p(TANK_HEM, LAV_D) + stroke(TANK_TRIM, '#FFFFFF', 3.4, 'opacity=".8"'))) },
    { slot: 'under-ears', draw: (c) => clipped(c.clip, g('cs-head', p(BAND, '#FFFDF7') + p(BAND_STRIPE, LAV))) },
    { slot: 'paws', draw: () => dumbbell(PAW_DY[kind]) },
  ],
};

// ---- 2 · The groom's tuxedo (photos 3, 12) -----------------------------------------------------------------------

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
  ru: 'Смокинг',
  de: 'Smoking',
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

// ---- 3 · Pancake on the head (photo 4) ---------------------------------------------------------------------------

const pancake: Costume = {
  id: 'pancake',
  ru: 'Блинчик на голове',
  de: 'Pfannkuchen',
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

// ---- 6 · Lily hat (photo 9) ------------------------------------------------------------------------------------

const PETAL = 'M0 -5 C12 -12 30 -13 44 -6 C49 -3 52 -6 55 -10 C55 -3 52 3 45 5 C32 9 14 8 0 5 Z';
const PETAL_VEIN = 'M3 -1 C16 -4 30 -4 42 -1 C30 1.6 16 2 3 1.4 Z';

const lily: Costume = {
  id: 'lily',
  ru: 'Шляпка-лилия',
  de: 'Lilienhut',
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

// ---- 7 · Samurai: straw kasa + wooden practice sword on the back + a blade of grass (photo 11) --------------------------

const KASA = 'M-92 -152 Q-50 -166 -6 -203 Q0 -208 6 -203 Q50 -166 92 -152 Q0 -132 -92 -152 Z';
const KASA_RIM = 'M-92 -152 Q0 -132 92 -152 L90 -147 Q0 -126 -90 -147 Z';

const samurai: Costume = {
  id: 'samurai',
  ru: 'Самурай',
  de: 'Samurai',
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

// ---- 8 · Reading: round glasses + a little book (photo 13) ----------------------------------------------------------

const reading: Costume = {
  id: 'reading',
  ru: 'Очки и книжка',
  de: 'Leseratte',
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

// ---- 9 · Hoods: bunny-ears hoodie (photo 15) and shark hoodie (photo 18) ----------------------------------------------
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

// ---- 10 · Sunglasses (photo 16) ---------------------------------------------------------------------------------

const sunglasses: Costume = {
  id: 'sunglasses',
  ru: 'Солнечные очки',
  de: 'Sonnenbrille',
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

// ---- 12 · Spa: a white terry towel turban with the blue hem stripe + a cucumber mask (photo 17) ----------------------
// Felix 31.10 after the 3rd round: «Спа отлично». The towel wrapped round the head in visible layers (the wrap round the
// forehead with the towel's blue hem stripe, two wraps crossing at the front, a rolled knot, the folded end tucked out
// from under it; the lop ears come out from UNDER its lower edge), and the mask: ONE soft see-through cream layer over
// forehead, round the eyes and the cheeks (nose, mouth and blush free) with many thin see-through cucumber slices on it.
// Eyes closed, relaxed (Look.eyes 'sleep').

const TOWEL = 'M-62 -134 C-75 -138 -77 -160 -64 -177 C-50 -195 -23 -203 2 -203 C28 -203 54 -193 66 -176 C77 -159 75 -138 62 -134 C42 -141 18 -143 0 -143 C-18 -143 -42 -141 -62 -134 Z';
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
/** the mask's right half as cubic segments; the face slot's box: |x| ≤ 62, y −124 … −56 */
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

// ---- 13 · The laptop «Im Homeoffice», composition A «Экраном к нему» (photo 7): ./laptop.ts ---------------------------

const laptop: Costume = {
  id: 'laptop',
  ru: 'За ноутбуком',
  de: 'Im Homeoffice',
  layers: () => [...laptopLook().layers],
  hide: laptopLook().hide,
};

// ---- the list ------------------------------------------------------------------------------------------------

export const COSTUMES: Readonly<Record<CostumeId, Costume>> = {
  sport, groom, pancake, knight, bandana, lily, samurai, reading, bunnyhood, sunglasses, shark, laptop, spa,
};

/** The look of a costume on a bunny (Pompon) — the laptop with its turn and the echoes of its twin paws. */
export function costumeLook(id: CostumeId, kind: Kind = 'bunny'): Look {
  if (id === 'laptop') return laptopLook();
  const c = COSTUMES[id];
  return { id, layers: c.layers(kind), ...(c.hide ? { hide: c.hide } : {}), ...(c.eyes ? { eyes: c.eyes } : {}) };
}

/**
 * Dresses the puppet in `root` in a costume (after taking off what it wore). The Lists buddy is carried and walks
 * about: there the laptop's desk (laptop, mug, his paws on the keys) is not drawn — he is away from his desk, his own
 * paws show (the gallery's rule for the stage actors). Returns the costume's containers.
 */
export function dressCostume(root: ShadowRoot, id: CostumeId): SVGGElement[] {
  const away = id === 'laptop' && (root.host as Element).classList.contains('bd-host');
  return dressLook(root, away ? { id, layers: [] } : costumeLook(id));
}
