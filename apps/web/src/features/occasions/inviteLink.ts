import { useSyncExternalStore } from 'react'
import type { OccasionScreenInvite } from '../../lib/api/types'

// The invite link handed out in THIS tab, per host account and occasion — memory only, never
// browser storage or the URL (the database keeps only the token's hash, so this is the one place
// it can still be shown). It survives moving between screens, so the host can share the same link
// again instead of revoking it with a new one; a reload or sign-out (full reload) forgets it.

export interface InviteLink {
  url: string
  /** Date.now() when the server handed out the token */
  at: number
}

const links = new Map<string, InviteLink>()
const listeners = new Set<() => void>()
const key = (userId: string, occasionId: string) => `${userId}:${occasionId}`

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function rememberInviteLink(userId: string, occasionId: string, url: string): void {
  links.set(key(userId, occasionId), { url, at: Date.now() })
  for (const listener of listeners) listener()
}

export function useRememberedInviteLink(userId: string, occasionId: string): InviteLink | null {
  return useSyncExternalStore(
    subscribe,
    () => links.get(key(userId, occasionId)) ?? null,
    () => null,
  )
}

/**
 * Shown while the server still reports an active invite, or while the screen data is older than
 * the link (its refetch is on the way). Newer data without an invite means the server revoked it
 * (a guest was removed, the link expired). Limit: a link revoked from ANOTHER device while a newer
 * one is active cannot be told apart — the token itself is never readable.
 */
export function visibleInviteLink(link: InviteLink | null, invite: OccasionScreenInvite | null, updatedAt: number): string | null {
  if (!link) return null
  return invite?.active || link.at >= updatedAt ? link.url : null
}

/** Tests only. */
export function forgetInviteLinksForTests(): void {
  links.clear()
  for (const listener of listeners) listener()
}
