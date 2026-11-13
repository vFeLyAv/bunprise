import { GIFT_DEMO_ART_PREFIX, type GiftIdeasRequest, type GiftInterest, type GiftLang, type GiftStyle } from '../../../lib/api/giftIdeas'
import { fitsBudget } from '../budget'
import { DEMO_PRODUCTS, DEMO_SHOPS, type DemoProduct } from './catalogue'

// The demo provider of POST /api/gift-ideas: the answer a real provider would give, from the invented
// catalogue (catalogue.ts). Pure and deterministic. It returns the RAW answer JSON (like a server), so
// the app reads it through the same strict parser as a real one (lib/api/giftIdeas.ts parseGiftIdeasPage).
// - Budget: an idea counts when its price range touches the budget (budget.ts fitsBudget).
// - Personalised (interests given): only ideas of those interests, taken in turns — the first interest's
//   best, then the second's … — so a deck never shows five coffee things in a row.
// - Not personalised (no interests): the most popular ideas, by rank.
// - Paging: the demo leaves out `exclude_ids` (the app sends everything it showed) and answers the next
//   `pageSize`; next_cursor only says "there is more" (a real provider may use a real cursor).

export const DEMO_PAGE_SIZE = 6

export interface DemoGiftIdeasAnswer {
  items: Array<Record<string, unknown>>
  next_cursor: string | null
  as_of: string
}

function priceRange(product: DemoProduct): { price_min_cents: number; price_max_cents: number } {
  const prices = product.offers.map(([, cents]) => cents)
  return { price_min_cents: Math.min(...prices), price_max_cents: Math.max(...prices) }
}

function item(product: DemoProduct, lang: GiftLang): Record<string, unknown> {
  return {
    id: product.id,
    // the invented products have German and English titles: Russian / Ukrainian read the English ones (like the Worker)
    title: product.title[lang === 'de' ? 'de' : 'en'],
    image_url: `${GIFT_DEMO_ART_PREFIX}${product.art}`,
    ...priceRange(product),
    offers: product.offers.map(([shop, cents]) => ({
      shop: DEMO_SHOPS[shop].name,
      price_cents: cents,
      url: `https://${DEMO_SHOPS[shop].host}/p/${product.id}`,
      // the demo has no paid placements and no partner links
      sponsored: false,
    })),
    interests: [...product.interests],
  }
}

/** Ideas of the interests, in turns: the best of each interest, then the second best of each … */
function inTurns(pool: readonly DemoProduct[], interests: readonly GiftInterest[]): DemoProduct[] {
  const taken = new Set<string>()
  const buckets = interests.map((interest) =>
    pool
      .filter((product) => product.interests.includes(interest))
      .sort((a, b) => a.rank - b.rank),
  )
  const out: DemoProduct[] = []
  for (let round = 0; buckets.some((bucket) => bucket.length > 0); round += 1) {
    for (const bucket of buckets) {
      while (bucket.length > 0) {
        const next = bucket.shift() as DemoProduct
        if (taken.has(next.id)) continue
        taken.add(next.id)
        out.push(next)
        break
      }
    }
    if (round > pool.length) break
  }
  return out
}

/**
 * Taste directions first (like the Worker, workers/edge/src/giftIdeas/catalog.ts withStyles): the two best matches,
 * then every other card, the interests in turns between them.
 */
function withStyles(pool: readonly DemoProduct[], interests: readonly GiftInterest[], styles: readonly GiftStyle[]): DemoProduct[] {
  const fit = (product: DemoProduct) => (product.styles ?? []).filter((style) => styles.includes(style)).length
  const shared = (product: DemoProduct) => product.interests.filter((interest) => interests.includes(interest)).length
  const matches = pool.filter((product) => fit(product) > 0).sort((a, b) => fit(b) - fit(a) || shared(b) - shared(a) || a.rank - b.rank)
  const taken = new Set(matches.map((product) => product.id))
  const rest = pool.filter((product) => !taken.has(product.id))
  const others = interests.length > 0 ? inTurns(rest, interests) : [...rest].sort((a, b) => a.rank - b.rank)
  const out = matches.slice(0, 2)
  for (let m = 2, o = 0; m < matches.length || o < others.length; ) {
    const other = others[o]
    if (other) {
      out.push(other)
      o += 1
    }
    const match = matches[m]
    if (match) {
      out.push(match)
      m += 1
    }
  }
  return out
}

export function answerDemoGiftIdeas(request: GiftIdeasRequest, { pageSize = DEMO_PAGE_SIZE, now = Date.now() }: { pageSize?: number; now?: number } = {}): DemoGiftIdeasAnswer {
  const excluded = new Set(request.exclude_ids)
  const pool = DEMO_PRODUCTS.filter((product) => !excluded.has(product.id) && fitsBudget(priceRange(product), request.budget))
  const styles = request.styles ?? []
  const ordered = styles.length > 0
    ? withStyles(pool, request.interests, styles)
    : request.interests.length > 0 ? inTurns(pool, request.interests) : [...pool].sort((a, b) => a.rank - b.rank)
  const page = ordered.slice(0, Math.max(1, pageSize))
  return {
    items: page.map((product) => item(product, request.lang)),
    next_cursor: ordered.length > page.length ? 'more' : null,
    as_of: new Date(now).toISOString(),
  }
}
