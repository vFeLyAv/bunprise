import { decodeEntities, extract, parseGtin, parsePrice, readTag, resolveImageUrl, stripTags } from '../html/extract'
import type { ExtractedMetadata, Tag } from '../html/extract'
import { cut, sanitize } from '../text'

/**
 * Amazon product pages carry no og:* tags and no JSON-LD Product, and they are 2.5–3 MB large.
 * This adapter reads the few stable element ids of the detail page instead. Like extract.ts it
 * only uses forward indexOf scans inside bounded windows, never a backtracking regex on the page.
 */

export const AMAZON_SITE = 'Amazon'
/** Amazon pages get a larger read cap than other shops (1 MiB); still streamed and byte-counted. */
export const AMAZON_MAX_HTML_BYTES = 1.5 * 1024 * 1024

// Storefronts checked on 2026-10-22. amazon.at and amazon.ch are no shops: they redirect to
// amazon.de, and that redirect target is canonicalised like any other hop.
const storefronts = new Set([
  'de', 'com', 'co.uk', 'fr', 'it', 'es', 'nl', 'se', 'pl', 'com.be', 'ie', 'com.tr',
])

const TAG_WINDOW = 32 * 1024
const TAG_LOOKBEHIND = 16 * 1024
const TEXT_WINDOW = 8 * 1024
const PRICE_WINDOW = 16 * 1024
const BULLETS_WINDOW = 48 * 1024
const DETAILS_WINDOW = 64 * 1024
const HEAD_MAX = 256 * 1024
const MAX_ID_HITS = 64
const MAX_TEXT_NODES = 600
const MAX_BULLETS = 5
const DESCRIPTION_MAX = 500
const TITLE_MAX = 120
const BRAND_MAX = 80
const COLOR_MAX = 60

const imageIds = ['landingImage', 'imgBlkFront', 'ebooksImgBlkFront'] as const
// Buy-box blocks of the page's own product, in priority order. The twister JSON (other variants)
// and carousels of other products are never read.
const priceBlocks = [
  'corePriceDisplay_desktop_feature_div', 'corePrice_feature_div', 'apex_desktop', 'apex_offerDisplay_desktop',
] as const
const detailSections = [
  'productOverview_feature_div', 'productDetails_techSpec_section_1', 'productDetails_detailBullets_sections1',
  'detailBullets_feature_div', 'prodDetails', 'tech',
] as const
const brandLabels = ['marke', 'brand', 'marque', 'marca', 'merk', 'märke', 'marka']
const colorLabels = ['farbe', 'colour', 'color', 'couleur', 'colore', 'kleur', 'färg', 'kolor']
const gtinLabels = ['ean', 'gtin', 'ean-13', 'upc', 'isbn-13']
const robotCheckMarkers = [
  '/errors/validateCaptcha',
  'Geben Sie die Zeichen unten ein',
  'Enter the characters you see below',
  'Type the characters you see in this image',
  'Saisissez les caractères que vous voyez',
  'Inserisci i caratteri visualizzati',
  'Introduce los caracteres que aparecen',
]
// Byline texts are at most a few dozen characters; every pattern is anchored with a bounded group.
const bylinePatterns = [
  /^Besuche den (.{1,80}?)-Store$/i,
  /^Besuchen Sie den (.{1,80}?)-Store$/i,
  /^Visit the (.{1,80}?) Store$/i,
  /^Visiter la boutique (.{1,80})$/i,
  /^Visita lo Store di (.{1,80})$/i,
  /^Visita la tienda de (.{1,80})$/i,
  /^Bezoek de (.{1,80}?)[- ]winkel$/i,
  /^Besök (.{1,80}?)-butiken$/i,
  /^Odwiedź sklep (.{1,80})$/i,
  /^(?:Marke|Brand|Marque|Marca|Merk|Märke|Marka) ?: ?(.{1,80})$/i,
]

interface Found {
  /** Index of the element's `<`. */
  start: number
  /** Index just after the element's start tag. */
  end: number
  tag: Tag
}

/** The storefront TLD ("de", "co.uk", …) of an Amazon shop hostname, else undefined. */
export function amazonTld(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const rest = host.startsWith('www.') ? host.slice(4) : host
  if (!rest.startsWith('amazon.')) return undefined
  const tld = rest.slice('amazon.'.length)
  return storefronts.has(tld) ? tld : undefined
}

export function isAmazonHost(hostname: string): boolean {
  return amazonTld(hostname) !== undefined
}

