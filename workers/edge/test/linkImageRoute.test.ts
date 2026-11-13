import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { imageFixtures, jwtFixture, NOW, SUPABASE_URL } from './helpers'

let fixture: Awaited<ReturnType<typeof jwtFixture>>
let token: string
beforeAll(async () => {
  fixture = await jwtFixture()
  token = await fixture.token()
})

function harness(resolve = async (): Promise<string[]> => ['93.184.216.34']) {
  const outgoing: { url: string; headers: Headers; redirect?: RequestRedirect }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    outgoing.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect })
    if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) return Response.json(fixture.jwks)
    if (url.startsWith('https://img.test/redirect')) {
      return new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/router.png' } })
    }
    if (url.startsWith('https://img.test/')) {
      return new Response(imageFixtures['image/png'], {
        headers: {
          'Content-Type': 'image/png', 'Set-Cookie': 'tracking=shop', 'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=31536000', 'X-Shop-Secret': 'internal',
        },
      })
    }
    if (url.startsWith('https://shop.test/')) {
      return new Response('<title>A useful gift</title>', { headers: { 'Content-Type': 'text/html' } })
    }
    throw new Error('Unexpected test destination')
  })
  const env: Env = { SUPABASE_URL, ASSETS: { fetch: vi.fn(async () => new Response('asset')) } }
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, resolve, now: () => NOW, log })
  const request = (path: string, options: RequestInit = {}) => {
    const headers = new Headers({
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      Cookie: 'private=fixture', 'CF-Connecting-IP': '198.51.100.25',
      Referer: 'https://app.test/private', 'User-Agent': 'private-client-agent',
    })
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
    return worker.fetch(new Request(`https://app.test${path}`, { ...options, headers }), env)
  }
  const image = (url: string, options: RequestInit = {}) =>
    request('/api/link-image', { method: 'POST', body: JSON.stringify({ url }), ...options })
  return { worker, env, request, image, outgoing, fetcher, log }
}

describe('POST /api/link-image', () => {
  it('returns the verified bytes with only our own hardening headers', async () => {
    const { image, log } = harness()
    const response = await image('https://img.test/lamp.png')
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/png',
      'content-length': '256',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'content-disposition': 'inline',
      'cross-origin-resource-policy': 'same-origin',
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageFixtures['image/png'])
    expect(log.mock.calls).toEqual([[{ endpoint: 'link-image', status: 200, duration: 0 }]])
  })

  it('never sends the client cookies, referrer, token or IP to the image host', async () => {
    const { image, outgoing } = harness()
    await image('https://img.test/lamp.png')
    const shop = outgoing.filter((call) => call.url.startsWith('https://img.test/'))
    expect(shop).toHaveLength(1)
    expect(shop[0]!.redirect).toBe('manual')
    expect(Object.fromEntries(shop[0]!.headers)).toEqual({
      'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8',
    })
  })

  it('requires auth and does not touch the network without it', async () => {
    const { worker, env, fetcher } = harness()
    const response = await worker.fetch(new Request('https://app.test/api/link-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://img.test/a.png"}',
    }), env)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['GET', 'PUT', 'OPTIONS'])('rejects method %s', async (method) => {
    const { request, fetcher } = harness()
    const response = await request('/api/link-image', { method })
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'method_not_allowed' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['broken JSON', '{}', '{"url":5}', '{"url":"data:image/png;base64,AA=="}', '{"url":"javascript:alert(1)"}'])('rejects invalid body %s', async (body) => {
    const response = await harness().request('/api/link-image', { method: 'POST', body })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })

  it('blocks a redirect to a private IP with the JSON error shape', async () => {
    const { image, outgoing } = harness()
    const response = await image('https://img.test/redirect')
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked_target' })
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(outgoing.some((call) => call.url.includes('192.168.1.1'))).toBe(false)
  })

  it('blocks a host that resolves to a private address', async () => {
    const response = await harness(async () => ['10.0.0.7']).image('https://img.test/lamp.png')
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked_target' })
  })

  it('maps a page instead of a picture to unsupported_content', async () => {
    const response = await harness().image('https://shop.test/item')
    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: 'unsupported_content' })
  })

  it('has its own per-user bucket of 40 per minute, with Retry-After', async () => {
    const { image, request } = harness()
    // The link-preview bucket being exhausted does not block pictures.
    for (let i = 0; i < 21; i++) await request('/api/link-preview', { method: 'POST', body: '{"url":"https://shop.test/item"}' })
    for (let i = 0; i < 40; i++) expect((await image('https://img.test/lamp.png')).status).toBe(200)
    const limited = await image('https://img.test/lamp.png')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
  })

  it('shares a per-IP limit of 120 across accounts', async () => {
    const { image } = harness()
    for (let account = 0; account < 121; account++) {
      const identity = await fixture.token(`account-${account}`)
      const response = await image('https://img.test/lamp.png', { headers: { Authorization: `Bearer ${identity}` } })
      expect(response.status).toBe(account < 120 ? 200 : 429)
    }
  })

  it('applies the optional rate-limit binding before any image fetch', async () => {
    const { image, env, outgoing } = harness()
    env.RATE_LIMITER = { limit: async () => ({ success: false }) }
    const response = await image('https://img.test/lamp.png')
    expect(response.status).toBe(429)
    expect(outgoing.some((call) => call.url.startsWith('https://img.test/'))).toBe(false)
  })
})
