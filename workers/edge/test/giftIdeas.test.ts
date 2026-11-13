import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { answerCatalog, CATALOG, pickText, readLocalized } from '../src/giftIdeas/catalog'
import type { CatalogItem, CatalogRequest } from '../src/giftIdeas/catalog'
import { parseGiftIdeasBody } from '../src/giftIdeas/request'
import { jwtFixture, NOW, SUPABASE_URL } from './helpers'

// POST /api/gift-ideas: the catalogue provider (pure) and the route around it (auth, limits, strict body,
// the GIFT_IDEAS_SOURCES switch). Fixtures only — the catalogue never fetches anything.

const item = (id: string, interests: CatalogItem['interests'], cents: number, rank: number, checked = '2026-10-25'): CatalogItem => ({
  id, interests, art: 'books', rank, title: { de: `${id} de`, en: `${id} en` },
  offers: [{ shop: 'Shop', url: `https://shop.de/p/${id}`, price_cents: cents, checked_at: checked }],
})

const FIXTURE: readonly CatalogItem[] = [
  item('c1', ['coffee'], 2000, 1),
  item('c2', ['coffee'], 3000, 4),
  item('c3', ['coffee', 'kitchen'], 9000, 7),
  item('b1', ['books'], 1500, 2, '2026-10-20'),
  item('b2', ['books'], 2500, 5),
  item('k1', ['kitchen'], 4000, 3),
  item('k2', ['kitchen'], 12000, 6),
]

const ANY = { min_cents: 0, max_cents: 100_000_000 }
const request = (over: Partial<CatalogRequest> = {}): CatalogRequest => ({ interests: [], budget: ANY, exclude_ids: [], lang: 'de', ...over })
const ids = (answer: ReturnType<typeof answerCatalog>) => answer.items.map((entry) => entry.id)

describe('answerCatalog', () => {
  it('not personalised: by rank', () => {
    expect(ids(answerCatalog(request(), { items: FIXTURE, pageSize: 10 }))).toEqual(['c1', 'b1', 'k1', 'c2', 'b2', 'k2', 'c3'])
  })

  it('personalised: the interests in turns, an item that fits two interests only once', () => {
    expect(ids(answerCatalog(request({ interests: ['coffee', 'kitchen'] }), { items: FIXTURE, pageSize: 10 })))
      .toEqual(['c1', 'k1', 'c2', 'k2', 'c3'])
  })

  it('budget: an idea counts when its price touches the range', () => {
    expect(ids(answerCatalog(request({ budget: { min_cents: 2500, max_cents: 5000 } }), { items: FIXTURE, pageSize: 10 })))
      .toEqual(['k1', 'c2', 'b2'])
  })

  it('exclude_ids drops what the app already showed', () => {
    expect(ids(answerCatalog(request({ exclude_ids: ['c1', 'k1'] }), { items: FIXTURE, pageSize: 10 })))
      .toEqual(['b1', 'c2', 'b2', 'k2', 'c3'])
  })

  it('pages with a cursor until nothing is left, never twice the same idea', () => {
    const seen: string[] = []
    let start: number | undefined
    for (let page = 0; page < 10; page += 1) {
      const answer = answerCatalog(request({ start, exclude_ids: seen }), { items: FIXTURE, pageSize: 3 })
      seen.push(...ids(answer))
      if (answer.next_cursor === null) break
      expect(answer.next_cursor).toMatch(/^v1\.\d+$/)
      start = Number(answer.next_cursor.slice(3))
    }
    expect(seen).toEqual(['c1', 'b1', 'k1', 'c2', 'b2', 'k2', 'c3'])
  })

  it('says there is no more when only excluded ideas are left', () => {
    const answer = answerCatalog(request({ exclude_ids: ['b2', 'k2', 'c3'] }), { items: FIXTURE, pageSize: 4 })
    expect(ids(answer)).toEqual(['c1', 'b1', 'k1', 'c2'])
    expect(answer.next_cursor).toBeNull()
  })

  it('answers the contract shape: our drawing, sponsored false, as_of = the oldest check of the page', () => {
    const answer = answerCatalog(request({ lang: 'en' }), { items: FIXTURE, pageSize: 2 })
    expect(answer.as_of).toBe('2026-10-20T00:00:00.000Z')
    expect(answer.items[0]).toEqual({
      id: 'c1', title: 'c1 en', image_url: '/api/gift-ideas/art/books', price_min_cents: 2000, price_max_cents: 2000,
      offers: [{ shop: 'Shop', price_cents: 2000, url: 'https://shop.de/p/c1', sponsored: false }], interests: ['coffee'],
    })
  })

  it('an empty result is a valid answer', () => {
    expect(answerCatalog(request({ budget: { min_cents: 0, max_cents: 100 } }), { items: FIXTURE })).toEqual({ items: [], next_cursor: null, as_of: null })
  })

  it('the real catalogue answers every interest on its own, within the default page size', () => {
    for (const interest of ['coffee', 'creative', 'photo'] as const) {
      const answer = answerCatalog(request({ interests: [interest] }))
      expect(answer.items.length, interest).toBe(6)
      expect(answer.items.every((entry) => entry.interests.includes(interest))).toBe(true)
    }
    expect(answerCatalog(request()).items.map((entry) => entry.id)).toEqual(
      [...CATALOG].sort((a, b) => a.rank - b.rank).slice(0, 6).map((entry) => entry.id))
  })
})

