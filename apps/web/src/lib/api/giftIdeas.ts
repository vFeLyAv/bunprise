import { asAccount, bearer } from './identity'

// POST /api/gift-ideas — the product ideas of "Geschenk finden" (Find Gift, wave 2, Felix 2026-10-20).
//
// ── STABLE CONTRACT ──────────────────────────────────────────────────────────────────────────────────────
// The demo (src/mocks/giftIdeas.ts: invented products and shops) and every real provider later (partner
// feeds — only ever through OUR Worker, workers/edge) answer exactly this. The browser never talks to a shop.
//
// Request — same origin, JSON, `Authorization: Bearer <Supabase access token>`:
//   {
//     "mode": "for_someone" | "for_me",
//     "interests": ["coffee", "plants"],                    // 0–8 ids of GIFT_INTERESTS; [] = not personalised
//     "budget": { "min_cents": 2500, "max_cents": 5000 },   // whole cents, 0 ≤ min ≤ max ≤ 100 000 000
//     "exclude_ids": ["…"],                                 // ≤ 200 idea ids already shown (skipped ones too)
//     "lang": "de" | "en" | "ru" | "uk",                    // the app's UI language (ru/uk since 30.10; older apps
//                                                           //   send de/en) — every text falls back per field:
//                                                           //   ru/uk → en → de, en → de
//     "cursor": "…",                                        // optional: next_cursor of the previous page
//     "topic": "brettspiele",                               // optional (26.10): one shelf of "Stöbern nach
//                                                           //   Thema" instead of a deck — interests [] then
//     "styles": ["athleisure"]                              // optional (27.10): 0–6 taste directions of GIFT_STYLES,
//   }                                                       //   read on the device from the wishes' brands
//   It never carries names, profile / list / occasion ids, wish titles, links or anything else of a
//   wishlist: the interests are derived ON THE DEVICE (features/gifts/interests.ts) and only the chosen
//   category ids leave it. Nothing in it says for whom the ideas are.
//
// Answer 200:
//   {
//     "items": [{
//       "id": "…",                                          // stable per provider, ≤ 64 of [A-Za-z0-9._:-]
//       "title": "…",                                       // in `lang` (or its fallback), ≤ 120 code points
//       "image_url": "/api/gift-ideas/…" | null,            // ONLY a path of our own origin under
//                                                           // /api/gift-ideas/ (the Worker proxies shop
//                                                           // images); anything else is dropped and the
//                                                           // app draws a picture of its own
//       "price_min_cents": 1900, "price_max_cents": 3900,
//       "offers": [{ "shop": "Markt", "price_cents": 2490, "url": "https://…", "sponsored": false }],  // 1–6
//       "interests": ["coffee"]                             // OPTIONAL extension: what it matches
//     }],                                                   //   (the card's "passt zu", "Mehr wie das")
//     "next_cursor": "…" | null,
//     "as_of": "2026-10-20T12:00:00Z" | null,               // OPTIONAL extension: when the prices were read
//     "topics": [{ "id": "brettspiele", "count": 31 }]      // OPTIONAL extension (26.10), first page of a deck:
//   }                                                       //   the shelves and their sizes (shown from 8 on)
//   A topic answer (request with "topic") is the whole shelf in one page (≤ 100); its items MAY carry (OPTIONAL extension,
//   lib/api/giftTopics.ts): "game" { name, publisher, players_min, players_max (null = open-ended, "ab players_min"),
//   minutes_min/max, age_min, award
//   { prize: "sdj" | "kdj", year, nominated? } | null }, "blurb" + "blurb_lang", "how_to_play" + "how_to_play_lang";
//   books: "book", "about" + "about_lang" — each *_lang is the language the text is actually in (the asked one or its
//   fallback). Filters (players, duration, price) work on the device only.
//   `sponsored` = a paid placement or a partner (affiliate) link: the app labels that offer „Anzeige“.
//   Demo pictures: "/api/gift-ideas/demo-art/<art id>" — the app draws those itself (features/gifts/art)
//   and never requests them; a real provider never uses that prefix (it switches on the „Demo“ label).
//   Our own drawings for REAL products (the Worker's catalogue, workers/edge/src/giftIdeas, 25.10.2026):
//   "/api/gift-ideas/art/<art id>" — drawn the same way, never requested, no „Demo“ label.
//   Real product PHOTOS of the catalogue (Felix 25.10, closed pilot): "/api/gift-ideas/img/<art id>/<idea id>" —
//   loaded from our Worker (it fetches the shop's picture; the device never contacts a shop); when it fails,
//   the app draws <art id> instead.
//
// Errors: 400 { error: "invalid_request" } · 401 unauthorized · 429 rate_limited (+ Retry-After) ·
//   404 / 501 = no provider behind the Worker yet (the app then answers from the demo catalogue on the
//   device, features/gifts/demo) · 504 timeout · anything else: unavailable.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Like every API wrapper (contract.md §5.2): pinned to one account (identity.ts asAccount — an answer that
// arrives after that account ended in this tab never reaches the caller), abortable, and nothing of the
// answer is trusted blindly: every field is checked and capped below.

