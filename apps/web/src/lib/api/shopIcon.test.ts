import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/api/shopIcon.ts against a stubbed fetch (exact same-origin request, type and size checks, every failure → null,
// the shared queue) and — contract — against the demo server's handler (src/mocks/shopIcons.ts).
// Invented fixture accounts, tokens and shops only.

const account = vi.hoisted(() => ({
  session: { user: { id: 'account-a' }, access_token: 'fixture-token-a' } as { user: { id: string }; access_token: string } | null,
}))
vi.mock('../supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))

import { resetAccountBoundaryForTests } from '../accountBoundary'
import { createShopIconHandlers } from '../../mocks/shopIcons'
import {
  SHOP_ICON_MAX_BYTES, SHOP_ICON_PARALLEL, SHOP_ICON_PATH, getShopIcon, resetShopIconQueueForTests, shopIconHost, shopIconKey, shopIconQuery,
} from './shopIcon'

const fetchMock = vi.fn<typeof fetch>()
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function answer(bytes: Uint8Array, type = 'image/png', status = 200, extra: Record<string, string> = {}): Response {
  return new Response(bytes.slice().buffer, { status, headers: { 'Content-Type': type, ...extra } })
}

beforeEach(() => {
  account.session = { user: { id: 'account-a' }, access_token: 'fixture-token-a' }
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  resetShopIconQueueForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
})

describe('shopIconHost — the same key as the Worker', () => {
  it.each([
    ['zalando.de', 'zalando.de'], ['www.Zalando.DE', 'zalando.de'], ['m.zalando.de', 'zalando.de'], ['zalando.de.', 'zalando.de'],
    ['kuechenkontor.example', 'kuechenkontor.example'], ['bücher.example', 'xn--bcher-kva.example'], ['m.de', 'm.de'],
  ])('%s → %s', (input, key) => {
    expect(shopIconHost(input)).toBe(key)
  })

  it.each([null, undefined, '', 'localhost', 'https://zalando.de', 'zalando.de/x', 'zalando.de:8080', 'a@zalando.de', '10.0.0.1', '[::1]', 'zal ando.de'])(
    '%j → null', (input) => {
      expect(shopIconHost(input)).toBeNull()
    },
  )
})

describe('getShopIcon', () => {
  it('one same-origin GET with the bearer token and the host key, no cookies, no referrer → a typed Blob', async () => {
    fetchMock.mockResolvedValue(answer(PNG, 'image/png; charset=binary'))
    const blob = await getShopIcon('www.Kuechenkontor.example')
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBe(PNG.byteLength)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [target, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(String(target))
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toBe(SHOP_ICON_PATH)
    expect([...url.searchParams]).toEqual([['host', 'kuechenkontor.example']])
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token-a')
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
  })

  it('ICO answers become image/x-icon Blobs (also from the IANA name)', async () => {
    fetchMock.mockResolvedValueOnce(answer(PNG, 'image/vnd.microsoft.icon'))
    expect((await getShopIcon('laden.example'))?.type).toBe('image/x-icon')
  })

  it.each([
    ['404 not_found', () => Response.json({ error: 'not_found' }, { status: 404 })],
    ['429 rate_limited', () => Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } })],
    ['401 unauthorized', () => Response.json({ error: 'unauthorized' }, { status: 401 })],
    ['an SVG', () => answer(PNG, 'image/svg+xml')],
    ['an HTML page', () => answer(PNG, 'text/html')],
    ['no type', () => new Response(PNG.slice().buffer)],
    ['an empty body', () => answer(new Uint8Array(), 'image/png')],
    ['a declared size over 256 KiB', () => answer(PNG, 'image/png', 200, { 'Content-Length': String(SHOP_ICON_MAX_BYTES + 1) })],
    ['a real size over 256 KiB', () => answer(new Uint8Array(SHOP_ICON_MAX_BYTES + 1), 'image/png')],
  ])('%s → null (the letter stays; nothing is thrown, nothing toasted)', async (_name, response) => {
    fetchMock.mockImplementationOnce(async () => response())
    await expect(getShopIcon('laden.example')).resolves.toBeNull()
  })

  it('network failure, offline, no session or no plain hostname → null', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(getShopIcon('laden.example')).resolves.toBeNull()
    account.session = null
    await expect(getShopIcon('laden.example')).resolves.toBeNull()
    account.session = { user: { id: 'account-a' }, access_token: 'fixture-token-a' }
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(getShopIcon('laden.example')).resolves.toBeNull()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await expect(getShopIcon('10.0.0.1')).resolves.toBeNull()
    await expect(getShopIcon('https://laden.example/')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('shopIconQuery', () => {
  it('memory-only key per shop; an icon never goes stale, "none" is asked again after a while; no retries', () => {
    const options = shopIconQuery('laden.example')
    expect(options.queryKey).toEqual(['shopIcon', 'laden.example'])
    expect(shopIconKey('laden.example')).toEqual(options.queryKey)
    expect(options.staleTime({ state: { data: new Blob([PNG]) } })).toBe(Infinity)
    expect(options.staleTime({ state: { data: null } })).toBe(15 * 60_000)
    expect(options.retry).toBe(false)
    expect(options.refetchOnWindowFocus).toBe(false)
  })

  it(`runs at most ${SHOP_ICON_PARALLEL} icon requests at a time`, async () => {
    const releases: Array<() => void> = []
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { releases.push(() => resolve(answer(PNG))) }))
    const all = Promise.all(['a', 'b', 'c', 'd', 'e'].map((name) => shopIconQuery(`${name}.example`).queryFn()))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(SHOP_ICON_PARALLEL))
    releases.shift()?.()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(SHOP_ICON_PARALLEL + 1))
    while (releases.length > 0 || fetchMock.mock.calls.length < 5) {
      releases.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect((await all).every((blob) => blob?.type === 'image/png')).toBe(true)
  })
})

describe('contract with the demo server (src/mocks/shopIcons.ts)', () => {
  const server = setupServer(...createShopIconHandlers({
    viewerOf: (request) => (request.headers.get('authorization') === 'Bearer fixture-token-a' ? 'account-a' : null),
    delayMs: 0,
  }))
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())
  beforeEach(() => {
    vi.unstubAllGlobals() // the real fetch, answered by MSW
  })

  it('a demo shop → its placeholder icon; a real shop → null (the demo never ships real logos)', async () => {
    expect((await getShopIcon('www.kuechenkontor.example'))?.type).toBe('image/png')
    expect((await getShopIcon('lichthaus.example'))?.type).toBe('image/x-icon')
    expect(await getShopIcon('amazon.de')).toBeNull()
    account.session = { user: { id: 'account-b' }, access_token: 'someone-else' }
    expect(await getShopIcon('kuechenkontor.example')).toBeNull() // 401
  })
})