// ---- languages (30.10: the app's UI languages de / en / ru / uk) ------------------------------------------------

describe('languages', () => {
  // a game with every text in every language, and one whose texts exist only partly
  const full: CatalogItem = {
    ...item('g1', ['games'], 2000, 1),
    topic: 'brettspiele',
    title: { de: 'Spiel', en: 'Game', ru: 'Игра', uk: 'Гра' },
    blurb: { de: 'Kurz de', en: 'Short en', ru: 'Коротко ru', uk: 'Коротко uk' },
    how_to_play: { de: 'Regeln de.', en: 'Rules en.', ru: 'Правила ru.', uk: 'Правила uk.' },
  }
  const partly: CatalogItem = {
    ...item('g2', ['games'], 2000, 2),
    topic: 'brettspiele',
    title: { de: 'Zweites', en: 'Second', uk: 'Друга' },
    blurb: { de: 'Nur de und en', en: 'Only de and en' },
    how_to_play: { de: 'Nur Deutsch.' },
  }
  const shelf = (lang: CatalogRequest['lang']) => answerCatalog(request({ topic: 'brettspiele', lang }), { items: [full, partly] }).items

  it.each([
    ['de', 'Spiel', 'Kurz de', 'Regeln de.'],
    ['en', 'Game', 'Short en', 'Rules en.'],
    ['ru', 'Игра', 'Коротко ru', 'Правила ru.'],
    ['uk', 'Гра', 'Коротко uk', 'Правила uk.'],
  ] as const)('%s: every text in the asked language, and says so', (lang, title, blurb, howTo) => {
    expect(shelf(lang)[0]).toMatchObject({ title, blurb, blurb_lang: lang, how_to_play: howTo, how_to_play_lang: lang })
  })

  it('falls back per field: ru/uk → en → de, en → de — and names the language it served', () => {
    const [, ru] = shelf('ru')
    expect(ru).toMatchObject({ title: 'Second', blurb: 'Only de and en', blurb_lang: 'en', how_to_play: 'Nur Deutsch.', how_to_play_lang: 'de' })
    const [, uk] = shelf('uk')
    expect(uk).toMatchObject({ title: 'Друга', blurb: 'Only de and en', blurb_lang: 'en', how_to_play_lang: 'de' })
    const [, en] = shelf('en')
    expect(en).toMatchObject({ title: 'Second', blurb_lang: 'en', how_to_play: 'Nur Deutsch.', how_to_play_lang: 'de' })
    // a deck (no topic) carries only the title, in the asked language too
    expect(answerCatalog(request({ lang: 'ru' }), { items: [full, partly] }).items.map((entry) => entry.title)).toEqual(['Игра', 'Second'])
  })

  it('pickText: the chain, an empty text counts as missing', () => {
    expect(pickText({ de: 'de', en: '', ru: 'ru' }, 'uk')).toEqual({ text: 'de', lang: 'de' })
    expect(pickText({ de: 'de', en: 'en' }, 'de')).toEqual({ text: 'de', lang: 'de' })
    expect(pickText({ de: 'de', uk: 'uk' }, 'en')).toEqual({ text: 'de', lang: 'de' })
  })

  it('readLocalized keeps only known languages with text, and needs German', () => {
    expect(readLocalized({ de: 'a', en: 'b', ru: '', uk: 'c', fr: 'x' })).toEqual({ de: 'a', en: 'b', uk: 'c' })
    expect(readLocalized({ en: 'b' })).toBeNull()
    expect(readLocalized('text')).toBeNull()
    expect(readLocalized(null)).toBeNull()
  })

  it('the request parser takes the four UI languages; anything else is invalid', () => {
    const body = { mode: 'for_me', interests: [], budget: ANY, exclude_ids: [] }
    for (const lang of ['de', 'en', 'ru', 'uk'] as const) expect(parseGiftIdeasBody({ ...body, lang }).lang).toBe(lang)
    for (const lang of ['fr', 'RU', 'ru-RU', '', null, 1, undefined]) expect(() => parseGiftIdeasBody({ ...body, lang })).toThrow()
  })
})

