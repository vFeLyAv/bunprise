import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLinkImage, imageResponse, MAX_IMAGE_BYTES, sniffImageType } from '../src/linkImage'
import type { Fetch } from '../src/http'
import { ascii, imageFixtures, padded } from './helpers'

const ownHost = 'bunprise.example'
const publicResolver = vi.fn(async () => ['8.8.8.8'])

function imageResponseFixture(bytes: Uint8Array<ArrayBuffer>, type: string, headers: HeadersInit = {}): Response {
  return new Response(bytes, { headers: { 'content-type': type, ...headers } })
}

afterEach(() => {
  vi.useRealTimers()
  publicResolver.mockClear()
})

describe('image sniffing', () => {
  it.each(Object.entries(imageFixtures))('recognises %s by magic bytes', (type, bytes) => {
    expect(sniffImageType(bytes)).toBe(type)
  })

  it('recognises AVIF from a compatible brand and rejects other ISO-BMFF files', () => {
    expect(sniffImageType(padded([0, 0, 0, 0x20, ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('mif1miafMA1Bavif')]))).toBe('image/avif')
    expect(sniffImageType(padded([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]))).toBeUndefined()
    // The brand list ends at the declared box size.
    expect(sniffImageType(padded([0, 0, 0, 0x10, ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('avif')]))).toBeUndefined()
    expect(sniffImageType(padded([0, 0, 0, 0x08, ...ascii('ftypavif')]))).toBeUndefined()
  })

  it.each([
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
    ['XML-prefixed SVG', ascii('<?xml version="1.0"?><svg/>')],
    ['HTML', ascii('<!doctype html><script>alert(1)</script>')],
    ['truncated JPEG', [0xff, 0xd8]],
    ['truncated PNG', [0x89, 0x50, 0x4e, 0x47]],
    ['RIFF without WEBP', [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]],
    ['GIF90a', ascii('GIF90a')],
    ['empty', []],
  ])('rejects %s', (_name, bytes) => {
    expect(sniffImageType(new Uint8Array(bytes))).toBeUndefined()
  })
})

