import { useQuery, type QueryClient } from '@tanstack/react-query'
import { getListScreen, getListsOverview } from '../../lib/api/lists'
import type { ListScreen, ListsOverview, OwnerListCard } from '../../lib/api/lists.types'
import { asOwnerWishes } from '../../lib/api/types'
import { isAppError } from '../../lib/errors'
import { registerOwnerWishSource, type WishFields } from '../wishes/wishCache'
import { sortWishes } from '../wishes/wishOrder'
import { occasionDayKey } from './dates'

// Data of the lists tab and of a list's screen: ONE RPC per screen (get_lists_overview / get_list_screen),
// in MEMORY ONLY — the persist allow-list stays exactly ['feed'] (lib/query.ts PERSISTED_ROOTS; W05): other
// people's lists never touch the disk, and the account boundary wipes these keys with the rest of the cache.
// Every request is pinned to the account of the screen (the route session's user id).

export const listsKeys = {
  /** get_lists_overview() — the tab */
  overview: () => ['lists'] as const,
  /** get_list_screen(id) — one list's screen (reservation state inside for followers: refetched on open) */
  list: (listId: string) => ['list', listId] as const,
}

const LIST_ROOT = listsKeys.list('')[0]

/** "Not found" and "no access" are one final answer (no retry, one page). */
export function isListUnavailable(error: unknown): boolean {
  return isAppError(error, 'not_found') || isAppError(error, 'not_allowed') || isAppError(error, 'forbidden')
}

function retryTransient(failureCount: number, error: unknown): boolean {
  if (isListUnavailable(error) || isAppError(error, 'session_expired') || isAppError(error, 'not_authenticated')) return false
  return failureCount < 1
}

export function listsOverviewQuery(userId: string) {
  return {
    queryKey: listsKeys.overview(),
    // a wrapper: the expected account is the screen's, never TanStack's query context
    queryFn: () => getListsOverview(userId),
    staleTime: 10_000,
    retry: retryTransient,
  }
}

export function listScreenQuery(listId: string, userId: string) {
  return {
    queryKey: listsKeys.list(listId),
    queryFn: () => getListScreen(listId, userId),
    staleTime: 0,
    retry: retryTransient,
  }
}

/** Route loaders: start the request without blocking the navigation (the screen shows its skeleton). */
export function prefetchListsOverview(queryClient: QueryClient, userId: string): void {
  void queryClient.ensureQueryData(listsOverviewQuery(userId)).catch(() => undefined)
}

export function prefetchListScreen(queryClient: QueryClient, listId: string, userId: string): void {
  void queryClient.ensureQueryData(listScreenQuery(listId, userId)).catch(() => undefined)
}

export function useListsOverview(userId: string, enabled = true) {
  return useQuery({ ...listsOverviewQuery(userId), enabled })
}

/** Data younger than this counts as "just loaded by the loader" when the screen mounts. */
const JUST_LOADED_MS = 2_000

/**
 * A list's screen. Opening it refreshes it (fresh "Reserviert" for followers) unless the loader fetched it a
 * moment ago or the create flow just put the new list there — like the occasion screen (no second request).
 */
export function useListScreen(listId: string, userId: string, enabled = true) {
  return useQuery({
    ...listScreenQuery(listId, userId),
    enabled,
    refetchOnMount: (query) =>
      query.state.isInvalidated || Date.now() - query.state.dataUpdatedAt >= JUST_LOADED_MS ? 'always' : false,
    retryOnMount: false,
  })
}

// ---- cache updates of the owner's own actions (confirmed or optimistic with rollback) --------------------

type OverviewUpdater = (overview: ListsOverview) => ListsOverview

export function updateOverview(queryClient: QueryClient, update: OverviewUpdater): void {
  queryClient.setQueryData<ListsOverview>(listsKeys.overview(), (overview) => (overview ? update(overview) : overview))
}

/**
 * The server's order of "Meine" (§5.2): a future date first (ascending), then the lists without one (newest
 * first), then past occasions — never anything about reservations. Used for an optimistic card only; the
 * refetch right after brings the server's order back.
 */
