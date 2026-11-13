import { closingTag, decodeEntities, readTag, resolveImageUrl } from './html/extract'
import { ApiError, isRecord, readBytes, withDeadline } from './http'
import type { Clock, Fetch } from './http'
import { sniffImageType } from './linkImage'
import { fetchPublic } from './net/fetchPublic'
import { createResolver, validateUrl } from './net/ssrf'
import type { Resolver } from './net/ssrf'

// GET /api/shop-icon?host=<hostname> — the shop's real icon, fetched by OUR Worker. The user's device never
// contacts a shop: the app loads these bytes with its access token and shows them as a Blob object URL (the same
// path as the product photos of /api/link-image). Only the shop's public start page and icon files are requested,
// with a fixed header set (no cookies, no client IP, no referrer, no token).
//
// How an icon is found (each request goes through the SSRF-safe fetchPublic: DNS → public IP on every hop,
// ports 80/443, manual redirects, time and size limits; HTML is only scanned as text, never executed):
//   1. https://<host>/ (then https://www.<host>/ if that failed): the <link rel> icons of its <head>
//      (apple-touch-icon, icon with sizes; mask-icon and SVG are ignored), the manifest's icons when no linked
//      icon promises ≥ 64 px;
//   2. the classic paths /apple-touch-icon.png and /favicon.ico (also when the start page is a robot check);
//   3. each download ≤ 256 KiB, its type comes from the bytes (PNG / JPEG / WebP / GIF / ICO; never SVG — an SVG
//      shown through a blob: URL could run script if someone opened it in a tab of our origin);
//      the first square-ish one ≥ 64 px wins, otherwise the best one found (≥ 16 px).
// Results are cached per host (key without a leading "www." / "m."): in memory and, on Cloudflare, in the
// data centre's Cache API — 14 days for an icon, 12 hours for "none". Concurrent requests for one host share
// one lookup. No icon → 404 { error: "not_found" }; the app then keeps its letter tile.

export type IconType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/x-icon'

export interface ShopIcon {
  type: IconType
  bytes: Uint8Array<ArrayBuffer>
  /** Pixel size (for ICO: the largest frame); 0 when the header could not be read. */
  width: number
  height: number
}

/** The Cache API surface we use (caches.default on Cloudflare); injectable for tests. */
export interface IconStore {
  match(request: string): Promise<Response | undefined>
  put(request: string, response: Response): Promise<void>
}

interface ShopIconOptions {
  fetch: Fetch
  resolve?: Resolver
  now?: Clock
  /** undefined = caches.default when it exists; null = memory only */
  store?: IconStore | null
}

type Format = 'png' | 'webp' | 'jpeg' | 'gif' | 'ico' | 'unknown'

export interface IconCandidate {
  url: URL
  /** Promised shorter side in px (from sizes / apple default); 0 = unknown. */
  size: number
  format: Format
}

export interface PageIcons {
  links: IconCandidate[]
  manifest: URL | undefined
}

export const MAX_ICON_BYTES = 256 * 1024
export const GOOD_ICON_PX = 64
const MIN_ICON_PX = 16
const IDEAL_ICON_PX = 180
const APPLE_DEFAULT_PX = 180
const MAX_HEAD_BYTES = 512 * 1024
const MAX_HEAD_READS = 4096
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_LINKS = 64
const MAX_MANIFEST_ICONS = 16
const MAX_ICON_FETCHES = 5
const TOTAL_MS = 9000
const PAGE_MS = 4000
const MANIFEST_MS = 2500
const ICON_MS = 3000
/** A step is not started with less time than this left. */
const MIN_STEP_MS = 250
const POSITIVE_TTL_MS = 14 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 12 * 60 * 60 * 1000
/** A copy taken from the Cache API stays this long in memory (the store keeps the real expiry). */
const STORE_HIT_TTL_MS = 60 * 60 * 1000
const MEMORY_BYTES = 4 * 1024 * 1024
const MEMORY_ENTRIES = 2000
/** Distinct hosts looked up at the same time per isolate; more → 429 Retry-After 5. */
const MAX_RESOLVING = 6
const STORE_MARKER = 'x-bunprise-shop-icon'
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'template'])