describe('link images', () => {
  it.each(Object.entries(imageFixtures))('returns verified %s bytes with fixed request headers', async (type, bytes) => {
    const fetch = vi.fn(async () => imageResponseFixture(bytes, `${type}; charset=binary`, { 'set-cookie': 'shop=1' })) as Fetch
    const image = await createLinkImage({ fetch, resolve: publicResolver })('https://cdn.shop.example/p.img#frag', ownHost)
    expect(image.type).toBe(type)
    expect(Array.from(image.bytes)).toEqual(Array.from(bytes))
    const [url, options] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://cdn.shop.example/p.img')
    expect(options?.redirect).toBe('manual')
    expect(Object.fromEntries(new Headers(options?.headers))).toEqual({
      'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8',
    })
    expect(publicResolver).toHaveBeenCalledWith('cdn.shop.example', expect.any(AbortSignal))
  })

  it('accepts the common image/jpg alias but answers with image/jpeg', async () => {
    const fetch = vi.fn(async () => imageResponseFixture(imageFixtures['image/jpeg'], 'IMAGE/JPG')) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.jpg', ownHost))
      .resolves.toMatchObject({ type: 'image/jpeg' })
  })

  it('builds a response with only the verified type and hardening headers', async () => {
    const response = imageResponse({ type: 'image/png', bytes: imageFixtures['image/png'] })
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
  })

  it.each([
    ['PNG declared, JPEG bytes', 'image/png', imageFixtures['image/jpeg']],
    ['JPEG declared, HTML bytes', 'image/jpeg', padded(ascii('<!doctype html><script>alert(1)</script>'))],
    ['PNG declared, SVG bytes', 'image/png', padded(ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))],
    ['AVIF declared, HEIC bytes', 'image/avif', padded([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')])],
    ['GIF declared, short body', 'image/gif', new Uint8Array(ascii('GIF8'))],
    ['PNG declared, empty body', 'image/png', new Uint8Array()],
  ])('rejects wrong magic bytes: %s', async (_name, type, bytes) => {
    const fetch = vi.fn(async () => imageResponseFixture(bytes, type)) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a', ownHost))
      .rejects.toMatchObject({ code: 'unsupported_content', status: 415 })
  })

  it.each(['image/svg+xml', 'image/svg+xml; charset=utf-8', 'text/html', 'application/octet-stream', 'image/bmp', 'image/x-icon', 'image/heic', ''])('rejects content type %s before reading the body', async (type) => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(imageFixtures['image/png']) }, cancel })
    const fetch = vi.fn(async () => new Response(body, { headers: type ? { 'content-type': type } : {} })) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a', ownHost))
      .rejects.toMatchObject({ code: 'unsupported_content' })
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects mismatching magic bytes after the first 64 bytes, without reading an endless body', async () => {
    const cancel = vi.fn()
    let reads = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(64).fill(0x3c)) },
      cancel,
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'image/png' } })) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.png', ownHost))
      .rejects.toMatchObject({ code: 'unsupported_content' })
    expect(cancel).toHaveBeenCalled()
    expect(reads).toBeLessThanOrEqual(3)
  })

  it('rejects a declared Content-Length over 5 MiB before reading', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetch = vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) },
    })) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.png', ownHost))
      .rejects.toMatchObject({ code: 'too_large', status: 413 })
    expect(cancel).toHaveBeenCalled()
  })

  it('counts streamed bytes and aborts just over 5 MiB when no length is declared', async () => {
    const cancel = vi.fn()
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = sent === 0 ? padded(Array.from(imageFixtures['image/png'].subarray(0, 16)), 512 * 1024) : new Uint8Array(512 * 1024)
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel,
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'image/png' } })) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.png', ownHost))
      .rejects.toMatchObject({ code: 'too_large' })
    expect(cancel).toHaveBeenCalled()
    expect(sent).toBeLessThanOrEqual(MAX_IMAGE_BYTES + 3 * 512 * 1024)
  })

  it('accepts exactly 5 MiB delivered in many chunks', async () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES)
    bytes.set(imageFixtures['image/jpeg'].subarray(0, 16))
    bytes[bytes.length - 1] = 0xd9
    let offset = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) { controller.close(); return }
        controller.enqueue(bytes.slice(offset, offset + 100_000))
        offset += 100_000
      },
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'image/jpeg' } })) as Fetch
    const image = await createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.jpg', ownHost)
    expect(image.bytes.byteLength).toBe(MAX_IMAGE_BYTES)
    expect(image.bytes[MAX_IMAGE_BYTES - 1]).toBe(0xd9)
  })

  it('caps the number of reads of a trickling body', async () => {
    const cancel = vi.fn()
    let reads = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(0)) },
      cancel,
    }, { highWaterMark: 0 })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'image/png' } })) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.png', ownHost))
      .rejects.toMatchObject({ code: 'fetch_failed' })
    expect(reads).toBeLessThanOrEqual(64 * 1024 + 1)
    expect(cancel).toHaveBeenCalled()
  })

  it.each([
    ['data:image/png;base64,iVBORw0KGgo=', 'invalid_request'],
    ['javascript:alert(1)', 'invalid_request'],
    ['file:///etc/passwd', 'invalid_request'],
    ['https://user:pw@cdn.example/a.png', 'invalid_request'],
    ['not a url', 'invalid_request'],
    ['http://127.0.0.1/a.png', 'blocked_target'],
    ['http://[::1]/a.png', 'blocked_target'],
    ['http://169.254.169.254/latest/meta-data', 'blocked_target'],
    ['https://localhost/a.png', 'blocked_target'],
    ['https://cdn.example:8443/a.png', 'blocked_target'],
    ['https://bunprise.example/api/health', 'blocked_target'],
  ])('rejects %s before any network call', async (input, code) => {
    const fetch = vi.fn() as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })(input, ownHost)).rejects.toMatchObject({ code })
    expect(fetch).not.toHaveBeenCalled()
    expect(publicResolver).not.toHaveBeenCalled()
  })

  it.each([
    'http://127.0.0.1/a.png', 'http://10.0.0.5/a.png', 'http://[::ffff:192.168.0.1]/', 'https://localhost/a.png',
    'https://bunprise.example/a.png', 'https://cdn.example:8080/a.png', 'data:image/png;base64,AA==',
  ])('blocks a redirect to %s without fetching it', async (location) => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location } })) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.png', ownHost))
      .rejects.toMatchObject({ code: 'blocked_target' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('re-resolves DNS on every redirect hop and blocks a private answer', async () => {
    const resolve = vi.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['10.1.2.3'])
    const fetch = vi.fn(async () => new Response(null, { status: 307, headers: { location: 'https://img.example/a.png' } })) as Fetch
    await expect(createLinkImage({ fetch, resolve })('https://cdn.example/a.png', ownHost)).rejects.toMatchObject({ code: 'blocked_target' })
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('follows up to four redirects without stripping query parameters of image URLs', async () => {
    let calls = 0
    const fetch = vi.fn(async () => {
      calls++
      return calls <= 4
        ? new Response(null, { status: 302, headers: { location: `/hop${calls}?ref=signed&tag=x` } })
        : imageResponseFixture(imageFixtures['image/webp'], 'image/webp')
    }) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a', ownHost)).resolves.toMatchObject({ type: 'image/webp' })
    expect(vi.mocked(fetch).mock.calls[4]?.[0]).toBe('https://cdn.example/hop4?ref=signed&tag=x')
    expect(publicResolver).toHaveBeenCalledTimes(5)
  })

  it('rejects a fifth redirect and non-2xx answers', async () => {
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/loop' } })) as Fetch
    await expect(createLinkImage({ fetch: loop, resolve: publicResolver })('https://cdn.example/a', ownHost)).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(loop).toHaveBeenCalledTimes(5)
    const missing = vi.fn(async () => new Response('not found', { status: 404, headers: { 'content-type': 'image/png' } })) as Fetch
    await expect(createLinkImage({ fetch: missing, resolve: publicResolver })('https://cdn.example/a', ownHost)).rejects.toMatchObject({ code: 'fetch_failed' })
  })

  it('maps transport errors to fetch_failed without leaking details', async () => {
    const fetch = vi.fn(async () => { throw new Error('secret upstream detail') }) as Fetch
    await expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a', ownHost))
      .rejects.toMatchObject({ code: 'fetch_failed', message: 'fetch_failed' })
  })

  it('times out a stalled body after eight seconds and cancels it', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(imageFixtures['image/png'].subarray(0, 8)) }, cancel })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'image/png' } })) as Fetch
    const pending = expect(createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.png', ownHost))
      .rejects.toMatchObject({ code: 'timeout', status: 504 })
    await vi.advanceTimersByTimeAsync(7999)
    expect(cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(cancel).toHaveBeenCalled()
  })

  it('stops when the client goes away', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(() => new Promise<Response>(() => {})) as Fetch
    const pending = createLinkImage({ fetch, resolve: publicResolver })('https://cdn.example/a.png', ownHost, controller.signal)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('caps concurrent image downloads at six and releases slots afterwards', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<Response>(() => {})) as Fetch
    const image = createLinkImage({ fetch, resolve: publicResolver })
    const pending = Array.from({ length: 6 }, (_, index) =>
      expect(image(`https://cdn.example/${index}.png`, ownHost)).rejects.toMatchObject({ code: 'timeout' }))
    await expect(image('https://cdn.example/overflow.png', ownHost)).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 5 })
    await vi.advanceTimersByTimeAsync(8000)
    await Promise.all(pending)
    vi.mocked(fetch).mockImplementation(async () => imageResponseFixture(imageFixtures['image/gif'], 'image/gif'))
    await expect(image('https://cdn.example/after.gif', ownHost)).resolves.toMatchObject({ type: 'image/gif' })
  })
})
