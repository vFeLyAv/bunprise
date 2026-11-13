/**
 * Style samples for the comic (31.10, v3, GALLERY-ONLY; Felix 30.10: «мне не нравится стилизация локаций и как выглядят
 * комментарии»). ONE stretch of the story — Pompon at his burrow wall down to the hilltop where Mila hands Tapsi her
 * star, with two captions and one speech bubble — drawn in three LOCATION styles × three TEXT styles, so Felix can
 * pick one of each before the whole strip is redrawn:
 *
 *   A «Bilderbuch»   soft painted storybook: layered hills in haze, gentle gradients, moonlit rims, textured grass,
 *                     round wooden doors, a lantern at door 14, a fine paper grain;
 *   B «App-Pastell»  flat pastel like the app's own scene art: big simple shapes, flat soft shadows, crisp details,
 *                     the doors as calendar tiles;
 *   C «Manga-Nacht»  deep blue night: screen-tone dots, strong silhouettes with ink lines, light shafts, a focus
 *                     burst at door 14.
 *   1 «Manga»        white oval speech bubbles with a thin ink line and a pointed tail; narration in a small slanted box;
 *   2 «App»          soft cream cards without a hard border, narration in small caps, tails as soft triangles;
 *   3 «Im Bild»      narration as glowing lettering set into the picture; speech in small, light bubbles.
 *
 * The puppets are the same in every sample (the strip's helpers, strip.ts), still poses, no animation at all.
 */

import { Panel } from './kit';
import { T, type Lang, type PanelText } from './panels';
import { CAKE, rnd } from './props';
import { handover, holdCard, ink, mila, wishCan } from './strip';
import { halo, thought } from './strip-art';

export const SW = 390;
export const SH = 1000;

export type LocStyle = 'A' | 'B' | 'C';
export type TextStyle = 1 | 2 | 3;
export const LOC_STYLES: readonly LocStyle[] = ['A', 'B', 'C'];
export const TEXT_STYLES: readonly TextStyle[] = [1, 2, 3];

/** One line per style, in Russian for Felix (the page and the design note). */
export const STYLE_NAMES: Readonly<Record<LocStyle | `${TextStyle}`, string>> = {
  A: 'A · «книжка-картинка»: мягкая живопись, слои холмов в дымке, лунный свет по краям, фонарик у дверцы 14',
  B: 'B · «пастель как в приложении»: простые большие формы, плоские мягкие тени, дверцы — плитки календаря',
  C: 'C · «манга-ночь»: глубокая синяя ночь, точечный растр, силуэты с тушью, лучи света, вспышка у дверцы 14',
  1: '1 · «манга»: белые овальные пузыри с тонкой линией и острым хвостиком, подпись в маленькой косой рамке',
  2: '2 · «как в приложении»: мягкие кремовые карточки без жёсткой рамки, подпись капителью, мягкий хвостик',
  3: '3 · «в картинке»: подпись — светящиеся буквы прямо на картинке, реплика — маленький светлый пузырёк',
};

/** The sample's speech bubble: a line for Mila at the hand-over (a proposal; it also makes the hand-over clearer). */
export const SAMPLE_SAY: PanelText = { kind: 'реплика Милы (предложение)', de: 'Pass gut auf ihn auf, Tapsi!', ru: 'Береги его, Тапси!' };

export const SAMPLE_TEXTS: readonly PanelText[] = [T.p1, T.p2, SAMPLE_SAY];

const f1 = (v: number): string => v.toFixed(1);

// ---- the three text styles ------------------------------------------------------------------------------------------

