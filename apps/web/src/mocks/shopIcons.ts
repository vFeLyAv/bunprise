import { delay, http, HttpResponse } from 'msw'
import { shopIconHost } from '../lib/api/shopIcon'
import exampleIcon from './assets/shop-icons/example.png?inline'
import grillhuetteIcon from './assets/shop-icons/grillhuette.png?inline'
import hausundfadenIcon from './assets/shop-icons/hausundfaden.png?inline'
import kuechenkontorIcon from './assets/shop-icons/kuechenkontor.png?inline'
import lichthausIcon from './assets/shop-icons/lichthaus.ico?inline'
import shopIcon from './assets/shop-icons/shop.png?inline'
import { decodeBase64 } from './photos'

// Demo answers of our Worker's GET /api/shop-icon?host=… (docs/demo-mode.md; the real one:
// workers/edge/src/shopIcon.ts). Same contract: the bearer token of a demo session, the same host key (lower case,
// without "www." / "m."), the raw icon bytes with their type, 404 { error: "not_found" } when there is none.
// FICTIONAL and offline: small neutral placeholder icons drawn for this repo (simple shapes — a bowl, a house with a
// thread, a flame, a sun, a bag, a diamond; NO real brand, no trademark) for the demo's own shop domains. Every other
// host — real shops included, e.g. the four "Woanders finden" links — gets 404, so the app keeps its letter tile
// there (the calm fallback the real app shows for shops that block us). No request leaves the browser.
//
//   kuechenkontor.example  terracotta tile with a bowl        (PNG 128 px)
//   hausundfaden.example   house with a thread, transparent   (PNG 128 px — shows the white backing)
//   grillhuette.example    flame on a dark disc               (PNG 128 px)
//   lichthaus.example      sun, transparent                   (ICO with 16 / 32 / 64 px frames, like many favicons)
//   shop.example           bag on a blue tile                 (PNG 128 px)
//   example.com            diamond on a teal tile             (PNG 128 px — the links of the demo world)
//   anything else          404 { error: "not_found" }

export const SHOP_ICON_DELAY_MS = 350

const ICONS: Readonly<Record<string, { dataUrl: string; type: 'image/png' | 'image/x-icon' }>> = {
  'kuechenkontor.example': { dataUrl: kuechenkontorIcon, type: 'image/png' },
  'hausundfaden.example': { dataUrl: hausundfadenIcon, type: 'image/png' },
  'grillhuette.example': { dataUrl: grillhuetteIcon, type: 'image/png' },
  'lichthaus.example': { dataUrl: lichthausIcon, type: 'image/x-icon' },
  'shop.example': { dataUrl: shopIcon, type: 'image/png' },
  'example.com': { dataUrl: exampleIcon, type: 'image/png' },
}

/** The demo shop domains that have an icon. */
export const DEMO_SHOP_ICON_HOSTS: readonly string[] = Object.keys(ICONS)

export interface ShopIconHandlerOptions {
  /** the demo account this request's bearer token belongs to; null = none (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delay */
  delayMs?: number
}

/** The fixture answer for one `?host=` value (pure; the handler adds auth and the delay). */
export function demoShopIcon(raw: string | null): { status: 200; bytes: Uint8Array; type: 'image/png' | 'image/x-icon' } | { status: 400 | 404; error: string } {
  const key = shopIconHost(raw)
  if (!key) return { status: 400, error: 'invalid_request' }
  const icon = Object.hasOwn(ICONS, key) ? ICONS[key] : undefined
  const bytes = icon ? decodeBase64(icon.dataUrl.slice(icon.dataUrl.indexOf(',') + 1)) : null
  if (!icon || !bytes) return { status: 404, error: 'not_found' }
  return { status: 200, bytes, type: icon.type }
}

export function createShopIconHandlers({ viewerOf, delayMs = SHOP_ICON_DELAY_MS }: ShopIconHandlerOptions) {
  const fail = (error: string, status: number) => HttpResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
  return [
    http.get('/api/shop-icon', async ({ request }) => {
      if (viewerOf(request) === null) return fail('unauthorized', 401)
      const answer = demoShopIcon(new URL(request.url).searchParams.get('host'))
      if (answer.status !== 400 && delayMs > 0) await delay(delayMs)
      if (answer.status !== 200) return fail(answer.error, answer.status)
      return new HttpResponse(answer.bytes.slice().buffer, {
        status: 200,
        headers: {
          'Content-Type': answer.type,
          'Content-Length': String(answer.bytes.byteLength),
          'Cache-Control': 'private, max-age=604800',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }),
  ]
}
