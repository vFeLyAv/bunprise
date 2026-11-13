import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// "Stöbern nach Thema" (26.10): the topic extension of POST /api/gift-ideas — the request (the shelf's id, no
// interests), the strict parser of the facts, the Worker's real catalogue against it, and the demo server
// (src/mocks/giftIdeas.ts): the same shelves with demo shop links and local placeholder photos.

const account = vi.hoisted(() => ({
  session: { user: { id: 'account-a' }, access_token: 'fixture-token-a' } as { user: { id: string }; access_token: string } | null,
}))
vi.mock('../supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))

import { answerCatalog, CATALOG, GIFT_TOPICS as WORKER_TOPICS, TOPIC_PAGE_SIZE, topicCounts } from '../../../../../workers/edge/src/giftIdeas/catalog'
import type { CatalogItem } from '../../../../../workers/edge/src/giftIdeas/catalog'
import { resetAccountBoundaryForTests } from '../accountBoundary'
import { createGiftIdeasHandlers, DEMO_PHOTO_SVG } from '../../mocks/giftIdeas'
import { buildGiftIdeasRequest, fetchGiftIdeas, GIFT_IDEAS_ITEMS_MAX, GIFT_TOPICS, isDemoShopUrl, parseGiftIdeasPage, photoFallbackArt } from './giftIdeas'
import { fetchGiftTopic, parseGameFacts, parseGiftTopicPage } from './giftTopics'

const ORIGIN = window.location.origin
const ANY = { min_cents: 0, max_cents: 100_000_000 }

describe('the request and the parser', () => {
  it('shares the topic vocabulary with the Worker', () => {
    expect([...GIFT_TOPICS]).toEqual([...WORKER_TOPICS])
  })

  it('a topic request carries the shelf and no interests; an unknown topic is not sent', () => {
    const shelf = buildGiftIdeasRequest({ mode: 'for_someone', interests: ['coffee'], budget: ANY, lang: 'de', topic: 'brettspiele' })
    expect(shelf).toEqual({ mode: 'for_someone', interests: [], budget: ANY, exclude_ids: [], lang: 'de', topic: 'brettspiele' })
    const deck = buildGiftIdeasRequest({ mode: 'for_me', interests: ['coffee'], budget: ANY, lang: 'de', topic: 'raumschiffe' })
    expect(deck).not.toHaveProperty('topic')
    expect(deck.interests).toEqual(['coffee'])
  })

  it('reads the shelves of a deck answer: known ids once, whole counts', () => {
    const page = parseGiftIdeasPage({
      items: [],
      next_cursor: null,
      topics: [{ id: 'brettspiele', count: 31 }, { id: 'brettspiele', count: 2 }, { id: 'raumschiffe', count: 9 }, { id: 'buecher', count: 1.5 }, { id: 'musik', count: -1 }, 'kaffee', { id: 'kueche', count: 17 }],
    })
    expect(page?.topics).toEqual([{ id: 'brettspiele', count: 31 }, { id: 'kueche', count: 17 }])
    expect(parseGiftIdeasPage({ items: [], next_cursor: null })).not.toHaveProperty('topics')
  })

  it('board game facts: whole numbers in sense, min ≤ max — else none at all', () => {
    const good = { name: 'Azul', publisher: 'Next Move', players_min: 2, players_max: 4, minutes_min: 30, minutes_max: 45, age_min: 8, award: { prize: 'sdj', year: 2018 } }
    expect(parseGameFacts(good)).toEqual({ ...good, award: { prize: 'sdj', year: 2018, nominated: false } })
    expect(parseGameFacts({ ...good, award: { prize: 'oscar', year: 2018 } })?.award).toBeNull()
    expect(parseGameFacts({ ...good, award: null })?.award).toBeNull()
    for (const broken of [{ players_min: 5, players_max: 2 }, { minutes_min: 60, minutes_max: 30 }, { age_min: -1 }, { players_min: 2.5 }, { name: '  ' }, { publisher: 3 }]) {
      expect(parseGameFacts({ ...good, ...broken }), JSON.stringify(broken)).toBeNull()
    }
    expect(parseGameFacts('Azul')).toBeNull()
    // an open-ended box (30.10, Jenga "1+"): players_max null or absent = "ab players_min"; a broken one is still refused
    expect(parseGameFacts({ ...good, players_min: 1, players_max: null })).toMatchObject({ players_min: 1, players_max: null })
    const { players_max: _dropped, ...noMax } = good
    expect(parseGameFacts(noMax)?.players_max).toBeNull()
    expect(parseGameFacts({ ...good, players_max: 'viele' })).toBeNull()
  })

  it('a shelf comes whole: every shelf of the Worker fits one topic page, and the parser keeps a page that full (30.10)', () => {
    // the app asks a topic once and never pages it — a shelf beyond these limits would lose games silently
    expect(GIFT_IDEAS_ITEMS_MAX).toBeGreaterThanOrEqual(TOPIC_PAGE_SIZE)
    for (const entry of topicCounts()) expect(entry.count, entry.id).toBeLessThanOrEqual(TOPIC_PAGE_SIZE)
    // a shelf of 80 (more than the old limit of 50) arrives complete through the parser
    const base = CATALOG.find((entry) => entry.id === 'cat:hig-carcassonne') as CatalogItem
    const items = Array.from({ length: 80 }, (_, i) => ({ ...base, id: `cat:shelf-${i}`, rank: 1000 + i }))
    const page = parseGiftTopicPage(JSON.parse(JSON.stringify(answerCatalog({ interests: [], budget: ANY, exclude_ids: [], lang: 'de', topic: 'brettspiele' }, { items }))))
    expect(page?.items.map((idea) => idea.id)).toEqual(items.map((item) => item.id))
  })

  it('the Worker\'s real board games survive the parser with their facts, texts and photos', () => {
    const answer = answerCatalog({ interests: [], budget: ANY, exclude_ids: [], lang: 'de', topic: 'brettspiele' })
    const page = parseGiftTopicPage(JSON.parse(JSON.stringify(answer)))
    expect(page?.items).toHaveLength(51)
    const withFacts = page?.items.filter((idea) => idea.game) ?? []
    expect(withFacts).toHaveLength(51)
    for (const idea of withFacts) {
      const raw = CATALOG.find((entry) => entry.id === idea.id)
      expect(idea.game?.name, idea.id).toBe(raw?.game?.name)
      expect(idea.how_to_play, idea.id).toBe(raw?.how_to_play?.de)
      expect(idea.how_to_play_lang).toBe('de')
      expect(idea.blurb).toBe(raw?.blurb?.de)
    }
    expect(withFacts.filter((idea) => photoFallbackArt(idea.image_url) !== null)).toHaveLength(50)
    const mind = page?.items.find((idea) => idea.id === 'cat:nsv-the-mind')
    expect(mind?.game?.award).toEqual({ prize: 'sdj', year: 2018, nominated: true })
    // the seven Kosmos games of before have their facts since 30.10: no board game without facts is left
    expect(page?.items.filter((idea) => !idea.game)).toEqual([])
  })

  it.each(['en', 'ru', 'uk'] as const)('%s (30.10): the Worker\'s texts in that language survive the parser, and say which language they are', (lang) => {
    const page = parseGiftTopicPage(JSON.parse(JSON.stringify(answerCatalog({ interests: [], budget: ANY, exclude_ids: [], lang, topic: 'brettspiele' }))))
    expect(page?.items).toHaveLength(51)
    for (const idea of page?.items ?? []) {
      const raw = CATALOG.find((entry) => entry.id === idea.id)
      expect(idea.title, idea.id).toBe(raw?.title[lang])
      expect(idea.how_to_play, idea.id).toBe(raw?.how_to_play?.[lang])
      expect(idea.how_to_play_lang, idea.id).toBe(lang)
      expect(idea.blurb, idea.id).toBe(raw?.blurb?.[lang])
      expect(idea.blurb_lang, idea.id).toBe(lang)
    }
    const books = parseGiftTopicPage(JSON.parse(JSON.stringify(answerCatalog({ interests: [], budget: ANY, exclude_ids: [], lang, topic: 'buecher' }))))
    const book = books?.items.find((idea) => idea.book)
    expect(book?.about_lang).toBe(lang)
    expect(book?.about).toBe(CATALOG.find((entry) => entry.id === book?.id)?.about?.[lang])
  })

  it('the language of a text: the four UI languages; a Worker that does not say (before 30.10) or says nonsense = German', () => {
    const idea = { id: 'x1', title: 'X', image_url: null, price_min_cents: 100, price_max_cents: 100, offers: [{ shop: 'Shop', price_cents: 100, url: 'https://shop.de/x', sponsored: false }] }
    const page = (extra: Record<string, unknown>) => parseGiftTopicPage({ items: [{ ...idea, ...extra }], next_cursor: null, as_of: null })?.items[0]
    expect(page({ how_to_play: 'Правила.', how_to_play_lang: 'uk', blurb: 'Коротко', blurb_lang: 'ru', about: 'Про', about_lang: 'en' }))
      .toMatchObject({ how_to_play_lang: 'uk', blurb_lang: 'ru', about_lang: 'en' })
    expect(page({ how_to_play: 'Regeln.', blurb: 'Kurz' })).toMatchObject({ how_to_play_lang: 'de', blurb_lang: 'de', about: null, about_lang: null })
    expect(page({ how_to_play: 'Regeln.', how_to_play_lang: 'fr' })?.how_to_play_lang).toBe('de')
    expect(page({ how_to_play_lang: 'en' })).toMatchObject({ how_to_play: null, how_to_play_lang: null })
  })

  it('the request carries the UI language itself (ru / uk since 30.10); anything unknown is German', () => {
    for (const lang of ['de', 'en', 'ru', 'uk']) expect(buildGiftIdeasRequest({ mode: 'for_me', interests: [], budget: ANY, lang, topic: 'brettspiele' }).lang).toBe(lang)
    for (const lang of ['fr', 'ru-RU', '']) expect(buildGiftIdeasRequest({ mode: 'for_me', interests: [], budget: ANY, lang }).lang).toBe('de')
  })
})

describe('the demo server serves the same shelves without ever contacting a shop', () => {
  const server = setupServer(...createGiftIdeasHandlers({ viewerOf: (request) => (request.headers.get('authorization') === 'Bearer fixture-token-a' ? 'account-a' : null), delayMs: 0 }))
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())
  beforeEach(() => {
    account.session = { user: { id: 'account-a' }, access_token: 'fixture-token-a' }
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => {
    server.resetHandlers()
    vi.restoreAllMocks()
    resetAccountBoundaryForTests()
  })

  it('a topic: the Worker\'s games and facts, every shop a demo link, every photo through the local placeholder route', async () => {
    const page = await fetchGiftTopic('brettspiele', 'de', { expectedUserId: 'account-a' })
    expect(page.items).toHaveLength(51)
    // every game has its facts since 30.10, so the shelf runs by rank: Sky Team (rank 2) first
    expect(page.items[0]?.game?.name).toBe('Sky Team')
    for (const idea of page.items) {
      expect(idea.offers.every((offer) => isDemoShopUrl(offer.url) && !offer.sponsored), idea.id).toBe(true)
      expect(idea.image_url?.startsWith('/api/gift-ideas/'), idea.id).toBe(true)
    }
    expect(page.items.find((idea) => idea.id === 'cat:hig-carcassonne')?.offers.map((offer) => offer.url)).toEqual(['https://mediamarkt.example/p/hig-carcassonne', 'https://carcassonne-co.example/p/hig-carcassonne'])
    const photo = await fetch(new URL('/api/gift-ideas/img/boardgame/cat:hig-carcassonne', ORIGIN))
    expect(photo.status).toBe(200)
    expect(photo.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(await photo.text()).toBe(DEMO_PHOTO_SVG)
    expect((await fetch(new URL('/api/gift-ideas/img/boardgame/cat:dow-zug-um-zug', ORIGIN))).status).toBe(404)
  })

  it('in Russian / Ukrainian (30.10): the demo answers like the Worker — the rules in that language, never the German ones', async () => {
    for (const lang of ['ru', 'uk'] as const) {
      const page = await fetchGiftTopic('brettspiele', lang, { expectedUserId: 'account-a' })
      const carcassonne = page.items.find((idea) => idea.id === 'cat:hig-carcassonne')
      expect(carcassonne?.how_to_play_lang, lang).toBe(lang)
      expect(carcassonne?.how_to_play, lang).toBe(CATALOG.find((entry) => entry.id === 'cat:hig-carcassonne')?.how_to_play?.[lang])
      expect(carcassonne?.title, lang).toBe(CATALOG.find((entry) => entry.id === 'cat:hig-carcassonne')?.title[lang])
    }
  })

  it('the first page of a deck names the shelves; a next page does not; an unknown shelf is empty', async () => {
    const first = await fetchGiftIdeas({ mode: 'for_me', interests: [], budget: ANY, exclude_ids: [], lang: 'de' }, { expectedUserId: 'account-a' })
    expect(first.topics?.find((topic) => topic.id === 'brettspiele')?.count).toBe(51)
    const next = await fetchGiftIdeas({ mode: 'for_me', interests: [], budget: ANY, exclude_ids: [], lang: 'de', cursor: 'more' }, { expectedUserId: 'account-a' })
    expect(next).not.toHaveProperty('topics')
    const raw = await fetch(new URL('/api/gift-ideas', ORIGIN), {
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-token-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'for_me', interests: [], budget: ANY, exclude_ids: [], lang: 'de', topic: 'raumschiffe' }),
    })
    expect(await raw.json()).toEqual({ items: [], next_cursor: null, as_of: null })
    const bad = await fetch(new URL('/api/gift-ideas', ORIGIN), {
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-token-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'for_me', interests: [], budget: ANY, exclude_ids: [], lang: 'de', topic: 'Brett Spiele' }),
    })
    expect(bad.status).toBe(400)
  })
})
