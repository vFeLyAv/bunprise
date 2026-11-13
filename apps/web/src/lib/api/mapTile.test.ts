import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/api/mapTile.ts against a stubbed fetch (exact same-origin request, type and size checks, every failure → null,
// the shared queue) and — contract — against the demo server's handler (src/mocks/places.ts).
// Invented fixture accounts and tokens only.

const account = vi.hoisted(() => ({
  session: { user: { id: 'account-a' }, access_token: 'fixture-token-a' } as { user: { id: string }; access_token: string } | null,
}))
vi.mock('../supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))

import { resetAccountBoundaryForTests } from '../accountBoundary'
import { createPlacesHandlers } from '../../mocks/places'
import { MAP_TILE_MAX_BYTES, MAP_TILE_PARALLEL, MAP_TILE_PATH, getMapTile, mapTileKey, mapTileQuery, resetMapTileQueueForTests } from './mapTile'

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
  resetMapTileQueueForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
})

describe('getMapTile', () => {
  it('one same-origin GET with the bearer token and z/x/y only, no cookies, no referrer → a PNG Blob', async () => {
    fetchMock.mockResolvedValue(answer(PNG))
    const blob = await getMapTile(15, 17335, 10946)
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBe(PNG.byteLength)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [target, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(String(target))
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toBe(MAP_TILE_PATH)
    expect([...url.searchParams]).toEqual([['z', '15'], ['x', '17335'], ['y', '10946']])
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token-a')
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
  })

  it.each([
    ['501 not_available (the switch is off)', () => Response.json({ error: 'not_available' }, { status: 501 })],
    ['502 upstream_unavailable', () => Response.json({ error: 'upstream_unavailable' }, { status: 502 })],
    ['429 rate_limited', () => Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } })],
    ['a JPEG label', () => answer(PNG, 'image/jpeg')],
    ['an SVG', () => answer(PNG, 'image/svg+xml')],
    ['no type', () => new Response(PNG.slice().buffer)],
    ['an empty body', () => answer(new Uint8Array())],
    ['a declared size over 256 KiB', () => answer(PNG, 'image/png', 200, { 'Content-Length': String(MAP_TILE_MAX_BYTES + 1) })],
    ['a real size over 256 KiB', () => answer(new Uint8Array(MAP_TILE_MAX_BYTES + 1))],
  ])('%s → null (no map, the pin tile stays; nothing thrown)', async (_name, response) => {
    fetchMock.mockImplementationOnce(async () => response())
    await expect(getMapTile(15, 1, 1)).resolves.toBeNull()
  })

  it('network failure, offline, no session or a tile outside the Worker’s grid → null', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(getMapTile(15, 1, 1)).resolves.toBeNull()
    account.session = null
    await expect(getMapTile(15, 1, 1)).resolves.toBeNull()
    account.session = { user: { id: 'account-a' }, access_token: 'fixture-token-a' }
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(getMapTile(15, 1, 1)).resolves.toBeNull()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    for (const [z, x, y] of [[10, 1, 1], [17, 1, 1], [11, 2048, 0], [15, -1, 0], [15, 1.5, 0]] as const) {
      await expect(getMapTile(z, x, y)).resolves.toBeNull()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('mapTileQuery', () => {
  it('memory-only key per tile; a tile never goes stale, "none" is asked again after a minute; answers offline too', () => {
    const options = mapTileQuery(15, 1, 2)
    expect(options.queryKey).toEqual(['mapTile', 15, 1, 2])
    expect(mapTileKey(15, 1, 2)).toEqual(options.queryKey)
    expect(options.staleTime({ state: { data: new Blob([PNG]) } })).toBe(Infinity)
    expect(options.staleTime({ state: { data: null } })).toBe(60_000)
    expect(options.retry).toBe(false)
    expect(options.networkMode).toBe('always')
  })

  it(`runs at most ${MAP_TILE_PARALLEL} tile requests at a time`, async () => {
    const releases: Array<() => void> = []
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { releases.push(() => resolve(answer(PNG))) }))
    const all = Promise.all([0, 1, 2, 3, 4, 5].map((x) => mapTileQuery(15, x, 0).queryFn()))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(MAP_TILE_PARALLEL))
    releases.shift()?.()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(MAP_TILE_PARALLEL + 1))
    while (releases.length > 0 || fetchMock.mock.calls.length < 6) {
      releases.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect((await all).every((blob) => blob?.type === 'image/png')).toBe(true)
  })
})

describe('contract with the demo server (src/mocks/places.ts)', () => {
  const server = setupServer(...createPlacesHandlers({
    viewerOf: (request) => (request.headers.get('authorization') === 'Bearer fixture-token-a' ? 'account-a' : null),
    tileDelayMs: 0,
  }))
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())
  beforeEach(() => {
    vi.unstubAllGlobals() // the real fetch, answered by MSW
  })

  it('a valid tile → the placeholder PNG; another account → null', async () => {
    expect((await getMapTile(15, 17335, 10946))?.type).toBe('image/png')
    account.session = { user: { id: 'account-b' }, access_token: 'someone-else' }
    expect(await getMapTile(15, 17335, 10946)).toBeNull() // 401
  })
})
