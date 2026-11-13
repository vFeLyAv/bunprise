import { ApiError, withDeadline } from './http'
import type { Clock } from './http'

export type Endpoint = 'link-preview' | 'link-image' | 'places' | 'shop-icon' | 'gift-ideas' | 'gift-photo' | 'map-tile' | 'calendar-feed' | 'email-unsubscribe'
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

const WINDOW_MS = 60_000
const MAX_BUCKETS = 10_000
const LIMITS: Record<Endpoint, { user: number; ip: number }> = {
  'link-preview': { user: 20, ip: 60 },
  // One picture per preview plus retries; still bounded because every image is up to 5 MiB.
  'link-image': { user: 40, ip: 120 },
  places: { user: 60, ip: 120 },
  // One request per distinct shop on a screen (the client caches per host); cache hits count too.
  'shop-icon': { user: 60, ip: 180 },
  // The deck asks for about six ideas at a time and again when it runs low (research 2026-10-25 §3.5).
  'gift-ideas': { user: 30, ip: 90 },
  // Catalogue photos come from <img> (no token): keyed by address only, ~6 per page of ideas plus the sheets.
  'gift-photo': { user: 120, ip: 120 },
  // The place thumbnail: 1–4 tiles per chosen place (the app keeps them; the browser up to a week). Low on purpose:
  // this must never turn into a bulk tile proxy (OSMF tile policy).
  'map-tile': { user: 60, ip: 120 },
  // The Kalender-Abo (calendar/feed.ts): "user" = one feed token (a calendar app looks every 5 min at the most; the
  // database allows 30 answers per token and hour on top). The address limit is generous on purpose: Google and Apple
  // fetch everybody's subscriptions from a few shared addresses of their own.
  'calendar-feed': { user: 6, ip: 300 },
  // The invitation e-mail's unsubscribe button (email/send.ts): "user" = one token (a person clicks once or twice; mail
  // apps' one-click POST once). The address limit is generous: mail providers POST one-click from shared addresses.
  'email-unsubscribe': { user: 5, ip: 120 },
}

async function bindingKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `bunprise:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function ipKeys(address: string): { primary: string; network?: string } {
  const value = address.trim()
  const plain = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  if (!plain.includes(':')) {
    const parts = plain.split('.').map(Number)
    return {
      primary: /^\d{1,3}(?:\.\d{1,3}){3}$/.test(plain) && parts.every((part) => part <= 255)
        ? parts.join('.') : plain || 'unknown',
    }
  }
  // WHATWG normalizes embedded dotted IPv4 and rejects zones / malformed IPv6.
  let normalized: string
  try {
    if (!/^[a-f0-9:.]+$/i.test(plain)) return { primary: plain }
    normalized = new URL(`http://[${plain}]/`).hostname.slice(1, -1)
  } catch {
    return { primary: plain }
  }
  const halves = normalized.split('::')
  const left = (halves[0] ?? '').split(':').filter(Boolean).map((part) => Number.parseInt(part, 16))
  const right = (halves[1] ?? '').split(':').filter(Boolean).map((part) => Number.parseInt(part, 16))
  const parts = halves.length === 1
    ? left : [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    const high = parts[6] ?? 0
    const low = parts[7] ?? 0
    return { primary: [high >>> 8, high & 255, low >>> 8, low & 255].join('.') }
  }
  const hextets = parts.map((part) => part.toString(16))
  return {
    primary: `${hextets.slice(0, 4).join(':')}::/64`,
    network: `${hextets.slice(0, 3).join(':')}::/48`,
  }
}

/** Reserve synchronously before awaiting the optional binding, including concurrent requests. */
export function createRateLimiter(options: { now?: Clock } = {}) {
  const now = options.now ?? Date.now
  const users = new Map<string, number[]>()
  const ips = new Map<string, number[]>()
  let lastCleanup = -Infinity

  function cleanup(timestamp: number): void {
    if (timestamp - lastCleanup < 10_000) return
    lastCleanup = timestamp
    for (const buckets of [users, ips]) {
      for (const [key, entries] of buckets) {
        if ((entries[entries.length - 1] ?? -Infinity) <= timestamp - WINDOW_MS) buckets.delete(key)
      }
    }
  }

  return async (
    endpoint: Endpoint,
    subject: string,
    ip: string,
    binding?: RateLimitBinding,
  ): Promise<void> => {
    const timestamp = now()
    cleanup(timestamp)
    const userKey = `${endpoint}:user:${subject}`
    // Never evict live user counters or admit an untracked user when this table is full.
    if (!users.has(userKey) && users.size >= MAX_BUCKETS) throw new ApiError('rate_limited', 60)
    const address = ipKeys(ip)
    const candidates = [
      { key: `${endpoint}:ip:${address.primary}`, limit: LIMITS[endpoint].ip, binding: true },
      ...(address.network
        ? [{ key: `${endpoint}:network:${address.network}`, limit: LIMITS[endpoint].ip * 4, binding: false }]
        : []),
    ]
    let available = MAX_BUCKETS - ips.size
    const tracked = candidates.filter(({ key }) => {
      if (ips.has(key)) return true
      if (available === 0) return false
      available--
      return true
    })
    const buckets = [
      { table: users, key: userKey, limit: LIMITS[endpoint].user, binding: true },
      ...tracked.map((bucket) => ({ table: ips, ...bucket })),
    ].map((bucket) => ({
      ...bucket,
      entries: (bucket.table.get(bucket.key) ?? []).filter((time) => time > timestamp - WINDOW_MS),
    }))
    let retryAfter = 0
    for (const { entries, limit } of buckets) {
      if (entries.length >= limit) {
        retryAfter = Math.max(retryAfter, Math.ceil(((entries[0] ?? timestamp) + WINDOW_MS - timestamp) / 1000))
      }
    }
    if (retryAfter > 0) throw new ApiError('rate_limited', Math.max(1, retryAfter))
    // Missing IP keys are skipped at capacity; existing counters are always enforced.
    for (const { table, key, entries } of buckets) {
      entries.push(timestamp)
      table.set(key, entries)
    }
    if (binding) {
      try {
        const accepted = await withDeadline(1000, async () => {
          // The binding has one fixed quota, so the looser /48 bucket stays local.
          const keys = buckets.filter((bucket) => bucket.binding).map((bucket) => bucket.key)
          const results = await Promise.all(keys.map(async (key) => binding.limit({ key: await bindingKey(key) })))
          return results.every((result) => result.success)
        })
        if (!accepted) throw new ApiError('rate_limited', 60)
      } catch {
        throw new ApiError('rate_limited', 60)
      }
    }
  }
}
