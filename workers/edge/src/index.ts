import { createAuth } from './auth'
import { ApiError, errorResponse, isRecord, json, readBytes, withDeadline } from './http'
import type { Clock, Fetch } from './http'
import { createLinkImage, imageResponse } from './linkImage'
import { createLinkPreview } from './linkPreview'
import type { Resolver } from './net/ssrf'
import { createMapTiles, mapTileResponse, parseTileRequest } from './mapTile'
import { createPlaces, parsePlaceQuery, withoutPoints } from './places'
import { createRateLimiter } from './rateLimit'
import type { Endpoint } from './rateLimit'
import { createShopIcon, parseShopHost, shopIconResponse } from './shopIcon'
import { answerCatalog, topicCounts } from './giftIdeas/catalog'
import { createGiftPhoto, GIFT_PHOTO_PREFIX, giftPhotoResponse, parsePhotoRequest } from './giftIdeas/photo'
import type { Photo } from './giftIdeas/photo'
import { readGiftIdeasRequest } from './giftIdeas/request'
import type { IconStore } from './shopIcon'
import { createPush } from './push/send'
import type { PushEnv, PushLogEntry } from './push/send'
import { CALENDAR_PREFIX, calendarFeedOn, createCalendarFeed, parseFeedPath } from './calendar/feed'
import type { CalendarEnv } from './calendar/feed'
import { createInviteEmail, EMAIL_SEND_PATH, UNSUBSCRIBE_PREFIX } from './email/send'
import type { EmailEnv, EmailLogEntry } from './email/send'

/** PushEnv: Web Push (src/push/send.ts) — three secrets, unset = /api/push/* answer 501 (docs/handoffs/2026-10-27-web-push.md). */
/** CalendarEnv: the Kalender-Abo (src/calendar/feed.ts) — CALENDAR_FEED = "on" + SUPABASE_PUBLISHABLE_KEY, else 501. */
/** EmailEnv: the invitation e-mail (src/email/send.ts) — BREVO_API_KEY (set by Felix only) + PUSH_DISPATCH_SECRET, else 501. */
export interface Env extends PushEnv, CalendarEnv, EmailEnv {
  ASSETS: Pick<Fetcher, 'fetch'>
  SUPABASE_URL: string
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> }
  /** "catalog" switches on our own product catalogue for /api/gift-ideas; unset = 501 (the app shows its demo) */
  GIFT_IDEAS_SOURCES?: string
  /** "osm" switches on the place thumbnail: /api/places adds each place's point, /api/map-tile serves OpenStreetMap
   *  tiles (mapTile.ts). Unset = no points, map-tile 501 (the app shows no map). Only together with the privacy text
   *  that describes it (docs/legal-drafts/pilot-5-notes.md). */
  MAP_TILES?: string
}

interface LogEntry { endpoint: string; status: number; duration: number }
interface Dependencies {
  fetch?: Fetch
  resolve?: Resolver
  now?: Clock
  log?: (entry: LogEntry) => void
  /** shop icons: undefined = caches.default when it exists, null = memory only */
  iconStore?: IconStore | null
  /** catalogue photos: undefined = caches.default when it exists, null = no cache */
  photoStore?: IconStore | null
  /** catalogue photos by item id (tests); default = the bundled catalogue */
  photoIndex?: ReadonlyMap<string, Photo>
  /** map tiles: undefined = caches.default when it exists, null = memory only */
  tileStore?: IconStore | null
}

const routes: Readonly<Record<string, { endpoint: Endpoint; method: 'GET' | 'POST' }>> = {
  '/api/link-preview': { endpoint: 'link-preview', method: 'POST' },
  '/api/link-image': { endpoint: 'link-image', method: 'POST' },
  '/api/places': { endpoint: 'places', method: 'GET' },
  '/api/shop-icon': { endpoint: 'shop-icon', method: 'GET' },
  '/api/gift-ideas': { endpoint: 'gift-ideas', method: 'POST' },
  '/api/map-tile': { endpoint: 'map-tile', method: 'GET' },
}