export const STYLE_CSS = `
.sp3-sample { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.sp3-sample .cap, .sp3-sample .bub { position: absolute; z-index: 9; box-sizing: border-box; text-wrap: balance; }
.sp3-sample .bub { text-align: center; }

/* 1 · manga: oval bubble, thin ink line, pointed tail; narration in a small slanted box */
.tx1 .cap { background: #FFFFFF; color: #151515; border: 1.6px solid #151515; padding: 6px 11px 7px; transform: skewX(-9deg);
  box-shadow: 3px 3px 0 #151515; font-size: 14px; line-height: 1.25; font-weight: 750; letter-spacing: .005em; }
.tx1 .cap > span { display: block; transform: skewX(9deg); }
.tx1 .bub { background: #FFFFFF; color: #151515; border: 1.6px solid #151515; border-radius: 50%; padding: 15px 24px 16px;
  font-size: 15px; line-height: 1.2; font-weight: 750; }
.tx1 .bub::before, .tx1 .bub::after { content: ''; position: absolute; left: var(--tx, 30%); }
.tx1 .bub::before { top: calc(100% - 5px); width: 20px; height: 26px; background: #151515; clip-path: polygon(0 0, 100% 0, 14% 100%); }
.tx1 .bub::after { top: calc(100% - 7px); margin-left: 3.5px; width: 13px; height: 22px; background: #FFFFFF; clip-path: polygon(0 0, 100% 0, 6% 100%); }

/* 2 · soft app cards: no hard border, small caps narration, soft triangle tails */
.tx2 .cap { background: rgba(255,248,238,.95); color: #6A4526; border-radius: 16px; padding: 9px 14px 11px; box-shadow: 0 10px 26px rgba(0,0,0,.32);
  font-size: 15px; line-height: 1.3; font-weight: 650; font-variant-caps: all-small-caps; letter-spacing: .055em; }
.tx2 .bub { background: #FFF8EE; color: #3B2A1C; border-radius: 20px; padding: 10px 15px 11px; box-shadow: 0 10px 26px rgba(0,0,0,.32);
  font-size: 15px; line-height: 1.25; font-weight: 620; }
.tx2 .bub::after { content: ''; position: absolute; left: var(--tx, 30%); bottom: -7px; width: 16px; height: 16px; background: #FFF8EE;
  border-radius: 0 0 5px 0; transform: rotate(45deg); }

/* 3 · set into the picture: glowing lettering; speech in small light bubbles */
.tx3 .cap { color: #FFEBC6; font-size: 19px; line-height: 1.22; font-weight: 820; font-style: italic; letter-spacing: -.005em;
  -webkit-text-stroke: 5px rgba(28,18,12,.88); paint-order: stroke fill; text-shadow: 0 0 14px rgba(255,176,86,.6); }
.tx3 .cap::before { content: ''; display: block; width: 54px; height: 3px; border-radius: 2px; margin: 0 0 7px 2px;
  background: linear-gradient(90deg, #FFC46B, rgba(255,196,107,0)); box-shadow: 0 0 8px rgba(255,180,90,.7); }
.tx3 .bub { background: rgba(255,255,255,.96); color: #2A231C; border-radius: 13px; padding: 5px 10px 6px; box-shadow: 0 0 0 1.3px #2A231C, 0 0 14px rgba(255,214,150,.45);
  font-size: 13px; line-height: 1.2; font-weight: 720; }
.tx3 .bub::after { content: ''; position: absolute; left: var(--tx, 30%); bottom: -6px; width: 11px; height: 11px; background: rgba(255,255,255,.96);
  box-shadow: 1.3px 1.3px 0 0 #2A231C; transform: rotate(45deg); }
`;

// ---- shared layout (the same composition in every style) ----------------------------------------------------------

/** Door centres: seven to a row like a month in the calendar, four rows. */
const COLS = 7;
const doorAt = (day: number): { x: number; y: number } => {
  const i = day - 1;
  return { x: 28 + (i % COLS) * 55.6, y: 186 + Math.floor(i / COLS) * 57 };
};
const DOOR = { w: 36, h: 44 };
const MOUND = 'M-20 420 L-20 168 C-20 112 60 92 195 90 C330 92 410 112 410 168 L410 420 Z';
const MOUND_TOP = 'M-20 168 C-20 112 60 92 195 90 C330 92 410 112 410 168';
type P = readonly [number, number];
const cubic = (a: P, b: P, c: P, d: P, t: number): [number, number] => {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
};
/** Points along the mound's top (left half then right half), dense. */
const TOP_PTS: ReadonlyArray<[number, number]> = [
  ...Array.from({ length: 60 }, (_, i) => cubic([-20, 168], [-20, 112], [60, 92], [195, 90], i / 59)),
  ...Array.from({ length: 60 }, (_, i) => cubic([195, 90], [330, 92], [410, 112], [410, 168], i / 59)),
];
/** The mound's top height at x (world px). */
const topY = (x: number): number => {
  let best = TOP_PTS[0] ?? [0, 0];
  for (const p of TOP_PTS) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
  return best[1];
};
const SUMMIT = 'M-10 944 C20 918 60 910 110 908 C180 904 250 904 300 907 C345 910 375 928 400 952';
const PATH_D = 'M292 912 C330 930 346 960 330 1006';

/** An arch-topped door shape (x, y = centre). */
const arch = (x: number, y: number, w = DOOR.w, h = DOOR.h): string => {
  const r = w / 2;
  const top = y - h / 2 + r;
  return `M${f1(x - r)} ${f1(y + h / 2)} V${f1(top)} A${f1(r)} ${f1(r)} 0 0 1 ${f1(x + r)} ${f1(top)} V${f1(y + h / 2)} Z`;
};

const at = (x: number, y: number, inner: string, extra = ''): string => `<g transform="translate(${f1(x)} ${f1(y)})${extra}">${inner}</g>`;

/** A four-point star. */
const four = (r: number, k = 0.16): string => `M0 ${-r} Q${f1(r * k)} ${f1(-r * k)} ${r} 0 Q${f1(r * k)} ${f1(r * k)} 0 ${r} Q${f1(-r * k)} ${f1(r * k)} ${-r} 0 Q${f1(-r * k)} ${f1(-r * k)} 0 ${-r} Z`;

