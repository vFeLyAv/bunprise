// Renders public/og.png (1200×630): the static, non-personal link preview that index.html
// points to (og:image). Deterministic, like scripts/icons.mjs. Run from the repo root:
//   node apps/web/scripts/og.mjs
//
// Same character as the app icon: the bunny drawing (#bunny-head, #bunny-paws and their gradients)
// is taken from the defs block of public/icons/icon.svg, so a change to the icon shows up here too.
//
// Fonts: resvg does not know the browser font stack, so the text needs real font files. We pass the
// Windows system font Segoe UI (Bold + Semibold) via fontFiles. The letters end up as pixels inside
// og.png; the font file itself is never copied into the repo or shipped to users.
// On another OS: OG_FONT_DIR=/path/to/fonts (a folder with segoeuib.ttf and seguisb.ttf).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(root, 'public')

// German like the other static OG tags in index.html (pilot in Germany); nothing about any person.
const TITLE = 'Bunprise'
const TAGLINE = 'Pläne und Wünsche an einem Ort'

const W = 1200
const H = 630
// tokens.css: accent-300, accent-400, text, accent-700; EDGE = the edge colour of icon.svg
const BG_TOP = '#F6C07E'
const BG_BOTTOM = '#F0A04B'
const EDGE = '#E5923D'
const TEXT = '#1D1D1F'
const TEXT_2 = '#7F3F12'

// the bunny: same units as in icon.svg, where the edge line is y = -60 (mascot units)
const EDGE_Y = 556
const SCALE = 3.05
const BUNNY = `translate(${W / 2} ${EDGE_Y + 60 * SCALE}) scale(${SCALE})`

const FONT_DIR = process.env.OG_FONT_DIR ?? 'C:/Windows/Fonts'
const FONT_FILES = ['segoeuib.ttf', 'seguisb.ttf'].map((file) => resolve(FONT_DIR, file))

function fail(message) {
  console.error(`og: ${message}`)
  process.exit(1)
}

for (const file of FONT_FILES) {
  // never fall back silently to another font: the preview would look different on every machine
  if (!existsSync(file)) fail(`font not found: ${file} (set OG_FONT_DIR)`)
}

const icon = readFileSync(resolve(publicDir, 'icons', 'icon.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const defs = icon.match(/<defs>([\s\S]*?)<\/defs>/)?.[1]
if (!defs || !defs.includes('id="bunny-head"') || !defs.includes('id="bunny-paws"')) {
  fail('public/icons/icon.svg has no defs block with #bunny-head and #bunny-paws')
}

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${defs}
    <linearGradient id="og-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#og-bg)"/>
  <text x="${W / 2}" y="132" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="104" letter-spacing="-2" fill="${TEXT}">${escapeXml(TITLE)}</text>
  <text x="${W / 2}" y="196" text-anchor="middle" font-family="Segoe UI" font-weight="600" font-size="38" fill="${TEXT_2}">${escapeXml(TAGLINE)}</text>
  <use href="#bunny-head" transform="${BUNNY}"/>
  <rect y="${EDGE_Y}" width="${W}" height="${H - EDGE_Y}" fill="${EDGE}"/>
  <use href="#bunny-paws" transform="${BUNNY}"/>
</svg>`

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: W },
  font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Segoe UI' },
})
const png = resvg.render().asPng()
// performance-plan.md 7.3: og:image ≤ 150 KB (messengers fetch it for every shared link)
if (png.length > 150 * 1024) fail(`og.png would be ${(png.length / 1024).toFixed(1)} KB, the budget is 150 KB`)
writeFileSync(resolve(publicDir, 'og.png'), png)
console.log(`og: og.png (${W}×${H}, ${(png.length / 1024).toFixed(1)} KB)`)
