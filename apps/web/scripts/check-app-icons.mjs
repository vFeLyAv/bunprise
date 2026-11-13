// The home-screen icon variants in the BUILD (Einstellungen → App-Symbol, src/features/account/appIconVariants.ts).
// Part of `npm run size -w apps/web` (after the build, like check-sw.mjs). For every variant it checks dist/:
//   - icons/variants/<id>/manifest.webmanifest exists, is JSON and equals the default manifest.webmanifest in every
//     field but `icons` (same id / start_url / scope: an installed app stays the same app, whichever icon it has),
//   - its four icons (192 / 512, any / maskable) exist with the size they claim, and so do the Apple touch icon
//     (180 × 180) and the tab icon (icon.svg) that the page links,
//   - dist/icons/variants holds no folder of a variant that is not in the list (a stale one would be deployed).
// Exit code 1 on a problem.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { APP_ICON_VARIANTS, appIconLinks } from '../src/features/account/appIconVariants.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const problems = []

/** width × height from a PNG's IHDR chunk, or null when the bytes are no PNG */
function pngSize(file) {
  const bytes = readFileSync(file)
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') return null
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

const basePath = resolve(dist, 'manifest.webmanifest')
if (!existsSync(basePath)) {
  console.error(`check-app-icons: ${basePath} not found — run "npm run build" first`)
  process.exit(1)
}
const base = JSON.parse(readFileSync(basePath, 'utf8'))
const { icons: _baseIcons, ...baseRest } = base

for (const id of APP_ICON_VARIANTS) {
  const links = appIconLinks(id)
  const manifestPath = resolve(dist, links.manifest.slice(1))
  if (!existsSync(manifestPath)) { problems.push(`${id}: ${links.manifest} is missing`); continue }
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { problems.push(`${id}: ${links.manifest} is no JSON`); continue }
  const { icons = [], ...rest } = manifest
  if (!isDeepStrictEqual(rest, baseRest)) problems.push(`${id}: the manifest differs from manifest.webmanifest in more than its icons`)
  const purposes = icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort().join(', ')
  if (purposes !== '192x192 any, 192x192 maskable, 512x512 any, 512x512 maskable') problems.push(`${id}: icons ${purposes || '—'}`)
  for (const icon of icons) {
    const file = resolve(dist, String(icon.src).replace(/^\//, ''))
    if (!existsSync(file)) problems.push(`${id}: ${icon.src} is missing`)
    else if (pngSize(file) !== icon.sizes) problems.push(`${id}: ${icon.src} is ${pngSize(file) ?? 'no PNG'}, the manifest says ${icon.sizes}`)
  }
  const apple = resolve(dist, links.appleTouchIcon.slice(1))
  if (!existsSync(apple) || pngSize(apple) !== '180x180') problems.push(`${id}: ${links.appleTouchIcon} is missing or not 180×180`)
  if (!existsSync(resolve(dist, links.icon.slice(1)))) problems.push(`${id}: ${links.icon} is missing`)
}

const folder = resolve(dist, 'icons', 'variants')
const stale = existsSync(folder) ? readdirSync(folder).filter((name) => !APP_ICON_VARIANTS.includes(name)) : []
for (const name of stale) problems.push(`dist/icons/variants/${name} belongs to no variant (scripts/app-icons.mjs removes old ones from public/)`)

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-app-icons: ${problem}`)
  process.exit(1)
}
console.log(`check-app-icons: ${APP_ICON_VARIANTS.length} home-screen icon variants, each with its manifest (= the default one but the icons) and every file it links`)
