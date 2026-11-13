import { cut, sanitize } from '../text'

export interface ExtractedMetadata {
  site: string
  title: string | null
  price_cents: number | null
  currency: 'EUR' | null
  partial: boolean
  image_url: string | null
  description: string | null
  brand: string | null
  color: string | null
  gtin: string | null
}

export interface Tag {
  name: string
  closing: boolean
  attributes: Map<string, string>
  end: number
}

interface ProductDetails {
  /** Raw image URL candidates (unresolved), in document order. */
  images: string[]
  description: string | undefined
  brand: string | undefined
  color: string | undefined
  gtin: string | undefined
}

interface ScanResult {
  meta: Map<string, string>
  title: string | undefined
  productTitle: string | undefined
  productPrice: number | null
  /** Details of the Product that supplied the title, so fields of different products never mix. */
  product: ProductDetails | undefined
  /** href of the first <link rel="image_src">, entity-decoded. */
  imageSrc: string | undefined
  charset: string | undefined
}

const DESCRIPTION_MAX = 500
const BRAND_MAX = 80
const COLOR_MAX = 60
const URL_MAX = 2048
const MAX_IMAGE_CANDIDATES = 8
const MAX_COLORS = 20
const gtinKeys = ['gtin13', 'gtin', 'gtin14', 'gtin12', 'gtin8', 'isbn'] as const
const metaImageKeys = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'] as const

const entities: Readonly<Record<string, string>> = {
  amp: '&', AMP: '&', quot: '"', QUOT: '"', apos: "'", lt: '<', LT: '<', gt: '>', GT: '>',
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', euro: '€', pound: '£', yen: '¥', cent: '¢',
  copy: '©', reg: '®', trade: '™', ndash: '–', mdash: '—', hellip: '…', middot: '·',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•',
  auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê',
  agrave: 'à', Agrave: 'À', aacute: 'á', Aacute: 'Á', acirc: 'â', Acirc: 'Â',
  aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', ccedil: 'ç', Ccedil: 'Ç',
  ntilde: 'ñ', Ntilde: 'Ñ', oacute: 'ó', Oacute: 'Ó', ocirc: 'ô', Ocirc: 'Ô',
  oslash: 'ø', Oslash: 'Ø', uacute: 'ú', Uacute: 'Ú', ucirc: 'û', Ucirc: 'Û',
  iacute: 'í', Iacute: 'Í', times: '×', divide: '÷', plusmn: '±', deg: '°',
}

export function decodeEntities(value: string): string {
  // Every match has a fixed maximum size, including malformed entity input.
  return value.replace(/&(#x[0-9a-f]{1,8}|#[0-9]{1,10}|[a-z][a-z0-9]{1,31});?/gi, (match: string, entity: string) => {
    if (!entity.startsWith('#')) return Object.hasOwn(entities, entity) ? entities[entity] ?? match : match
    const hexadecimal = entity[1]?.toLowerCase() === 'x'
    const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd'
    return String.fromCodePoint(code)
  })
}

function clean(value: string): string {
  return sanitize(decodeEntities(value))
}

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\f\r ]/.test(character)
}

function isName(character: string | undefined): boolean {
  return character !== undefined && /[a-zA-Z0-9:_-]/.test(character)
}

// A forward-only scanner avoids regex backtracking on adversarial markup.
export function readTag(html: string, start: number): Tag | undefined {
  let cursor = start + 1
  const closing = html[cursor] === '/'
  if (closing) cursor++
  const nameStart = cursor
  while (isName(html[cursor])) cursor++
  if (cursor === nameStart) return undefined
  const name = html.slice(nameStart, cursor).toLowerCase()
  const attributes = new Map<string, string>()
  while (cursor < html.length) {
    while (isSpace(html[cursor]) || html[cursor] === '/') cursor++
    if (html[cursor] === '>') return { name, closing, attributes, end: cursor + 1 }
    if (cursor >= html.length) break
    const attributeStart = cursor
    while (cursor < html.length && !isSpace(html[cursor]) && !['=', '>', '/'].includes(html[cursor] ?? '')) cursor++
    if (cursor === attributeStart) {
      cursor++
      continue
    }
    const attribute = html.slice(attributeStart, cursor).toLowerCase()
    while (isSpace(html[cursor])) cursor++
    let value = ''
    if (html[cursor] === '=') {
      cursor++
      while (isSpace(html[cursor])) cursor++
      const quote = html[cursor]
      if (quote === '"' || quote === "'") {
        cursor++
        const valueStart = cursor
        while (cursor < html.length && html[cursor] !== quote) cursor++
        if (cursor >= html.length) return { name: '', closing, attributes, end: html.length }
        value = html.slice(valueStart, cursor++)
      } else {
        const valueStart = cursor
        while (cursor < html.length && !isSpace(html[cursor]) && html[cursor] !== '>') cursor++
        value = html.slice(valueStart, cursor)
      }
    }
    // The first duplicate attribute wins, as it does in an HTML parser.
    if (!attributes.has(attribute)) attributes.set(attribute, value)
  }
  return { name: '', closing, attributes, end: html.length }
}

