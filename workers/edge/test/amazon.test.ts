import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Fetch } from '../src/http'
import { createLinkPreview } from '../src/linkPreview'
import {
  AMAZON_MAX_HTML_BYTES, amazonAsin, canonicalAmazonUrl, createAmazonProgress, extractAmazon, isAmazonHost,
  isAmazonRobotCheck,
} from '../src/sites/amazon'

// Trimmed fragments (10–12 KB) cut out of real amazon.de product pages fetched on 2026-10-22.
const fixture = (asin: string): string => readFileSync(new URL(`./fixtures/amazon/${asin}.html`, import.meta.url), 'utf8')
const ownHost = 'bunprise.example'
const subject = 'fixture-user'
const publicResolver = vi.fn(async () => ['8.8.8.8'])
const page = new URL('https://www.amazon.de/dp/B0DRFRJPWY')

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, { ...init, headers: { 'content-type': 'text/html;charset=UTF-8', ...init.headers } })
}

const captchaPage = `<!doctype html><html lang="de"><head><title dir="ltr">Amazon.de</title>
<meta name="description" content="Amazon.de: Bot check"></head><body>
<!-- Um über den automatisierten Zugriff auf Amazon-Daten zu sprechen, wenden Sie sich bitte an api-services-support@amazon.com. -->
<div class="a-row a-text-center"><img src="https://images-na.ssl-images-amazon.com/captcha/abc/Captcha_xyz.jpg"></div>
<form method="get" action="/errors/validateCaptcha" name=""><input type=hidden name="amzn" value="x" />
<h4>Geben Sie die Zeichen unten ein</h4><p class="a-last">Wir bitten um Entschuldigung!</p></form></body></html>`

afterEach(() => {
  publicResolver.mockClear()
})

describe('Amazon URLs', () => {
  it.each([
    ['https://www.amazon.de/-/en/eufy-Saugroboter-automatischer/dp/B0DRFRJPWY/ref=sr_1_1?crid=2X&keywords=eufy&sr=8-1', 'https://www.amazon.de/dp/B0DRFRJPWY'],
    ['https://www.amazon.de/-/en/dp/B0DRFRJPWY/ref=sr_1_1', 'https://www.amazon.de/dp/B0DRFRJPWY'],
    ['https://amazon.de/dp/b0drfrjpwy?th=1&psc=1#customerReviews', 'https://www.amazon.de/dp/B0DRFRJPWY'],
    ['https://www.amazon.de/gp/product/B0DSZJKXBC/ref=ox_sc_act_title_1?smid=A3JWKAKR8XB7XF', 'https://www.amazon.de/dp/B0DSZJKXBC'],
    ['https://www.amazon.de/gp/aw/d/B0DWKBMSWG/?tag=affiliate-21', 'https://www.amazon.de/dp/B0DWKBMSWG'],
    ['http://www.amazon.co.uk/Echo-Dot/dp/product/B07PHPXHQS/', 'https://www.amazon.co.uk/dp/B07PHPXHQS'],
    ['https://www.amazon.com.be/dp/3442267811', 'https://www.amazon.com.be/dp/3442267811'],
    ['https://WWW.AMAZON.FR./dp/B07PHPXHQS', 'https://www.amazon.fr/dp/B07PHPXHQS'],
  ])('canonicalises %s', (input, expected) => {
    expect(canonicalAmazonUrl(new URL(input))?.href).toBe(expected)
  })

  it.each([
    'https://www.amazon.de/s?k=saugroboter',
    'https://www.amazon.de/dp/B0DRFRJPW',
    'https://www.amazon.de/dp/B0DRFRJPWY1',
    'https://www.amazon.de/stores/page/B0DRFRJPWY',
    'https://amazon.shop.example/dp/B0DRFRJPWY',
    'https://www.amazon.de.shop.example/dp/B0DRFRJPWY',
    'https://www.notamazon.de/dp/B0DRFRJPWY',
    'https://www.amazon.at/dp/B0DRFRJPWY',
    'https://amzn.eu/d/abc1234',
  ])('leaves non-product or non-Amazon URLs alone: %s', (input) => {
    expect(canonicalAmazonUrl(new URL(input))).toBeUndefined()
  })

  it('detects storefront hosts only', () => {
    expect(['www.amazon.de', 'amazon.com', 'www.amazon.co.uk', 'www.amazon.se', 'www.amazon.pl'].every(isAmazonHost)).toBe(true)
    expect(['amzn.eu', 'a.co', 'www.amazon.at', 'amazon.example', 'images-eu.ssl-images-amazon.com'].some(isAmazonHost)).toBe(false)
    expect(amazonAsin(new URL('https://www.amazon.de/x/y/z'))).toBeUndefined()
  })
})

