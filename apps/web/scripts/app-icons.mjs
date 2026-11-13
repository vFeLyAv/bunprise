// The home-screen icons to choose from (Felix 27.10: "разные вариации иконки приложения … пункт выбора иконки в
// настройках"; Profil → Einstellungen → App-Symbol, src/features/account/appIcon.ts). Same bunny and same renderer as
// scripts/icons.mjs (@resvg/resvg-js, deterministic). The default icon stays public/icons/* (icons.mjs); every other
// variant gets its own folder:
//
//   public/icons/variants/<id>/icon.svg                the vector (favicon of the browser tab once chosen)
//   public/icons/variants/<id>/icon-192.png, -512.png  manifest purpose "any" (the 192 one is also the picker's preview)
//   public/icons/variants/<id>/icon-192-maskable.png, icon-512-maskable.png
//                                                      purpose "maskable": the whole scene at 80 % around the centre
//                                                      (backgrounds and edges bleed, so the margin stays filled)
//   public/icons/variants/<id>/apple-touch-icon.png    180×180, opaque (iOS rounds the corners itself)
//
// The manifest of each variant is written by the build (vite.config.ts, appIconManifests). None of these files is
// precached by the service worker (vite.config.ts globIgnores, checked by scripts/check-sw.mjs): a device only
// fetches the one it chose.
// Seasonal variants come from docs/brand/variants (scripts/brand-scenes.mjs); the new ones are drawn below.
// Run: npm run icons:variants -w apps/web

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { EDGE_Y, backdrop, edgeBand, gradient, place, scene, seasonalScenes } from './brand-scenes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public', 'icons', 'variants')

/** The bunny's head outline (icon.svg #bunny-head; the hamster has the same body, packages/mascot/src/shapes.ts BODY). */
const HEAD = 'M0 -163 C40 -163 64 -140 67 -112 C70 -92 66 -72 67 -59 C72 -50 75 -42 75 -31 C75 -12 64 -1 50 -1 L-50 -1 C-64 -1 -75 -12 -75 -31 C-75 -42 -72 -50 -67 -59 C-66 -72 -70 -92 -67 -112 C-64 -140 -40 -163 0 -163 Z'
const EARS = [
  'M-24 -160 C-44 -170 -67 -155 -75 -128 C-81 -107 -77 -86 -66 -83 C-56 -81 -53 -96 -53 -111 C-53 -129 -44 -145 -29 -151 Z',
  'M24 -160 C44 -170 67 -155 75 -128 C81 -107 77 -86 66 -83 C56 -81 53 -96 53 -111 C53 -129 44 -145 29 -151 Z',
]

/** The x range a full-width shape covers (with `bleed` 256 px past both sides). */
const across = (bleed) => (bleed ? [-256, 1280] : [0, 1024])

// ---- small drawings (canvas px unless said otherwise) ---------------------------------------------------------

/** A four-pointed sparkle. */
const sparkle = (x, y, r, fill, opacity = 1) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${fill}" opacity="${opacity}"/>`

/** A small pink heart, ≈ 38 px across at scale 1. */
const heart = (x, y, s, r = 0) =>
  `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s})" d="M0 8 C-14 -2 -22 -10 -16 -18 C-11 -24 -3 -22 0 -15 C3 -22 11 -24 16 -18 C22 -10 14 -2 0 8 Z" fill="#FF8FAB"/>`

/** A soft cloud of three circles on a rounded base. */
const cloud = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#FFFFFF" opacity=".92">
  <rect x="-60" y="-4" width="120" height="34" rx="17"/><circle cx="-26" cy="0" r="26"/><circle cx="12" cy="-12" r="34"/><circle cx="44" cy="6" r="20"/></g>`

/** A maple leaf, ≈ 64 units across, its stem pointing down; `veins` a darker shade. */
const leaf = (fill, veins) => `<path d="M0 -32 L7 -18 L17 -24 L14 -8 L30 -12 L24 2 L32 8 L14 13 L17 22 L3 16 L3 30 L-3 30 L-3 16 L-17 22 L-14 13 L-32 8 L-24 2 L-30 -12 L-14 -8 L-17 -24 L-7 -18 Z" fill="${fill}" stroke="${fill}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M0 27 L0 -24 M0 8 L-20 -5 M0 8 L20 -5 M0 -4 L-10 -16 M0 -4 L10 -16" fill="none" stroke="${veins}" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>`
const LEAVES = { red: ['#D9502E', '#A93A1E'], orange: ['#EE8A2B', '#B8601A'], yellow: ['#F2B634', '#C48D12'] }
const placedLeaf = (x, y, s, r, colour) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">${leaf(...LEAVES[colour])}</g>`

