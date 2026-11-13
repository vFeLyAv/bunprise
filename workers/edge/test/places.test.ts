import { describe, expect, it, vi } from 'vitest'
import { createPlaces, mapPlaces, parsePlaceQuery, withoutPoints } from '../src/places'
import { feature, NOW } from './helpers'

const collection = (properties: Record<string, unknown>) => ({ type: 'FeatureCollection', features: [feature(properties)] })
const cafe = { name: 'Café Test', street: 'Hauptstraße', housenumber: '5', postcode: '10115', city: 'Berlin', osm_key: 'amenity', osm_value: 'cafe' }

describe('places mapping', () => {
  it.each([
    ['amenity', 'cafe', 'cafe'], ['amenity', 'restaurant', 'restaurant'],
    ['amenity', 'pub', 'bar'], ['amenity', 'bar', 'bar'], ['leisure', 'park', 'park'],
    ['amenity', 'events_venue', 'venue'], ['leisure', 'stadium', 'venue'],
    ['tourism', 'museum', 'venue'], ['place', 'city', 'city'],
    ['building', 'house', 'address'], ['shop', 'books', 'other'],
  ])('maps %s=%s to %s', (osm_key, osm_value, kind) => {
    expect(mapPlaces(collection({ ...cafe, osm_key, osm_value })).results[0]?.kind).toBe(kind)
  })

  it('returns the exact allow-listed fields, formatted address and one point, never the raw geometry', () => {
    const result = mapPlaces(collection({ ...cafe, extent: [10.4, 51.2, 10.5, 51.1] }))
    expect(result).toEqual({ results: [{
      id: 'osm:N123', name: 'Café Test', line: 'Hauptstraße 5, 10115 Berlin',
      kind: 'cafe', text: 'Café Test, Hauptstraße 5, 10115 Berlin', lat: 51.16, lon: 10.45,
    }] })
    expect(JSON.stringify(result)).not.toMatch(/geometry|coordinates|extent|10\.4,/)
    // without the thumbnail switch (index.ts) not even the point leaves
    expect(JSON.stringify(withoutPoints(result))).not.toMatch(/lat|lon|51\.16|10\.45/)
  })

  it('rounds the point to 5 decimals and drops it when the geometry is not a usable point', () => {
    const at = (geometry: unknown) => {
      const place = mapPlaces({ features: [{ ...feature(cafe), geometry }] }).results[0]
      return place && place.lat !== undefined ? [place.lat, place.lon] : null
    }
    expect(at({ type: 'Point', coordinates: [13.4049539, 52.5200066] })).toEqual([52.52001, 13.40495])
    expect(at({ type: 'Point', coordinates: [-0.000001, -0.000001] })).toEqual([0, 0])
    for (const geometry of [
      null, 'Point', { type: 'LineString', coordinates: [[1, 2], [3, 4]] }, { type: 'Point', coordinates: ['13', '52'] },
      { type: 'Point', coordinates: [13] }, { type: 'Point', coordinates: [181, 52] }, { type: 'Point', coordinates: [13, 86] },
      { type: 'Point', coordinates: [Number.NaN, 52] }, { type: 'Point', coordinates: [13, Infinity] },
    ]) {
      expect(at(geometry)).toBeNull()
    }
    // a place without a usable point is still a suggestion (free of a map)
    expect(mapPlaces({ features: [{ ...feature(cafe), geometry: null }] }).results).toHaveLength(1)
  })

  it('formats cities and unnamed addresses', () => {
    expect(mapPlaces(collection({ name: 'Berlin', country: 'Deutschland', osm_key: 'place', osm_value: 'city' })).results[0]?.line).toBe('Berlin, Deutschland')
    expect(mapPlaces(collection({ street: 'Teststraße', housenumber: '7', type: 'house' })).results[0]).toMatchObject({ name: '', text: 'Teststraße 7', kind: 'address' })
  })

  it('limits output to six valid unique results and every display field to 200 characters', () => {
    const result = mapPlaces({ features: Array.from({ length: 12 }, (_, i) => feature({ ...cafe, osm_id: i + 1, name: 'N'.repeat(300) })) })
    expect(result.results).toHaveLength(6)
    expect(result.results.every((place) => [place.name, place.line, place.text].every((value) => value.length <= 200))).toBe(true)
    expect(mapPlaces({ features: [feature(cafe), feature(cafe), feature({ ...cafe, osm_type: 'invalid' })] }).results).toHaveLength(1)
  })

  it('cuts names, address lines and combined text on code-point boundaries', () => {
    const place = mapPlaces(collection({
      name: `${'a'.repeat(199)}🎁`, street: `${'b'.repeat(199)}𠮷`,
      city: 'Berlin', osm_key: 'amenity', osm_value: 'cafe',
    })).results[0]!
    expect(place.name).toBe('a'.repeat(199))
    expect(place.line).toBe(`${'b'.repeat(199)},`)
    expect(place.text).toBe(`${'a'.repeat(199)},`)
    expect(mapPlaces(collection({ street: 'b'.repeat(198), housenumber: '🎁' })).results[0]?.line)
      .toBe('b'.repeat(198))
    expect(mapPlaces(collection({ name: 'N', street: `${'b'.repeat(196)}🎁` })).results[0]?.text)
      .toBe(`N, ${'b'.repeat(196)}`)
    expect(mapPlaces(collection({ name: 'N', street: `${'b'.repeat(195)}🎁` })).results[0]?.text)
      .toBe(`N, ${'b'.repeat(195)}🎁`)
  })

  it('sanitizes every upstream display field, including C1, bidi controls and lone surrogates', () => {
    expect(mapPlaces(collection({
      name: 'Ca\u0000fé\u200e\u2066', street: 'Main\u001b\u0085Road\u202e',
      housenumber: '1\u200f', postcode: '10\u061c123', city: 'Ber\u2069lin\ud800',
    })).results[0]).toMatchObject({
      name: 'Ca\ufffdfé', line: 'Main Road 1, 10123 Berlin\ufffd',
      text: 'Ca\ufffdfé, Main Road 1, 10123 Berlin\ufffd',
    })
    expect(mapPlaces(collection({
      name: 'Ber\u2067lin', country: 'Deutsch\u202aland\udfff', osm_key: 'place', osm_value: 'city',
    })).results[0]?.line).toBe('Berlin, Deutschland\ufffd')
    expect(mapPlaces(collection({ name: 'Café \u202eraboof\u0085' })).results[0]?.name).toBe('Café raboof')
  })

  it('skips malformed features and rejects malformed collections', () => {
    expect(mapPlaces({ features: [null, {}, feature({ name: 'No identity', osm_id: -1 }), feature({})] })).toEqual({ results: [] })
    expect(() => mapPlaces({ error: 'upstream secret' })).toThrow('upstream_unavailable')
  })
})

