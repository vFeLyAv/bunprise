import { delay, http, HttpResponse } from 'msw'
import { buildGiftIdeasRequest, GIFT_EXCLUDE_MAX, isGiftLang, isGiftTopic, type GiftIdeasMode, type GiftIdeasRequest } from '../lib/api/giftIdeas'
import { answerDemoGiftIdeas } from '../features/gifts/demo/answer'
// "Stöbern nach Thema" (26.10): the demo serves the SAME shelves as our Worker — its catalogue module, bundled into
// the demo build only (this file is loaded behind VITE_DEMO) — with demo shop links and local placeholder photos.
import { answerCatalog, CATALOG, topicCounts } from '../../../../workers/edge/src/giftIdeas/catalog'

// Demo answers of our Worker's POST /api/gift-ideas ("Geschenk finden", docs/demo-mode.md). The contract
// is written at the top of src/lib/api/giftIdeas.ts; the products, shops and prices of the deck are INVENTED
// (src/features/gifts/demo/catalogue.ts, reserved example domains — no request ever leaves the browser).
// Like the real Worker: a bearer token of a live demo session (else 401), JSON only, a strict body (else
// 400) — and the answer takes a moment (GIFT_IDEAS_DELAY_MS), so Pompon's sniffing is visible in the demo.
// Topics (26.10): the first page of a deck names the Worker's shelves (`topics`); a request with `topic` answers
// that shelf from the Worker's own catalogue (the real games, facts, "So wird gespielt", prices of their date) —
// but every shop link points to a reserved demo domain (it is shown as „Demo-Shop“, never opened) and every photo
// is a local placeholder (GET /api/gift-ideas/img/…, below): the demo never contacts a shop.

export const GIFT_IDEAS_DELAY_MS = 900

export interface GiftIdeasHandlerOptions {
  /** the demo account this request's bearer token belongs to; null = none (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delay */
  delayMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MODES: ReadonlySet<string> = new Set<GiftIdeasMode>(['for_someone', 'for_me'])
const isCents = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const TOPIC_PATTERN = /^[a-z]{1,32}$/

/** The body exactly as the contract describes it, or null (→ 400). */
function readBody(input: unknown): (GiftIdeasRequest & { unknownTopic?: true }) | null {
  if (!isRecord(input)) return null
  const { mode, interests, budget, exclude_ids: exclude, lang, cursor, topic, styles } = input
  if (typeof mode !== 'string' || !MODES.has(mode)) return null
  if (!Array.isArray(interests) || interests.length > 8 || !interests.every((value) => typeof value === 'string')) return null
  if (!isRecord(budget) || !isCents(budget.min_cents) || !isCents(budget.max_cents) || budget.min_cents > budget.max_cents) return null
  if (!Array.isArray(exclude) || exclude.length > GIFT_EXCLUDE_MAX || !exclude.every((value) => typeof value === 'string')) return null
  // like the Worker (30.10): the UI languages de / en / ru / uk, each text falling back per field
  if (!isGiftLang(lang)) return null
  if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') return null
  if (topic !== undefined && topic !== null && (typeof topic !== 'string' || !TOPIC_PATTERN.test(topic))) return null
  if (styles !== undefined && styles !== null && (!Array.isArray(styles) || styles.length > 6 || !styles.every((value) => typeof value === 'string'))) return null
  const request = buildGiftIdeasRequest({
    mode: mode as GiftIdeasMode,
    interests,
    budget: { min_cents: budget.min_cents, max_cents: budget.max_cents },
    excludeIds: exclude as string[],
    lang,
    cursor: typeof cursor === 'string' ? cursor : null,
    topic: typeof topic === 'string' ? topic : null,
    styles: Array.isArray(styles) ? styles : [],
  })
  // a well-formed id the app does not know: an empty shelf, like the Worker
  return typeof topic === 'string' && !isGiftTopic(topic) ? { ...request, unknownTopic: true } : request
}

/** "Müller" → "mueller": the shop's name as a reserved demo domain (RFC 2606 .example — it cannot exist). */
function demoHost(shop: string): string {
  const slug = shop
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'shop'}.example`
}

/** A shelf of the Worker's catalogue, for the demo: the same ideas, demo links (photos: the placeholder below). */
export function answerDemoTopic(request: GiftIdeasRequest, now = Date.now()) {
  const answer = answerCatalog({ interests: [], budget: request.budget, exclude_ids: request.exclude_ids, lang: request.lang, ...(request.topic ? { topic: request.topic } : {}) })
  return {
    ...answer,
    items: answer.items.map((item) => ({
      ...item,
      offers: item.offers.map((offer) => ({ ...offer, url: `https://${demoHost(offer.shop)}/p/${item.id.replace(/^cat:/, '')}` })),
    })),
    // the demo's prices are "as of" the catalogue's check date, like the Worker
    as_of: answer.as_of ?? new Date(now).toISOString(),
  }
}

/** The catalogue items that have a photo in the Worker (the demo shows a placeholder for exactly those). */
const PHOTO_IDS: ReadonlySet<string> = new Set(CATALOG.filter((item) => item.image_source).map((item) => `${item.art}/${item.id}`))

/**
 * The demo's stand-in for a shop's product photo: a neutral parcel on a plate, marked „Demo-Foto“ — so a screenshot
 * of the demo never passes a placeholder off as the real box (the real photo comes only through our Worker).
 */
export const DEMO_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
<ellipse cx="200" cy="246" rx="120" ry="12" fill="#000" opacity=".08"/>
<path d="M92 112 L200 70 L308 112 L308 222 L200 262 L92 222 Z" fill="#D9C6A5"/>
<path d="M92 112 L200 152 L308 112 L200 70 Z" fill="#E8D9BE"/>
<path d="M200 152 L200 262 L308 222 L308 112 Z" fill="#C8B28C"/>
<path d="M146 91 L254 133 L254 170 L236 163 L236 140 L128 98 Z" fill="#B99D6F" opacity=".8"/>
<rect x="134" y="186" width="132" height="34" rx="17" fill="#fff" opacity=".9"/>
<text x="200" y="209" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="17" font-weight="700" fill="#6B5D4E" text-anchor="middle">Demo-Foto</text>
</svg>`

export function createGiftIdeasHandlers({ viewerOf, delayMs = GIFT_IDEAS_DELAY_MS }: GiftIdeasHandlerOptions) {
  return [
    http.post('/api/gift-ideas', async ({ request }) => {
      if (viewerOf(request) === null) return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
        return HttpResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return HttpResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      const body = readBody(input)
      if (!body) return HttpResponse.json({ error: 'invalid_request' }, { status: 400 })
      if (delayMs > 0) await delay(delayMs)
      const headers = { 'Cache-Control': 'no-store' }
      if (body.unknownTopic) return HttpResponse.json({ items: [], next_cursor: null, as_of: null }, { headers })
      if (body.topic) return HttpResponse.json(answerDemoTopic(body), { headers })
      const answer = answerDemoGiftIdeas(body)
      // the first page of a deck names the shelves, like the Worker
      return HttpResponse.json(body.cursor === undefined ? { ...answer, topics: topicCounts() } : answer, { headers })
    }),
    // The Worker's photo route (open: an <img> sends no token): a local placeholder for the catalogue's photos.
    http.get('/api/gift-ideas/img/:art/:id', ({ params }) => {
      const key = `${String(params.art)}/${decodeURIComponent(String(params.id))}`
      if (!PHOTO_IDS.has(key)) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
      return new HttpResponse(DEMO_PHOTO_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=86400' } })
    }),
  ]
}
