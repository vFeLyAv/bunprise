import type { OwnerWish, WishPriority } from '../../../lib/api/types'

// Types shared by the owner's wish grid (OwnerWishlist.tsx) and its lazy selection chunk (SelectionChrome.tsx).
// OWNER module: OwnerWish has no reservation fields at all.

/** An own change shown before the server confirmed it (OwnerWishlist's optimistic layer). */
export type WishChange = { kind: 'moved' } | { kind: 'received'; at: string | null } | { kind: 'priority'; priority: WishPriority }

/** What a bulk action did: the wishes the server accepted and the ones it refused (shown again). */
export interface BulkOutcome {
  done: OwnerWish[]
  failed: { wish: OwnerWish; error: unknown }[]
}

/**
 * OwnerWishlist's bulk runner: shows `change` for every wish at once, sends the requests one after another (the
 * existing per-wish calls), keeps the accepted ones, takes back the refused ones. null = the account changed meanwhile.
 */
export type RunMany = (
  wishes: readonly OwnerWish[],
  change: WishChange,
  request: (wish: OwnerWish, userId: string | undefined) => Promise<unknown>,
) => Promise<BulkOutcome | null>
