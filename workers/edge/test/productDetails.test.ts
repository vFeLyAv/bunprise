import { describe, expect, it } from 'vitest'
import { extract, parseGtin, resolveImageUrl, stripTags } from '../src/html/extract'

const product = (value: unknown): string => `<script type="application/ld+json">${JSON.stringify(value)}</script>`
const page = 'https://www.shop.example/de/p/lamp?id=7'

function details(html: string, url: string = page) {
  const result = extract(html, new URL(url).hostname, url)
  return {
    image_url: result.image_url, description: result.description, brand: result.brand,
    color: result.color, gtin: result.gtin,
  }
}

describe('product picture', () => {
  it.each([
    ['a string', 'https://cdn.example/a.jpg', 'https://cdn.example/a.jpg'],
    ['an array of strings', ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'], 'https://cdn.example/a.jpg'],
    ['an ImageObject with url', { '@type': 'ImageObject', url: 'https://cdn.example/o.webp' }, 'https://cdn.example/o.webp'],
    ['an ImageObject with contentUrl', { '@type': 'ImageObject', contentUrl: '/media/c.png' }, 'https://www.shop.example/media/c.png'],
    ['an array of ImageObjects', [{ contentUrl: 'img/d.avif' }], 'https://www.shop.example/de/p/img/d.avif'],
    ['a protocol-relative URL', '//cdn.example/e.jpg', 'https://cdn.example/e.jpg'],
  ])('reads Product.image as %s', (_name, image, expected) => {
    expect(details(product({ '@type': 'Product', name: 'Lamp', image })).image_url).toBe(expected)
  })

  it('prefers the Product image to og:image, and og:image to link rel=image_src', () => {
    const og = '<meta property="og:image" content="https://cdn.example/og.jpg">'
    const link = '<link rel="shortcut image_src" href="https://cdn.example/link.jpg?a=1&amp;b=2">'
    expect(details(og + link + product({ '@type': 'Product', name: 'Lamp', image: 'https://cdn.example/p.jpg' })).image_url)
      .toBe('https://cdn.example/p.jpg')
    expect(details(link + og).image_url).toBe('https://cdn.example/og.jpg')
    expect(details(link).image_url).toBe('https://cdn.example/link.jpg?a=1&b=2')
    expect(details('<link rel=stylesheet href=/style.css>').image_url).toBeNull()
  })

  it('reads twitter:image when there is no og:image', () => {
    expect(details('<meta name="twitter:image" content="https://cdn.example/t.jpg">').image_url).toBe('https://cdn.example/t.jpg')
  })

  it('resolves relative og:image against the final page URL and decodes entities', () => {
    expect(details('<meta property="og:image" content="../img/lamp.jpg?w=800&amp;h=600">').image_url)
      .toBe('https://www.shop.example/de/img/lamp.jpg?w=800&h=600')
    expect(details('<meta name="twitter:image" content="/t.jpg">', 'http://plain.example/x').image_url)
      .toBe('http://plain.example/t.jpg')
  })

  it('defaults the base to https://<hostname>/ when no page URL is given', () => {
    expect(extract('<meta property=og:image content="/a.jpg">', 'shop.example').image_url).toBe('https://shop.example/a.jpg')
  })

  it('prefers https inside a tier and keeps http when it is the only candidate', () => {
    expect(details('<meta property=og:image content="http://cdn.example/a.jpg">'
      + '<meta property=og:image:secure_url content="https://cdn.example/a.jpg">').image_url).toBe('https://cdn.example/a.jpg')
    expect(details(product({
      '@type': 'Product', name: 'Lamp', image: ['http://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
    })).image_url).toBe('https://cdn.example/2.jpg')
    expect(details('<meta property=og:image content="http://cdn.example/a.jpg">').image_url).toBe('http://cdn.example/a.jpg')
  })

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/png;base64,iVBORw0KGgo=', 'file:///etc/passwd',
    'ftp://cdn.example/a.jpg', 'https://user:pw@cdn.example/a.jpg', 'https://cdn.example:8443/a.jpg',
    `https://cdn.example/${'a'.repeat(2048)}.jpg`, 'https://cdn.example/a\u0001.jpg', 'blob:https://cdn.example/x', '  ',
  ])('rejects image URL %s and falls back to the next tier', (bad) => {
    const block = product({ '@type': 'Product', name: 'Lamp', image: bad })
    expect(details(block).image_url).toBeNull()
    expect(details(`${block}<meta property=og:image content="https://cdn.example/ok.jpg">`).image_url)
      .toBe('https://cdn.example/ok.jpg')
  })

  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', ' javascript:alert(1)'])('rejects og:image %s', (bad) => {
    expect(details(`<meta property=og:image content="${bad.replaceAll('<', '&lt;')}">`).image_url).toBeNull()
  })

  it('resolveImageUrl never accepts a relative URL without a base', () => {
    expect(resolveImageUrl('/a.jpg', undefined)).toBeUndefined()
    expect(resolveImageUrl('https://cdn.example:443/a.jpg', undefined)?.href).toBe('https://cdn.example/a.jpg')
  })
})

