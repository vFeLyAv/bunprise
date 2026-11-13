import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Fetch } from '../src/http'
import {
  createShopIcon, declaredSize, imageDimensions, manifestIcons, MAX_ICON_BYTES, orderCandidates, parsePageIcons,
  parseShopHost, shopIconResponse, sniffIconType,
} from '../src/shopIcon'
import type { IconStore } from '../src/shopIcon'
import { ascii, iconFixtures, imageFixtures, NOW, padded } from './helpers'

// GET /api/shop-icon's resolver: host validation, picking the icon from a page, the classic fallbacks, size and
// content checks (never SVG, never a page dressed up as a picture), SSRF rules on every request and redirect,
// and the per-host caches. Invented shops on reserved / fictional hosts; fetch and DNS are fakes.

const ownHost = 'bunprise.example'
const PUBLIC_IP = '93.184.216.34'

type Route = () => Response | Promise<Response>
const html = (body: string, status = 200): Route => () =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
const image = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png', headers: Record<string, string> = {}): Route => () =>
  new Response(bytes, { headers: { 'content-type': type, ...headers } })
const redirect = (location: string, status = 301): Route => () => new Response(null, { status, headers: { location } })

/** A fake web: unknown URLs answer 404 (an HTML error page, like real servers). */
function fakeWeb(routes: Record<string, Route>, privateHosts: readonly string[] = []) {
  const calls: { url: string; headers: Record<string, string>; redirect?: RequestRedirect }[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers)), redirect: init?.redirect })
    const route = routes[url]
    return route ? route() : new Response('<h1>Not found</h1>', { status: 404, headers: { 'content-type': 'text/html' } })
  }) as unknown as Fetch & ReturnType<typeof vi.fn>
  const resolve = vi.fn(async (hostname: string) => (privateHosts.includes(hostname) ? ['10.0.0.7'] : [PUBLIC_IP]))
  const urls = () => calls.map((call) => call.url)
  return { fetch, resolve, calls, urls }
}

