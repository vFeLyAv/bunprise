import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'

// lib/api/linkImage.ts against a stubbed fetch (exact request, content-type and size checks, error codes, abort,
// offline, account pinning) and — contract — against the demo server's handler (src/mocks/linkImage.ts).
// Invented fixture accounts, tokens and shops only.

const account = vi.hoisted(() => ({
  session: { user: { id: 'account-a' }, access_token: 'fixture-token-a' } as { user: { id: string }; access_token: string } | null,
}))
vi.mock('../supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))

import { resetAccountBoundaryForTests } from '../accountBoundary'
import { createLinkImageHandlers } from '../../mocks/linkImage'
import { LINK_IMAGE_MAX_BYTES, LINK_IMAGE_PATH, LinkImageError, fetchLinkImage, imageTypeOf, isLinkImageError } from './linkImage'
import { isAbortError } from './linkPreview'

const fetchMock = vi.fn<typeof fetch>()
const IMAGE_URL = 'https://img.shop.example/p/1.jpg'

function image(bytes: Uint8Array, type = 'image/jpeg', extra: Record<string, string> = {}): Response {
  return new Response(bytes.slice().buffer, { status: 200, headers: { 'Content-Type': type, ...extra } })
}

async function failure(promise: Promise<unknown>): Promise<LinkImageError> {
  const err = await promise.then(() => null, (error: unknown) => error)
  expect(err).toBeInstanceOf(LinkImageError)
  return err as LinkImageError
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

describe('fetchLinkImage — the request', () => {
  it('one same-origin POST with the bearer token and the picture URL as JSON, no cookies, no referrer → a typed Blob', async () => {
    fetchMock.mockResolvedValue(image(Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]), 'image/jpeg; charset=binary'))
    const blob = await fetchLinkImage(IMAGE_URL, { expectedUserId: 'account-a' })
    expect(blob.type).toBe('image/jpeg')
    expect(blob.size).toBe(6)
    const [target, init] = fetchMock.mock.calls[0] ?? []
    expect(String(target)).toBe(new URL(LINK_IMAGE_PATH, window.location.origin).toString())
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token-a')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ url: IMAGE_URL })
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(init?.cache).toBe('no-store')
  })

  it('refuses a non-http(s) URL and offline before sending anything', async () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', `https://x.example/${'a'.repeat(2100)}`]) {
      expect((await failure(fetchLinkImage(bad))).code).toBe('invalid_request')
    }
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect((await failure(fetchLinkImage(IMAGE_URL))).code).toBe('offline')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an aborted request rejects with AbortError (not a LinkImageError)', async () => {
    const controller = new AbortController()
    controller.abort()
    const err = await fetchLinkImage(IMAGE_URL, { signal: controller.signal }).catch((e: unknown) => e)
    expect(isAbortError(err)).toBe(true)
    expect(isLinkImageError(err)).toBe(false)
  })

  it('another account than expected: session_expired, nothing sent', async () => {
    const err = await fetchLinkImage(IMAGE_URL, { expectedUserId: 'account-b' }).catch((e: unknown) => e)
    expect((err as AppError).code).toBe('session_expired')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchLinkImage — the answer', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])('accepts %s', async (type) => {
    fetchMock.mockResolvedValue(image(new Uint8Array(16), type))
    expect((await fetchLinkImage(IMAGE_URL)).type).toBe(type)
  })

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream', ''])('refuses Content-Type %j as unsupported_content', async (type) => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(16), { status: 200, headers: type ? { 'Content-Type': type } : {} }))
    expect((await failure(fetchLinkImage(IMAGE_URL))).code).toBe('unsupported_content')
  })

  it('refuses more than 5 MiB (declared or real) and an empty body', async () => {
    fetchMock.mockResolvedValue(image(new Uint8Array(4), 'image/png', { 'Content-Length': String(LINK_IMAGE_MAX_BYTES + 1) }))
    expect((await failure(fetchLinkImage(IMAGE_URL))).code).toBe('too_large')
    fetchMock.mockResolvedValue(image(new Uint8Array(LINK_IMAGE_MAX_BYTES + 1), 'image/png'))
    expect((await failure(fetchLinkImage(IMAGE_URL))).code).toBe('too_large')
    fetchMock.mockResolvedValue(image(new Uint8Array(LINK_IMAGE_MAX_BYTES), 'image/png'))
    expect((await fetchLinkImage(IMAGE_URL)).size).toBe(LINK_IMAGE_MAX_BYTES)
    fetchMock.mockResolvedValue(image(new Uint8Array(0), 'image/png'))
    expect((await failure(fetchLinkImage(IMAGE_URL))).code).toBe('unsupported_content')
  })

  it.each([
    [400, { error: 'invalid_request' }, 'invalid_request'],
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [413, { error: 'too_large' }, 'too_large'],
    [415, { error: 'unsupported_content' }, 'unsupported_content'],
    [422, { error: 'blocked_target' }, 'blocked_target'],
    [429, { error: 'rate_limited' }, 'rate_limited'],
    [502, { error: 'fetch_failed' }, 'fetch_failed'],
    [504, { error: 'timeout' }, 'timeout'],
    [404, 'not found', 'unavailable'],
    [500, { error: 'boom' }, 'unavailable'],
  ])('HTTP %i %j → %s', async (status, body, code) => {
    fetchMock.mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
    expect((await failure(fetchLinkImage(IMAGE_URL))).code).toBe(code)
  })

  it('429 keeps the Retry-After seconds; a network failure is unavailable', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '12' } }))
    expect(await failure(fetchLinkImage(IMAGE_URL))).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 12 })
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await failure(fetchLinkImage(IMAGE_URL))).code).toBe('unavailable')
  })

  it('imageTypeOf: the media type without parameters, lower case, one of five', () => {
    expect(imageTypeOf('IMAGE/WEBP ; q=1')).toBe('image/webp')
    expect(imageTypeOf('image/jpg')).toBeNull()
    expect(imageTypeOf(null)).toBeNull()
  })
})

describe('contract with the demo server (src/mocks/linkImage.ts)', () => {
  const server = setupServer(...createLinkImageHandlers({ viewerOf: (request) => (request.headers.get('Authorization') === 'Bearer fixture-token-a' ? 'account-a' : null), delayMs: 0 }))
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('any http(s) picture → the bundled WebP; "fail" / "toobig" / "svg" → the Worker codes; no token → unauthorized', async () => {
    const blob = await fetchLinkImage('https://img.shop.example/kaffeemuehle.jpg')
    expect(blob.type).toBe('image/webp')
    const head = new Uint8Array(await blob.arrayBuffer()).subarray(0, 12)
    expect(String.fromCharCode(...head.subarray(0, 4), ...head.subarray(8, 12))).toBe('RIFFWEBP')
    expect((await failure(fetchLinkImage('https://img.shop.example/fail.jpg'))).code).toBe('fetch_failed')
    expect((await failure(fetchLinkImage('https://img.shop.example/toobig.jpg'))).code).toBe('too_large')
    expect((await failure(fetchLinkImage('https://img.shop.example/logo.svg'))).code).toBe('unsupported_content')
    account.session = { user: { id: 'account-a' }, access_token: 'some-other-token' }
    expect((await failure(fetchLinkImage('https://img.shop.example/a.jpg'))).code).toBe('unauthorized')
  })
})
