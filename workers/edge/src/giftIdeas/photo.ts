import { ApiError, withDeadline } from '../http'
import type { Fetch } from '../http'
import { readImage } from '../linkImage'
import type { LinkImage } from '../linkImage'
import { fetchPublic } from '../net/fetchPublic'
import { createResolver, validateUrl } from '../net/ssrf'
import type { Resolver } from '../net/ssrf'
import type { IconStore } from '../shopIcon'
import { CATALOG } from './catalog'
import type { CatalogItem } from './catalog'
import { GIFT_PHOTO_PREFIX, PHOTO_MAX_AGE_S, PHOTO_MAX_BYTES, PHOTO_USER_AGENT } from './photoRules'

// GET /api/gift-ideas/img/<art>/<id> — the real product photo of a catalogue item (Felix 25.10: real photos
// for the closed pilot; docs/handoffs/2026-10-25-catalog-photos.md). An <img> cannot send the access token,
// so this route is open, and that is why it can do almost nothing:
// - it serves ONLY catalogue items that carry an `image_source` (chosen by scripts/catalog-photos.mjs); the
//   request names an item id, never a URL, and any query string is refused — no open proxy;
// - the Worker fetches exactly that stored URL with the SSRF-safe fetcher, and every redirect must stay on the
//   stored host; only raster images (magic bytes = declared type, never SVG), at most 2 MB;
// - fixed request headers (no cookies, no referrer, nothing of the client); fixed response headers;
// - kept at most a day (browser: private, max-age; Worker: the zone's Cache API) — never stored for good.
// The <art> segment is the drawing the app falls back to; it must match the item, so every photo has one URL.

export { GIFT_PHOTO_PREFIX }
const DEADLINE_MS = 8000
const MAX_IN_FLIGHT = 6
const PATH = /^\/api\/gift-ideas\/img\/([a-z0-9-]{1,40})\/([A-Za-z0-9._:%-]{1,96})$/

export interface Photo { source: URL; art: string }

/** The items with a photo, by id (built once per isolate from the bundled catalogue). */
export function photoIndex(items: readonly CatalogItem[] = CATALOG): ReadonlyMap<string, Photo> {
  const index = new Map<string, Photo>()
  for (const item of items) {
    if (!item.image_source) continue
    try {
      const source = new URL(item.image_source)
      if (source.protocol === 'https:' && !source.username && !source.password) index.set(item.id, { source, art: item.art })
    } catch { /* a broken entry keeps its drawing */ }
  }
  return index
}

/** "/api/gift-ideas/img/<art>/<id>" → { art, id }; anything else (also a query string) → invalid_request. */
export function parsePhotoRequest(url: URL): { art: string; id: string } {
  if (url.search !== '') throw new ApiError('invalid_request')
  const match = PATH.exec(url.pathname)
  if (!match?.[1] || !match[2]) throw new ApiError('invalid_request')
  let id: string
  try {
    id = decodeURIComponent(match[2])
  } catch {
    throw new ApiError('invalid_request')
  }
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(id)) throw new ApiError('invalid_request')
  return { art: match[1], id }
}

interface GiftPhotoOptions {
  fetch: Fetch
  resolve?: Resolver
  /** undefined = caches.default when it exists; null = no cache (tests) */
  store?: IconStore | null
  index?: ReadonlyMap<string, Photo>
}

function defaultStore(): IconStore | null {
  try {
    return typeof caches === 'undefined' ? null : caches.default
  } catch {
    return null
  }
}

/** A URL of our own host: the Cache API stores per zone, and nothing outside this module asks for it. */
const storeKey = (ownHost: string, id: string) => `https://${ownHost}/api/gift-ideas/img/__cache/v1/${encodeURIComponent(id)}`

export function createGiftPhoto(options: GiftPhotoOptions) {
  const resolve = options.resolve ?? createResolver(options.fetch)
  const store = options.store === undefined ? defaultStore() : options.store
  const index = options.index ?? photoIndex()
  let inFlight = 0

  async function fromStore(ownHost: string, id: string): Promise<LinkImage | undefined> {
    if (!store) return undefined
    try {
      const cached = await store.match(storeKey(ownHost, id))
      if (!cached) return undefined
      // the stored bytes are checked again like a fresh download (declared type = magic bytes, size cap)
      return await withDeadline(2000, (signal) => readImage(cached, signal, PHOTO_MAX_BYTES))
    } catch {
      return undefined
    }
  }

  async function toStore(ownHost: string, id: string, image: LinkImage): Promise<void> {
    if (!store) return
    try {
      await store.put(storeKey(ownHost, id), new Response(image.bytes.slice(), {
        headers: { 'Content-Type': image.type, 'Cache-Control': `public, max-age=${PHOTO_MAX_AGE_S}` },
      }))
    } catch { /* a full or unavailable cache only costs a refetch */ }
  }

  return async (request: { art: string; id: string }, ownHost: string, parentSignal?: AbortSignal): Promise<LinkImage> => {
    const photo = index.get(request.id)
    if (!photo || photo.art !== request.art) throw new ApiError('not_found')
    const cached = await fromStore(ownHost, request.id)
    if (cached) return cached
    if (inFlight >= MAX_IN_FLIGHT) throw new ApiError('rate_limited', 5)
    inFlight++
    try {
      const image = await withDeadline(DEADLINE_MS, async (signal) => {
        const allowedHost = photo.source.hostname
        const { response } = await fetchPublic(validateUrl(photo.source.href, ownHost), {
          fetch: options.fetch,
          resolve,
          ownHost,
          signal,
          // a redirect may move within the shop's image host, never to another host
          normalize: (url) => {
            if (url.hostname !== allowedHost) throw new ApiError('blocked_target')
            url.hash = ''
            return url
          },
          // No cookies, no referrer, no client headers: only this fixed set reaches the shop.
          headers: { 'user-agent': PHOTO_USER_AGENT, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' },
        })
        return readImage(response, signal, PHOTO_MAX_BYTES)
      }, parentSignal)
      await toStore(ownHost, request.id, image)
      return image
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('fetch_failed')
    } finally {
      inFlight--
    }
  }
}

/** Fixed headers only; nothing of the shop's response is forwarded. The browser may keep it for a day. */
export function giftPhotoResponse(image: LinkImage): Response {
  return new Response(image.bytes.slice(), {
    status: 200,
    headers: {
      'Content-Type': image.type,
      'Content-Length': String(image.bytes.byteLength),
      'Cache-Control': `private, max-age=${PHOTO_MAX_AGE_S}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