function iconsOf(web: ReturnType<typeof fakeWeb>, options: { now?: () => number; store?: IconStore | null } = {}) {
  return createShopIcon({ fetch: web.fetch, resolve: web.resolve, now: options.now ?? (() => NOW), store: options.store ?? null })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('parseShopHost', () => {
  it.each([
    [' Zalando.DE ', 'zalando.de'],
    ['www.zalando.de', 'zalando.de'],
    ['m.zalando.de', 'zalando.de'],
    ['zalando.de.', 'zalando.de'],
    ['shop.example.co.uk', 'shop.example.co.uk'],
    ['www.kaufhaus.co.uk', 'kaufhaus.co.uk'],
    ['bücher.example', 'xn--bcher-kva.example'],
    ['m.de', 'm.de'],
    ['www2.laden.example', 'www2.laden.example'],
  ])('%s → key %s', (input, key) => {
    expect(parseShopHost(input, ownHost)).toBe(key)
  })

  it.each([
    null, '', '   ', 'https://zalando.de', 'zalando.de/x', 'zalando.de:443', 'zalando.de:8080', 'user@zalando.de',
    'zalando.de?x=1', 'zalando.de#top', 'zal ando.de', 'zal%41ndo.de', 'zal\\ando.de', '127.0.0.1', '8.8.8.8',
    '2130706433', '0x7f.1', '[::1]', '::1', 'de', 'zalando', 'localhost', 'co.uk', 'www.co.uk', 'm.com.au',
    '-shop.de', 'shop_.de', `${'a'.repeat(64)}.de`, `${'x.'.repeat(130)}de`, 'shop.123', 'zalando.d3',
  ])('rejects %j as invalid_request', (input) => {
    expect(() => parseShopHost(input, ownHost)).toThrow(expect.objectContaining({ code: 'invalid_request', status: 400 }))
  })

  it.each(['printer.local', 'svc.internal', 'router.home.arpa', 'hidden.onion', ownHost, `www.${ownHost}`, `m.${ownHost}`])(
    'rejects %s as blocked_target (local names, our own host — also behind www./m.)', (input) => {
      expect(() => parseShopHost(input, ownHost)).toThrow(expect.objectContaining({ code: 'blocked_target', status: 422 }))
    },
  )
})

describe('reading icons from a page', () => {
  const page = new URL('https://www.laden.example/de/start')

  it('finds apple-touch-icon and icon links with their sizes, formats and absolute URLs', () => {
    const { links, manifest } = parsePageIcons(`<!doctype html><html><head>
      <meta charset="utf-8"><title>Laden</title>
      <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
      <link rel="icon" href="/favicon.png" sizes="16x16 96x96 48x48">
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="touch.png">
      <link rel="apple-touch-icon-precomposed" sizes="152x152" href="https://cdn.laden.example/i/152.png?v=2&amp;x=1">
      <LINK REL="Icon" HREF="/BIG.WEBP" SIZES="192X192">
      <link rel="manifest" href="/site.webmanifest">
      </head><body></body></html>`, page)
    expect(links.map((link) => [link.url.href, link.size, link.format])).toEqual([
      ['https://www.laden.example/favicon-32.png', 32, 'png'],
      ['https://www.laden.example/favicon.png', 96, 'png'],
      ['https://www.laden.example/favicon.ico', 0, 'ico'],
      ['https://www.laden.example/de/touch.png', 180, 'png'],
      ['https://cdn.laden.example/i/152.png?v=2&x=1', 152, 'png'],
      ['https://www.laden.example/BIG.WEBP', 192, 'webp'],
    ])
    expect(manifest?.href).toBe('https://www.laden.example/site.webmanifest')
  })

  it('ignores mask-icon, SVG (by type or extension), other rels and unusable hrefs', () => {
    const { links } = parsePageIcons(`<head>
      <link rel="mask-icon" href="/safari.svg" color="#000">
      <link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">
      <link rel="icon" href="/icon.svg">
      <link rel="icon" href="/vector" type="image/svg+xml">
      <link rel="fluid-icon" href="/fluid.png">
      <link rel="stylesheet" href="/a.css">
      <link rel="icon">
      <link rel="icon" href="data:image/png;base64,iVBORw0KGgo=">
      <link rel="icon" href="javascript:alert(1)">
      <link rel="icon" href="https://laden.example:8443/a.png">
      <link rel="icon" href="/ok.png" sizes="64x64">
    </head>`, page)
    expect(links.map((link) => link.url.pathname)).toEqual(['/ok.png'])
  })

  it('skips comments, scripts and styles, stops at <body>, and honours <base href>', () => {
    const { links } = parsePageIcons(`<head>
      <!-- <link rel="icon" href="/commented.png" sizes="180x180"> -->
      <script>var s = '<link rel="icon" href="/script.png" sizes="180x180">'</script>
      <style>/* <link rel="icon" href="/style.png"> */</style>
      <noscript><link rel="icon" href="/noscript.png" sizes="180x180"></noscript>
      <base href="https://static.laden.example/assets/">
      <link rel="apple-touch-icon" href="apple.png">
      </head><body><link rel="icon" href="/body.png" sizes="512x512"></body>`, page)
    expect(links.map((link) => link.url.href)).toEqual(['https://static.laden.example/assets/apple.png'])
  })

  it('declaredSize keeps the largest square-ish entry', () => {
    expect(declaredSize('16x16 32x32 180x180')).toBe(180)
    expect(declaredSize('any')).toBe(0)
    expect(declaredSize('300x100 48x48')).toBe(48)
    expect(declaredSize('0x0 abc 12345x5')).toBe(0)
    expect(declaredSize(undefined)).toBe(0)
  })

  it('manifest icons: purpose any / maskable, resolved against the manifest, no SVG', () => {
    const manifestUrl = new URL('https://www.laden.example/m/app.json')
    const icons = manifestIcons({
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/mono.png', sizes: '512x512', purpose: 'monochrome' },
        { src: '/mask.png', sizes: '512x512', purpose: 'maskable' },
        { src: '/v.svg', sizes: 'any', type: 'image/svg+xml' },
        { src: 5 }, 'junk',
      ],
    }, manifestUrl)
    expect(icons.map((icon) => [icon.url.href, icon.size])).toEqual([
      ['https://www.laden.example/m/icon-192.png', 192],
      ['https://www.laden.example/mask.png', 512],
    ])
    expect(manifestIcons({ name: 'x' }, manifestUrl)).toEqual([])
    expect(manifestIcons(null, manifestUrl)).toEqual([])
  })

  it('orders big linked icons first (PNG/WebP, ~180 px), then manifest, the classic paths and the small ones', () => {
    const origin = 'https://www.laden.example'
    const { links } = parsePageIcons(`<head>
      <link rel="icon" href="/16.png" sizes="16x16">
      <link rel="icon" href="/unknown.png">
      <link rel="icon" href="/32.png" sizes="32x32">
      <link rel="icon" href="/big.ico" sizes="256x256">
      <link rel="icon" href="/1024.png" sizes="1024x1024">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" href="/favicon.ico">
    </head>`, new URL(`${origin}/`))
    const manifest = manifestIcons({ icons: [{ src: '/m-512.png', sizes: '512x512' }] }, new URL(`${origin}/app.json`))
    expect(orderCandidates(links, manifest, [origin]).map((candidate) => candidate.url.pathname)).toEqual([
      // a linked favicon.ico of unknown size often holds 32/48 px frames: before a known 16 px picture
      '/apple.png', '/1024.png', '/big.ico', '/m-512.png', '/apple-touch-icon.png', '/32.png', '/unknown.png', '/favicon.ico', '/16.png',
    ])
    // without a page: the classic paths on every origin that answered
    expect(orderCandidates([], [], ['https://laden.example', origin]).map((candidate) => candidate.url.href)).toEqual([
      'https://laden.example/apple-touch-icon.png', `${origin}/apple-touch-icon.png`,
      'https://laden.example/favicon.ico', `${origin}/favicon.ico`,
    ])
  })
})