describe('places validation and fetching', () => {
  it.each(['', '?q=x', `?q=${'x'.repeat(101)}`, '?q=Berlin&lang=fr', '?q=Berlin&lang=', '?q=AB&q=CD', '?q=AB%00CD'])('rejects %s', (query) => {
    expect(() => parsePlaceQuery(new URL(`https://app.test/api/places${query}`))).toThrow('invalid_request')
  })

  it('trims, collapses whitespace and defaults to German', () => {
    expect(parsePlaceQuery(new URL('https://app.test/api/places?q=%20Café%20%20Berlin%20'))).toEqual({ q: 'Café Berlin', lang: 'de' })
  })

  it('sets the fixed upstream parameters/headers and caches a user’s normalised query/language for 24h', async () => {
    let now = NOW
    const fetcher = vi.fn(async () => Response.json(collection(cafe)))
    const places = createPlaces({ fetch: fetcher, now: () => now })
    const query = (value: string) => parsePlaceQuery(new URL(`https://app.test/api/places?q=${encodeURIComponent(value)}`))
    await places(query(' Café   Berlin '), 'user-1')
    await places(query('café berlin'), 'user-1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      q: 'Café Berlin', lang: 'de', limit: '6', lat: '51.16', lon: '10.45', zoom: '6', location_bias_scale: '0.4',
    })
    expect(new URL(url).origin).toBe('https://photon.komoot.io')
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: 'application/json', 'user-agent': 'Bunprise/0.1 (place search; pilot)' })
    expect(init.redirect).toBe('manual')
    await places({ q: 'Café Berlin', lang: 'en' }, 'user-1')
    expect(fetcher).toHaveBeenCalledTimes(2)
    now += 24 * 60 * 60 * 1000
    await places(query('café berlin'), 'user-1')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it.each([500, 429, 302])('maps upstream %s to upstream_unavailable', async (status) => {
    const places = createPlaces({ fetch: async () => new Response('private upstream message', { status }) })
    await expect(places({ q: 'Berlin', lang: 'de' }, 'user-1')).rejects.toMatchObject({ code: 'upstream_unavailable', status: 502 })
  })

  it('maps invalid JSON and oversized upstream bodies to 502 and does not cache failures', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('invalid json'))
      .mockResolvedValueOnce(new Response('x'.repeat(256 * 1024 + 1)))
      .mockResolvedValueOnce(Response.json(collection(cafe)))
    const places = createPlaces({ fetch: fetcher })
    const query = { q: 'Berlin', lang: 'de' as const }
    await expect(places(query, 'user-1')).rejects.toMatchObject({ status: 502 })
    await expect(places(query, 'user-1')).rejects.toMatchObject({ status: 502 })
    await expect(places(query, 'user-1')).resolves.toHaveProperty('results')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('times out after 3s even when the transport ignores cancellation', async () => {
    vi.useFakeTimers()
    const places = createPlaces({ fetch: () => new Promise<Response>(() => {}) })
    const pending = expect(places({ q: 'Berlin', lang: 'de' }, 'user-1')).rejects.toMatchObject({ code: 'timeout', status: 504 })
    await vi.advanceTimersByTimeAsync(3000)
    await pending
  })

  it('includes streamed body time in the 3s budget', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const places = createPlaces({ fetch: async () => new Response(new ReadableStream({ cancel })) })
    const pending = expect(places({ q: 'Berlin', lang: 'de' }, 'user-1')).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(3000)
    await pending
    expect(cancel).toHaveBeenCalled()
  })

  it('coalesces simultaneous searches and evicts least recently used entries after 500', async () => {
    const fetcher = vi.fn(async () => Response.json(collection(cafe)))
    const places = createPlaces({ fetch: fetcher })
    await Promise.all([places({ q: 'Berlin', lang: 'de' }, 'user-1'), places({ q: 'Berlin', lang: 'de' }, 'user-1')])
    expect(fetcher).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 500; i++) await places({ q: `Place ${i}`, lang: 'de' }, 'user-1')
    await places({ q: 'Berlin', lang: 'de' }, 'user-1')
    expect(fetcher).toHaveBeenCalledTimes(502)
  })

  it('never serves another user’s cached place search', async () => {
    let requests = 0
    const fetcher = vi.fn(async () => Response.json(collection({ ...cafe, name: `Place ${++requests}` })))
    const places = createPlaces({ fetch: fetcher, now: () => NOW })
    const query = { q: 'Musterstraße 12 Berlin', lang: 'de' as const }
    const planner = await places(query, 'party-planner')
    const honoree = await places(query, 'honoree')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(planner.results[0]?.name).toBe('Place 1')
    expect(honoree.results[0]?.name).toBe('Place 2')
    await expect(places(query, 'party-planner')).resolves.toBe(planner)
    await expect(places(query, 'honoree')).resolves.toBe(honoree)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('coalesces only searches from the same user, including while an identical query is pending', async () => {
    const resolveRequests: Array<(response: Response) => void> = []
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveRequests.push(resolve) }))
    const places = createPlaces({ fetch: fetcher })
    const planner = places({ q: 'Musterstraße 12 Berlin', lang: 'de' }, 'party-planner')
    const repeated = places({ q: 'musterstraße 12 berlin', lang: 'de' }, 'party-planner')
    const honoree = places({ q: 'Musterstraße 12 Berlin', lang: 'de' }, 'honoree')
    expect(fetcher).toHaveBeenCalledTimes(2)
    resolveRequests[1]!(Response.json(collection({ ...cafe, name: 'Honoree result' })))
    await expect(honoree).resolves.toMatchObject({ results: [{ name: 'Honoree result' }] })
    resolveRequests[0]!(Response.json(collection({ ...cafe, name: 'Planner result' })))
    const plannerResult = await planner
    expect(plannerResult.results[0]?.name).toBe('Planner result')
    await expect(repeated).resolves.toBe(plannerResult)
  })
})