const WISHES: ReadonlyArray<readonly [number, number, number]> = [[42, 548, 4.5], [356, 586, 6], [214, 616, 3.5], [96, 664, 6.5], [300, 676, 4], [178, 740, 5], [362, 760, 3.5], [30, 790, 4]];

// ---- A · painted storybook ------------------------------------------------------------------------------------------

function tuftA(x: number, y: number, k: number, seed: number, dark = '#3C5530', light = '#6E8F4A'): string {
  return Array.from({ length: 5 }, (_, i) => {
    const a = -0.9 + i * 0.45 + (rnd(i, seed) - 0.5) * 0.25;
    const h = (10 + rnd(i, seed + 1) * 9) * k;
    const bx = x + (i - 2) * 2.2 * k;
    const tx = bx + Math.sin(a) * h;
    const ty = y - Math.cos(a) * h;
    const w = 1.8 * k;
    return `<path d="M${f1(bx - w)} ${f1(y)} Q${f1(bx + Math.sin(a) * h * 0.5 - w * 0.4)} ${f1(y - h * 0.55)} ${f1(tx)} ${f1(ty)} Q${f1(bx + Math.sin(a) * h * 0.5 + w * 0.4)} ${f1(y - h * 0.5)} ${f1(bx + w)} ${f1(y)} Z" fill="${i % 2 ? light : dark}"/>`;
  }).join('');
}

function doorA(day: number, lit: boolean): string {
  const { x, y } = doorAt(day);
  const j = (rnd(day, 3) - 0.5) * 3;
  const w = DOOR.w * (0.94 + rnd(day, 5) * 0.1);
  const h = DOOR.h * (0.94 + rnd(day, 7) * 0.1);
  const frame = arch(x, y, w + 7, h + 6);
  const leaf = arch(x, y + 2, w, h);
  const planks = [-0.25, 0.05, 0.35].map((k) => `<path d="M${f1(x + w * k)} ${f1(y - h * 0.3)} V${f1(y + h / 2 + 1)}" stroke="rgba(60,36,20,.35)" stroke-width="1"/>`).join('');
  const plate = `<ellipse cx="${f1(x)}" cy="${f1(y - h / 2 - 9)}" rx="9" ry="6" fill="#EADBC0" stroke="#7A5E48" stroke-width="1"/>
    <text x="${f1(x)}" y="${f1(y - h / 2 - 5.6)}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#5A3E2C" font-family="system-ui, sans-serif">${day}</text>`;
  if (lit) {
    return `<g transform="rotate(${f1(j)} ${f1(x)} ${f1(y)})"><path d="${frame}" fill="#8A6A50"/><path d="${leaf}" fill="url(#sa-lit)"/>
      <circle cx="${f1(x + w * 0.3)}" cy="${f1(y + 4)}" r="1.6" fill="#8A4E1C"/>${plate}</g>`;
  }
  return `<g transform="rotate(${f1(j)} ${f1(x)} ${f1(y)})"><path d="${frame}" fill="#7A5E48"/><path d="${leaf}" fill="url(#sa-wood)"/>${planks}
    <circle cx="${f1(x + w * 0.3)}" cy="${f1(y + 4)}" r="1.6" fill="#E8C27A"/>
    ${[3, 9, 16, 20, 26].includes(day) ? `<path d="M${f1(x - w / 2 + 2)} ${f1(y - h / 2 + w / 2 - 2)} q${f1(w * 0.3)} -6 ${f1(w * 0.55)} -6" fill="none" stroke="#5C7A3E" stroke-width="2.4" stroke-linecap="round"/>` : ''}${plate}</g>`;
}

