// Shared drawing parts of the logo variants: the bunny of the app icon (#bunny-head and #bunny-paws from the defs of
// public/icons/icon.svg), the scene layout and the seasonal accessories. Used by
//   scripts/brand-variants.mjs  docs/brand/variants/ (the variants as pictures, 25.10)
//   scripts/app-icons.mjs       public/icons/variants/ (the home-screen icons to choose from, 27.10)
// Pure functions that return SVG text; nothing is written here.
//
// `bleed`: backgrounds and edges reach 256 px past every side of the 1024 canvas. The app icons need it for their
// maskable PNGs (the whole scene is scaled to 80 % around the centre, the margin must stay filled); without it the
// SVG text is exactly what brand-variants.mjs wrote before the split.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const master = readFileSync(resolve(root, 'public', 'icons', 'icon.svg'), 'utf8')
export const bunnyDefs = master.match(/<defs>[\s\S]*?<\/defs>/)[0]

// Mascot units -> canvas: the icon itself uses scale 4.85 with the edge line (y = -60) at 840 px.
// Variants with a hat use a smaller bunny (scale 4) with the edge at the same height, so the hat fits.
export const EDGE_Y = 840
export const place = (scale, x = 512) => `translate(${x} ${EDGE_Y + 60 * scale}) scale(${scale})`

/** The canvas a background or an edge covers: 0…1024, or 256 px more on every side with `bleed`. */
const span = (bleed) => (bleed ? { x: -256, w: 1536, bottom: 1280 } : { x: 0, w: 1024, bottom: 1024 })

/** One full-bleed variant: background, things behind the bunny, the head, a head accessory, the edge,
 *  the paws, things in front. Accessories are drawn in mascot units (head top y = -163, centre x = 0).
 *  App icons only (27.10): `x` moves the bunny off the centre line, `afterHead` is drawn between his head and the
 *  edge (a friend peeking next to him), `flat` leaves out the drawn bunny (the variant paints its own). */
