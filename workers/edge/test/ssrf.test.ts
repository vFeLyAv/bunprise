import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Fetch } from '../src/http'
import { assertPublicResolution, createResolver, isPublicIp, stripTracking, validateUrl } from '../src/net/ssrf'

const ownHost = 'bunprise.example'

afterEach(() => { vi.useRealTimers() })

describe('URL validation', () => {
  it.each([
    '', 'not a URL', 'ftp://shop.example/item', 'file:///etc/passwd',
    'javascript:alert(1)', 'data:text/html,hello', '//shop.example/item',
    'https://user:pass@shop.example/', 'https://user@shop.example/',
    'https://@shop.example/', 'https://:@shop.example/',
    `https://shop.example/${'a'.repeat(2048)}`, 'https://shop.example/\nitem',
  ])('rejects invalid input: %s', (url) => {
    expect(() => validateUrl(url, ownHost)).toThrow(expect.objectContaining({ code: 'invalid_request' }))
  })

  it.each([
    'http://0.0.0.0/', 'http://0.1.2.3/', 'http://10.2.3.4/',
    'http://100.64.0.0/', 'http://100.127.255.255/', 'http://127.0.0.1/',
    'http://169.254.169.254/', 'http://172.16.0.1/', 'http://172.31.255.255/',
    'http://192.0.0.9/', 'http://192.0.2.1/', 'http://192.88.99.1/',
    'http://192.168.1.1/', 'http://198.18.0.1/', 'http://198.19.255.255/',
    'http://198.51.100.2/', 'http://203.0.113.2/', 'http://224.0.0.1/',
    'http://239.255.255.255/', 'http://240.0.0.1/', 'http://255.255.255.255/',
    'http://2130706433/', 'http://0x7f.1/', 'http://127.1/', 'http://0177.0.0.1/',
    'http://0xA000001/', 'http://[::]/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/',
    'http://[64:ff9b::a00:1]/', 'http://[100::ffff]/',
    'http://[2001::1]/', 'http://[2001:1ff::1]/', 'http://[2001:db8::1]/',
    'http://[2002:0a00:0001::1]/', 'http://[2002:0808:0808::1]/',
    'http://[fc00::1]/', 'http://[fd12::1]/', 'http://[fe80::1]/',
    'http://[febf::1]/', 'http://[fec0::1]/', 'http://[ff02::1]/',
    'http://[3fff::1]/',
  ])('blocks private/reserved literal: %s', (url) => {
    expect(() => validateUrl(url, ownHost)).toThrow(expect.objectContaining({ code: 'blocked_target' }))
  })

  it.each([
    'https://localhost/', 'https://localhost./', 'https://a.localhost/',
    'https://a.local/', 'https://a.internal/', 'https://a.lan/',
    'https://home.arpa/', 'https://a.home.arpa/', 'https://a.onion/',
    'https://intranet/', 'https://bunprise.example/', 'https://BUNPRISE.example./',
    'https://shop.example:8080/', 'https://shop.example:22/', 'https://bad_host.example/',
  ])('blocks forbidden host or port: %s', (url) => {
    expect(() => validateUrl(url, ownHost)).toThrow(expect.objectContaining({ code: 'blocked_target' }))
  })

  it.each([
    'http://8.8.8.8/', 'https://1.1.1.1/', 'http://100.63.255.255/',
    'http://100.128.0.1/', 'http://172.15.255.255/', 'http://172.32.0.0/',
    'http://198.17.255.255/', 'http://198.20.0.0/',
    'https://[2606:4700:4700::1111]/', 'https://[2001:4860:4860::8888]/',
    'https://[::ffff:8.8.8.8]/', 'http://[64:ff9b::808:808]/',
    'http://shop.example:80/', 'https://shop.example:443/', 'http://shop.example:443/',
    'https://shop.example:80/',
  ])('allows public target: %s', (url) => {
    expect(validateUrl(url, ownHost).protocol).toMatch(/^https?:$/)
  })

  it('rejects non-IP resolver values and IPv6 zone identifiers', () => {
    for (const address of ['garbage', '300.1.1.1', '127.1', 'fe80::1%eth0', '1:2:3::4::5']) {
      expect(isPublicIp(address)).toBe(false)
    }
  })

  it('removes known tracking and affiliate parameters without losing product options', () => {
    const url = new URL('https://www.shop.example/p?size=M&UTM_source=mail&gclid=x&fbclid=x&msclkid=x&mc_cid=x&mc_eid=x&igshid=x&_ga=x&ref=x&ref_=x&tag=x&ascsubtag=x&linkCode=x&affiliate_id=x&affid=x&irclickid=x&wbraid=x&pf_rd_p=x&color=red#fragment')
    expect(stripTracking(url).href).toBe('https://www.shop.example/p?size=M&color=red')
    expect(url.searchParams.has('gclid')).toBe(true)
  })

  it('keeps the order and exact encoding of the remaining parameters', () => {
    const url = new URL('https://shop.example/p?b=2&utm_medium=x&a=%7E%20x&flag&sig=AbC%2B%2F%3D')
    expect(stripTracking(url).search).toBe('?b=2&a=%7E%20x&flag&sig=AbC%2B%2F%3D')
    expect(stripTracking(new URL('https://shop.example/p?utm_source=x&gclid=y')).href).toBe('https://shop.example/p')
    expect(stripTracking(new URL('https://shop.example/p?UTM%5Fsource=x&q=1')).search).toBe('?q=1')
  })

  it('does not expand escaping, and still bounds the final URL', () => {
    const long = `https://shop.example/?x=${'~'.repeat(1000)}`
    expect(stripTracking(validateUrl(long, ownHost)).search).toBe(`?x=${'~'.repeat(1000)}`)
    expect(() => stripTracking(new URL(`https://shop.example/?x=${'a'.repeat(2100)}`)))
      .toThrow(expect.objectContaining({ code: 'invalid_request' }))
  })
})

