import { APP_URL } from '../app'
import { timed, unwrap, unwrapVoid } from './base'
import { asAccount, bearer } from './identity'
import type { InviteMeta } from './types'

// Invite links (pilot-decisions §4, migration create_invite / accept_invite). The token is shown
// once; the database keeps only its hash. The link carries the token in the URL FRAGMENT
// (https://<app>/i#<token>) so it never reaches server logs or Referer headers. Links are
// impersonal: nothing about reservations ever appears in them (brief 7.5a).
// Every call is pinned to one account (identity.ts asAccount). acceptInvite gets the account the
// "Beitreten" screen was shown for: joining never happens for another account than the one named there.

/** 64 hex chars — the shape create_invite() returns. */
export function isInviteTokenShape(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token)
}

/** Public URL for a token: https://<app>/i#<token>. */
export function buildInviteUrl(token: string): string {
  return `${APP_URL}/i#${token}`
}

/** The token from a location hash ('#abc' or 'abc'), or null. */
export function tokenFromHash(hash: string | null | undefined): string | null {
  const token = (hash ?? '').replace(/^#/, '').trim()
  return token === '' ? null : token
}

/**
 * Host creates a link — create_invite(p_occasion_id) → { token }. Revokes the occasion's older
 * active links; expires_at = max(now + 14 days, starts_at + 7 days); 50 uses.
 */
export function createInvite(occasionId: string, expectedUserId?: string): Promise<string> {
  return timed('create_invite', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('create_invite', { p_occasion_id: occasionId }).setHeader('Authorization', bearer(account))
    const payload = unwrap(result) as unknown as { token: string }
    return payload.token
  }))
}

/**
 * Signed-in person joins via a link — accept_invite(p_token) → { occasion_id } (idempotent for members).
 * `expectedUserId`: the account of the "Beitreten" screen; another current account → session_expired,
 * nothing is sent.
 */
export function acceptInvite(token: string, expectedUserId?: string): Promise<string> {
  return timed('accept_invite', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('accept_invite', { p_token: token }).setHeader('Authorization', bearer(account))
    const payload = unwrap(result) as unknown as { occasion_id: string }
    return payload.occasion_id
  }))
}

/** Host lists their links (metadata only; token_hash is not readable). */
export function listInvites(occasionId: string, expectedUserId?: string): Promise<InviteMeta[]> {
  return asAccount(expectedUserId, async (account) => {
    const result = await account.supabase
      .from('invites')
      .select('id, occasion_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at')
      .eq('occasion_id', occasionId)
      .order('created_at', { ascending: false })
      .setHeader('Authorization', bearer(account))
    return unwrap(result)
  })
}

/** Revokes one link by hand (create_invite already revokes older ones). Revocation is final. */
export function revokeInvite(inviteId: string, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await account.supabase.from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId)
      .setHeader('Authorization', bearer(account)))
  })
}

export function isInviteActive(invite: InviteMeta, now: Date = new Date()): boolean {
  return invite.revoked_at === null && new Date(invite.expires_at) > now && invite.use_count < invite.max_uses
}