// ---- Tapsi, the hamster (packages/mascot/src/hamster.ts, coat "golden"), as a still drawing in mascot units ----

const tapsiDefs = `<linearGradient id="tBody" gradientUnits="userSpaceOnUse" x1="0" y1="-165" x2="0" y2="0"><stop offset="0" stop-color="#FFF9F0"/><stop offset="1" stop-color="#F6E3C9"/></linearGradient>
<radialGradient id="tBelly" gradientUnits="userSpaceOnUse" cx="0" cy="-44" r="56"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".75"/><stop offset=".55" stop-color="#FFFFFF" stop-opacity=".4"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
<linearGradient id="tFold" gradientUnits="userSpaceOnUse" x1="44" y1="-152" x2="70" y2="-132"><stop offset="0" stop-color="#F8C68A"/><stop offset="1" stop-color="#E9AC6C"/></linearGradient>
<clipPath id="tClip"><path d="${HEAD}"/></clipPath>`

/** His head (drawn behind the edge): round ear, folded ear, the golden cap, full cheeks, the icon's bigger eyes. */
const tapsiHead = `<ellipse cx="-44" cy="-150" rx="16" ry="18.5" transform="rotate(-12 -44 -150)" fill="#F8C68A"/>
<ellipse cx="-44.5" cy="-149" rx="8.5" ry="10.5" transform="rotate(-12 -44.5 -149)" fill="#F4A487"/>
<ellipse cx="55" cy="-142.6" rx="16.5" ry="10.4" transform="rotate(34 55 -142.6)" fill="url(#tFold)"/>
<path d="${HEAD}" fill="url(#tBody)"/>
<g clip-path="url(#tClip)"><path d="M9 -175 L9 -158 C2 -148 -24 -122 -66 -112 L-92 -112 L-92 -175 Z" fill="#F8C68A"/><path d="M17 -175 L17 -158 C24 -146 44 -118 70 -106 L92 -106 L92 -175 Z" fill="#F8C68A"/></g>
<ellipse cx="-68" cy="-86" rx="17" ry="27" fill="url(#tBody)"/><ellipse cx="68" cy="-86" rx="17" ry="27" fill="url(#tBody)"/>
<ellipse cx="0" cy="-46" rx="56" ry="50" fill="url(#tBelly)"/>
<g transform="translate(0 -3)">
  <ellipse cx="-47" cy="-81" rx="9" ry="5.5" fill="#FF9E9E" opacity=".35"/><ellipse cx="47" cy="-81" rx="9" ry="5.5" fill="#FF9E9E" opacity=".35"/>
  <ellipse cx="-32" cy="-96" rx="7.6" ry="9.4" fill="#3A2622"/><circle cx="-29.2" cy="-99.6" r="2.4" fill="#FFFFFF"/>
  <ellipse cx="32" cy="-96" rx="7.6" ry="9.4" fill="#3A2622"/><circle cx="34.8" cy="-99.6" r="2.4" fill="#FFFFFF"/>
  <path d="M-4 -91.5 Q0 -93.2 4 -91.5 Q3 -88.4 0 -87.4 Q-3 -88.4 -4 -91.5 Z" fill="#F2899A"/>
  <path d="M0 -87.4 Q0 -84 -3.8 -83.6 M0 -87.4 Q0 -84 3.8 -83.6" fill="none" stroke="#6B4A42" stroke-width="1.5" stroke-linecap="round"/>
</g>`

/** His paws on the edge (drawn in front of it), like the bunny's. */
const tapsiPaws = `<ellipse cx="-24" cy="-56" rx="12.3" ry="5.8" fill="#965A28" fill-opacity=".16"/><ellipse cx="24" cy="-56" rx="12.3" ry="5.8" fill="#965A28" fill-opacity=".16"/>
<ellipse cx="-24" cy="-61.5" rx="12" ry="9.5" fill="#F8C68A"/><ellipse cx="24" cy="-61.5" rx="12" ry="9.5" fill="#F8C68A"/>
<path d="M-29 -59.5 v5 M-24 -59.5 v5 M-19 -59.5 v5 M19 -59.5 v5 M24 -59.5 v5 M29 -59.5 v5" fill="none" stroke="#965A28" stroke-opacity=".38" stroke-width="1.3" stroke-linecap="round"/>`

