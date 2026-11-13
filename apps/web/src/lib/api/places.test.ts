import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Client of GET /api/places (our Worker): the bearer token of the captured account, strict reading of the
// answer, one calm error code per failure, nothing sent offline or for a too short / too long query.
// Invented fixtures only.

const identity = vi.hoisted(() => ({
  asAccount: vi.fn(async (_expected: string | undefined, request: (account: { accessToken: string }) => Promise<unknown>) =>
    request({ accessToken: 'fixture-token' }),
  ),
  bearer: (account: { accessToken: string }) => `Bearer ${account.accessToken}`,
}))
vi.mock('./identity', () => identity)

import { parsePlacesResponse, PlacesError, searchPlaces } from './places'

const fetchMock = vi.fn()

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

const CAFE = { id: 'p1', name: 'Café Morgenrot', line: 'Lindenweg 4, 12345 Beispielstadt', kind: 'cafe', text: 'Café Morgenrot, Lindenweg 4, 12345 Beispielstadt' }

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function failure(promise: Promise<unknown>): Promise<PlacesError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof PlacesError) return err
    throw err
  }
  throw new Error('expected a PlacesError')
}

describe('searchPlaces', () => {
  it('asks our Worker with the account token, the trimmed query and the UI language', async () => {
    fetchMock.mockResolvedValue(json(200, { results: [CAFE] }))
    const results = await searchPlaces('  Café   Morg ', { lang: 'de', expectedUserId: 'user-1' })
    expect(results).toEqual([CAFE])
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toBe('/api/places')
    expect(url.searchParams.get('q')).toBe('Café Morg')
    expect(url.searchParams.get('lang')).toBe('de')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fixture-token')
    expect(init.credentials).toBe('omit')
    expect(identity.asAccount).toHaveBeenCalledWith('user-1', expect.any(Function))
  })

  it('sends nothing offline or for a query outside 2…100 characters', async () => {
    expect((await failure(searchPlaces('C', { lang: 'de' }))).code).toBe('invalid_request')
    expect((await failure(searchPlaces('x'.repeat(101), { lang: 'de' }))).code).toBe('invalid_request')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect((await failure(searchPlaces('Café', { lang: 'de' }))).code).toBe('offline')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps every error status of the contract to a calm code', async () => {
    const cases: [number, string][] = [
      [400, 'invalid_request'],
      [401, 'unauthorized'],
      [429, 'rate_limited'],
      [502, 'upstream_unavailable'],
      [504, 'timeout'],
      [500, 'upstream_unavailable'],
    ]
    for (const [status, code] of cases) {
      fetchMock.mockResolvedValueOnce(json(status, { error: 'whatever the server says' }, status === 429 ? { 'Retry-After': '7' } : {}))
      const error = await failure(searchPlaces('Café', { lang: 'en' }))
      expect(error.code).toBe(code)
      if (status === 429) expect(error.retryAfter).toBe(7)
    }
  })

  it('turns a dropped connection into "network" and a broken body into "bad_response"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await failure(searchPlaces('Café', { lang: 'de' }))).code).toBe('network')
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    expect((await failure(searchPlaces('Café', { lang: 'de' }))).code).toBe('bad_response')
    fetchMock.mockResolvedValueOnce(json(200, { nope: [] }))
    expect((await failure(searchPlaces('Café', { lang: 'de' }))).code).toBe('bad_response')
  })

  it('lets an aborted request fail as an AbortError (a newer keystroke), not as a PlacesError', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_url: URL, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    )
    const pending = searchPlaces('Café', { lang: 'de', signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports an account that ended meanwhile as unauthorized', async () => {
    identity.asAccount.mockRejectedValueOnce(Object.assign(new Error('errors.session_expired'), { code: 'session_expired' }))
    expect((await failure(searchPlaces('Café', { lang: 'de' }))).code).toBe('unauthorized')
  })
})

describe('reading the answer strictly', () => {
  it('keeps clean results only: names, ≤ 200 characters, known kinds, no doubles, at most six', () => {
    const long = { ...CAFE, id: 'p-long', text: 'x'.repeat(201) }
    const results = parsePlacesResponse({
      results: [
        CAFE,
        { ...CAFE }, // the same id again
        { id: 'p2', name: '  Rosengarten  am Fluss ', line: 'Uferpromenade 1', kind: 'park', text: 'Rosengarten am Fluss, Uferpromenade 1' },
        { id: 'p3', name: 'Ort', line: '', kind: 'castle', text: 'Ort' },
        long,
        { id: 'p4', name: '', text: 'no name' },
        { id: 'p5', name: 'No text' },
        'junk',
        ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, name: `Platz ${i}`, line: '', kind: 'address', text: `Platz ${i}` })),
      ],
    })
    expect(results).toHaveLength(6)
    expect(results[0]).toEqual(CAFE)
    expect(results[1]).toEqual({ id: 'p2', name: 'Rosengarten am Fluss', line: 'Uferpromenade 1', kind: 'park', text: 'Rosengarten am Fluss, Uferpromenade 1' })
    expect(results[2]?.kind).toBe('other')
    expect(results.some((place) => place.id === 'p-long' || place.id === 'p5')).toBe(false)
    // a bare address without a name of its own keeps its line as the name
    expect(results[3]).toEqual({ id: 'p4', name: 'no name', line: '', kind: 'other', text: 'no name' })
  })

  it('names a bare address by its line, shown once', () => {
    expect(
      parsePlacesResponse({ results: [{ id: 'osm:W1', name: '', line: 'Lindenweg 4, 12345 Beispielstadt', kind: 'address', text: 'Lindenweg 4, 12345 Beispielstadt' }] }),
    ).toEqual([{ id: 'osm:W1', name: 'Lindenweg 4, 12345 Beispielstadt', line: '', kind: 'address', text: 'Lindenweg 4, 12345 Beispielstadt' }])
  })

  it('takes a point only as two finite numbers inside the map (the Worker sends one while its map switch is on)', () => {
    const at = (lat: unknown, lon: unknown) => parsePlacesResponse({ results: [{ ...CAFE, lat, lon }] })[0]?.point
    expect(at(51.16212, 10.45231)).toEqual({ lat: 51.16212, lon: 10.45231 })
    expect(at(-33.9, 151.2)).toEqual({ lat: -33.9, lon: 151.2 })
    for (const [lat, lon] of [['51.1', '10.4'], [51.1, undefined], [undefined, undefined], [Number.NaN, 10], [51, Infinity], [86, 10], [51, 181], [null, null]]) {
      expect(at(lat, lon)).toBeUndefined()
    }
    // no point → the suggestion is exactly as before (no empty key)
    expect(Object.keys(parsePlacesResponse({ results: [CAFE] })[0] ?? {})).not.toContain('point')
  })
})
