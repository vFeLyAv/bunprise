import { onlineManager, type QueryClient } from '@tanstack/react-query'
import { getMe } from './api/profile'
import type { Me } from './api/types'
import { meQuery } from './queries'
import { queryKeys } from './queryKeys'

// Consent gate for the _authed layout (pilot-decisions §5): get_me().consents_ok must be true AND
// a display name must exist, otherwise the person goes to /welcome/profile. Imported DYNAMICALLY
// by the guard so the API layer stays out of the initial bundle for anonymous visitors.
//
// Speed without giving up "fail closed" (docs/decisions/2026-10-20-guard-me-cache.md): the guard
// trusts the last SUCCESSFUL get_me of the signed-in account for ME_TRUST_MS. Inside that window a
// screen change passes at once and — once the answer is older than meQuery's staleTime — refreshes
// it in the background. Everything else waits for the server and denies on any failure:
// no answer yet, another account's answer, an invalidated answer (every profile / legal-record write
// marks it, lib/api/profile.ts + consents.ts), an answer older than the window, or a last fetch that
// failed (a failed background refresh ends the trust at once; it never extends it).
// The account boundary wipes the cache whenever the shown account ends (lib/session.ts, lib/query.ts).

/** How long the guard trusts a successful get_me of the signed-in account without asking again. */
export const ME_TRUST_MS = 60_000

function consentsOk(me: Me): boolean {
  return me.consents_ok === true && typeof me.profile?.display_name === 'string' && me.profile.display_name.trim() !== ''
}

/**
 * The cached get_me the guard may use without a request: the last fetch of ['me'] succeeded, nothing
 * invalidated it since, it is younger than ME_TRUST_MS and it is the answer for `userId`. Else null.
 */
export function trustedMe(queryClient: QueryClient, userId: string, now = Date.now()): Me | null {
  if (typeof userId !== 'string' || userId === '') return null
  const state = queryClient.getQueryState<Me>(queryKeys.me())
  if (!state || state.status !== 'success' || state.isInvalidated || state.data === undefined) return null
  const age = now - state.dataUpdatedAt
  if (!(age >= 0 && age < ME_TRUST_MS)) return null
  return state.data.profile?.id === userId ? state.data : null
}

export interface ConsentCheckOptions {
  /**
   * A real screen change (the guard passes `!preload`): a trusted answer older than meQuery's
   * staleTime is refreshed in the background. Preloads (hover / focus intent) never send it.
   */
  refresh?: boolean
}

/**
 * Gate access for `userId` (the account of the local session). An offline/network failure never
 * implies acceptance: without a trusted answer the guard waits for a fresh get_me and denies on error.
 */
export async function hasCurrentConsents(
  queryClient: QueryClient, userId: string, { refresh = true }: ConsentCheckOptions = {},
): Promise<boolean> {
  if (typeof userId !== 'string' || userId === '') return false
  // pinned to the session's account: another current account → session_expired → denied
  const options = { ...meQuery(), queryFn: () => getMe(userId), retry: false, networkMode: 'always' } as const
  const trusted = trustedMe(queryClient, userId)
  if (trusted) {
    // Never blocks. networkMode 'always' + the online check: no paused fetch a later guard could hang on.
    if (refresh && onlineManager.isOnline()) void queryClient.prefetchQuery(options)
    return consentsOk(trusted)
  }
  try {
    const me = await queryClient.fetchQuery({ ...options, staleTime: 0 })
    return me.profile?.id === userId && consentsOk(me)
  } catch {
    return false
  }
}
