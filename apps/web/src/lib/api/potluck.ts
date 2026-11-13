import type { Json } from '../database.types'
import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import type { ExportedData } from './types'
import { isMissingServerFeature } from './unavailable'

// The bring-along list "Mitbringen" (supabase/migrations/20261025150000_potluck.sql). NOT secret: every active
// member of the occasion sees who brings what, the host included — a different promise from the wish list.
// This module therefore knows nothing about the wish list's private part and is safe on the host's screens.
// - The list itself comes with get_occasion_screen (potluck: { max_items, items }), never as an own request.
// - add / rename / delete are optimistic in the UI (features/potluck/cache.ts); claim / unclaim wait for the
//   server (two people can press at the same moment: the second gets already_claimed, never a flash of "Du").
// - Pinned to ONE account (identity.ts asAccount), like every write of the app.

/** add_potluck_item(p_occasion_id, p_title, p_claim) → { id }. Host and active members; at most 50 entries. */
export function addPotluckItem(occasionId: string, title: string, claim: boolean, expectedUserId?: string): Promise<{ id: string }> {
  return timed('add_potluck_item', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('add_potluck_item', { p_occasion_id: occasionId, p_title: title.trim(), p_claim: claim })
      .setHeader('Authorization', bearer(account))
    return unwrap(result) as unknown as { id: string }
  }))
}

/** rename_potluck_item(p_item_id, p_title) → { ok }. The author only. */
export function renamePotluckItem(itemId: string, title: string, expectedUserId?: string): Promise<void> {
  return timed('rename_potluck_item', () => asAccount(expectedUserId, async (account) => {
    unwrap(await account.supabase.rpc('rename_potluck_item', { p_item_id: itemId, p_title: title.trim() }).setHeader('Authorization', bearer(account)))
  }))
}

/** delete_potluck_item(p_item_id) → { ok }. The author or the host. */
export function deletePotluckItem(itemId: string, expectedUserId?: string): Promise<void> {
  return timed('delete_potluck_item', () => asAccount(expectedUserId, async (account) => {
    unwrap(await account.supabase.rpc('delete_potluck_item', { p_item_id: itemId }).setHeader('Authorization', bearer(account)))
  }))
}

/** claim_potluck_item(p_item_id) → { ok } — "Ich bring's mit". One bringer per entry: already_claimed. */
export function claimPotluckItem(itemId: string, expectedUserId?: string): Promise<void> {
  return timed('claim_potluck_item', () => asAccount(expectedUserId, async (account) => {
    unwrap(await account.supabase.rpc('claim_potluck_item', { p_item_id: itemId }).setHeader('Authorization', bearer(account)))
  }))
}

/** unclaim_potluck_item(p_item_id) → { ok } — "Doch nicht". Only the own commitment. */
export function unclaimPotluckItem(itemId: string, expectedUserId?: string): Promise<void> {
  return timed('unclaim_potluck_item', () => asAccount(expectedUserId, async (account) => {
    unwrap(await account.supabase.rpc('unclaim_potluck_item', { p_item_id: itemId }).setHeader('Authorization', bearer(account)))
  }))
}

/** export_my_potluck() — the caller's own entries and commitments, for "Meine Daten herunterladen". A server without
 *  the migration: null (nothing to add). */
export function exportMyPotluck(expectedUserId?: string): Promise<Json | null> {
  return timed('export_my_potluck', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('export_my_potluck').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return null
    return unwrap(result) as Json
  }))
}

/** The export file with my bring-along part (`potluck`, after the RPC's keys); unchanged without one. */
export function withPotluck(data: ExportedData, potluck: Json | null): ExportedData {
  if (potluck === null || typeof data !== 'object' || data === null || Array.isArray(data)) return data
  return { ...(data as Record<string, Json | undefined>), potluck }
}
