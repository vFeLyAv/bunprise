import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { createMapTiles, freshSeconds, MAP_TILE_USER_AGENT, parseTileRequest } from '../src/mapTile'
import type { IconStore } from '../src/shopIcon'
import { feature, iconFixtures, jwtFixture, NOW, SUPABASE_URL } from './helpers'

// GET /api/map-tile (the place thumbnail's OpenStreetMap tiles) through the whole Worker — the MAP_TILES switch, auth,
// validation, the headers OSM gets and the ones the app gets, caching by OSM's headers with conditional requests —
// and the points of /api/places, which leave the Worker only while the switch is on. fetch is a fake.

let fixture: Awaited<ReturnType<typeof jwtFixture>>
let token: string
beforeAll(async () => {
  fixture = await jwtFixture()
  token = await fixture.token()
})

const TILE = iconFixtures.png(256, 256, 2048)
const OSM = 'https://tile.openstreetmap.org/'

/** A Cache API stand-in (keys are our own URLs). */
function memoryStore(): IconStore & { keys: () => string[] } {
  const entries = new Map<string, Response>()
  return {
    async match(key) {
      return entries.get(key)?.clone()
    },
    async put(key, response) {
      entries.set(key, response.clone())
    },
    keys: () => [...entries.keys()],
  }
}

type Answer = (url: string, headers: Headers) => Response | Promise<Response>

function harness(options: { answer?: Answer; mapTiles?: string | undefined; store?: IconStore | null } = {}) {
  let clock = NOW
  const outgoing: { url: string; headers: Headers; redirect?: RequestRedirect }[] = []
  const answer: Answer = options.answer
    ?? (() => new Response(TILE, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600', ETag: '"v1"' } }))
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    outgoing.push({ url, headers, redirect: init?.redirect })
    if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) return Response.json(fixture.jwks)
    if (url.startsWith('https://photon.komoot.io/api/')) {
      return Response.json({ type: 'FeatureCollection', features: [feature({ name: 'Fixture Café', osm_key: 'amenity', osm_value: 'cafe' })] })
    }
    if (url.startsWith(OSM)) return answer(url, headers)
    throw new Error('Unexpected test destination')
  })
  const env: Env = {
    SUPABASE_URL,
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
    ...('mapTiles' in options ? (options.mapTiles === undefined ? {} : { MAP_TILES: options.mapTiles }) : { MAP_TILES: 'osm' }),
  }
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, now: () => clock, log, tileStore: options.store === undefined ? null : options.store })
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers({
      Authorization: `Bearer ${token}`, Cookie: 'private=fixture', 'CF-Connecting-IP': '198.51.100.25',
      Referer: 'https://app.test/occasions/new?private=1', 'User-Agent': 'private-client-agent',
    })
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    return worker.fetch(new Request(`https://app.test${path}`, { ...init, headers }), env)
  }
  const tile = (z: number | string, x: number | string, y: number | string) => request(`/api/map-tile?z=${z}&x=${x}&y=${y}`)
  const osmCalls = () => outgoing.filter((call) => call.url.startsWith(OSM))
  return { worker, env, request, tile, outgoing, osmCalls, fetcher, log, advance: (ms: number) => { clock += ms } }
}

describe('parseTileRequest', () => {
  const parse = (query: string) => parseTileRequest(new URL(`https://app.test/api/map-tile?${query}`))

  it('accepts z 11–16 with x and y inside the grid', () => {
    expect(parse('z=15&x=17602&y=10746')).toEqual({ z: 15, x: 17602, y: 10746 })
    expect(parse('y=0&x=0&z=11')).toEqual({ z: 11, x: 0, y: 0 })
    expect(parse('z=16&x=65535&y=65535')).toEqual({ z: 16, x: 65535, y: 65535 })
  })

  it.each([
    '', 'z=15&x=1', 'z=10&x=1&y=1', 'z=17&x=1&y=1', 'z=0&x=0&y=0', 'z=11&x=2048&y=1', 'z=11&x=1&y=2048',
    'z=15&x=-1&y=1', 'z=15&x=01&y=1', 'z=15&x=1.0&y=1', 'z=15&x=1e3&y=1', 'z=15&x=+1&y=1', 'z=15&x=0x1&y=1',
    'z=15&x=1&y=1&z=15', 'z=15&x=1&y=1&s=a', 'z=15&x=1&y=1&callback=x', 'z=15&x=%201&y=1', 'z=15&x=&y=1',
  ])('rejects %j', (query) => {
    expect(() => parse(query)).toThrow('invalid_request')
  })
})