export const GIFT_IDEAS_PATH = '/api/gift-ideas'
/** Pictures are only ever loaded from here (our origin, the Worker's image proxy). */
export const GIFT_IMAGE_PREFIX = '/api/gift-ideas/'
/** The demo's own drawings (features/gifts/art): never fetched. */
export const GIFT_DEMO_ART_PREFIX = '/api/gift-ideas/demo-art/'
/** The same drawings for real products of our catalogue: never fetched, not a demo. */
export const GIFT_ART_PREFIX = '/api/gift-ideas/art/'
/** Real product photos of our catalogue, through the Worker: "<prefix><art id>/<idea id>". */
export const GIFT_PHOTO_PREFIX = '/api/gift-ideas/img/'

/** The shared category vocabulary of client and providers (unknown ids are dropped on both sides). */
export const GIFT_INTERESTS = [
  'audio',
  'coffee',
  'books',
  'outdoor',
  'gaming',
  'games',
  'fashion',
  'beauty',
  'plants',
  'photo',
  'sport',
  'travel',
  'kitchen',
  'music',
  'tech',
  'home',
  'film',
  'creative',
] as const
export type GiftInterest = (typeof GIFT_INTERESTS)[number]

/** Taste directions read on the device (features/gifts/styles.ts) — only these ids leave it (= the Worker's GIFT_STYLES). */
export const GIFT_STYLES = [
  'athleisure', 'outdoor', 'scandi', 'streetwear', 'natural', 'specialty-coffee', 'tea', 'analog', 'cozy', 'kitchen-pro', 'tech', 'gaming',
] as const
export type GiftStyle = (typeof GIFT_STYLES)[number]
export const GIFT_STYLES_MAX = 6
const STYLE_SET: ReadonlySet<string> = new Set(GIFT_STYLES)
export function isGiftStyle(value: unknown): value is GiftStyle {
  return typeof value === 'string' && STYLE_SET.has(value)
}

/** The shelves of "Stöbern nach Thema" the app can show (= the Worker's GIFT_TOPICS; unknown ids are dropped). */
export const GIFT_TOPICS = ['brettspiele', 'buecher', 'kaffee', 'kueche', 'draussen', 'musik', 'kreativ'] as const
export type GiftTopic = (typeof GIFT_TOPICS)[number]

export interface GiftTopicCount {
  id: GiftTopic
  count: number
}

/** The languages of the ideas' texts (= the app's UI languages); the Worker falls back per text: ru/uk → en → de. */
export const GIFT_LANGS = ['de', 'en', 'ru', 'uk'] as const
export type GiftLang = (typeof GIFT_LANGS)[number]
const LANG_SET: ReadonlySet<string> = new Set(GIFT_LANGS)
export function isGiftLang(value: unknown): value is GiftLang {
  return typeof value === 'string' && LANG_SET.has(value)
}

export type GiftIdeasMode = 'for_someone' | 'for_me'

export interface GiftBudget {
  min_cents: number
  max_cents: number
}