/** ASIN from /dp/X, /dp/product/X, /gp/product/X, /gp/aw/d/X, also behind /-/en/<slug>/. */
export function amazonAsin(url: URL): string | undefined {
  const segments = url.pathname.split('/', 24)
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]?.toLowerCase()
    const next = segments[index + 1]?.toLowerCase()
    let candidate: string | undefined
    if (segment === 'dp') candidate = next === 'product' ? segments[index + 2] : segments[index + 1]
    else if (segment === 'gp' && next === 'product') candidate = segments[index + 2]
    else if (segment === 'gp' && next === 'aw' && segments[index + 2]?.toLowerCase() === 'd') candidate = segments[index + 3]
    else continue
    return candidate && /^[a-z0-9]{10}$/i.test(candidate) ? candidate.toUpperCase() : undefined
  }
  return undefined
}

/** `https://www.amazon.<tld>/dp/<ASIN>`: drops slug, language path, ref, tracking and fragment. */
export function canonicalAmazonUrl(url: URL): URL | undefined {
  const tld = amazonTld(url.hostname)
  const asin = tld ? amazonAsin(url) : undefined
  if (!tld || !asin) return undefined
  if (url.port && url.port !== '80' && url.port !== '443') return undefined
  return new URL(`https://www.amazon.${tld}/dp/${asin}`)
}

function isSpace(character: string | undefined): boolean {
  return character === ' ' || character === '\n' || character === '\t' || character === '\r' || character === '\f'
}

function cleanText(value: string, limit: number): string | undefined {
  return cut(sanitize(stripTags(decodeEntities(value))), limit, true) || undefined
}

/** The element whose id attribute is exactly `id` (not data-…-id), searching from `from`. */
function findById(html: string, id: string, from = 0): Found | undefined {
  const needle = `id="${id}"`
  let cursor = from
  for (let hits = 0; hits < MAX_ID_HITS; hits++) {
    const hit = html.indexOf(needle, cursor)
    if (hit < 0) return undefined
    cursor = hit + needle.length
    if (!isSpace(html[hit - 1])) continue
    const lookbehind = Math.max(0, hit - TAG_LOOKBEHIND)
    const relative = html.slice(lookbehind, hit).lastIndexOf('<')
    if (relative < 0) continue
    const start = lookbehind + relative
    const tag = readTag(html.slice(start, start + TAG_WINDOW), 0)
    // An unterminated start tag (still streaming, or hostile) has no name and is skipped.
    if (tag?.name && !tag.closing && tag.attributes.get('id') === id) return { start, end: start + tag.end, tag }
  }
  return undefined
}

/** Text of a simple element (no nested element of the same name) inside a bounded window. */
function elementText(html: string, found: Found | undefined, limit: number): string | undefined {
  if (!found) return undefined
  const window = html.slice(found.end, found.end + TEXT_WINDOW)
  const close = window.indexOf(`</${found.tag.name}`)
  return close < 0 ? undefined : cleanText(window.slice(0, close), limit)
}

/** Visible text runs of a bounded fragment; script/style/template contents and comments skipped. */
function textNodes(fragment: string): string[] {
  const nodes: string[] = []
  let cursor = 0
  while (cursor < fragment.length && nodes.length < MAX_TEXT_NODES) {
    const start = fragment.indexOf('<', cursor)
    const text = sanitize(decodeEntities(fragment.slice(cursor, start < 0 ? fragment.length : start)))
    if (text) nodes.push(text)
    if (start < 0) break
    if (fragment.startsWith('<!--', start)) {
      const end = fragment.indexOf('-->', start + 4)
      if (end < 0) break
      cursor = end + 3
      continue
    }
    const tag = readTag(fragment, start)
    if (!tag?.name) {
      cursor = start + 1
      continue
    }
    cursor = tag.end
    if (!tag.closing && (tag.name === 'script' || tag.name === 'style' || tag.name === 'template')) {
      const close = fragment.indexOf(`</${tag.name}`, cursor)
      if (close < 0) break
      cursor = close
    }
  }
  return nodes
}

function normalizeLabel(value: string): string {
  return value.replaceAll('&rlm;', '').replaceAll('&lrm;', '').replace(/[\s:]+$/, '').trim().toLowerCase()
}

