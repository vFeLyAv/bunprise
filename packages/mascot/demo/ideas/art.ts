/**
 * Drawings of the "Ideen → Kategorien" prototype (26.10, GALLERY-ONLY): the category tiles, the header scene of the
 * "Brettspiele" screen (its die, meeples and spark are the moving parts, see motion.ts) and a drawn "box" per game
 * instead of product photos. Flat shapes in the app's gift palette (apps/web/src/features/gifts/gifts.css --gift-*,
 * here --g-*), the same language as the app's own idea drawings (features/gifts/art). SVG strings, no network.
 *
 * Animated parts are inner <g data-k="…"> WITHOUT a transform attribute: a CSS transform (Web Animations) on an SVG
 * element replaces its transform attribute, so every position lives on an outer group.
 */

export type CategoryId = 'brettspiele' | 'buecher' | 'kueche' | 'erlebnisse' | 'kaffee' | 'draussen' | 'musik' | 'kreativ';

const SPARK = (x: number, y: number, r: number, fill = 'var(--g-butter-dark)') =>
  `<path d="M${x} ${y - r} C${x + r * 0.18} ${y - r * 0.18} ${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} C${x + r * 0.18} ${y + r * 0.18} ${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} C${x - r * 0.18} ${y + r * 0.18} ${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} C${x - r * 0.18} ${y - r * 0.18} ${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

const FLOOR = (cx: number, cy: number, rx: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${(rx * 0.16).toFixed(1)}" fill="var(--g-shadow)"/>`;

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
    .map((f) => `<g data-face="${f}"${f === shown ? '' : ' style="opacity:0"'}>${(PIPS[f] ?? []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--g-charcoal)"/>`).join('')}</g>`)
    .join('');
  return `<rect x="0" y="0" width="26" height="26" rx="6.5" fill="var(--g-die)"/><rect x="0" y="0" width="26" height="26" rx="6.5" fill="none" stroke="var(--g-die-rim)" stroke-width="1.2"/><path d="M5 3.4H21" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>${groups}`;
}

function card(x: number, y: number, angle: number, symbol: string): string {
  return `<g transform="rotate(${angle} ${x + 18} ${y + 52})"><rect x="${x}" y="${y}" width="36" height="50" rx="5.5" fill="var(--g-card)"/><rect x="${x}" y="${y}" width="36" height="50" rx="5.5" fill="none" stroke="var(--g-card-rim)" stroke-width="1.1"/>${symbol}</g>`;
}

// ---------------------------------------------------------------------------------------------- category tiles

/** 120 × 90 drawings for the category tiles. */
export const CATEGORY_ART: Record<CategoryId, string> = {
  brettspiele: `${FLOOR(60, 80, 44)}
    <g transform="translate(14 44) rotate(-8)"><rect width="64" height="34" rx="6" fill="var(--g-wood-light)"/><rect x="4" y="4" width="56" height="26" rx="4" fill="var(--g-cream)"/>
      <circle cx="12" cy="22" r="3.2" fill="var(--g-clay)"/><circle cx="22" cy="17" r="3.2" fill="var(--g-sky)"/><circle cx="32" cy="14" r="3.2" fill="var(--g-butter-dark)"/><circle cx="42" cy="16" r="3.2" fill="var(--g-leaf)"/><circle cx="51" cy="21" r="3.2" fill="var(--g-rose)"/></g>
    <g transform="translate(34 26) scale(1.15)"><path d="${MEEPLE}" fill="var(--g-clay)"/></g>
    <g transform="translate(76 18) rotate(10)">${card(0, 0, 0, `<path d="M18 16 L21 23 L28 24 L23 29 L24.5 36 L18 32.5 L11.5 36 L13 29 L8 24 L15 23 Z" fill="var(--g-accent)"/>`)}</g>
    <g transform="translate(76 54) rotate(-14)">${die(5)}</g>
    ${SPARK(104, 14, 5)}`,
  buecher: `${FLOOR(60, 82, 42)}
    <rect x="22" y="62" width="74" height="15" rx="3" fill="var(--g-sky-dark)"/><rect x="22" y="62" width="9" height="15" rx="2" fill="var(--g-sky)"/>
    <rect x="28" y="48" width="66" height="14" rx="3" fill="var(--g-clay)"/><rect x="28" y="52" width="66" height="3" fill="var(--g-clay-dark)" opacity=".6"/>
    <rect x="18" y="34" width="70" height="14" rx="3" fill="var(--g-leaf)"/><rect x="74" y="34" width="6" height="14" fill="var(--g-cream)" opacity=".75"/>
    <path d="M38 34 C46 26 56 24 62 26 C68 24 78 26 86 34 Z" fill="var(--g-cream)"/><path d="M62 26 V34" stroke="var(--g-card-rim)" stroke-width="1.2"/>
    <path d="M70 26 V40 L73 37 L76 40 V26 Z" fill="var(--g-rose-dark)"/>
    ${SPARK(100, 22, 4.5)}`,
  kueche: `${FLOOR(58, 82, 42)}
    <path d="M30 26 C30 20 34 18 34 12" stroke="var(--g-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <path d="M44 24 C44 18 48 16 48 10" stroke="var(--g-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <rect x="16" y="40" width="72" height="38" rx="10" fill="var(--g-clay)"/><rect x="16" y="40" width="72" height="9" rx="4.5" fill="var(--g-clay-dark)" opacity=".55"/>
    <rect x="8" y="46" width="12" height="6" rx="3" fill="var(--g-clay-dark)"/><rect x="84" y="46" width="12" height="6" rx="3" fill="var(--g-clay-dark)"/>
    <path d="M14 38 H90 C90 32 80 28 52 28 C24 28 14 32 14 38 Z" fill="var(--g-steel)"/><rect x="46" y="22" width="12" height="7" rx="3.5" fill="var(--g-charcoal)"/>
    <g transform="rotate(28 96 50)"><rect x="93" y="22" width="6" height="40" rx="3" fill="var(--g-wood)"/><ellipse cx="96" cy="66" rx="7" ry="9" fill="var(--g-wood)"/></g>`,
  erlebnisse: `${FLOOR(60, 82, 40)}
    <g transform="rotate(-10 56 56)"><path d="M18 40 H94 V50 A6 6 0 0 0 94 62 V72 H18 V62 A6 6 0 0 0 18 50 Z" fill="var(--g-butter)"/>
      <path d="M70 42 V70" stroke="var(--g-butter-dark)" stroke-width="2" stroke-dasharray="3 3"/>
      <path d="M42 46 L45 53 L52.5 53.6 L47 58.4 L48.6 65.6 L42 61.8 L35.4 65.6 L37 58.4 L31.5 53.6 L39 53 Z" fill="var(--g-accent)"/>
      <rect x="76" y="50" width="12" height="3" rx="1.5" fill="var(--g-butter-dark)"/><rect x="76" y="57" width="9" height="3" rx="1.5" fill="var(--g-butter-dark)"/></g>
    <ellipse cx="92" cy="20" rx="12" ry="14" fill="var(--g-rose)"/><path d="M84 30 L88 38 H96 L100 30 Z" fill="var(--g-rose-dark)" opacity=".5"/><rect x="88" y="37" width="8" height="6" rx="1.5" fill="var(--g-wood)"/>
    ${SPARK(24, 20, 4.5)}`,
  kaffee: `${FLOOR(56, 82, 40)}
    <path d="M40 30 C40 22 46 20 46 12" stroke="var(--g-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <path d="M54 30 C54 22 60 20 60 12" stroke="var(--g-steel-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>
    <ellipse cx="54" cy="76" rx="38" ry="6" fill="var(--g-cream)"/><ellipse cx="54" cy="75" rx="30" ry="4" fill="var(--g-steel)"/>
    <path d="M26 36 H82 V54 C82 66 72 74 54 74 C36 74 26 66 26 54 Z" fill="var(--g-sky)"/><path d="M82 42 C96 42 96 60 80 60" stroke="var(--g-sky)" stroke-width="6" fill="none"/>
    <ellipse cx="54" cy="36" rx="28" ry="5" fill="var(--g-wood-dark)"/>
    <ellipse cx="98" cy="74" rx="5" ry="3.4" fill="var(--g-wood-dark)" transform="rotate(-24 98 74)"/><ellipse cx="106" cy="68" rx="5" ry="3.4" fill="var(--g-wood)" transform="rotate(18 106 68)"/>`,
  draussen: `${FLOOR(60, 82, 46)}
    <path d="M6 78 L34 34 L52 60 L70 30 L108 78 Z" fill="var(--g-sky-light)"/><path d="M60 46 L70 30 L80 46 L74 42 L70 46 L66 42 Z" fill="#fff" opacity=".85"/>
    <path d="M30 78 L54 44 L78 78 Z" fill="var(--g-clay)"/><path d="M54 44 L54 78 L46 78 Z" fill="var(--g-clay-dark)" opacity=".5"/><path d="M54 60 L48 78 H60 Z" fill="var(--g-charcoal)" opacity=".75"/>
    <path d="M92 78 L92 70" stroke="var(--g-wood-dark)" stroke-width="3"/><path d="M80 72 L92 46 L104 72 Z" fill="var(--g-leaf)"/><path d="M84 60 L92 40 L100 60 Z" fill="var(--g-leaf-dark)"/>
    <circle cx="22" cy="20" r="7" fill="var(--g-butter)"/>`,
  musik: `${FLOOR(60, 82, 40)}
    <circle cx="50" cy="48" r="32" fill="var(--g-charcoal)"/><circle cx="50" cy="48" r="24" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/><circle cx="50" cy="48" r="18" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/>
    <circle cx="50" cy="48" r="11" fill="var(--g-rose)"/><circle cx="50" cy="48" r="2.2" fill="var(--g-cream)"/>
    <path d="M90 22 V54" stroke="var(--g-accent)" stroke-width="4" stroke-linecap="round"/><path d="M90 22 C96 24 102 28 104 34" stroke="var(--g-accent)" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="84" cy="56" rx="8" ry="6" fill="var(--g-accent)" transform="rotate(-20 84 56)"/>`,
  kreativ: `${FLOOR(58, 82, 42)}
    <path d="M20 54 C14 30 40 16 66 20 C92 24 104 44 92 60 C86 68 74 62 66 68 C58 74 62 82 48 80 C32 78 24 70 20 54 Z" fill="var(--g-wood-light)"/>
    <circle cx="40" cy="38" r="6" fill="var(--g-clay)"/><circle cx="58" cy="32" r="6" fill="var(--g-butter-dark)"/><circle cx="76" cy="38" r="6" fill="var(--g-leaf)"/><circle cx="84" cy="52" r="6" fill="var(--g-sky-dark)"/><ellipse cx="44" cy="62" rx="7" ry="5.4" fill="var(--g-cream)"/>
    <g transform="rotate(-38 92 26)"><rect x="88" y="0" width="7" height="44" rx="3.5" fill="var(--g-wood)"/><rect x="88" y="40" width="7" height="8" fill="var(--g-steel-dark)"/><path d="M88 48 H95 L93 58 C92.4 60 90.6 60 90 58 Z" fill="var(--g-rose-dark)"/></g>`,
};

/** The tile tones (tiles.css --tile-1…4: apricot, blush, blue, butter). */
export const CATEGORY_TONE: Record<CategoryId, 1 | 2 | 3 | 4> = {
  brettspiele: 4, buecher: 3, kueche: 1, erlebnisse: 2, kaffee: 3, draussen: 1, musik: 2, kreativ: 4,
};

export function categoryArt(id: CategoryId): string {
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
    [20, 70, 'var(--g-clay)'], [38, 74, 'var(--g-sky)'], [56, 72, 'var(--g-butter-dark)'], [72, 64, 'var(--g-leaf)'],
    [86, 52, 'var(--g-rose)'], [102, 44, 'var(--g-clay)'], [120, 40, 'var(--g-sky)'], [138, 42, 'var(--g-butter-dark)'],
    [154, 50, 'var(--g-leaf)'], [168, 60, 'var(--g-rose)'], [182, 68, 'var(--g-clay)'],
  ];
  const meeples: Array<[number, number, string, number]> = [
    [60, 34, 'var(--g-clay)', 1.25],
    [112, 12, 'var(--g-sky-dark)', 1.15],
    [160, 28, 'var(--g-leaf)', 1.2],
  ];
  return `<svg class="ix-scene" viewBox="0 0 358 140" aria-hidden="true" focusable="false">
  <ellipse cx="150" cy="128" rx="128" ry="9" fill="var(--g-shadow)"/>
  <g transform="translate(36 26) rotate(-4)">
    <rect width="214" height="98" rx="13" fill="var(--g-wood)"/><rect x="5" y="5" width="204" height="88" rx="9" fill="var(--g-cream)"/>
    <path d="M${spaces.map(([x, y]) => `${x} ${y}`).join(' L')}" stroke="var(--g-wood-light)" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>
    ${spaces.map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`).join('')}
    <path d="M190 58 L196 50 L202 58 V70 H190 Z" fill="var(--g-clay-dark)"/><rect x="194" y="62" width="4" height="8" fill="var(--g-cream)"/>
    <path d="M14 14 h18 v6 h-18 z" fill="var(--g-accent)" opacity=".8"/><path d="M14 14 V30" stroke="var(--g-charcoal)" stroke-width="2"/>
  </g>
  ${meeples
    .map(([x, y, c, s], i) => `<g transform="translate(${x + 36} ${y + 26}) scale(${s})"><g class="ix-feet" data-k="meeple-${i}"><path d="${MEEPLE}" fill="${c}"/><path d="M7 4.5 A3.5 3.5 0 0 1 12.5 3.4" stroke="#fff" stroke-opacity=".45" stroke-width="1.3" fill="none" stroke-linecap="round"/></g></g>`)
    .join('')}
  <g transform="translate(284 30)">
    ${card(-20, 6, -16, '<circle cx="-2" cy="31" r="7" fill="var(--g-sky-dark)"/><circle cx="-2" cy="31" r="3" fill="var(--g-card)"/>')}
    ${card(0, 0, 0, '<path d="M18 16 L21.5 24 L30 25 L23.6 30.6 L25.4 39 L18 34.6 L10.6 39 L12.4 30.6 L6 25 L14.5 24 Z" fill="var(--g-accent)"/>')}
    ${card(20, 6, 16, '<path d="M38 40 C30 35 27 31 27 27.5 C27 24 31 22.4 34 24.6 C35.4 25.6 36.4 26.8 38 28.4 C39.6 26.8 40.6 25.6 42 24.6 C45 22.4 49 24 49 27.5 C49 31 46 35 38 40 Z" fill="var(--g-rose-dark)"/>')}
  </g>
  <g transform="translate(${DIE_REST.x} ${DIE_REST.y})">
    <g data-k="die-x">
      <g transform="translate(13 30)"><g class="ix-center" data-k="die-shadow"><ellipse cx="0" cy="0" rx="15" ry="3.4" fill="var(--g-shadow-strong)"/></g></g>
      <g data-k="die-y"><g class="ix-center" data-k="die-spin">${die(6, [3, 5, 2, 6])}</g></g>
    </g>
  </g>
  <g transform="translate(${DIE_REST.x + 36} ${DIE_REST.y - 4})"><g class="ix-center" data-k="spark">${SPARK(0, 0, 7)}</g></g>
</svg>`;
}

// ---------------------------------------------------------------------------------------------- the game "boxes"

export type MotifId =
  | 'carcassonne' | 'zugumzug' | 'codenames' | 'azul' | 'fluegelschlag' | 'quacksalber' | 'dorfromantik' | 'duel' | 'themind' | 'justone';

const HEX = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
};

/** 160 × 110 drawings: what the game is about, never its box art (no product photos, no publisher artwork). */
export const MOTIFS: Record<MotifId, string> = {
  carcassonne: `${FLOOR(80, 98, 56)}
    <g transform="translate(36 22) rotate(-6)"><rect width="56" height="56" rx="4" fill="var(--g-leaf-light)"/><path d="M0 0 H56 L44 16 C34 10 22 10 12 16 Z" fill="var(--g-wood-light)"/><path d="M14 4 h6 v6 h-6z M36 4 h6 v6 h-6z" fill="var(--g-clay-dark)" opacity=".55"/>
      <path d="M28 56 V30 M0 36 H56" stroke="var(--g-cream)" stroke-width="6"/><circle cx="28" cy="36" r="5" fill="var(--g-charcoal)" opacity=".7"/></g>
    <g transform="translate(88 30) rotate(5)"><rect width="56" height="56" rx="4" fill="var(--g-leaf)"/><path d="M0 28 C16 20 40 36 56 28" stroke="var(--g-cream)" stroke-width="6" fill="none"/><circle cx="42" cy="12" r="6" fill="var(--g-leaf-dark)"/></g>
    <g transform="translate(76 40) scale(1.1)"><path d="${MEEPLE}" fill="var(--g-clay)"/></g>`,
  zugumzug: `${FLOOR(80, 98, 58)}
    <path d="M18 78 C44 40 96 86 142 34" stroke="var(--g-wood-light)" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M18 78 C44 40 96 86 142 34" stroke="var(--g-cream)" stroke-width="3" stroke-dasharray="9 7" fill="none"/>
    <circle cx="18" cy="78" r="8" fill="var(--g-charcoal)"/><circle cx="18" cy="78" r="3.4" fill="var(--g-cream)"/><circle cx="142" cy="34" r="8" fill="var(--g-charcoal)"/><circle cx="142" cy="34" r="3.4" fill="var(--g-cream)"/>
    <g transform="translate(46 50) rotate(-18)"><rect width="26" height="12" rx="3" fill="var(--g-clay)"/><circle cx="6" cy="13" r="2.6" fill="var(--g-charcoal)"/><circle cx="20" cy="13" r="2.6" fill="var(--g-charcoal)"/></g>
    <g transform="translate(78 58) rotate(6)"><rect width="26" height="12" rx="3" fill="var(--g-sky-dark)"/><circle cx="6" cy="13" r="2.6" fill="var(--g-charcoal)"/><circle cx="20" cy="13" r="2.6" fill="var(--g-charcoal)"/></g>
    <g transform="translate(106 40) rotate(-30)"><rect width="26" height="12" rx="3" fill="var(--g-leaf)"/><circle cx="6" cy="13" r="2.6" fill="var(--g-charcoal)"/><circle cx="20" cy="13" r="2.6" fill="var(--g-charcoal)"/></g>`,
  codenames: `${FLOOR(80, 100, 58)}
    ${[0, 1, 2, 3, 4]
      .flatMap((c) => [0, 1, 2].map((r) => {
        const k = (c * 3 + r) % 7;
        const fill = k === 1 ? 'var(--g-rose-dark)' : k === 3 ? 'var(--g-sky-dark)' : k === 5 ? 'var(--g-charcoal)' : 'var(--g-card)';
        return `<rect x="${24 + c * 23}" y="${18 + r * 25}" width="20" height="21" rx="3" fill="${fill}"/><rect x="${27 + c * 23}" y="${31 + r * 25}" width="14" height="3" rx="1.5" fill="${fill === 'var(--g-card)' ? 'var(--g-steel-dark)' : '#fff'}" opacity=".6"/>`;
      }))
      .join('')}`,
  azul: `${FLOOR(80, 100, 52)}
    <g transform="translate(40 18) rotate(-4)">
      ${[[0, 0, 'var(--g-sky-dark)'], [26, 0, 'var(--g-butter-dark)'], [52, 0, 'var(--g-rose-dark)'], [0, 26, 'var(--g-cream)'], [26, 26, 'var(--g-sky-dark)'], [52, 26, 'var(--g-charcoal)'], [0, 52, 'var(--g-rose-dark)'], [26, 52, 'var(--g-cream)'], [52, 52, 'var(--g-butter-dark)']]
        .map(([x, y, c]) => `<rect x="${x}" y="${y}" width="23" height="23" rx="3.5" fill="${c}"/><path d="M${Number(x) + 6} ${Number(y) + 11.5} L${Number(x) + 11.5} ${Number(y) + 6} L${Number(x) + 17} ${Number(y) + 11.5} L${Number(x) + 11.5} ${Number(y) + 17} Z" fill="#fff" opacity=".35"/>`)
        .join('')}
    </g>
    <g transform="translate(124 62) rotate(18)"><rect width="22" height="22" rx="3.5" fill="var(--g-sky)"/><circle cx="11" cy="11" r="5" fill="#fff" opacity=".4"/></g>`,
  fluegelschlag: `${FLOOR(80, 100, 50)}
    <path d="M22 84 C60 76 100 80 140 70" stroke="var(--g-wood-dark)" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M110 76 C116 66 126 64 132 66" stroke="var(--g-wood-dark)" stroke-width="3" fill="none"/><ellipse cx="128" cy="62" rx="7" ry="4" fill="var(--g-leaf)" transform="rotate(-20 128 62)"/>
    <ellipse cx="74" cy="56" rx="28" ry="24" fill="var(--g-sky)"/><path d="M60 52 C70 40 92 44 96 60 C84 58 70 62 60 52 Z" fill="var(--g-sky-dark)"/><ellipse cx="70" cy="64" rx="15" ry="11" fill="var(--g-cream)"/>
    <circle cx="58" cy="44" r="3.4" fill="var(--g-charcoal)"/><path d="M46 48 L36 51 L46 54 Z" fill="var(--g-butter-dark)"/><path d="M98 54 L112 46 L108 60 Z" fill="var(--g-sky-dark)"/>
    <path d="M66 78 V84 M78 78 V84" stroke="var(--g-butter-dark)" stroke-width="2.4"/>
    <ellipse cx="34" cy="76" rx="7" ry="9" fill="var(--g-cream)"/><circle cx="32" cy="72" r="1.6" fill="var(--g-sky)"/>`,
  quacksalber: `${FLOOR(80, 102, 50)}
    <circle cx="62" cy="22" r="6" fill="var(--g-leaf)"/><circle cx="84" cy="14" r="5" fill="var(--g-rose)"/><circle cx="100" cy="26" r="6" fill="var(--g-butter-dark)"/><circle cx="74" cy="32" r="4" fill="var(--g-sky)"/>
    <path d="M30 50 H130 C130 84 112 98 80 98 C48 98 30 84 30 50 Z" fill="var(--g-charcoal)"/><ellipse cx="80" cy="50" rx="50" ry="9" fill="var(--g-steel-dark)"/><ellipse cx="80" cy="50" rx="42" ry="6" fill="var(--g-leaf-light)"/>
    <circle cx="66" cy="49" r="4" fill="var(--g-clay)"/><circle cx="92" cy="51" r="4" fill="var(--g-rose)"/>
    <path d="M24 52 H36 M124 52 H136" stroke="var(--g-steel-dark)" stroke-width="5" stroke-linecap="round"/>`,
  dorfromantik: `${FLOOR(80, 102, 54)}
    <path d="${HEX(54, 46, 22)}" fill="var(--g-leaf)"/><path d="${HEX(92, 46, 22)}" fill="var(--g-butter)"/><path d="${HEX(73, 79, 22)}" fill="var(--g-sky)"/><path d="${HEX(111, 79, 22)}" fill="var(--g-leaf-light)"/>
    <path d="M92 40 L100 32 L108 40 V52 H92 Z" fill="var(--g-clay)" transform="translate(-8 -4)"/><rect x="88" y="40" width="5" height="8" fill="var(--g-cream)"/>
    <path d="M46 52 L54 30 L62 52 Z" fill="var(--g-leaf-dark)"/><path d="M38 56 L44 42 L50 56 Z" fill="var(--g-leaf-dark)"/>
    <path d="M60 80 C68 74 78 86 88 78" stroke="var(--g-cream)" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M104 86 L111 70 L118 86 Z" fill="var(--g-leaf-dark)"/>`,
  duel: `${FLOOR(80, 102, 56)}
    <g transform="translate(-12 0)">
      <rect x="40" y="86" width="64" height="8" rx="2" fill="var(--g-wood-light)"/><rect x="44" y="79" width="56" height="8" rx="2" fill="var(--g-wood)"/>
      <rect x="50" y="46" width="7" height="34" fill="var(--g-cream)"/><rect x="62" y="46" width="7" height="34" fill="var(--g-cream)"/><rect x="75" y="46" width="7" height="34" fill="var(--g-cream)"/><rect x="87" y="46" width="7" height="34" fill="var(--g-cream)"/>
      <rect x="42" y="40" width="60" height="7" rx="1.5" fill="var(--g-wood-light)"/><path d="M40 41 L72 20 L104 41 Z" fill="var(--g-butter-dark)"/><circle cx="72" cy="33" r="3.4" fill="var(--g-cream)"/>
    </g>
    ${[[112, 26, 'var(--g-sky-dark)', -6], [100, 52, 'var(--g-sky-dark)', -4], [124, 52, 'var(--g-leaf)', 5]]
      .map(([x, y, c, a]) => `<g transform="rotate(${a} ${Number(x) + 9} ${Number(y) + 12})"><rect x="${x}" y="${y}" width="18" height="25" rx="3" fill="${c}"/><rect x="${Number(x) + 3}" y="${Number(y) + 3}" width="12" height="19" rx="2" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/></g>`)
      .join('')}
    <circle cx="140" cy="88" r="7" fill="var(--g-butter-dark)"/><circle cx="140" cy="88" r="4" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.4"/>`,
  themind: `${FLOOR(80, 102, 50)}
    ${[[-16, 12, 'var(--g-sky-dark)'], [0, 37, 'var(--g-clay)'], [16, 81, 'var(--g-leaf-dark)']]
      .map(([a, n, c]) => `<g transform="rotate(${a} 80 104)"><rect x="58" y="18" width="44" height="64" rx="6" fill="var(--g-card)"/><rect x="58" y="18" width="44" height="64" rx="6" fill="none" stroke="var(--g-card-rim)" stroke-width="1.2"/><text x="80" y="58" text-anchor="middle" font-size="22" font-weight="800" fill="${c}" font-family="system-ui, sans-serif">${n}</text></g>`)
      .join('')}`,
  justone: `${FLOOR(80, 102, 56)}
    <g transform="translate(58 12)"><rect width="44" height="58" rx="6" fill="var(--g-card)"/><rect width="44" height="58" rx="6" fill="none" stroke="var(--g-card-rim)" stroke-width="1.2"/><text x="22" y="40" text-anchor="middle" font-size="30" font-weight="800" fill="var(--g-accent)" font-family="system-ui, sans-serif">?</text></g>
    ${[[24, 'var(--g-sky-dark)'], [64, 'var(--g-clay)'], [104, 'var(--g-leaf)']]
      .map(([x, c]) => `<g transform="translate(${x} 72)"><path d="M0 22 L6 0 H26 L32 22 Z" fill="${c}"/><rect x="5" y="4" width="22" height="9" rx="2" fill="var(--g-cream)"/></g>`)
      .join('')}`,
};

export function motifArt(id: MotifId): string {
  return `<svg viewBox="0 0 160 110" aria-hidden="true" focusable="false">${MOTIFS[id]}</svg>`;
}