describe('Amazon product pages', () => {
  it.each([
    ['B0DRFRJPWY', 'eufy Anker Saugroboter C10 mit automatischer Entleerung', 18600, 'https://m.media-amazon.com/images/I/61KSD1j4SVL._AC_SL1500_.jpg', 'eufy', 'Schwarz'],
    ['B0DSZJKXBC', 'roborock Q10 S5-Set Saugroboter mit Wischfunktion, 10.000 Pa Saugkraft', 10999, 'https://m.media-amazon.com/images/I/61CbfKNys6L._AC_SL1500_.jpg', 'roborock', 'Schwarz'],
    ['B0DWKBMSWG', 'roborock Q10 S5+ Set Saugroboter mit Wischfunktion, 10.000 Pa Saugkraft', 20999, 'https://m.media-amazon.com/images/I/6166RYqGJwL._AC_SL1500_.jpg', 'roborock', 'Schwarz'],
  ])('reads %s', (asin, title, price, image, brand, color) => {
    const result = extractAmazon(fixture(asin), new URL(`https://www.amazon.de/dp/${asin}`))
    expect(result).toMatchObject({
      site: 'Amazon', title, price_cents: price, currency: 'EUR', partial: false, image_url: image, brand, color, gtin: null,
    })
    expect(result.description).toContain(' · ')
    expect(result.description!.length).toBeLessThanOrEqual(500)
  })

  it('joins the first feature bullets as the description', () => {
    expect(extractAmazon(fixture('B0DSZJKXBC'), page).description).toMatch(
      /^HyperForce-Saugkraft: Mit einer beeindruckenden Saugleistung von 10\.000 Pa .* · Dual Anti-Verwirrungs-Design: /,
    )
  })

  it('returns no price for an unavailable product, but everything else', () => {
    expect(extractAmazon(fixture('B07PHPXHQS'), new URL('https://www.amazon.de/dp/B07PHPXHQS'))).toMatchObject({
      site: 'Amazon',
      title: 'Echo Dot (3. Gen.) Intelligenter Lautsprecher mit Alexa, Anthrazit Stoff',
      price_cents: null,
      currency: null,
      partial: false,
      image_url: 'https://m.media-amazon.com/images/I/61nauJ7wsEL._AC_SL1000_.jpg',
      brand: 'Amazon',
      color: 'Anthrazit Stoff',
    })
  })

  it('takes the buy-box price, never other variants from the twister JSON or carousels', () => {
    const html = `<head><title>Lampe : Amazon.de: Küche</title></head>
      <script>var twister = {"priceAmount":149.90,"currencySymbol":"€","asin":"B0OTHER001"}</script>
      <div data-a-carousel="{&quot;html&quot;:&quot;&lt;span class=\\&quot;a-offscreen\\&quot;&gt;149,90 €&lt;/span&gt;&quot;}"></div>
      <div class="a-carousel"><span class="a-price"><span class="a-offscreen">12,74€</span></span></div>
      <span id="productTitle">Lampe</span>
      <div id="corePriceDisplay_desktop_feature_div" data-csa-c-slot-id="corePriceDisplay_desktop_feature_div">
        <span class="aok-offscreen"> 186,00&nbsp;&euro; mit 53 Prozent Einsparungen </span>
        <span class="a-price aok-align-center priceToPay apex-pricetopay-value"><span class="a-offscreen"> </span><span aria-hidden="true"><span class="a-price-whole">1.186<span class="a-price-decimal">,</span></span><span class="a-price-fraction">50</span><span class="a-price-symbol">€</span></span></span>
        <span class="a-price a-text-price apex-basisprice-value" data-a-strike="true"><span class="a-offscreen">1.399,00€</span></span>
      </div>`
    expect(extractAmazon(html, page).price_cents).toBe(118650)
  })

  it('skips strike-through list prices and non-euro prices', () => {
    const block = (inner: string) => `<span id="productTitle">Lampe</span><div id="corePrice_feature_div">${inner}</div>`
    expect(extractAmazon(block('<span class="a-price" data-a-strike="true"><span class="a-offscreen">399,00€</span></span><span class="a-price"><span class="a-offscreen">186,00 €</span></span>'), page).price_cents).toBe(18600)
    expect(extractAmazon(block('<span class="a-price apex-pricetopay-value"><span class="a-offscreen">$19.99</span></span><span class="a-price"><span class="a-offscreen">18,00 €</span></span>'), page).price_cents).toBeNull()
    expect(extractAmazon(block('<span class="a-price a-text-price"><span class="a-offscreen">2,99 €/kg</span></span>'), page).price_cents).toBeNull()
    expect(extractAmazon(block('<span class="a-price"><span class="a-offscreen">19,99</span></span>'), page).price_cents).toBeNull()
    expect(extractAmazon(block('<span class="a-color-price">Derzeit nicht verfügbar.</span>'), page).price_cents).toBeNull()
  })

  it('cleans the <title> when there is no #productTitle', () => {
    expect(extractAmazon('<title>Lampe Nova | warm : Amazon.de: Küche, Haushalt &amp; Wohnen</title>', page).title).toBe('Lampe Nova | warm')
    expect(extractAmazon('<title>Amazon.com: Echo Dot : Amazon Devices &amp; Accessories</title>', page).title).toBe('Echo Dot')
    expect(extractAmazon('<title>Amazon.de</title>', page)).toMatchObject({ title: null, partial: true, site: 'Amazon' })
  })

  it('falls back to the meta description without the "Amazon.de: <category> - " prefix and title repeats', () => {
    const html = `<title>Lampe Nova mit Dimmer : Amazon.de: Beleuchtung</title>
      <meta name="description" content="Amazon.de: Beleuchtung online - Lampe Nova mit Dimmer. Lampe Nova mit Dimmer. Warmes Licht für den Abend.">`
    expect(extractAmazon(html, page).description).toBe('Warmes Licht für den Abend.')
    const onlyTitle = `<title>Lampe Nova mit Dimmer : Amazon.de: Beleuchtung</title>
      <meta name="description" content="Amazon.de: Beleuchtung online - Lampe Nova mit Dimmer. Lampe Nova mit Dimmer.">`
    expect(extractAmazon(onlyTitle, page).description).toBeNull()
  })

  it.each([
    ['Besuche den eufy-Store', 'eufy'],
    ['Visit the Anker Store', 'Anker'],
    ['Marke: Amazon', 'Amazon'],
    ['Brand: LEGO', 'LEGO'],
    ['Visiter la boutique Philips', 'Philips'],
    ['Visita lo Store di Bialetti', 'Bialetti'],
    ['Visita la tienda de Cecotec', 'Cecotec'],
  ])('reads the brand from the byline "%s"', (byline, brand) => {
    expect(extractAmazon(`<span id="productTitle">X</span><a id="bylineInfo" href="/s">${byline}</a>`, page).brand).toBe(brand)
  })

  it('reads brand, colour and EAN from the details when the byline is unknown', () => {
    const html = `<span id="productTitle">Buch</span><a id="bylineInfo">von Autor (Autor)</a>
      <div id="detailBullets_feature_div"><ul>
        <li><span class="a-list-item"><span class="a-text-bold">Marke &rlm; : &lrm;</span><span>Nova</span></span></li>
        <li><span class="a-list-item"><span class="a-text-bold">Farbe &rlm; : &lrm;</span><span>Sand</span></span></li>
        <li><span class="a-list-item"><span class="a-text-bold">EAN &rlm; : &lrm;</span><span>4006381333931, 4006381333948</span></span></li>
      </ul></div>`
    expect(extractAmazon(html, page)).toMatchObject({ brand: 'Nova', color: 'Sand', gtin: '4006381333931' })
    expect(extractAmazon('<span id="productTitle">X</span><a id="bylineInfo">von Autor (Autor)</a>', page)).toMatchObject({ brand: null, gtin: null })
  })

  it('reads the selected colour of the classic variation block', () => {
    const html = '<span id="productTitle">X</span><div id="variation_color_name"><label>Farbe:</label> <span class="selection">Salbei &amp; Grün</span></div>'
    expect(extractAmazon(html, page).color).toBe('Salbei & Grün')
  })

  it('only uses real id attributes, not data-…-id look-alikes', () => {
    const html = '<title>Echt : Amazon.de: X</title><div data-csa-c-slot-id="productTitle">Falsch</div><b class="x"id="productTitle">Auch falsch</b>'
    expect(extractAmazon(html, page).title).toBe('Echt')
  })
})