/** Value next to a label in the product overview / technical details / detail bullets. */
function detailValue(html: string, labels: readonly string[]): string | undefined {
  for (const id of detailSections) {
    const found = findById(html, id)
    if (!found) continue
    const nodes = textNodes(html.slice(found.end, found.end + DETAILS_WINDOW))
    for (let index = 0; index + 1 < nodes.length; index++) {
      if (!labels.includes(normalizeLabel(nodes[index] ?? ''))) continue
      const value = (nodes[index + 1] ?? '').replaceAll('&rlm;', '').replaceAll('&lrm;', '').trim()
      if (value && !labels.includes(normalizeLabel(value))) return value
    }
  }
  return undefined
}

function hasClass(tag: Tag, name: string): boolean {
  return (tag.attributes.get('class') ?? '').split(/[\t\n\f\r ]+/).includes(name)
}

/** Inner HTML of the span starting at `tagEnd`, matching nested spans; bounded by the window. */
function spanInner(window: string, tagEnd: number): string | undefined {
  let depth = 1
  let cursor = tagEnd
  for (let steps = 0; steps < 64; steps++) {
    const open = window.indexOf('<span', cursor)
    const close = window.indexOf('</span', cursor)
    if (close < 0) return undefined
    if (open >= 0 && open < close) {
      depth++
      cursor = open + 5
    } else {
      depth--
      if (depth === 0) return window.slice(tagEnd, close)
      cursor = close + 6
    }
  }
  return undefined
}

function textAfter(fragment: string, marker: string): string {
  const at = fragment.indexOf(marker)
  if (at < 0) return ''
  const start = at + marker.length
  const end = fragment.indexOf('<', start)
  return end < 0 ? '' : sanitize(decodeEntities(fragment.slice(start, Math.min(end, start + 64))))
}

function euroPrice(text: string): number | null {
  // Only euro amounts: "186,00 €", "186,00€", "EUR 186,00". "$", "£" or no currency → null.
  if (!text.includes('€') && !/EUR/i.test(text)) return null
  return parsePrice(text, 'EUR')
}

/** Price of one a-price span: its a-offscreen text, else whole + decimal + fraction + symbol. */
function spanPrice(inner: string): number | null {
  const offscreen = textAfter(inner, 'class="a-offscreen">')
  if (offscreen) return euroPrice(offscreen)
  const whole = textAfter(inner, 'class="a-price-whole">')
  const fraction = textAfter(inner, 'class="a-price-fraction">')
  const decimal = textAfter(inner, 'class="a-price-decimal">') || ','
  const symbol = textAfter(inner, 'class="a-price-symbol">')
  if (!whole) return null
  return euroPrice(`${whole}${fraction ? `${decimal}${fraction}` : ''}${symbol}`)
}

function blockPrice(html: string, block: Found): number | null {
  const window = html.slice(block.start, block.start + PRICE_WINDOW)
  let fallback: number | null = null
  let cursor = 0
  for (let spans = 0; spans < 400; spans++) {
    const start = window.indexOf('<span', cursor)
    if (start < 0) break
    const tag = readTag(window, start)
    if (!tag?.name) break
    cursor = tag.end
    if (tag.closing || !hasClass(tag, 'a-price')) continue
    const classes = tag.attributes.get('class') ?? ''
    const toPay = /pricetopay|price-to-pay/i.test(classes)
    // Strike-through list prices ("UVP") and unit prices use a-text-price / data-a-strike.
    const struck = tag.attributes.get('data-a-strike') === 'true' || (hasClass(tag, 'a-text-price') && !toPay)
    if (struck) continue
    const inner = spanInner(window, tag.end)
    const price = inner === undefined ? null : spanPrice(inner)
    if (toPay) return price
    fallback ??= price
  }
  return fallback
}

/** EUR price of the page's own buy box, or null (unavailable product, other currency, no block). */
export function amazonPrice(html: string): number | null {
  for (const id of priceBlocks) {
    const block = findById(html, id)
    const price = block ? blockPrice(html, block) : null
    if (price !== null) return price
  }
  return null
}

function allowedImage(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const url = resolveImageUrl(decodeEntities(raw), undefined)
  if (!url || url.protocol !== 'https:') return undefined
  const host = url.hostname
  return host === 'm.media-amazon.com' || /^images-[a-z]{2}\.ssl-images-amazon\.com$/.test(host) ? url.href : undefined
}

