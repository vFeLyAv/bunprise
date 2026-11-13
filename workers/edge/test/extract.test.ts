import { describe, expect, it } from 'vitest'
import { decodeEntities, detectHtmlCharset, extract, hasCompleteMetadata, parsePrice } from '../src/html/extract'

const product = (value: unknown): string => `<script type="application/ld+json">${JSON.stringify(value)}</script>`
const offer = (price: unknown = '29.99', priceCurrency = 'EUR') => ({ '@type': 'Offer', price, priceCurrency })
const noDetails = { image_url: null, description: null, brand: null, color: null, gtin: null }

describe('HTML metadata extraction', () => {
  it('accepts mixed case tags, attribute order, quoting and whitespace', () => {
    expect(extract(`
      <META CONTENT='Bunny &amp; Friends | Bunshop' PROPERTY="OG:TITLE">
      <meta content=Bunshop name=og:site_name>
      <meta itemprop="priceCurrency" content="EUR"><meta content="29,99" itemprop=price>
    `, 'www.bunshop.example')).toEqual({
      site: 'Bunshop', title: 'Bunny & Friends', price_cents: 2999, currency: 'EUR', partial: false, ...noDetails,
    })
  })

  it('uses a Product name in @graph and @type arrays above all lower-priority titles', () => {
    const html = `<title>HTML title</title><meta name=twitter:title content="Twitter title">
      <meta property=og:title content="OG title">${product({
        '@graph': [{ '@type': 'Organization', name: 'Organization' }, {
          '@type': ['Thing', 'Product'], name: 'Product title', offers: [offer(12.5)],
        }],
      })}`
    expect(extract(html, 'www.shop.example')).toEqual({
      site: 'shop.example', title: 'Product title', price_cents: 1250, currency: 'EUR', partial: false, ...noDetails,
    })
  })

  it('reads every complete JSON-LD block, safely skipping invalid JSON', () => {
    const html = `<script type="application/ld+json">{broken</script>${product([{
      '@type': 'https://schema.org/Product', name: 'Lamp',
      offers: { '@type': 'AggregateOffer', lowPrice: '1.299,00', priceCurrency: 'EUR' },
    }])}`
    expect(extract(html, 'shop.example').price_cents).toBe(129900)
    expect(extract(html, 'shop.example').title).toBe('Lamp')
  })

  it.each([
    ['<meta property=og:title content="OG"><meta name=twitter:title content="Twitter"><title>HTML</title>', 'OG'],
    ['<meta name=twitter:title content="Twitter"><title>HTML</title>', 'Twitter'],
    ['<title>  HTML \n title </title>', 'HTML title'],
  ])('honors the title fallback order', (html, title) => {
    expect(extract(html, 'shop.example').title).toBe(title)
  })

  it.each([' | ', ' - ', ' – '])('removes the matching site suffix %s', (separator) => {
    expect(extract(`<title>My item${separator}Shop</title><meta property=og:site_name content=Shop>`, 'shop.example').title).toBe('My item')
    expect(extract(`<title>My item${separator}Other Shop</title><meta property=og:site_name content=Shop>`, 'shop.example').title).toBe(`My item${separator}Other Shop`)
  })

  it('uses the full site name for suffix removal before shortening the site', () => {
    const site = 'A'.repeat(70)
    expect(extract(`<title>Item | ${site}</title><meta property=og:site_name content="${site}">`, 'aaa.example')).toMatchObject({
      title: 'Item', site: 'A'.repeat(60),
    })
  })

  it('cuts a long title at a word boundary and caps a single long word', () => {
    expect(extract(`<title>${'word '.repeat(35)}</title>`, 'example.com').title).toBe('word '.repeat(24).trim())
    expect(extract(`<title>${'x'.repeat(130)}</title>`, 'example.com').title).toHaveLength(120)
    expect(extract(`<title>${'x'.repeat(119)}🎁</title>`, 'example.com').title).toHaveLength(119)
  })

  it('decodes common named and numeric entities, and collapses whitespace', () => {
    expect(extract('<title>&Auml; &ouml; &eacute;&nbsp;&#x1f381; &#8364; &quot;yes&quot;\n &amp; &#39;ok&#39;</title>', 'example.com').title)
      .toBe('Ä ö é 🎁 € "yes" & \'ok\'')
    expect(decodeEntities('&#0; &#xD800; &#x110000; &unknown;')).toBe('� � � &unknown;')
    expect(decodeEntities('&constructor; &toString; &__proto__;')).toBe('&constructor; &toString; &__proto__;')
  })

  it('sanitizes raw title, entity metadata and JSON-LD before returning display text', () => {
    const head = '<meta property="og:site_name" content="Shop&#27;[2J&#x202E;">'
      + '<title>Lamp\u0000 &#27;[2J&#7; &#x85;</title>'
    const jsonLd = product({ '@type': 'Product', name: 'Desk \u0000\u001b[31m \u202egpj.exe \ud800' })
    expect(extract(head, 'shop.example')).toMatchObject({ title: 'Lamp\ufffd [2J', site: 'Shop [2J' })
    expect(extract(head + jsonLd, 'shop.example')).toMatchObject({
      title: 'Desk \ufffd [31m gpj.exe \ufffd', site: 'Shop [2J',
    })
    expect(extract('<title>Desk\u0000Lamp</title>', 'shop.example').title).toBe('Desk\ufffdLamp')
    expect(extract(product({ '@type': 'Product', name: 'Lamp\u0000Shade' }), 'shop.example').title).toBe('Lamp\ufffdShade')
  })

  it.each([
    ['MediaMarkt', 'www.mediamarkt.de', 'MediaMarkt'],
    ['IKEA Deutschland', 'www.ikea.com', 'IKEA Deutschland'],
    ['MEDIA-MARKT', 'www.mediamarkt.de', 'MEDIA-MARKT'],
    ['amazon.de', 'deals.example', 'deals.example'],
    ['Amazon', 'deals.example', 'deals.example'],
    ['&#x202E;ed.nozama', 'www.deals.example', 'deals.example'],
    ['IKEA Deutschland', 'www.deals.ikea.com', 'deals.ikea.com'],
    ['AB Shop', 'www.ab.example', 'ab.example'],
    ['---', 'www.shop.example', 'shop.example'],
  ])('accepts site %s only when it plausibly belongs to %s', (site, hostname, expected) => {
    expect(extract(`<meta property="og:site_name" content="${site}">`, hostname).site).toBe(expected)
  })

  it('removes all directional controls from titles and only strips the accepted site suffix', () => {
    expect(extract('<title>Kopfh&ouml;rer &#x202E;00,9 &euro;</title>'
      + '<meta property="og:site_name" content="amazon.de">', 'deals.example')).toMatchObject({
      site: 'deals.example', title: 'Kopfhörer 00,9 €',
    })
    expect(extract('<title>Watch | Amazon</title><meta property="og:site_name" content="Amazon">', 'deals.example').title)
      .toBe('Watch | Amazon')
    const directions = '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200e\u200f\u061c'
    expect(extract(`<meta property=og:site_name content="Shop${directions}"><title>Gift${directions}</title>`, 'shop.example'))
      .toMatchObject({ site: 'Shop', title: 'Gift' })
  })

  it('cuts site names on code-point boundaries without leaving a high surrogate', () => {
    expect(extract(`<meta property=og:site_name content="${'a'.repeat(59)}🎁">`, 'aaa.example').site).toBe('a'.repeat(59))
  })

  it('preserves source offsets around Unicode characters with expanding lowercase forms', () => {
    expect(extract('<title>İstanbul Cup</title>', 'example.com').title).toBe('İstanbul Cup')
    const html = `<p>İ</p>${product({
      '@type': 'Product', name: 'İstanbul Cup', offers: offer(29.99),
    })}<title>Fallback</title>`
    expect(extract(html, 'example.com')).toMatchObject({ title: 'İstanbul Cup', price_cents: 2999 })
  })

  it.each(['og', 'product'])('reads %s price metadata', (namespace) => {
    expect(extract(`<meta property="${namespace}:price:amount" content="EUR 29.99">
      <meta property="${namespace}:price:currency" content="EUR"><title>Item</title>`, 'example.com').price_cents).toBe(2999)
  })

  it('never represents a non-EUR price as euros', () => {
    expect(extract(product({ '@type': 'Product', name: 'Item', offers: offer(20, 'USD') }), 'example.com')).toMatchObject({
      price_cents: null, currency: null,
    })
    expect(extract('<meta itemprop=price content=20><title>Item</title>', 'example.com').price_cents).toBeNull()
  })

  it('prefers JSON-LD price to metadata prices and supports an offers array', () => {
    expect(extract(`${product({ '@type': 'Product', name: 'Item', offers: [offer(30, 'USD'), offer(0)] })}
      <meta property=og:price:amount content=50><meta property=og:price:currency content=EUR>`, 'example.com').price_cents).toBe(0)
  })

  it('reports partial only when there is no usable title', () => {
    expect(extract('<meta property=og:title content="  "><title> </title>', 'www.shop.example')).toEqual({
      site: 'shop.example', title: null, price_cents: null, currency: null, partial: true, ...noDetails,
    })
  })

  it('ignores metadata inside comments and raw-text elements', () => {
    const fake = '<meta property=og:title content=Fake>'
    expect(extract(`<!--${fake}--><style>${fake}</style><script>${fake}</script><textarea>${fake}</textarea><title>Real</title>`, 'example.com').title).toBe('Real')
  })

  it('does not confuse similar script closing names or execute scripts', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Text </scripture> item"}</script>
      <script>throw new Error('never run')</script>`
    expect(extract(html, 'example.com').title).toBe('Text </scripture> item')
  })

  it('handles malformed tags and scripts without throwing', () => {
    for (const html of ['<meta content="unfinished', '<script type=application/ld+json>{"a":', '<><<<', '<!--unfinished', '<title>unfinished']) {
      expect(() => extract(html, 'example.com')).not.toThrow()
    }
  })

  it('keeps the first duplicate attribute and skips empty metadata', () => {
    expect(extract('<meta property=og:title content=First content=Second><title>Third</title>', 'example.com').title).toBe('First')
    expect(extract('<meta property=og:title content=" "><meta property=og:title content=Later>', 'example.com').title).toBe('Later')
  })

  it('handles deeply nested JSON-LD iteratively', () => {
    const depth = 15_000
    const html = `<script type=application/ld+json>${'['.repeat(depth)}{"@type":"Product","name":"Nested"}${']'.repeat(depth)}</script>`
    expect(extract(html, 'example.com').title).toBe('Nested')
  })

  it('processes pathological one-MiB markup in bounded time', () => {
    const cases = [
      '<meta a="'.repeat(110_000).slice(0, 1024 * 1024),
      '<'.repeat(1024 * 1024),
      '<meta ' + 'a='.repeat(524_284),
    ]
    const started = performance.now()
    for (const html of cases) expect(() => extract(html, 'example.com')).not.toThrow()
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

describe('price parsing', () => {
  it.each([
    ['29,99', 2999], ['1.299,00', 129900], ['1,299.00', 129900], ['29.99 €', 2999],
    ['EUR 29.99', 2999], [29.99, 2999], [0, 0], ['1 299,00', 129900], ['1.299', 129900],
    ['1,299', 129900], ['1.299.999,99', 129999999], ['9,9', 990],
  ])('parses %s as integer EUR cents', (value, expected) => {
    expect(parsePrice(value, 'EUR')).toBe(expected)
  })

  it.each([-1, Infinity, NaN, 'USD 29.99', '$20', '9.99.99', '1,2,3', '1.23,45', '2e5', '', {}, '999999999999999999999'])('rejects invalid price %s', (value) => {
    expect(parsePrice(value, 'EUR')).toBeNull()
  })
})

describe('streaming metadata helpers', () => {
  it('waits for Product metadata even if the head already has an OG title and price', () => {
    const head = `<head><meta property=og:site_name content=Shop><meta property=og:title content=OG>
      <meta property=og:price:amount content=10><meta property=og:price:currency content=EUR></head>`
    expect(hasCompleteMetadata(head)).toBe(false)
    const full = head + product({ '@type': 'Product', name: 'Product', offers: offer(12), image: 'https://cdn.example/p.jpg' })
    expect(hasCompleteMetadata(full)).toBe(true)
    expect(hasCompleteMetadata(full.slice(0, -9))).toBe(false)
    expect(hasCompleteMetadata(product({ '@type': 'Product', name: 'Product', offers: offer(12) }))).toBe(false)
  })

  it('is complete only once a usable picture is known (Product image or og:image)', () => {
    const head = '<meta property=og:site_name content=Shop>'
    const block = product({ '@type': 'Product', name: 'Product', offers: offer(12) })
    expect(hasCompleteMetadata(head + block)).toBe(false)
    expect(hasCompleteMetadata(`${head}<meta property=og:image content="/p.jpg">${block}`, 'https://shop.example/item')).toBe(true)
    // Without a page URL a relative picture cannot be resolved yet.
    expect(hasCompleteMetadata(`${head}<meta property=og:image content="/p.jpg">${block}`)).toBe(false)
    expect(hasCompleteMetadata(`${head}<meta property=og:image content="javascript:alert(1)">${block}`, 'https://shop.example/')).toBe(false)
  })

  it('detects meta charset and legacy content-type declarations', () => {
    expect(detectHtmlCharset('<META CHARSET="windows-1252">')).toBe('windows-1252')
    expect(detectHtmlCharset('<meta content="text/html; charset=iso-8859-1" http-equiv="Content-Type">')).toBe('iso-8859-1')
    expect(detectHtmlCharset('<script>"<meta charset=windows-1252>"</script>')).toBeUndefined()
  })
})
