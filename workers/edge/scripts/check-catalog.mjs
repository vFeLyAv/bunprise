// Monthly maintenance of the "Ideen" catalogue (workers/edge/src/giftIdeas/catalog.de.json). Run by hand,
// NEVER in CI or in the Worker:   node workers/edge/scripts/check-catalog.mjs [--only id,id] [--file other.json]
//
// For every offer it opens the shop page once (at most one request every 2 s per shop, like a person clicking
// through the list; a "slow down" answer, 429 / 503, is retried once after 20 s), reads the price the page
// itself states for search engines (JSON-LD / product meta — the same reader as our link preview,
// src/html/extract.ts; Shopify shops also in their public <page>.js) and reports:
//   OK       page answers and the price is within 15 % of the catalogue
//   PRICE    price moved by more than 15 %          → update price_cents + checked_at, or drop the item
//   DEAD     404 / 410                              → drop the item or find the new page
//   MOVED    redirected to another page              → check by hand (often "sold out" → category page)
//   BLOCKED  403 / 429 / bot wall                    → check by hand in a browser
//   NOPRICE  page answers but states no EUR price (Shopify shops: also not in <page>.js) → check by hand
// Nothing is changed automatically: a person decides (docs/research/2026-10-25-real-gift-ideas.md).
// Exit code 1 when anything but OK was found.

import { readFileSync } from 'node:fs'
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

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const file = resolve(option('--file') ?? resolve(here, '../src/giftIdeas/catalog.de.json'))
const only = new Set((option('--only') ?? '').split(',').filter(Boolean))
const catalogue = JSON.parse(readFileSync(file, 'utf8'))
const items = (catalogue.items ?? []).filter((item) => only.size === 0 || only.has(item.id))

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const GAP_MS = 2000
const TIMEOUT_MS = 20_000
const MAX_BYTES = 4 * 1024 * 1024
const TOLERANCE = 0.15
const lastVisit = new Map()
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function politely(host) {
  const wait = (lastVisit.get(host) ?? 0) + GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastVisit.set(host, Date.now())
}

async function readText(response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) { await reader.cancel(); break }
    chunks.push(value)
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks))
}

/** Same page? Same site (the last two host labels: eu.nothing.tech = checkout-eu.nothing.tech) and path. */
function samePage(a, b) {
  const clean = (url) => { const u = new URL(url); return `${u.hostname.split('.').slice(-2).join('.')}${u.pathname.replace(/\/$/, '')}` }
  return clean(a) === clean(b)
}

const HEADERS = { 'User-Agent': USER_AGENT, 'Accept-Language': 'de-DE,de;q=0.9', Accept: 'text/html,application/xhtml+xml' }

/** One request; a 429 / 503 (a shop's "slow down") is retried once after 20 s. */
async function open(url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: HEADERS })
    if (attempt > 0 || (response.status !== 429 && response.status !== 503)) return response
    await response.body?.cancel()
    await sleep(20_000)
  }
}

/** Shopify shops state the price in their public product JSON (`<page>.js`, in cents) when the page does not. */
async function shopifyPrice(pageUrl) {
  try {
    const response = await fetch(`${pageUrl.replace(/\/$/, '')}.js`, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { ...HEADERS, Accept: 'application/json' } })
    if (!response.ok) return null
    const product = await response.json()
    return Number.isInteger(product?.price) && product.price > 0 ? product.price : null
  } catch {
    return null
  }
}

async function check(offer) {
  const url = new URL(offer.url)
  await politely(url.hostname)
  let response
  try {
    response = await open(url)
  } catch (error) {
    return { verdict: 'BLOCKED', note: `no answer (${error?.name ?? 'error'})` }
  }
  if (response.status === 404 || response.status === 410) return { verdict: 'DEAD', note: String(response.status) }
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    return { verdict: 'BLOCKED', note: String(response.status) }
  }
  if (!response.ok) return { verdict: 'BLOCKED', note: String(response.status) }
  const html = await readText(response)
  if (!samePage(response.url, offer.url)) return { verdict: 'MOVED', note: response.url }
  const price = extract(html, url.hostname, response.url).price_cents ?? await shopifyPrice(response.url)
  if (price === null) return { verdict: 'NOPRICE', note: '' }
  const change = (price - offer.price_cents) / offer.price_cents
  if (Math.abs(change) > TOLERANCE) return { verdict: 'PRICE', note: `${offer.price_cents} → ${price} (${Math.round(change * 100)} %)`, price }
  return { verdict: 'OK', note: price === offer.price_cents ? '' : `now ${price}`, price }
}

let problems = 0
const json = args.includes('--json')
const results = []
for (const item of items) {
  for (const offer of item.offers) {
    const result = await check(offer)
    if (result.verdict !== 'OK') problems += 1
    results.push({ id: item.id, shop: offer.shop, url: offer.url, ...result })
    if (!json) console.log(`${result.verdict.padEnd(8)} ${item.id.padEnd(40)} ${offer.shop.padEnd(18)} ${result.note}`)
  }
}
if (json) console.log(JSON.stringify(results, null, 2))
else console.log(`\n${results.length} offers checked, ${problems} need a look (${file}).`)
process.exitCode = problems > 0 ? 1 : 0
