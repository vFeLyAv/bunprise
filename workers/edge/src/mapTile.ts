import { ApiError, readBytes, withDeadline } from './http'
import type { Clock, Fetch } from './http'
import { imageDimensions } from './shopIcon'
import type { IconStore } from './shopIcon'

// GET /api/map-tile?z=<zoom>&x=<column>&y=<row> — ONE standard OpenStreetMap map tile, fetched by OUR Worker, for the
// small map thumbnail next to a chosen place in the occasion form (docs/handoffs/2026-10-27-place-minimap.md).
// The user's device never contacts OpenStreetMap: the app loads these bytes with its access token and shows them as a
// blob: URL (like the shop icons). Switched on only by MAP_TILES=osm (index.ts), together with the privacy text.
//
// OSMF tile usage policy (operations.osmfoundation.org/policies/tiles, read 26.10.2026), how we follow it:
// - a distinct, stable User-Agent naming the app with a contact, and an accurate Referer (our own origin, no path);
// - only tiles a person is looking at right now (no prefetching, no other zooms "just in case"): the app asks for the
//   1–4 tiles under one 44 px thumbnail, z 11–16 only;
// - caching honours the server's headers: a tile is fresh for its max-age (7 days when it sends none), an expired one
//   is asked again with If-None-Match / If-Modified-Since (a 304 refreshes it), within 7 days of expiry it is served
//   from our copy when OSM is unreachable (stale-if-error); copies live in memory and in the Cache API;
//   we never send no-cache headers;
// - attribution "© OpenStreetMap" next to the thumbnail (the app); nothing about the person is sent: no token, no
//   cookies, no client IP, no user agent of the device — only z/x/y, which describe the place, not who asked.

export interface TileKey {
  z: number
  x: number
  y: number
}

/** Zoom levels the app uses (a town around z 11, a café around z 15); anything else is invalid_request. */
export const MAP_TILE_MIN_ZOOM = 11
export const MAP_TILE_MAX_ZOOM = 16
/** A standard tile is 256 × 256 px, usually 5–60 KiB. */
export const MAX_TILE_BYTES = 256 * 1024
const TILE_PX = 256
const UPSTREAM = 'https://tile.openstreetmap.org'
export const MAP_TILE_USER_AGENT = 'Bunprise/0.1 (map thumbnails of a small private pilot; +https://bunprise.de; hello@bunprise.de)'
const FETCH_MS = 4000
/** Without a usable max-age the policy asks for at least 7 days. */
const DEFAULT_FRESH_S = 7 * 24 * 60 * 60
const MIN_FRESH_S = 5 * 60
const MAX_FRESH_S = 30 * 24 * 60 * 60
/** stale-if-error: an expired copy may stand in this long when OSM does not answer (OSM itself sends 604800). */
const STALE_IF_ERROR_MS = 7 * 24 * 60 * 60 * 1000
/** How long the Cache API keeps a copy (so an expired tile can still be revalidated instead of downloaded). */
const STORE_KEEP_S = 60 * 24 * 60 * 60
const MEMORY_BYTES = 4 * 1024 * 1024
const MEMORY_ENTRIES = 512
/** Distinct tiles fetched at the same time per isolate; more → 429 Retry-After 2. */
const MAX_PENDING = 16
const FRESH_HEADER = 'x-bunprise-fresh-until'
const ETAG_HEADER = 'x-bunprise-etag'
const MODIFIED_HEADER = 'x-bunprise-last-modified'

interface StoredTile {
  bytes: Uint8Array<ArrayBuffer>
  /** epoch ms until which no request goes to OSM */
  freshUntil: number
  etag?: string
  lastModified?: string
}

interface MapTileOptions {
  fetch: Fetch
  now?: Clock
  /** undefined = caches.default when it exists; null = memory only */
  store?: IconStore | null
}

const DECIMAL = /^(?:0|[1-9]\d{0,6})$/

/** `?z=&x=&y=`: exactly these three, plain decimals, z 11–16, x and y inside the zoom's grid. */
export function parseTileRequest(url: URL): TileKey {
  const params = url.searchParams
  const names = [...params.keys()]
  if (names.length !== 3 || !['z', 'x', 'y'].every((name) => params.getAll(name).length === 1)) {
    throw new ApiError('invalid_request')
  }
  const read = (name: string): number => {
    const value = params.get(name) ?? ''
    if (!DECIMAL.test(value)) throw new ApiError('invalid_request')
    return Number(value)
  }
  const z = read('z')
  const x = read('x')
  const y = read('y')
  if (z < MAP_TILE_MIN_ZOOM || z > MAP_TILE_MAX_ZOOM) throw new ApiError('invalid_request')
  const size = 2 ** z
  if (x >= size || y >= size) throw new ApiError('invalid_request')
  return { z, x, y }
}

function isTile(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TILE_BYTES) return false
  const size = imageDimensions(bytes, 'image/png')
  // imageDimensions checks the IHDR chunk; the signature is checked here
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return signature.every((byte, index) => bytes[index] === byte) && size?.width === TILE_PX && size.height === TILE_PX
}

/** Seconds a response stays fresh: its max-age minus its Age (clamped to 5 min … 30 days); no max-age → 7 days. */
export function freshSeconds(cacheControl: string | null, age: string | null = null): number {
  const match = /(?:^|[,\s])max-age\s*=\s*"?(\d{1,10})"?/i.exec(cacheControl ?? '')
  if (!match) return DEFAULT_FRESH_S
  const used = age && /^\d{1,10}$/.test(age) ? Number(age) : 0
  return Math.min(MAX_FRESH_S, Math.max(MIN_FRESH_S, Number(match[1]) - used))
}