const PAGE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
  accept: 'text/html',
  'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
} as const
const ICON_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
  accept: 'image/png,image/webp,image/x-icon,image/*;q=0.8',
} as const
const MANIFEST_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
  accept: 'application/manifest+json,application/json;q=0.9',
} as const

// ---- the host ---------------------------------------------------------------------------------------------------

// Two-label public suffixes (deliberately small: the full Public Suffix List is ~250 KB). A bare suffix is never a
// shop; single labels ("de", "localhost") are rejected anyway.
const PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.tr', 'com.pl', 'com.cn', 'com.mx', 'co.in',
  'co.kr', 'co.za', 'com.es', 'com.ar', 'com.sg', 'com.hk', 'com.tw', 'co.at', 'or.at', 'gv.at', 'ac.at',
  'co.il', 'com.ua', 'co.id', 'com.my', 'com.ph', 'com.vn', 'com.sa', 'com.eg', 'co.th',
])
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/**
 * The cache key of `?host=`: a lower-case (punycode) public hostname without a leading "www." / "m.".
 * Anything that is not a bare hostname — scheme, path, port, user info, IP address, a bare public suffix —
 * is invalid_request; local / internal names and our own host are blocked_target (validateUrl).
 */
export function parseShopHost(raw: string | null, ownHost: string): string {
  const input = (raw ?? '').trim()
  // eslint-disable-next-line no-control-regex
  if (!input || input.length > 253 || /[\u0000- \u007f/\\?#@:%[\]]/.test(input)) throw new ApiError('invalid_request')
  let hostname: string
  try {
    hostname = new URL(`https://${input}/`).hostname
  } catch {
    throw new ApiError('invalid_request')
  }
  hostname = hostname.replace(/\.$/, '')
  const labels = hostname.split('.')
  // the URL parser turns "2130706433" or "0x7f.1" into a dotted IPv4 address: never a shop's name
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || labels.length < 2 || hostname.length > 253 ||
    !labels.every((label) => LABEL.test(label)) || !TLD.test(labels[labels.length - 1] ?? '')) {
    throw new ApiError('invalid_request')
  }
  validateUrl(`https://${hostname}/`, ownHost)
  const key = /^(?:www|m)\.[^.]+\.[^.]+/.test(hostname) ? hostname.slice(hostname.indexOf('.') + 1) : hostname
  if (PUBLIC_SUFFIXES.has(key) || key.split('.').length < 2) throw new ApiError('invalid_request')
  // the key and its www. variant are what gets fetched: both must pass the same checks
  validateUrl(`https://${key}/`, ownHost)
  validateUrl(`https://www.${key}/`, ownHost)
  return key
}

// ---- the start page: <link rel> icons -------------------------------------------------------------------------

const FORMAT_BY_TYPE: Readonly<Record<string, Format | 'svg'>> = {
  'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/ico': 'ico', 'image/icon': 'ico',
  'image/svg+xml': 'svg',
}
const FORMAT_BY_EXTENSION: Readonly<Record<string, Format | 'svg'>> = {
  png: 'png', webp: 'webp', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', ico: 'ico', svg: 'svg', svgz: 'svg',
}

function formatOf(type: string | undefined, url: URL): Format | 'svg' {
  const declared = type?.split(';', 1)[0]?.trim().toLowerCase()
  if (declared && Object.hasOwn(FORMAT_BY_TYPE, declared)) return FORMAT_BY_TYPE[declared] ?? 'unknown'
  const extension = /\.([a-z0-9]{2,4})$/i.exec(url.pathname)?.[1]?.toLowerCase()
  if (extension && Object.hasOwn(FORMAT_BY_EXTENSION, extension)) return FORMAT_BY_EXTENSION[extension] ?? 'unknown'
  return 'unknown'
}

/** The largest square-ish entry of a `sizes` value ("16x16 180x180", "any"); 0 when none. */
export function declaredSize(sizes: string | undefined): number {
  let best = 0
  for (const token of (sizes ?? '').toLowerCase().split(/[\t\n\f\r ]+/).slice(0, 16)) {
    const match = /^(\d{1,4})x(\d{1,4})$/.exec(token)
    if (!match) continue
    const width = Number(match[1])
    const height = Number(match[2])
    if (!width || !height || Math.max(width, height) / Math.min(width, height) > 1.5) continue
    best = Math.max(best, Math.min(width, height))
  }
  return best
}

/**
 * The icons a page links in its <head> (forward-only scan like extract.ts; script/style/comment contents and
 * everything from <body> on are skipped). Relative URLs resolve against <base href> or the page's final URL.
 */
export function parsePageIcons(html: string, pageUrl: URL): PageIcons {
  const lower = html.replace(/[A-Z]/g, (character) => character.toLowerCase())
  const links: IconCandidate[] = []
  let manifest: URL | undefined
  let base = pageUrl
  let baseSeen = false
  let cursor = 0
  while (cursor < html.length && links.length < MAX_LINKS) {
    const start = html.indexOf('<', cursor)
    if (start < 0) break
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4)
      cursor = end < 0 ? html.length : end + 3
      continue
    }
    const tag = readTag(html, start)
    if (!tag) {
      cursor = start + 1
      continue
    }
    cursor = tag.end
    if (tag.closing) {
      if (tag.name === 'head') break
      continue
    }
    if (tag.name === 'body') break
    if (tag.name === 'base') {
      const href = tag.attributes.get('href')
      if (!baseSeen && href) {
        baseSeen = true
        base = resolveImageUrl(decodeEntities(href), pageUrl) ?? base
      }
    } else if (tag.name === 'link') {
      const rel = (tag.attributes.get('rel') ?? '').toLowerCase().split(/[\t\n\f\r ]+/).filter(Boolean)
      const href = tag.attributes.get('href')
      if (!href) continue
      if (rel.includes('manifest')) {
        manifest ??= resolveImageUrl(decodeEntities(href), base)
        continue
      }
      if (rel.includes('mask-icon')) continue
      const apple = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')
      if (!apple && !rel.includes('icon')) continue
      const url = resolveImageUrl(decodeEntities(href), base)
      if (!url) continue
      const format = formatOf(tag.attributes.get('type'), url)
      if (format === 'svg') continue
      const size = declaredSize(tag.attributes.get('sizes')) || (apple ? APPLE_DEFAULT_PX : 0)
      links.push({ url, size, format })
    } else if (RAW_TEXT.has(tag.name)) {
      const end = closingTag(lower, tag.name, cursor)
      if (end < 0) break
      cursor = readTag(html, end)?.end ?? end + 2
    }
  }
  return { links, manifest }
}

