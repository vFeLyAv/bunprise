import { asAccount, bearer } from './identity'

// GET /api/shop-icon?host=… — the shop's REAL icon, fetched by OUR Worker (workers/edge/src/shopIcon.ts: SSRF-safe,
// only the shop's public start page and icon files, the type checked by the bytes — PNG / JPEG / WebP / GIF / ICO,
// never SVG; ≤ 256 KiB). The browser never talks to the shop: this same-origin call is the only way a shop icon
// reaches it, and it is shown as an object URL of these bytes (features/wishes/ShopTile.tsx), never by address.
// - Same pattern as lib/api/linkImage.ts: the captured account's bearer token, credentials omitted, no referrer.
// - Never throws and never toasts: no icon / offline / any error → null, and the tile simply keeps its letter.
// - Memory only in the app: one TanStack entry per shop, ['shopIcon', host] (lib/query.ts persists exactly ['feed']);
//   the account boundary clears it with everything else. The Worker answers "private, max-age=604800", so the
//   browser's own HTTP cache may keep an icon for a week (shop icons are public pictures, no personal data).
// - A list asks only for tiles near the screen (features/wishes/inView.ts) and at most SHOP_ICON_PARALLEL at once.

export const SHOP_ICON_PATH = '/api/shop-icon'

/** = MAX_ICON_BYTES of the Worker (256 KiB) */
export const SHOP_ICON_MAX_BYTES = 256 * 1024

export type ShopIconType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/x-icon'

const TYPES: Readonly<Record<string, ShopIconType>> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
  'image/x-icon': 'image/x-icon',
  'image/vnd.microsoft.icon': 'image/x-icon',
}

/** Icon requests running at the same time (a long list never fires twenty at once). */
export const SHOP_ICON_PARALLEL = 3

/** "No icon" is asked again after this long (a shop that was unreachable may answer later); an icon never. */
const NO_ICON_STALE_MS = 15 * 60_000

/**
 * The key of a shop: its hostname, lower case (IDN as punycode), without a leading "www." / "m." — the same key the
 * Worker caches by. null for anything that is not a plain hostname (IP addresses, ports, paths, single labels).
 */
export function shopIconHost(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  // eslint-disable-next-line no-control-regex
  if (!raw || raw.length > 253 || /[\u0000- \u007f/\\?#@:%[\]]/.test(raw)) return null
  let host: string
  try {
    host = new URL(`https://${raw}/`).hostname.replace(/\.$/, '')
  } catch {
    return null
  }
  if (!host.includes('.') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null
  return /^(?:www|m)\.[^.]+\.[^.]+/.test(host) ? host.slice(host.indexOf('.') + 1) : host
}

function iconTypeOf(header: string | null): ShopIconType | null {
  const mime = (header ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return Object.hasOwn(TYPES, mime) ? (TYPES[mime] ?? null) : null
}

/**
 * The shop's icon as a Blob (one of the five raster types, 1 byte … 256 KiB) through our Worker; null when the shop
 * has none, the host is no plain hostname, the device is offline or anything at all goes wrong.
 */
export async function getShopIcon(host: string): Promise<Blob | null> {
  const key = shopIconHost(host)
  if (!key) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  try {
    return await asAccount(undefined, async (account) => {
      const url = new URL(SHOP_ICON_PATH, window.location.origin)
      url.searchParams.set('host', key)
      const response = await fetch(url, {
        headers: { Authorization: bearer(account), Accept: 'image/png,image/webp,image/x-icon,image/gif,image/jpeg' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      const type = response.ok ? iconTypeOf(response.headers.get('Content-Type')) : null
      const declared = Number(response.headers.get('Content-Length') ?? '')
      if (!type || (Number.isFinite(declared) && declared > SHOP_ICON_MAX_BYTES)) {
        void response.body?.cancel().catch(() => {})
        return null
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength === 0 || bytes.byteLength > SHOP_ICON_MAX_BYTES) return null
      return new Blob([bytes], { type })
    })
  } catch {
    return null
  }
}

let running = 0
const waiting: Array<() => void> = []

/** Runs `task` when one of the SHOP_ICON_PARALLEL slots is free (its own queue: icons never hold up photos). */
function queued<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running += 1
      task().then(resolve, reject).finally(() => {
        running -= 1
        waiting.shift()?.()
      })
    }
    if (running < SHOP_ICON_PARALLEL) start()
    else waiting.push(start)
  })
}

export const shopIconKey = (host: string) => ['shopIcon', host] as const

// (a plain options object like wishPhotoQuery: queryOptions() would pull one more tiny shared chunk into Start)
export function shopIconQuery(host: string) {
  return {
    queryKey: shopIconKey(host),
    queryFn: () => queued(() => getShopIcon(host)),
    staleTime: (query: { state: { data: Blob | null | undefined } }) => (query.state.data ? Infinity : NO_ICON_STALE_MS),
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
}

/** Tests only. */
export function resetShopIconQueueForTests(): void {
  running = 0
  waiting.length = 0
}
