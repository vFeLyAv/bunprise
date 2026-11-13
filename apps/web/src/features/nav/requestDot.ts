import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api/types'
import { listsEnabled } from '../lists/flag'

/** A cache-only boolean, scoped to this account. No people API enters the navigation bundle. */
export function useRequestDot(userId: string, client: QueryClient): boolean {
  return useSyncExternalStore(
    // QueryCache binds subscribe in its constructor; use its stable function instead of resubscribing each render.
    client.getQueryCache().subscribe,
    () => {
      const me = client.getQueryData<Me>(['me'])
      return listsEnabled() && me?.profile.id === userId && (me.inbox?.follow_requests ?? 0) > 0
    },
    () => false,
  )
}
