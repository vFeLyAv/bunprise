import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import type { MyReservation } from './types'

// SECRET RESERVATIONS — GUEST-ONLY MODULE (pilot-decisions §2–§3, CLAUDE.md).
// - Import this only from guest-view components; owner components must not even reference it.
// - Online only, server-confirmed: NOT optimistic (button in loading state), never queued offline,
//   never persisted. The hamster celebrates after the server answered.
// - The database decides: owners always get 'not_allowed' before it looks at reservations,
//   a second reserver gets 'already_reserved' (partial unique index); the same person again: ok.
// - Pinned to ONE account (identity.ts asAccount): a late answer for a previous account —
//   'already_reserved' included — arrives as session_expired, never as a reservation fact.

/** reserve_wish(p_wish_id) → { ok: true }. */
export function reserveWish(wishId: string, expectedUserId?: string): Promise<void> {
  return timed('reserve_wish', () => asAccount(expectedUserId, async (account) => {
    unwrap(await account.supabase.rpc('reserve_wish', { p_wish_id: wishId }).setHeader('Authorization', bearer(account)))
  }))
}

/**
 * reserve_together(p_wish_id, p_with_ids) → { ok, reserved } — "Beides reservieren" / "Alle reservieren"
 * (20261030120000): the wish AND its linked wishes in ONE database transaction, each by reserve_wish's own rules —
 * all or nothing. Codes like reserveWish ('already_reserved' when ANY of them is taken: then none is reserved), plus
 * 'validation' (not linked any more) and 'not_found' (one of them gone / not readable). Not optimistic.
 */
export function reserveTogether(wishId: string, withIds: readonly string[], expectedUserId?: string): Promise<void> {
  return timed('reserve_together', () => asAccount(expectedUserId, async (account) => {
    unwrap(await account.supabase.rpc('reserve_together', { p_wish_id: wishId, p_with_ids: [...withIds] }).setHeader('Authorization', bearer(account)))
  }))
}

/** cancel_reservation(p_wish_id) → { ok: true }. Only the reserver's own active reservation. */
export function cancelReservation(wishId: string, expectedUserId?: string): Promise<void> {
  return timed('cancel_reservation', () => asAccount(expectedUserId, async (account) => {
    unwrap(await account.supabase.rpc('cancel_reservation', { p_wish_id: wishId }).setHeader('Authorization', bearer(account)))
  }))
}

/** my_reservations() — own active reservations + those ended by others in the last 90 days. */
export function getMyReservations(expectedUserId?: string): Promise<MyReservation[]> {
  return timed('my_reservations', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('my_reservations').setHeader('Authorization', bearer(account))
    return unwrap(result) as unknown as MyReservation[]
  }))
}
