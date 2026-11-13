// Renders the brand kit in docs/brand/ (and the e-mail picture public/email/pompon-peek.png) from the master icon public/icons/icon.svg — the same bunny as the
// app icon, for places outside the app: Telegram bot photo, Brevo sender, Google sign-in screen, profiles.
// Deterministic like scripts/icons.mjs (@resvg/resvg-js). Run: npm run brand -w apps/web
//
//   bunprise-icon.svg               the master as a vector (any size)
//   bunprise-icon-1024/512/120.png  square, full bleed (app stores; 120 = Google OAuth consent screen)
//   bunprise-avatar-1024.png        square, bunny at 90 % so the ears keep a margin when a service
//                                   crops it to a circle (Telegram, Brevo, Google)
//   bunprise-avatar-round-1024.png  the same, already round with transparent corners (for places that
//                                   show the file as it is)

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const master = resolve(root, 'public', 'icons', 'icon.svg')
const outDir = resolve(root, '..', '..', 'docs', 'brand')
const source = readFileSync(master, 'utf8')

// the drawing without its outer <svg> element (as in icons.mjs); its own background reaches past the canvas
const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const BACKGROUND = '#F0A04B' // --accent-400 (tokens.css)
const AVATAR_SCALE = 0.9

const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`
const shifted = (scale) => `<g transform="translate(${512 * (1 - scale)} ${512 * (1 - scale)}) scale(${scale})">${inner}</g>`
const avatarSvg = wrap(`<rect width="1024" height="1024" fill="${BACKGROUND}"/>${shifted(AVATAR_SCALE)}`)
const roundSvg = wrap(`<defs><clipPath id="round"><circle cx="512" cy="512" r="512"/></clipPath></defs>`
  + `<g clip-path="url(#round)"><rect width="1024" height="1024" fill="${BACKGROUND}"/>${shifted(AVATAR_SCALE)}</g>`)

mkdirSync(outDir, { recursive: true })

function render(svg, size, name) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(resolve(outDir, name), png)
  console.log(`brand: ${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`)
}

copyFileSync(master, resolve(outDir, 'bunprise-icon.svg'))
console.log('brand: bunprise-icon.svg (copy of public/icons/icon.svg)')
render(source, 1024, 'bunprise-icon-1024.png')
render(source, 512, 'bunprise-icon-512.png')
render(source, 120, 'bunprise-icon-120.png')
render(avatarSvg, 1024, 'bunprise-avatar-1024.png')
render(roundSvg, 1024, 'bunprise-avatar-round-1024.png')

// The picture in the sign-in code e-mail (supabase/templates/otp.html): the bunny peeking over a rounded ledge,
// transparent, served by the app at /email/pompon-peek.png (2x for a 220 px wide <img>). Not precached.
const bunnyDefs = source.match(/<defs>[\s\S]*?<\/defs>/)[0]
const peekSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 280 832 680">${bunnyDefs}
<clipPath id="aboveLedge"><rect x="0" y="0" width="1024" height="896"/></clipPath>
<g clip-path="url(#aboveLedge)"><use href="#bunny-head" transform="translate(512 1131) scale(4.85)"/></g>
<rect x="104" y="840" width="816" height="112" rx="56" fill="#E5923D"/>
<use href="#bunny-paws" transform="translate(512 1131) scale(4.85)"/></svg>`
const emailPng = new Resvg(peekSvg, { fitTo: { mode: 'width', value: 440 } }).render().asPng()
const emailDir = resolve(root, 'public', 'email')
mkdirSync(emailDir, { recursive: true })
writeFileSync(resolve(emailDir, 'pompon-peek.png'), emailPng)
console.log(`brand: public/email/pompon-peek.png (440 px wide, ${(emailPng.length / 1024).toFixed(1)} KB)`)