export function closingTag(lower: string, name: string, from: number): number {
  let cursor = from
  while (cursor < lower.length) {
    const start = lower.indexOf(`</${name}`, cursor)
    if (start < 0) return -1
    const next = lower[start + name.length + 2]
    if (next === '>' || next === '/' || isSpace(next)) return start
    cursor = start + name.length + 2
  }
  return -1
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasType(value: unknown, type: string): boolean {
  const matches = (entry: unknown): boolean => typeof entry === 'string' &&
    (entry === type || entry === `https://schema.org/${type}` || entry === `http://schema.org/${type}`)
  return Array.isArray(value) ? value.some(matches) : matches(value)
}

function validGrouping(value: string, separator: string): boolean {
  const groups = value.split(separator)
  return groups.length > 1 && /^[0-9]{1,3}$/.test(groups[0] ?? '') &&
    groups.slice(1).every((group) => /^[0-9]{3}$/.test(group))
}

export function parsePrice(value: unknown, currency: unknown): number | null {
  if (typeof currency !== 'string' || clean(currency).toUpperCase() !== 'EUR') return null
  if (typeof value === 'number') {
    const cents = Math.round((value + Number.EPSILON) * 100)
    return value >= 0 && Number.isSafeInteger(cents) ? cents : null
  }
  if (typeof value !== 'string' || value.length > 256) return null
  let amount = clean(value).replace(/^EUR\s*/i, '').replace(/\s*EUR$/i, '')
    .replace(/^€\s*/, '').replace(/\s*€$/, '').replace(/\s/g, '')
  if (!/^[0-9]+(?:[.,][0-9]+)*$/.test(amount)) return null
  const comma = amount.lastIndexOf(',')
  const dot = amount.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.'
    const grouping = decimal === ',' ? '.' : ','
    const [whole, fraction, extra] = amount.split(decimal)
    if (whole === undefined || fraction === undefined || extra !== undefined ||
      !/^[0-9]{1,2}$/.test(fraction) || !validGrouping(whole, grouping)) return null
    amount = `${whole.split(grouping).join('')}.${fraction}`
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? ',' : '.'
    const groups = amount.split(separator)
    if (groups.length === 2 && /^[0-9]{1,2}$/.test(groups[1] ?? '')) {
      amount = `${groups[0]}.${groups[1]}`
    } else if (validGrouping(amount, separator)) {
      amount = groups.join('')
    } else return null
  }
  const cents = Math.round(Number(amount) * 100)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
}

function offerPrice(value: unknown): number | null {
  const offers = Array.isArray(value) ? value : [value]
  for (const offer of offers) {
    if (!record(offer)) continue
    const amount = hasType(offer['@type'], 'AggregateOffer') ? offer.lowPrice : offer.price
    const price = parsePrice(amount, offer.priceCurrency)
    if (price !== null) return price
  }
  return null
}

/** Replace markup tags with a space; forward-only, each character is visited a bounded number of times. */
export function stripTags(value: string): string {
  let result = ''
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor)
    if (start < 0) {
      result += value.slice(cursor)
      break
    }
    result += value.slice(cursor, start)
    const next = value[start + 1]
    if (next !== undefined && /[a-zA-Z/!?]/.test(next)) {
      const end = value.indexOf('>', start + 1)
      // An unterminated tag swallows the rest, as it would in a browser.
      if (end < 0) break
      result += ' '
      cursor = end + 1
    } else {
      result += '<'
      cursor = start + 1
    }
  }
  return result
}

function cleanText(value: string, limit: number): string | undefined {
  return cut(sanitize(stripTags(decodeEntities(value))), limit, true) || undefined
}

