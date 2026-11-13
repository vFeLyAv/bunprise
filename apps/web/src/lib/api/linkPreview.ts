import { domainOf } from '../format'
import { asAccount, bearer } from './identity'

// POST /api/link-preview — our own Worker (workers/edge, SSRF-safe, CLAUDE.md "Security") reads a shop page
// and answers with title, price (EUR only), the shop's name and (2026-10-22) the product details: description,
// brand, colour, GTIN and the URL of the product picture. The browser never talks to the shop: the picture URL is
// NEVER loaded directly (no <img src>, no fetch) — only through our Worker, POST /api/link-image
// (lib/api/linkImage.ts fetchLinkImage), and then uploaded to our database (lib/api/wishPhotos.ts).
// - Pinned to one account like every API wrapper (identity.ts asAccount): the request carries the captured
//   bearer token, and an answer that arrives after that account ended in this tab never reaches the caller.
// - Abortable: the caller passes an AbortSignal and aborts a stale request when the link changes; an abort
//   rejects with the DOMException 'AbortError' (callers ignore it, see isAbortError()).
// - Every failure becomes a LinkPreviewError with one of the Worker's codes (plus 'offline' / 'unavailable'
//   on the client side); the screen falls back to manual input calmly. Nothing from the answer is trusted
//   blindly: the URL must be http(s) ≤ 2048, the title is cleaned and capped at the database limit, a price
//   counts only in EUR within the database range.
// Contract: docs/design/pass/wave1 brief "API contracts"; the Worker is built separately (Codex).

export const LINK_PREVIEW_PATH = '/api/link-preview'

/** = wishes.url check in the database */
export const LINK_PREVIEW_URL_MAX = 2048
/** = wishes.title check in the database (code points) */
const TITLE_MAX = 120
/** a shop name is a short label; longer values are cut (= wishes.shop_name check) */
const SITE_MAX = 80
/** = the wishes detail checks in the database (20261022120000) */
const DESCRIPTION_MAX = 1000
const BRAND_MAX = 80
const COLOR_MAX = 60
/** = wishes.price_cents check in the database (0 … 1 000 000,00 €) */
const PRICE_MAX_CENTS = 100_000_000

export interface LinkPreview {
  /** the cleaned final URL (after redirects, without tracking parameters) — what the wish stores */
  url: string
  /** the shop's name or host, e.g. "shop.example" */
  site: string
  /** null when the page had no usable title (partial) */
  title: string | null
  /** whole cents in EUR; null when no EUR price was found */
  priceCents: number | null
  /** true = no title found: the person types it */
  partial: boolean
  // ---- the product details (Worker contract 2026-10-22); optional only for hand-built fixtures — parseLinkPreview
  //      always sets them (null = not found / not usable)
  /** the product picture's URL (http(s), ≤ 2048): load ONLY via fetchLinkImage(), never directly */
  imageUrl?: string | null
  /** ≤ 1000 characters, whitespace collapsed (line breaks kept) */
  description?: string | null
  /** ≤ 80 characters */
  brand?: string | null
  /** ≤ 60 characters */
  color?: string | null
  /** 8 … 14 digits */
  gtin?: string | null
}

/** The Worker's error codes, plus 'offline' (no network, nothing sent) and 'unavailable' (anything else). */
export type LinkPreviewErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'too_large'
  | 'unsupported_content'
  | 'blocked_target'
  | 'rate_limited'
  | 'fetch_failed'
  | 'timeout'
  | 'offline'
  | 'unavailable'

const WORKER_CODES: ReadonlySet<string> = new Set<LinkPreviewErrorCode>([
  'invalid_request',
  'unauthorized',
  'too_large',
  'unsupported_content',
  'blocked_target',
  'rate_limited',
  'fetch_failed',
  'timeout',
])

const STATUS_CODES: Readonly<Record<number, LinkPreviewErrorCode>> = {
  400: 'invalid_request',
  401: 'unauthorized',
  413: 'too_large',
  415: 'unsupported_content',
  422: 'blocked_target',
  429: 'rate_limited',
  502: 'fetch_failed',
  504: 'timeout',
}

export class LinkPreviewError extends Error {
  readonly code: LinkPreviewErrorCode
  /** 429 only: seconds from the Retry-After header, when it had a usable value */
  readonly retryAfterSeconds: number | undefined

  constructor(code: LinkPreviewErrorCode, options: { retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(`link_preview.${code}`, { cause: options.cause })
    this.name = 'LinkPreviewError'
    this.code = code
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export function isLinkPreviewError(err: unknown): err is LinkPreviewError {
  return err instanceof LinkPreviewError
}

/** An aborted request (a newer link replaced it, the screen closed): not an error to show. */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** http(s) only, ≤ 2048 characters, normalised by URL; anything else → null. */
export function cleanHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    const text = url.toString()
    return text.length > LINK_PREVIEW_URL_MAX ? null : text
  } catch {
    return null
  }
}

/** Control characters (C0, DEL, C1) and bidi overrides never belong in a label: each becomes a space. */
function withoutControls(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)
    out += control ? ' ' : ch
  }
  return out
}

