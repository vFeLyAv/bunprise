import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { feature, jwtFixture, NOW, SUPABASE_URL } from './helpers'

let fixture: Awaited<ReturnType<typeof jwtFixture>>
let token: string
beforeAll(async () => {
  fixture = await jwtFixture()
  token = await fixture.token()
})

function harness() {
  const outgoing: { url: string; headers: Headers; redirect?: RequestRedirect }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    outgoing.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect })
    if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) return Response.json(fixture.jwks)
    if (url.startsWith('https://photon.komoot.io/api/')) return Response.json({
      type: 'FeatureCollection', features: [feature({ name: 'Fixture Café', osm_key: 'amenity', osm_value: 'cafe' })],
    })
    if (url.startsWith('https://shop.test/')) {
      return new Response('<title>A useful gift</title>', { headers: { 'Content-Type': 'text/html' } })
    }
    throw new Error('Unexpected test destination')
  })
  const assets = vi.fn(async () => new Response('asset'))
  const env: Env = { SUPABASE_URL, ASSETS: { fetch: assets } }
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, resolve: async () => ['93.184.216.34'], now: () => NOW, log })
  const request = (path: string, options: RequestInit = {}) => {
    const headers = new Headers({
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      Cookie: 'private=fixture', 'CF-Connecting-IP': '198.51.100.25',
      'X-Forwarded-For': '198.51.100.25', 'X-Real-IP': '198.51.100.25',
      Referer: 'https://app.test/private', 'User-Agent': 'private-client-agent',
    })
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
    return worker.fetch(new Request(`https://app.test${path}`, { ...options, headers }), env)
  }
  return { worker, request, env, assets, outgoing, fetcher, log }
}