export interface GiftIdeasRequest {
  mode: GiftIdeasMode
  interests: GiftInterest[]
  budget: GiftBudget
  exclude_ids: string[]
  lang: GiftLang
  cursor?: string
  /** one shelf instead of a deck (its id only) */
  topic?: GiftTopic
  /** taste directions (never a brand, a wish or a name) */
  styles?: GiftStyle[]
}

export interface GiftOffer {
  /** the shop's display name, ≤ 40 code points */
  shop: string
  price_cents: number
  /** https only */
  url: string
  /** paid placement / partner link → „Anzeige“ */
  sponsored: boolean
}

export interface GiftIdea {
  id: string
  title: string
  /** a path under GIFT_IMAGE_PREFIX on our own origin, or null */
  image_url: string | null
  price_min_cents: number
  price_max_cents: number
  /** 1–4, cheapest first */
  offers: GiftOffer[]
  /** what it matches ([] when the provider does not say) */
  interests: GiftInterest[]
}

export interface GiftIdeasPage {
  items: GiftIdea[]
  next_cursor: string | null
  /** ISO time the prices were read, null when the provider does not say */
  as_of: string | null
  /** the shelves of "Stöbern nach Thema" with their sizes (first page of a deck; absent = none) */
  topics?: GiftTopicCount[]
}

/** = the database limit of a wish price (0 … 1 000 000,00 €); also "no upper limit" of a budget */
export const GIFT_PRICE_MAX_CENTS = 100_000_000
export const GIFT_INTERESTS_MAX = 8
export const GIFT_EXCLUDE_MAX = 200
/**
 * The most items the app takes from one answer: a deck page (6) or a whole shelf — at least the Worker's TOPIC_PAGE_SIZE
 * (workers/edge/src/giftIdeas/catalog.ts; lib/api/giftTopics.test.ts keeps them in step, so a shelf never loses items).
 */
export const GIFT_IDEAS_ITEMS_MAX = 100
const OFFERS_MAX = 4
const OFFERS_ACCEPTED = 6
const TITLE_MAX = 120
const SHOP_MAX = 40
const URL_MAX = 2048
const CURSOR_MAX = 512
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/
/** a provider that does not answer within this long counts as "timeout" */
export const GIFT_IDEAS_TIMEOUT_MS = 12_000

const INTEREST_SET: ReadonlySet<string> = new Set(GIFT_INTERESTS)
const TOPIC_SET: ReadonlySet<string> = new Set(GIFT_TOPICS)
/** a sanity bound for the shelf sizes of a deck answer (a shelf itself comes in one page of ≤ 100) */
const TOPIC_COUNT_MAX = 1000

export function isGiftInterest(value: unknown): value is GiftInterest {
  return typeof value === 'string' && INTEREST_SET.has(value)
}

export function isGiftTopic(value: unknown): value is GiftTopic {
  return typeof value === 'string' && TOPIC_SET.has(value)
}

/** Known ids only, each once, in order, at most `max`. */
export function cleanInterests(values: readonly unknown[], max = GIFT_INTERESTS_MAX): GiftInterest[] {
  const out: GiftInterest[] = []
  for (const value of values) {
    if (out.length >= max) break
    if (isGiftInterest(value) && !out.includes(value)) out.push(value)
  }
  return out
}

function centsOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= GIFT_PRICE_MAX_CENTS ? value : null
}

function clampCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(GIFT_PRICE_MAX_CENTS, Math.max(0, Math.round(value)))
}

export interface GiftIdeasRequestInput {
  mode: GiftIdeasMode
  interests: readonly unknown[]
  budget: GiftBudget
  excludeIds?: readonly string[]
  lang: string
  cursor?: string | null
  topic?: string | null
  styles?: readonly unknown[]
}

