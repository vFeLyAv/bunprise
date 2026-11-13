import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { answerCatalog, CATALOG, CATALOG_LANGS, GIFT_TOPICS, inTopic, TOPIC_PAGE_SIZE, topicCounts } from '../src/giftIdeas/catalog'
import type { CatalogItem, CatalogRequest } from '../src/giftIdeas/catalog'
import { photoIndex } from '../src/giftIdeas/photo'
import { parseGiftIdeasBody } from '../src/giftIdeas/request'
import data from '../src/giftIdeas/catalog.de.json'
import { jwtFixture, NOW, SUPABASE_URL } from './helpers'

// "Stöbern nach Thema" (26.10.2026, docs/design/2026-10-26-ideas-categories.md): the board games of the catalogue
// with their facts, and the shelves of the same catalogue. Fixtures and the bundled catalogue only — no network.

const BOARD_GAMES = CATALOG.filter((item) => item.topic === 'brettspiele')
const WITH_FACTS = BOARD_GAMES.filter((item) => item.game)
const ANY = { min_cents: 0, max_cents: 100_000_000 }
const request = (over: Partial<CatalogRequest> = {}): CatalogRequest => ({ interests: [], budget: ANY, exclude_ids: [], lang: 'de', ...over })
const LANGS = CATALOG_LANGS