function imageCandidates(value: unknown): string[] {
  const entries = Array.isArray(value) ? value.slice(0, MAX_IMAGE_CANDIDATES) : [value]
  const candidates: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') candidates.push(entry)
    else if (record(entry)) {
      const url = typeof entry.url === 'string' ? entry.url : entry.contentUrl
      if (typeof url === 'string') candidates.push(url)
    }
  }
  return candidates
}

function brandName(value: unknown): string | undefined {
  const entry = Array.isArray(value) ? value[0] : value
  const name = typeof entry === 'string' ? entry : record(entry) ? entry.name : undefined
  return typeof name === 'string' ? cleanText(name, BRAND_MAX) : undefined
}

function colorName(value: unknown): string | undefined {
  const entries = Array.isArray(value) ? value.slice(0, MAX_COLORS) : [value]
  const names = entries.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const name = sanitize(stripTags(decodeEntities(entry)))
    return name ? [name] : []
  })
  return names.length ? cut(names.join(', '), COLOR_MAX, true) || undefined : undefined
}

export function parseGtin(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value
  if (typeof text !== 'string' || text.length > 64) return null
  const digits = text.replace(/[\s-]/g, '')
  return /^[0-9]{8,14}$/.test(digits) ? digits : null
}

function productDetails(node: Record<string, unknown>): ProductDetails {
  let gtin: string | undefined
  for (const key of gtinKeys) {
    gtin = parseGtin(node[key]) ?? undefined
    if (gtin) break
  }
  return {
    images: imageCandidates(node.image),
    description: typeof node.description === 'string' ? cleanText(node.description, DESCRIPTION_MAX) : undefined,
    brand: brandName(node.brand),
    color: colorName(node.color),
    gtin,
  }
}

/** Absolute http(s) image URL, resolved against the page; no credentials, ports 80/443 only. */
export function resolveImageUrl(raw: string, base: URL | undefined): URL | undefined {
  const value = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > URL_MAX || /[\u0000-\u001f\u007f]/.test(value)) return undefined
  let url: URL
  try {
    url = base ? new URL(value, base) : new URL(value)
  } catch {
    return undefined
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname || url.username || url.password) {
    return undefined
  }
  if (url.port && url.port !== '80' && url.port !== '443') return undefined
  return url.href.length <= URL_MAX ? url : undefined
}

function pickImage(result: ScanResult, base: URL | undefined): string | null {
  const tiers: (string | undefined)[][] = [
    result.product?.images ?? [],
    metaImageKeys.map((key) => result.meta.get(key)),
    [result.imageSrc],
  ]
  // A higher tier always wins; inside a tier an https candidate is preferred.
  for (const tier of tiers) {
    const urls = tier.flatMap((raw) => {
      const url = raw === undefined ? undefined : resolveImageUrl(raw, base)
      return url ? [url] : []
    })
    const chosen = urls.find((url) => url.protocol === 'https:') ?? urls[0]
    if (chosen) return chosen.href
  }
  return null
}

function toBase(value: string | URL | undefined): URL | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function readProducts(text: string, result: ScanResult): void {
  let data: unknown
  try { data = JSON.parse(text) } catch { return }
  const pending: unknown[] = [data]
  // Iteration also handles unusually deeply nested JSON without a call-stack overflow.
  while (pending.length > 0) {
    const node = pending.pop()
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index--) pending.push(node[index])
    } else if (record(node)) {
      if (hasType(node['@type'], 'Product')) {
        if (!result.productTitle && typeof node.name === 'string') {
          result.productTitle = clean(node.name) || undefined
          if (result.productTitle) result.product = productDetails(node)
        }
        result.productPrice ??= offerPrice(node.offers)
      }
      const children = Object.values(node)
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index]
        if (child !== null && typeof child === 'object') pending.push(child)
      }
    }
  }
}

