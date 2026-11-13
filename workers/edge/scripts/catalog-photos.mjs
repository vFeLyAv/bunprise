// Finds the real product photo of every "Ideen" catalogue item (workers/edge/src/giftIdeas/catalog.de.json).
// The app shows it only through our Worker (GET /api/gift-ideas/img/<art>/<id>, src/giftIdeas/photo.ts): the
// device never contacts a shop. Run by hand, NEVER in CI or in the Worker:
//   node workers/edge/scripts/catalog-photos.mjs [--only id,id] [--dry]
//
// Per item: the shop page of its offer — robots.txt respected, at most one request every 2 s per shop — →
// the product picture the page itself names (JSON-LD Product image, else og:image: the same reader as our
// link preview, src/html/extract.ts) → that picture is fetched the way the Worker will fetch it (its user
// agent, no cookies, no referrer, redirects followed by hand, https only) and kept only if it is a real
// raster image (magic bytes = declared type, never SVG), at most 2 MB and at least 300 px on its shorter side.
// Writes `image_source` (the final https URL after redirects — the Worker fetches only that host) into the
// catalogue, or removes it when nothing usable was found (the app then shows our drawing).
// Felix 25.10: real photos for the CLOSED pilot only; they stay the shops' pictures (copyright note:
// docs/handoffs/2026-10-25-catalog-photos.md). Before an open launch: licensed partner-feed images instead.

import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The Worker's sources import without extensions ("../text"); Node needs ".ts" (type stripping, Node ≥ 23.6).
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw error
    }
  },
})
const { extract } = await import('../src/html/extract.ts')
const { PHOTO_MAX_BYTES, PHOTO_USER_AGENT } = await import('../src/giftIdeas/photoRules.ts')

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const file = resolve(here, '../src/giftIdeas/catalog.de.json')
const dry = args.includes('--dry')
const only = new Set((option('--only') ?? '').split(',').filter(Boolean))
const raw = readFileSync(file, 'utf8')
const catalogue = JSON.parse(raw)
const items = catalogue.items.filter((item) => only.size === 0 || only.has(item.id))

// Pages: the same browser-like agent as check-catalog.mjs (many shops answer bots with a challenge page).
const PAGE_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const GAP_MS = 2000
const TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 4 * 1024 * 1024
const MIN_SIDE = 300
const lastVisit = new Map()
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function politely(host) {
  const wait = (lastVisit.get(host) ?? 0) + GAP_MS - Date.now()
  lastVisit.set(host, Math.max(Date.now(), (lastVisit.get(host) ?? 0) + GAP_MS))
  if (wait > 0) await sleep(wait)
}

async function readCapped(response, limit) {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); return null }
    chunks.push(value)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

// ---- robots.txt (group "*": longest matching rule wins, Allow wins a tie; * and $ wildcards) ------------

const robotsCache = new Map()

function ruleRegex(path) {
  const anchored = path.endsWith('$')
  const body = (anchored ? path.slice(0, -1) : path).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

function parseRobots(text) {
  const rules = []
  let agents = []
  let inRules = false
  for (const line of text.split(/\r?\n/)) {
    const [key, ...rest] = line.replace(/#.*/, '').split(':')
    const field = key?.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (!field) continue
    if (field === 'user-agent') {
      if (inRules) { agents = []; inRules = false }
      agents.push(value.toLowerCase())
    } else if (field === 'allow' || field === 'disallow') {
      inRules = true
      if (agents.includes('*') && value) rules.push({ allow: field === 'allow', length: value.length, regex: ruleRegex(value) })
    }
  }
  return rules
}

async function robotsAllow(url) {
  const origin = url.origin
  if (!robotsCache.has(origin)) {
    let rules = []
    try {
      await politely(url.host)
      const response = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': PAGE_AGENT } })
      if (response.ok) rules = parseRobots(await response.text())
    } catch { /* no robots.txt = no rules */ }
    robotsCache.set(origin, rules)
  }
  const path = `${url.pathname}${url.search}`
  let best = null
  for (const rule of robotsCache.get(origin)) {
    if (!rule.regex.test(path)) continue
    if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule
  }
  return !best || best.allow
}

// ---- the picture, fetched like the Worker fetches it -------------------------------------------------

// A pre-check only: the Worker checks the magic bytes again on every fetch (src/linkImage.ts readImage).
// (src/linkImage.ts and src/shopIcon.ts cannot be loaded here: Node's type stripping rejects their classes.)
const text = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length))
function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (/^GIF8[79]a$/.test(text(bytes, 0, 6))) return 'image/gif'
  if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (text(bytes, 4, 4) === 'ftyp' && /avi[fs]/.test(text(bytes, 8, 24))) return 'image/avif'
  return undefined
}
/** Pixel size from the header (PNG, GIF, WebP, JPEG); undefined when it cannot be read. */
function dimensions(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (type === 'image/png' && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) }
  if (type === 'image/gif' && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  if (type === 'image/webp' && bytes.length >= 30) {
    const kind = text(bytes, 12, 4)
    if (kind === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) }
    if (kind === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    if (kind === 'VP8L') { const bits = view.getUint32(21, true); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) } }
  }
  if (type === 'image/jpeg') {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) return undefined
      const marker = bytes[offset + 1]
      const length = view.getUint16(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
      }
      offset += 2 + length
    }
  }
  return undefined
}