describe('the board games of the catalogue', () => {
  it('are 51: the 24 + 10 of the research drafts (26. and 27.10), the 7 Kosmos games of before (facts 30.10) and 10 iconic classics (30.10), all with their facts', () => {
    expect(BOARD_GAMES).toHaveLength(51)
    expect(WITH_FACTS).toHaveLength(51)
    expect(BOARD_GAMES.every((item) => item.interests.includes('games'))).toBe(true)
    // one entry per game: no game name twice, no catalogue title twice
    expect(new Set(WITH_FACTS.map((item) => item.game?.name)).size).toBe(51)
    expect(new Set(BOARD_GAMES.map((item) => item.title.de)).size).toBe(51)
  })

  it.each(WITH_FACTS.map((item) => [item.id, item] as const))('%s: facts, texts and photo as the research checked them', (_id, item) => {
    const game = item.game
    if (!game) throw new Error('no facts')
    expect(game.name.trim()).toBe(game.name)
    expect(game.name.length).toBeGreaterThan(0)
    expect(game.publisher.length).toBeGreaterThan(0)
    expect(Number.isInteger(game.players_min) && game.players_min >= 1).toBe(true)
    // no maximum = an open-ended box ("ab 1"): only Jenga (Hasbro: "1+ Spieler")
    if (game.players_max === undefined) expect(item.id).toBe('cat:hasbro-jenga')
    else {
      expect(game.players_max).toBeGreaterThanOrEqual(game.players_min)
      // Flip 7 – Voll Fies: 3–18 players (kosmos.de, 30.10)
      expect(game.players_max).toBeLessThanOrEqual(18)
    }
    expect(game.minutes_min).toBeGreaterThanOrEqual(10)
    expect(game.minutes_max).toBeGreaterThanOrEqual(game.minutes_min)
    expect(game.minutes_max).toBeLessThanOrEqual(240)
    expect(game.age_min).toBeGreaterThanOrEqual(6)
    expect(game.age_min).toBeLessThanOrEqual(18)
    if (game.award) {
      expect(['sdj', 'kdj']).toContain(game.award.prize)
      expect(game.award.year).toBeGreaterThanOrEqual(1979)
      expect(game.award.year).toBeLessThanOrEqual(2026)
    }
    // our own words, in every UI language (30.10): a blurb ≤ 140 characters, "So wird gespielt" in 2–4 sentences, ≤ 300
    for (const lang of LANGS) {
      const text = item.blurb?.[lang] ?? ''
      expect(text.length, `blurb.${lang}`).toBeGreaterThan(20)
      expect([...text].length, `blurb.${lang}`).toBeLessThanOrEqual(140)
      const howTo = item.how_to_play?.[lang] ?? ''
      expect([...howTo].length, `how_to_play.${lang}`).toBeLessThanOrEqual(300)
      const sentences = howTo.split(/(?<=[.!?])\s+/)
      expect(sentences.length, `how_to_play.${lang}`).toBeGreaterThanOrEqual(2)
      expect(sentences.length, `how_to_play.${lang}`).toBeLessThanOrEqual(4)
    }
    // every offer was seen on its shop page on 25. (the 7 Kosmos games), 26., 27. or 30.10 (the iconic classics; prices are approximate and dated)
    for (const offer of item.offers) expect(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-30']).toContain(offer.checked_at)
  })

  it('50 of the 51 games have a photo through our Worker route, each under its own drawing', () => {
    const index = photoIndex()
    const withPhoto = WITH_FACTS.filter((item) => item.image_source)
    expect(withPhoto).toHaveLength(50)
    expect(WITH_FACTS.filter((item) => !item.image_source).map((item) => item.id)).toEqual(['cat:dow-zug-um-zug'])
    for (const item of withPhoto) {
      expect(new URL(item.image_source ?? '').protocol).toBe('https:')
      expect(index.get(item.id)?.art).toBe(item.art)
    }
  })
})

describe('topics', () => {
  it('a board game stands on its own shelf only; every other shelf is one interest', () => {
    for (const item of BOARD_GAMES) {
      expect(GIFT_TOPICS.filter((topic) => inTopic(item, topic))).toEqual(['brettspiele'])
    }
    const books = CATALOG.filter((item) => inTopic(item, 'buecher'))
    expect(books.length).toBeGreaterThan(0)
    expect(books.every((item) => item.interests.includes('books') && item.topic === undefined)).toBe(true)
  })

  it('counts every shelf (the app shows a shelf from 8 ideas on)', () => {
    const counts = topicCounts()
    expect(counts.map((entry) => entry.id)).toEqual([...GIFT_TOPICS])
    expect(counts.find((entry) => entry.id === 'brettspiele')?.count).toBe(51)
    for (const entry of counts) expect(entry.count).toBe(CATALOG.filter((item) => inTopic(item, entry.id)).length)
  })

  it('a topic answers its whole shelf in one page: the games with facts first, each with its extras', () => {
    const answer = answerCatalog(request({ topic: 'brettspiele' }))
    expect(answer.items).toHaveLength(51)
    expect(answer.next_cursor).toBeNull()
    expect(answer.items.every((entry) => entry.game !== undefined)).toBe(true)
    const carcassonne = answer.items.find((entry) => entry.id === 'cat:hig-carcassonne')
    expect(carcassonne).toMatchObject({
      image_url: '/api/gift-ideas/img/boardgame/cat:hig-carcassonne',
      game: { name: 'Carcassonne', publisher: 'Hans im Glück', players_min: 2, players_max: 5, minutes_min: 35, minutes_max: 35, age_min: 7, award: { prize: 'sdj', year: 2001 } },
      how_to_play_lang: 'de',
    })
    expect(carcassonne?.blurb).toMatch(/^Plättchen für Plättchen/)
    expect(answer.items.find((entry) => entry.id === 'cat:repos-7-wonders-duel')?.game?.award).toBeNull()
    // an open-ended box says so explicitly: players_max null ("ab 1"), every other game a number
    expect(answer.items.find((entry) => entry.id === 'cat:hasbro-jenga')?.game).toMatchObject({ name: 'Jenga', players_min: 1, players_max: null })
    expect(answer.items.filter((entry) => entry.game?.players_max === null).map((entry) => entry.id)).toEqual(['cat:hasbro-jenga'])
    expect(answer.items.flatMap((entry) => entry.offers).every((offer) => offer.sponsored === false)).toBe(true)
  })

  it.each(LANGS)('%s: every game answers its title, blurb and "So wird gespielt" in that language (30.10)', (lang) => {
    const answer = answerCatalog(request({ topic: 'brettspiele', lang }))
    expect(answer.items).toHaveLength(51)
    for (const entry of answer.items) {
      const item = CATALOG.find((candidate) => candidate.id === entry.id)
      expect(entry.title, entry.id).toBe(item?.title[lang])
      expect(entry.blurb, entry.id).toBe(item?.blurb?.[lang])
      expect(entry.blurb_lang, entry.id).toBe(lang)
      expect(entry.how_to_play, entry.id).toBe(item?.how_to_play?.[lang])
      expect(entry.how_to_play_lang, entry.id).toBe(lang)
    }
    const mind = answer.items.find((entry) => entry.id === 'cat:nsv-the-mind')
    const start = { de: /^Alle legen gemeinsam/, en: /^[A-Z]/, ru: /^[А-Я]/, uk: /^[А-ЯІЇЄҐ]/ }[lang]
    expect(mind?.how_to_play).toMatch(start)
  })

  it('a topic ignores interests; an unknown topic is an empty shelf; a deck answer carries no extras', () => {
    expect(answerCatalog(request({ topic: 'brettspiele', interests: ['coffee'] })).items).toHaveLength(51)
    expect(answerCatalog(request({ topic: 'raumschiffe' }))).toEqual({ items: [], next_cursor: null, as_of: null })
    const deck = answerCatalog(request({ interests: ['games'] }), { pageSize: 50 })
    expect(deck.items.some((entry) => entry.id === 'cat:hig-carcassonne')).toBe(true)
    expect(deck.items.every((entry) => !('game' in entry) && !('how_to_play' in entry) && !('blurb' in entry))).toBe(true)
  })

  // 30.10: the shelf outgrew the old page of 50 (51 games) — a shelf must always come whole, in ONE page: the app
  // asks once and filters on the device, it never pages a topic. These fail loudly before anything is dropped.
  it('every shelf of the catalogue fits one topic page (raise TOPIC_PAGE_SIZE together with GIFT_IDEAS_ITEMS_MAX of the app)', () => {
    expect(TOPIC_PAGE_SIZE).toBe(100)
    for (const entry of topicCounts()) expect(entry.count, entry.id).toBeLessThanOrEqual(TOPIC_PAGE_SIZE)
  })

  it('a shelf of more than 50 (here 80) comes complete in one page; only beyond TOPIC_PAGE_SIZE would it need a cursor', () => {
    const base = BOARD_GAMES[0] as CatalogItem
    const shelf = (n: number): CatalogItem[] => Array.from({ length: n }, (_, i) => ({ ...base, id: `cat:shelf-${i}`, rank: 1000 + i }))
    const eighty = answerCatalog(request({ topic: 'brettspiele' }), { items: shelf(80) })
    expect(eighty.items.map((entry) => entry.id)).toEqual(shelf(80).map((item) => item.id))
    expect(eighty.next_cursor).toBeNull()
    const tooMany = answerCatalog(request({ topic: 'brettspiele' }), { items: shelf(TOPIC_PAGE_SIZE + 1) })
    expect(tooMany.items).toHaveLength(TOPIC_PAGE_SIZE)
    expect(tooMany.next_cursor).not.toBeNull()
  })

  it('reads `topic` strictly: lowercase letters only, at most 32', () => {
    const body = { mode: 'for_me', interests: [], budget: ANY, exclude_ids: [], lang: 'de' }
    expect(parseGiftIdeasBody({ ...body, topic: 'brettspiele' }).topic).toBe('brettspiele')
    expect(parseGiftIdeasBody({ ...body, topic: null }).topic).toBeUndefined()
    for (const topic of ['Brettspiele', 'brett-spiele', '', 'x'.repeat(33), 7, ['brettspiele']]) {
      expect(() => parseGiftIdeasBody({ ...body, topic }), String(topic)).toThrow()
    }
  })
})

// ---- the route ------------------------------------------------------------------------------------------------

let fixture: Awaited<ReturnType<typeof jwtFixture>>
let token: string
beforeAll(async () => {
  fixture = await jwtFixture()
  token = await fixture.token()
})

function harness() {
  const outgoing: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    outgoing.push(url)
    if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) return Response.json(fixture.jwks)
    throw new Error('Unexpected test destination')
  })
  const env: Env = { SUPABASE_URL, ASSETS: { fetch: async () => new Response('asset') }, GIFT_IDEAS_SOURCES: 'catalog' }
  const worker = createWorker({ fetch: fetcher, now: () => NOW, log: vi.fn() })
  const post = (body: unknown) => worker.fetch(new Request('https://app.test/api/gift-ideas', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
    body: JSON.stringify(body),
  }), env)
  return { post, outgoing }
}