// ---- the new variants (27.10) ----------------------------------------------------------------------------------

/** One function per variant: `bleed` → the SVG text (1024 canvas). */
const NEW_VARIANTS = {
  // «Nacht»: the navy of the Blau theme (themes/navy.css), a crescent moon and sparkles; the edge keeps the brand orange
  night: (bleed) => scene({
    defs: gradient('bgNavy', '#2A3866', '#121A30', bleed)
      + '<radialGradient id="moonGlow2"><stop offset="0" stop-color="#FCE7CC" stop-opacity=".28"/><stop offset="1" stop-color="#FCE7CC" stop-opacity="0"/></radialGradient>'
      + '<mask id="crescent" maskUnits="userSpaceOnUse" x="600" y="40" width="400" height="400"><rect x="600" y="40" width="400" height="400" fill="#FFFFFF"/><circle cx="832" cy="192" r="76" fill="#000000"/></mask>',
    background: backdrop('url(#bgNavy)', bleed),
    behind: `<circle cx="790" cy="232" r="170" fill="url(#moonGlow2)"/><circle cx="790" cy="232" r="84" fill="#FCE7CC" mask="url(#crescent)"/>
      ${sparkle(206, 196, 34, '#FFF4E0')}${sparkle(352, 112, 20, '#FFF4E0', 0.85)}${sparkle(132, 372, 18, '#FFF4E0', 0.8)}${sparkle(912, 430, 20, '#FFF4E0', 0.85)}${sparkle(600, 120, 14, '#FFF4E0', 0.7)}
      <g fill="#FFF4E0" opacity=".7"><circle cx="272" cy="300" r="6"/><circle cx="476" cy="200" r="5"/><circle cx="86" cy="232" r="5"/><circle cx="960" cy="300" r="6"/><circle cx="690" cy="400" r="4"/></g>`,
    edge: edgeBand('#DC7B2C', bleed),
  }),

  // «Ozean»: a light sea sky with two clouds; he peeks over a wave with a foam crest
  ocean: (bleed) => {
    const [x0, x1] = across(bleed)
    let crest = `M${x0} ${EDGE_Y}`
    for (let x = x0; x < x1; x += 128) crest += ` Q${x + 32} ${EDGE_Y - 18} ${x + 64} ${EDGE_Y} T${x + 128} ${EDGE_Y}`
    const bottom = bleed ? 1280 : 1024
    return scene({
      defs: gradient('bgSky', '#D9F2FF', '#94D2F4', bleed)
        + `<linearGradient id="sea" gradientUnits="userSpaceOnUse" x1="0" y1="${EDGE_Y - 20}" x2="0" y2="1024"><stop offset="0" stop-color="#3AA2E4"/><stop offset="1" stop-color="#1A68AE"/></linearGradient>`,
      background: backdrop('url(#bgSky)', bleed),
      behind: cloud(214, 214, 1.25) + cloud(820, 150, 0.95) + cloud(930, 420, 0.6),
      edge: `<path d="${crest} L${x1} ${bottom} L${x0} ${bottom} Z" fill="url(#sea)"/>
      <path d="${crest}" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" opacity=".92"/>
      <g fill="#FFFFFF" opacity=".55"><circle cx="160" cy="930" r="11"/><circle cx="196" cy="968" r="6"/><circle cx="860" cy="944" r="9"/><circle cx="890" cy="980" r="5"/><circle cx="700" cy="1000" r="6"/></g>`,
    })
  },

  // «Schlicht»: flat, two oranges and ink on paper — the bunny as a stamp, no gradients
  mono: (bleed) => {
    const p = place(4.85)
    return scene({
      background: backdrop('#FFF6EA', bleed),
      // `flat`: the scene draws no bunny of its own; this one is painted here (behind the edge), its paws in front
      behind: `<g transform="${p}">
        <path d="${HEAD}" fill="#F2A65A"/><ellipse cx="-65" cy="-84" rx="12" ry="21" fill="#F2A65A"/><ellipse cx="65" cy="-84" rx="12" ry="21" fill="#F2A65A"/>
        ${EARS.map((d) => `<path d="${d}" fill="#DB8434"/>`).join('')}
        <g transform="translate(0 -4)">
          <ellipse cx="-29" cy="-93" rx="8.3" ry="9.9" fill="#3A2622"/><circle cx="-26.05" cy="-97.82" r="2.55" fill="#FFFFFF"/>
          <ellipse cx="29" cy="-93" rx="8.3" ry="9.9" fill="#3A2622"/><circle cx="31.95" cy="-97.82" r="2.55" fill="#FFFFFF"/>
          <path d="M-3.6 -84 Q0 -86 3.6 -84 Q2.8 -80.8 0 -79.8 Q-2.8 -80.8 -3.6 -84 Z" fill="#3A2622"/>
          <path d="M0 -79.8 L0 -77.6 M0 -77.6 Q-2.2 -75.2 -4.6 -76.2 M0 -77.6 Q2.2 -75.2 4.6 -76.2" fill="none" stroke="#3A2622" stroke-width="1.4" stroke-linecap="round"/>
        </g></g>`,
      edge: edgeBand('#E08A35', bleed),
      front: `<g transform="${p}"><ellipse cx="-25" cy="-61.5" rx="13" ry="10" fill="#FFF6EA"/><ellipse cx="25" cy="-61.5" rx="13" ry="10" fill="#FFF6EA"/>
        <path d="M-30.46 -59.5 v5.5 M-25 -59.5 v5.5 M-19.54 -59.5 v5.5 M19.54 -59.5 v5.5 M25 -59.5 v5.5 M30.46 -59.5 v5.5" fill="none" stroke="#E08A35" stroke-width="1.6" stroke-linecap="round"/></g>`,
      flat: true,
    })
  },

  // «Mit Tapsi»: Pompon and his friend Tapsi peek over the same edge, cheek to ear
  tapsi: (bleed) => {
    const tapsi = place(2.7, 772)
    return scene({
      defs: gradient('bgLilac', '#EEE8FC', '#D2C6F3', bleed) + tapsiDefs,
      background: backdrop('url(#bgLilac)', bleed),
      // two small hearts and a sparkle over the friends
      behind: heart(668, 318, 1.9, -12) + heart(792, 214, 1.2, 14) + sparkle(250, 236, 26, '#FFFFFF', 0.85) + sparkle(900, 380, 18, '#FFFFFF', 0.8),
      scale: 4.1,
      x: 392,
      afterHead: `<g transform="${tapsi}">${tapsiHead}</g>`,
      edge: edgeBand('#E5923D', bleed),
      front: `<g transform="${tapsi}">${tapsiPaws}</g>`,
    })
  },

  // «Herbst»: maple leaves falling on a sage sky, one landed on his head, two on the ledge
  autumn: (bleed) => scene({
    defs: gradient('bgSage', '#DCEADF', '#B4CFBE', bleed),
    background: backdrop('url(#bgSage)', bleed),
    behind: placedLeaf(170, 200, 2.1, -24, 'red') + placedLeaf(330, 96, 1.3, 30, 'yellow') + placedLeaf(860, 170, 1.8, 18, 'orange')
      + placedLeaf(730, 330, 1.1, -40, 'yellow') + placedLeaf(110, 470, 1.2, 50, 'orange') + placedLeaf(935, 470, 1.4, -10, 'red'),
    scale: 4.4,
    hat: `<g transform="translate(-14 -166) rotate(-28) scale(.62)">${leaf(...LEAVES.red)}</g>`,
    edge: edgeBand('#A8663A', bleed) + `<rect x="${across(bleed)[0]}" y="${EDGE_Y}" width="${across(bleed)[1] - across(bleed)[0]}" height="10" fill="#8C5230"/>`,
    front: placedLeaf(120, 900, 1.5, 70, 'yellow') + placedLeaf(905, 912, 1.6, -60, 'orange'),
  }),

  // «Sommer»: blue sky, the sun, sand — and sunglasses
  summer: (bleed) => scene({
    defs: gradient('bgSummer', '#86D0F5', '#DDF4FF', bleed),
    background: backdrop('url(#bgSummer)', bleed),
    behind: `<g stroke="#FFD45C" stroke-width="16" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4 + Math.PI / 8
      const r1 = 104
      const r2 = 138
      return `<path d="M${(820 + r1 * Math.cos(a)).toFixed(1)} ${(196 + r1 * Math.sin(a)).toFixed(1)} L${(820 + r2 * Math.cos(a)).toFixed(1)} ${(196 + r2 * Math.sin(a)).toFixed(1)}"/>`
    }).join('')}</g><circle cx="820" cy="196" r="78" fill="#FFD45C"/><circle cx="820" cy="196" r="58" fill="#FFE07F"/>
      ${cloud(190, 230, 1.05)}`,
    hat: `<g fill="#2A2533">
        <ellipse cx="-28" cy="-96" rx="18" ry="14"/><ellipse cx="28" cy="-96" rx="18" ry="14"/>
      </g>
      <g fill="none" stroke="#FF6F91" stroke-width="3.6" stroke-linecap="round">
        <ellipse cx="-28" cy="-96" rx="18" ry="14"/><ellipse cx="28" cy="-96" rx="18" ry="14"/>
        <path d="M-10 -100 Q0 -105 10 -100 M-46 -99 L-64 -104 M46 -99 L64 -104"/>
      </g>
      <path d="M-38 -102 L-31 -108 M18 -102 L25 -108" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity=".75"/>`,
    edge: edgeBand('#F2D49A', bleed) + `<rect x="${across(bleed)[0]}" y="${EDGE_Y}" width="${across(bleed)[1] - across(bleed)[0]}" height="10" fill="#E6BF7C"/>
      <g fill="#DDB06A" opacity=".7"><circle cx="150" cy="905" r="5"/><circle cx="230" cy="950" r="4"/><circle cx="820" cy="915" r="5"/><circle cx="900" cy="965" r="4"/><circle cx="560" cy="990" r="4"/></g>`,
  }),
}

