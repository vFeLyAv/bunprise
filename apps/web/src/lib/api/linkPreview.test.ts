import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'

// lib/api/linkPreview.ts against a stubbed fetch (exact request, every error code, abort, offline, account
// pinning) and — contract — against the demo server's handler (src/mocks/linkPreview.ts). Invented fixture
// accounts, tokens and shops only.

const account = vi.hoisted(() => ({
  session: { user: { id: 'account-a' }, access_token: 'fixture-token-a' } as { user: { id: string }; access_token: string } | null,
}))
vi.mock('../supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))

import { resetAccountBoundaryForTests } from '../accountBoundary'
import { createLinkPreviewHandlers } from '../../mocks/linkPreview'
import { LINK_PREVIEW_PATH, LinkPreviewError, fetchLinkPreview, isAbortError, parseLinkPreview, type LinkPreviewErrorCode } from './linkPreview'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

async function failure(promise: Promise<unknown>): Promise<LinkPreviewError> {
  const err = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  expect(err).toBeInstanceOf(LinkPreviewError)
  return err as LinkPreviewError
}

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

describe('fetchLinkPreview — the request', () => {
  it('sends one same-origin POST with the account’s bearer token and the link as JSON, no cookies, no referrer', async () => {
    fetchMock.mockResolvedValue(json({ url: 'https://shop.example/a', site: 'shop.example', title: 'Kopfhörer', price_cents: 7999, currency: 'EUR', partial: false }))
    await fetchLinkPreview('https://shop.example/a', { expectedUserId: 'account-a' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [target, init] = fetchMock.mock.calls[0] ?? []
    expect(String(target)).toBe(new URL(LINK_PREVIEW_PATH, window.location.origin).toString())
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token-a')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://shop.example/a' })
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
  })

  it('refuses what is not an http(s) link without sending anything', async () => {
    for (const url of ['javascript:alert(1)', 'ftp://shop.example/x', 'kein link', `https://shop.example/${'a'.repeat(2100)}`]) {
      expect((await failure(fetchLinkPreview(url))).code, url).toBe('invalid_request')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offline: answers "offline" at once and sends nothing', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect((await failure(fetchLinkPreview('https://shop.example/a'))).code).toBe('offline')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an abort rejects with an AbortError (a newer link replaced it) — never a LinkPreviewError', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_target, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    }))
    const pending = fetchLinkPreview('https://shop.example/a', { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    controller.abort()
    const err = await pending.catch((error: unknown) => error)
    expect(isAbortError(err)).toBe(true)
    expect(err).not.toBeInstanceOf(LinkPreviewError)
  })

  it('pinned to the account of the screen: another current account → nothing is sent', async () => {
    const err = await fetchLinkPreview('https://shop.example/a', { expectedUserId: 'account-b' }).catch((error: unknown) => error)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('session_expired')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an answer that arrives after the account changed in this tab is dropped', async () => {
    fetchMock.mockImplementation(async () => {
      account.session = { user: { id: 'account-b' }, access_token: 'fixture-token-b' }
      return json({ url: 'https://shop.example/a', site: 'shop.example', title: 'Geheim', price_cents: null, currency: null, partial: false })
    })
    const err = await fetchLinkPreview('https://shop.example/a').catch((error: unknown) => error)
    expect((err as AppError).code).toBe('session_expired')
  })
})

describe('fetchLinkPreview — the answer', () => {
  it('reads title, price in EUR, shop and the cleaned final link', async () => {
    fetchMock.mockResolvedValue(json({ url: 'https://shop.example/kopfhoerer', site: 'shop.example', title: '  Kabellose\n Kopfhörer ', price_cents: 7999, currency: 'EUR', partial: false }))
    await expect(fetchLinkPreview('https://shop.example/kopfhoerer?utm_source=x')).resolves.toEqual({
      url: 'https://shop.example/kopfhoerer',
      site: 'shop.example',
      title: 'Kabellose Kopfhörer',
      priceCents: 7999,
      partial: false,
      // the product details (2026-10-22): always present, null when the Worker found none
      imageUrl: null, description: null, brand: null, color: null, gtin: null,
    })
  })

  it('reads the product details: picture URL (http(s) only), description, brand, colour, GTIN — cleaned and capped', () => {
    const asked = 'https://shop.example/x'
    const full = parseLinkPreview({
      url: asked, site: 'Zalando', title: 'Sneaker', partial: false,
      image_url: 'https://img.shop.example/p/1.jpg?w=800', description: '  Leicht\u0007 und\n\n\n\nbequem. ', brand: ' Laufwerk ', color: 'Weiß /  Blau',
      gtin: '4006-3813 33931',
    }, asked)
    expect(full).toMatchObject({
      site: 'Zalando', imageUrl: 'https://img.shop.example/p/1.jpg?w=800', description: 'Leicht und\n\nbequem.', brand: 'Laufwerk', color: 'Weiß / Blau',
      gtin: '4006381333931',
    })
    const odd = parseLinkPreview({
      url: asked, site: 's', title: 'T', partial: false,
      image_url: 'javascript:alert(1)', description: '   ', brand: 'b'.repeat(90), color: 7, gtin: '123',
    }, asked)
    expect(odd).toMatchObject({ imageUrl: null, description: null, color: null, gtin: null })
    expect([...(odd?.brand ?? '')]).toHaveLength(80)
    expect([...(parseLinkPreview({ url: asked, site: 's', title: 'T', description: 'x'.repeat(1200), partial: false }, asked)?.description ?? '')]).toHaveLength(1000)
    expect(parseLinkPreview({ url: asked, site: 's', title: 'T', image_url: 'data:image/png;base64,AAAA', partial: false }, asked)?.imageUrl).toBeNull()
  })

  it('trusts nothing blindly: no title → partial, foreign currency / odd prices dropped, a bad link falls back', () => {
    const asked = 'https://shop.example/x'
    expect(parseLinkPreview({ url: 'javascript:alert(1)', site: '', title: null, price_cents: 100, currency: 'USD', partial: false }, asked)).toEqual({
      url: asked, site: 'shop.example', title: null, priceCents: null, partial: true,
      imageUrl: null, description: null, brand: null, color: null, gtin: null,
    })
    for (const price of [-1, 12.5, 100_000_001, '2500']) {
      expect(parseLinkPreview({ url: asked, site: 's', title: 'T', price_cents: price, currency: 'EUR', partial: false }, asked)?.priceCents, String(price)).toBeNull()
    }
    expect(parseLinkPreview({ url: asked, site: 's', title: 'T', price_cents: 100_000_000, currency: 'EUR', partial: false }, asked)?.priceCents).toBe(100_000_000)
    // a title is one clean line of at most 120 characters (the database limit)
    const long = parseLinkPreview({ url: asked, site: 's', title: `${'🎧'.repeat(130)}`, partial: false }, asked)
    expect([...(long?.title ?? '')]).toHaveLength(120)
    expect(parseLinkPreview({ url: asked, site: 's‮evil', title: 'A\u0000B\u0007C', partial: false }, asked)).toMatchObject({ site: 's evil', title: 'A B C' })
    expect(parseLinkPreview('not an object', asked)).toBeNull()
    expect(parseLinkPreview([], asked)).toBeNull()
  })

  it.each<[number, unknown, LinkPreviewErrorCode]>([
    [400, { error: 'invalid_request' }, 'invalid_request'],
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [413, { error: 'too_large' }, 'too_large'],
    [415, { error: 'unsupported_content' }, 'unsupported_content'],
    [422, { error: 'blocked_target' }, 'blocked_target'],
    [429, { error: 'rate_limited' }, 'rate_limited'],
    [502, { error: 'fetch_failed' }, 'fetch_failed'],
    [504, { error: 'timeout' }, 'timeout'],
    // the status decides when the body has no known code
    [502, { error: 'something_new' }, 'fetch_failed'],
    [504, 'gateway timeout', 'timeout'],
    // the Worker not there yet / anything else: one calm "unavailable"
    [404, 'not found', 'unavailable'],
    [500, { error: 'boom' }, 'unavailable'],
    [503, null, 'unavailable'],
  ])('HTTP %i %j → %s', async (status, body, code) => {
    fetchMock.mockResolvedValue(new Response(typeof body === 'string' || body === null ? body : JSON.stringify(body), { status }))
    expect((await failure(fetchLinkPreview('https://shop.example/a'))).code).toBe(code)
  })

  it('429 keeps the Retry-After seconds', async () => {
    fetchMock.mockResolvedValue(json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '30', 'Content-Type': 'application/json' } }))
    const err = await failure(fetchLinkPreview('https://shop.example/a'))
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterSeconds).toBe(30)
  })

  it('a network failure and a broken 200 body are "unavailable"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await failure(fetchLinkPreview('https://shop.example/a'))).code).toBe('unavailable')
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    expect((await failure(fetchLinkPreview('https://shop.example/a'))).code).toBe('unavailable')
    fetchMock.mockResolvedValueOnce(json({ nothing: true, url: 7 }))
    await expect(fetchLinkPreview('https://shop.example/a')).resolves.toMatchObject({ url: 'https://shop.example/a', partial: true })
  })
})

