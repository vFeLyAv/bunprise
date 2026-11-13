// Renders the PWA icon PNGs from public/icons/icon.svg (design-system-motion.md section 5)
// with @resvg/resvg-js — deterministic, no manual export. Run: npm run icons -w apps/web
//
//   public/icons/icon-192.png, icon-512.png           purpose "any"
//   public/icons/icon-192-maskable.png, -512-maskable  purpose "maskable" (content in the 80 % safe zone)
//   public/apple-touch-icon.png                       180×180, opaque (iOS rounds the corners itself)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(root, 'public')
const source = readFileSync(resolve(publicDir, 'icons', 'icon.svg'), 'utf8')

// the drawing without its outer <svg> element, so it can be placed on a full-bleed background
const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const BACKGROUND = '#F0A04B' // --accent-400 (tokens.css)

const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
const anySvg = source
const maskableSvg = wrap(`<rect width="512" height="512" fill="${BACKGROUND}"/><g transform="translate(51.2 51.2) scale(0.8)">${inner}</g>`)
const appleSvg = wrap(`<rect width="512" height="512" fill="${BACKGROUND}"/>${inner}`)

function render(svg, size, outFile) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: true } })
  const png = resvg.render().asPng()
  const target = resolve(publicDir, outFile)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, png)
  console.log(`icons: ${outFile} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`)
}

render(anySvg, 192, 'icons/icon-192.png')
render(anySvg, 512, 'icons/icon-512.png')
render(maskableSvg, 192, 'icons/icon-192-maskable.png')
render(maskableSvg, 512, 'icons/icon-512-maskable.png')
render(appleSvg, 180, 'apple-touch-icon.png')