/** The icons of a web app manifest (purpose "any" or "maskable"; SVG and junk skipped). */
export function manifestIcons(data: unknown, manifestUrl: URL): IconCandidate[] {
  if (!isRecord(data) || !Array.isArray(data.icons)) return []
  const icons: IconCandidate[] = []
  for (const entry of data.icons.slice(0, MAX_MANIFEST_ICONS)) {
    if (!isRecord(entry) || typeof entry.src !== 'string') continue
    const purpose = typeof entry.purpose === 'string' ? entry.purpose.toLowerCase().split(/\s+/) : ['any']
    if (!purpose.includes('any') && !purpose.includes('maskable')) continue
    const url = resolveImageUrl(entry.src, manifestUrl)
    if (!url) continue
    const format = formatOf(typeof entry.type === 'string' ? entry.type : undefined, url)
    if (format === 'svg') continue
    icons.push({ url, size: declaredSize(typeof entry.sizes === 'string' ? entry.sizes : undefined), format })
  }
  return icons
}

const FORMAT_RANK: Readonly<Record<Format, number>> = { png: 0, webp: 0, unknown: 1, jpeg: 2, gif: 2, ico: 3 }

const promisesGood = (candidate: IconCandidate): boolean => candidate.size >= GOOD_ICON_PX

function sizeRank(size: number): number {
  if (size >= 96 && size <= 256) return 0
  return size > 256 ? 1 : 2
}

function byQuality(a: IconCandidate, b: IconCandidate): number {
  return FORMAT_RANK[a.format] - FORMAT_RANK[b.format] || sizeRank(a.size) - sizeRank(b.size) ||
    Math.abs(a.size - IDEAL_ICON_PX) - Math.abs(b.size - IDEAL_ICON_PX)
}