/** Largest picture of data-a-dynamic-image: entity-encoded JSON `{ "<url>": [width, height] }`. */
function largestDynamicImage(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 16 * 1024) return undefined
  let data: unknown
  try {
    data = JSON.parse(decodeEntities(raw))
  } catch {
    return undefined
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  let best: string | undefined
  let bestArea = -1
  for (const [url, size] of Object.entries(data).slice(0, 50)) {
    if (!Array.isArray(size)) continue
    const [width, height] = size as unknown[]
    if (typeof width !== 'number' || typeof height !== 'number') continue
    const area = width * height
    const allowed = Number.isFinite(area) && area > bestArea ? allowedImage(url) : undefined
    if (allowed) {
      best = allowed
      bestArea = area
    }
  }
  return best
}

function amazonImage(html: string): string | undefined {
  for (const id of imageIds) {
    const found = findById(html, id)
    if (!found) continue
    const attributes = found.tag.attributes
    const image = allowedImage(attributes.get('data-old-hires')) ??
      largestDynamicImage(attributes.get('data-a-dynamic-image')) ?? allowedImage(attributes.get('src'))
    if (image) return image
  }
  return undefined
}

function bylineBrand(html: string): string | undefined {
  const text = elementText(html, findById(html, 'bylineInfo'), 200)
  if (!text) return undefined
  for (const pattern of bylinePatterns) {
    const match = pattern.exec(text)?.[1]?.trim()
    if (match) return cut(match, BRAND_MAX, true)
  }
  return undefined
}

function selectedColor(html: string): string | undefined {
  const inline = elementText(html, findById(html, 'inline-twister-expanded-dimension-text-color_name'), COLOR_MAX)
  if (inline) return inline
  const variation = findById(html, 'variation_color_name')
  if (variation) {
    const window = html.slice(variation.end, variation.end + TEXT_WINDOW)
    const text = textAfter(window, 'class="selection">')
    if (text) return cut(text, COLOR_MAX, true)
  }
  const detail = detailValue(html, colorLabels)
  return detail ? cut(detail, COLOR_MAX, true) : undefined
}

function detailGtin(html: string): string | null {
  const value = detailValue(html, gtinLabels)
  if (!value) return null
  for (const part of value.split(/[,;]/, 4)) {
    const gtin = parseGtin(part.trim())
    if (gtin) return gtin
  }
  return null
}

interface Bullets {
  text: string | undefined
  /** The list has fully arrived (or will never fit the window). */
  complete: boolean
}

function featureBullets(html: string, found = findById(html, 'feature-bullets')): Bullets {
  if (!found) return { text: undefined, complete: false }
  const window = html.slice(found.end, found.end + BULLETS_WINDOW)
  const listEnd = window.indexOf('</ul>')
  if (listEnd < 0) return { text: undefined, complete: window.length >= BULLETS_WINDOW }
  const list = window.slice(0, listEnd)
  const items: string[] = []
  let cursor = 0
  while (items.length < MAX_BULLETS) {
    const start = list.indexOf('<li', cursor)
    if (start < 0) break
    const tag = readTag(list, start)
    if (!tag?.name) break
    cursor = tag.end
    if (tag.name !== 'li' || tag.closing || hasClass(tag, 'aok-hidden') || hasClass(tag, 'a-hidden')) continue
    const end = list.indexOf('</li', cursor)
    const item = cleanText(list.slice(cursor, end < 0 ? list.length : end), DESCRIPTION_MAX)
    if (item) items.push(item)
  }
  let text = ''
  for (const item of items) {
    const next = text ? `${text} · ${item}` : item
    if (next.length > DESCRIPTION_MAX) break
    text = next
  }
  return { text: text || items[0], complete: true }
}

/** `<title>` without "Amazon.de: …" prefix and " : Amazon.de: <category>" suffix. */
function pageTitle(html: string): string | undefined {
  const head = html.slice(0, HEAD_MAX)
  let cursor = 0
  for (let attempts = 0; attempts < 8; attempts++) {
    const start = head.indexOf('<title', cursor)
    if (start < 0) return undefined
    const tag = readTag(head, start)
    if (!tag?.name) return undefined
    cursor = tag.end
    if (tag.name !== 'title') continue
    const end = head.indexOf('</title', tag.end)
    if (end < 0) return undefined
    let title = sanitize(decodeEntities(head.slice(tag.end, Math.min(end, tag.end + 2048))))
    const suffix = title.search(/ ?: ?Amazon\.[a-z.]{2,6}(?: ?:|$)/i)
    const prefix = /^Amazon\.[a-z.]{2,6} ?: ?/i.exec(title)?.[0]
    if (suffix > 0) title = title.slice(0, suffix)
    else if (prefix) {
      title = title.slice(prefix.length)
      // "Amazon.com: <name> : <category>"
      const category = title.lastIndexOf(' : ')
      if (category > 0) title = title.slice(0, category)
    } else if (/^Amazon\.[a-z.]{2,6}$/i.test(title)) title = ''
    return title.trim() || undefined
  }
  return undefined
}