/** The request as the contract allows it: unknown interests dropped, budget clamped, ids capped. */
export function buildGiftIdeasRequest(input: GiftIdeasRequestInput): GiftIdeasRequest {
  let min = clampCents(input.budget.min_cents)
  let max = clampCents(input.budget.max_cents)
  if (min > max) [min, max] = [max, min]
  const exclude: string[] = []
  const seen = new Set<string>()
  for (const id of input.excludeIds ?? []) {
    if (typeof id === 'string' && ID_PATTERN.test(id) && !seen.has(id)) {
      seen.add(id)
      exclude.push(id)
    }
  }
  const request: GiftIdeasRequest = {
    mode: input.mode === 'for_me' ? 'for_me' : 'for_someone',
    interests: cleanInterests(input.interests),
    budget: { min_cents: min, max_cents: max },
    // the newest ones count: a long session keeps excluding what it showed last
    exclude_ids: exclude.slice(-GIFT_EXCLUDE_MAX),
    lang: isGiftLang(input.lang) ? input.lang : 'de',
  }
  if (typeof input.cursor === 'string' && input.cursor.length > 0 && input.cursor.length <= CURSOR_MAX) request.cursor = input.cursor
  // a shelf: its id and nothing about the person — no interests go with it
  if (isGiftTopic(input.topic)) {
    request.topic = input.topic
    request.interests = []
    return request
  }
  // taste directions: known ids only, each once, at most six
  const styles: GiftStyle[] = []
  for (const value of input.styles ?? []) if (styles.length < GIFT_STYLES_MAX && isGiftStyle(value) && !styles.includes(value)) styles.push(value)
  if (styles.length > 0) request.styles = styles
  return request
}

// ---- answer parsing -----------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/** Trims, collapses whitespace, drops control characters, caps at `max` code points; '' → null. */
export function cleanLabel(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const text = withoutControls(raw).replace(/\s+/g, ' ').trim()
  if (text === '') return null
  const chars = [...text]
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text
}

/** https only, ≤ 2048 characters, a real host; anything else → null. */
export function cleanOfferUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > URL_MAX) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    const text = url.toString()
    return text.length > URL_MAX ? null : text
  } catch {
    return null
  }
}

function currentOrigin(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin
}

/**
 * A picture URL we may load: a path of OUR origin under /api/gift-ideas/ (relative, or absolute with our
 * origin). Returns the path (+ query), or null for everything else — other origins, data:, blob:, "//host".
 */
export function ownImagePath(raw: unknown, origin: string | null = currentOrigin()): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > URL_MAX || !origin) return null
  const text = raw.trim()
  // protocol-relative ("//cdn.example/x") and backslash tricks are never ours
  if (text.startsWith('//') || text.includes('\\')) return null
  try {
    const url = new URL(text, origin)
    if (url.origin !== origin || url.username || url.password) return null
    if (!url.pathname.startsWith(GIFT_IMAGE_PREFIX) || url.pathname.includes('/../')) return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function artAfter(imageUrl: string | null, prefix: string): string | null {
  if (!imageUrl?.startsWith(prefix)) return null
  const id = imageUrl.slice(prefix.length)
  return /^[a-z0-9-]{1,40}$/.test(id) ? id : null
}

/** The art id of a demo picture ("/api/gift-ideas/demo-art/headphones" → "headphones"), else null. */
export function demoArtId(imageUrl: string | null): string | null {
  return artAfter(imageUrl, GIFT_DEMO_ART_PREFIX)
}

/** The drawing to show when a catalogue photo ("/api/gift-ideas/img/<art>/<id>") fails, else null. */
export function photoFallbackArt(imageUrl: string | null): string | null {
  if (!imageUrl?.startsWith(GIFT_PHOTO_PREFIX)) return null
  const art = imageUrl.slice(GIFT_PHOTO_PREFIX.length).split('/')[0] ?? ''
  return /^[a-z0-9-]{1,40}$/.test(art) ? art : null
}

/** The art id of any picture the app draws itself — demo or real catalogue — else null. */
export function drawnArtId(imageUrl: string | null): string | null {
  return artAfter(imageUrl, GIFT_DEMO_ART_PREFIX) ?? artAfter(imageUrl, GIFT_ART_PREFIX)
}

/**
 * Domains that can never be a real shop (RFC 2606 / 6761: .example, .test, .invalid, .localhost and the
 * example.* second-level names): the demo's invented shops. Their links are never opened.
 */
export function isDemoShopUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
    return /(^|\.)(example|test|invalid|localhost)$/.test(host) || /(^|\.)example\.(com|net|org)$/.test(host)
  } catch {
    return false
  }
}