export function scene({ defs = '', background, behind = '', scale = 4.85, x = 512, hat = '', afterHead = '', edge, front = '', flat = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
${bunnyDefs}<defs>${defs}</defs>
${background}
${behind}
${flat ? '' : `<use href="#bunny-head" transform="${place(scale, x)}"/>`}
<g transform="${place(scale, x)}">${hat}</g>${afterHead ? `\n${afterHead}` : ''}
${edge}
${flat ? '' : `<use href="#bunny-paws" transform="${place(scale, x)}"/>`}
${front}
</svg>`
}

/** A plain background over the whole canvas. */
export const backdrop = (fill, bleed = false) =>
  bleed ? `<rect x="-256" y="-256" width="1536" height="1536" fill="${fill}"/>` : `<rect width="1024" height="1024" fill="${fill}"/>`

export const edgeBand = (fill, bleed = false) => {
  const { x, w, bottom } = span(bleed)
  return bleed
    ? `<rect x="${x}" y="${EDGE_Y}" width="${w}" height="${bottom - EDGE_Y}" fill="${fill}"/>`
    : `<rect x="0" y="${EDGE_Y}" width="1024" height="${1024 - EDGE_Y}" fill="${fill}"/>`
}

/** Top-to-bottom gradient. With `bleed` it is pinned to the 1024 canvas (and pads beyond it), so the colours match. */
export const gradient = (id, top, bottom, bleed = false) =>
  bleed
    ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1024"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`
    : `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`

// ---- accessories (mascot units) --------------------------------------------------------------------

// pointy witch hat, tilted a little, brim resting on the crown between the ears
export const witchHat = `<g transform="rotate(-9 0 -160)">
  <path d="M-30 -164 C-25 -196 -10 -224 24 -246 C15 -222 17 -192 30 -164 Z" fill="#3B2752"/>
  <path d="M-30 -164 C-25 -196 -10 -224 24 -246 C10 -226 -6 -200 -12 -164 Z" fill="#FFFFFF" opacity=".07"/>
  <path d="M-29.2 -170 C-12 -175 12 -175 29.6 -170 L28.6 -178 C10 -183 -10 -183 -27.6 -178 Z" fill="#F0A04B"/>
  <rect x="-5" y="-181" width="10" height="11" rx="2" fill="none" stroke="#FCE7CC" stroke-width="2"/>
  <ellipse cx="0" cy="-162" rx="54" ry="9.5" fill="#2E1D42"/>
</g>`

// Santa hat with a white fur brim; the tip flops to the side with a pompom
export const santaHat = `<g transform="rotate(-6 0 -160)">
  <path d="M-40 -166 C-34 -200 -6 -226 30 -222 C52 -220 62 -204 66 -186 C56 -196 44 -202 32 -200 C26 -186 30 -176 40 -166 Z" fill="#D64545"/>
  <path d="M-40 -166 C-34 -200 -6 -226 30 -222 C10 -214 -10 -196 -14 -166 Z" fill="#FFFFFF" opacity=".08"/>
  <rect x="-50" y="-174" width="100" height="18" rx="9" fill="#FFF9F1"/>
  <rect x="-50" y="-174" width="100" height="6" rx="3" fill="#FFFFFF"/>
  <circle cx="66" cy="-184" r="11" fill="#FFF9F1"/>
</g>`

// party hat with stripes and a pompom
export const partyHat = `<g transform="rotate(10 0 -160)">
  <clipPath id="cone"><path d="M-27 -162 L0 -236 L27 -162 Z"/></clipPath>
  <path d="M-27 -162 L0 -236 L27 -162 Z" fill="#6C8CFF"/>
  <g clip-path="url(#cone)" fill="#FFF9F1">
    <path d="M-40 -186 L40 -210 L40 -200 L-40 -176 Z"/>
    <path d="M-40 -214 L40 -238 L40 -228 L-40 -204 Z"/>
  </g>
  <circle cx="0" cy="-238" r="9" fill="#FF7A9A"/>
  <ellipse cx="0" cy="-162" rx="28" ry="5" fill="#4E6AD6"/>
</g>`

// ---- decorations (canvas px) -----------------------------------------------------------------------

export const bat = (x, y, s, r = 0) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})" fill="#1C1028">
  <path d="M0 6 C-6 -2 -16 -8 -30 -6 C-24 -2 -22 4 -24 10 C-18 6 -12 8 -10 12 C-8 8 -4 8 0 10 C4 8 8 8 10 12 C12 8 18 6 24 10 C22 4 24 -2 30 -6 C16 -8 6 -2 0 6 Z"/>
  <path d="M-4 0 L-3 -6 L0 -2 L3 -6 L4 0 Z"/></g>`

export const pumpkin = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-2 -40 C-2 -50 4 -56 10 -58" stroke="#5B7A3A" stroke-width="6" fill="none" stroke-linecap="round"/>
  <ellipse cx="-20" cy="-14" rx="22" ry="28" fill="#E47A25"/>
  <ellipse cx="20" cy="-14" rx="22" ry="28" fill="#E47A25"/>
  <ellipse cx="0" cy="-14" rx="20" ry="30" fill="#F08D35"/>
  <path d="M-34 -14 C-34 -30 -26 -40 -18 -42 M34 -14 C34 -30 26 -40 18 -42" stroke="#C9631A" stroke-width="2" fill="none" opacity=".6"/>
  <path d="M-15 -22 L-8 -32 L-1 -22 Z M1 -22 L8 -32 L15 -22 Z" fill="#3B1D0B"/>
  <path d="M-24 -10 Q0 10 24 -10 Q20 2 12 6 L9 1 L5 7 L0 2 L-5 7 L-9 1 L-12 6 Q-20 2 -24 -10 Z" fill="#3B1D0B"/></g>`

export const snowflake = (x, y, s, o = 0.9) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" opacity="${o}">
  <path d="M0 -12 V12 M-10.4 -6 L10.4 6 M-10.4 6 L10.4 -6 M0 -12 L-3 -9 M0 -12 L3 -9 M0 12 L-3 9 M0 12 L3 9"/></g>`

export const egg = (x, y, s, base, pattern, r = 0) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">
  <path d="M0 -34 C16 -34 26 -12 26 4 C26 20 14 30 0 30 C-14 30 -26 20 -26 4 C-26 -12 -16 -34 0 -34 Z" fill="${base}"/>
  <path d="M-25 -2 Q-12 -9 0 -2 Q12 5 25 -2 L25.6 4 Q12 11 0 4 Q-12 -3 -25.6 4 Z" fill="${pattern}"/>
  <circle cx="-9" cy="-16" r="3" fill="${pattern}"/><circle cx="9" cy="-16" r="3" fill="${pattern}"/><circle cx="0" cy="17" r="3.4" fill="${pattern}"/>
  <path d="M-12 -24 C-16 -16 -18 -8 -18 0" stroke="#FFFFFF" stroke-width="3" fill="none" opacity=".45" stroke-linecap="round"/></g>`

