import type { QueryClient } from '@tanstack/react-query'
import { asOwnerWishes, type OccasionScreen, type OwnerWish } from '../../lib/api/types'
import { qk } from '../../lib/queryKeys'
import { sortWishes } from './wishOrder'

// Server-confirmed cache updates for the OWNER's occasion screen (after an edit / a delete), so the
// screen shows the new state at once instead of a stale list until its refetch arrives.
// Secrecy: nothing here reads the reservation fields — wishes are only filtered by id or spread
// unchanged, and findCachedWish hands out asOwnerWishes() copies without those fields.

/** First element of qk.occasion(id): matches every cached occasion screen. */
const OCCASION_ROOT = qk.occasion('')[0]

/** The fields the wish form edits (the details and the photo's meta when the save knows them). */
export type WishFields = Pick<OwnerWish, 'title' | 'url' | 'price_cents' | 'note' | 'priority'>
  & Partial<Pick<OwnerWish, 'description' | 'brand' | 'color' | 'gtin' | 'shop_name' | 'photo' | 'quantity'>>

type ScreenUpdater = (screen: OccasionScreen | undefined) => OccasionScreen | undefined

function updateScreens(queryClient: QueryClient, occasionId: string | null, update: ScreenUpdater): void {
  if (occasionId) queryClient.setQueryData<OccasionScreen>(qk.occasion(occasionId), update)
  else queryClient.setQueriesData<OccasionScreen>({ queryKey: [OCCASION_ROOT] }, update)
}

/** Applies the saved form fields to the cached wish and re-sorts (the priority may have changed). */
export function patchCachedWish(queryClient: QueryClient, occasionId: string | null, wishId: string, fields: WishFields): void {
  updateScreens(queryClient, occasionId, (screen) => {
    if (!screen?.wishlist) return screen
    const wishes = screen.wishlist.wishes.map((wish) => (wish.id === wishId ? { ...wish, ...fields } : wish))
    return { ...screen, wishlist: { ...screen.wishlist, wishes: sortWishes(wishes) } }
  })
  for (const source of ownerWishSources) source.patch(queryClient, wishId, fields)
}

/** Drops a wish the server has deleted (no flash of the old row when the screen opens again). */
export function removeCachedWish(queryClient: QueryClient, occasionId: string | null, wishId: string): void {
  updateScreens(queryClient, occasionId, (screen) => {
    if (!screen?.wishlist) return screen
    return { ...screen, wishlist: { ...screen.wishlist, wishes: screen.wishlist.wishes.filter((wish) => wish.id !== wishId) } }
  })
  for (const source of ownerWishSources) source.remove(queryClient, wishId)
}

/**
 * Refetch the screens that show wishes: the occasion (or all of them) and the feed (wish counts).
 * A known occasion refetches even while its screen is not mounted (`refetchType: 'all'`): the
 * person is on the way back to it, and a screen that loaded a moment ago would not refetch on mount.
 */
export async function invalidateWishViews(queryClient: QueryClient, occasionId: string | null): Promise<void> {
  await Promise.all([
    occasionId
      ? queryClient.invalidateQueries({ queryKey: qk.occasion(occasionId), refetchType: 'all' })
      : queryClient.invalidateQueries({ queryKey: [OCCASION_ROOT] }),
    queryClient.invalidateQueries({ queryKey: qk.feed() }),
    ...[...ownerWishSources].map((source) => source.invalidate(queryClient)),
  ])
}

/** Only the other owner screens (my lists, below): wishes left them — moved into a new occasion's list. */
export async function invalidateOwnerWishSources(queryClient: QueryClient): Promise<void> {
  await Promise.all([...ownerWishSources].map((source) => source.invalidate(queryClient)))
}

export interface CachedWish {
  /** null: the wish's list has no occasion (wave 2, a list of features/lists) */
  occasionId: string | null
  /** pilot: the host is the list owner; a list without an occasion: its owner */
  isHost: boolean
  wish: OwnerWish
}

/** The wish from an occasion screen that is already in memory (the usual way into the edit form). */
export function findCachedWish(queryClient: QueryClient, wishId: string): CachedWish | null {
  for (const [, screen] of queryClient.getQueriesData<OccasionScreen>({ queryKey: [OCCASION_ROOT] })) {
    const found = screen?.wishlist?.wishes.find((wish) => wish.id === wishId)
    if (screen && found) {
      const [wish] = asOwnerWishes([found])
      if (wish) return { occasionId: screen.occasion.id, isHost: screen.viewer.role === 'host', wish }
    }
  }
  for (const source of ownerWishSources) {
    const found = source.find(queryClient, wishId)
    if (found) return found
  }
  return null
}

/**
 * Other screens that show the OWNER's wishes plug their cache in here (wave 2: a list without an occasion,
 * features/lists/queries.ts): the edit form finds a wish there too, and a saved edit or a delete updates
 * those screens like the occasion screens above. Owner data only — `find` hands out asOwnerWishes() copies.
 */
export interface OwnerWishSource {
  find: (queryClient: QueryClient, wishId: string) => CachedWish | null
  patch: (queryClient: QueryClient, wishId: string, fields: WishFields) => void
  remove: (queryClient: QueryClient, wishId: string) => void
  invalidate: (queryClient: QueryClient) => Promise<void>
}

const ownerWishSources = new Set<OwnerWishSource>()

/** Registers a source (once, at module load of its feature); returns the unregister function. */
export function registerOwnerWishSource(source: OwnerWishSource): () => void {
  ownerWishSources.add(source)
  return () => {
    ownerWishSources.delete(source)
  }
}

/**
 * Shared wishes (20261027200000, design §5.6): one wish can be on several screens at once (my list, one or more of my
 * occasions, the giver views of "Ideen"). After adding it to a list, removing it from one or deleting it everywhere,
 * every screen family that may show it refetches: all occasion screens (the given one even while not mounted), the
 * feed, my lists, and the "Noch frei" / gift-list blocks. Only invalidations — nothing is read from the caches here.
 */
export async function invalidateSharedWishViews(queryClient: QueryClient, occasionId: string | null): Promise<void> {
  await Promise.all([
    invalidateWishViews(queryClient, occasionId),
    occasionId ? queryClient.invalidateQueries({ queryKey: [OCCASION_ROOT] }) : null,
    queryClient.invalidateQueries({ queryKey: ['free-wishes'] }),
    queryClient.invalidateQueries({ queryKey: ['gifts'] }),
  ])
}