const deck = { mode: 'for_someone', interests: ['coffee'], budget: { min_cents: 0, max_cents: 100_000_000 }, exclude_ids: [], lang: 'de' }

describe('POST /api/gift-ideas with topics', () => {
  it('the first page of a deck names the shelves and their sizes; a next page does not', async () => {
    const { post, outgoing } = harness()
    const first = await (await post(deck)).json() as { topics?: Array<{ id: string; count: number }>; next_cursor: string | null }
    expect(first.topics).toEqual(topicCounts())
    expect(first.next_cursor).not.toBeNull()
    const next = await (await post({ ...deck, cursor: first.next_cursor })).json() as Record<string, unknown>
    expect(next).not.toHaveProperty('topics')
    expect(outgoing).toEqual([`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`])
  })

  it('a topic: the whole shelf, no `topics` list; a bad topic is a 400', async () => {
    const { post } = harness()
    const response = await post({ ...deck, interests: [], topic: 'brettspiele' })
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ id: string; game?: unknown }>; topics?: unknown }
    expect(body.items).toHaveLength(51)
    expect(body.items[0]?.game).toBeDefined()
    expect(body).not.toHaveProperty('topics')
    expect((await post({ ...deck, topic: 'Brett Spiele' })).status).toBe(400)
  })
})