describe('Amazon pictures', () => {
  const image = (attributes: string) => extractAmazon(`<span id="productTitle">X</span><img ${attributes} id="landingImage">`, page).image_url

  it('reads the largest entry of the entity-encoded data-a-dynamic-image JSON', () => {
    const json = '{&quot;https://m.media-amazon.com/images/I/a._SX355_.jpg&quot;:[355,355],&quot;https://m.media-amazon.com/images/I/a._SX679_.jpg&quot;:[679,679],&quot;https://m.media-amazon.com/images/I/a._SX466_.jpg&quot;:[466,466]}'
    expect(image(`data-old-hires="" data-a-dynamic-image="${json}"`)).toBe('https://m.media-amazon.com/images/I/a._SX679_.jpg')
  })

  it('allows only https pictures from Amazon image hosts', () => {
    const json = '{&quot;https://evil.example/huge.jpg&quot;:[3000,3000],&quot;https://images-eu.ssl-images-amazon.com/images/I/b.jpg&quot;:[500,500]}'
    expect(image(`data-old-hires="https://evil.example/x.jpg" data-a-dynamic-image="${json}"`)).toBe('https://images-eu.ssl-images-amazon.com/images/I/b.jpg')
    expect(image('data-old-hires="http://m.media-amazon.com/images/I/c.jpg" src="https://m.media-amazon.com.evil.example/c.jpg"')).toBeNull()
    expect(image('data-old-hires="javascript:alert(1)" src="data:image/png;base64,AAAA"')).toBeNull()
    expect(image('data-a-dynamic-image="{not json"')).toBeNull()
    expect(image('src="https://m.media-amazon.com/images/I/d._SX300_.jpg"')).toBe('https://m.media-amazon.com/images/I/d._SX300_.jpg')
  })
})

