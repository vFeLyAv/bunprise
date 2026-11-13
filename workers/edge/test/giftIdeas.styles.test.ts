import { describe, expect, it } from 'vitest'
import { answerCatalog, CATALOG, GIFT_STYLES } from '../src/giftIdeas/catalog'
import type { CatalogItem, CatalogRequest } from '../src/giftIdeas/catalog'
import { parseGiftIdeasBody } from '../src/giftIdeas/request'

// Taste directions (27.10): the app reads them on the device from a list's brands and sends only these ids; the
// deck then puts what fits first — the two best matches, then every other card — without a deck of nothing else.

const item = (id: string, interests: CatalogItem['interests'], rank: number, styles?: CatalogItem['styles']): CatalogItem => ({
  id, interests, art: 'books', rank, title: { de: id, en: id },
  offers: [{ shop: 'Shop', url: `https://shop.de/p/${id}`, price_cents: 2000, checked_at: '2026-10-27' }],
  ...(styles ? { styles } : {}),
})

const FIXTURE: readonly CatalogItem[] = [
  item('mug', ['coffee'], 1),
  item('gymbag', ['sport', 'fashion'], 9, ['athleisure']),
  item('shaker', ['sport'], 8, ['athleisure']),
  item('tights', ['sport', 'fashion'], 7, ['athleisure', 'streetwear']),
  item('book', ['books'], 2),
  item('kettle', ['coffee', 'kitchen'], 3, ['specialty-coffee']),
  item('yoga', ['sport'], 4, ['athleisure', 'natural']),
  item('lamp', ['home'], 5),
]
const ANY = { min_cents: 0, max_cents: 100_000_000 }
const request = (over: Partial<CatalogRequest> = {}): CatalogRequest => ({ interests: [], budget: ANY, exclude_ids: [], lang: 'de', ...over })
const ids = (answer: ReturnType<typeof answerCatalog>) => answer.items.map((entry) => entry.id)

describe('the deck with taste directions', () => {
  it('a sporty list: the two best athleisure ideas first, then every other card — the interests in turns between', () => {
    const answer = answerCatalog(request({ interests: ['coffee', 'books'], styles: ['athleisure', 'streetwear'] }), { items: FIXTURE, pageSize: 10 })
    // tights fit two directions; then yoga (rank 4) before shaker (8) and gymbag (9)
    expect(ids(answer)).toEqual(['tights', 'yoga', 'mug', 'shaker', 'book', 'gymbag', 'kettle'])
  })

  it('without interests the rest comes by rank; without styles nothing changes', () => {
    expect(ids(answerCatalog(request({ styles: ['specialty-coffee'] }), { items: FIXTURE, pageSize: 10 }))).toEqual(['kettle', 'mug', 'book', 'yoga', 'lamp', 'tights', 'shaker', 'gymbag'])
    expect(ids(answerCatalog(request({ interests: ['coffee'] }), { items: FIXTURE, pageSize: 10 }))).toEqual(['mug', 'kettle'])
  })

  it('pages with its cursor until nothing is left, never twice the same idea', () => {
    const seen: string[] = []
    let start: number | undefined
    for (let page = 0; page < 10; page += 1) {
      const answer = answerCatalog(request({ styles: ['athleisure'], start, exclude_ids: seen }), { items: FIXTURE, pageSize: 3 })
      seen.push(...ids(answer))
      if (answer.next_cursor === null) break
      start = Number(answer.next_cursor.slice(3))
    }
    expect(seen.slice(0, 2)).toEqual(['yoga', 'tights'])
    expect([...seen].sort()).toEqual(FIXTURE.map((entry) => entry.id).sort())
  })

  it('the real catalogue: every tag is known, and a sporty list starts with athleisure ideas', () => {
    for (const entry of CATALOG) for (const style of entry.styles ?? []) expect(GIFT_STYLES, entry.id).toContain(style)
    const athleisure = CATALOG.filter((entry) => entry.styles?.includes('athleisure'))
    expect(athleisure.length).toBeGreaterThanOrEqual(4)
    const answer = answerCatalog(request({ interests: ['sport'], styles: ['athleisure'] }))
    expect(answer.items.slice(0, 2).every((entry) => athleisure.some((match) => match.id === entry.id))).toBe(true)
  })
})

describe('reading `styles`', () => {
  const body = { mode: 'for_me', interests: [], budget: ANY, exclude_ids: [], lang: 'de' }
  it('known ids each once; unknown ones dropped; none → no styles at all', () => {
    expect(parseGiftIdeasBody({ ...body, styles: ['athleisure', 'raumfahrt', 'athleisure', 'tea'] }).styles).toEqual(['athleisure', 'tea'])
    expect(parseGiftIdeasBody({ ...body, styles: [] })).not.toHaveProperty('styles')
    expect(parseGiftIdeasBody(body)).not.toHaveProperty('styles')
  })
  it('a list of at most six strings, else a 400', () => {
    for (const styles of ['athleisure', [1], Array.from({ length: 7 }, () => 'tea'), { a: 1 }]) {
      expect(() => parseGiftIdeasBody({ ...body, styles }), JSON.stringify(styles)).toThrow()
    }
  })
})