function parseOffer(value: unknown): GiftOffer | null {
  if (!isRecord(value)) return null
  const shop = cleanLabel(value.shop, SHOP_MAX)
  const price = centsOrNull(value.price_cents)
  const url = cleanOfferUrl(value.url)
  // "sponsored" decides the „Anzeige“ label: an offer that does not say is not shown at all
  if (!shop || price === null || !url || typeof value.sponsored !== 'boolean') return null
  return { shop, price_cents: price, url, sponsored: value.sponsored }
}

function parseIdea(value: unknown): GiftIdea | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' && ID_PATTERN.test(value.id) ? value.id : null
  const title = cleanLabel(value.title, TITLE_MAX)
  if (!id || !title || !Array.isArray(value.offers)) return null
  const offers = value.offers
    .slice(0, OFFERS_ACCEPTED)
    .map(parseOffer)
    .filter((offer): offer is GiftOffer => offer !== null)
    // cheapest first: a provider's ordering (e.g. sponsored on top) never decides what looks best
    .sort((a, b) => a.price_cents - b.price_cents)
    .slice(0, OFFERS_MAX)
  if (offers.length === 0) return null
  const offerMin = offers[0]?.price_cents ?? 0
  const offerMax = offers[offers.length - 1]?.price_cents ?? 0
  let min = centsOrNull(value.price_min_cents) ?? offerMin
  let max = centsOrNull(value.price_max_cents) ?? offerMax
  if (min > max) [min, max] = [max, min]
  // the range always covers the offers it is shown with
  min = Math.min(min, offerMin)
  max = Math.max(max, offerMax)
  return {
    id,
    title,
    image_url: ownImagePath(value.image_url),
    price_min_cents: min,
    price_max_cents: max,
    offers,
    interests: Array.isArray(value.interests) ? cleanInterests(value.interests, GIFT_INTERESTS.length) : [],
  }
}

/** The 200 answer, validated field by field: bad items are dropped, null = not an answer at all. */
export function parseGiftIdeasPage(body: unknown): GiftIdeasPage | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null
  const items: GiftIdea[] = []
  const seen = new Set<string>()
  for (const raw of body.items.slice(0, GIFT_IDEAS_ITEMS_MAX)) {
    const idea = parseIdea(raw)
    if (idea && !seen.has(idea.id)) {
      seen.add(idea.id)
      items.push(idea)
    }
  }
  const cursor = typeof body.next_cursor === 'string' && body.next_cursor.length > 0 && body.next_cursor.length <= CURSOR_MAX ? body.next_cursor : null
  const asOf = typeof body.as_of === 'string' && Number.isFinite(Date.parse(body.as_of)) ? new Date(body.as_of).toISOString() : null
  const page: GiftIdeasPage = { items, next_cursor: cursor, as_of: asOf }
  if (Array.isArray(body.topics)) page.topics = parseTopicCounts(body.topics)
  return page
}

/** Known shelves only, each once, with a whole count. */
function parseTopicCounts(values: readonly unknown[]): GiftTopicCount[] {
  const out: GiftTopicCount[] = []
  for (const value of values.slice(0, GIFT_TOPICS.length * 2)) {
    if (!isRecord(value) || !isGiftTopic(value.id) || out.some((known) => known.id === value.id)) continue
    const count = value.count
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > TOPIC_COUNT_MAX) continue
    out.push({ id: value.id, count })
  }
  return out
}

// ---- errors -----------------------------------------------------------------------------------------------

/** The Worker's codes, plus 'not_available' (no provider yet), 'offline' (nothing sent) and 'unavailable'. */
export type GiftIdeasErrorCode = 'invalid_request' | 'unauthorized' | 'rate_limited' | 'timeout' | 'not_available' | 'offline' | 'unavailable'

