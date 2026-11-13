/**
 * The colours of the cover pictures (26.10, demo/covers/): ONE list, light + dark. The pictures (art.ts) never write a
 * colour themselves — only `var(--cv-<name>)` — so a theme recolours every picture at once and a test can prove it.
 * Values are copied from the app's tokens (the gallery must not import the app); the comment names the source. A
 * few are derived (a darker night variant, a mixed shade) — marked "derived". In the app this becomes
 * features/covers/covers.css with light-dark() pairs: the dark values then also serve the navy and ocean themes
 * (both `color-scheme: dark`).
 */

export const PALETTE_KEYS = [
  // backgrounds by tone (themes.ts CoverTone)
  'bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'bg6', 'bg7',
  // light, the table band, soft shadows
  'glow', 'table', 'shade',
  // objects
  'cream', 'paper', 'apricot', 'orange', 'deep', 'rose', 'berry', 'blue', 'butter', 'green', 'leaf', 'lilac', 'teal',
  'wood', 'charcoal', 'ink', 'flame', 'white',
  // the mascots (their own coats: the same in both themes, like in the app)
  'fur', 'ear', 'earIn', 'eye', 'nose', 'mouth', 'paw', 'pawLine', 'cheek', 'ham', 'hamLight', 'hamIn',
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

type Pair = readonly [light: string, dark: string];

export const PALETTE: Readonly<Record<PaletteKey, Pair>> = {
  bg1: ['#FCE5C9', '#3A2A1C'], // --tile-1
  bg2: ['#F8E0D8', '#3A2424'], // --tile-2
  bg3: ['#E3E6F1', '#23283A'], // --tile-3
  bg4: ['#F7EDC9', '#353016'], // --tile-4
  bg5: ['#DFEAB6', '#333912'], // --person-7
  bg6: ['#243049', '#161D2E'], // navy theme --surface-2 / --text-inverse (the evening sky)
  bg7: ['#E5DCFB', '#3A2D52'], // --person-4
  glow: ['rgba(255,255,255,.55)', 'rgba(255,236,214,.07)'], // --hl
  table: ['rgba(80,50,22,.08)', 'rgba(0,0,0,.22)'], // --shade, derived alpha
  shade: ['rgba(80,50,22,.16)', 'rgba(0,0,0,.34)'], // --shade / --gift-shadow, derived alpha
  cream: ['#FFFDF8', '#E8DED1'], // --surface; night: derived (no glaring white on dark paper)
  paper: ['#F2EBDD', '#C9BBAB'], // --bg; night: derived
  apricot: ['#F9A86C', '#D88D58'], // --tint-1-solid
  orange: ['#EE9443', '#D07F34'], // --accent-400
  deep: ['#DC7B2C', '#B9661F'], // --accent-500
  rose: ['#EE9AA8', '#C9808D'], // --tint-2-solid
  berry: ['#ED737B', '#B46669'], // --person-2-dot
  blue: ['#9AACE6', '#7C8FCB'], // --tint-3-solid
  butter: ['#F3C55E', '#D7AA45'], // --tint-4-solid
  green: ['#60B46F', '#54915D'], // --person-3-dot
  leaf: ['#3B985E', '#2F7A4B'], // --ok-fill
  lilac: ['#9C7FD7', '#8873B4'], // --person-4-dot
  teal: ['#40B1B7', '#0D9298'], // --person-5-dot
  wood: ['#B98A5A', '#8E6A45'], // --gift-wood (oklch .63 .085 60)
  charcoal: ['#4A4038', '#5E5248'], // --gift-charcoal; night: lighter, so it still shows on dark paper
  ink: ['#62554A', '#B5A696'], // --text-2 (strings, ropes)
  flame: ['#FFC58A', '#FFC58A'], // --accent-text-strong (night)
  white: ['#FFFFFF', '#F5EDE3'], // highlights; night: --text
  fur: ['#FBE3C4', '#F1D5B2'], // the fawn bunny (packages/mascot bunny.ts), flat
  ear: ['#DFA872', '#CF9862'],
  earIn: ['#F4B2A0', '#E3A08F'],
  eye: ['#3A2622', '#2A1A16'],
  nose: ['#F2899A', '#E07B8C'],
  mouth: ['#6B4A42', '#5A3D36'],
  paw: ['#F5D6B0', '#E8C7A0'],
  pawLine: ['rgba(150,90,40,.38)', 'rgba(110,64,28,.45)'],
  cheek: ['rgba(255,158,158,.38)', 'rgba(255,158,158,.3)'],
  ham: ['#F8C68A', '#E9B477'], // the golden hamster (hamster.ts HAMSTER_COATS golden)
  hamLight: ['#FFF9F0', '#EFE4D6'],
  hamIn: ['#F4A487', '#E3937A'],
};

/** `var(--cv-<key>)` for every key — the only way art.ts names a colour. */
export const C: Readonly<Record<PaletteKey, string>> = Object.fromEntries(PALETTE_KEYS.map((k) => [k, `var(--cv-${k})`])) as Record<PaletteKey, string>;

/** The palette as CSS: light on `light`, night on `dark` (selectors of the containers). */
export function paletteCss(light: string, dark: string): string {
  const block = (i: 0 | 1) => PALETTE_KEYS.map((k) => `--cv-${k}: ${PALETTE[k][i]};`).join(' ');
  return `${light} { ${block(0)} }\n${dark} { ${block(1)} }\n`;
}
