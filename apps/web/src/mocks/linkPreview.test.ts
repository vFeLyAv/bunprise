import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanDemoUrl, createLinkPreviewHandlers, demoLinkPreview } from './linkPreview'

// The demo answers of POST /api/link-preview: deterministic, fictional (reserved example domains), the same
// contract as the Worker (request body, answer shape, error codes).

const TOKEN = 'Bearer demo-fixture-token'
const server = setupServer(...createLinkPreviewHandlers({ viewerOf: (request) => (request.headers.get('authorization') === TOKEN ? 'demo-user' : null), delayMs: 0 }))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

const endpoint = () => new URL('/api/link-preview', window.location.origin)

function post(body: unknown, headers: Record<string, string> = { Authorization: TOKEN, 'Content-Type': 'application/json' }) {
  return fetch(endpoint(), { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

describe('demoLinkPreview fixtures', () => {
  it('kopfhoerer → title, 79,99 €, shop.example; the link comes back cleaned', () => {
    expect(demoLinkPreview('https://www.shop.example/kopfhoerer?utm_source=x&fbclid=y&farbe=rot#top')).toEqual({
      status: 200,
      body: {
        url: 'https://www.shop.example/kopfhoerer?farbe=rot', site: 'shop.example', title: 'Kabellose Kopfhörer', price_cents: 7999, currency: 'EUR', partial: false,
        image_url: null, description: 'Over-Ear, faltbar, bis zu 30 Stunden Akku.', brand: 'Klangwerk', color: 'Mitternachtsblau', gtin: '2004006381337',
      },
    })
  })

  it('kaffeemuehle → the full product (picture address, text, brand, colour, GTIN); lampe → a picture that fails', () => {
    const full = demoLinkPreview('https://shop.example/kaffeemuehle')
    expect(full).toMatchObject({
      status: 200,
      body: { site: 'Küchenkontor', price_cents: 4990, partial: false, brand: 'Mahlwerk & Söhne', color: 'Buche natur', gtin: '2001234567800' },
    })
    const image = String(full.body.image_url)
    // a reserved example host (never loaded by the browser), and the demo /api/link-image answers it with the picture
    expect(new URL(image).hostname.endsWith('.example')).toBe(true)
    expect(image).not.toMatch(/fail|toobig|svg/)
    expect(String(full.body.description).length).toBeGreaterThan(180) // long enough for "Mehr lesen" in the sheet
    const lamp = demoLinkPreview('https://shop.example/lampe')
    expect(String(lamp.body.image_url)).toMatch(/fail/) // → 502 from the demo /api/link-image
    // every 200 answer carries every key of the contract (null when not found)
    for (const link of ['https://shop.example/teapot', 'https://laden.example/x', 'https://shop.example/lampe']) {
      expect(Object.keys(demoLinkPreview(link).body)).toEqual(expect.arrayContaining(['image_url', 'description', 'brand', 'color', 'gtin']))
    }
  })

  it('teapot → partial with a price; anything else → partial, site = host; fail → 502', () => {
    expect(demoLinkPreview('https://teekanne.example/teapot')).toMatchObject({ status: 200, body: { site: 'teekanne.example', title: null, price_cents: 2490, partial: true } })
    expect(demoLinkPreview('https://www.laden.example/x')).toMatchObject({ status: 200, body: { site: 'laden.example', title: null, price_cents: null, partial: true } })
    expect(demoLinkPreview('https://shop.example/fail')).toEqual({ status: 502, body: { error: 'fetch_failed' } })
    expect(demoLinkPreview('ftp://shop.example/x')).toEqual({ status: 400, body: { error: 'invalid_request' } })
  })

  it('cleanDemoUrl keeps real parameters and drops tracking ones', () => {
    expect(cleanDemoUrl('https://shop.example/a?utm_medium=m&id=7&gclid=g')?.toString()).toBe('https://shop.example/a?id=7')
    expect(cleanDemoUrl('mailto:x@example.test')).toBeNull()
  })
})

describe('the demo handler', () => {
  it('answers a signed-in request with the fixture', async () => {
    const response = await post({ url: 'https://shop.example/kopfhoerer' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ title: 'Kabellose Kopfhörer', price_cents: 7999 })
  })

  it('401 without the session’s token; 400 for a broken body, a missing or too long link, a wrong content type', async () => {
    expect((await post({ url: 'https://shop.example/a' }, { 'Content-Type': 'application/json' })).status).toBe(401)
    for (const body of ['{nope', { link: 'https://shop.example/a' }, { url: '' }, { url: `https://shop.example/${'a'.repeat(2100)}` }, { url: 7 }]) {
      const response = await post(body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
    expect((await post({ url: 'https://shop.example/a' }, { Authorization: TOKEN, 'Content-Type': 'text/plain' })).status).toBe(400)
  })

  it('fail → 502 fetch_failed', async () => {
    const response = await post({ url: 'https://shop.example/fail' })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'fetch_failed' })
  })
})
