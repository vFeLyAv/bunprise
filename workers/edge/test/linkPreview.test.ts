import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLinkPreview } from '../src/linkPreview'
import type { Fetch } from '../src/http'

const ownHost = 'bunprise.example'
const subject = 'fixture-user'
const publicResolver = vi.fn(async () => ['8.8.8.8'])
const simpleHtml = '<html><head><meta property="og:site_name" content="Shop"><meta property="og:title" content="Lamp | Shop"></head></html>'

function htmlResponse(html = simpleHtml, headers: HeadersInit = {}): Response {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
}

afterEach(() => {
  vi.useRealTimers()
  publicResolver.mockClear()
})

describe('link previews', () => {
  it('fetches with only fixed headers and returns the exact contract', async () => {
    const fetch = vi.fn(async () => htmlResponse()) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    await expect(preview('https://shop.example/lamp?utm_source=mail&size=large', ownHost, subject)).resolves.toEqual({
      url: 'https://shop.example/lamp?size=large',
      site: 'Shop',
      title: 'Lamp',
      price_cents: null,
      currency: null,
      partial: false,
      image_url: null,
      description: null,
      brand: null,
      color: null,
      gtin: null,
    })
    const [url, options] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://shop.example/lamp?size=large')
    expect(options?.redirect).toBe('manual')
    expect(Object.fromEntries(new Headers(options?.headers))).toEqual({
      accept: 'text/html',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
    })
    expect(publicResolver).toHaveBeenCalledWith('shop.example', expect.any(AbortSignal))
  })

  it('follows relative redirects, validates each DNS hop and strips final tracking', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/final?ref=campaign&size=M' } }))
      .mockResolvedValueOnce(htmlResponse()) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/start', ownHost, subject)
    expect(result.url).toBe('https://shop.example/final?size=M')
    expect(publicResolver).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('checks the shop name against the final hostname after redirects', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://deals.example/item' } }))
      .mockResolvedValueOnce(htmlResponse('<meta property="og:site_name" content="Amazon"><title>Watch</title>')) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://www.amazon.de/start', ownHost, subject)
    expect(result.site).toBe('deals.example')
    expect(result.url).toBe('https://deals.example/item')
  })

  it.each([
    'http://127.0.0.1/private', 'http://2130706433/', 'http://[::ffff:10.0.0.1]/',
    'https://localhost/', 'https://bunprise.example/api/health', 'https://shop.example:8080/',
    'ftp://shop.example/item', 'https://user:pass@shop.example/',
  ])('blocks redirect target before fetching it: %s', async (location) => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)).rejects.toMatchObject({ code: 'blocked_target' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rechecks DNS even when a redirect keeps the same hostname', async () => {
    const resolve = vi.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1'])
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/other' } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve })('https://shop.example/', ownHost, subject)).rejects.toMatchObject({ code: 'blocked_target' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('permits four redirect hops', async () => {
    let calls = 0
    const fetch = vi.fn(async () => {
      calls += 1
      return calls <= 4 ? new Response(null, { status: 302, headers: { location: `/hop${calls}` } }) : htmlResponse()
    }) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)
    expect(result.url).toBe('https://shop.example/hop4')
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('rejects more than four redirects', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/loop' } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it.each(['application/json', 'text/plain', 'image/png', ''])('rejects non-HTML content type: %s', async (contentType) => {
    const fetch = vi.fn(async () => new Response('private upstream text', { headers: { 'content-type': contentType } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)).rejects.toMatchObject({ code: 'unsupported_content' })
  })

  it('accepts XHTML with case-insensitive content type', async () => {
    const fetch = vi.fn(async () => htmlResponse(simpleHtml, { 'content-type': 'Application/XHTML+XML; charset=UTF-8' })) as Fetch
    expect((await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)).title).toBe('Lamp')
  })

  it('reads only the first MiB of an endless page, cancels the reader and still answers', async () => {
    const cancel = vi.fn()
    let count = 0
    const head = new TextEncoder().encode('<html><head><title>Big Desk</title></head><body>')
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        count += 1
        controller.enqueue(count === 1 ? head : new Uint8Array(128 * 1024).fill(120))
      },
      cancel,
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject))
      .resolves.toMatchObject({ title: 'Big Desk', partial: false })
    expect(cancel).toHaveBeenCalled()
    expect(count).toBeLessThanOrEqual(10)
  })

  it('does not reject a page because its content-length exceeds a MiB', async () => {
    const html = '<head><meta property="og:title" content="Huge Lamp"></head>'
    const fetch = vi.fn(async () => new Response(html, {
      headers: { 'content-type': 'text/html', 'content-length': String(4 * 1024 * 1024) },
    })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject))
      .resolves.toMatchObject({ title: 'Huge Lamp', partial: false })
  })

  it('cuts a multi-byte character at the MiB boundary without throwing', async () => {
    const filler = 'ä'.repeat(600 * 1024) // 2 bytes each → 1.2 MiB
    const fetch = vi.fn(async () => htmlResponse(`<title>Umlaut</title>${filler}`)) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject))
      .resolves.toMatchObject({ title: 'Umlaut' })
  })

  it('trims surrounding whitespace and keeps the fragment of the user link', async () => {
    const fetch = vi.fn(async () => htmlResponse()) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    await expect(preview('  https://shop.example/lamp?utm_source=x#/variant/blue \n', ownHost, subject))
      .resolves.toMatchObject({ url: 'https://shop.example/lamp#/variant/blue' })
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('https://shop.example/lamp')
    // A cache hit for the same page re-attaches the fragment of the new request only.
    await expect(preview('https://shop.example/lamp', ownHost, subject)).resolves.toMatchObject({ url: 'https://shop.example/lamp' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['<head><meta charset="utf-8">', ''])('stops at complete Product metadata after a 16 KiB batch without consuming an endless body: %s', async (head) => {
    const html = `${head}<meta property="og:site_name" content="Shop"><script type="application/ld+json">{"@type":"Product","name":"Desk","image":"/desk.jpg","offers":{"price":"29.99","priceCurrency":"EUR"}}</script>`
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(html.padEnd(16 * 1024, ' '))) },
      cancel,
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' } })) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/p/desk', ownHost, subject)
    expect(result.title).toBe('Desk')
    expect(result.price_cents).toBe(2999)
    expect(result.image_url).toBe('https://shop.example/desk.jpg')
    expect(cancel).toHaveBeenCalled()
  })

  it('keeps reading past complete title/price/site until the picture arrives', async () => {
    const product = '<meta property="og:site_name" content="Shop"><script type="application/ld+json">{"@type":"Product","name":"Desk","offers":{"price":"29.99","priceCurrency":"EUR"}}</script>'
    const chunks = [product.padEnd(16 * 1024, ' '), ' '.repeat(16 * 1024), '<link rel="image_src" href="https://cdn.example/late.jpg">']
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift()
        if (next === undefined) controller.close()
        else controller.enqueue(new TextEncoder().encode(next))
      },
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' } })) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)
    expect(result).toMatchObject({ title: 'Desk', price_cents: 2999, image_url: 'https://cdn.example/late.jpg' })
  })

  it('resolves a relative picture against the final URL after a redirect and caches all details', async () => {
    const html = `<meta property="og:image" content="img/lamp.jpg"><script type="application/ld+json">${JSON.stringify({
      '@type': 'Product', name: 'Lamp', description: 'Warm &amp; bright', brand: { name: 'Nova' }, color: 'Sand', gtin13: '4006381333931',
    })}</script>`
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://cdn-shop.example/de/p/' } }))
      .mockResolvedValueOnce(htmlResponse(html)) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    const expected = {
      url: 'https://cdn-shop.example/de/p/', image_url: 'https://cdn-shop.example/de/p/img/lamp.jpg',
      description: 'Warm & bright', brand: 'Nova', color: 'Sand', gtin: '4006381333931',
    }
    await expect(preview('https://shop.example/lamp', ownHost, subject)).resolves.toMatchObject(expected)
    await expect(preview('https://shop.example/lamp', ownHost, subject)).resolves.toMatchObject(expected)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['text/html; charset=windows-1252', ''],
    ['text/html; charset="iso-8859-1"', ''],
    ['text/html', '<meta charset="windows-1252">'],
    ['text/html', '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">'],
  ])('decodes Western legacy charsets: %s %s', async (contentType, meta) => {
    const prefix = new TextEncoder().encode(`${meta}<title>Caf`)
    const suffix = new TextEncoder().encode(' Cr')
    const end = new TextEncoder().encode('me</title>')
    const bytes = new Uint8Array([...prefix, 0xe9, ...suffix, 0xe8, ...end])
    const fetch = vi.fn(async () => new Response(bytes, { headers: { 'content-type': contentType } })) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)
    expect(result.title).toBe('Café Crème')
  })

  it('uses header charset before a conflicting meta charset', async () => {
    const text = '<meta charset="windows-1252"><title>Café</title>'
    const fetch = vi.fn(async () => htmlResponse(text)) as Fetch
    expect((await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)).title).toBe('Café')
  })

  it('preserves multibyte UTF-8 characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('<title>Café 🎁</title>')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as Fetch
    expect((await createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)).title).toBe('Café 🎁')
  })

  it.each([0, 1])('caps trickled body reads at 4096 and parses the bytes received (%i-byte chunks)', async (chunkSize) => {
    let reads = 0
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++
        controller.enqueue(reads === 1
          ? new TextEncoder().encode('<title>Trickled gift</title>')
          : new Uint8Array(chunkSize).fill(0x61))
      },
      cancel,
    }, { highWaterMark: 0 })
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/trickle', ownHost, subject))
      .resolves.toMatchObject({ title: 'Trickled gift', partial: false })
    expect(reads).toBe(4096)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('decodes small chunks in batches and preserves a UTF-8 character across batch boundaries', async () => {
    // The gift's first byte lands at the end of the first 16 KiB batch.
    const bytes = new TextEncoder().encode(`${' '.repeat(16 * 1024 - 8)}<title>🎁 Desk</title>${' '.repeat(32 * 1024)}`)
    let offset = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) { controller.close(); return }
        controller.enqueue(bytes.subarray(offset, offset + 1024))
        offset = Math.min(offset + 1024, bytes.length)
      },
    })
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/batched', ownHost, subject))
      .resolves.toMatchObject({ title: '🎁 Desk' })
    const lengths = decode.mock.calls.map(([input]) => input?.byteLength ?? 0)
    expect(lengths.slice(0, -1).every((length) => length >= 16 * 1024)).toBe(true)
    expect(lengths).toHaveLength(4)
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(bytes.length)
  })

  it('sanitizes raw and JSON-LD control characters and rejects impersonated shop names', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => htmlResponse(
      String(input).endsWith('/jsonld')
        ? '<meta property="og:site_name" content="&#x202E;amazon.de&#27;"><script type="application/ld+json">{"@type":"Product","name":"Lamp\\u0000Shade\\u001b \\u202Egpj.exe \\ud800"}</script>'
        : '<title>Desk\u0000Lamp</title>',
    )) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    await expect(preview('https://deals.example/jsonld', ownHost, subject))
      .resolves.toMatchObject({ title: 'Lamp�Shade gpj.exe �', site: 'deals.example' })
    await expect(preview('https://deals.example/raw', ownHost, subject))
      .resolves.toMatchObject({ title: 'Desk�Lamp', site: 'deals.example' })
  })

  it('returns partial metadata when a title is absent', async () => {
    const fetch = vi.fn(async () => htmlResponse('<html><body>No metadata</body></html>')) as Fetch
    expect(await createLinkPreview({ fetch, resolve: publicResolver })('https://www.shop.example/', ownHost, subject)).toEqual({
      url: 'https://www.shop.example/', site: 'shop.example', title: null, price_cents: null, currency: null, partial: true,
      image_url: null, description: null, brand: null, color: null, gtin: null,
    })
  })

  it('caches normalized successful URLs for ten minutes', async () => {
    let now = 1000
    const fetch = vi.fn(async () => htmlResponse()) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver, now: () => now })
    const first = await preview('https://shop.example/p?size=M&utm_source=a', ownHost, subject)
    first.title = 'Mutated by caller'
    const cached = await preview('https://shop.example/p?utm_source=b&size=M', ownHost, subject)
    expect(cached.title).toBe('Lamp')
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 10 * 60 * 1000
    await preview('https://shop.example/p?size=M', ownHost, subject)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never reuses another user’s cached preview for the same normalized URL', async () => {
    const fetch = vi.fn(async () => htmlResponse()) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    await preview('https://shop.example/private-plan?utm_source=a#one', ownHost, 'planner')
    await preview('https://shop.example/private-plan?utm_source=b#two', ownHost, 'honoree')
    expect(fetch).toHaveBeenCalledTimes(2)
    await expect(preview('https://shop.example/private-plan#three', ownHost, 'planner'))
      .resolves.toMatchObject({ url: 'https://shop.example/private-plan#three' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'failure', 'timeout', 'abort'] as const)('caps the whole pipeline at 12 and releases slots after %s', async (outcome) => {
    vi.useFakeTimers()
    const gates: { resolve: (addresses: string[]) => void; reject: (error: Error) => void; signal: AbortSignal }[] = []
    const resolve = vi.fn((_host: string, signal: AbortSignal) => new Promise<string[]>((accept, reject) => {
      gates.push({ resolve: accept, reject, signal })
    }))
    const fetch = vi.fn(async () => htmlResponse()) as Fetch
    const preview = createLinkPreview({ fetch, resolve })
    const controller = new AbortController()
    const expected = outcome === 'success' ? undefined : outcome === 'failure' ? 'fetch_failed' : 'timeout'
    const pending = Array.from({ length: 12 }, (_, index) => {
      const result = preview(`https://shop.example/p-${index}`, ownHost, `user-${index}`, controller.signal)
      return expected ? expect(result).rejects.toMatchObject({ code: expected }) : expect(result).resolves.toMatchObject({ title: 'Lamp' })
    })
    await expect(preview('https://shop.example/overflow', ownHost, 'other-user'))
      .rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 5 })
    expect(resolve).toHaveBeenCalledTimes(12)
    expect(fetch).not.toHaveBeenCalled()
    if (outcome === 'success') gates.forEach((gate) => gate.resolve(['8.8.8.8']))
    if (outcome === 'failure') gates.forEach((gate) => gate.reject(new Error('fixture DNS failure')))
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(5000)
    if (outcome === 'abort') controller.abort()
    await Promise.all(pending)
    expect(gates.every((gate) => gate.signal.aborted)).toBe(true)
    // A resolver ignoring abort must not resume the fetch pipeline after its slot is released.
    if (outcome === 'timeout' || outcome === 'abort') {
      gates.forEach((gate) => gate.resolve(['8.8.8.8']))
      await vi.advanceTimersByTimeAsync(0)
      expect(fetch).not.toHaveBeenCalled()
    }
    resolve.mockImplementation(async () => ['8.8.8.8'])
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      expect(preview(`https://shop.example/after-${index}`, ownHost, 'other-user')).resolves.toMatchObject({ title: 'Lamp' })))
  })

  it.each(['timeout', 'abort'] as const)('cancels late fetch responses after %s and never caches them', async (outcome) => {
    vi.useFakeTimers()
    let finishFetch: (response: Response) => void = () => {}
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finishFetch = resolve })) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    const controller = new AbortController()
    const pending = expect(preview('https://shop.example/late', ownHost, subject, controller.signal))
      .rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(0)
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(5000)
    else controller.abort()
    await pending
    const cancel = vi.fn()
    finishFetch(new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'content-type': 'text/html' } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledTimes(1)
    vi.mocked(fetch).mockImplementation(async () => htmlResponse())
    await expect(preview('https://shop.example/late', ownHost, subject)).resolves.toMatchObject({ title: 'Lamp' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('bounds concurrent stalled MiB bodies and releases all slots on their deadline', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const head = new TextEncoder().encode('<title>€ Desk</title>')
        controller.enqueue(head)
        controller.enqueue(new Uint8Array(1024 * 1024 - head.length - 1).fill(0x61))
      },
      cancel,
    }), { headers: { 'content-type': 'text/html; charset=utf-8' } })) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    const pending = Array.from({ length: 12 }, (_, index) =>
      expect(preview(`https://shop.example/stall-${index}`, ownHost, `user-${index}`)).rejects.toMatchObject({ code: 'timeout' }))
    await vi.advanceTimersByTimeAsync(0)
    await expect(preview('https://shop.example/overflow', ownHost, 'user-overflow')).rejects.toMatchObject({ retryAfter: 5 })
    expect(fetch).toHaveBeenCalledTimes(12)
    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all(pending)
    expect(cancel).toHaveBeenCalledTimes(12)
    vi.mocked(fetch).mockImplementation(async () => htmlResponse())
    await expect(preview('https://shop.example/recovered', ownHost, 'user-recovered')).resolves.toMatchObject({ title: 'Lamp' })
  })

  it('does not cache failed fetches', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('secret upstream failure'))
      .mockResolvedValueOnce(htmlResponse()) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    await expect(preview('https://shop.example/', ownHost, subject)).rejects.toMatchObject({ code: 'fetch_failed', message: 'fetch_failed' })
    await expect(preview('https://shop.example/', ownHost, subject)).resolves.toMatchObject({ title: 'Lamp' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('revalidates a cached final URL against the current request host', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://final.example/item' } }))
      .mockResolvedValueOnce(htmlResponse()) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    await preview('https://shop.example/', ownHost, subject)
    await expect(preview('https://shop.example/', 'final.example', subject)).rejects.toMatchObject({ code: 'blocked_target' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('times out the entire request at five seconds including DNS and body', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<Response>(() => {})) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    const pending = expect(preview('https://shop.example/', ownHost, subject)).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(5000)
    await pending
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('cancels a stalled stream on the total deadline', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' } })) as Fetch
    const pending = expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/', ownHost, subject)).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(5000)
    await pending
    expect(cancel).toHaveBeenCalled()
  })
})
