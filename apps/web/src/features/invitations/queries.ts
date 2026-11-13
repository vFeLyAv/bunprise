import { useQuery, type QueryClient } from '@tanstack/react-query'
import { getInviteCandidates, getMyInvitations, getOccasionInviteInfo, type InvitationsFrom } from '../../lib/api/invitations'
import type { Me } from '../../lib/api/types'
import { isAppError, type ErrorCode } from '../../lib/errors'
import { queryKeys } from '../../lib/queryKeys'
import { invitesEnabled } from './flag'

// Data of "Freunde einladen" — in MEMORY ONLY (the persist allow-list stays exactly ['feed'], lib/query.ts), wiped
// with the rest of the cache when the account ends here. Every request is pinned to the screen's account.

export const invitationKeys = {
  /** get_my_invitations() — the cards on Start (asked only while get_me counts some) */
  inbox: (userId: string) => ['invitations', 'inbox', userId] as const,
  /** get_invite_candidates(occasion) — the picker */
  candidates: (occasionId: string) => ['invitations', 'candidates', occasionId] as const,
  /** get_occasion_invite_info(occasion) — the occasion screen's part (lazy, after the first paint) */
  info: (occasionId: string) => ['invitations', 'info', occasionId] as const,
}

const FINAL: readonly ErrorCode[] = ['not_found', 'not_allowed', 'forbidden', 'session_expired', 'not_authenticated', 'invite_invalid']

/** A final answer (no access / gone): no retry. */
export function isFinal(error: unknown): boolean {
  return FINAL.some((code) => isAppError(error, code))
}

const retry = (failureCount: number, error: unknown): boolean => !isFinal(error) && failureCount < 1

export function inboxQuery(userId: string) {
  return { queryKey: invitationKeys.inbox(userId), queryFn: () => getMyInvitations(userId), staleTime: 0, retry }
}

export function candidatesQuery(occasionId: string, userId: string) {
  return { queryKey: invitationKeys.candidates(occasionId), queryFn: () => getInviteCandidates(occasionId, userId), staleTime: 0, retry }
}

export function inviteInfoQuery(occasionId: string, userId: string) {
  return { queryKey: invitationKeys.info(occasionId), queryFn: () => getOccasionInviteInfo(occasionId, userId), staleTime: 30_000, retry }
}

/** The occasion screen's invitation part; nothing is asked while the flag is off. */
export function useOccasionInviteInfo(occasionId: string, userId: string, enabled = true) {
  return useQuery({ ...inviteInfoQuery(occasionId, userId), enabled: enabled && invitesEnabled() })
}

/** The cached get_me of THIS account, changed by `patch` (the dot and the privacy switch, optimistic). */
function patchMe(client: QueryClient, userId: string, patch: (me: Me) => Me): void {
  client.setQueryData<Me>(queryKeys.me(), (me) => (me && me.profile.id === userId ? patch(me) : me))
}

/** The dot follows an answered invitation at once (get_me is asked again right after). */
export function setInviteCount(client: QueryClient, userId: string, count: number): void {
  patchMe(client, userId, (me) => ({ ...me, inbox: { follow_requests: me.inbox?.follow_requests ?? 0, ...me.inbox, occasion_invites: Math.max(0, count) } }))
}

export function setMyInvitationsFrom(client: QueryClient, userId: string, value: InvitationsFrom): void {
  patchMe(client, userId, (me) => ({ ...me, profile: { ...me.profile, invitations_from: value } }))
}