describe('DNS-over-HTTPS', () => {
  function dnsFetch(answers: Record<string, unknown>): Fetch {
    return vi.fn(async (input) => {
      const type = new URL(String(input)).searchParams.get('type') ?? ''
      return Response.json(answers[type] ?? { Status: 0 })
    }) as Fetch
  }

  it('resolves A and AAAA using bounded fixed requests', async () => {
    const fetch = dnsFetch({
      A: { Status: 0, Answer: [{ type: 5, data: 'cdn.example' }, { type: 1, data: '8.8.8.8' }] },
      AAAA: { Status: 0, Answer: [{ type: 28, data: '2606:4700:4700::1111' }] },
    })
    const resolve = createResolver(fetch)
    await expect(assertPublicResolution(validateUrl('https://shop.example/', ownHost), resolve, new AbortController().signal)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://cloudflare-dns.com')
      expect(new URL(String(url)).searchParams.get('name')).toBe('shop.example')
      expect(Object.fromEntries(new Headers(options?.headers))).toEqual({ accept: 'application/dns-json' })
      expect(options?.redirect).toBe('manual')
      expect(options?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it.each([
    [{ type: 1, data: '8.8.8.8' }, { type: 1, data: '10.0.0.5' }],
    [{ type: 28, data: '::ffff:192.168.1.1' }],
    [{ type: 28, data: 'fd12::1' }],
  ].map((Answer) => ({ Answer })))('blocks if any answer is private', async ({ Answer }) => {
    const resolve = createResolver(dnsFetch({ A: { Status: 0, Answer } }))
    await expect(assertPublicResolution(validateUrl('https://shop.example/', ownHost), resolve, new AbortController().signal)).rejects.toMatchObject({ code: 'blocked_target' })
  })

  it.each([{ Status: 0 }, { Status: 3 }, { Status: 0, Answer: [] }])('fails when no address resolves: %j', async (body) => {
    const resolve = createResolver(dnsFetch({ A: body, AAAA: body }))
    await expect(assertPublicResolution(validateUrl('https://shop.example/', ownHost), resolve, new AbortController().signal)).rejects.toMatchObject({ code: 'fetch_failed' })
  })

  it('fails closed when one address family fails', async () => {
    const resolve = createResolver(dnsFetch({ A: { Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }, AAAA: { Status: 2 } }))
    await expect(assertPublicResolution(validateUrl('https://shop.example/', ownHost), resolve, new AbortController().signal)).rejects.toMatchObject({ code: 'fetch_failed' })
  })

  it('does not attempt DNS for already validated public literals', async () => {
    const resolve = vi.fn()
    await assertPublicResolution(validateUrl('https://8.8.8.8/', ownHost), resolve, new AbortController().signal)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('bounds DoH response size and masks upstream errors', async () => {
    for (const response of [
      new Response('upstream details', { status: 500 }),
      new Response('invalid JSON'),
      new Response('x'.repeat(65537)),
    ]) {
      const resolve = createResolver(vi.fn(async () => response.clone()) as Fetch)
      await expect(resolve('shop.example', new AbortController().signal)).rejects.toMatchObject({ code: 'fetch_failed' })
    }
  })

  it('times out after 1.5 seconds even when fetch ignores abort', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<Response>(() => {})) as Fetch
    const pending = createResolver(fetch)('shop.example', new AbortController().signal)
    const check = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(1500)
    await check
    for (const [, options] of vi.mocked(fetch).mock.calls) expect(options?.signal?.aborted).toBe(true)
  })
})