describe('product description', () => {
  it.each([
    ['Product.description first', product({ '@type': 'Product', name: 'L', description: 'From JSON-LD' })
      + '<meta property=og:description content="From OG"><meta name=description content="From meta">', 'From JSON-LD'],
    ['og:description before meta description',
      '<meta name=description content="From meta"><meta property=og:description content="From OG">', 'From OG'],
    ['meta description last', '<meta name=description content="From &amp; meta">', 'From & meta'],
    ['nothing', '<title>x</title>', null],
  ])('takes the description from %s', (_name, html, expected) => {
    expect(details(html).description).toBe(expected)
  })

  it('strips tags, decodes entities once and collapses whitespace', () => {
    expect(details(product({
      '@type': 'Product', name: 'L', description: '<p>Warm&nbsp;light,\n\n <b>dimmable</b></p><br/>3 &lt; 4 &amp;amp; a<5',
    })).description).toBe('Warm light, dimmable 3 < 4 &amp; a<5')
    expect(details('<meta property=og:description content="&lt;p&gt;Soft &amp;amp; warm&lt;/p&gt; &#x202E;x">').description)
      .toBe('Soft &amp; warm x')
    // Inside JSON-LD a shop must escape "</" as "<\/", or the block ends early (as in a browser).
    expect(details(product({
      '@type': 'Product', name: 'L', description: '<script>alert(1)</script>Lamp <img src=x onerror=1',
    }).replace('</script>Lamp', '<\\/script>Lamp')).description).toBe('alert(1) Lamp')
    expect(stripTags('a < b and c<d> e')).toBe('a < b and c  e')
  })

  it('scans pathological descriptions in bounded time', () => {
    const description = '<a'.repeat(200_000) + '>'.repeat(10) + '&amp;'.repeat(100_000)
    const started = performance.now()
    const result = details(product({ '@type': 'Product', name: 'L', description }))
    expect(result.description!.length).toBeLessThanOrEqual(500)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

describe('brand, colour and GTIN', () => {
  it('cuts oversized values at their caps on word or code-point boundaries', () => {
    const result = details(product({
      '@type': 'Product', name: 'L', description: 'word '.repeat(200), brand: 'B'.repeat(200),
      color: 'Midnight blue '.repeat(10),
    }))
    expect(result.description).toBe('word '.repeat(100).trim())
    expect(result.brand).toBe('B'.repeat(80))
    expect(result.color).toBe('Midnight blue Midnight blue Midnight blue Midnight blue')
    expect(details(product({ '@type': 'Product', name: 'L', brand: `${'a'.repeat(79)}🎁` })).brand).toBe('a'.repeat(79))
  })

  it.each([
    ['a string', 'Bunwear', 'Bunwear'],
    ['a Brand object', { '@type': 'Brand', name: 'Bunwear &amp; Co' }, 'Bunwear & Co'],
    ['an array', [{ '@type': 'Brand', name: 'First' }, 'Second'], 'First'],
    ['an object without name', { '@type': 'Brand' }, null],
    ['a number', 42, null],
    ['blank', '  ', null],
  ])('reads Product.brand as %s', (_name, brand, expected) => {
    expect(details(product({ '@type': 'Product', name: 'L', brand })).brand).toBe(expected)
  })

  it.each([
    ['a string', 'Rosé', 'Rosé'],
    ['an array', ['Black', ' ', 'White', 7, 'Red'], 'Black, White, Red'],
    ['an empty array', [], null],
    ['an object', { name: 'Blue' }, null],
  ])('reads Product.color as %s', (_name, color, expected) => {
    expect(details(product({ '@type': 'Product', name: 'L', color })).color).toBe(expected)
  })

  it.each([
    [{ gtin13: '4006381333931' }, '4006381333931'],
    [{ gtin13: '400-6381 333931' }, '4006381333931'],
    [{ gtin: '0012345678905' }, '0012345678905'],
    [{ gtin14: 10012345678902 }, '10012345678902'],
    [{ gtin12: '012345678905' }, '012345678905'],
    [{ gtin8: '96385074' }, '96385074'],
    [{ isbn: '978-3-16-148410-0' }, '9783161484100'],
    [{ gtin13: 'abc', gtin: '12345678' }, '12345678'],
    [{ gtin13: '1234567' }, null],
    [{ gtin13: '123456789012345' }, null],
    [{ isbn: '3-16-148410-X' }, null],
    [{ gtin13: '4006381333931x' }, null],
    [{ gtin13: 1.5 }, null],
    [{ gtin13: -40063813 }, null],
    [{ gtin: 'https://id.gs1.org/01/04006381333931' }, null],
    [{}, null],
  ])('validates GTIN %j', (fields, expected) => {
    expect(details(product({ '@type': 'Product', name: 'L', ...fields })).gtin).toBe(expected)
  })

  it('bounds the GTIN input length', () => {
    expect(parseGtin(`${' '.repeat(60)}12345678`)).toBeNull()
    expect(parseGtin('1234 5678')).toBe('12345678')
  })
})

describe('which Product supplies the details', () => {
  it('takes details only from the Product that supplied the title', () => {
    const html = product([
      { '@type': 'Product', name: 'Main lamp', image: 'https://cdn.example/main.jpg' },
      { '@type': 'Product', name: 'Related', brand: 'Other', color: 'Green', gtin13: '4006381333931', image: 'https://cdn.example/rel.jpg' },
    ])
    expect(details(html)).toEqual({
      image_url: 'https://cdn.example/main.jpg', description: null, brand: null, color: null, gtin: null,
    })
  })

  it('ignores details of a Product without a name', () => {
    expect(details(product({ '@type': 'Product', brand: 'Ghost', image: 'https://cdn.example/g.jpg' }))).toEqual({
      image_url: null, description: null, brand: null, color: null, gtin: null,
    })
  })

  it('returns the full contract for a typical shop page', () => {
    const html = `<head><meta property="og:site_name" content="Bunshop">
      <meta property="og:image" content="/og.jpg"><meta name="description" content="Meta text">
      ${product({
        '@context': 'https://schema.org', '@type': 'Product', name: 'Lamp Nova',
        image: [{ '@type': 'ImageObject', url: 'https://cdn.bunshop.example/nova.webp' }],
        description: 'A warm lamp.', brand: { '@type': 'Brand', name: 'Nova' }, color: ['Sand', 'Oak'],
        gtin13: '4006381333931', offers: { '@type': 'Offer', price: '49.90', priceCurrency: 'EUR' },
      })}</head>`
    expect(extract(html, 'www.bunshop.example', 'https://www.bunshop.example/p/nova')).toEqual({
      site: 'Bunshop', title: 'Lamp Nova', price_cents: 4990, currency: 'EUR', partial: false,
      image_url: 'https://cdn.bunshop.example/nova.webp', description: 'A warm lamp.', brand: 'Nova',
      color: 'Sand, Oak', gtin: '4006381333931',
    })
  })
})