const STATUS_CODES: Readonly<Record<number, GiftIdeasErrorCode>> = {
  400: 'invalid_request',
  401: 'unauthorized',
  404: 'not_available',
  429: 'rate_limited',
  501: 'not_available',
  504: 'timeout',
}

export class GiftIdeasError extends Error {
  readonly code: GiftIdeasErrorCode
  /** 429 only: seconds from Retry-After */
  readonly retryAfterSeconds: number | undefined

  constructor(code: GiftIdeasErrorCode, options: { retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(`gift_ideas.${code}`, { cause: options.cause })
    this.name = 'GiftIdeasError'
    this.code = code
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export function isGiftIdeasError(err: unknown, code?: GiftIdeasErrorCode): err is GiftIdeasError {
  return err instanceof GiftIdeasError && (code === undefined || err.code === code)
}

/** An aborted request (newer interests replaced it, the screen closed): not an error to show. */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function retryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 3600)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, Math.min(Math.ceil((at - now) / 1000), 3600)) : undefined
}

function errorFrom(response: Response): GiftIdeasError {
  const code = STATUS_CODES[response.status] ?? 'unavailable'
  const seconds = code === 'rate_limited' ? retryAfter(response.headers.get('Retry-After')) : undefined
  return new GiftIdeasError(code, seconds === undefined ? {} : { retryAfterSeconds: seconds })
}

export interface GiftIdeasOptions {
  signal?: AbortSignal
  /** the account of the screen (captureEpoch().userId / the route session) */
  expectedUserId?: string
  /** tests */
  timeoutMs?: number
}

/**
 * One page of ideas from our Worker. Rejects with a GiftIdeasError, an AbortError (the caller aborted) or
 * the account boundary's AppError (the account changed while it was on its way).
 */
export async function fetchGiftIdeas(request: GiftIdeasRequest, options: GiftIdeasOptions = {}): Promise<GiftIdeasPage> {
  const page = parseGiftIdeasPage(await postGiftIdeas(request, options))
  if (!page) throw new GiftIdeasError('unavailable')
  return page
}

/**
 * The request itself: resolves with the answer's JSON, NOT yet trusted — the caller parses it (parseGiftIdeasPage,
 * or lib/api/giftTopics.ts for a shelf with its facts). Same rejections as fetchGiftIdeas.
 */
export async function postGiftIdeas(request: GiftIdeasRequest, { signal, expectedUserId, timeoutMs = GIFT_IDEAS_TIMEOUT_MS }: GiftIdeasOptions = {}): Promise<unknown> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new GiftIdeasError('offline')
  signal?.throwIfAborted()
  // re-checked here too: whatever the caller built, only what the contract allows is sent
  const body = JSON.stringify(
    buildGiftIdeasRequest({
      mode: request.mode,
      interests: request.interests,
      budget: request.budget,
      excludeIds: request.exclude_ids,
      lang: request.lang,
      cursor: request.cursor ?? null,
      topic: request.topic ?? null,
      styles: request.styles ?? [],
    }),
  )
  return asAccount(expectedUserId, async (account) => {
    // our own deadline next to the caller's abort: a hanging provider becomes "timeout", never a spinner
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const forward = () => controller.abort()
    signal?.addEventListener('abort', forward, { once: true })
    try {
      let response: Response
      try {
        response = await fetch(new URL(GIFT_IDEAS_PATH, window.location.origin), {
          method: 'POST',
          headers: { Authorization: bearer(account), 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        })
      } catch (err) {
        if (timedOut) throw new GiftIdeasError('timeout', { cause: err })
        if (isAbortError(err)) throw err
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        throw new GiftIdeasError(offline ? 'offline' : 'unavailable', { cause: err })
      }
      if (!response.ok) throw errorFrom(response)
      try {
        return (await response.json()) as unknown
      } catch (err) {
        if (timedOut) throw new GiftIdeasError('timeout', { cause: err })
        if (isAbortError(err)) throw err
        throw new GiftIdeasError('unavailable', { cause: err })
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forward)
    }
  })
}
