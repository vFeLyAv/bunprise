import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { iconFixtures, jwtFixture, NOW, SUPABASE_URL } from './helpers'

// GET /api/shop-icon through the whole Worker: auth, rate limits, error shape, response headers and the per-host
// cache. Fictional shop hosts; fetch and DNS are fakes.

let fixture: Awaited<ReturnType<typeof jwtFixture>>
let token: string
beforeAll(async () => {
  fixture = await jwtFixture()
  token = await fixture.token()
})

const ICON = iconFixtures.png(180)

function harness(resolve = async (hostname: string): Promise<string[]> => (hostname.includes('intern') ? ['10.1.2.3'] : ['93.184.216.34'])) {
  const outgoing: { url: string; headers: Headers }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    outgoing.push({ url, headers: new Headers(init?.headers) })
    if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) return Response.json(fixture.jwks)
    if (url === 'https://laden.example/') {
      return new Response('<head><link rel="apple-touch-icon" href="/touch.png"></head>', {
        headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=shop' },
      })
    }
    if (url === 'https://laden.example/touch.png') {
      return new Response(ICON, {
        headers: { 'Content-Type': 'image/png', 'Set-Cookie': 'tracking=shop', 'Access-Control-Allow-Origin': '*', 'X-Shop-Secret': 'internal' },
      })
    }
    return new Response('<h1>Not found</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } })
  })
  const env: Env = { SUPABASE_URL, ASSETS: { fetch: vi.fn(async () => new Response('asset')) } }
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, resolve, now: () => NOW, log, iconStore: null })
  const request = (path: string, options: RequestInit = {}) => {
    const headers = new Headers({
      Authorization: `Bearer ${token}`, Cookie: 'private=fixture', 'CF-Connecting-IP': '198.51.100.25',
      Referer: 'https://app.test/private', 'User-Agent': 'private-client-agent',
    })
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
    return worker.fetch(new Request(`https://app.test${path}`, { ...options, headers }), env)
  }
  const icon = (host: string, options: RequestInit = {}) => request(`/api/shop-icon?host=${encodeURIComponent(host)}`, options)
  const shopCalls = () => outgoing.filter((call) => !call.url.includes('supabase'))
  return { worker, env, request, icon, outgoing, shopCalls, fetcher, log }
}

describe('GET /api/shop-icon', () => {
  it('answers the icon bytes with only our own headers; nothing of the shop’s response is forwarded', async () => {
    const { icon, log } = harness()
    const response = await icon('laden.example')
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/png',
      'content-length': String(ICON.byteLength),
      'cache-control': 'private, max-age=604800',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'content-disposition': 'inline',
      'cross-origin-resource-policy': 'same-origin',
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(ICON)
    // the log never names the shop
    expect(log.mock.calls).toEqual([[{ endpoint: 'shop-icon', status: 200, duration: 0 }]])
  })

  it('never sends the client’s cookies, referrer, token or IP to the shop', async () => {
    const { icon, shopCalls } = harness()
    await icon('laden.example')
    expect(shopCalls().map((call) => call.url)).toEqual(['https://laden.example/', 'https://laden.example/touch.png'])
    for (const call of shopCalls()) {
      for (const name of ['authorization', 'cookie', 'cf-connecting-ip', 'x-forwarded-for', 'referer']) expect(call.headers.has(name)).toBe(false)
      expect(call.headers.get('user-agent')).toBe('Mozilla/5.0 (compatible; BunprisePreview/0.1)')
    }
  })

  it('one lookup per shop: www./m./upper-case spellings share the cached answer', async () => {
    const { icon, shopCalls } = harness()
    for (const host of ['laden.example', 'www.laden.example', 'M.Laden.Example', 'laden.example.']) {
      expect((await icon(host)).status).toBe(200)
    }
    expect(shopCalls()).toHaveLength(2)
  })

  it('no icon → 404 { error: "not_found" } (no-store), and the "none" is cached as well', async () => {
    const { icon, shopCalls } = harness()
    const response = await icon('leer.example')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    const calls = shopCalls().length
    expect((await icon('www.leer.example')).status).toBe(404)
    expect(shopCalls()).toHaveLength(calls)
  })

  it('requires auth and does not touch the network without it', async () => {
    const { worker, env, fetcher } = harness()
    const response = await worker.fetch(new Request('https://app.test/api/shop-icon?host=laden.example'), env)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'HEAD', 'OPTIONS'])('rejects method %s', async (method) => {
    const { request, fetcher } = harness()
    const response = await request('/api/shop-icon?host=laden.example', { method })
    expect(response.status).toBe(405)
    if (method !== 'HEAD') expect(await response.json()).toEqual({ error: 'method_not_allowed' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['/api/shop-icon', 400, 'invalid_request'],
    ['/api/shop-icon?host=', 400, 'invalid_request'],
    ['/api/shop-icon?host=https%3A%2F%2Fladen.example', 400, 'invalid_request'],
    ['/api/shop-icon?host=laden.example%3A8443', 400, 'invalid_request'],
    ['/api/shop-icon?host=10.0.0.1', 400, 'invalid_request'],
    ['/api/shop-icon?host=co.uk', 400, 'invalid_request'],
    ['/api/shop-icon?host=app.test', 422, 'blocked_target'],
    ['/api/shop-icon?host=printer.local', 422, 'blocked_target'],
    ['/api/shop-icon?host=intern.laden.example', 422, 'blocked_target'],
  ])('%s → %i %s, and no shop is asked', async (path, status, error) => {
    const { request, shopCalls } = harness()
    const response = await request(path)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
    expect(shopCalls()).toEqual([])
  })

  it('has its own per-user bucket of 60 per minute (cache hits count), with Retry-After', async () => {
    const { icon, request } = harness()
    // an exhausted link-image bucket does not block icons
    for (let i = 0; i < 41; i++) await request('/api/link-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://laden.example/touch.png"}' })
    for (let i = 0; i < 60; i++) expect((await icon('laden.example')).status).toBe(200)
    const limited = await icon('laden.example')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
  })

  it('shares a per-IP limit of 180 across accounts', async () => {
    const { icon } = harness()
    for (let account = 0; account < 181; account++) {
      const identity = await fixture.token(`account-${account}`)
      const response = await icon('laden.example', { headers: { Authorization: `Bearer ${identity}` } })
      expect(response.status).toBe(account < 180 ? 200 : 429)
    }
  })

  it('applies the optional rate-limit binding before any shop request', async () => {
    const { icon, env, shopCalls } = harness()
    env.RATE_LIMITER = { limit: async () => ({ success: false }) }
    const response = await icon('laden.example')
    expect(response.status).toBe(429)
    expect(shopCalls()).toEqual([])
  })
})
