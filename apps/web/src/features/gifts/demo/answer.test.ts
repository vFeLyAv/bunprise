import { describe, expect, it } from 'vitest'
import { GIFT_INTERESTS, buildGiftIdeasRequest, isDemoShopUrl, parseGiftIdeasPage, type GiftInterest } from '../../../lib/api/giftIdeas'
import { DEMO_ART } from '../art'
import { BUDGET_NO_LIMIT } from '../budget'
import { answerDemoGiftIdeas, DEMO_PAGE_SIZE } from './answer'
import { DEMO_ART_IDS, DEMO_PRODUCTS, DEMO_SHOPS } from './catalogue'

// The demo provider of POST /api/gift-ideas: invented products, invented shops on reserved domains, our own
// drawings — and the answer a real provider would give (the app's parser keeps all of it).

const ask = (interests: GiftInterest[] = [], extra: Partial<{ min: number; max: number; exclude: string[]; lang: 'de' | 'en' }> = {}) =>
  answerDemoGiftIdeas(
    buildGiftIdeasRequest({
      mode: 'for_someone',
      interests,
      budget: { min_cents: extra.min ?? 0, max_cents: extra.max ?? BUDGET_NO_LIMIT },
      excludeIds: extra.exclude ?? [],
      lang: extra.lang ?? 'de',
    }),
    { now: Date.parse('2026-10-20T12:00:00Z') },
  )

describe('the demo catalogue', () => {
  it('is invented through and through: reserved example domains only, ids and ranks once each', () => {
    const ids = new Set(DEMO_PRODUCTS.map((product) => product.id))
    const ranks = new Set(DEMO_PRODUCTS.map((product) => product.rank))
    expect(ids.size).toBe(DEMO_PRODUCTS.length)
    expect(ranks.size).toBe(DEMO_PRODUCTS.length)
    for (const shop of Object.values(DEMO_SHOPS)) expect(isDemoShopUrl(`https://${shop.host}/`), shop.host).toBe(true)
  })

  it('every product has a picture of its own drawing, 2–4 offers, both languages and known interests', () => {
    for (const product of DEMO_PRODUCTS) {
      expect(DEMO_ART[product.art], `${product.id}: art ${product.art}`).toBeTypeOf('function')
      expect(product.offers.length, product.id).toBeGreaterThanOrEqual(2)
      expect(product.offers.length, product.id).toBeLessThanOrEqual(4)
      expect(product.title.de.trim()).not.toBe('')
      expect(product.title.en.trim()).not.toBe('')
      for (const interest of product.interests) expect(GIFT_INTERESTS).toContain(interest)
    }
    for (const id of DEMO_ART_IDS) expect(DEMO_ART[id], id).toBeTypeOf('function')
  })

  it('every interest has at least two ideas (a personalised deck never comes up empty for one)', () => {
    for (const interest of GIFT_INTERESTS) {
      expect(DEMO_PRODUCTS.filter((product) => product.interests.includes(interest)).length, interest).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('answerDemoGiftIdeas', () => {
  it('not personalised: the most popular ideas by rank, a page at a time, never sponsored', () => {
    const answer = ask()
    expect(answer.items).toHaveLength(DEMO_PAGE_SIZE)
    expect(answer.items.map((item) => item.id)).toEqual(['demo-monstera', 'demo-grinder', 'demo-headphones', 'demo-boardgame', 'demo-camera', 'demo-thermos'])
    expect(answer.next_cursor).toBe('more')
    expect(answer.as_of).toBe('2026-10-20T12:00:00.000Z')
    for (const item of answer.items) {
      expect(String(item.image_url)).toMatch(/^\/api\/gift-ideas\/demo-art\/[a-z]+$/)
      for (const offer of item.offers as Array<{ sponsored: boolean; url: string }>) {
        expect(offer.sponsored).toBe(false)
        expect(isDemoShopUrl(offer.url)).toBe(true)
      }
    }
  })

  it('personalised: only ideas of those interests, taken in turns', () => {
    const answer = ask(['coffee', 'plants'])
    const ids = answer.items.map((item) => item.id)
    expect(ids.slice(0, 4)).toEqual(['demo-grinder', 'demo-monstera', 'demo-thermos', 'demo-herbs'])
    for (const item of answer.items) {
      expect((item.interests as string[]).some((interest) => interest === 'coffee' || interest === 'plants')).toBe(true)
    }
  })

  it('the budget filters: the price range has to touch it', () => {
    const answer = ask([], { min: 0, max: 1500 })
    expect(answer.items.length).toBeGreaterThan(0)
    for (const item of answer.items) expect(Number(item.price_min_cents)).toBeLessThanOrEqual(1500)
  })

  it('leaves out what the app already showed, and says when nothing is left', () => {
    const all = DEMO_PRODUCTS.filter((product) => product.interests.includes('music')).map((product) => product.id)
    const first = ask(['music'])
    expect(first.items.map((item) => item.id).sort()).toEqual([...all].sort())
    expect(first.next_cursor).toBeNull()
    expect(ask(['music'], { exclude: all }).items).toEqual([])
  })

  it('answers in the asked language', () => {
    expect(ask(['audio'], { lang: 'en' }).items[0]?.title).toBe('Wireless over-ear headphones')
    expect(ask(['audio']).items[0]?.title).toBe('Kabellose Over-Ear-Kopfhörer')
  })

  it('its answer passes the app’s strict parser untouched', () => {
    const answer = ask(['coffee', 'books', 'games'])
    const page = parseGiftIdeasPage(answer)
    expect(page?.items).toHaveLength(answer.items.length)
    expect(page?.items.every((item) => item.image_url?.startsWith('/api/gift-ideas/demo-art/'))).toBe(true)
  })

  it('taste directions first (27.10, like the Worker): a sporty list gets the athleisure ideas up front, then every other card', () => {
    const answer = answerDemoGiftIdeas(
      buildGiftIdeasRequest({ mode: 'for_me', interests: ['coffee'], budget: { min_cents: 0, max_cents: BUDGET_NO_LIMIT }, lang: 'de', styles: ['athleisure'] }),
      { pageSize: 6 },
    )
    const sporty = new Set(DEMO_PRODUCTS.filter((product) => product.styles?.includes('athleisure')).map((product) => product.id))
    const ids = answer.items.map((item) => String(item.id))
    expect(sporty.size).toBeGreaterThanOrEqual(4)
    expect(ids.slice(0, 2).every((id) => sporty.has(id))).toBe(true)
    // then the asked interest and the next match take turns
    expect(ids[2]).toBe('demo-grinder')
    expect(sporty.has(ids[3] ?? '')).toBe(true)
  })
})