describe('icon bytes', () => {
  it.each([
    ['PNG', iconFixtures.png(180), 'image/png', [180, 180]],
    ['GIF', iconFixtures.gif(64, 48), 'image/gif', [64, 48]],
    ['WebP (VP8X)', iconFixtures.webp(192), 'image/webp', [192, 192]],
    ['JPEG', iconFixtures.jpeg(120, 100), 'image/jpeg', [120, 100]],
    ['ICO (largest frame, 0 = 256)', iconFixtures.ico(16, 32, 0), 'image/x-icon', [256, 256]],
  ] as const)('%s: type from the bytes and its size', (_name, bytes, type, [width, height]) => {
    expect(sniffIconType(bytes)).toBe(type)
    expect(imageDimensions(bytes, type)).toEqual({ width, height })
  })

  it('reads lossy (VP8) and lossless (VP8L) WebP sizes', () => {
    const vp8 = padded([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 100, 0, 80, 0], 64)
    expect(imageDimensions(vp8, 'image/webp')).toEqual({ width: 100, height: 80 })
    // VP8L: 14-bit width-1 and height-1 after the 0x2f signature (here 64 × 64)
    const vp8l = padded([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8L'), 0, 0, 0, 0, 0x2f, 63, 0xc0, 0x0f, 0], 64)
    expect(imageDimensions(vp8l, 'image/webp')).toEqual({ width: 64, height: 64 })
  })

  it.each([
    ['HTML', padded(ascii('<!doctype html><html><head><title>Robot check</title>'))],
    ['SVG', padded(ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))],
    ['XML-prefixed SVG', padded(ascii('<?xml version="1.0"?><svg/>'))],
    ['AVIF (not an icon format here)', imageFixtures['image/avif']],
    ['a cursor (CUR) file', new Uint8Array([0, 0, 2, 0, 1, 0, ...Array.from(iconFixtures.ico(32).subarray(6))])],
    ['ICO whose frame points outside the file', (() => { const bytes = iconFixtures.ico(32); bytes[18] = 0xff; return bytes })()],
    ['ICO whose frame is neither PNG nor BMP', (() => { const bytes = iconFixtures.ico(32); bytes[22] = 0; return bytes })()],
    ['empty', new Uint8Array()],
  ])('rejects %s', (_name, bytes) => {
    expect(sniffIconType(bytes)).toBeUndefined()
  })

  it('answers with only our own headers, private and long-lived', async () => {
    const bytes = iconFixtures.png(180)
    const response = shopIconResponse({ type: 'image/png', bytes, width: 180, height: 180 })
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=604800',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'content-disposition': 'inline',
      'cross-origin-resource-policy': 'same-origin',
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })
})

describe('finding a shop icon', () => {
  const HEAD = (links: string) => html(`<!doctype html><html><head><title>Laden</title>${links}</head><body>…</body></html>`)

  it('takes the linked 180 px apple-touch-icon and downloads nothing else', async () => {
    const web = fakeWeb({
      'https://laden.example/': redirect('https://www.laden.example/'),
      'https://www.laden.example/': HEAD('<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-180.png">'),
      'https://www.laden.example/apple-touch-180.png': image(iconFixtures.png(180)),
    })
    const icon = await iconsOf(web)('laden.example', ownHost)
    expect(icon).toMatchObject({ type: 'image/png', width: 180, height: 180 })
    expect(web.urls()).toEqual([
      'https://laden.example/', 'https://www.laden.example/', 'https://www.laden.example/apple-touch-180.png',
    ])
  })

  it('falls back to /apple-touch-icon.png and then /favicon.ico when the page links nothing usable', async () => {
    const web = fakeWeb({
      'https://laden.example/': HEAD(''),
      'https://laden.example/favicon.ico': image(iconFixtures.ico(16, 48), 'image/vnd.microsoft.icon'),
    })
    const icon = await iconsOf(web)('laden.example', ownHost)
    expect(icon).toMatchObject({ type: 'image/x-icon', width: 48, height: 48 })
    expect(web.urls()).toEqual(['https://laden.example/', 'https://laden.example/apple-touch-icon.png', 'https://laden.example/favicon.ico'])
  })

  it('a robot check (503) still tries the classic paths on the origin that answered — once', async () => {
    const web = fakeWeb({
      'https://kaufhaus.example/': redirect('https://www.kaufhaus.example/'),
      'https://www.kaufhaus.example/': html('<title>Robot check</title><form action="/errors/validateCaptcha">', 503),
      'https://www.kaufhaus.example/favicon.ico': image(iconFixtures.ico(48), 'image/x-icon'),
    })
    const icon = await iconsOf(web)('kaufhaus.example', ownHost)
    expect(icon.type).toBe('image/x-icon')
    expect(web.urls()).toEqual([
      'https://kaufhaus.example/', 'https://www.kaufhaus.example/',
      'https://www.kaufhaus.example/apple-touch-icon.png', 'https://www.kaufhaus.example/favicon.ico',
    ])
  })

  it('tries www. when the apex does not answer at all', async () => {
    const web = fakeWeb({
      'https://laden.example/': () => { throw new TypeError('connection refused') },
      'https://www.laden.example/': HEAD('<link rel="apple-touch-icon" href="/a.png">'),
      'https://www.laden.example/a.png': image(iconFixtures.png(180)),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ width: 180 })
    expect(web.urls()).toEqual(['https://laden.example/', 'https://www.laden.example/', 'https://www.laden.example/a.png'])
  })

  it('uses the manifest when no linked icon promises 64 px, not otherwise', async () => {
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="icon" href="/f.png" sizes="32x32"><link rel="manifest" href="/app.webmanifest">'),
      'https://laden.example/app.webmanifest': () => Response.json({ icons: [{ src: '/m/192.png', sizes: '192x192', type: 'image/png' }] }),
      'https://laden.example/m/192.png': image(iconFixtures.png(192)),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ width: 192 })
    expect(web.urls()).toEqual(['https://laden.example/', 'https://laden.example/app.webmanifest', 'https://laden.example/m/192.png'])

    const big = fakeWeb({
      'https://laden.example/': HEAD('<link rel="apple-touch-icon" href="/a.png"><link rel="manifest" href="/app.webmanifest">'),
      'https://laden.example/a.png': image(iconFixtures.png(180)),
    })
    await iconsOf(big)('laden.example', ownHost)
    expect(big.urls()).not.toContain('https://laden.example/app.webmanifest')
  })

  it('size cap: an icon over 256 KiB (declared or streamed) is skipped for the next candidate', async () => {
    let streamed = 0
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="apple-touch-icon" href="/declared.png"><link rel="icon" href="/streamed.png" sizes="96x96">'),
      'https://laden.example/declared.png': image(iconFixtures.png(180), 'image/png', { 'content-length': String(MAX_ICON_BYTES + 1) }),
      'https://laden.example/streamed.png': () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = streamed === 0 ? iconFixtures.png(96, 96, 64 * 1024) : new Uint8Array(64 * 1024)
          streamed += chunk.byteLength
          controller.enqueue(chunk)
        },
      }), { headers: { 'content-type': 'image/png' } }),
      'https://laden.example/apple-touch-icon.png': image(iconFixtures.png(120)),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ width: 120 })
    expect(streamed).toBeLessThanOrEqual(MAX_ICON_BYTES + 128 * 1024)
  })

  it('an HTML page served as image/png is no icon (next candidate; nothing left → not_found)', async () => {
    const page = padded(ascii('<!doctype html><html><body>Access denied</body></html>'))
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="apple-touch-icon" href="/fake.png">'),
      'https://laden.example/fake.png': image(page, 'image/png'),
      'https://laden.example/favicon.ico': image(page, 'image/x-icon'),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).rejects.toMatchObject({ code: 'not_found', status: 404 })
    expect(web.urls()).toContain('https://laden.example/favicon.ico')
  })

  it('SVG: linked SVG icons are never requested, an SVG answer is refused by type and by bytes', async () => {
    const svg = padded(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/a.png">'),
      'https://laden.example/a.png': image(svg, 'image/svg+xml'),
      'https://laden.example/apple-touch-icon.png': image(svg, 'image/png'),
      'https://laden.example/favicon.ico': image(iconFixtures.ico(32), 'image/x-icon'),
    })
    const icon = await iconsOf(web)('laden.example', ownHost)
    expect(icon.type).toBe('image/x-icon')
    expect(web.urls()).not.toContain('https://laden.example/logo.svg')
  })

  it('keeps the best small icon when nothing reaches 64 px, never one under 16 px', async () => {
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="icon" href="/32.png" sizes="32x32"><link rel="icon" href="/16.png" sizes="16x16">'),
      'https://laden.example/32.png': image(iconFixtures.png(32)),
      'https://laden.example/16.png': image(iconFixtures.png(16)),
      'https://laden.example/favicon.ico': image(iconFixtures.ico(24), 'image/x-icon'),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ type: 'image/png', width: 32 })

    const tiny = fakeWeb({
      'https://laden.example/': HEAD(''),
      'https://laden.example/favicon.ico': image(iconFixtures.ico(8), 'image/x-icon'),
    })
    await expect(iconsOf(tiny)('laden.example', ownHost)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a square icon beats a bigger wide logo', async () => {
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="apple-touch-icon" href="/wide.png"><link rel="icon" href="/square.png" sizes="96x96">'),
      'https://laden.example/wide.png': image(iconFixtures.png(600, 200)),
      'https://laden.example/square.png': image(iconFixtures.png(96)),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ width: 96, height: 96 })
  })

  it('with only wide pictures the best one is kept, after at most five downloads', async () => {
    const links = Array.from({ length: 8 }, (_, index) => `<link rel="icon" href="/wide-${index}.png" sizes="${100 + index}x${100 + index}">`).join('')
    const routes: Record<string, Route> = { 'https://laden.example/': HEAD(links) }
    for (let index = 0; index < 8; index++) routes[`https://laden.example/wide-${index}.png`] = image(iconFixtures.png(300, 100))
    const web = fakeWeb(routes)
    // only wide pictures: the best of them (not square-ish) is still returned, after at most five downloads
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ width: 300, height: 100 })
    expect(web.urls().filter((url) => url !== 'https://laden.example/')).toHaveLength(5)
  })

  it('a host whose name resolves to a private address is blocked before any request', async () => {
    const web = fakeWeb({}, ['laden.example', 'www.laden.example'])
    await expect(iconsOf(web)('laden.example', ownHost)).rejects.toMatchObject({ code: 'blocked_target', status: 422 })
    expect(web.fetch).not.toHaveBeenCalled()
  })

  it('a start page redirecting to a private IP is never followed', async () => {
    const web = fakeWeb({
      'https://laden.example/': redirect('http://192.168.1.1/'),
      'https://www.laden.example/': redirect('http://[::1]:80/admin'),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).rejects.toMatchObject({ code: 'blocked_target' })
    expect(web.urls()).toEqual(['https://laden.example/', 'https://www.laden.example/'])
  })

  it('icon links to private IPs, odd ports, local names or our own host are never requested', async () => {
    const web = fakeWeb({
      'https://laden.example/': HEAD(`
        <link rel="apple-touch-icon" href="http://10.0.0.5/a.png">
        <link rel="apple-touch-icon" href="http://169.254.169.254/latest/meta-data">
        <link rel="apple-touch-icon" href="https://laden.example:8443/a.png">
        <link rel="apple-touch-icon" href="https://intranet.local/a.png">
        <link rel="apple-touch-icon" href="https://${ownHost}/api/health">
        <link rel="apple-touch-icon" href="http://[::ffff:127.0.0.1]/a.png">`),
      'https://laden.example/apple-touch-icon.png': image(iconFixtures.png(180)),
    })
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ width: 180 })
    expect(web.urls()).toEqual(['https://laden.example/', 'https://laden.example/apple-touch-icon.png'])
  })

  it('an icon that redirects to a private address is skipped; DNS is checked again on the hop', async () => {
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="apple-touch-icon" href="https://cdn.laden.example/a.png">'),
      'https://cdn.laden.example/a.png': redirect('https://internal-cdn.laden.example/a.png', 302),
      'https://laden.example/apple-touch-icon.png': image(iconFixtures.png(152)),
    }, ['internal-cdn.laden.example'])
    await expect(iconsOf(web)('laden.example', ownHost)).resolves.toMatchObject({ width: 152 })
    expect(web.resolve).toHaveBeenCalledWith('internal-cdn.laden.example', expect.any(AbortSignal))
    expect(web.urls()).not.toContain('https://internal-cdn.laden.example/a.png')
  })

  it('sends only the fixed request headers, with manual redirects', async () => {
    const web = fakeWeb({
      'https://laden.example/': HEAD('<link rel="apple-touch-icon" href="/a.png">'),
      'https://laden.example/a.png': image(iconFixtures.png(180)),
    })
    await iconsOf(web)('laden.example', ownHost)
    expect(web.calls.map((call) => [call.redirect, call.headers])).toEqual([
      ['manual', {
        'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)', accept: 'text/html', 'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      }],
      ['manual', { 'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)', accept: 'image/png,image/webp,image/x-icon,image/*;q=0.8' }],
    ])
  })
})