/** Trims, collapses whitespace, drops control characters and caps at 120 code points; '' → null. */
export function cleanPreviewTitle(raw: string): string | null {
  const text = withoutControls(raw).replace(/\s+/g, ' ').trim()
  if (text === '') return null
  const chars = [...text]
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX).join('').trimEnd() : text
}

function cleanSite(raw: unknown, url: string): string {
  const text = typeof raw === 'string' ? withoutControls(raw).replace(/\s+/g, ' ').trim() : ''
  const site = text === '' ? (domainOf(url) ?? '') : text
  const chars = [...site]
  return chars.length > SITE_MAX ? chars.slice(0, SITE_MAX).join('') : site
}

/** A label of at most `max` code points: controls → spaces, whitespace collapsed; '' → null. */
function cleanLabel(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const text = withoutControls(raw).replace(/\s+/g, ' ').trim()
  if (text === '') return null
  const chars = [...text]
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text
}

/** A description: like cleanLabel, but line breaks stay (at most one empty line in a row). */
function cleanDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((line) => withoutControls(line).replace(/\s+/g, ' ').trim())
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text === '') return null
  const chars = [...text]
  return chars.length > DESCRIPTION_MAX ? chars.slice(0, DESCRIPTION_MAX).join('').trimEnd() : text
}

function cleanGtin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[\s-]/g, '')
  return /^[0-9]{8,14}$/.test(digits) ? digits : null
}

function cleanPrice(body: Record<string, unknown>): number | null {
  const cents = body.price_cents
  if (body.currency !== 'EUR' || typeof cents !== 'number' || !Number.isInteger(cents)) return null
  return cents >= 0 && cents <= PRICE_MAX_CENTS ? cents : null
}

/** The 200 answer, validated field by field (null = not a preview at all). */
export function parseLinkPreview(body: unknown, requestedUrl: string): LinkPreview | null {
  if (!isRecord(body)) return null
  const url = (typeof body.url === 'string' ? cleanHttpUrl(body.url) : null) ?? cleanHttpUrl(requestedUrl)
  if (!url) return null
  const title = typeof body.title === 'string' ? cleanPreviewTitle(body.title) : null
  return {
    url,
    site: cleanSite(body.site, url),
    title,
    priceCents: cleanPrice(body),
    partial: body.partial === true || title === null,
    imageUrl: typeof body.image_url === 'string' ? cleanHttpUrl(body.image_url) : null,
    description: cleanDescription(body.description),
    brand: cleanLabel(body.brand, BRAND_MAX),
    color: cleanLabel(body.color, COLOR_MAX),
    gtin: cleanGtin(body.gtin),
  }
}

/** Retry-After as seconds (a number of seconds or an HTTP date); undefined when missing or odd. */
function retryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 3600)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, Math.min(Math.ceil((at - now) / 1000), 3600)) : undefined
}

/** The Worker's error code and Retry-After of a non-2xx answer (shared with linkImage.ts). */
export async function workerErrorOf(response: Response): Promise<{ code: LinkPreviewErrorCode; retryAfterSeconds?: number }> {
  let code: LinkPreviewErrorCode | undefined
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && typeof body.error === 'string' && WORKER_CODES.has(body.error)) code = body.error as LinkPreviewErrorCode
  } catch {
    /* not JSON (e.g. the Worker is not deployed yet): the status decides */
  }
  code ??= STATUS_CODES[response.status] ?? 'unavailable'
  const seconds = code === 'rate_limited' ? retryAfter(response.headers.get('Retry-After')) : undefined
  return seconds === undefined ? { code } : { code, retryAfterSeconds: seconds }
}

async function errorFrom(response: Response): Promise<LinkPreviewError> {
  const { code, retryAfterSeconds } = await workerErrorOf(response)
  return new LinkPreviewError(code, retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
}

export interface LinkPreviewOptions {
  signal?: AbortSignal
  /** the account of the screen (captureEpoch().userId): a request never silently switches accounts */
  expectedUserId?: string
}

/**
 * Reads title, price and shop of `url` through our Worker. Rejects with a LinkPreviewError (or an
 * AbortError when `signal` aborted, or the account boundary's AppError when the account changed).
 */
export async function fetchLinkPreview(url: string, { signal, expectedUserId }: LinkPreviewOptions = {}): Promise<LinkPreview> {
  const target = cleanHttpUrl(url)
  if (!target) throw new LinkPreviewError('invalid_request')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new LinkPreviewError('offline')
  signal?.throwIfAborted()
  return asAccount(expectedUserId, async (account) => {
    let response: Response
    try {
      // same origin (absolute, so the request is the same in the browser and in Node-based tests)
      response = await fetch(new URL(LINK_PREVIEW_PATH, window.location.origin), {
        method: 'POST',
        headers: { Authorization: bearer(account), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: target }),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      if (isAbortError(err)) throw err
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      throw new LinkPreviewError(offline ? 'offline' : 'unavailable', { cause: err })
    }
    if (!response.ok) throw await errorFrom(response)
    let body: unknown
    try {
      body = await response.json()
    } catch (err) {
      if (isAbortError(err)) throw err
      throw new LinkPreviewError('unavailable', { cause: err })
    }
    const preview = parseLinkPreview(body, target)
    if (!preview) throw new LinkPreviewError('unavailable')
    return preview
  })
}
