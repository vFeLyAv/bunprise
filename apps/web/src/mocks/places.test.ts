import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPlacesHandlers, DEMO_PLACES, searchDemoPlaces } from './places'

// Demo answers of GET /api/places: the Worker's envelope and error codes, deterministic invented places
// in an invented town — nothing real, nothing private.

const ORIGIN = 'http://places-demo.localhost'
const server = setupServer(...createPlacesHandlers({ viewerOf: (request) => (request.headers.get('authorization') === 'Bearer demo-ok' ? 'viewer-1' : null), tileDelayMs: 0 }))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

function ask(q: string, { token = 'demo-ok', lang = 'de' } = {}) {
  const url = new URL('/api/places', ORIGIN)
  url.searchParams.set('q', q)
  url.searchParams.set('lang', lang)
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
}

describe('demo place search', () => {
  it('answers like the Worker: at most six results with name, line, kind and the text to store', async () => {
    const response = await ask('caf')
    expect(response.status).toBe(200)
    const { results } = (await response.json()) as { results: { id: string; name: string; line: string; kind: string; text: string }[] }
    expect(results.map((place) => place.name)).toEqual(['Café Morgenrot', 'Café Wolke sieben'])
    expect(results[0]).toEqual({
      id: 'demo-place-01',
      name: 'Café Morgenrot',
      line: 'Lindenweg 4, 12345 Beispielstadt',
      kind: 'cafe',
      text: 'Café Morgenrot, Lindenweg 4, 12345 Beispielstadt',
      lat: 51.16212,
      lon: 10.45231,
    })
    const many = (await (await ask('se')).json()) as { results: unknown[] }
    expect(many.results.length).toBeLessThanOrEqual(6)
  })

  it('is deterministic and matches names, words, tags and streets without accents', () => {
    expect(searchDemoPlaces('Cafe').map((place) => place.id)).toEqual(searchDemoPlaces('café').map((place) => place.id))
    expect(searchDemoPlaces('park')[0]?.kind).toBe('park')
    expect(searchDemoPlaces('Seeweg').map((place) => place.name)).toContain('Biergarten am See')
    expect(searchDemoPlaces('zzz')).toEqual([])
  })

  it('only knows the invented town', () => {
    for (const place of DEMO_PLACES) {
      expect(`${place.name} ${place.street}`).not.toMatch(/Berlin|München|Hamburg|Köln|Frankfurt/)
    }
  })

  it('refuses without a session and outside 2…100 characters', async () => {
    expect((await ask('caf', { token: 'nobody' })).status).toBe(401)
    expect(await (await ask('c')).json()).toEqual({ error: 'invalid_request' })
    expect((await ask('x'.repeat(101))).status).toBe(400)
    expect((await ask('caf', { lang: 'fr' })).status).toBe(400)
  })
})

describe('demo map tiles', () => {
  const tile = (query: string, token = 'demo-ok') => fetch(new URL(`/api/map-tile?${query}`, ORIGIN), { headers: { Authorization: `Bearer ${token}` } })

  it('answers the one fictional placeholder PNG for every valid tile, like the Worker', async () => {
    const first = await tile('z=15&x=17602&y=10746')
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toBe('image/png')
    const bytes = new Uint8Array(await first.arrayBuffer())
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const other = new Uint8Array(await (await tile('z=11&x=1088&y=680')).arrayBuffer())
    expect(other).toEqual(bytes)
  })

  it('refuses without a session and outside the Worker’s grid', async () => {
    expect((await tile('z=15&x=1&y=1', 'nobody')).status).toBe(401)
    for (const query of ['z=10&x=1&y=1', 'z=17&x=1&y=1', 'z=11&x=2048&y=1', 'z=15&x=01&y=1', 'z=15&x=1', 'z=15&x=1&y=1&s=a']) {
      expect((await tile(query)).status).toBe(400)
    }
  })

  it('every demo place has a point in the middle of Germany (invented spots, 5 decimals)', () => {
    for (const place of DEMO_PLACES) {
      expect(Math.abs(place.lat - 51.16)).toBeLessThan(0.02)
      expect(Math.abs(place.lon - 10.45)).toBeLessThan(0.02)
      expect(Math.round(place.lat * 1e5) / 1e5).toBe(place.lat)
    }
  })
})
