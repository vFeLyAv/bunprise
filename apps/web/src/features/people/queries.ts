import { useQuery, type QueryClient } from '@tanstack/react-query'
import { getPeopleScreen, getProfileCard, peekFollowLink } from '../../lib/api/follows'
import type { PeopleScreen, PersonCard } from '../../lib/api/follows.types'
import { getMe } from '../../lib/api/profile'
import type { Me } from '../../lib/api/types'
import { isAppError } from '../../lib/errors'
import { queryKeys } from '../../lib/queryKeys'
import { listsEnabled } from '../lists/flag'
import { listsKeys } from '../lists/queries'

// Data of the people screens: ONE RPC per screen (get_people_screen / get_profile_card / peek_follow_link), in
// MEMORY ONLY — the persist allow-list stays exactly ['feed'] (lib/query.ts; W05): nobody's relations ever touch
// the disk, and the account boundary wipes these keys with the rest of the cache. Every request is pinned to the
// account of the screen (the route session's user id).

export const peopleKeys = {
  /** get_people_screen() — /people */
  screen: () => ['people'] as const,
  /** get_profile_card(id) — /people/$profileId */
  person: (profileId: string) => ['person', profileId] as const,
  /** peek_follow_link(code) — the gate /f; never reused (staleTime 0, gcTime 0) */
  peek: (code: string, userId: string) => ['followPeek', userId, code] as const,
}

const PERSON_ROOT = peopleKeys.person('')[0]

/** Unknown, foreign, blocked, gone: one final answer (no retry, one page). */
export function isPersonUnavailable(error: unknown): boolean {
  return isAppError(error, 'not_found') || isAppError(error, 'not_allowed') || isAppError(error, 'forbidden')
}

function retryTransient(failureCount: number, error: unknown): boolean {
  if (isPersonUnavailable(error) || isAppError(error, 'session_expired') || isAppError(error, 'not_authenticated')) return false
  return failureCount < 1
}

export function peopleScreenQuery(userId: string) {
  return {
    queryKey: peopleKeys.screen(),
    // a wrapper: the expected account is the screen's, never TanStack's query context
    queryFn: () => getPeopleScreen(userId),
    staleTime: 0,
    retry: retryTransient,
  }
}

export function personQuery(profileId: string, userId: string) {
  return {
    queryKey: peopleKeys.person(profileId),
    queryFn: () => getProfileCard(profileId, userId),
    staleTime: 0,
    retry: retryTransient,
  }
}

/** The gate always asks the server afresh (the name it shows decides what the person sends). */
export function followPeekQuery(code: string, userId: string) {
  return {
    // Distinct links must not share an in-flight request. This key stays in memory and is discarded on unmount.
    queryKey: peopleKeys.peek(code, userId),
    queryFn: () => peekFollowLink(code, userId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  } as const
}

/** Route loaders: start the request without blocking the navigation (the screen shows its skeleton). */
export function prefetchPeopleScreen(queryClient: QueryClient, userId: string): void {
  void queryClient.prefetchQuery(peopleScreenQuery(userId)).catch(() => undefined)
}

export function prefetchPerson(queryClient: QueryClient, profileId: string, userId: string): void {
  void queryClient.prefetchQuery(personQuery(profileId, userId)).catch(() => undefined)
}

/** Data younger than this counts as "just loaded by the loader" when the screen mounts (no second request). */
const JUST_LOADED_MS = 2_000

const refetchUnlessJustLoaded = (query: { state: { isInvalidated: boolean; dataUpdatedAt: number } }) =>
  query.state.isInvalidated || Date.now() - query.state.dataUpdatedAt >= JUST_LOADED_MS ? ('always' as const) : false

export function usePeopleScreen(userId: string) {
  return useQuery({ ...peopleScreenQuery(userId), refetchOnMount: refetchUnlessJustLoaded, retryOnMount: false })
}

export function usePerson(profileId: string, userId: string) {
  return useQuery({ ...personQuery(profileId, userId), refetchOnMount: refetchUnlessJustLoaded, retryOnMount: false })
}

// ---- after an own action: refresh what shows relations (memory only) ------------------------------------------

/**
 * The people screen, every person card, the lists tab (its counters, "Freunde", suggestions) and a person's
 * follower lists change with a relation — they are refetched; nothing is guessed on the client.
 */
export async function invalidatePeople(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: peopleKeys.screen() }),
    queryClient.invalidateQueries({ queryKey: [PERSON_ROOT] }),
    queryClient.invalidateQueries({ queryKey: listsKeys.overview() }),
  ])
}