describe('Worker routing and public response contract', () => {
  it('preserves health, API 404 and asset fallback', async () => {
    const { worker, env, assets, fetcher } = harness()
    const health = await worker.fetch(new Request('https://app.test/api/health'), env)
    expect(await health.json()).toEqual({ ok: true })
    const missing = await worker.fetch(new Request('https://app.test/api/missing'), env)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('not found')
    expect(await (await worker.fetch(new Request('https://app.test/calendar'), env)).text()).toBe('asset')
    expect(assets).toHaveBeenCalledTimes(1)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['/api/link-preview', 'GET'], ['/api/link-preview', 'PUT'], ['/api/link-preview', 'OPTIONS'],
    ['/api/places?q=Berlin', 'POST'], ['/api/places?q=Berlin', 'HEAD'],
  ])('rejects wrong method %s %s', async (path, method) => {
    const { request, fetcher } = harness()
    const response = await request(path, { method })
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'method_not_allowed' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['/api/link-preview', '/api/places?q=Berlin'])('requires auth on %s', async (path) => {
    const { worker, env, fetcher } = harness()
    const response = await worker.fetch(new Request(`https://app.test${path}`, {
      method: path === '/api/link-preview' ? 'POST' : 'GET',
    }), env)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns exact preview shape and secure response headers', async () => {
    const { request } = harness()
    const response = await request('/api/link-preview', { method: 'POST', body: JSON.stringify({ url: 'https://shop.test/item?utm_source=fixture' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      url: 'https://shop.test/item', site: 'shop.test', title: 'A useful gift',
      price_cents: null, currency: null, partial: false,
      image_url: null, description: null, brand: null, color: null, gtin: null,
    })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect([...response.headers.keys()].some((key) => key.startsWith('access-control-'))).toBe(false)
  })

  it('never forwards client identity, cookies or headers to shops or Photon', async () => {
    const { request, outgoing, log } = harness()
    await request('/api/link-preview', { method: 'POST', body: JSON.stringify({ url: 'https://shop.test/item' }) })
    await request('/api/places?q=Fixture')
    const services = outgoing.filter((call) => !call.url.includes('supabase'))
    expect(services).toHaveLength(2)
    for (const call of services) {
      for (const name of ['authorization', 'cookie', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'referer']) {
        expect(call.headers.has(name)).toBe(false)
      }
    }
    expect(Object.fromEntries(services[0]!.headers)).toEqual({
      accept: 'text/html', 'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
    })
    expect(Object.fromEntries(services[1]!.headers)).toEqual({
      accept: 'application/json', 'user-agent': 'Bunprise/0.1 (place search; pilot)',
    })
    expect(log.mock.calls).toEqual([
      [{ endpoint: 'link-preview', status: 200, duration: 0 }],
      [{ endpoint: 'places', status: 200, duration: 0 }],
    ])
  })

  it.each(['broken JSON', '{}', 'null', '{"url":5}', '{"url":"file:///tmp/foo"}', '{"url":"https://user:pass@shop.test/"}'])('rejects invalid preview request %s', async (body) => {
    const response = await harness().request('/api/link-preview', { method: 'POST', body })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })

  it('rejects wrong request content type and oversized URL', async () => {
    const { request } = harness()
    for (const options of [
      { body: '{"url":"https://shop.test"}', headers: { 'Content-Type': 'text/plain' } },
      { body: JSON.stringify({ url: `https://shop.test/${'a'.repeat(2048)}` }) },
    ]) {
      expect((await request('/api/link-preview', { method: 'POST', ...options })).status).toBe(400)
    }
  })

  it('enforces 4KiB by actual bytes and declared length', async () => {
    const { request } = harness()
    for (const options of [
      { body: JSON.stringify({ url: 'https://shop.test', extra: 'ü'.repeat(2100) }) },
      { body: '{}', headers: { 'Content-Length': '4097' } },
    ]) {
      const response = await request('/api/link-preview', { method: 'POST', ...options })
      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ error: 'too_large' })
    }
  })

  it('rejects its own hostname and keeps error bodies opaque', async () => {
    const { request } = harness()
    const response = await request('/api/link-preview', { method: 'POST', body: '{"url":"https://app.test/internal"}' })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked_target' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('applies user rate limits even to cache hits, with Retry-After', async () => {
    const { request, outgoing } = harness()
    for (let i = 0; i < 20; i++) {
      expect((await request('/api/link-preview', { method: 'POST', body: '{"url":"https://shop.test/item"}' })).status).toBe(200)
    }
    const response = await request('/api/link-preview', { method: 'POST', body: '{"url":"https://shop.test/item"}' })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.json()).toEqual({ error: 'rate_limited' })
    expect(outgoing.filter((call) => call.url.includes('shop.test'))).toHaveLength(1)
  })

  it('shares the per-IP preview limit across 61 accounts in one IPv6 /64', async () => {
    const { request } = harness()
    for (let account = 0; account < 61; account++) {
      const response = await request('/api/link-preview', {
        method: 'POST',
        body: '{"url":"https://shop.test/item"}',
        headers: {
          Authorization: `Bearer ${await fixture.token(`account-${account}`)}`,
          'CF-Connecting-IP': `2001:db8:4b40:1f00::${(account + 1).toString(16)}`,
        },
      })
      expect(response.status).toBe(account < 60 ? 200 : 429)
    }
  })

  it.each([
    { path: '/api/places?q=Musterstra%C3%9Fe+12+Berlin', options: {}, destination: 'photon.komoot.io' },
    { path: '/api/link-preview', options: { method: 'POST', body: '{"url":"https://shop.test/surprise"}' }, destination: 'shop.test' },
  ])('isolates cached results by verified subject on $path', async ({ path, options, destination }) => {
    const { request, outgoing } = harness()
    const planner = await fixture.token('planner')
    const honoree = await fixture.token('honoree')
    for (const identity of [planner, planner, honoree, honoree]) {
      const response = await request(path, { ...options, headers: { Authorization: `Bearer ${identity}` } })
      expect(response.status).toBe(200)
    }
    expect(outgoing.filter((call) => call.url.includes(destination))).toHaveLength(2)
  })

  it('returns Retry-After 5 at the preview concurrency cap and admits requests after timeout', async () => {
    const { request, fetcher } = harness()
    // Complete key retrieval before fake timers and the stalled shop responses.
    await request('/api/places?q=Fixture')
    vi.useFakeTimers()
    let started = 0
    let allStarted: () => void = () => {}
    const ready = new Promise<void>((resolve) => { allStarted = resolve })
    const cancel = vi.fn()
    fetcher.mockImplementation(async () => {
      started++
      if (started === 12) allStarted()
      return new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'content-type': 'text/html' } })
    })
    const pending = Array.from({ length: 12 }, (_, index) =>
      request('/api/link-preview', { method: 'POST', body: JSON.stringify({ url: `https://shop.test/stalled-${index}` }) }))
    await ready
    const overflow = await request('/api/link-preview', { method: 'POST', body: '{"url":"https://shop.test/overflow"}' })
    expect(overflow.status).toBe(429)
    expect(overflow.headers.get('Retry-After')).toBe('5')
    expect(await overflow.json()).toEqual({ error: 'rate_limited' })
    expect(started).toBe(12)
    await vi.advanceTimersByTimeAsync(5000)
    expect((await Promise.all(pending)).every((response) => response.status === 504)).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(12)
    fetcher.mockImplementation(async () => new Response('<title>Recovered</title>', { headers: { 'content-type': 'text/html' } }))
    expect((await request('/api/link-preview', { method: 'POST', body: '{"url":"https://shop.test/recovered"}' })).status).toBe(200)
  })

  it('applies optional binding and does not call the upstream after a rejection', async () => {
    const { request, env, outgoing } = harness()
    env.RATE_LIMITER = { limit: async () => ({ success: false }) }
    const response = await request('/api/places?q=Berlin')
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(outgoing.every((call) => call.url.includes('supabase'))).toBe(true)
  })

  it('maps invalid place queries and upstream failure to exact API errors', async () => {
    const { request, fetcher } = harness()
    const invalid = await request('/api/places?q=X')
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'invalid_request' })
    fetcher.mockImplementationOnce(async () => { throw new Error('secret upstream detail') })
    const unavailable = await request('/api/places?q=Berlin')
    expect(unavailable.status).toBe(502)
    expect(await unavailable.json()).toEqual({ error: 'upstream_unavailable' })
  })
})
