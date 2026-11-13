import { AppError, isAppError } from '../errors'
import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import { FeatureUnavailableError, isFeatureUnavailableError, throwIfUnavailable } from './unavailable'

// ONE WISH IN SEVERAL LISTS (supabase/migrations/20261027200000_shared_wishes.sql, docs/spec/shared-wishes-design.md).
// OWNER-ONLY module: every call is about my own wishes and lists; no answer here depends on reservations (the database
// never touches them for these calls). Online only and server-confirmed (no optimistic success). Pinned to ONE account.
//
// Build flag VITE_SHARED_WISHES (sharedWishesEnabled): without it the app never calls these and keeps the old "move"
// behaviour. With it, the app TRIES add_wishes_to_list first; a server without the migration (FeatureUnavailableError)
// or with the database switch off ('not_allowed' → SharedWishesOffError) makes the caller fall back to moving.

/** The release flag: on in the demo and with `VITE_SHARED_WISHES=1` (after 20261027200000 is pushed). */
export function sharedWishesEnabled(env: { VITE_DEMO?: unknown; VITE_SHARED_WISHES?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_SHARED_WISHES === '1'
}

/** The database's switch "add to more lists" is off (add_wishes_to_list answered not_allowed). */
export class SharedWishesOffError extends FeatureUnavailableError {
  constructor(cause?: unknown) {
    super('shared_wishes', cause)
    this.name = 'SharedWishesOffError'
  }
}

/** Should the caller fall back to the old "move" flow? (no migration / switch off) */
export function isSharedWishesUnavailable(err: unknown): boolean {
  return err instanceof SharedWishesOffError || isFeatureUnavailableError(err, 'shared_wishes')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * add_wishes_to_list(p_list_id, p_wish_ids) → { ok, added } — puts some of MY wishes (from lists without an
 * occasion) into MY occasion's list as well: the SAME wish (photo, price, "Erhalten" and the one reservation are
 * shared). Already there = nothing to do. Refusals: 'not_found' (not my list / not my wish), 'validation' (received,
 * from an occasion, > 50), 'limit_reached' (10 lists per wish), 'consent_required', SharedWishesOffError /
 * FeatureUnavailableError → fall back to moving.
 */
export function addWishesToList(listId: string, wishIds: readonly string[], expectedUserId?: string): Promise<{ added: number }> {
  return timed('add_wishes_to_list', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('add_wishes_to_list', { p_list_id: listId, p_wish_ids: [...wishIds] })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('shared_wishes', result.error)
    let data: unknown
    try {
      data = unwrap(result)
    } catch (err) {
      if (isAppError(err, 'not_allowed')) throw new SharedWishesOffError(err)
      throw err
    }
    if (!isRecord(data) || data.ok !== true || typeof data.added !== 'number') throw new AppError('generic')
    return { added: data.added }
  }))
}

/** remove_wish_from_list(p_wish_id, p_list_id) → { ok } — "Aus „…“ entfernen"; its only list: 'validation'. */
export function removeWishFromList(wishId: string, listId: string, expectedUserId?: string): Promise<void> {
  return timed('remove_wish_from_list', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('remove_wish_from_list', { p_wish_id: wishId, p_list_id: listId })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('shared_wishes', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}

/** delete_wish_everywhere(p_wish_id) → { ok } — "Überall löschen" (a plain REST delete refuses a shared wish). */
export function deleteWishEverywhere(wishId: string, expectedUserId?: string): Promise<void> {
  return timed('delete_wish_everywhere', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('delete_wish_everywhere', { p_wish_id: wishId })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('shared_wishes', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}

/** dismiss_received_prompt(p_occasion_id) → { ok } — the host closes "Was hast du bekommen?" for this occasion. */
export function dismissReceivedPrompt(occasionId: string, expectedUserId?: string): Promise<void> {
  return timed('dismiss_received_prompt', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('dismiss_received_prompt', { p_occasion_id: occasionId })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('shared_wishes', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}
