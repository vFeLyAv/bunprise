import { AppError, isAppError } from '../errors'
import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import { FeatureUnavailableError, throwIfUnavailable } from './unavailable'

// "ANZAHL" + "PASST ZUSAMMEN" (supabase/migrations/20261030120000_wish_quantity_together.sql, Felix 30.10).
// OWNER-ONLY module: the flags and the owner's own links. Nothing here depends on reservations — the joint reservation
// of a GIVER lives in lib/api/reservations.ts (reserveTogether), never here.
//
// Build flags (both '1' in scripts/release-web.ps1 since the 6th release, Felix 31.10 — with the database switch
// 20261031130000_wish_extras_on.sql and the pilot-6 privacy text; on in the demo): VITE_WISH_QUANTITY shows the stepper in the form and "4 Stück" in the sheet; VITE_WISH_TOGETHER shows
// "Passt gut zu …" in the owner's ⋯, "Passt zusammen mit: …" in the sheet and "Beides reservieren" for friends.

type Env = { VITE_DEMO?: unknown; VITE_WISH_QUANTITY?: unknown; VITE_WISH_TOGETHER?: unknown }

/** "Anzahl": on in the demo and with `VITE_WISH_QUANTITY=1`. */
export function wishQuantityEnabled(env: Env = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_WISH_QUANTITY === '1'
}

/** "Passt zusammen": on in the demo and with `VITE_WISH_TOGETHER=1`. */
export function wishTogetherEnabled(env: Env = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_WISH_TOGETHER === '1'
}

/** The pieces a wish may ask for (the database's CHECK). */
export const QUANTITY_MIN = 1
export const QUANTITY_MAX = 10
/** At most this many partners per wish (set_wish_links). */
export const TOGETHER_MAX = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * set_wish_links(p_wish_id, p_linked_ids) → { ok, linked } — "Passt gut zu …": REPLACES the partners of one of MY
 * wishes (an empty list removes them). Server-confirmed, online only. Refusals: 'not_found' (not my wish / gone),
 * 'validation', 'limit_reached' (a partner would get more than 10), FeatureUnavailableError (no migration or the
 * database switch is off — "Das geht bald").
 */
export function setWishLinks(wishId: string, linkedIds: readonly string[], expectedUserId?: string): Promise<{ linked: number }> {
  return timed('set_wish_links', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('set_wish_links', { p_wish_id: wishId, p_linked_ids: [...linkedIds] })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('wish_together', result.error)
    let data: unknown
    try {
      data = unwrap(result)
    } catch (err) {
      if (isAppError(err, 'not_allowed')) throw new FeatureUnavailableError('wish_together', err)
      throw err
    }
    if (!isRecord(data) || data.ok !== true || typeof data.linked !== 'number') throw new AppError('generic')
    return { linked: data.linked }
  }))
}
