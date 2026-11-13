import { useCallback, useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api/types'
import { onAccountEnded } from '../../lib/accountBoundary'
import { queryKeys } from '../../lib/queryKeys'

// The signed-in person's display name for the avatar in the tab bar (K11: the Profil tab IS the avatar).
// Source: the cached get_me (['me']) that the _authed guard keeps fresh — read straight from the cache, so
// the bar never sends a request of its own (one RPC per screen) and needs no observer. /settings opts out
// of the consent check and may be opened directly; the settings screen then reports the name it loaded.
// Account boundary: a name is only used for the account it belongs to.

let reported: { userId: string; name: string } | null = null
const listeners = new Set<() => void>()

/** Called by the settings screen after its own get_me (memory only, never persisted). */
export function reportProfileName(userId: string, name: string | null | undefined): void {
  const clean = name?.trim() ?? ''
  const next = clean ? { userId, name: clean } : null
  if (reported?.userId === next?.userId && reported?.name === next?.name) return
  reported = next
  for (const listener of listeners) listener()
}

function subscribeReported(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

onAccountEnded(() => reportProfileName('', null))

/** The name of `userId` from a get_me answer, or '' (another account's answer, no name yet). */
export function nameFromMe(me: Me | undefined, userId: string): string {
  return me && me.profile?.id === userId ? (me.profile.display_name?.trim() ?? '') : ''
}

export function useMyName(userId: string, queryClient: QueryClient): string | null {
  const subscribeCache = useCallback(
    (listener: () => void) => queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash === JSON.stringify(queryKeys.me())) listener()
    }),
    [queryClient],
  )
  const fromMe = useSyncExternalStore(
    subscribeCache,
    () => nameFromMe(queryClient.getQueryData<Me>(queryKeys.me()), userId),
    () => '',
  )
  const fallback = useSyncExternalStore(
    subscribeReported,
    () => (reported?.userId === userId ? reported.name : null),
    () => null,
  )
  return fromMe || fallback
}