/** Body `{ "url": string }` of link-preview and link-image: JSON, at most 4 KiB. */
async function readUrlBody(req: Request): Promise<string> {
  const contentType = req.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new ApiError('invalid_request')
  const bytes = await withDeadline(5000, (signal) => readBytes(req, 4096, signal))
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch {
    throw new ApiError('invalid_request')
  }
  if (!isRecord(body) || typeof body.url !== 'string') throw new ApiError('invalid_request')
  return body.url
}

export function createWorker(deps: Dependencies = {}) {
  const fetcher: Fetch = deps.fetch ?? ((input, init) => fetch(input, init))
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((entry: LogEntry) => { console.log(JSON.stringify(entry)) })
  const authenticate = createAuth({ fetch: fetcher, now })
  const rateLimit = createRateLimiter({ now })
  const preview = createLinkPreview({ fetch: fetcher, now, resolve: deps.resolve })
  const image = createLinkImage({ fetch: fetcher, resolve: deps.resolve })
  const places = createPlaces({ fetch: fetcher, now })
  const icons = createShopIcon({ fetch: fetcher, now, resolve: deps.resolve, store: deps.iconStore })
  const photos = createGiftPhoto({ fetch: fetcher, resolve: deps.resolve, store: deps.photoStore, index: deps.photoIndex })
  const tiles = createMapTiles({ fetch: fetcher, now, store: deps.tileStore })
  // Web Push: the database's signed batches (POST /api/push/send) and the public VAPID key (GET /api/push/key)
  const push = createPush({ fetch: fetcher, now, log: (entry: PushLogEntry) => log(entry) })
  // Kalender-Abo: GET /api/calendar/<token>.ics for calendar apps (no sign-in: the token is the permission)
  const calendarFeed = createCalendarFeed({ fetch: fetcher, now })
  // the invitation e-mail: the database's signed batches (POST /api/email/send -> Brevo) and the unsubscribe page
  const inviteEmail = createInviteEmail({
    fetch: fetcher, now, log: (entry: EmailLogEntry) => log(entry),
    limit: (subject, ip, binding) => rateLimit('email-unsubscribe', subject, ip, binding),
  })
  const catalogOn = (env: Env) => (env.GIFT_IDEAS_SOURCES ?? '').split(',').map((source) => source.trim()).includes('catalog')
  const mapOn = (env: Env) => env.MAP_TILES?.trim() === 'osm'

  /** GET /api/gift-ideas/img/<art>/<id>: open (an <img> has no token), so only catalogue photos (photo.ts). */
  async function photoRoute(req: Request, url: URL, env: Env): Promise<Response> {
    const endpoint: Endpoint = 'gift-photo'
    const started = now()
    let response: Response
    try {
      if (req.method !== 'GET') throw new ApiError('method_not_allowed')
      if (!catalogOn(env)) throw new ApiError('not_found')
      const request = parsePhotoRequest(url)
      const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
      // no person behind it: the address is the only key (the "user" bucket counts the same address)
      await rateLimit(endpoint, `ip:${ip}`, ip, env.RATE_LIMITER)
      response = giftPhotoResponse(await photos(request, url.hostname, req.signal))
    } catch (error) {
      response = errorResponse(error instanceof ApiError ? error : new ApiError('fetch_failed'))
    }
    // Do not include exception objects, URLs, item ids, IPs, or identities.
    log({ endpoint, status: response.status, duration: Math.max(0, now() - started) })
    return response
  }

  /** GET /api/calendar/<token>.ics: no Supabase session (a calendar app has none), so the token is the key of the
   *  "user" bucket — hashed first: the token itself is never a map key, a log field or a cache key. */
  async function calendarRoute(req: Request, url: URL, env: Env): Promise<Response> {
    const endpoint: Endpoint = 'calendar-feed'
    const started = now()
    let response: Response
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError('method_not_allowed')
      if (!calendarFeedOn(env)) throw new ApiError('not_available')
      const token = parseFeedPath(url.pathname)
      if (token === null) throw new ApiError('not_found')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`calendar:${token}`))
      const subject = Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
      await rateLimit(endpoint, subject, req.headers.get('CF-Connecting-IP') ?? 'unknown', env.RATE_LIMITER)
      response = await calendarFeed(token, url.origin, env, req.signal)
      if (req.method === 'HEAD') response = new Response(null, { status: response.status, headers: response.headers })
    } catch (error) {
      response = errorResponse(error instanceof ApiError ? error : new ApiError('upstream_unavailable'))
    }
    // Do not include exception objects, URLs, tokens, IPs, or identities.
    log({ endpoint, status: response.status, duration: Math.max(0, now() - started) })
    return response
  }

  async function handle(endpoint: Endpoint, req: Request, url: URL, sub: string, env: Env): Promise<Response> {
    if (endpoint === 'gift-ideas') {
      if (!catalogOn(env)) {
        throw new ApiError('not_available')
      }
      // the token only counted for the rate limit: nothing of the person is used to pick the ideas
      const request = await readGiftIdeasRequest(req)
      const answer = answerCatalog(request)
      // the first page of a deck also names the shelves of "Stöbern nach Thema" (their sizes: the app shows ≥ 8)
      return json(request.topic === undefined && request.start === undefined ? { ...answer, topics: topicCounts() } : answer)
    }
    if (endpoint === 'link-preview') return json(await preview(await readUrlBody(req), url.hostname, sub, req.signal))
    if (endpoint === 'link-image') return imageResponse(await image(await readUrlBody(req), url.hostname, req.signal))
    if (endpoint === 'shop-icon') {
      return shopIconResponse(await icons(parseShopHost(url.searchParams.get('host'), url.hostname), url.hostname, req.signal))
    }
    if (endpoint === 'map-tile') {
      if (!mapOn(env)) throw new ApiError('not_available')
      return mapTileResponse(await tiles(parseTileRequest(url), url.origin, req.signal))
    }
    const found = await places(parsePlaceQuery(url), sub)
    // the points leave the Worker only while the thumbnail (and the privacy text describing it) is switched on
    return json(mapOn(env) ? found : withoutPoints(found))
  }

  return {
    async fetch(req: Request, env: Env): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname
      if (path === '/api/health') return json({ ok: true })
      if (path === '/api/push/send') return push.send(req, env)
      if (path === '/api/push/key') return push.key(req, env)
      if (path === EMAIL_SEND_PATH) return inviteEmail.send(req, env)
      if (path.startsWith(UNSUBSCRIBE_PREFIX)) return inviteEmail.unsubscribe(req, env)
      if (path.startsWith(GIFT_PHOTO_PREFIX)) return photoRoute(req, url, env)
      if (path.startsWith(CALENDAR_PREFIX)) return calendarRoute(req, url, env)
      const route = Object.hasOwn(routes, path) ? routes[path] : undefined
      if (!route) {
        if (path.startsWith('/api/')) return new Response('not found', { status: 404 })
        return env.ASSETS.fetch(req)
      }
      const { endpoint } = route
      const started = now()
      let response: Response
      try {
        if (req.method !== route.method) throw new ApiError('method_not_allowed')
        const sub = await authenticate(req, env.SUPABASE_URL)
        await rateLimit(endpoint, sub, req.headers.get('CF-Connecting-IP') ?? 'unknown', env.RATE_LIMITER)
        response = await handle(endpoint, req, url, sub, env)
      } catch (error) {
        response = errorResponse(error instanceof ApiError ? error
          : new ApiError(endpoint === 'places' || endpoint === 'gift-ideas' || endpoint === 'map-tile' ? 'upstream_unavailable' : 'fetch_failed'))
      }
      // Do not include exception objects, URLs, search terms, IPs, or identities.
      log({ endpoint, status: response.status, duration: Math.max(0, now() - started) })
      return response
    },
  }
}

export default createWorker() satisfies ExportedHandler<Env>
