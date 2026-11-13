import { timed, unwrap, unwrapNullable, unwrapVoid } from './base'
import { asAccount, bearer } from './identity'
import type { FeedScreen, Occasion, OccasionInput, OccasionScreen, Rsvp } from './types'

const OCCASION_COLUMNS =
  'id, host_id, title, starts_at, ends_at, tz, all_day, place_text, description, cancelled_at, created_at, updated_at'

// Every call acts for ONE account (lib/api/identity.ts asAccount): it is sent with the captured bearer
// token and its answer is discarded (session_expired) if the account changed meanwhile.
// `expectedUserId` = the account of the screen that started it (route session / captureEpoch().userId).

// ---- one RPC per screen -------------------------------------------------------------------

/** Feed "Soon" — get_feed() → { upcoming, past }. Hosts' rows never carry a reservation count. */
export function getFeed(expectedUserId?: string): Promise<FeedScreen> {
  return timed('get_feed', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('get_feed').setHeader('Authorization', bearer(account))
    return unwrap(result) as unknown as FeedScreen
  }))
}

/** Occasion screen — get_occasion_screen(p_occasion_id). Owners never receive reservation data. */
export function getOccasionScreen(occasionId: string, expectedUserId?: string): Promise<OccasionScreen> {
  return timed('get_occasion_screen', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('get_occasion_screen', { p_occasion_id: occasionId })
      .setHeader('Authorization', bearer(account))
    return unwrap(result) as unknown as OccasionScreen
  }))
}

// ---- host actions (REST, RLS: host only) ----------------------------------------------------

/** Client-side id for an occasion, so the screen can open before the server answers (pilot-decisions §1). */
export function newOccasionId(): string {
  return crypto.randomUUID()
}

/**
 * Creates an occasion. A database trigger adds the host membership AND the single wishlist
 * (owner = recipient = host, title = occasion title) — nothing else to call.
 */
export function createOccasion(input: OccasionInput, expectedUserId?: string): Promise<{ occasionId: string }> {
  return asAccount(expectedUserId, async (account) => {
    const created = await account.supabase
      .from('occasions')
      .insert({ ...input, title: input.title.trim(), host_id: account.userId })
      .select('id')
      .single()
      .setHeader('Authorization', bearer(account))
    return { occasionId: unwrap(created).id }
  })
}

export function updateOccasion(
  occasionId: string,
  patch: Partial<Omit<OccasionInput, 'id'>> & { cancelled_at?: string | null },
  expectedUserId?: string,
): Promise<Occasion> {
  return asAccount(expectedUserId, async (account) => {
    const values = { ...patch }
    if (typeof values.title === 'string') values.title = values.title.trim()
    const result = await account.supabase.from('occasions').update(values).eq('id', occasionId).select(OCCASION_COLUMNS).single()
      .setHeader('Authorization', bearer(account))
    return unwrap(result)
  })
}

/** Deletes the occasion with everything in it (cascade). Guests get no reservation hint of any kind. */
export function deleteOccasion(occasionId: string, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await account.supabase.from('occasions').delete().eq('id', occasionId).setHeader('Authorization', bearer(account)))
  })
}

/** Exact address — groundwork, not used by the pilot UI (pilot-decisions §1). null removes it. */
export function setOccasionAddress(occasionId: string, address: string | null, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    const trimmed = address?.trim() ?? ''
    if (trimmed === '') {
      unwrapVoid(await account.supabase.from('occasion_addresses').delete().eq('occasion_id', occasionId)
        .setHeader('Authorization', bearer(account)))
      return
    }
    unwrapVoid(await account.supabase.from('occasion_addresses').upsert({ occasion_id: occasionId, address: trimmed })
      .setHeader('Authorization', bearer(account)))
  })
}

export function getOccasionAddress(occasionId: string, expectedUserId?: string): Promise<string | null> {
  return asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.from('occasion_addresses').select('address').eq('occasion_id', occasionId).maybeSingle()
      .setHeader('Authorization', bearer(account))
    return unwrapNullable(result)?.address ?? null
  })
}

/** Host removes a guest — remove_member(). Ends that guest's reservations silently. */
export function removeMember(occasionId: string, profileId: string, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await account.supabase.rpc('remove_member', { p_occasion_id: occasionId, p_profile_id: profileId })
      .setHeader('Authorization', bearer(account)))
  })
}

// ---- guest actions ---------------------------------------------------------------------------

/** My RSVP in an occasion (own active membership row; column grant: rsvp only). Optimistic-safe. */
export function setRsvp(occasionId: string, rsvp: Rsvp, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(
      await account.supabase.from('occasion_members').update({ rsvp }).eq('occasion_id', occasionId).eq('profile_id', account.userId)
        .setHeader('Authorization', bearer(account)),
    )
  })
}

/** Guest leaves — leave_occasion(). Ends own reservations in that occasion. */
export function leaveOccasion(occasionId: string, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await account.supabase.rpc('leave_occasion', { p_occasion_id: occasionId }).setHeader('Authorization', bearer(account)))
  })
}