export function ownListRank(card: OwnerListCard, today: string): [group: number, key: string] {
  if (card.occasion) {
    const day = occasionDayKey(card.occasion.starts_at, card.occasion.tz)
    return day >= today ? [0, day] : [2, day]
  }
  if (card.due_on !== null && card.due_on >= today) return [0, card.due_on]
  return [1, card.created_at]
}

function compareOwn(today: string) {
  return (a: OwnerListCard, b: OwnerListCard): number => {
    const [ga, ka] = ownListRank(a, today)
    const [gb, kb] = ownListRank(b, today)
    if (ga !== gb) return ga - gb
    const ascending = ga === 0
    const byKey = ka < kb ? -1 : ka > kb ? 1 : 0
    return (ascending ? byKey : -byKey) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }
}

/** A new own list, placed where the server will put it. */
export function insertOwnCard(overview: ListsOverview, card: OwnerListCard, today: string): ListsOverview {
  const my_lists = [...overview.my_lists.filter((entry) => entry.id !== card.id), card].sort(compareOwn(today))
  return {
    ...overview,
    my_lists,
    stats: { ...overview.stats, my_lists: overview.stats.my_lists + 1, my_wishes: overview.stats.my_wishes + card.wish_count },
  }
}

export function removeOwnCard(overview: ListsOverview, listId: string): ListsOverview {
  const card = overview.my_lists.find((entry) => entry.id === listId)
  if (!card) return overview
  return {
    ...overview,
    my_lists: overview.my_lists.filter((entry) => entry.id !== listId),
    stats: { ...overview.stats, my_lists: Math.max(0, overview.stats.my_lists - 1), my_wishes: Math.max(0, overview.stats.my_wishes - card.wish_count) },
  }
}

export function patchOwnCard(overview: ListsOverview, listId: string, patch: Partial<OwnerListCard>): ListsOverview {
  return { ...overview, my_lists: overview.my_lists.map((entry) => (entry.id === listId ? { ...entry, ...patch } : entry)) }
}

export function updateListScreen(queryClient: QueryClient, listId: string, update: (screen: ListScreen) => ListScreen): void {
  queryClient.setQueryData<ListScreen>(listsKeys.list(listId), (screen) => (screen ? update(screen) : screen))
}

/** Refetch the tab and every list screen (counts, a changed list, the cards' thumbnails) — memory only. */
export async function invalidateLists(queryClient: QueryClient, listId?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: listsKeys.overview() }),
    // the cards' little pictures (previews.ts): a card on screen asks again
    queryClient.invalidateQueries({ queryKey: listId ? ['listPreview', listId] : ['listPreview'] }),
    listId
      ? queryClient.invalidateQueries({ queryKey: listsKeys.list(listId), refetchType: 'all' })
      : queryClient.invalidateQueries({ queryKey: [LIST_ROOT] }),
  ])
}

// ---- the owner's wishes on list screens, for the wish editor (features/wishes/wishCache.ts) ---------------

function ownerScreens(queryClient: QueryClient): ListScreen[] {
  return queryClient
    .getQueriesData<ListScreen>({ queryKey: [LIST_ROOT] })
    .flatMap(([, screen]) => (screen && screen.viewer.role === 'owner' ? [screen] : []))
}

function patchWishes(queryClient: QueryClient, wishId: string, change: (screen: ListScreen) => ListScreen): void {
  for (const screen of ownerScreens(queryClient)) {
    if (screen.wishes.some((wish) => wish.id === wishId)) updateListScreen(queryClient, screen.list.id, change)
  }
}

registerOwnerWishSource({
  find(queryClient, wishId) {
    for (const screen of ownerScreens(queryClient)) {
      const [wish] = asOwnerWishes(screen.wishes.filter((entry) => entry.id === wishId))
      if (wish) return { occasionId: null, isHost: true, wish }
    }
    return null
  },
  patch(queryClient, wishId, fields: WishFields) {
    patchWishes(queryClient, wishId, (screen) => ({
      ...screen,
      wishes: sortWishes(screen.wishes.map((wish) => (wish.id === wishId ? { ...wish, ...fields } : wish))),
    }))
  },
  remove(queryClient, wishId) {
    patchWishes(queryClient, wishId, (screen) => ({ ...screen, wishes: screen.wishes.filter((wish) => wish.id !== wishId) }))
  },
  invalidate: (queryClient) => invalidateLists(queryClient),
})
