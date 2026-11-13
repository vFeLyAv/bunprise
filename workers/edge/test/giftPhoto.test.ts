import { describe, expect, it, vi } from 'vitest'
import { answerCatalog, CATALOG, GIFT_ART_PREFIX, pictureUrl } from '../src/giftIdeas/catalog'
import type { CatalogItem } from '../src/giftIdeas/catalog'
import { photoIndex } from '../src/giftIdeas/photo'
import { PHOTO_MAX_BYTES, PHOTO_USER_AGENT } from '../src/giftIdeas/photoRules'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import type { IconStore } from '../src/shopIcon'
import { imageFixtures, NOW, SUPABASE_URL } from './helpers'

// GET /api/gift-ideas/img/<art>/<id> — real product photos of the catalogue (Felix 25.10, closed pilot).
// Open route (an <img> has no token), so: catalogue ids only, never a URL, the stored host only, raster
// images only, capped, fixed headers both ways, a day of caching at most. Fixtures only, no network.

const item = (id: string, art: string, image_source?: string): CatalogItem => ({
  id, art, interests: ['books'], rank: 1, title: { de: 'Ein Buch', en: 'A book' },
  offers: [{ shop: 'Laden', url: `https://shop.test/${id}`, price_cents: 1500, checked_at: '2026-10-25' }],
  ...(image_source ? { image_source } : {}),
})

const INDEX = photoIndex([
  item('cat:book', 'books', 'https://img.shop.test/book.png'),
  item('cat:hop', 'lamp', 'https://img.shop.test/hop.png'),
  item('cat:away', 'lamp', 'https://img.shop.test/away.png'),
  item('cat:svg', 'lamp', 'https://img.shop.test/vector.svg'),
  item('cat:html', 'lamp', 'https://img.shop.test/page'),
  item('cat:fake', 'lamp', 'https://img.shop.test/fake.png'),
  item('cat:huge', 'lamp', 'https://img.shop.test/huge.png'),
  item('cat:drawn', 'lamp'),
  item('cat:http', 'lamp', 'http://img.shop.test/plain.png'),
])

function memoryStore(): IconStore & { keys: () => string[] } {
  const entries = new Map<string, Response>()
  return {
    keys: () => [...entries.keys()],
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, response) => { entries.set(key, response) },
  }
}

function harness({ resolve = async (): Promise<string[]> => ['93.184.216.34'], store = null as IconStore | null, env: extra = {} as Partial<Env> } = {}) {
  const outgoing: { url: string; headers: Headers }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    outgoing.push({ url, headers: new Headers(init?.headers) })
    const png = () => new Response(imageFixtures['image/png'], { headers: { 'Content-Type': 'image/png', 'Set-Cookie': 'shop=1', 'Cache-Control': 'public, max-age=31536000' } })
    if (url === 'https://img.shop.test/book.png') return png()
    if (url === 'https://img.shop.test/hop.png') return new Response(null, { status: 302, headers: { location: '/moved/hop.png' } })
    if (url === 'https://img.shop.test/moved/hop.png') return png()
    if (url === 'https://img.shop.test/away.png') return new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/x.png' } })
    if (url === 'https://img.shop.test/vector.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } })
    if (url === 'https://img.shop.test/page') return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
    if (url === 'https://img.shop.test/fake.png') return new Response(imageFixtures['image/jpeg'], { headers: { 'Content-Type': 'image/png' } })
    if (url === 'https://img.shop.test/huge.png') return new Response(imageFixtures['image/png'], { headers: { 'Content-Type': 'image/png', 'Content-Length': String(PHOTO_MAX_BYTES + 1) } })
    throw new Error(`unexpected destination ${url}`)
  })
  const env: Env = { SUPABASE_URL, GIFT_IDEAS_SOURCES: 'catalog', ASSETS: { fetch: vi.fn(async () => new Response('asset')) }, ...extra }
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, resolve, now: () => NOW, log, photoStore: store, photoIndex: INDEX })
  const get = (path: string, init: RequestInit = {}, ip = '198.51.100.25') => worker.fetch(new Request(`https://app.test${path}`, {
    ...init,
    headers: { Cookie: 'sb-session=private', Referer: 'https://app.test/ideas', 'User-Agent': 'private-client-agent', 'CF-Connecting-IP': ip, ...init.headers },
  }), env)
  return { get, outgoing, fetcher, log }
}