/** A validator we send back to OSM later: short printable ASCII only. */
function validator(value: string | null): string | undefined {
  return value && value.length <= 200 && /^[\x20-\x7e]+$/.test(value) ? value : undefined
}

class TileMemory {
  private readonly entries = new Map<string, StoredTile>()
  private bytes = 0

  get(key: string): StoredTile | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, tile: StoredTile): void {
    this.remove(key)
    this.entries.set(key, tile)
    this.bytes += tile.bytes.byteLength
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= MEMORY_BYTES && this.entries.size <= MEMORY_ENTRIES) break
      this.remove(oldest)
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.bytes -= entry.bytes.byteLength
  }
}

function defaultStore(): IconStore | null {
  try {
    return typeof caches === 'undefined' ? null : caches.default
  } catch {
    return null
  }
}

/** A URL of our own host: the Cache API stores per zone, and nothing outside this module ever asks for it. */
function storeKey(ownOrigin: string, key: string): string {
  return `${ownOrigin}/api/map-tile/__cache/v1/${key}`
}

async function readStore(store: IconStore | null, ownOrigin: string, key: string): Promise<StoredTile | undefined> {
  if (!store) return undefined
  try {
    const response = await store.match(storeKey(ownOrigin, key))
    if (!response) return undefined
    const freshUntil = Number(response.headers.get(FRESH_HEADER))
    const etag = validator(response.headers.get(ETAG_HEADER))
    const lastModified = validator(response.headers.get(MODIFIED_HEADER))
    // the stored bytes are checked again like a fresh download
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!Number.isFinite(freshUntil) || !isTile(bytes)) return undefined
    return { bytes, freshUntil, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) }
  } catch {
    return undefined
  }
}

async function writeStore(store: IconStore | null, ownOrigin: string, key: string, tile: StoredTile): Promise<void> {
  if (!store) return
  const headers = new Headers({
    'Content-Type': 'image/png',
    'Cache-Control': `public, max-age=${STORE_KEEP_S}`,
    [FRESH_HEADER]: String(tile.freshUntil),
  })
  if (tile.etag) headers.set(ETAG_HEADER, tile.etag)
  if (tile.lastModified) headers.set(MODIFIED_HEADER, tile.lastModified)
  try {
    await store.put(storeKey(ownOrigin, key), new Response(tile.bytes.slice(), { headers }))
  } catch {
    /* a full or unavailable cache only costs a conditional request */
  }
}

/** Waits for a shared download, but lets this one request go when its client goes away. */
function untilAborted<T>(job: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return job
  if (signal.aborted) return Promise.reject(new ApiError('timeout'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ApiError('timeout'))
    signal.addEventListener('abort', abort, { once: true })
    job.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** The PNG bytes of a validated tile (parseTileRequest). `ownOrigin` = this request's origin (Referer, cache key). */
export function createMapTiles(options: MapTileOptions) {
  const now = options.now ?? Date.now
  const store = options.store === undefined ? defaultStore() : options.store
  const memory = new TileMemory()
  const pending = new Map<string, Promise<StoredTile>>()

  async function download(tile: TileKey, ownOrigin: string, previous: StoredTile | undefined): Promise<StoredTile> {
    const headers = new Headers({ 'User-Agent': MAP_TILE_USER_AGENT, Referer: `${ownOrigin}/`, Accept: 'image/png' })
    if (previous?.etag) headers.set('If-None-Match', previous.etag)
    if (previous?.lastModified) headers.set('If-Modified-Since', previous.lastModified)
    return withDeadline(FETCH_MS, async (signal) => {
      const response = await options.fetch(`${UPSTREAM}/${tile.z}/${tile.x}/${tile.y}.png`, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal,
      })
      const freshUntil = now() + freshSeconds(response.headers.get('Cache-Control'), response.headers.get('Age')) * 1000
      if (response.status === 304 && previous) {
        void response.body?.cancel().catch(() => {})
        return { ...previous, freshUntil }
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {})
        throw new ApiError('upstream_unavailable')
      }
      const bytes = await readBytes(response, MAX_TILE_BYTES, signal)
      if (!isTile(bytes)) throw new ApiError('upstream_unavailable')
      const etag = validator(response.headers.get('ETag'))
      const lastModified = validator(response.headers.get('Last-Modified'))
      return { bytes, freshUntil, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) }
    })
  }

  return async (tile: TileKey, ownOrigin: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> => {
    const key = `${tile.z}/${tile.x}/${tile.y}`
    const remembered = memory.get(key)
    if (remembered && remembered.freshUntil > now()) return remembered.bytes
    let job = pending.get(key)
    if (!job) {
      if (pending.size >= MAX_PENDING) throw new ApiError('rate_limited', 2)
      job = (async () => {
        const previous = remembered ?? await readStore(store, ownOrigin, key)
        if (previous && previous.freshUntil > now()) {
          memory.set(key, previous)
          return previous
        }
        let next: StoredTile
        try {
          next = await download(tile, ownOrigin, previous)
        } catch (error) {
          // stale-if-error: an expired copy is better than no map, for a while
          if (previous && now() - previous.freshUntil < STALE_IF_ERROR_MS) return previous
          if (error instanceof ApiError && (error.code === 'timeout' || error.code === 'upstream_unavailable')) throw error
          throw new ApiError('upstream_unavailable')
        }
        memory.set(key, next)
        await writeStore(store, ownOrigin, key, next)
        return next
      })()
      const settled = job
      pending.set(key, settled)
      const clear = () => { if (pending.get(key) === settled) pending.delete(key) }
      settled.then(clear, clear)
    }
    return (await untilAborted(job, signal)).bytes
  }
}

/** The tile goes back with fixed headers only; the browser may keep it (private) for a week. */
export function mapTileResponse(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes.slice(), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}
