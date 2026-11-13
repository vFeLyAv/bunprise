import { useQuery, type QueryClient } from '@tanstack/react-query'
import { isAppError } from '../../lib/errors'
import { occasionScreenQuery } from '../../lib/queries'

// Data access of the occasion screens: ONE RPC per screen (get_occasion_screen via the shared
// occasionScreenQuery factory, never persisted). Loaders start it, components read the same entry.

/**
 * "Not found" and "no access" are one final answer: the RPC never tells them apart, and the
 * screen shows one text for both (product S15). No retries for them.
 */
export function isUnavailable(error: unknown): boolean {
  return isAppError(error, 'not_found') || isAppError(error, 'not_allowed') || isAppError(error, 'forbidden')
}

function retryTransient(failureCount: number, error: unknown): boolean {
  if (isUnavailable(error) || isAppError(error, 'session_expired') || isAppError(error, 'not_authenticated')) return false
  return failureCount < 1
}

/** The shared factory plus "do not retry final answers" — loader and component use the same options. */
export function occasionScreenOptions(occasionId: string) {
  return { ...occasionScreenQuery(occasionId), retry: retryTransient }
}

/**
 * Route loader: starts the request without blocking the navigation, so the screen (and its
 * shared-element transition) appears at once with a skeleton (design-system 2.6). Intent preloading
 * (router `defaultPreload: 'intent'`; the feed cards: hover / focus only, never touch —
 * features/feed/useIntentPreload.ts) thereby fetches the data early, too.
 */
export function prefetchOccasionScreen(queryClient: QueryClient, occasionId: string): void {
  void queryClient.ensureQueryData(occasionScreenOptions(occasionId)).catch(() => undefined)
}

/** Data younger than this counts as "just loaded by the loader" when the screen mounts. */
const JUST_LOADED_MS = 2_000

/**
 * The occasion screen query. Opening the screen refreshes it (fresh reservation state for guests,
 * performance-plan 3.1) unless the loader fetched it a moment ago — no second identical request.
 * Invalidated data (e.g. an optimistic screen whose save finished before the screen mounted) is
 * always refreshed. After a failed loader fetch the error is shown as is (the loader retried).
 */
export function useOccasionScreen(occasionId: string) {
  return useQuery({
    ...occasionScreenOptions(occasionId),
    refetchOnMount: (query) =>
      query.state.isInvalidated || Date.now() - query.state.dataUpdatedAt >= JUST_LOADED_MS ? 'always' : false,
    retryOnMount: false,
  })
}
