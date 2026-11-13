import { useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import { getFeed, getOccasionScreen } from '../../lib/api/occasions'
import { asOwnerWishes, type FeedOccasion, type OccasionScreen } from '../../lib/api/types'
import { qk } from '../../lib/queryKeys'
import { getListScreen, getListsOverview } from '../../lib/api/lists'
import { listsEnabled } from '../lists/flag'
import type { WishSignal } from './interests'

// WHOSE wishes "Geschenk finden" looks at — pluggable sources (wave 2). Today one source: the occasions
// I joined (their hosts' lists, which I already see as a guest) and the occasions I host (my own lists).
// The follows agents (wave 2b, docs/spec/follows-design.md) add followed people and lists without an
// occasion through `registerGiftSource()` — the picker, the inference and the deck stay as they are.
// Rules for every source:
// - only lists the giver may read today (follows-design G2), through the existing screen RPCs;
// - a list leaves the source as title + link + price + "Wie sehr?" per wish (WishSignal) — never anything
//   about reservations (G1/G7): the wishes go through asOwnerWishes(), which drops those fields;
// - no request of its own when the data is in memory: the feed and the occasion screens share their
//   cache entries with Start, Kalender and the occasion page (qk.feed(), qk.occasion(id)); nothing here is
//   persisted (only the exact ['feed'] ever is, after opt-in — lib/query.ts).

export interface GiftListRef {
  /** unique across sources, e.g. "occasion:<id>" */
  key: string
  sourceId: string
  title: string
  /** the start of the list's occasion (ISO), null for a list without a date */
  startsAt: string | null
  /** shown next to the list when known */
  wishCount: number | null
}

export interface GiftPerson {
  /** unique: "profile:<id>" when the source knows the profile id, else source-specific */
  key: string
  name: string
  /** the profile id when known (avatar colour, "Merken für") */
  profileId: string | null
  lists: GiftListRef[]
}

export interface LoadedList {
  ref: GiftListRef
  /** the list owner as the server names them */
  owner: { profileId: string; name: string | null }
  /** my own lists only: where "Zu meiner Wunschliste" puts a wish (null otherwise) */
  wishlistId: string | null
  /** pilot: the occasion of the list (the new wish's carry moment opens it) */
  occasionId: string | null
  wishes: WishSignal[]
}

export interface GiftSourceContext {
  /** the account of the screen (the route session): every request is pinned to it */
  userId: string
  queryClient: QueryClient
}

export interface GiftSource {
  readonly id: string
  /** people whose lists I may read today, each with those lists */
  people(ctx: GiftSourceContext): Promise<GiftPerson[]>
  /** my own lists ("Für mich"), nearest first */
  myLists(ctx: GiftSourceContext): Promise<GiftListRef[]>
  /** one list of this source with its wishes (reduced to WishSignal) */
  loadList(ref: GiftListRef, ctx: GiftSourceContext): Promise<LoadedList>
}

// ---- the occasions source ------------------------------------------------------------------------------------

const OCCASION_PREFIX = 'occasion:'
/** The local identity migration adds host_id; the unreleased pilot feed can still omit it. */
type FeedRow = FeedOccasion & { host_id?: string | null }

function feed(ctx: GiftSourceContext) {
  return ctx.queryClient.fetchQuery({
    queryKey: qk.feed(),
    // the account of the screen, not TanStack's context (contract.md §5.2)
    queryFn: () => getFeed(ctx.userId),
    staleTime: 30_000,
  })
}

function occasionRef(occasion: FeedOccasion): GiftListRef {
  return {
    key: `${OCCASION_PREFIX}${occasion.id}`,
    sourceId: 'occasions',
    title: occasion.title,
    startsAt: occasion.starts_at,
    wishCount: Number.isFinite(occasion.wish_count) ? Math.max(0, Math.trunc(occasion.wish_count)) : null,
  }
}

function personKey(occasion: FeedRow, queryClient: QueryClient): { key: string; profileId: string | null } {
  if (typeof occasion.host_id === 'string' && occasion.host_id) return { key: `profile:${occasion.host_id}`, profileId: occasion.host_id }
  // The occasion's gift action already knows this identity. Reuse its same-account memory so a
  // legacy feed can honor profile:<id> preselection without a migration or another screen RPC.
  const cached = queryClient.getQueryData<OccasionScreen>(qk.occasion(occasion.id))
  const hostId = cached?.occasion.id === occasion.id ? cached.occasion.host.id : null
  if (hostId) return { key: `profile:${hostId}`, profileId: hostId }
  // without an id: one entry per shown name (two hosts with the same name stay one row until the feed says more)
  return { key: `host:${(occasion.host_name ?? '').trim().toLocaleLowerCase()}`, profileId: null }
}

function toSignals(screen: OccasionScreen): WishSignal[] {
  return asOwnerWishes(screen.wishlist?.wishes ?? []).map((wish) => ({
    title: wish.title,
    url: wish.url,
    priceCents: wish.price_cents,
    priority: wish.priority,
  }))
}

export const occasionsSource: GiftSource = {
  id: 'occasions',
  async people(ctx) {
    const screen = await feed(ctx)
    const byKey = new Map<string, GiftPerson>()
    // upcoming only: ideas are for something that is still ahead
    for (const occasion of screen.upcoming as FeedRow[]) {
      if (occasion.role !== 'member') continue
      const name = occasion.host_name?.trim()
      if (!name) continue
      const { key, profileId } = personKey(occasion, ctx.queryClient)
      const person = byKey.get(key) ?? { key, name, profileId, lists: [] }
      if (!person.lists.some((list) => list.key === `${OCCASION_PREFIX}${occasion.id}`)) person.lists.push(occasionRef(occasion))
      byKey.set(key, person)
    }
    return [...byKey.values()]
  },
  async myLists(ctx) {
    const screen = await feed(ctx)
    return screen.upcoming.filter((occasion) => occasion.role === 'host').map(occasionRef)
  },
  async loadList(ref, ctx) {
    const occasionId = ref.key.slice(OCCASION_PREFIX.length)
    const screen = await ctx.queryClient.fetchQuery({
      queryKey: qk.occasion(occasionId),
      queryFn: () => getOccasionScreen(occasionId, ctx.userId),
      staleTime: 60_000,
    })
    const host = screen.viewer.role === 'host'
    return {
      ref,
      owner: { profileId: screen.occasion.host.id, name: screen.occasion.host.display_name },
      wishlistId: host ? (screen.wishlist?.id ?? null) : null,
      occasionId,
      wishes: toSignals(screen),
    }
  },
}

// ---- the registry ----------------------------------------------------------------------------------------------

const sources: GiftSource[] = [occasionsSource]

const LIST_PREFIX = 'list:'
const listRef = (list: { id: string; title: string | null; due_on: string | null; wish_count: number }): GiftListRef => ({
  key: `${LIST_PREFIX}${list.id}`, sourceId: 'lists', title: list.title ?? '', startsAt: list.due_on, wishCount: list.wish_count,
})
const overview = (ctx: GiftSourceContext) => ctx.queryClient.fetchQuery({ queryKey: ['lists'], queryFn: () => getListsOverview(ctx.userId), staleTime: 10_000 })

export const listsSource: GiftSource = {
  id: 'lists',
  async people(ctx) {
    if (!listsEnabled()) return []
    const data = await overview(ctx)
    return data.following.filter((person) => person.profile.id !== ctx.userId && person.lists.length > 0).map((person) => ({
      key: `profile:${person.profile.id}`, profileId: person.profile.id, name: person.profile.display_name ?? '', lists: person.lists.map(listRef),
    }))
  },
  async myLists(ctx) {
    if (!listsEnabled()) return []
    return (await overview(ctx)).my_lists.filter((list) => list.kind === 'standalone').map(listRef)
  },
  async loadList(ref, ctx) {
    const id = ref.key.slice(LIST_PREFIX.length)
    const screen = await ctx.queryClient.fetchQuery({ queryKey: ['list', id], queryFn: () => getListScreen(id, ctx.userId), staleTime: 0 })
    return { ref, owner: { profileId: screen.list.owner.id, name: screen.list.owner.display_name },
      wishlistId: screen.viewer.role === 'owner' ? screen.list.id : null, occasionId: null,
      wishes: asOwnerWishes(screen.wishes).map((wish) => ({ title: wish.title, url: wish.url, priceCents: wish.price_cents, priority: wish.priority })),
    }
  },
}
registerGiftSource(listsSource)

/** The GiftListRef key of the list a free wish (get_free_wishes) is on: an occasion's list or a list without one. */
export function listKeyOfWish(list: { id: string; occasion_id: string | null }): string {
  return list.occasion_id ? `${OCCASION_PREFIX}${list.occasion_id}` : `${LIST_PREFIX}${list.id}`
}

/** Wave 2b: followed people and lists without an occasion plug in here (once, at module load). */
export function registerGiftSource(source: GiftSource): void {
  if (!sources.some((known) => known.id === source.id)) sources.push(source)
}

export function giftSources(): readonly GiftSource[] {
  return sources
}

function nearest(list: GiftListRef): number {
  const at = list.startsAt ? Date.parse(list.startsAt) : Number.NaN
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER
}

/** Everyone of every source, one row per person (same key = same person), the nearest occasion first. */
export async function loadPeople(ctx: GiftSourceContext): Promise<GiftPerson[]> {
  const lists = await Promise.all(giftSources().map((source) => source.people(ctx)))
  const byKey = new Map<string, GiftPerson>()
  for (const person of lists.flat()) {
    if (person.profileId === ctx.userId || person.lists.length === 0) continue
    const known = byKey.get(person.key)
    if (!known) {
      byKey.set(person.key, { ...person, lists: [...person.lists] })
      continue
    }
    for (const list of person.lists) if (!known.lists.some((own) => own.key === list.key)) known.lists.push(list)
  }
  const people = [...byKey.values()]
  for (const person of people) person.lists.sort((a, b) => nearest(a) - nearest(b))
  return people.sort((a, b) => nearest(a.lists[0] as GiftListRef) - nearest(b.lists[0] as GiftListRef) || a.name.localeCompare(b.name))
}

export async function loadMyLists(ctx: GiftSourceContext): Promise<GiftListRef[]> {
  const lists = await Promise.all(giftSources().map((source) => source.myLists(ctx)))
  return lists.flat().sort((a, b) => nearest(a) - nearest(b))
}

export function loadList(ref: GiftListRef, ctx: GiftSourceContext): Promise<LoadedList> {
  const source = giftSources().find((candidate) => candidate.id === ref.sourceId)
  if (!source) return Promise.reject(new Error(`unknown gift source ${ref.sourceId}`))
  return source.loadList(ref, ctx)
}

// ---- hooks (memory only: the 'gifts' root is never persisted) ---------------------------------------------------

export const giftKeys = {
  people: (userId: string) => ['gifts', 'people', userId] as const,
  myLists: (userId: string) => ['gifts', 'myLists', userId] as const,
  list: (userId: string, key: string) => ['gifts', 'list', userId, key] as const,
}

export function useGiftPeople(userId: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: giftKeys.people(userId),
    queryFn: () => loadPeople({ userId, queryClient }),
    // recomputed on every visit: cheap (the feed in memory), and a person I no longer share an occasion with goes
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

export function useMyGiftLists(userId: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: giftKeys.myLists(userId),
    queryFn: () => loadMyLists({ userId, queryClient }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/** The loaded lists of a screen: their wishes, and whether any is still on its way or failed. */
export interface LoadedLists {
  lists: LoadedList[]
  pending: boolean
  /** every list failed (nothing to show) */
  failed: boolean
  /** a list is still missing because the device is offline (TanStack waits, paused, until it is back) */
  offline: boolean
  refetchFailed: () => void
}

function combineLists(results: ReadonlyArray<UseQueryResult<LoadedList>>): LoadedLists {
  return {
    lists: results.flatMap((result) => (result.data ? [result.data] : [])),
    pending: results.some((result) => result.isPending),
    offline: results.some((result) => result.isPending && result.fetchStatus === 'paused'),
    failed: results.length > 0 && results.every((result) => result.isError),
    refetchFailed: () => {
      for (const result of results) if (result.isError) void result.refetch()
    },
  }
}

/** The wishes of these lists (each one request at most, shared with the occasion screens). */
export function useLoadedLists(userId: string, refs: readonly GiftListRef[]): LoadedLists {
  const queryClient = useQueryClient()
  return useQueries({
    queries: refs.map((ref) => ({
      queryKey: giftKeys.list(userId, ref.key),
      queryFn: () => loadList(ref, { userId, queryClient }),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
    combine: combineLists,
  })
}