describe('Amazon robot checks', () => {
  it('recognises the captcha page and never returns its title or picture', () => {
    expect(isAmazonRobotCheck(captchaPage)).toBe(true)
    expect(extractAmazon(captchaPage, page)).toEqual({
      site: 'Amazon', title: null, price_cents: null, currency: null, partial: true,
      image_url: null, description: null, brand: null, color: null, gtin: null,
    })
    expect(isAmazonRobotCheck('<title>Amazon.com</title><h4>Enter the characters you see below</h4>')).toBe(true)
  })

  it('does not mistake a product page that mentions validateCaptcha for a robot check', () => {
    expect(isAmazonRobotCheck(`<script>var u = "/errors/validateCaptcha"</script>${fixture('B0DSZJKXBC')}`)).toBe(false)
    expect(isAmazonRobotCheck(fixture('B07PHPXHQS'))).toBe(false)
  })
})

describe('Amazon early stop', () => {
  it('is complete only with title, picture, buy-box price and the whole bullet list', () => {
    const html = fixture('B0DRFRJPWY')
    const progress = createAmazonProgress()
    const bulletsEnd = html.indexOf('</ul>', html.indexOf('id="feature-bullets"'))
    expect(progress(html.slice(0, bulletsEnd))).toBe(false)
    expect(progress(html)).toBe(true)
    // Unavailable product: no price, so the reader keeps going up to its cap.
    expect(createAmazonProgress()(fixture('B07PHPXHQS'))).toBe(false)
  })
})