// ---- the route ------------------------------------------------------------------------------------------------

let fixture: Awaited<ReturnType<typeof jwtFixture>>
let token: string
beforeAll(async () => {
  fixture = await jwtFixture()
  token = await fixture.token()
})

/** sources: the GIFT_IDEAS_SOURCES variable; null = not set at all */
function harness(sources: string | null = 'catalog') {
  const outgoing: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    outgoing.push(url)
    if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) return Response.json(fixture.jwks)
    throw new Error('Unexpected test destination')
  })
  const env: Env = { SUPABASE_URL, ASSETS: { fetch: async () => new Response('asset') }, ...(sources === null ? {} : { GIFT_IDEAS_SOURCES: sources }) }
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, now: () => NOW, log })
  const post = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => {
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7', ...headers },
    }
    if (method !== 'GET') init.body = typeof body === 'string' ? body : JSON.stringify(body)
    return worker.fetch(new Request('https://app.test/api/gift-ideas', init), env)
  }
  return { post, outgoing, log }
}

const valid = { mode: 'for_someone', interests: ['coffee', 'plants'], budget: { min_cents: 2000, max_cents: 5000 }, exclude_ids: [], lang: 'de' }

describe('POST /api/gift-ideas', () => {
  it('answers from the catalogue: only the JWKS is fetched, no-store, the log has three fields', async () => {
    const { post, outgoing, log } = harness()
    const response = await post(valid)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json() as { items: Array<{ interests: string[]; offers: Array<{ sponsored: boolean }> }>; next_cursor: string | null }
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((entry) => entry.interests.some((interest) => interest === 'coffee' || interest === 'plants'))).toBe(true)
    expect(body.items.flatMap((entry) => entry.offers).every((offer) => offer.sponsored === false)).toBe(true)
    expect(outgoing).toEqual([`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`])
    expect(log).toHaveBeenCalledTimes(1)
    expect(Object.keys(log.mock.calls[0]?.[0] ?? {}).sort()).toEqual(['duration', 'endpoint', 'status'])
  })

  it('follows its own cursor', async () => {
    const { post } = harness()
    const first = await (await post({ ...valid, interests: [] })).json() as { items: Array<{ id: string }>; next_cursor: string }
    const second = await (await post({ ...valid, interests: [], cursor: first.next_cursor, exclude_ids: first.items.map((entry) => entry.id) })).json() as { items: Array<{ id: string }> }
    expect(second.items.length).toBeGreaterThan(0)
    expect(second.items.some((entry) => first.items.some((shown) => shown.id === entry.id))).toBe(false)
  })

  it('is 501 while the catalogue is switched off (the app then shows its demo)', async () => {
    for (const sources of [null, '', 'ebay']) {
      const response = await harness(sources).post(valid)
      expect(response.status).toBe(501)
      expect(await response.json()).toEqual({ error: 'not_available' })
    }
  })

  it('needs a valid token and POST', async () => {
    const { post } = harness()
    expect((await post(valid, { Authorization: '' })).status).toBe(401)
    expect((await post(valid, {}, 'GET')).status).toBe(405)
  })

  it.each([
    ['no JSON content type', valid, { 'Content-Type': 'text/plain' }],
    ['broken JSON', '{"mode":', {}],
    ['an unknown mode', { ...valid, mode: 'for_everyone' }, {}],
    ['nine interests', { ...valid, interests: ['coffee', 'books', 'audio', 'outdoor', 'gaming', 'games', 'fashion', 'beauty', 'plants'] }, {}],
    ['an interest that is not a string', { ...valid, interests: [1] }, {}],
    ['min above max', { ...valid, budget: { min_cents: 5000, max_cents: 2000 } }, {}],
    ['cents with a fraction', { ...valid, budget: { min_cents: 0.5, max_cents: 2000 } }, {}],
    ['201 excluded ids', { ...valid, exclude_ids: Array.from({ length: 201 }, (_, i) => `id-${i}`) }, {}],
    ['an unknown language', { ...valid, lang: 'fr' }, {}],
    ['a region tag instead of a language', { ...valid, lang: 'ru-RU' }, {}],
    ['a cursor of another provider', { ...valid, cursor: 'more' }, {}],
  ])('400 for %s', async (_name, body, headers) => {
    const response = await harness().post(body, headers as Record<string, string>)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })

  it('413 for a body over 16 KiB (200 ids of 64 characters fit easily)', async () => {
    const response = await harness().post({ ...valid, padding: 'x'.repeat(17_000) })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'too_large' })
  })

  it('answers each UI language in its own words (ru / uk since 30.10; an older app\'s de / en keep working)', async () => {
    const { post } = harness()
    const shelf = async (lang: string) => {
      const response = await post({ ...valid, mode: 'for_me', interests: [], budget: ANY, topic: 'brettspiele', lang })
      expect(response.status, lang).toBe(200)
      const body = await response.json() as { items: Array<{ id: string; title: string; how_to_play?: string; how_to_play_lang?: string }> }
      return body.items.find((entry) => entry.id === 'cat:hig-carcassonne')
    }
    const answers = { de: await shelf('de'), en: await shelf('en'), ru: await shelf('ru'), uk: await shelf('uk') }
    for (const [lang, answer] of Object.entries(answers)) expect(answer?.how_to_play_lang, lang).toBe(lang)
    // four different texts: a Russian request never gets the German (or another language's) answer
    expect(new Set(Object.values(answers).map((answer) => answer?.how_to_play)).size).toBe(4)
    expect(answers.ru?.how_to_play).toMatch(/[а-я]/)
    expect(answers.uk?.how_to_play).toMatch(/[іїєґ]/)
  })

  it('drops unknown interests instead of failing (the vocabulary may grow on one side first)', async () => {
    const response = await harness().post({ ...valid, interests: ['coffee', 'unicorns'] })
    expect(response.status).toBe(200)
  })

  it('is rate limited per person (30 a minute)', async () => {
    const { post } = harness()
    for (let i = 0; i < 30; i += 1) expect((await post(valid)).status).toBe(200)
    const limited = await post(valid)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})
