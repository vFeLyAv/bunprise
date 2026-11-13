import { delay, http, HttpResponse } from 'msw'

// Demo answers of our Worker's POST /api/link-preview (docs/demo-mode.md). Deterministic and FICTIONAL:
// reserved example domains only, no request ever leaves the browser. The Worker itself (workers/edge) is
// built separately; this mock follows the same contract (request body, answer shape, error codes).
//
//   link contains "kaffeemuehle" → the FULL product (2026-10-22 contract): title, 49,90 €, shop "Küchenkontor",
//                                 image_url (→ the demo picture of POST /api/link-image, mocks/linkImage.ts),
//                                 description, brand, colour, GTIN
//   link contains "kopfhoerer"   → "Kabellose Kopfhörer", 79,99 €, site "shop.example", details but NO picture
//   link contains "lampe"        → a product whose picture cannot be fetched (its image_url contains "fail" → 502):
//                                 the card keeps the shop's letter tile (the calm fallback)
//   link contains "teapot"       → partial: no title found (the person types it), a price was found
//   link contains "fail"         → 502 { error: "fetch_failed" }
//   anything else                → partial: site = the link's host, no title, no price
// The details are invented (brands, shops); the GTINs use the prefix 200–299 ("for internal use", never a real
// product); the picture addresses are reserved example hosts — the browser never loads them, only our (mocked)
// Worker gets them.
//
// The answer takes a moment (LINK_PREVIEW_DELAY_MS), so the loading state is visible in the demo.

export const LINK_PREVIEW_DELAY_MS = 1100
const URL_MAX = 2048

export interface LinkPreviewHandlerOptions {
  /** the demo account this request's bearer token belongs to; null = none (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delay */
  delayMs?: number
}

export interface DemoPreviewAnswer {
  status: number
  body: Record<string, unknown>
}

/** Query parameters a shop link carries for tracking only (the Worker removes them too). */
function isTrackingParam(name: string): boolean {
  return /^utm_/i.test(name) || ['fbclid', 'gclid', 'mc_eid', 'igshid', 'ref_src'].includes(name.toLowerCase())
}

/** The "cleaned final URL": no fragment, no tracking parameters. Null for anything but http(s). */
export function cleanDemoUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    // a copy of the names: deleting while iterating the live list would skip entries
    for (const name of Array.from(url.searchParams.keys())) if (isTrackingParam(name)) url.searchParams.delete(name)
    return url
  } catch {
    return null
  }
}

/** The fixture answer for one requested link (pure; the handler adds auth, body checks and the delay). */
export function demoLinkPreview(raw: string): DemoPreviewAnswer {
  const url = cleanDemoUrl(raw)
  if (!url) return { status: 400, body: { error: 'invalid_request' } }
  const text = url.toString().toLowerCase()
  if (text.includes('fail')) return { status: 502, body: { error: 'fetch_failed' } }
  const host = url.hostname.replace(/^www\./, '')
  const none = { image_url: null, description: null, brand: null, color: null, gtin: null }
  if (text.includes('kaffeemuehle')) {
    return {
      status: 200,
      body: {
        url: url.toString(), site: 'Küchenkontor', title: 'Handkaffeemühle „Kegel“ aus Buchenholz', price_cents: 4990, currency: 'EUR', partial: false,
        image_url: 'https://img.shop.example/produkte/kaffeemuehle-kegel.webp',
        description: 'Handmühle mit Kegelmahlwerk aus Keramik, stufenlos einstellbar von fein (Espresso) bis grob (French Press). Gehäuse aus geöltem Buchenholz, Schublade für ca. 30 g Kaffee. Leise, ohne Strom und für viele Jahre gebaut – Ersatzteile gibt es einzeln.',
        brand: 'Mahlwerk & Söhne', color: 'Buche natur', gtin: '2001234567800',
      },
    }
  }
  if (text.includes('kopfhoerer')) {
    return {
      status: 200,
      body: {
        url: url.toString(), site: 'shop.example', title: 'Kabellose Kopfhörer', price_cents: 7999, currency: 'EUR', partial: false,
        ...none, description: 'Over-Ear, faltbar, bis zu 30 Stunden Akku.', brand: 'Klangwerk', color: 'Mitternachtsblau', gtin: '2004006381337',
      },
    }
  }
  if (text.includes('lampe')) {
    return {
      status: 200,
      body: {
        url: url.toString(), site: 'Lichthaus', title: 'Leselampe mit Klemme', price_cents: 3490, currency: 'EUR', partial: false,
        ...none, image_url: 'https://img.shop.example/fail/leselampe.webp', brand: 'Lichthaus', color: 'Salbeigrün',
      },
    }
  }
  if (text.includes('teapot')) {
    return { status: 200, body: { url: url.toString(), site: host, title: null, price_cents: 2490, currency: 'EUR', partial: true, ...none } }
  }
  return { status: 200, body: { url: url.toString(), site: host, title: null, price_cents: null, currency: null, partial: true, ...none } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createLinkPreviewHandlers({ viewerOf, delayMs = LINK_PREVIEW_DELAY_MS }: LinkPreviewHandlerOptions) {
  return [
    http.post('/api/link-preview', async ({ request }) => {
      if (viewerOf(request) === null) return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
        return HttpResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return HttpResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      const url = isRecord(input) ? input.url : undefined
      if (typeof url !== 'string' || url.length === 0 || url.length > URL_MAX) {
        return HttpResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      const answer = demoLinkPreview(url)
      // a real fetch of the shop page takes a moment; a malformed request is refused at once
      if (answer.status !== 400 && delayMs > 0) await delay(delayMs)
      return HttpResponse.json(answer.body, { status: answer.status, headers: { 'Cache-Control': 'no-store' } })
    }),
  ]
}
