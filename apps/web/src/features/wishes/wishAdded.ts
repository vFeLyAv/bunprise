import { onAccountEnded } from '../../lib/accountBoundary'
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'

// "A wish was just added" — the moment on the owner's list (wave 1, Felix's K10): Pompon carries the new
// wish into the list as a little gift (mascot-ui/carry.ts) and the row appears where he puts it down; at
// most once per 10 s (pilot-decisions §7 kept that pace for the former hamster moment).
// The new-wish screen writes a small flag to sessionStorage, the owner's wishlist reads it once when the
// occasion screen opens again. It holds only the occasion id, the new wish id and a timestamp — never
// anything about reservations — and lives under the app prefix, so sign-out clears it (lib/query.ts
// clearLocalState). The demo build uses its own `bunprise.demo.` prefix.

export const WISH_ADDED_KEY = `${ACTIVE_STORAGE_PREFIX}wishAdded`
/** A flag older than this is ignored (the person went somewhere else first). */
const FLAG_MAX_AGE_MS = 60_000
/** At most one "wish added" moment per 10 seconds. */
export const WISH_MOMENT_INTERVAL_MS = 10_000

export interface WishAddedFlag {
  occasionId: string
  wishId: string
  at: number
}

function isFlag(value: unknown): value is WishAddedFlag {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.occasionId === 'string' && typeof v.wishId === 'string' && typeof v.at === 'number'
}

export function markWishAdded(occasionId: string, wishId: string, now = Date.now()): void {
  ownWishAdds += 1
  try {
    const flag: WishAddedFlag = { occasionId, wishId, at: now }
    window.sessionStorage.setItem(WISH_ADDED_KEY, JSON.stringify(flag))
  } catch {
    /* storage unavailable: the row simply appears */
  }
}

/** Pure read (safe in a useState initializer): the flag for this occasion, if it is fresh. */
export function peekWishAdded(occasionId: string, now = Date.now()): WishAddedFlag | null {
  try {
    const raw = window.sessionStorage.getItem(WISH_ADDED_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isFlag(parsed) || parsed.occasionId !== occasionId) return null
    const age = now - parsed.at
    return age >= 0 && age <= FLAG_MAX_AGE_MS ? parsed : null
  } catch {
    return null
  }
}

export function clearWishAdded(): void {
  try {
    window.sessionStorage.removeItem(WISH_ADDED_KEY)
  } catch {
    /* storage unavailable */
  }
}

// Throttle for the moment. Memory only: a reload may let it play again, which is fine.
let lastMomentAt = Number.NEGATIVE_INFINITY
let ownWishAdds = 0
/** Count only confirmed create actions in this account's current tab session. */
export function ownWishAddCount(): number { return ownWishAdds }

export function canPlayWishMoment(now = Date.now()): boolean {
  return now - lastMomentAt >= WISH_MOMENT_INTERVAL_MS
}

export function noteWishMoment(now = Date.now()): void {
  lastMomentAt = now
}

/** Tests only. */
export function resetWishMomentThrottle(): void {
  lastMomentAt = Number.NEGATIVE_INFINITY
  ownWishAdds = 0
}

// Where the new-wish screen was opened from: the owner's list of this occasion (then "Speichern" goes back
// there), or somewhere else — the "+" menu of the tab bar, a deep link — then saving opens the occasion, so
// the person sees the new wish being carried into its list. The list notes when it leaves the screen; the
// new-wish screen asks right after it mounted (the list's unmount comes first in that commit).

/** The list left the screen at most this long before the new-wish screen appeared. */
const CAME_FROM_MS = 2_000
let leftList: { occasionId: string; at: number } | null = null

export function noteOwnerListLeft(occasionId: string, now = Date.now()): void {
  leftList = { occasionId, at: now }
}

export function cameFromOwnerList(occasionId: string, now = Date.now()): boolean {
  return leftList !== null && leftList.occasionId === occasionId && now - leftList.at >= 0 && now - leftList.at <= CAME_FROM_MS
}

/** Tests only. */
export function resetOwnerListTrail(): void {
  leftList = null
}

// module memory of the shown account: forgotten when that account ends in this tab
onAccountEnded(resetOwnerListTrail)
onAccountEnded(resetWishMomentThrottle)