/** Meta description without "Amazon.de: <category> - " and without repeating the title. */
function metaDescription(description: string | null, title: string | undefined): string | undefined {
  if (!description) return undefined
  let text = description
  const prefix = /^Amazon\.[a-z.]{2,6} ?: ?/i.exec(text)?.[0]
  if (prefix) {
    text = text.slice(prefix.length)
    const at = title ? text.indexOf(title) : -1
    if (at >= 0 && at <= 200) text = text.slice(at)
    else {
      const dash = text.indexOf(' - ')
      if (dash >= 0 && dash <= 120) text = text.slice(dash + 3)
    }
  }
  if (title && title.length >= 8) {
    for (let repeats = 0; repeats < 3 && text.startsWith(title); repeats++) {
      text = text.slice(title.length).replace(/^[\s.:,;|-]{1,8}/, '')
    }
  }
  return cut(text.trim(), DESCRIPTION_MAX, true) || undefined
}

/** Robot check / captcha / error page instead of a product page. */
export function isAmazonRobotCheck(html: string): boolean {
  if (findById(html, 'productTitle')) return false
  const head = html.slice(0, HEAD_MAX)
  if (robotCheckMarkers.some((marker) => head.includes(marker))) return true
  return html.length < 64 * 1024 && head.includes('api-services-support@amazon.com')
}

/** Answer for a robot check: never the captcha page's own title, image or text. */
export function amazonBlocked(): ExtractedMetadata {
  return {
    site: AMAZON_SITE, title: null, price_cents: null, currency: null, partial: true,
    image_url: null, description: null, brand: null, color: null, gtin: null,
  }
}

export function extractAmazon(html: string, pageUrl: URL): ExtractedMetadata {
  if (isAmazonRobotCheck(html)) return amazonBlocked()
  const headEnd = html.indexOf('</head>')
  const head = html.slice(0, headEnd >= 0 ? Math.min(headEnd + 7, HEAD_MAX) : HEAD_MAX)
  // Generic head metadata (meta description; og:* / JSON-LD should Amazon ever add them).
  const generic = extract(head, pageUrl.hostname, pageUrl)
  const fullTitle = pageTitle(html)
  const productTitle = elementText(html, findById(html, 'productTitle'), TITLE_MAX)
  const title = productTitle ?? (fullTitle ? cut(fullTitle, TITLE_MAX, true) : undefined)
  const price = amazonPrice(html)
  const brand = bylineBrand(html) ?? detailValue(html, brandLabels)
  return {
    site: AMAZON_SITE,
    title: title ?? null,
    price_cents: price,
    currency: price === null ? null : 'EUR',
    partial: !title,
    image_url: amazonImage(html) ?? null,
    description: featureBullets(html).text ?? metaDescription(generic.description, fullTitle) ?? null,
    brand: brand ? cut(brand, BRAND_MAX, true) : null,
    color: selectedColor(html) ?? null,
    gtin: detailGtin(html),
  }
}

/**
 * Early-stop check for the streaming reader: title, picture, buy-box price and the complete
 * feature bullets (the description) have arrived. Positions found once are remembered, and new
 * searches start near the previous end, so repeated checks do not rescan the whole page.
 */
export function createAmazonProgress(): (html: string) => boolean {
  const positions = new Map<string, Found>()
  let scanned = 0
  const locate = (html: string, id: string): Found | undefined => {
    const known = positions.get(id)
    if (known) return known
    const found = findById(html, id, Math.max(0, scanned - TAG_WINDOW))
    if (found) positions.set(id, found)
    return found
  }
  return (html) => {
    try {
      const title = locate(html, 'productTitle')
      const image = imageIds.some((id) => locate(html, id) !== undefined)
      const bullets = locate(html, 'feature-bullets')
      if (!title || !image || !bullets || !featureBullets(html, bullets).complete) return false
      return amazonPrice(html) !== null
    } finally {
      scanned = html.length
    }
  }
}
