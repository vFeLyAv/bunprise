/**
 * The drawings of "Stöbern nach Thema" (ported from the approved gallery prototype, packages/mascot/demo/ideas/art.ts,
 * Felix 26.10): the topic tiles of the row, the header scene of the "Brettspiele" screen (its die, meeples and spark
 * move once when the screen opens, motion.ts) and the die + meeple the game animations share. Flat shapes in the gift
 * palette (gifts.css --gift-*, topics.css), the language of the app's own idea drawings (features/gifts/art). SVG
 * strings, inserted by the topic screen only; nothing is fetched.
 *
 * Animated parts are inner <g data-k="…"> WITHOUT a transform attribute: a CSS transform (Web Animations) on an SVG
 * element replaces its transform attribute, so every position lives on an outer group.
 */

import type { GiftTopic } from '../../../lib/api/giftIdeas';

const SPARK = (x: number, y: number, r: number, fill = 'var(--gift-butter-dark)') =>
  `<path d="M${x} ${y - r} C${x + r * 0.18} ${y - r * 0.18} ${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} C${x + r * 0.18} ${y + r * 0.18} ${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} C${x - r * 0.18} ${y + r * 0.18} ${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} C${x - r * 0.18} ${y - r * 0.18} ${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

const FLOOR = (cx: number, cy: number, rx: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${(rx * 0.16).toFixed(1)}" fill="var(--gift-shadow)"/>`;

/** A meeple in a 20 × 22 box, feet on y = 22. */
export const MEEPLE =
  'M10 1C12.8 1 14.5 3 14.5 5.4C14.5 6.9 13.8 8 12.9 8.7L19 10.6C20.4 11 20.5 13.2 19.1 13.7L15.2 14.9L17.6 20.4C18 21.3 17.4 22 16.5 22L11.9 22L10 18.2L8.1 22L3.5 22C2.6 22 2 21.3 2.4 20.4L4.8 14.9L0.9 13.7C-0.5 13.2 -0.4 11 1 10.6L7.1 8.7C6.2 8 5.5 6.9 5.5 5.4C5.5 3 7.2 1 10 1Z';

/** Pip centres of a 26-unit die, per face. */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[13, 13]],
  2: [[7.5, 7.5], [18.5, 18.5]],
  3: [[7.5, 7.5], [13, 13], [18.5, 18.5]],
  4: [[7.5, 7.5], [18.5, 7.5], [7.5, 18.5], [18.5, 18.5]],
  5: [[7.5, 7.5], [18.5, 7.5], [13, 13], [7.5, 18.5], [18.5, 18.5]],
  6: [[7.5, 7], [18.5, 7], [7.5, 13], [18.5, 13], [7.5, 19], [18.5, 19]],
};

