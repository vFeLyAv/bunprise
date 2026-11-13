import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api/types'
import { invitesEnabled } from './flag'

// The number behind the dot on "Start" and the card on Start: cache-only, from the guard's get_me (['me'],
// inbox.occasion_invites — the same visibility rule as the list, in the database). Part of the first screen, so it
// stays tiny: no invitation API, no component — the cards themselves are a lazy chunk (./InvitationInbox).

export function inviteCountOf(me: Me | undefined, userId: string): number {
  if (!invitesEnabled() || me?.profile.id !== userId) return 0
  const count = me.inbox?.occasion_invites ?? 0
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0
}

/** Scoped to this account; 0 while the flag is off or get_me has not answered. */
export function useInviteCount(userId: string, client: QueryClient): number {
  return useSyncExternalStore(
    client.getQueryCache().subscribe,
    () => inviteCountOf(client.getQueryData<Me>(['me']), userId),
    () => 0,
  )
}