// ---- writing -------------------------------------------------------------------------------------------------

/** id → (bleed) → SVG text, in the picker's order (src/features/account/appIcon.ts APP_ICONS, without 'classic'). */
export const VARIANTS = {
  dark: (bleed) => seasonalScenes({ bleed }).dark,
  night: NEW_VARIANTS.night,
  ocean: NEW_VARIANTS.ocean,
  mono: NEW_VARIANTS.mono,
  tapsi: NEW_VARIANTS.tapsi,
  birthday: (bleed) => seasonalScenes({ bleed }).birthday,
  easter: (bleed) => seasonalScenes({ bleed }).easter,
  summer: NEW_VARIANTS.summer,
  autumn: NEW_VARIANTS.autumn,
  halloween: (bleed) => seasonalScenes({ bleed }).halloween,
  christmas: (bleed) => seasonalScenes({ bleed }).christmas,
}

/** The scene with bleed, scaled to 80 % around the centre: everything that matters lies in the maskable safe circle. */
export function maskable(svg) {
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><g transform="translate(102.4 102.4) scale(0.8)">${inner}</g></svg>`
}

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  mkdirSync(outDir, { recursive: true })
  // a variant that is no longer drawn here leaves no files behind
  for (const old of readdirSync(outDir)) if (!(old in VARIANTS)) rmSync(resolve(outDir, old), { recursive: true, force: true })
  let total = 0
  for (const [id, draw] of Object.entries(VARIANTS)) {
    const dir = resolve(outDir, id)
    mkdirSync(dir, { recursive: true })
    const any = draw(false)
    const mask = maskable(draw(true))
    const files = {
      'icon.svg': Buffer.from(any),
      'icon-192.png': render(any, 192),
      'icon-512.png': render(any, 512),
      'icon-192-maskable.png': render(mask, 192),
      'icon-512-maskable.png': render(mask, 512),
      'apple-touch-icon.png': render(any, 180),
    }
    let bytes = 0
    for (const [name, data] of Object.entries(files)) {
      writeFileSync(resolve(dir, name), data)
      bytes += data.length
    }
    total += bytes
    console.log(`app icons: ${id} (${(bytes / 1024).toFixed(1)} KB)`)
  }
  console.log(`app icons: ${Object.keys(VARIANTS).length} variants, ${(total / 1024).toFixed(0)} KB in public/icons/variants (not precached)`)
}