function scan(html: string): ScanResult {
  const result: ScanResult = {
    meta: new Map(), title: undefined, productTitle: undefined, productPrice: null,
    product: undefined, imageSrc: undefined, charset: undefined,
  }
  // HTML tag names are ASCII-insensitive. Full Unicode lowercasing can expand
  // characters (for example İ), shifting offsets relative to the original input.
  const lower = html.replace(/[A-Z]/g, (character) => character.toLowerCase())
  let cursor = 0
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor)
    if (start < 0) break
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4)
      cursor = end < 0 ? html.length : end + 3
      continue
    }
    const tag = readTag(html, start)
    if (!tag) { cursor = start + 1; continue }
    cursor = tag.end
    if (tag.closing) continue
    if (tag.name === 'meta') {
      const content = tag.attributes.get('content')
      for (const attribute of ['property', 'name', 'itemprop']) {
        const key = tag.attributes.get(attribute)?.toLowerCase().trim()
        if (key && content !== undefined && !result.meta.has(key)) {
          const value = clean(content)
          if (value) result.meta.set(key, value)
        }
      }
      const charset = tag.attributes.get('charset')
      if (charset) result.charset ??= charset.trim()
      if (tag.attributes.get('http-equiv')?.toLowerCase() === 'content-type' && content) {
        result.charset ??= /charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(content)?.[1]
      }
    } else if (tag.name === 'link') {
      const href = tag.attributes.get('href')
      const rel = tag.attributes.get('rel')?.toLowerCase().split(/[\t\n\f\r ]+/)
      if (href && result.imageSrc === undefined && rel?.includes('image_src')) result.imageSrc = decodeEntities(href)
    } else if (['script', 'style', 'textarea', 'title', 'xmp'].includes(tag.name)) {
      const end = closingTag(lower, tag.name, cursor)
      if (end < 0) break
      const text = html.slice(cursor, end)
      if (tag.name === 'title') result.title ??= clean(text) || undefined
      if (tag.name === 'script' &&
        tag.attributes.get('type')?.trim().toLowerCase() === 'application/ld+json') readProducts(text, result)
      const close = readTag(html, end)
      cursor = close?.end ?? end + 2
    }
  }
  return result
}

function metaDescription(result: ScanResult): string | undefined {
  for (const key of ['og:description', 'twitter:description', 'description']) {
    const value = result.meta.get(key)
    // Meta content is already entity-decoded; decoding again would turn "&amp;lt;" into "<".
    const text = value === undefined ? undefined : cut(sanitize(stripTags(value)), DESCRIPTION_MAX, true)
    if (text) return text
  }
  return undefined
}

function metadata(result: ScanResult, hostname: string, base: URL | undefined): ExtractedMetadata {
  const host = sanitize(hostname).replace(/^www\./i, '')
  const candidate = result.meta.get('og:site_name')
  const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizedSite = normalize(candidate ?? '')
  const normalizedHost = normalize(hostname)
  const firstLabel = normalize(hostname.split('.').find((label) => label.toLowerCase() !== 'www') ?? '')
  const belongsToHost = normalizedSite.length > 0 && (normalizedHost.includes(normalizedSite)
    || (firstLabel.length >= 3 && normalizedSite.includes(firstLabel)))
  const fullSite = candidate && belongsToHost ? candidate : host
  const site = cut(fullSite, 60)
  let title = result.productTitle ?? result.meta.get('og:title') ?? result.meta.get('twitter:title') ?? result.title
  if (title) {
    for (const separator of [' | ', ' - ', ' – ']) {
      const suffix = `${separator}${fullSite}`
      if (title.toLowerCase().endsWith(suffix.toLowerCase())) title = title.slice(0, -suffix.length).trim()
    }
    title = cut(title, 120, true)
  }
  let price = result.productPrice
  for (const [amount, currency] of [
    ['og:price:amount', 'og:price:currency'],
    ['product:price:amount', 'product:price:currency'],
    ['price', 'pricecurrency'],
  ] as const) {
    price ??= parsePrice(result.meta.get(amount), result.meta.get(currency))
  }
  return {
    site,
    title: title || null,
    price_cents: price,
    currency: price === null ? null : 'EUR',
    partial: !title,
    image_url: pickImage(result, base),
    description: result.product?.description ?? metaDescription(result) ?? null,
    brand: result.product?.brand ?? null,
    color: result.product?.color ?? null,
    gtin: result.product?.gtin ?? null,
  }
}

/** `pageUrl` (the final page URL) resolves relative image URLs; it defaults to https://<hostname>/. */
export function extract(html: string, hostname: string, pageUrl?: string | URL): ExtractedMetadata {
  return metadata(scan(html), hostname, toBase(pageUrl ?? `https://${hostname}/`))
}

export const extractMetadata = extract

export function hasCompleteMetadata(html: string, pageUrl?: string | URL): boolean {
  const result = scan(html)
  // Lower-priority head tags alone are insufficient: a Product may appear in the body.
  // The picture is part of "complete": the Product block usually carries it, else og:image in the head.
  return Boolean(result.productTitle && result.productPrice !== null && result.meta.get('og:site_name') &&
    pickImage(result, toBase(pageUrl)))
}

export function detectHtmlCharset(html: string): string | undefined {
  return scan(html).charset
}