describe('GET /api/gift-ideas/img/<art>/<id>', () => {
  it('serves the photo of a catalogue item without a token, with only our own headers', async () => {
    const { get, outgoing } = harness()
    const response = await get('/api/gift-ideas/img/books/cat:book')
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/png',
      'content-length': '256',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'content-disposition': 'inline',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageFixtures['image/png'])
    // exactly the stored URL, with the fixed headers only: no cookie, no referrer, not the client's agent
    expect(outgoing.map((request) => request.url)).toEqual(['https://img.shop.test/book.png'])
    expect(Object.fromEntries(outgoing[0]!.headers)).toEqual({
      'user-agent': PHOTO_USER_AGENT,
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8',
    })
  })

  it('also takes the id percent-encoded', async () => {
    const { get } = harness()
    expect((await get('/api/gift-ideas/img/books/cat%3Abook')).status).toBe(200)
  })

  it.each([
    ['an unknown id', '/api/gift-ideas/img/books/cat:nope', 404],
    ['an item without a photo', '/api/gift-ideas/img/lamp/cat:drawn', 404],
    ['a photo with a plain-http source (never indexed)', '/api/gift-ideas/img/lamp/cat:http', 404],
    ['the wrong drawing for the item', '/api/gift-ideas/img/lamp/cat:book', 404],
    ['a URL instead of an id', '/api/gift-ideas/img/books/https%3A%2F%2Fevil.test%2Fx.png', 400],
    ['a query string (also ?url=)', '/api/gift-ideas/img/books/cat:book?url=https://evil.test/x.png', 400],
    ['a path below the id', '/api/gift-ideas/img/books/cat:book/more', 400],
    ['no art segment', '/api/gift-ideas/img/cat:book', 400],
  ])('refuses %s and never fetches anything', async (_case, path, status) => {
    const { get, fetcher } = harness()
    expect((await get(path)).status).toBe(status)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('is off (404) while the catalogue is off, and GET only', async () => {
    const off = harness({ env: { GIFT_IDEAS_SOURCES: '' } })
    expect((await off.get('/api/gift-ideas/img/books/cat:book')).status).toBe(404)
    expect(off.fetcher).not.toHaveBeenCalled()
    const { get } = harness()
    expect((await get('/api/gift-ideas/img/books/cat:book', { method: 'POST' })).status).toBe(405)
  })

  it('follows a redirect on the stored host, and refuses one to another host without fetching it', async () => {
    const same = harness()
    expect((await same.get('/api/gift-ideas/img/lamp/cat:hop')).status).toBe(200)
    expect(same.outgoing.map((request) => request.url)).toEqual(['https://img.shop.test/hop.png', 'https://img.shop.test/moved/hop.png'])
    const away = harness()
    expect((await away.get('/api/gift-ideas/img/lamp/cat:away')).status).toBe(422)
    expect(away.outgoing.map((request) => request.url)).toEqual(['https://img.shop.test/away.png'])
  })

  it('refuses a stored host that resolves to a private address', async () => {
    const { get } = harness({ resolve: async () => ['10.0.0.7'] })
    expect((await get('/api/gift-ideas/img/books/cat:book')).status).toBe(422)
  })

  it.each([
    ['SVG', 'cat:svg', 415],
    ['an HTML page', 'cat:html', 415],
    ['bytes that are not the declared type', 'cat:fake', 415],
    ['more than 2 MB', 'cat:huge', 413],
  ])('refuses %s', async (_case, id, status) => {
    const { get } = harness()
    expect((await get(`/api/gift-ideas/img/lamp/${id}`)).status).toBe(status)
  })

  it('limits one address to 120 photos a minute (other addresses go on)', async () => {
    const { get } = harness()
    for (let index = 0; index < 120; index += 1) expect((await get('/api/gift-ideas/img/books/cat:book')).status).toBe(200)
    const limited = await get('/api/gift-ideas/img/books/cat:book')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBeTruthy()
    expect((await get('/api/gift-ideas/img/books/cat:book', {}, '203.0.113.9')).status).toBe(200)
  })

  it('keeps a photo in the Worker cache for at most a day and serves it from there', async () => {
    const store = memoryStore()
    const { get, fetcher } = harness({ store })
    expect((await get('/api/gift-ideas/img/books/cat:book')).status).toBe(200)
    const again = await get('/api/gift-ideas/img/books/cat:book')
    expect(again.status).toBe(200)
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(imageFixtures['image/png'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(store.keys()).toEqual(['https://app.test/api/gift-ideas/img/__cache/v1/cat%3Abook'])
    const stored = await store.match(store.keys()[0]!)
    expect(stored?.headers.get('Cache-Control')).toBe('public, max-age=86400')
  })

  it('logs only endpoint, status and duration', async () => {
    const { get, log } = harness()
    await get('/api/gift-ideas/img/books/cat:book')
    await get('/api/gift-ideas/img/books/cat:nope')
    expect(log.mock.calls.map(([entry]) => entry)).toEqual([
      { endpoint: 'gift-photo', status: 200, duration: 0 },
      { endpoint: 'gift-photo', status: 404, duration: 0 },
    ])
  })
})

describe('catalogue pictures', () => {
  it('a photo goes through our Worker, the drawing stays the fallback', () => {
    expect(pictureUrl(item('cat:book', 'books', 'https://img.shop.test/book.png'))).toBe('/api/gift-ideas/img/books/cat:book')
    expect(pictureUrl(item('cat:drawn', 'lamp'))).toBe(`${GIFT_ART_PREFIX}lamp`)
    const answer = answerCatalog(
      { interests: [], budget: { min_cents: 0, max_cents: 100_000 }, exclude_ids: [], lang: 'de' },
      { items: [item('cat:book', 'books', 'https://img.shop.test/book.png'), item('cat:drawn', 'lamp')] },
    )
    expect(answer.items.map((idea) => idea.image_url)).toEqual(['/api/gift-ideas/img/books/cat:book', `${GIFT_ART_PREFIX}lamp`])
  })

  it('every stored photo source of the real catalogue is a plain https URL the route accepts', () => {
    const withPhoto = CATALOG.filter((entry) => entry.image_source)
    const index = photoIndex(CATALOG)
    for (const entry of withPhoto) {
      const source = new URL(entry.image_source!)
      expect(source.protocol, entry.id).toBe('https:')
      expect(source.username + source.password, entry.id).toBe('')
      expect(index.get(entry.id)?.art, entry.id).toBe(entry.art)
      // the path the app gets is one the route parses back to this item
      expect(pictureUrl(entry)).toMatch(/^\/api\/gift-ideas\/img\/[a-z0-9-]+\/[A-Za-z0-9._:-]+$/)
    }
  })
})