/**
 * The download order: linked icons promising ≥ 64 px (PNG/WebP first, closest to 180 px), then manifest icons
 * ≥ 64 px, then /apple-touch-icon.png, then the smaller / unknown linked icons, then /favicon.ico. No duplicates.
 */
export function orderCandidates(links: readonly IconCandidate[], manifest: readonly IconCandidate[], origins: readonly string[]): IconCandidate[] {
  const fallback = (path: string, format: Format, size: number): IconCandidate[] =>
    origins.map((origin) => ({ url: new URL(path, origin), size, format }))
  // an unknown size is probably a normal favicon (between the known small ones)
  const smaller = links.filter((candidate) => !promisesGood(candidate))
    .sort((a, b) => (b.size || 24) - (a.size || 24) || FORMAT_RANK[a.format] - FORMAT_RANK[b.format])
  const ordered = [
    ...links.filter(promisesGood).sort(byQuality),
    ...manifest.filter(promisesGood).sort(byQuality),
    ...fallback('/apple-touch-icon.png', 'png', APPLE_DEFAULT_PX),
    ...smaller,
    ...fallback('/favicon.ico', 'ico', 0),
  ]
  const seen = new Set<string>()
  return ordered.filter((candidate) => {
    if (seen.has(candidate.url.href)) return false
    seen.add(candidate.url.href)
    return true
  })
}

// ---- the bytes ----------------------------------------------------------------------------------------------------

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}
function u32le(bytes: Uint8Array, offset: number): number {
  return (u16le(bytes, offset) | (u16le(bytes, offset + 2) << 16)) >>> 0
}
function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}
function u32be(bytes: Uint8Array, offset: number): number {
  return ((u16be(bytes, offset) << 16) | u16be(bytes, offset + 2)) >>> 0
}
function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

const DIB_HEADERS = new Set([12, 40, 56, 108, 124])

/** A Windows icon: directory of 1–64 entries, each pointing at an embedded PNG or BMP inside the file. */
function isIco(bytes: Uint8Array): boolean {
  if (bytes.length < 22 || u16le(bytes, 0) !== 0 || u16le(bytes, 2) !== 1) return false
  const count = u16le(bytes, 4)
  const directoryEnd = 6 + 16 * count
  if (count < 1 || count > 64 || bytes.length < directoryEnd) return false
  for (let index = 0; index < count; index++) {
    const entry = 6 + 16 * index
    const size = u32le(bytes, entry + 8)
    const offset = u32le(bytes, entry + 12)
    if (size < 8 || offset < directoryEnd || offset + size > bytes.length) return false
    const png = sniffImageType(bytes.subarray(offset, offset + 8)) === 'image/png'
    if (!png && !DIB_HEADERS.has(u32le(bytes, offset))) return false
  }
  return true
}

/** The icon's type from its first bytes; HTML, SVG, AVIF and anything unknown → undefined. */
export function sniffIconType(bytes: Uint8Array): IconType | undefined {
  const raster = sniffImageType(bytes)
  if (raster && raster !== 'image/avif') return raster
  return isIco(bytes) ? 'image/x-icon' : undefined
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const [b1 = 0, b2 = 0, b3 = 0, b4 = 0] = bytes.subarray(21, 25)
    return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) }
  }
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { width: 1 + (u16le(bytes, 24) | ((bytes[26] ?? 0) << 16)), height: 1 + (u16le(bytes, 27) | ((bytes[29] ?? 0) << 16)) }
  }
  return undefined
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  let offset = 2
  // bounded: every step moves forward, at most 1024 markers
  for (let steps = 0; steps < 1024 && offset + 9 < bytes.length; steps++) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1] ?? 0
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2
      continue
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(bytes, offset + 7), height: u16be(bytes, offset + 5) }
    }
    const length = u16be(bytes, offset + 2)
    if (length < 2) return undefined
    offset += 2 + length
  }
  return undefined
}

function icoSize(bytes: Uint8Array): { width: number; height: number } {
  let best = { width: 0, height: 0 }
  const count = u16le(bytes, 4)
  for (let index = 0; index < count; index++) {
    const entry = 6 + 16 * index
    const width = bytes[entry] || 256
    const height = bytes[entry + 1] || 256
    if (Math.min(width, height) > Math.min(best.width, best.height)) best = { width, height }
  }
  return best
}

