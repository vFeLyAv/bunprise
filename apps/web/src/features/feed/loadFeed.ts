import { onlineManager, type QueryClient } from '@tanstack/react-query'
import { ensureNamespaces } from '../../lib/i18n'
import { feedQuery } from '../../lib/queries'

/**
 * Route loader of /soon: translations + the feed in the query cache before the screen renders,
 * so the screen and `useQuery(feedQuery())` share one cache entry (docs/contract.md §4).
 *
 * - Never throws for the data: a failed get_feed is shown inline by the screen with a retry
 *   (the root error page would hide the top bar and the "new occasion" button).
 * - Never waits for a paused fetch: offline (networkMode 'online') the query would pause until the
 *   connection returns; the screen shows the persisted feed or its offline state instead.
 * - Cached data (memory or the opted-in offline snapshot) resolves immediately; the screen refreshes
 *   it quietly once it is stale.
 */
export async function loadFeed(queryClient: QueryClient): Promise<void> {
  await Promise.all([ensureNamespaces('feed'), warmFeed(queryClient)])
}

function warmFeed(queryClient: QueryClient): Promise<void> {
  if (!onlineManager.isOnline()) return Promise.resolve()
  return queryClient.ensureQueryData(feedQuery()).then(
    () => undefined,
    () => undefined,
  )
}