describe('Amazon link previews', () => {
  it('fetches the canonical German URL for Felix-style links and answers with it', async () => {
    const fetch = vi.fn(async () => htmlResponse(fixture('B0DRFRJPWY'))) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    const result = await preview('https://www.amazon.de/-/en/dp/B0DRFRJPWY/ref=sr_1_1?keywords=x#reviews', ownHost, subject)
    expect(result).toMatchObject({
      url: 'https://www.amazon.de/dp/B0DRFRJPWY', site: 'Amazon',
      title: 'eufy Anker Saugroboter C10 mit automatischer Entleerung', price_cents: 18600, currency: 'EUR',
      partial: false, image_url: 'https://m.media-amazon.com/images/I/61KSD1j4SVL._AC_SL1500_.jpg', brand: 'eufy', color: 'Schwarz',
    })
    const [url, options] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://www.amazon.de/dp/B0DRFRJPWY')
    // Same fixed, non-identifying headers as for every shop; German page via Accept-Language.
    expect(Object.fromEntries(new Headers(options?.headers))).toEqual({
      accept: 'text/html',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
    })
    // Another tracking variant of the same product hits the cache.
    await preview('https://www.amazon.de/gp/product/B0DRFRJPWY?tag=x-21', ownHost, subject)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('follows a short link with DNS checks on every hop and canonicalises the final host', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://www.amazon.de/-/en/dp/B0DSZJKXBC/ref=cm_sw_r_cp_ud?tag=share-21' } }))
      .mockResolvedValueOnce(htmlResponse(fixture('B0DSZJKXBC'))) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://amzn.eu/d/aBcD123', ownHost, subject)
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['https://amzn.eu/d/aBcD123', 'https://www.amazon.de/dp/B0DSZJKXBC'])
    expect(publicResolver.mock.calls.map(([host]) => host)).toEqual(['amzn.eu', 'www.amazon.de'])
    expect(result).toMatchObject({ url: 'https://www.amazon.de/dp/B0DSZJKXBC', site: 'Amazon', price_cents: 10999 })
  })

  it('still blocks a short link that redirects to a private address', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.7/dp/B0DSZJKXBC' } })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://a.co/d/xyz', ownHost, subject)).rejects.toMatchObject({ code: 'blocked_target' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not loop when Amazon redirects the canonical URL to a variant of itself', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/-/de/dp/B0DWKBMSWG?th=1' } }))
      .mockResolvedValueOnce(htmlResponse(fixture('B0DWKBMSWG'))) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://www.amazon.de/dp/B0DWKBMSWG', ownHost, subject)
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe('https://www.amazon.de/-/de/dp/B0DWKBMSWG?th=1')
    expect(result).toMatchObject({ url: 'https://www.amazon.de/dp/B0DWKBMSWG', price_cents: 20999 })
  })

  it.each([
    ['a captcha page (HTTP 200)', () => htmlResponse(captchaPage)],
    ['HTTP 503', () => htmlResponse(captchaPage, { status: 503 })],
  ])('answers a robot check as %s calmly and does not cache it', async (_name, response) => {
    const fetch = vi.fn(async () => response()) as Fetch
    const preview = createLinkPreview({ fetch, resolve: publicResolver })
    const expected = {
      url: 'https://www.amazon.de/dp/B0DRFRJPWY', site: 'Amazon', title: null, price_cents: null, currency: null,
      partial: true, image_url: null, description: null, brand: null, color: null, gtin: null,
    }
    await expect(preview('https://www.amazon.de/-/en/x/dp/B0DRFRJPWY/ref=sr_1_1', ownHost, subject)).resolves.toEqual(expected)
    await expect(preview('https://www.amazon.de/dp/B0DRFRJPWY', ownHost, subject)).resolves.toEqual(expected)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps HTTP 503 of other shops an error', async () => {
    const fetch = vi.fn(async () => htmlResponse('busy', { status: 503 })) as Fetch
    await expect(createLinkPreview({ fetch, resolve: publicResolver })('https://shop.example/p', ownHost, subject)).rejects.toMatchObject({ code: 'fetch_failed' })
  })

  it('stops reading as soon as title, picture, price and bullets have arrived', async () => {
    const cancel = vi.fn()
    let pulls = 0
    const head = new TextEncoder().encode(fixture('B0DRFRJPWY'))
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(pulls === 1 ? head : new Uint8Array(64 * 1024).fill(120))
      },
      cancel,
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://www.amazon.de/dp/B0DRFRJPWY', ownHost, subject)
    expect(result.price_cents).toBe(18600)
    expect(pulls).toBeLessThanOrEqual(3)
    expect(cancel).toHaveBeenCalled()
  })

  it('reads at most 1.5 MiB of an Amazon page (more than the 1 MiB of other shops)', async () => {
    const cancel = vi.fn()
    let delivered = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = delivered === 0
          ? new TextEncoder().encode('<html><head><title>Lampe Nova : Amazon.de: Kueche</title></head><body>'.padEnd(64 * 1024, ' '))
          : new Uint8Array(64 * 1024).fill(120)
        delivered += chunk.byteLength
        if (delivered > 1.25 * 1024 * 1024 && delivered <= 1.25 * 1024 * 1024 + 64 * 1024) {
          controller.enqueue(new TextEncoder().encode('<span id="productTitle">Lampe Nova Pro</span>'.padEnd(64 * 1024, ' ')))
        } else controller.enqueue(chunk)
      },
      cancel,
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as Fetch
    const result = await createLinkPreview({ fetch, resolve: publicResolver })('https://www.amazon.de/dp/B0DRFRJPWY', ownHost, subject)
    expect(result).toMatchObject({ title: 'Lampe Nova Pro', price_cents: null, partial: false })
    // The stream may pre-pull one chunk beyond what the reader consumed.
    expect(delivered).toBeLessThanOrEqual(AMAZON_MAX_HTML_BYTES + 2 * 64 * 1024)
    expect(delivered).toBeGreaterThan(1024 * 1024)
    expect(cancel).toHaveBeenCalled()
  })
})