export const confetti = [
  [150, 170, '#6C8CFF', 20], [270, 110, '#FF7A9A', -30], [820, 150, '#FFF9F1', 15], [900, 300, '#6C8CFF', -10],
  [110, 360, '#FFF9F1', 40], [760, 80, '#7FD1AE', 60], [400, 70, '#7FD1AE', -50], [930, 520, '#FF7A9A', 25],
  [80, 560, '#7FD1AE', -20], [640, 120, '#FF7A9A', 10],
].map(([x, y, c, r]) => `<rect x="${x - 18}" y="${y - 8}" width="36" height="16" rx="4" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join('')

// ---- the seasonal variants (25.10) -----------------------------------------------------------------

/** The snow ledge of the Christmas variant: soft rounded drifts on top, white fading to a cool blue. */
function snowLedge(bleed) {
  const E = EDGE_Y
  const left = bleed ? `M-256 ${E + 4} Q-190 ${E - 22} -120 ${E - 2} Q-60 ${E - 24} 0 ${E + 6}` : `M0 ${E + 6}`
  const right = bleed ? ` Q1090 ${E - 24} 1150 ${E - 2} Q1220 ${E - 22} 1280 ${E + 4} L1280 1280 L-256 1280 Z` : `
      L1024 1024 L0 1024 Z`
  return `<path d="${left} Q50 ${E - 22} 110 ${E - 2} Q170 ${E - 26} 240 ${E - 4} Q320 ${E - 20} 400 ${E - 2}
      Q512 ${E - 14} 624 ${E - 2} Q700 ${E - 22} 780 ${E - 4} Q850 ${E - 26} 915 ${E - 2} Q975 ${E - 20} 1024 ${E + 4}${right}" fill="url(#snow)"/>`
}

/** The grass tufts of the Easter variant (with `bleed` they continue past both sides). */
function grass(bleed) {
  const from = bleed ? -7 : 0
  const to = bleed ? 32 : 25
  return Array.from({ length: to - from + 1 }, (_, k) => {
    const i = from + k
    const x = 10 + i * 40
    return `<path d="M${x} ${EDGE_Y + 4} L${x + 8} ${EDGE_Y - 22 - (((i % 3) + 3) % 3) * 6} L${x + 16} ${EDGE_Y + 4} Z" fill="#7CC46E"/>`
  }).join('')
}

/** dark, halloween, christmas, easter, birthday — the full-bleed variants of docs/brand/variants as SVG text. */
export function seasonalScenes({ bleed = false } = {}) {
  const { x, w } = span(bleed)
  return {
    // the icon on a dark background (dark mode, dark profile pages); the edge stays in the brand orange
    dark: scene({
      defs: gradient('bgDark', '#2C2C2E', '#1C1C1E', bleed),
      background: backdrop('url(#bgDark)', bleed),
      edge: edgeBand('#DC7B2C', bleed),
    }),
    halloween: scene({
      defs: gradient('bgNight', '#2A1B3D', '#4B2D63', bleed)
        + '<radialGradient id="moonGlow"><stop offset="0" stop-color="#FCE7CC" stop-opacity=".35"/><stop offset="1" stop-color="#FCE7CC" stop-opacity="0"/></radialGradient>',
      background: backdrop('url(#bgNight)', bleed),
      behind: `<circle cx="800" cy="220" r="160" fill="url(#moonGlow)"/><circle cx="800" cy="220" r="78" fill="#FCE7CC"/>
      <circle cx="772" cy="200" r="13" fill="#EFC79B" opacity=".6"/><circle cx="822" cy="248" r="9" fill="#EFC79B" opacity=".6"/>
      ${bat(200, 210, 2.3, -12)}${bat(310, 120, 1.5, 10)}${bat(690, 360, 1.3, -6)}`,
      scale: 4,
      hat: witchHat,
      // a night-dark ledge, so the pumpkin and the paws stand out
      edge: edgeBand('#24152F', bleed) + `<rect x="${x}" y="${EDGE_Y}" width="${w}" height="10" fill="#5A3A78"/>`,
      front: pumpkin(905, 868, 2.4),
    }),
    christmas: scene({
      background: backdrop('url(#bgWinter)', bleed),
      behind: [[140, 160, 2.2], [300, 90, 1.4], [860, 140, 2], [760, 300, 1.2], [110, 420, 1.3], [920, 470, 1.6], [520, 60, 1.1]]
        .map(([sx, sy, s]) => snowflake(sx, sy, s)).join(''),
      scale: 4,
      hat: santaHat,
      // a snow ledge: soft rounded drifts on top, white fading to a cool blue
      defs: gradient('bgWinter', '#1F3A5F', '#2E5A8A', bleed) + gradient('snow', '#FFFFFF', '#CFE0F0'),
      edge: snowLedge(bleed),
    }),
    easter: scene({
      defs: gradient('bgSpring', '#D9F0D0', '#B6E0A8', bleed),
      background: backdrop('url(#bgSpring)', bleed),
      edge: edgeBand('#7CC46E', bleed) + grass(bleed),
      front: egg(110, 862, 2.4, '#FFB3C7', '#FFF9F1', -10) + egg(915, 870, 2.2, '#9FD3FF', '#FFE08A', 12),
    }),
    birthday: scene({
      background: backdrop('url(#bg)', bleed),
      behind: confetti,
      scale: 4,
      hat: partyHat,
      edge: edgeBand('#E5923D', bleed),
    }),
  }
}
