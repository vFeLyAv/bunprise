import { queryOptions } from '@tanstack/react-query'
import { PERSIST_MAX_AGE } from './query'
import { queryKeys } from './queryKeys'
import { getFeed, getOccasionScreen } from './api/occasions'
import { getMe } from './api/profile'
import { getMyReservations } from './api/reservations'

// Query option factories: route loaders (`queryClient.ensureQueryData(feedQuery())`) and
// components (`useQuery(feedQuery())`) share one definition and therefore one cache entry.

/**
 * get_me(): memory only. The _authed guard trusts a successful answer of the signed-in account for
 * 60 s and refreshes it in the background once it is older than this staleTime (lib/consentGate.ts).
 */
export const meQuery = () =>
  queryOptions({
    queryKey: queryKeys.me(),
    queryFn: () => getMe(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

/** Feed "Soon": disk persistence requires the explicit offline-feed preference. */
export const feedQuery = () =>
  queryOptions({
    queryKey: queryKeys.feed(),
    // a wrapper, not `getFeed` itself: its optional parameter is the expected account, not the query context
    queryFn: () => getFeed(),
    gcTime: PERSIST_MAX_AGE,
  })

/**
 * Occasion screen. Always refetched on open so reservation state is fresh for guests
 * (performance-plan.md 3.1); never persisted (pilot-decisions §7).
 */
export const occasionScreenQuery = (occasionId: string) =>
  queryOptions({
    queryKey: queryKeys.occasion(occasionId),
    queryFn: () => getOccasionScreen(occasionId),
    staleTime: 0,
    refetchOnMount: 'always',
  })

/** SECRET: my own reservations. Guest components only; never persisted. */
export const myReservationsQuery = () =>
  queryOptions({
    queryKey: queryKeys.myReservations(),
    queryFn: () => getMyReservations(),
    staleTime: 0,
    gcTime: 60_000,
    meta: { secret: true },
  })