/** A die (26 units). `faces`: every face as its own group (data-face), only `shown` visible — or one static face. */
export function die(shown: number, faces: readonly number[] = [shown]): string {
  const groups = faces
    .map((f) => `<g data-face="${f}"${f === shown ? '' : ' style="opacity:0"'}>${(PIPS[f] ?? []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--gift-charcoal)"/>`).join('')}</g>`)
    .join('');
  return `<rect x="0" y="0" width="26" height="26" rx="6.5" fill="var(--gift-die)"/><rect x="0" y="0" width="26" height="26" rx="6.5" fill="none" stroke="var(--gift-die-rim)" stroke-width="1.2"/><path d="M5 3.4H21" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>${groups}`;
}

function card(x: number, y: number, angle: number, symbol: string): string {
  return `<g transform="rotate(${angle} ${x + 18} ${y + 52})"><rect x="${x}" y="${y}" width="36" height="50" rx="5.5" fill="var(--gift-card)"/><rect x="${x}" y="${y}" width="36" height="50" rx="5.5" fill="none" stroke="var(--gift-card-rim)" stroke-width="1.1"/>${symbol}</g>`;
}

// ---------------------------------------------------------------------------------------------- category tiles

/** 120 × 90 drawings for the category tiles. */
export const CATEGORY_ART: Record<GiftTopic, string> = {
  brettspiele: `${FLOOR(60, 80, 44)}
    <g transform="translate(14 44) rotate(-8)"><rect width="64" height="34" rx="6" fill="var(--gift-wood-light)"/><rect x="4" y="4" width="56" height="26" rx="4" fill="var(--gift-cream)"/>
      <circle cx="12" cy="22" r="3.2" fill="var(--gift-clay)"/><circle cx="22" cy="17" r="3.2" fill="var(--gift-sky)"/><circle cx="32" cy="14" r="3.2" fill="var(--gift-butter-dark)"/><circle cx="42" cy="16" r="3.2" fill="var(--gift-leaf)"/><circle cx="51" cy="21" r="3.2" fill="var(--gift-rose)"/></g>
    <g transform="translate(34 26) scale(1.15)"><path d="${MEEPLE}" fill="var(--gift-clay)"/></g>
    <g transform="translate(76 18) rotate(10)">${card(0, 0, 0, `<path d="M18 16 L21 23 L28 24 L23 29 L24.5 36 L18 32.5 L11.5 36 L13 29 L8 24 L15 23 Z" fill="var(--gift-accent)"/>`)}</g>
    <g transform="translate(76 54) rotate(-14)">${die(5)}</g>
    ${SPARK(104, 14, 5)}`,
  buecher: `${FLOOR(60, 82, 42)}
    <rect x="22" y="62" width="74" height="15" rx="3" fill="var(--gift-sky-dark)"/><rect x="22" y="62" width="9" height="15" rx="2" fill="var(--gift-sky)"/>
    <rect x="28" y="48" width="66" height="14" rx="3" fill="var(--gift-clay)"/><rect x="28" y="52" width="66" height="3" fill="var(--gift-clay-dark)" opacity=".6"/>
    <rect x="18" y="34" width="70" height="14" rx="3" fill="var(--gift-leaf)"/><rect x="74" y="34" width="6" height="14" fill="var(--gift-cream)" opacity=".75"/>
    <path d="M38 34 C46 26 56 24 62 26 C68 24 78 26 86 34 Z" fill="var(--gift-cream)"/><path d="M62 26 V34" stroke="var(--gift-card-rim)" stroke-width="1.2"/>
    <path d="M70 26 V40 L73 37 L76 40 V26 Z" fill="var(--gift-rose-dark)"/>
    ${SPARK(100, 22, 4.5)}`,
  kueche: `${FLOOR(58, 82, 42)}
    <path d="M30 26 C30 20 34 18 34 12" stroke="var(--gift-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <path d="M44 24 C44 18 48 16 48 10" stroke="var(--gift-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <rect x="16" y="40" width="72" height="38" rx="10" fill="var(--gift-clay)"/><rect x="16" y="40" width="72" height="9" rx="4.5" fill="var(--gift-clay-dark)" opacity=".55"/>
    <rect x="8" y="46" width="12" height="6" rx="3" fill="var(--gift-clay-dark)"/><rect x="84" y="46" width="12" height="6" rx="3" fill="var(--gift-clay-dark)"/>
    <path d="M14 38 H90 C90 32 80 28 52 28 C24 28 14 32 14 38 Z" fill="var(--gift-steel)"/><rect x="46" y="22" width="12" height="7" rx="3.5" fill="var(--gift-charcoal)"/>
    <g transform="rotate(28 96 50)"><rect x="93" y="22" width="6" height="40" rx="3" fill="var(--gift-wood)"/><ellipse cx="96" cy="66" rx="7" ry="9" fill="var(--gift-wood)"/></g>`,
  kaffee: `${FLOOR(56, 82, 40)}
    <path d="M40 30 C40 22 46 20 46 12" stroke="var(--gift-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <path d="M54 30 C54 22 60 20 60 12" stroke="var(--gift-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <ellipse cx="54" cy="76" rx="38" ry="6" fill="var(--gift-cream)"/><ellipse cx="54" cy="75" rx="30" ry="4" fill="var(--gift-steel)"/>
    <path d="M26 36 H82 V54 C82 66 72 74 54 74 C36 74 26 66 26 54 Z" fill="var(--gift-sky)"/><path d="M82 42 C96 42 96 60 80 60" stroke="var(--gift-sky)" stroke-width="6" fill="none"/>
    <ellipse cx="54" cy="36" rx="28" ry="5" fill="var(--gift-wood-dark)"/>
    <ellipse cx="98" cy="74" rx="5" ry="3.4" fill="var(--gift-wood-dark)" transform="rotate(-24 98 74)"/><ellipse cx="106" cy="68" rx="5" ry="3.4" fill="var(--gift-wood)" transform="rotate(18 106 68)"/>`,
  draussen: `${FLOOR(60, 82, 46)}
    <path d="M6 78 L34 34 L52 60 L70 30 L108 78 Z" fill="var(--gift-sky-light)"/><path d="M60 46 L70 30 L80 46 L74 42 L70 46 L66 42 Z" fill="#fff" opacity=".85"/>
    <path d="M30 78 L54 44 L78 78 Z" fill="var(--gift-clay)"/><path d="M54 44 L54 78 L46 78 Z" fill="var(--gift-clay-dark)" opacity=".5"/><path d="M54 60 L48 78 H60 Z" fill="var(--gift-charcoal)" opacity=".75"/>
    <path d="M92 78 L92 70" stroke="var(--gift-wood-dark)" stroke-width="3"/><path d="M80 72 L92 46 L104 72 Z" fill="var(--gift-leaf)"/><path d="M84 60 L92 40 L100 60 Z" fill="var(--gift-leaf-dark)"/>
    <circle cx="22" cy="20" r="7" fill="var(--gift-butter)"/>`,
  musik: `${FLOOR(60, 82, 40)}
    <circle cx="50" cy="48" r="32" fill="var(--gift-charcoal)"/><circle cx="50" cy="48" r="24" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/><circle cx="50" cy="48" r="18" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/>
    <circle cx="50" cy="48" r="11" fill="var(--gift-rose)"/><circle cx="50" cy="48" r="2.2" fill="var(--gift-cream)"/>
    <path d="M90 22 V54" stroke="var(--gift-accent)" stroke-width="4" stroke-linecap="round"/><path d="M90 22 C96 24 102 28 104 34" stroke="var(--gift-accent)" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="84" cy="56" rx="8" ry="6" fill="var(--gift-accent)" transform="rotate(-20 84 56)"/>`,
  kreativ: `${FLOOR(58, 82, 42)}
    <path d="M20 54 C14 30 40 16 66 20 C92 24 104 44 92 60 C86 68 74 62 66 68 C58 74 62 82 48 80 C32 78 24 70 20 54 Z" fill="var(--gift-wood-light)"/>
    <circle cx="40" cy="38" r="6" fill="var(--gift-clay)"/><circle cx="58" cy="32" r="6" fill="var(--gift-butter-dark)"/><circle cx="76" cy="38" r="6" fill="var(--gift-leaf)"/><circle cx="84" cy="52" r="6" fill="var(--gift-sky-dark)"/><ellipse cx="44" cy="62" rx="7" ry="5.4" fill="var(--gift-cream)"/>
    <g transform="rotate(-38 92 26)"><rect x="88" y="0" width="7" height="44" rx="3.5" fill="var(--gift-wood)"/><rect x="88" y="40" width="7" height="8" fill="var(--gift-steel-dark)"/><path d="M88 48 H95 L93 58 C92.4 60 90.6 60 90 58 Z" fill="var(--gift-rose-dark)"/></g>`,
};

/** The tile tones (tiles.css --tile-1…4: apricot, blush, blue, butter). */
export const CATEGORY_TONE: Record<GiftTopic, 1 | 2 | 3 | 4> = {
  brettspiele: 4, buecher: 3, kueche: 1, kaffee: 3, draussen: 1, musik: 2, kreativ: 4,
};

export function categoryArt(id: GiftTopic): string {
  return `<svg viewBox="0 0 120 90" aria-hidden="true" focusable="false">${CATEGORY_ART[id]}</svg>`;
}

// ---------------------------------------------------------------------------------------------- the header scene

/** Where the die rests in the header scene (its top-left corner, scene units) — motion.ts rolls it in from the right. */
export const DIE_REST = { x: 266, y: 98 } as const;

/**
 * The header of the "Brettspiele" screen, 358 × 140: a board with a path of spaces, three meeples, a fan of cards and
 * a die that rolls in when the screen opens (data-k = the tracks of motion.ts). Static, it is the end pose.
 */
export function headerScene(): string {
  const spaces: Array<[number, number, string]> = [
    [20, 70, 'var(--gift-clay)'], [38, 74, 'var(--gift-sky)'], [56, 72, 'var(--gift-butter-dark)'], [72, 64, 'var(--gift-leaf)'],
    [86, 52, 'var(--gift-rose)'], [102, 44, 'var(--gift-clay)'], [120, 40, 'var(--gift-sky)'], [138, 42, 'var(--gift-butter-dark)'],
    [154, 50, 'var(--gift-leaf)'], [168, 60, 'var(--gift-rose)'], [182, 68, 'var(--gift-clay)'],
  ];
  const meeples: Array<[number, number, string, number]> = [
    [60, 34, 'var(--gift-clay)', 1.25],
    [112, 12, 'var(--gift-sky-dark)', 1.15],
    [160, 28, 'var(--gift-leaf)', 1.2],
  ];
  return `<svg class="topic-scene" viewBox="0 0 358 140" aria-hidden="true" focusable="false">
  <ellipse cx="150" cy="128" rx="128" ry="9" fill="var(--gift-shadow)"/>
  <g transform="translate(36 26) rotate(-4)">
    <rect width="214" height="98" rx="13" fill="var(--gift-wood)"/><rect x="5" y="5" width="204" height="88" rx="9" fill="var(--gift-cream)"/>
    <path d="M${spaces.map(([x, y]) => `${x} ${y}`).join(' L')}" stroke="var(--gift-wood-light)" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>
    ${spaces.map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`).join('')}
    <path d="M190 58 L196 50 L202 58 V70 H190 Z" fill="var(--gift-clay-dark)"/><rect x="194" y="62" width="4" height="8" fill="var(--gift-cream)"/>
    <path d="M14 14 h18 v6 h-18 z" fill="var(--gift-accent)" opacity=".8"/><path d="M14 14 V30" stroke="var(--gift-charcoal)" stroke-width="2"/>
  </g>
  ${meeples
    .map(([x, y, c, s], i) => `<g transform="translate(${x + 36} ${y + 26}) scale(${s})"><g class="play-feet" data-k="meeple-${i}"><path d="${MEEPLE}" fill="${c}"/><path d="M7 4.5 A3.5 3.5 0 0 1 12.5 3.4" stroke="#fff" stroke-opacity=".45" stroke-width="1.3" fill="none" stroke-linecap="round"/></g></g>`)
    .join('')}
  <g transform="translate(284 30)">
    ${card(-20, 6, -16, '<circle cx="-2" cy="31" r="7" fill="var(--gift-sky-dark)"/><circle cx="-2" cy="31" r="3" fill="var(--gift-card)"/>')}
    ${card(0, 0, 0, '<path d="M18 16 L21.5 24 L30 25 L23.6 30.6 L25.4 39 L18 34.6 L10.6 39 L12.4 30.6 L6 25 L14.5 24 Z" fill="var(--gift-accent)"/>')}
    ${card(20, 6, 16, '<path d="M38 40 C30 35 27 31 27 27.5 C27 24 31 22.4 34 24.6 C35.4 25.6 36.4 26.8 38 28.4 C39.6 26.8 40.6 25.6 42 24.6 C45 22.4 49 24 49 27.5 C49 31 46 35 38 40 Z" fill="var(--gift-rose-dark)"/>')}
  </g>
  <g transform="translate(${DIE_REST.x} ${DIE_REST.y})">
    <g data-k="die-x">
      <g transform="translate(13 30)"><g class="play-center" data-k="die-shadow"><ellipse cx="0" cy="0" rx="15" ry="3.4" fill="var(--gift-shadow-strong)"/></g></g>
      <g data-k="die-y"><g class="play-center" data-k="die-spin">${die(6, [3, 5, 2, 6])}</g></g>
    </g>
  </g>
  <g transform="translate(${DIE_REST.x + 36} ${DIE_REST.y - 4})"><g class="play-center" data-k="spark">${SPARK(0, 0, 7)}</g></g>
</svg>`;
}