/** Width and height from the image header (ICO: its largest frame); undefined when unreadable. */
export function imageDimensions(bytes: Uint8Array, type: IconType): { width: number; height: number } | undefined {
  switch (type) {
    case 'image/png':
      return bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR' ? { width: u32be(bytes, 16), height: u32be(bytes, 20) } : undefined
    case 'image/gif':
      return bytes.length >= 10 ? { width: u16le(bytes, 6), height: u16le(bytes, 8) } : undefined
    case 'image/webp':
      return webpSize(bytes)
    case 'image/jpeg':
      return jpegSize(bytes)
    case 'image/x-icon':
      return icoSize(bytes)
  }
}

function toIcon(bytes: Uint8Array<ArrayBuffer>): ShopIcon | undefined {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) return undefined
  const type = sniffIconType(bytes)
  if (!type) return undefined
  const size = imageDimensions(bytes, type)
  return { type, bytes, width: size?.width ?? 0, height: size?.height ?? 0 }
}

const shorterSide = (icon: ShopIcon): number => Math.min(icon.width, icon.height)
const squareish = (icon: ShopIcon): boolean =>
  shorterSide(icon) > 0 && Math.max(icon.width, icon.height) / shorterSide(icon) <= 1.34
const isGood = (icon: ShopIcon): boolean => squareish(icon) && shorterSide(icon) >= GOOD_ICON_PX

function better(a: ShopIcon, b: ShopIcon): boolean {
  if (squareish(a) !== squareish(b)) return squareish(a)
  return shorterSide(a) > shorterSide(b)
}

function discard(response: Response): void {
  void response.body?.cancel().catch(() => {})
}