/** Shopify's image CDN scales on request: 800 px is plenty for a card and keeps the bytes small. */
function smaller(url) {
  const shopify = url.hostname === 'cdn.shopify.com' || url.pathname.includes('/cdn/shop/')
  if (shopify && !url.searchParams.has('width')) url.searchParams.set('width', '800')
  return url
}

async function checkPicture(candidate) {
  let current = smaller(new URL(candidate))
  for (let hop = 0; hop <= 4; hop += 1) {
    if (current.protocol !== 'https:' || current.username || current.password) return { reason: 'not https' }
    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': PHOTO_USER_AGENT, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) return { reason: 'redirect without target' }
      current = new URL(location, current)
      continue
    }
    if (!response.ok) { void response.body?.cancel(); return { reason: `picture HTTP ${response.status}` } }
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg')
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(mime)) { void response.body?.cancel(); return { reason: `picture type ${mime || '?'}` } }
    const bytes = await readCapped(response, PHOTO_MAX_BYTES)
    if (!bytes) return { reason: 'picture > 2 MB' }
    if (sniff(bytes) !== mime) return { reason: 'bytes are not the declared type' }
    if (mime !== 'image/avif') {
      const size = dimensions(bytes, mime)
      if (size && Math.min(size.width, size.height) < MIN_SIDE) return { reason: `picture too small (${size.width}×${size.height})` }
    }
    return { source: current.href, bytes: bytes.byteLength, type: mime }
  }
  return { reason: 'too many redirects' }
}

async function findPhoto(item) {
  const offer = [...item.offers].sort((a, b) => a.price_cents - b.price_cents)[0]
  const page = new URL(offer.url)
  if (!(await robotsAllow(page))) return { reason: 'robots.txt disallows the page' }
  await politely(page.host)
  let html
  let finalUrl
  try {
    const response = await fetch(page.href, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': PAGE_AGENT, Accept: 'text/html' } })
    if (!response.ok) { void response.body?.cancel(); return { reason: `page HTTP ${response.status}` } }
    const bytes = await readCapped(response, MAX_PAGE_BYTES)
    if (!bytes) return { reason: 'page > 4 MB' }
    html = new TextDecoder('utf-8').decode(bytes)
    finalUrl = response.url
  } catch (error) {
    return { reason: `page: ${error.name}` }
  }
  const candidate = extract(html, new URL(finalUrl).hostname, finalUrl).image_url
  if (!candidate) return { reason: 'page names no picture' }
  try {
    return await checkPicture(candidate)
  } catch (error) {
    return { reason: `picture: ${error.name}` }
  }
}

// ---- run: shops in parallel, each shop politely in turn ------------------------------------------------

const byShop = new Map()
for (const item of items) {
  const host = new URL(item.offers[0].url).host
  byShop.set(host, [...(byShop.get(host) ?? []), item])
}
const results = new Map()
const queue = [...byShop.values()]
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let group = queue.shift(); group; group = queue.shift()) {
    for (const item of group) {
      const result = await findPhoto(item)
      results.set(item.id, result)
      console.log(`${result.source ? 'PHOTO ' : 'NONE  '} ${item.id}  ${result.source ? `${result.type} ${Math.round(result.bytes / 1024)} KB  ${new URL(result.source).host}` : result.reason}`)
    }
  }
}))

let found = 0
for (const item of catalogue.items) {
  const result = results.get(item.id)
  if (!result) continue
  if (result.source) { item.image_source = result.source; found += 1 }
  else delete item.image_source
}
console.log(`\n${found} of ${results.size} items have a photo; ${results.size - found} keep the drawing.`)
if (!dry) {
  writeFileSync(file, `${JSON.stringify(catalogue, null, 2)}\n`)
  console.log(`written: ${file}`)
}
