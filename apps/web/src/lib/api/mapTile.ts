import { asAccount, bearer } from './identity'

// GET /api/map-tile?z=&x=&y= — one OpenStreetMap map tile for the small map next to a chosen place (occasion form),
// fetched by OUR Worker (workers/edge/src/mapTile.ts: z 11–16 only, cached by OSM's own headers, an honest
// User-Agent, nothing about the person). The browser never talks to OpenStreetMap: this same-origin call is the only
// way a tile reaches it, and it is shown as an object URL of these bytes (features/occasions/form/MiniMap.tsx).
// - Same pattern as lib/api/shopIcon.ts: the captured account's bearer token, credentials omitted, no referrer.
// - Never throws and never toasts: switched off (501) / offline / any error → null, and the form keeps its pin tile.
// - Memory only in the app: one TanStack entry per tile, ['mapTile', z, x, y] (lib/query.ts persists exactly
//   ['feed']); the account boundary clears it with everything else. The Worker answers "private, max-age=604800", so
//   the browser's own HTTP cache may keep a tile for a week (map pictures of a place, nothing about the person).
// - Only the 1–4 tiles under one thumbnail, never "the tiles around just in case" (OSMF tile policy: no prefetching).

export const MAP_TILE_PATH = '/api/map-tile'

/** = MAX_TILE_BYTES of the Worker (256 KiB) */
export const MAP_TILE_MAX_BYTES = 256 * 1024

/** = the Worker's zoom range */
export const MAP_TILE_MIN_ZOOM = 11
export const MAP_TILE_MAX_ZOOM = 16

/** Tile requests running at the same time (one thumbnail needs at most four). */
export const MAP_TILE_PARALLEL = 4

/** "No tile" (offline, an error, the switch off) is asked again after this long; a tile never. */
const NO_TILE_STALE_MS = 60_000

function validTile(z: number, x: number, y: number): boolean {
  const size = 2 ** z
  return Number.isInteger(z) && z >= MAP_TILE_MIN_ZOOM && z <= MAP_TILE_MAX_ZOOM &&
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size
}

/** One tile as a PNG Blob (1 byte … 256 KiB) through our Worker; null when anything at all goes wrong. */
export async function getMapTile(z: number, x: number, y: number): Promise<Blob | null> {
  if (!validTile(z, x, y)) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  try {
    return await asAccount(undefined, async (account) => {
      const url = new URL(MAP_TILE_PATH, window.location.origin)
      url.searchParams.set('z', String(z))
      url.searchParams.set('x', String(x))
      url.searchParams.set('y', String(y))
      const response = await fetch(url, {
        headers: { Authorization: bearer(account), Accept: 'image/png' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      const type = (response.headers.get('Content-Type') ?? '').split(';', 1)[0]?.trim().toLowerCase()
      const declared = Number(response.headers.get('Content-Length') ?? '')
      if (!response.ok || type !== 'image/png' || (Number.isFinite(declared) && declared > MAP_TILE_MAX_BYTES)) {
        void response.body?.cancel().catch(() => {})
        return null
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength === 0 || bytes.byteLength > MAP_TILE_MAX_BYTES) return null
      return new Blob([bytes], { type: 'image/png' })
    })
  } catch {
    return null
  }
}

let running = 0
const waiting: Array<() => void> = []

/** Runs `task` when one of the MAP_TILE_PARALLEL slots is free (its own queue). */
function queued<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running += 1
      task().then(resolve, reject).finally(() => {
        running -= 1
        waiting.shift()?.()
      })
    }
    if (running < MAP_TILE_PARALLEL) start()
    else waiting.push(start)
  })
}

export const mapTileKey = (z: number, x: number, y: number) => ['mapTile', z, x, y] as const

// (a plain options object like shopIconQuery)
export function mapTileQuery(z: number, x: number, y: number) {
  return {
    queryKey: mapTileKey(z, x, y),
    queryFn: () => queued(() => getMapTile(z, x, y)),
    staleTime: (query: { state: { data: Blob | null | undefined } }) => (query.state.data ? Infinity : NO_TILE_STALE_MS),
    gcTime: 30 * 60_000,
    retry: false,
    // offline the query must still answer (null → no map), not wait paused with a skeleton forever
    networkMode: 'always' as const,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
}

/** Tests only. */
export function resetMapTileQueueForTests(): void {
  running = 0
  waiting.length = 0
}