describe('contract with the demo server (src/mocks/linkPreview.ts)', () => {
  const server = setupServer(
    ...createLinkPreviewHandlers({
      viewerOf: (request) => (request.headers.get('authorization') === 'Bearer fixture-token-a' ? 'account-a' : null),
      delayMs: 0,
    }),
  )
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())
  beforeEach(() => {
    vi.unstubAllGlobals() // the real fetch, answered by the demo handler
  })

  it('the fixtures the screens and screenshots rely on', async () => {
    await expect(fetchLinkPreview('https://www.shop.example/kopfhoerer-wh9?utm_source=newsletter&farbe=schwarz')).resolves.toMatchObject({
      url: 'https://www.shop.example/kopfhoerer-wh9?farbe=schwarz',
      site: 'shop.example',
      title: 'Kabellose Kopfhörer',
      priceCents: 7999,
      partial: false,
    })
    await expect(fetchLinkPreview('https://teekanne.example/teapot-blau')).resolves.toMatchObject({
      url: 'https://teekanne.example/teapot-blau', site: 'teekanne.example', title: null, priceCents: 2490, partial: true,
    })
    await expect(fetchLinkPreview('https://www.laden.example/socken')).resolves.toMatchObject({
      url: 'https://www.laden.example/socken', site: 'laden.example', title: null, priceCents: null, partial: true,
    })
    expect((await failure(fetchLinkPreview('https://shop.example/fail'))).code).toBe('fetch_failed')
  })

  it('without the account’s token the demo server says unauthorized', async () => {
    account.session = { user: { id: 'account-a' }, access_token: 'some-other-token' }
    expect((await failure(fetchLinkPreview('https://shop.example/kopfhoerer'))).code).toBe('unauthorized')
  })
})