function locA(): string {
  const stars = Array.from({ length: 46 }, (_, i) => `<circle cx="${f1(rnd(i, 11) * SW)}" cy="${f1(rnd(i, 13) * 860)}" r="${(0.6 + rnd(i, 15)).toFixed(2)}" fill="#F6E7C8" opacity="${(0.25 + rnd(i, 17) * 0.5).toFixed(2)}"/>`).join('');
  const d14 = doorAt(14);
  const stones = [[8, 392, 9, 6], [150, 400, 7, 5], [302, 396, 8, 5.5], [384, 394, 6, 4], [244, 398, 5, 3.5]]
    .map(([x = 0, y = 0, rx = 0, ry = 0]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#6B5040"/><ellipse cx="${x - rx * 0.25}" cy="${y - ry * 0.35}" rx="${f1(rx * 0.5)}" ry="${f1(ry * 0.35)}" fill="#8C6E58" opacity=".7"/>`).join('');
  const capTufts = Array.from({ length: 16 }, (_, i) => {
    const x = -10 + i * 27;
    return tuftA(x, topY(x) - 4, 0.9, i + 20, '#3F5A30', '#7A9A52');
  }).join('');
  const groundTufts = Array.from({ length: 14 }, (_, i) => tuftA(8 + i * 29 + rnd(i, 31) * 10, 420 + rnd(i, 33) * 8, 1, i + 40)).join('');
  const near = Array.from({ length: 12 }, (_, i) => tuftA(14 + i * 34 + rnd(i, 51) * 8, 912 + Math.abs(i - 5.5) * 3.4 + (i > 8 ? (i - 8) * 6 : 0), 0.9, i + 60, '#3F5A30', '#86A65A')).join('');
  const wishes = WISHES.map(([x, y, r], i) => at(x, y, `<circle r="${f1(r * 3.2)}" fill="url(#sa-wish)"/><path d="${four(r * 1.15, 0.3)}" fill="#FFE2A0"/><circle r="${f1(r * 0.35)}" fill="#FFF6DE"/>`, ` rotate(${i * 9})`)).join('');
  return `<defs>
      <linearGradient id="sa-sky" x1="0" y1="0" x2="0" y2="${SH}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1B1730"/><stop offset=".4" stop-color="#262040"/><stop offset=".62" stop-color="#2F2647"/><stop offset=".86" stop-color="#43324D"/><stop offset="1" stop-color="#3A2C44"/></linearGradient>
      <radialGradient id="sa-moon"><stop offset="0" stop-color="rgba(255,236,200,.34)"/><stop offset=".45" stop-color="rgba(255,226,180,.12)"/><stop offset="1" stop-color="rgba(255,226,180,0)"/></radialGradient>
      <radialGradient id="sa-cloud"><stop offset="0" stop-color="rgba(190,170,235,.16)"/><stop offset="1" stop-color="rgba(190,170,235,0)"/></radialGradient>
      <linearGradient id="sa-earth" x1="0" y1="104" x2="0" y2="412" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#644530"/><stop offset=".55" stop-color="#4E3526"/><stop offset="1" stop-color="#36251B"/></linearGradient>
      <linearGradient id="sa-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B07B4C"/><stop offset="1" stop-color="#83552F"/></linearGradient>
      <radialGradient id="sa-lit" cx=".5" cy=".6" r=".7"><stop offset="0" stop-color="#FFF1C2"/><stop offset=".6" stop-color="#FFC970"/><stop offset="1" stop-color="#E99A45"/></radialGradient>
      <radialGradient id="sa-doorglow"><stop offset="0" stop-color="rgba(255,206,120,.55)"/><stop offset="1" stop-color="rgba(255,206,120,0)"/></radialGradient>
      <linearGradient id="sa-ground" x1="0" y1="396" x2="0" y2="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#506B3A"/><stop offset=".55" stop-color="#3B5130"/><stop offset="1" stop-color="#2F2647" stop-opacity="0"/></linearGradient>
      <linearGradient id="sa-mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(205,190,235,0)"/><stop offset=".5" stop-color="rgba(205,190,235,.16)"/><stop offset="1" stop-color="rgba(205,190,235,0)"/></linearGradient>
      <radialGradient id="sa-wish"><stop offset="0" stop-color="rgba(255,214,130,.42)"/><stop offset="1" stop-color="rgba(255,214,130,0)"/></radialGradient>
      <linearGradient id="sa-hill" x1="0" y1="900" x2="0" y2="${SH}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#55703C"/><stop offset="1" stop-color="#34492A"/></linearGradient>
      <filter id="sa-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .42  0 0 0 0 .34  0 0 0 .09 0"/></filter>
    </defs>
    <rect width="${SW}" height="${SH}" fill="url(#sa-sky)"/>${stars}
    <ellipse cx="96" cy="74" rx="120" ry="26" fill="url(#sa-cloud)"/><ellipse cx="270" cy="130" rx="140" ry="24" fill="url(#sa-cloud)"/>
    <circle cx="326" cy="58" r="120" fill="url(#sa-moon)"/><circle cx="326" cy="58" r="23" fill="#F8EBCF"/><circle cx="318" cy="53" r="4" fill="#EBD8B4" opacity=".7"/><circle cx="333" cy="66" r="2.6" fill="#EBD8B4" opacity=".6"/>
    <path d="${MOUND}" fill="url(#sa-earth)"/>
    <path d="M2 300 C20 320 24 360 18 404 M386 290 C372 330 388 370 380 404 M180 392 C200 380 230 384 246 400" fill="none" stroke="#2C1D14" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>
    ${stones}
    <circle cx="${d14.x}" cy="${d14.y}" r="64" fill="url(#sa-doorglow)"/>
    ${Array.from({ length: 28 }, (_, i) => doorA(i + 1, i + 1 === 14)).join('')}
    ${at(d14.x - 30, d14.y - 18, `<path d="M0 -14 V-6" stroke="#2C1D14" stroke-width="1.4"/><circle r="14" fill="url(#sa-doorglow)"/><rect x="-5" y="-6" width="10" height="13" rx="3" fill="#FFD58A" stroke="#3A2A20" stroke-width="1.6"/><path d="M-6 -6 h12 M-4 7 h8" stroke="#3A2A20" stroke-width="2" stroke-linecap="round"/>`)}
    <path d="${MOUND_TOP}" fill="none" stroke="#4A6634" stroke-width="20" stroke-linecap="round"/>
    <path d="${MOUND_TOP}" fill="none" stroke="#FFE2AE" stroke-width="2.2" opacity=".42" transform="translate(0 -9)"/>${capTufts}
    <path d="M-10 404 C100 394 280 408 400 398 L400 540 L-10 540 Z" fill="url(#sa-ground)"/>
    <path d="M-10 404 C100 394 280 408 400 398" fill="none" stroke="#FFE2AE" stroke-width="1.6" opacity=".25"/>${groundTufts}
    <rect x="-10" y="470" width="${SW + 20}" height="120" fill="url(#sa-mist)"/>
    <ellipse cx="110" cy="520" rx="160" ry="22" fill="url(#sa-cloud)"/><ellipse cx="300" cy="548" rx="150" ry="18" fill="url(#sa-cloud)"/>
    ${wishes}
    <path d="M-10 868 C70 826 160 836 240 816 C310 800 360 818 400 806 L400 ${SH} L-10 ${SH} Z" fill="#45395A"/>
    <path d="M-10 868 C70 826 160 836 240 816 C310 800 360 818 400 806" fill="none" stroke="#FFE2AE" stroke-width="1.4" opacity=".18"/>
    <path d="M-10 902 C60 874 140 880 210 866 C270 856 330 874 400 862 L400 ${SH} L-10 ${SH} Z" fill="#36463A"/>
    <rect x="-10" y="850" width="${SW + 20}" height="60" fill="url(#sa-mist)"/>
    <path d="${SUMMIT} L400 ${SH} L-10 ${SH} Z" fill="url(#sa-hill)"/>
    <path d="${PATH_D}" fill="none" stroke="#7A8752" stroke-width="16" stroke-linecap="round" opacity=".8"/>
    <path d="${SUMMIT}" fill="none" stroke="#FFE2AE" stroke-width="2.4" opacity=".45"/>${near}
    <rect width="${SW}" height="${SH}" filter="url(#sa-grain)"/>`;
}

// ---- B · flat pastel ("cozy app") ----------------------------------------------------------------------------------

function doorB(day: number, lit: boolean): string {
  const { x, y } = doorAt(day);
  const d = arch(x, y);
  if (lit) {
    return `<circle cx="${x}" cy="${y}" r="34" fill="#F0A04B" opacity=".22"/><path d="${d}" fill="#C77A2E" transform="translate(0 3)"/><path d="${d}" fill="#F0A04B"/>
      <text x="${x}" y="${f1(y - 6)}" text-anchor="middle" font-size="11" font-weight="800" fill="#FFF6E6" font-family="system-ui, sans-serif">${day}</text>`;
  }
  return `<path d="${d}" fill="#A86F4C" transform="translate(0 3)"/><path d="${d}" fill="#FFF1DF"/>
    <text x="${x}" y="${f1(y - 6)}" text-anchor="middle" font-size="11" font-weight="800" fill="#B5683A" font-family="system-ui, sans-serif">${day}</text>
    <circle cx="${f1(x + 9)}" cy="${f1(y + 9)}" r="2" fill="#E3B68E"/>`;
}

function locB(): string {
  const stars = WISHES.map(([x, y, r], i) => at(x, y, `<path d="${four(r * 1.5, 0.28)}" fill="#FFE6A8" stroke="#FFE6A8" stroke-width="${f1(r * 0.5)}" stroke-linejoin="round"/>`, ` rotate(${i % 2 ? 0 : 45})`)).join('');
  const dots = Array.from({ length: 26 }, (_, i) => `<circle cx="${f1(rnd(i, 21) * SW)}" cy="${f1(rnd(i, 23) * 820)}" r="${(1 + rnd(i, 25) * 0.8).toFixed(1)}" fill="#FFF1D6" opacity=".55"/>`).join('');
  const flower = (x: number, y: number, c: string) => at(x, y, `${[0, 72, 144, 216, 288].map((a) => `<circle cx="${f1(Math.cos((a * Math.PI) / 180) * 4)}" cy="${f1(Math.sin((a * Math.PI) / 180) * 4)}" r="3.2" fill="${c}"/>`).join('')}<circle r="2.4" fill="#FFE08A"/>`);
  const trail = Array.from({ length: 9 }, (_, i) => {
    const k = i / 8;
    return `<circle cx="${f1(70 + 120 * k + Math.sin(k * 3) * 40)}" cy="${f1(520 + k * 300)}" r="${f1(2.6 - k)}" fill="#FFE6A8" opacity="${f1(0.85 - k * 0.4)}"/>`;
  }).join('');
  return `<defs><linearGradient id="sb-sky" x1="0" y1="0" x2="0" y2="${SH}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2C2853"/><stop offset=".5" stop-color="#3A3368"/><stop offset="1" stop-color="#4D4178"/></linearGradient></defs>
    <rect width="${SW}" height="${SH}" fill="url(#sb-sky)"/>${dots}
    <circle cx="326" cy="58" r="46" fill="#FFF1D6" opacity=".07"/><circle cx="326" cy="58" r="34" fill="#FFF1D6" opacity=".12"/><circle cx="326" cy="58" r="23" fill="#FFF1D6"/>
    <rect x="18" y="110" width="128" height="26" rx="13" fill="#463E7C"/><rect x="258" y="138" width="112" height="22" rx="11" fill="#463E7C"/>
    <path d="${MOUND}" fill="#C98E66"/>
    <path d="M-20 420 L-20 170 C-6 160 6 160 12 170 C6 260 8 360 30 420 Z M410 420 L410 170 C396 160 384 160 378 170 C384 260 382 360 360 420 Z" fill="#B47B57"/>
    <path d="M-20 380 C100 392 290 392 410 380 L410 420 L-20 420 Z" fill="#B47B57"/>
    ${Array.from({ length: 28 }, (_, i) => doorB(i + 1, i + 1 === 14)).join('')}
    <path d="${MOUND_TOP}" fill="none" stroke="#7CB58A" stroke-width="22" stroke-linecap="round"/>
    <path d="${MOUND_TOP}" fill="none" stroke="#95CBA0" stroke-width="6" stroke-linecap="round" transform="translate(0 -6)"/>
    <ellipse cx="195" cy="418" rx="230" ry="16" fill="#3D3466" opacity=".5"/>
    <path d="M-10 404 C100 396 280 408 400 398 L400 478 C300 492 100 486 -10 480 Z" fill="#6FA57E"/>
    <path d="M-10 480 C100 486 300 492 400 478 L400 490 C300 504 100 498 -10 492 Z" fill="#2E2858" opacity=".45"/>
    <path d="M-10 452 C30 430 70 432 92 452 Z M300 450 C320 428 370 426 400 446 L400 452 Z" fill="#5E9470"/>
    ${flower(250, 438, '#FF8FA3')}${flower(282, 452, '#FFF1D6')}${flower(30, 466, '#FF8FA3')}
    ${stars}${trail}
    <path d="M-10 892 C80 846 180 852 260 836 C330 824 370 838 400 834 L400 ${SH} L-10 ${SH} Z" fill="#5C8F74"/>
    <path d="${SUMMIT} L400 ${SH} L-10 ${SH} Z" fill="#7CB58A"/>
    <path d="M300 907 C345 910 375 928 400 952 L400 ${SH} L330 ${SH} C350 960 340 930 300 907 Z" fill="#689E77"/>
    <path d="M-10 944 C20 918 60 910 110 908 C80 916 40 930 20 ${SH} L-10 ${SH} Z" fill="#8DC69B"/>
    <path d="${PATH_D}" fill="none" stroke="#A6D1A3" stroke-width="18" stroke-linecap="round"/>
    ${flower(40, 960, '#FF8FA3')}${flower(196, 968, '#FFF1D6')}${flower(360, 978, '#FF8FA3')}`;
}

// ---- C · manga night ----------------------------------------------------------------------------------------------

function doorC(day: number, lit: boolean): string {
  const { x, y } = doorAt(day);
  const d = arch(x, y);
  if (lit) {
    const burst = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      const r0 = 28 + rnd(i, 61) * 6;
      const r1 = 54 + rnd(i, 63) * 22;
      return `<path d="M${f1(x + Math.cos(a) * r0)} ${f1(y + Math.sin(a) * r0)} L${f1(x + Math.cos(a) * r1)} ${f1(y + Math.sin(a) * r1)}" stroke="#E9F0FF" stroke-width="${(0.8 + rnd(i, 65) * 1.2).toFixed(1)}" opacity=".55"/>`;
    }).join('');
    return `${burst}<path d="${d}" fill="#FFF3C9" stroke="#05070F" stroke-width="2"/>
      <text x="${x}" y="${f1(y - DOOR.h / 2 - 5)}" text-anchor="middle" font-size="10" font-weight="900" fill="#FFF3C9" font-family="system-ui, sans-serif">${day}</text>`;
  }
  return `<path d="${d}" fill="#131B37" stroke="#8FA8DD" stroke-width="1.5"/><path d="${d}" fill="url(#sc-hatch)"/>
    <path d="M${x} ${f1(y - DOOR.h / 2 + 4)} V${f1(y + DOOR.h / 2)}" stroke="#8FA8DD" stroke-width=".9" opacity=".7"/><circle cx="${f1(x + 7)}" cy="${f1(y + 6)}" r="1.8" fill="#FFE59A"/>
    <text x="${x}" y="${f1(y - DOOR.h / 2 - 5)}" text-anchor="middle" font-size="10" font-weight="800" fill="#8FA8DD" font-family="system-ui, sans-serif">${day}</text>`;
}