export function updatePeopleScreen(queryClient: QueryClient, update: (screen: PeopleScreen) => PeopleScreen): void {
  queryClient.setQueryData<PeopleScreen>(peopleKeys.screen(), (screen) => (screen ? update(screen) : screen))
}

export function updatePerson(queryClient: QueryClient, profileId: string, update: (card: PersonCard) => PersonCard): void {
  queryClient.setQueryData<PersonCard>(peopleKeys.person(profileId), (card) => (card ? update(card) : card))
}

// ---- get_me: the guard's own answer (['me']) -------------------------------------------------------------------

/**
 * The same cache entry and timings as lib/queries.ts meQuery() (30 s stale, 5 min in memory), pinned to the
 * screen's account — built here so the people modules never import lib/queries (it brings the reservation
 * module along for myReservationsQuery; contract.md §1, W01).
 */
export function ownMeQuery(userId: string) {
  return {
    queryKey: queryKeys.me(),
    queryFn: () => getMe(userId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  }
}

// ---- the dot on the "Listen" tab (integration step: features/nav) ------------------------------------------------

/**
 * The number of follow requests VISIBLE to me, from get_me().inbox.follow_requests — the answer the _authed guard
 * already keeps in ['me']: this hook never sends a request of its own (enabled: false). Only this account's
 * answer counts; 0 without the flag, without an answer, or before the wave-2 migrations (no `inbox` key).
 */
export function useFollowRequestCount(userId: string): number {
  const query = useQuery({
    ...ownMeQuery(userId),
    enabled: false,
    select: (me: Me) => (me.profile.id === userId ? Math.max(0, Math.trunc(me.inbox?.follow_requests ?? 0)) : 0),
  })
  return listsEnabled() ? (query.data ?? 0) : 0
}

/**
 * Keep the cached get_me's request count in step with what this account just saw or did (the people screen
 * loaded, a request was answered) — WITHOUT changing what the consent guard trusts: only a successful, not
 * invalidated answer of this very account is touched, and its `dataUpdatedAt` is kept (lib/consentGate.ts
 * trusts an answer for 60 s from that moment; a patch must never extend or restore that trust).
 */
export function patchFollowRequestCount(queryClient: QueryClient, userId: string, next: (count: number) => number): void {
  patchTrustedMe(queryClient, userId, (me) => {
    if (!me.inbox) return me
    const count = Math.max(0, Math.trunc(next(me.inbox.follow_requests)))
    return count === me.inbox.follow_requests ? me : { ...me, inbox: { ...me.inbox, follow_requests: count } }
  })
}

/** Profil › Privatsphäre: the own in_suggestions the server just confirmed (same rules as above). */
export function patchInSuggestions(queryClient: QueryClient, userId: string, value: boolean): void {
  patchTrustedMe(queryClient, userId, (me) =>
    me.profile.in_suggestions === value ? me : { ...me, profile: { ...me.profile, in_suggestions: value } })
}

/** Only a successful, not invalidated get_me of THIS account, keeping its timestamp (the guard's trust window). */
function patchTrustedMe(queryClient: QueryClient, userId: string, patch: (me: Me) => Me): void {
  const state = queryClient.getQueryState<Me>(queryKeys.me())
  const me = state?.data
  if (!state || state.status !== 'success' || state.isInvalidated || !me || me.profile.id !== userId) return
  const next = patch(me)
  if (next !== me) queryClient.setQueryData<Me>(queryKeys.me(), next, { updatedAt: state.dataUpdatedAt })
}