describe('freshSeconds', () => {
  it('honours max-age minus Age, clamped, and falls back to 7 days', () => {
    expect(freshSeconds('max-age=17987, stale-while-revalidate=604800, stale-if-error=604800', '3350')).toBe(14637)
    expect(freshSeconds('public, max-age=86400')).toBe(86400)
    expect(freshSeconds('max-age=10')).toBe(300)
    expect(freshSeconds('max-age=999999999')).toBe(30 * 24 * 3600)
    expect(freshSeconds(null)).toBe(7 * 24 * 3600)
    expect(freshSeconds('no-cache')).toBe(7 * 24 * 3600)
  })
})

describe('GET /api/map-tile', () => {
  it('answers the tile bytes with only our own headers', async () => {
    const { tile, log } = harness()
    const response = await tile(15, 17602, 10746)
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/png',
      'content-length': String(TILE.byteLength),
      'cache-control': 'private, max-age=604800',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'content-disposition': 'inline',
      'cross-origin-resource-policy': 'same-origin',
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(TILE)
    // the log never names the tile (it would tell where the place is)
    expect(log.mock.calls).toEqual([[{ endpoint: 'map-tile', status: 200, duration: 0 }]])
  })

  it('asks OSM with our honest identity only: nothing about the person, no cache-busting', async () => {
    const { tile, osmCalls } = harness()
    await tile(15, 17602, 10746)
    expect(osmCalls()).toHaveLength(1)
    const [call] = osmCalls()
    expect(call?.url).toBe('https://tile.openstreetmap.org/15/17602/10746.png')
    expect(call?.redirect).toBe('manual')
    expect(Object.fromEntries(call?.headers ?? [])).toEqual({
      'user-agent': MAP_TILE_USER_AGENT,
      referer: 'https://app.test/',
      accept: 'image/png',
    })
    expect(MAP_TILE_USER_AGENT).toMatch(/^Bunprise\/\S+ \(.*bunprise\.de.*\)$/)
  })

  it('switched off (no MAP_TILES) → 501 not_available, nothing is fetched', async () => {
    for (const mapTiles of [undefined, '', 'off', 'OSM ', 'carto']) {
      const { tile, osmCalls } = harness({ mapTiles })
      const response = await tile(15, 17602, 10746)
      expect(response.status).toBe(501)
      expect(await response.json()).toEqual({ error: 'not_available' })
      expect(osmCalls()).toEqual([])
    }
  })

  it('requires auth and does not touch the network without it', async () => {
    const { worker, env, fetcher } = harness()
    const response = await worker.fetch(new Request('https://app.test/api/map-tile?z=15&x=1&y=1'), env)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'HEAD', 'OPTIONS'])('rejects method %s', async (method) => {
    const { request, fetcher } = harness()
    const response = await request('/api/map-tile?z=15&x=1&y=1', { method })
    expect(response.status).toBe(405)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('invalid coordinates → 400 without asking OSM', async () => {
    const { tile, osmCalls } = harness()
    for (const [z, x, y] of [[17, 1, 1], [10, 1, 1], [15, 32768, 1], [15, '01', 1], [15, '../1', 1]] as const) {
      const response = await tile(z, x, y)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
    expect(osmCalls()).toEqual([])
  })

  it('serves a fresh tile from memory; after max-age it revalidates with If-None-Match (304 keeps the bytes)', async () => {
    let calls = 0
    const { tile, osmCalls, advance } = harness({
      answer: (_url, headers) => {
        calls++
        if (headers.get('If-None-Match') === '"v1"') return new Response(null, { status: 304, headers: { 'Cache-Control': 'max-age=600' } })
        return new Response(TILE, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=600', ETag: '"v1"', 'Last-Modified': 'Sat, 17 Oct 2026 03:30:23 GMT' } })
      },
    })
    expect((await tile(15, 10, 20)).status).toBe(200)
    advance(599_000)
    expect((await tile(15, 10, 20)).status).toBe(200)
    expect(calls).toBe(1)
    advance(2_000)
    const revalidated = await tile(15, 10, 20)
    expect(revalidated.status).toBe(200)
    expect(new Uint8Array(await revalidated.arrayBuffer())).toEqual(TILE)
    expect(calls).toBe(2)
    expect(osmCalls()[1]?.headers.get('If-None-Match')).toBe('"v1"')
    expect(osmCalls()[1]?.headers.get('If-Modified-Since')).toBe('Sat, 17 Oct 2026 03:30:23 GMT')
    // the 304 made it fresh again
    await tile(15, 10, 20)
    expect(calls).toBe(2)
  })

  it('concurrent requests for one tile share one download', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((done) => { release = done })
    const { tile, osmCalls } = harness({
      answer: async () => {
        await gate
        return new Response(TILE, { headers: { 'Content-Type': 'image/png' } })
      },
    })
    const all = Promise.all([tile(15, 1, 2), tile(15, 1, 2), tile(15, 1, 2)])
    await vi.waitFor(() => expect(osmCalls()).toHaveLength(1))
    release()
    expect((await all).map((response) => response.status)).toEqual([200, 200, 200])
    expect(osmCalls()).toHaveLength(1)
  })

  it('keeps tiles in the Cache API: a new isolate asks OSM only when the stored copy expired', async () => {
    const store = memoryStore()
    const first = harness({
      store,
      answer: () => new Response(TILE, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=600', ETag: '"v1"' } }),
    })
    expect((await first.tile(14, 5, 6)).status).toBe(200)
    expect(store.keys()).toEqual(['https://app.test/api/map-tile/__cache/v1/14/5/6'])
    const second = harness({ store })
    expect((await second.tile(14, 5, 6)).status).toBe(200)
    expect(second.osmCalls()).toEqual([])
    const later = harness({ store, answer: () => new Response(null, { status: 304, headers: { 'Cache-Control': 'max-age=60' } }) })
    later.advance(601_000)
    const response = await later.tile(14, 5, 6)
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(TILE)
    expect(later.osmCalls()).toHaveLength(1)
    expect(later.osmCalls()[0]?.headers.get('If-None-Match')).toBe('"v1"')
  })

  it('OSM down: an expired copy stands in for up to 7 days, then upstream_unavailable', async () => {
    // (the module directly: the fixture token would expire over days)
    let up = true
    let clock = NOW
    const tiles = createMapTiles({
      fetch: async () => (up
        ? new Response(TILE, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' } })
        : new Response('busy', { status: 503 })),
      now: () => clock,
      store: null,
    })
    const key = { z: 13, x: 7, y: 8 }
    expect(await tiles(key, 'https://app.test')).toEqual(TILE)
    up = false
    clock += 3600_000 + 6 * 24 * 3600_000
    expect(await tiles(key, 'https://app.test')).toEqual(TILE)
    clock += 2 * 24 * 3600_000
    await expect(tiles(key, 'https://app.test')).rejects.toMatchObject({ code: 'upstream_unavailable' })
  })

  it.each([
    ['an HTML page', () => new Response('<html>blocked</html>', { headers: { 'Content-Type': 'text/html' } })],
    ['a JPEG', () => new Response(iconFixtures.jpeg(256), { headers: { 'Content-Type': 'image/png' } })],
    ['a PNG of the wrong size', () => new Response(iconFixtures.png(512), { headers: { 'Content-Type': 'image/png' } })],
    ['a redirect', () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test/' } })],
    ['a 404', () => new Response('missing', { status: 404 })],
    ['an oversized body', () => new Response(new Uint8Array(300 * 1024), { headers: { 'Content-Type': 'image/png' } })],
    ['a network error', () => { throw new TypeError('network down') }],
  ])('answers 502 (never the bytes) for %s', async (_name, answer) => {
    const { tile } = harness({ answer })
    const response = await tile(15, 3, 4)
    expect(response.status).toBe(502)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(await response.json()).toEqual({ error: 'upstream_unavailable' })
  })

  it('rate-limits per person (60 a minute)', async () => {
    const { tile } = harness()
    const statuses: number[] = []
    for (let index = 0; index < 61; index++) statuses.push((await tile(16, index, 1)).status)
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
  })

  it('never lets more than 16 distinct downloads run at once (429 Retry-After 2)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((done) => { release = done })
    const tiles = createMapTiles({
      fetch: async () => {
        await gate
        return new Response(TILE, { headers: { 'Content-Type': 'image/png' } })
      },
      now: () => NOW,
      store: null,
    })
    const running = Array.from({ length: 16 }, (_, index) => tiles({ z: 15, x: index, y: 0 }, 'https://app.test'))
    await expect(tiles({ z: 15, x: 99, y: 0 }, 'https://app.test')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 2 })
    release()
    expect(await Promise.all(running)).toHaveLength(16)
  })
})

describe('GET /api/places: the point follows the MAP_TILES switch', () => {
  it('switched on: each suggestion carries its rounded point', async () => {
    const { request } = harness()
    const body = await (await request('/api/places?q=Fixture')).json() as { results: Record<string, unknown>[] }
    expect(body.results[0]).toMatchObject({ name: 'Fixture Café', lat: 51.16, lon: 10.45 })
  })

  it('switched off: exactly the old answer, no coordinates at all', async () => {
    const { request } = harness({ mapTiles: undefined })
    const response = await request('/api/places?q=Fixture')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ results: [{ id: 'osm:N123', name: 'Fixture Café', line: '', kind: 'cafe', text: 'Fixture Café' }] })
    expect(text).not.toMatch(/lat|lon|51\.16|10\.45/)
  })
})