/** A spiky grass silhouette along y (manga). */
function spikes(x0: number, x1: number, y: (x: number) => number, h: number, seed: number): string {
  const pts: string[] = [];
  const back: string[] = [];
  for (let x = x0, i = 0; x <= x1; x += 7, i++) {
    pts.push(`${f1(x)} ${f1(y(x))}`, `${f1(x + 3.5)} ${f1(y(x + 3.5) - h * (0.5 + rnd(i, seed)))}`);
    back.unshift(`${f1(x)} ${f1(y(x) + 5)}`);
  }
  return `<path d="M${pts.join(' L')} L${f1(x1)} ${f1(y(x1))} L${f1(x1)} ${f1(y(x1) + 5)} L${back.join(' L')} Z" fill="#05070F"/>`;
}

function locC(): string {
  const stars = Array.from({ length: 30 }, (_, i) => {
    const x = rnd(i, 41) * SW;
    const y = rnd(i, 43) * 860;
    const r = 1.5 + rnd(i, 45) * 4;
    return r > 4 ? at(x, y, `<path d="${four(r * 1.6, 0.08)}" fill="#F2F6FF"/>`) : `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.35)}" fill="#DDE6FF" opacity=".8"/>`;
  }).join('');
  const shafts = [[-10, 0.1], [12, 0.07], [30, 0.09], [52, 0.05]].map(([a = 0, o = 0]) => {
    const r = (deg: number) => (deg * Math.PI) / 180;
    const len = 1100;
    const p = (deg: number) => `${f1(322 + Math.cos(r(deg + 120)) * len)} ${f1(70 + Math.sin(r(deg + 120)) * len)}`;
    return `<path d="M322 70 L${p(a - 2.2)} L${p(a + 2.2)} Z" fill="url(#sc-shaft)" opacity="${o * 6}"/>`;
  }).join('');
  const wishes = WISHES.map(([x, y, r]) => at(x, y, `<circle r="${f1(r * 2.6)}" fill="url(#sc-wish)"/><path d="${four(r * 1.4, 0.12)}" fill="#FFE59A"/><path d="${four(r * 0.7, 0.12)}" fill="#FFFFFF" transform="rotate(45)"/>`)).join('');
  const groundY = (x: number) => 404 + Math.sin(x / 60) * 3;
  const summitY = (x: number) => (x < 110 ? 944 - (x + 10) * 0.3 : x < 300 ? 908 : 908 + (x - 300) * 0.42);
  return `<defs>
      <linearGradient id="sc-sky" x1="0" y1="0" x2="0" y2="${SH}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#091228"/><stop offset=".45" stop-color="#12224A"/><stop offset=".9" stop-color="#1C3266"/><stop offset="1" stop-color="#16264F"/></linearGradient>
      <pattern id="sc-dot1" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r=".8" fill="#6F8FD8"/></pattern>
      <pattern id="sc-dot2" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.4" fill="#6F8FD8"/></pattern>
      <pattern id="sc-dot3" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#6F8FD8"/></pattern>
      <pattern id="sc-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0 V5" stroke="#2A3A6E" stroke-width="1"/></pattern>
      <linearGradient id="sc-shaft" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(235,242,255,.5)"/><stop offset="1" stop-color="rgba(235,242,255,0)"/></linearGradient>
      <radialGradient id="sc-wish"><stop offset="0" stop-color="rgba(255,226,140,.45)"/><stop offset="1" stop-color="rgba(255,226,140,0)"/></radialGradient>
      <linearGradient id="sc-spot" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(220,232,255,.16)"/><stop offset="1" stop-color="rgba(220,232,255,0)"/></linearGradient>
    </defs>
    <rect width="${SW}" height="${SH}" fill="url(#sc-sky)"/>
    <rect y="40" width="${SW}" height="36" fill="url(#sc-dot1)" opacity=".18"/>
    ${shafts}${stars}
    <circle cx="322" cy="70" r="38" fill="none" stroke="#F2F6FF" stroke-width="1" opacity=".45"/><circle cx="322" cy="70" r="30" fill="#F4F7FF"/><path d="M334 48 A30 30 0 0 1 334 92 A24 24 0 0 0 334 48 Z" fill="#C9D6F2" opacity=".55"/>
    <path d="${MOUND}" fill="#0C1226" stroke="#03050C" stroke-width="2.4"/>
    <path d="M-20 420 L-20 300 C40 330 160 340 195 342 C230 340 350 330 410 300 L410 420 Z" fill="url(#sc-dot2)" opacity=".3"/>
    ${Array.from({ length: 28 }, (_, i) => doorC(i + 1, i + 1 === 14)).join('')}
    <path d="${MOUND_TOP}" fill="none" stroke="#B9CCF5" stroke-width="1.8" transform="translate(0 -1)"/>
    ${spikes(-10, 400, (x) => topY(x) - 1, 9, 71)}
    <path d="M-10 ${f1(groundY(-10))} ${Array.from({ length: 42 }, (_, i) => `L${f1(i * 10)} ${f1(groundY(i * 10))}`).join(' ')} L400 520 L-10 520 Z" fill="#0E1530"/>
    <path d="M-10 404 L400 404 L400 520 L-10 520 Z" fill="url(#sc-dot1)" opacity=".25"/>
    ${spikes(-10, 400, groundY, 12, 73)}
    <rect y="520" width="${SW}" height="14" fill="url(#sc-dot3)" opacity=".35"/><rect y="534" width="${SW}" height="16" fill="url(#sc-dot2)" opacity=".3"/><rect y="550" width="${SW}" height="18" fill="url(#sc-dot1)" opacity=".25"/>
    <path d="M-10 520 L400 520 L400 524 L-10 524 Z" fill="#05070F"/>
    ${wishes}
    <rect y="790" width="${SW}" height="20" fill="url(#sc-dot1)" opacity=".22"/><rect y="810" width="${SW}" height="22" fill="url(#sc-dot2)" opacity=".26"/><rect y="832" width="${SW}" height="26" fill="url(#sc-dot3)" opacity=".3"/>
    <path d="M-10 870 C70 830 160 838 240 820 C310 806 360 822 400 812 L400 ${SH} L-10 ${SH} Z" fill="#101A3A" stroke="#03050C" stroke-width="2"/>
    <path d="M400 560 L40 ${SH} L380 ${SH} Z" fill="url(#sc-spot)"/>
    <path d="${SUMMIT} L400 ${SH} L-10 ${SH} Z" fill="#070B18" stroke="#03050C" stroke-width="2.4"/>
    <path d="${SUMMIT}" fill="none" stroke="#CFE0FF" stroke-width="2" transform="translate(0 -1)"/>
    ${spikes(-10, 400, (x) => summitY(x) + 2, 8, 77)}
    <path d="${PATH_D}" fill="none" stroke="url(#sc-dot2)" stroke-width="18" stroke-linecap="round" opacity=".7"/>`;
}

