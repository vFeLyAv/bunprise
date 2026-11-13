import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/api/giftIdeas.ts — the stable contract of POST /api/gift-ideas: the request (only what the contract
// allows, same origin, pinned to the account, no cookies, no referrer), every error code, the deadline,
// and the strict parser (pictures only from our origin, https offers, cheapest first, the „Anzeige“ flag
// required). Then the same client against the demo server's handler (src/mocks/giftIdeas.ts).
// Invented fixture accounts, tokens, products and shops only.

const account = vi.hoisted(() => ({
  session: { user: { id: 'account-a' }, access_token: 'fixture-token-a' } as { user: { id: string }; access_token: string } | null,
}))
vi.mock('../supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))

import { resetAccountBoundaryForTests } from '../accountBoundary'
import { createGiftIdeasHandlers } from '../../mocks/giftIdeas'
import {
  GIFT_EXCLUDE_MAX,
  GIFT_IDEAS_PATH,
  GiftIdeasError,
  buildGiftIdeasRequest,
  demoArtId,
  fetchGiftIdeas,
  isDemoShopUrl,
  ownImagePath,
  parseGiftIdeasPage,
  type GiftIdeasRequest,
} from './giftIdeas'

const fetchMock = vi.fn<typeof fetch>()
const ORIGIN = window.location.origin

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

async function failure(promise: Promise<unknown>): Promise<GiftIdeasError> {
  const err = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  expect(err).toBeInstanceOf(GiftIdeasError)
  return err as GiftIdeasError
}

const REQUEST: GiftIdeasRequest = {
  mode: 'for_someone',
  interests: ['coffee', 'plants'],
  budget: { min_cents: 1500, max_cents: 4000 },
  exclude_ids: ['demo-grinder'],
  lang: 'de',
}

const offer = (shop: string, cents: number, extra: Record<string, unknown> = {}) => ({ shop, price_cents: cents, url: `https://${shop.toLowerCase()}.example/p/1`, sponsored: false, ...extra })
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Idee ${id}`,
  image_url: '/api/gift-ideas/demo-art/grinder',
  price_min_cents: 1690,
  price_max_cents: 3900,
  offers: [offer('Laden', 3900), offer('Markt', 3490), offer('Fernost', 1690)],
  interests: ['coffee', 'kitchen'],
  ...extra,
})

describe('buildGiftIdeasRequest: only what the contract allows', () => {
  it('drops unknown interests, keeps the order, at most eight', () => {
    const request = buildGiftIdeasRequest({ mode: 'for_me', interests: ['coffee', 'astrology', 'coffee', 'books', 1, 'plants', 'games', 'tech', 'home', 'film', 'music', 'sport'], budget: { min_cents: 0, max_cents: 5000 }, lang: 'en' })
    expect(request.interests).toEqual(['coffee', 'books', 'plants', 'games', 'tech', 'home', 'film', 'music'])
    expect(request.mode).toBe('for_me')
    expect(request.lang).toBe('en')
  })

  it('clamps and orders the budget, keeps whole cents', () => {
    expect(buildGiftIdeasRequest({ mode: 'for_someone', interests: [], budget: { min_cents: 9000.4, max_cents: -5 }, lang: 'de' }).budget).toEqual({ min_cents: 0, max_cents: 9000 })
    expect(buildGiftIdeasRequest({ mode: 'for_someone', interests: [], budget: { min_cents: 0, max_cents: 10 ** 12 }, lang: 'de' }).budget.max_cents).toBe(100_000_000)
  })

  it('exclude_ids: well-formed ids only, each once, the newest 200', () => {
    const ids = Array.from({ length: 260 }, (_, i) => `id-${i}`)
    const request = buildGiftIdeasRequest({ mode: 'for_someone', interests: [], budget: REQUEST.budget, excludeIds: ['ok', 'ok', 'bad id', '<script>', ...ids], lang: 'xx' })
    expect(request.exclude_ids).toHaveLength(GIFT_EXCLUDE_MAX)
    expect(request.exclude_ids[request.exclude_ids.length - 1]).toBe('id-259')
    expect(request.exclude_ids).not.toContain('bad id')
    expect(request.lang).toBe('de')
  })
})

describe('parseGiftIdeasPage: nothing of the answer is trusted blindly', () => {
  it('keeps a valid page, sorts the offers cheapest first, keeps the cursor and the price date', () => {
    const page = parseGiftIdeasPage({ items: [item('a')], next_cursor: 'more', as_of: '2026-10-20T12:00:00Z' })
    expect(page?.items[0]?.offers.map((o) => o.shop)).toEqual(['Fernost', 'Markt', 'Laden'])
    expect(page?.items[0]?.interests).toEqual(['coffee', 'kitchen'])
    expect(page?.next_cursor).toBe('more')
    expect(page?.as_of).toBe('2026-10-20T12:00:00.000Z')
  })

  it('pictures only from our own origin, under /api/gift-ideas/ — anything else becomes null', () => {
    const cases: Array<[unknown, string | null]> = [
      ['/api/gift-ideas/img/abc?w=400', '/api/gift-ideas/img/abc?w=400'],
      [`${ORIGIN}/api/gift-ideas/img/abc`, '/api/gift-ideas/img/abc'],
      ['https://cdn.shop.example/photo.jpg', null],
      ['//cdn.shop.example/photo.jpg', null],
      ['data:image/png;base64,AAAA', null],
      ['javascript:alert(1)', null],
      ['/icons/icon.svg', null],
      ['/api/gift-ideas/../link-preview', null],
      ['\\\\evil.example\\x', null],
      [42, null],
    ]
    for (const [raw, expected] of cases) {
      const page = parseGiftIdeasPage({ items: [item('a', { image_url: raw })], next_cursor: null })
      expect(page?.items[0]?.image_url, String(raw)).toBe(expected)
      expect(ownImagePath(raw, ORIGIN), String(raw)).toBe(expected)
    }
  })

  it('offers: https only, a shop name, a price and an explicit sponsored flag — else the offer is dropped', () => {
    const page = parseGiftIdeasPage({
      items: [
        item('a', {
          offers: [
            offer('Markt', 2490),
            offer('Http', 1000, { url: 'http://http.example/p' }),
            offer('NoFlag', 1000, { sponsored: undefined }),
            offer('', 1000),
            offer('Negative', -5),
            offer('Paid', 2990, { sponsored: true }),
            offer('Js', 900, { url: 'javascript:alert(1)' }),
          ],
        }),
      ],
      next_cursor: null,
    })
    expect(page?.items[0]?.offers).toEqual([
      { shop: 'Markt', price_cents: 2490, url: 'https://markt.example/p/1', sponsored: false },
      { shop: 'Paid', price_cents: 2990, url: 'https://paid.example/p/1', sponsored: true },
    ])
  })

  it('at most four offers; an idea without one usable offer is dropped', () => {
    const many = Array.from({ length: 6 }, (_, i) => offer(`S${i}`, 1000 + i))
    const page = parseGiftIdeasPage({ items: [item('a', { offers: many }), item('b', { offers: [offer('Http', 1, { url: 'http://x.example' })] })], next_cursor: null })
    expect(page?.items).toHaveLength(1)
    expect(page?.items[0]?.offers).toHaveLength(4)
  })

  it('the price range always covers its offers; bad ids, titles and duplicates are dropped', () => {
    const page = parseGiftIdeasPage({
      items: [
        item('a', { price_min_cents: 3000, price_max_cents: 2000 }),
        item('a'),
        item('bad id'),
        item('c', { title: '   ' }),
        item('d', { title: `Lange‮Idee ${'x'.repeat(200)}` }),
        'not an item',
      ],
      next_cursor: '',
    })
    expect(page?.items.map((i) => i.id)).toEqual(['a', 'd'])
    expect(page?.items[0]).toMatchObject({ price_min_cents: 1690, price_max_cents: 3900 })
    expect([...(page?.items[1]?.title ?? '')].length).toBeLessThanOrEqual(120)
    expect(page?.items[1]?.title).not.toContain('‮')
    expect(page?.next_cursor).toBeNull()
  })

  it('not an answer at all → null', () => {
    expect(parseGiftIdeasPage(null)).toBeNull()
    expect(parseGiftIdeasPage({ items: 'x' })).toBeNull()
    expect(parseGiftIdeasPage([])).toBeNull()
  })

  it('demo pictures and demo shops are recognised', () => {
    expect(demoArtId('/api/gift-ideas/demo-art/headphones')).toBe('headphones')
    expect(demoArtId('/api/gift-ideas/demo-art/../x')).toBeNull()
    expect(demoArtId('/api/gift-ideas/img/x')).toBeNull()
    expect(isDemoShopUrl('https://markt.example/p/1')).toBe(true)
    expect(isDemoShopUrl('https://www.example.com/p/1')).toBe(true)
    expect(isDemoShopUrl('https://shop.test/p')).toBe(true)
    expect(isDemoShopUrl('https://www.otto.de/p/1')).toBe(false)
  })
})

describe('fetchGiftIdeas — the request', () => {
  beforeEach(() => {
    account.session = { user: { id: 'account-a' }, access_token: 'fixture-token-a' }
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetAccountBoundaryForTests()
  })

  it('one same-origin POST with the bearer token and exactly the contract’s fields — no cookies, no referrer', async () => {
    fetchMock.mockResolvedValue(json({ items: [item('a')], next_cursor: null }))
    const page = await fetchGiftIdeas({ ...REQUEST, cursor: 'c1' }, { expectedUserId: 'account-a' })
    expect(page.items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [target, init] = fetchMock.mock.calls[0] ?? []
    expect(String(target)).toBe(new URL(GIFT_IDEAS_PATH, ORIGIN).toString())
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token-a')
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['budget', 'cursor', 'exclude_ids', 'interests', 'lang', 'mode'])
    expect(body).toEqual({ ...REQUEST, cursor: 'c1' })
  })

  it('offline: answers "offline" at once and sends nothing', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect((await failure(fetchGiftIdeas(REQUEST))).code).toBe('offline')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'invalid_request'],
    [401, 'unauthorized'],
    [404, 'not_available'],
    [501, 'not_available'],
    [504, 'timeout'],
    [500, 'unavailable'],
    [502, 'unavailable'],
  ])('status %i → %s', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('no', { status }))
    expect((await failure(fetchGiftIdeas(REQUEST))).code).toBe(code)
  })

  it('429 keeps the Retry-After seconds', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }))
    const err = await failure(fetchGiftIdeas(REQUEST))
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterSeconds).toBe(30)
  })

  it('an answer that is not the contract → unavailable', async () => {
    fetchMock.mockResolvedValue(json({ ideas: [] }))
    expect((await failure(fetchGiftIdeas(REQUEST))).code).toBe('unavailable')
  })

  it('an abort rejects with an AbortError, never a GiftIdeasError', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_target, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    }))
    const pending = fetchGiftIdeas(REQUEST, { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('a provider that does not answer in time → timeout', async () => {
    fetchMock.mockImplementation((_target, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    }))
    expect((await failure(fetchGiftIdeas(REQUEST, { timeoutMs: 20 }))).code).toBe('timeout')
  })

  it('pinned to the screen’s account: another account in the tab → session_expired, nothing sent', async () => {
    await expect(fetchGiftIdeas(REQUEST, { expectedUserId: 'account-b' })).rejects.toMatchObject({ code: 'session_expired' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an answer for an account that ended meanwhile never reaches the caller', async () => {
    fetchMock.mockImplementation(async () => {
      account.session = { user: { id: 'account-b' }, access_token: 'fixture-token-b' }
      return json({ items: [item('a')], next_cursor: null })
    })
    await expect(fetchGiftIdeas(REQUEST, { expectedUserId: 'account-a' })).rejects.toMatchObject({ code: 'session_expired' })
  })
})

describe('contract: the same client against the demo server (src/mocks/giftIdeas.ts)', () => {
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

  it('answers invented ideas the parser keeps whole: own pictures, demo shops, never sponsored', async () => {
    const page = await fetchGiftIdeas(REQUEST, { expectedUserId: 'account-a' })
    expect(page.items.length).toBeGreaterThan(0)
    for (const idea of page.items) {
      expect(idea.id).not.toBe('demo-grinder') // excluded
      expect(demoArtId(idea.image_url)).not.toBeNull()
      expect(idea.offers.length).toBeGreaterThanOrEqual(2)
      for (const o of idea.offers) {
        expect(isDemoShopUrl(o.url)).toBe(true)
        expect(o.sponsored).toBe(false)
      }
      expect(idea.interests.some((interest) => interest === 'coffee' || interest === 'plants')).toBe(true)
      expect(idea.price_min_cents).toBeLessThanOrEqual(4000)
      expect(idea.price_max_cents).toBeGreaterThanOrEqual(1500)
    }
    expect(page.as_of).not.toBeNull()
  })

  it('refuses a request without the session (401) and a body outside the contract (400)', async () => {
    account.session = { user: { id: 'account-a' }, access_token: 'someone-else' }
    expect((await failure(fetchGiftIdeas(REQUEST))).code).toBe('unauthorized')
    account.session = { user: { id: 'account-a' }, access_token: 'fixture-token-a' }
    const raw = await fetch(new URL(GIFT_IDEAS_PATH, ORIGIN), {
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-token-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...REQUEST, name: 'Anna', budget: { min_cents: 10, max_cents: 1 } }),
    })
    expect(raw.status).toBe(400)
  })
})
