import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createShopIconHandlers, DEMO_SHOP_ICON_HOSTS, demoShopIcon } from './shopIcons'

// The demo answers of GET /api/shop-icon: neutral placeholder icons (drawn for this repo, no real brand) for the
// demo's own shop domains, 404 for every other host — real shops included. Same contract as the Worker.

const TOKEN = 'Bearer demo-fixture-token'
const server = setupServer(...createShopIconHandlers({ viewerOf: (request) => (request.headers.get('authorization') === TOKEN ? 'demo-user' : null), delayMs: 0 }))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

const isPng = (bytes: Uint8Array) => [0x89, 0x50, 0x4e, 0x47].every((byte, index) => bytes[index] === byte)
const isIco = (bytes: Uint8Array) => bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0

describe('demoShopIcon fixtures', () => {
  it('every demo shop domain has a real PNG or ICO (also behind www. / m. / upper case)', () => {
    expect(DEMO_SHOP_ICON_HOSTS).toEqual(['kuechenkontor.example', 'hausundfaden.example', 'grillhuette.example', 'lichthaus.example', 'shop.example', 'example.com'])
    for (const host of DEMO_SHOP_ICON_HOSTS) {
      for (const spelling of [host, `www.${host}`, `m.${host}`, host.toUpperCase()]) {
        const answer = demoShopIcon(spelling)
        expect(answer.status, spelling).toBe(200)
        if (answer.status !== 200) continue
        expect(answer.type === 'image/png' ? isPng(answer.bytes) : isIco(answer.bytes), spelling).toBe(true)
        expect(answer.bytes.byteLength).toBeLessThan(8 * 1024)
      }
    }
    expect(demoShopIcon('lichthaus.example')).toMatchObject({ type: 'image/x-icon' })
  })

  it('real shops and unknown hosts → 404 (the demo ships no real logos); no plain hostname → 400', () => {
    for (const host of ['amazon.de', 'idealo.de', 'google.de', 'ebay.de', 'laden.example']) {
      expect(demoShopIcon(host)).toEqual({ status: 404, error: 'not_found' })
    }
    for (const raw of [null, '', 'https://shop.example', 'shop.example:8080', '10.0.0.1']) {
      expect(demoShopIcon(raw)).toEqual({ status: 400, error: 'invalid_request' })
    }
  })
})

describe('GET /api/shop-icon (demo)', () => {
  const get = (host: string, headers: Record<string, string> = { Authorization: TOKEN }) =>
    fetch(new URL(`/api/shop-icon?host=${encodeURIComponent(host)}`, window.location.origin), { headers })

  it('answers the icon bytes with their type, private caching and nosniff', async () => {
    const response = await get('www.grillhuette.example')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=604800')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(isPng(new Uint8Array(await response.arrayBuffer()))).toBe(true)
  })

  it('401 without a demo session, 404 { error } for other shops', async () => {
    expect((await get('shop.example', {})).status).toBe(401)
    const missing = await get('amazon.de')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not_found' })
  })
})