describe('caching per host', () => {
  const shop = () => fakeWeb({
    'https://laden.example/': html('<head><link rel="apple-touch-icon" href="/a.png"></head>'),
    'https://laden.example/a.png': image(iconFixtures.png(180)),
  })

  it('the second call does not fetch again; an icon is kept 14 days', async () => {
    let clock = NOW
    const web = shop()
    const icons = iconsOf(web, { now: () => clock })
    await icons('laden.example', ownHost)
    const first = web.fetch.mock.calls.length
    clock += 14 * 24 * 60 * 60 * 1000 - 1
    await expect(icons('laden.example', ownHost)).resolves.toMatchObject({ width: 180 })
    expect(web.fetch.mock.calls.length).toBe(first)
    clock += 1
    await icons('laden.example', ownHost)
    expect(web.fetch.mock.calls.length).toBe(first * 2)
  })

  it('"no icon" is cached too, for 12 hours', async () => {
    let clock = NOW
    const web = fakeWeb({ 'https://laden.example/': html('<head></head>') })
    const icons = iconsOf(web, { now: () => clock })
    await expect(icons('laden.example', ownHost)).rejects.toMatchObject({ code: 'not_found' })
    const first = web.fetch.mock.calls.length
    clock += 12 * 60 * 60 * 1000 - 1
    await expect(icons('laden.example', ownHost)).rejects.toMatchObject({ code: 'not_found' })
    expect(web.fetch.mock.calls.length).toBe(first)
    clock += 1
    await expect(icons('laden.example', ownHost)).rejects.toMatchObject({ code: 'not_found' })
    expect(web.fetch.mock.calls.length).toBe(first * 2)
  })

  it('concurrent requests for one host share one lookup', async () => {
    const web = shop()
    const icons = iconsOf(web)
    const results = await Promise.all(Array.from({ length: 5 }, () => icons('laden.example', ownHost)))
    expect(results.every((icon) => icon.width === 180)).toBe(true)
    expect(web.urls()).toEqual(['https://laden.example/', 'https://laden.example/a.png'])
  })

  it('more than six hosts at a time → rate_limited with Retry-After 5; slots free up afterwards', async () => {
    vi.useFakeTimers()
    const web = fakeWeb({})
    vi.mocked(web.fetch).mockImplementation(() => new Promise<Response>(() => {}))
    const icons = iconsOf(web)
    const stalled = Array.from({ length: 6 }, (_, index) =>
      expect(icons(`laden-${index}.example`, ownHost)).rejects.toMatchObject({ code: 'timeout' }))
    await expect(icons('overflow.example', ownHost)).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 5 })
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all(stalled)
    vi.mocked(web.fetch).mockImplementation(async () => new Response('<head></head>', { headers: { 'content-type': 'text/html' } }))
    await expect(icons('later.example', ownHost)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a shop that never answers ends in timeout, and that is not remembered as "no icon"', async () => {
    vi.useFakeTimers()
    const web = fakeWeb({})
    const stall = () => new Promise<Response>(() => {})
    vi.mocked(web.fetch).mockImplementation(stall)
    const icons = iconsOf(web)
    const pending = expect(icons('langsam.example', ownHost)).rejects.toMatchObject({ code: 'timeout', status: 504 })
    await vi.advanceTimersByTimeAsync(10_000)
    await pending
    vi.mocked(web.fetch).mockImplementation(async (input) => String(input).endsWith('/a.png')
      ? new Response(iconFixtures.png(180), { headers: { 'content-type': 'image/png' } })
      : new Response('<head><link rel="apple-touch-icon" href="/a.png"></head>', { headers: { 'content-type': 'text/html' } }))
    await expect(icons('langsam.example', ownHost)).resolves.toMatchObject({ width: 180 })
  })

  it('a client that goes away does not cancel the lookup the others wait for', async () => {
    const web = shop()
    const icons = iconsOf(web)
    const controller = new AbortController()
    const leaving = icons('laden.example', ownHost, controller.signal)
    const staying = icons('laden.example', ownHost)
    controller.abort()
    await expect(leaving).rejects.toMatchObject({ code: 'timeout' })
    await expect(staying).resolves.toMatchObject({ width: 180 })
  })

  it('Cache API: a fresh isolate is served from the store without asking the shop; "none" too; junk is ignored', async () => {
    const saved = new Map<string, Response>()
    const store: IconStore = {
      match: vi.fn(async (key: string) => saved.get(key)?.clone()),
      put: vi.fn(async (key: string, response: Response) => { saved.set(key, response) }),
    }
    const web = shop()
    await iconsOf(web, { store })('laden.example', ownHost)
    const key = `https://${ownHost}/api/shop-icon/__cache/v1/laden.example`
    expect(saved.get(key)?.headers.get('cache-control')).toBe('public, max-age=1209600')
    expect(saved.get(key)?.headers.get('content-type')).toBe('image/png')

    const second = shop()
    await expect(iconsOf(second, { store })('laden.example', ownHost)).resolves.toMatchObject({ type: 'image/png', width: 180 })
    expect(second.fetch).not.toHaveBeenCalled()

    const nothing = fakeWeb({ 'https://leer.example/': html('<head></head>') })
    await expect(iconsOf(nothing, { store })('leer.example', ownHost)).rejects.toMatchObject({ code: 'not_found' })
    const none = saved.get(`https://${ownHost}/api/shop-icon/__cache/v1/leer.example`)
    expect(none?.headers.get('cache-control')).toBe('public, max-age=43200')
    const later = fakeWeb({})
    await expect(iconsOf(later, { store })('leer.example', ownHost)).rejects.toMatchObject({ code: 'not_found' })
    expect(later.fetch).not.toHaveBeenCalled()

    // something that is not an icon in the store (e.g. a corrupted entry) is ignored: the shop is asked again
    saved.set(key, new Response('<html>oops</html>', { headers: { 'content-type': 'image/png' } }))
    const third = shop()
    await expect(iconsOf(third, { store })('laden.example', ownHost)).resolves.toMatchObject({ width: 180 })
    expect(third.fetch).toHaveBeenCalled()
  })

  it('a broken store never breaks the answer', async () => {
    const store: IconStore = {
      match: async () => { throw new Error('cache down') },
      put: async () => { throw new Error('cache full') },
    }
    await expect(iconsOf(shop(), { store })('laden.example', ownHost)).resolves.toMatchObject({ width: 180 })
  })
})