describe('books (27.10): facts and "Worum geht\'s" in our own words', () => {
  const BOOKS = CATALOG.filter((item) => item.book)
  it('every book of the shelf has its facts and a short text (de + en, ≤ 200 characters), from a named source', () => {
    expect(BOOKS.length).toBeGreaterThanOrEqual(38) // 39 minus the coffee atlas (not on sale until 03.2027, removed 27.10)
    for (const item of BOOKS) {
      const book = item.book
      if (!book) throw new Error('no book')
      expect(book.author.length, item.id).toBeGreaterThan(1)
      expect(book.publisher.length, item.id).toBeGreaterThan(1)
      expect(Number.isInteger(book.pages) && book.pages > 20 && book.pages < 3000, item.id).toBe(true)
      expect(book.year, item.id).toBeGreaterThanOrEqual(1950)
      expect(book.year, item.id).toBeLessThanOrEqual(2027)
      for (const lang of LANGS) {
        const text = item.about?.[lang] ?? ''
        expect(text.length, `${item.id} about.${lang}`).toBeGreaterThan(30)
        expect([...text].length, `${item.id} about.${lang}`).toBeLessThanOrEqual(200)
        expect(book.genre[lang]?.length ?? 0, `${item.id} genre.${lang}`).toBeGreaterThan(2)
      }
    }
    const raw = (data.items as Array<{ id: string; about_source?: { url: string; checked_at: string } }>).filter((entry) => BOOKS.some((item) => item.id === entry.id))
    for (const entry of raw) expect(new URL(entry.about_source?.url ?? '').protocol, entry.id).toBe('https:')
  })

  it.each(LANGS)('the "Bücher" shelf answers each book with its facts and text in the asked language (%s)', (lang) => {
    const answer = answerCatalog(request({ topic: 'buecher', lang }))
    const withBook = answer.items.filter((entry) => entry.book)
    expect(withBook.length).toBeGreaterThanOrEqual(38)
    for (const entry of withBook) {
      const item = CATALOG.find((candidate) => candidate.id === entry.id)
      expect(entry.title).toBe(item?.title[lang])
      expect(entry.about).toBe(item?.about?.[lang])
      expect(entry.about_lang).toBe(lang)
      expect(entry.book?.genre).toBe(item?.book?.genre[lang])
    }
  })
})

describe('the catalogue texts in every language (30.10: de / en / ru / uk)', () => {
  type RawText = Record<string, unknown>
  const RAW = data.items as Array<{ id: string; title: RawText; blurb?: RawText; how_to_play?: RawText; about?: RawText; book?: { genre: RawText; format?: RawText } }>
  const LIMITS = { title: 120, blurb: 140, how_to_play: 300, about: 200, genre: 80, format: 40 } as const
  const fields = (entry: (typeof RAW)[number]) => Object.entries({
    title: entry.title, blurb: entry.blurb, how_to_play: entry.how_to_play, about: entry.about, genre: entry.book?.genre, format: entry.book?.format,
  }).filter((pair): pair is [keyof typeof LIMITS, RawText] => pair[1] !== undefined)

  it.each(RAW.map((entry) => [entry.id, entry] as const))('%s: only known language keys, every language there, clean text within its limit', (_id, entry) => {
    for (const [field, text] of fields(entry)) {
      expect(Object.keys(text), `${field}: keys in our order`).toEqual([...LANGS])
      for (const lang of LANGS) {
        const value = text[lang]
        if (typeof value !== 'string') throw new Error(`${field}.${lang} is not a text`)
        expect(value.trim(), `${field}.${lang}`).toBe(value)
        expect(value, `${field}.${lang}`).not.toMatch(/\s{2,}/)
        expect(value.length, `${field}.${lang}`).toBeGreaterThan(1)
        expect([...value].length, `${field}.${lang}`).toBeLessThanOrEqual(LIMITS[field])
      }
      // Russian has no і ї є ґ; Ukrainian no ы э ъ ё — a text in the wrong one of the two shows at once
      expect(text.ru, `${field}.ru`).not.toMatch(/[іїєґІЇЄҐ]/)
      expect(text.uk, `${field}.uk`).not.toMatch(/[ыэъёЫЭЪЁ]/)
      // our own words in ru / uk are Cyrillic (a title may be only the product's own name)
      if (field !== 'title') {
        expect(text.ru, `${field}.ru`).toMatch(/[а-яА-Я]/)
        expect(text.uk, `${field}.uk`).toMatch(/[а-яА-ЯіїєґІЇЄҐ]/)
      }
    }
  })

  it('every item keeps the same German and English texts it had (the translations only added ru / uk, and en rules)', () => {
    // a spot check of texts that tests above already rely on
    const carcassonne = RAW.find((entry) => entry.id === 'cat:hig-carcassonne')
    expect(String(carcassonne?.blurb?.de)).toMatch(/^Plättchen für Plättchen/)
    expect(String(carcassonne?.how_to_play?.de)).toMatch(/^Wer dran ist, zieht ein Landschaftsplättchen/)
    expect(String(RAW.find((entry) => entry.id === 'cat:nsv-the-mind')?.blurb?.en)).toMatch(/^Play number cards/)
  })
})