// ---- one sample -----------------------------------------------------------------------------------------------------

export interface Sample {
  world: Panel;
  destroy(): void;
}

/** One stretch in location style `loc` with text style `text`, in `lang`: a still picture SW × SH. */
export function buildSample(root: HTMLElement, loc: LocStyle, text: TextStyle, lang: Lang): Sample {
  const s = new Panel(root, { w: SW, h: SH });
  root.classList.add('sp3-sample', `loc${loc}`, `tx${text}`);
  root.dataset['style'] = `${loc}${text}`;
  s.layer(loc === 'A' ? locA() : loc === 'B' ? locB() : locC(), 0);
  // the same scene in every style: Pompon with the invitation and his thought, the hilltop hand-over
  const d14 = doorAt(14);
  s.prop(`<g transform="scale(.9)">${CAKE}</g>`, '-12 -12 24 24', d14.x, d14.y + 6, 24, 24, 2);
  const p = ink(s.actor('bunny', { x: 112, feetY: 452, size: 236, turn: 'r', label: `pompon-${loc}${text}` }));
  holdCard(s, p, `pompon-${loc}${text}`);
  s.prop(thought(-70, 60), '-64 -44 128 120', 278, 286, 128, 120, 8);
  const m = mila(s, 98, 912, 214, 'r');
  m.lift.set(0, { r: 8 });
  handover(m);
  const t = ink(s.actor('hamster', { x: 268, feetY: 908, size: 208, turn: 'l', puff: 1.15, eyes: 'star', z: 5, label: `tapsi-${loc}${text}` }));
  const u = t.unit;
  const give = { x: (186 - 268) / u, y: (876 - 908) / u };
  for (const g of [t.wear(halo(70, `smp${loc}${text}`, 0.34), 'back'), t.wear(wishCan(44), 'paws')]) g.setAttribute('transform', `translate(${f1(give.x)} ${f1(give.y)})`);
  t.part('.paw-l', { x: -64, y: -14, r: 52 });
  // the texts: two captions and Mila's line
  const say = (x: PanelText) => (lang === 'ru' ? x.ru : x.de);
  const cap = (x: PanelText, style: string) => {
    const e = s.node('', style, 'cap');
    // one sentence per line (the caption's two halves: «wann» / «was»)
    const span = document.createElement('span');
    say(x).split(/(?<=[.!?])\s+/).forEach((line, i) => {
      if (i) span.append(' ', document.createElement('br'));
      span.append(line);
    });
    e.append(span);
  };
  cap(T.p1, 'left:14px;top:16px;max-width:236px');
  cap(T.p2, `left:14px;top:${text === 3 ? 590 : 600}px;max-width:246px`);
  const bub = s.node('', `left:${text === 3 ? 44 : 26}px;top:${text === 1 ? 690 : text === 2 ? 718 : 742}px;max-width:${text === 3 ? 170 : 214}px;--tx:${text === 1 ? '30%' : '34%'}`, 'bub');
  bub.textContent = say(SAMPLE_SAY);
  s.still(0);
  return { world: s, destroy: () => s.destroy() };
}