function mimeOf(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

/** Icon files arrive with all kinds of labels (image/x-icon, octet-stream, none); documents never pass. */
function plausibleIconType(mime: string): boolean {
  if (!mime) return true
  if (/svg|html|xml|json|javascript|text\//.test(mime)) return false
  return mime.startsWith('image/') || ['application/octet-stream', 'binary/octet-stream', 'application/x-icon', 'application/ico'].includes(mime)
}

async function readIcon(response: Response, signal: AbortSignal): Promise<ShopIcon> {
  if (!plausibleIconType(mimeOf(response))) {
    discard(response)
    throw new ApiError('unsupported_content')
  }
  const icon = toIcon(await readBytes(response, MAX_ICON_BYTES, signal))
  if (!icon) throw new ApiError('unsupported_content')
  return icon
}

/** The page up to its </head> (or <body>), at most 512 KiB; undefined when the answer is not HTML. */
async function readHead(response: Response, signal: AbortSignal): Promise<string | undefined> {
  const mime = mimeOf(response)
  if (mime !== 'text/html' && mime !== 'application/xhtml+xml') {
    discard(response)
    return undefined
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  let html = ''
  let total = 0
  try {
    for (let reads = 0; reads < MAX_HEAD_READS && total < MAX_HEAD_BYTES; reads++) {
      if (signal.aborted) throw new ApiError('timeout')
      const { done, value } = await reader.read()
      if (signal.aborted) throw new ApiError('timeout')
      if (done) break
      const chunk = value.subarray(0, MAX_HEAD_BYTES - total)
      total += chunk.byteLength
      const from = Math.max(0, html.length - 8)
      html += decoder.decode(chunk, { stream: true })
      const recent = html.slice(from).replace(/[A-Z]/g, (character) => character.toLowerCase())
      if (recent.includes('</head') || recent.includes('<body')) break
    }
    return html + decoder.decode()
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

// ---- the memory cache (bounded by bytes) ------------------------------------------------------------------------

class IconMemory {
  private readonly entries = new Map<string, { icon: ShopIcon | null; expires: number }>()
  private bytes = 0

  constructor(private readonly now: Clock) {}

  get(key: string): ShopIcon | null | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.remove(key)
    if (entry.expires <= this.now()) return undefined
    this.insert(key, entry)
    return entry.icon
  }

  set(key: string, icon: ShopIcon | null, ttlMs: number): void {
    this.remove(key)
    this.insert(key, { icon, expires: this.now() + ttlMs })
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= MEMORY_BYTES && this.entries.size <= MEMORY_ENTRIES) break
      this.remove(oldest)
    }
  }

  private insert(key: string, entry: { icon: ShopIcon | null; expires: number }): void {
    this.entries.set(key, entry)
    this.bytes += entry.icon?.bytes.byteLength ?? 0
  }

  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.bytes -= entry.icon?.bytes.byteLength ?? 0
  }
}

function defaultStore(): IconStore | null {
  try {
    return typeof caches === 'undefined' ? null : caches.default
  } catch {
    return null
  }
}

/** A URL of our own host: the Cache API stores per zone, and nothing outside this module ever asks for it. */
function storeKey(ownHost: string, key: string): string {
  return `https://${ownHost}/api/shop-icon/__cache/v1/${key}`
}

async function readStore(store: IconStore | null, ownHost: string, key: string): Promise<ShopIcon | null | undefined> {
  if (!store) return undefined
  try {
    const response = await store.match(storeKey(ownHost, key))
    if (!response) return undefined
    if (response.headers.get(STORE_MARKER) === 'none') {
      discard(response)
      return null
    }
    // the stored bytes are checked again like a fresh download (type from the bytes, size cap)
    return toIcon(new Uint8Array(await response.arrayBuffer()))
  } catch {
    return undefined
  }
}

async function writeStore(store: IconStore | null, ownHost: string, key: string, icon: ShopIcon | null): Promise<void> {
  if (!store) return
  const maxAge = Math.round((icon ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) / 1000)
  const response = icon
    ? new Response(icon.bytes.slice(), { headers: { 'Content-Type': icon.type, 'Cache-Control': `public, max-age=${maxAge}` } })
    : new Response(null, { headers: { [STORE_MARKER]: 'none', 'Cache-Control': `public, max-age=${maxAge}` } })
  try {
    await store.put(storeKey(ownHost, key), response)
  } catch {
    /* a full or unavailable cache only costs a refetch */
  }
}

/** Waits for a shared lookup, but lets this one request go when its client goes away. */
function untilAborted<T>(job: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return job
  if (signal.aborted) return Promise.reject(new ApiError('timeout'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ApiError('timeout'))
    signal.addEventListener('abort', abort, { once: true })
    job.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** The icon of a validated host key (parseShopHost); rejects with not_found when it has none. */
export function createShopIcon(options: ShopIconOptions) {
  const resolve = options.resolve ?? createResolver(options.fetch)
  const now = options.now ?? Date.now
  const store = options.store === undefined ? defaultStore() : options.store
  const memory = new IconMemory(now)
  const pending = new Map<string, Promise<ShopIcon | null>>()

  const publicFetch = (url: URL, ownHost: string, signal: AbortSignal, headers: Readonly<Record<string, string>>, acceptAll = false) =>
    fetchPublic(url, { fetch: options.fetch, resolve, ownHost, signal, headers, ...(acceptAll ? { acceptStatus: () => true } : {}) })

  async function lookup(key: string, ownHost: string, signal: AbortSignal): Promise<ShopIcon | null> {
    const deadline = now() + TOTAL_MS
    /** Runs one step with its own time limit inside the total budget; undefined when no time is left. */
    const step = async <T>(limitMs: number, operation: (stepSignal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      const left = Math.min(limitMs, deadline - now())
      if (left < MIN_STEP_MS || signal.aborted) return undefined
      return withDeadline(left, operation, signal)
    }

    // 1. the start page (apex, then www.): its icon links, or at least an origin that answers
    let page: { html: string; url: URL } | undefined
    const origins: string[] = []
    let blocked = 0
    let timedOut = false
    const variants = [key, `www.${key}`]
    for (const host of variants) {
      if (origins.includes(`https://${host}`)) continue // the apex already redirected there
      try {
        const start = validateUrl(`https://${host}/`, ownHost)
        const result = await step(PAGE_MS, async (stepSignal) => {
          const { response, url } = await publicFetch(start, ownHost, stepSignal, PAGE_HEADERS, true)
          if (!response.ok) {
            discard(response)
            return { url, html: undefined }
          }
          return { url, html: await readHead(response, stepSignal) }
        })
        if (!result) {
          timedOut = true
          break
        }
        if (!origins.includes(result.url.origin)) origins.push(result.url.origin)
        if (result.html !== undefined) {
          page = { html: result.html, url: result.url }
          break
        }
      } catch (error) {
        if (error instanceof ApiError && error.code === 'blocked_target') blocked++
        if (error instanceof ApiError && error.code === 'timeout') timedOut = true
      }
    }
    if (blocked === variants.length) throw new ApiError('blocked_target')
    // nobody answered: a slow shop is worth another try later, an unknown one is "none"
    if (origins.length === 0) {
      if (timedOut) throw new ApiError('timeout')
      return null
    }

    // 2. what the page links (+ its manifest when no link promises a big icon), then the classic paths
    const found = page ? parsePageIcons(page.html, page.url) : { links: [], manifest: undefined }
    let fromManifest: IconCandidate[] = []
    if (found.manifest && !found.links.some(promisesGood)) {
      const manifestUrl = found.manifest
      try {
        validateUrl(manifestUrl.href, ownHost)
        fromManifest = await step(MANIFEST_MS, async (stepSignal) => {
          const { response, url } = await publicFetch(manifestUrl, ownHost, stepSignal, MANIFEST_HEADERS)
          if (/html|svg|image\//.test(mimeOf(response))) {
            discard(response)
            return []
          }
          const bytes = await readBytes(response, MAX_MANIFEST_BYTES, stepSignal)
          return manifestIcons(JSON.parse(new TextDecoder().decode(bytes)), url)
        }) ?? []
      } catch {
        fromManifest = []
      }
    }

    // 3. download in order: the first good icon wins, else the best one seen
    let best: ShopIcon | undefined
    let downloads = 0
    for (const candidate of orderCandidates(found.links, fromManifest, origins)) {
      if (downloads >= MAX_ICON_FETCHES) break
      try {
        validateUrl(candidate.url.href, ownHost)
      } catch {
        continue // private address, odd port, our own host …: never requested
      }
      downloads++
      let icon: ShopIcon | undefined
      try {
        icon = await step(ICON_MS, async (stepSignal) => {
          const { response } = await publicFetch(candidate.url, ownHost, stepSignal, ICON_HEADERS)
          return readIcon(response, stepSignal)
        })
      } catch {
        continue
      }
      if (!icon) break // out of time
      if (isGood(icon)) return icon
      if (!best || better(icon, best)) best = icon
    }
    if (best && shorterSide(best) >= MIN_ICON_PX) return best
    if (now() >= deadline - MIN_STEP_MS && !best) throw new ApiError('timeout') // ran out of time: not a final "none"
    return null
  }

  return async (key: string, ownHost: string, signal?: AbortSignal): Promise<ShopIcon> => {
    const cached = memory.get(key)
    let job = cached === undefined ? pending.get(key) : Promise.resolve(cached)
    if (!job) {
      if (pending.size >= MAX_RESOLVING) throw new ApiError('rate_limited', 5)
      job = (async () => {
        const stored = await readStore(store, ownHost, key)
        if (stored !== undefined) {
          memory.set(key, stored, Math.min(STORE_HIT_TTL_MS, stored ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS))
          return stored
        }
        // own time limit: a client that leaves does not cancel the lookup the others wait for
        const icon = await withDeadline(TOTAL_MS + 1000, (lookupSignal) => lookup(key, ownHost, lookupSignal))
        memory.set(key, icon, icon ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)
        await writeStore(store, ownHost, key, icon)
        return icon
      })()
      const settled = job
      pending.set(key, settled)
      const clear = () => { if (pending.get(key) === settled) pending.delete(key) }
      settled.then(clear, clear)
    }
    let icon: ShopIcon | null
    try {
      icon = await untilAborted(job, signal)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('fetch_failed')
    }
    if (!icon) throw new ApiError('not_found')
    return icon
  }
}

/** The bytes go back with fixed headers only; the browser may keep them (private) for a week. */
export function shopIconResponse(icon: ShopIcon): Response {
  return new Response(icon.bytes.slice(), {
    status: 200,
    headers: {
      'Content-Type': icon.type,
      'Content-Length': String(icon.bytes.byteLength),
      'Cache-Control': 'private, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}
