// Logo variants for Felix to choose from (25.10): transparent, dark, and seasonal themes. They live ONLY in
// docs/brand/variants/ until Felix approves one; nothing here is used by the app.
// Same bunny as the app icon: #bunny-head and #bunny-paws come from the defs of public/icons/icon.svg.
// The drawings (scene, accessories, the seasonal variants) live in scripts/brand-scenes.mjs since 27.10: the home-screen
// icons to choose from (scripts/app-icons.mjs) reuse them.
// Run: npm run brand:variants -w apps/web   (also writes preview.png, all variants on one sheet)

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { EDGE_Y, bunnyDefs, place, seasonalScenes } from './brand-scenes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, '..', '..', 'docs', 'brand', 'variants')

const variants = seasonalScenes()

// transparent: the bunny peeking over a rounded ledge, nothing else, cropped to the drawing
const transparent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 280 832 680" width="832" height="680">
${bunnyDefs}
<clipPath id="aboveLedge"><rect x="0" y="0" width="1024" height="${EDGE_Y + 56}"/></clipPath>
<g clip-path="url(#aboveLedge)"><use href="#bunny-head" transform="${place(4.85)}"/></g>
<rect x="104" y="${EDGE_Y}" width="816" height="112" rx="56" fill="#E5923D"/>
<use href="#bunny-paws" transform="${place(4.85)}"/>
</svg>`

// the whole bunny as a round "bun" (no edge, no paws): a compact mark for stickers and small badges
const bun = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-86 -176 172 182" width="860" height="910">
${bunnyDefs}
<use href="#bunny-head"/>
</svg>`

mkdirSync(outDir, { recursive: true })
function save(name, svg, width) {
  writeFileSync(resolve(outDir, `${name}.svg`), svg)
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()
  writeFileSync(resolve(outDir, `${name}.png`), png)
  console.log(`brand variants: ${name} (.svg + .png ${width} px, ${(png.length / 1024).toFixed(1)} KB)`)
  return svg
}

const sheet = []
for (const [name, svg] of Object.entries(variants)) sheet.push([name, save(`bunprise-${name}`, svg, 1024)])
sheet.unshift(['transparent', save('bunprise-transparent', transparent, 1024)])
sheet.push(['bun', save('bunprise-bun', bun, 512)])

// preview.png: every variant as a tile on a neutral checkerboard (shows where it is transparent)
const TILE = 300
const GAP = 24
const cols = 4
const rows = Math.ceil(sheet.length / cols)
const W = cols * TILE + (cols + 1) * GAP
const H = rows * (TILE + 40) + (rows + 1) * GAP
const tiles = sheet.map(([name, svg], i) => {
  const x = GAP + (i % cols) * (TILE + GAP)
  const y = GAP + Math.floor(i / cols) * (TILE + 40 + GAP)
  const data = Buffer.from(svg).toString('base64')
  return `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="24" fill="url(#check)"/>
<clipPath id="tile${i}"><rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="24"/></clipPath>
<image clip-path="url(#tile${i})" x="${x + 10}" y="${y + 10}" width="${TILE - 20}" height="${TILE - 20}" href="data:image/svg+xml;base64,${data}" preserveAspectRatio="xMidYMid meet"/>
<text x="${x + TILE / 2}" y="${y + TILE + 28}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#2A231C">${name}</text>`
}).join('\n')
const preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><pattern id="check" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#FFFFFF"/><rect width="10" height="10" fill="#ECE6DC"/><rect x="10" y="10" width="10" height="10" fill="#ECE6DC"/></pattern></defs>
<rect width="${W}" height="${H}" fill="#F2EBDD"/>
${tiles}
</svg>`
writeFileSync(resolve(outDir, 'preview.png'), new Resvg(preview, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: true } }).render().asPng())
console.log('brand variants: preview.png')
