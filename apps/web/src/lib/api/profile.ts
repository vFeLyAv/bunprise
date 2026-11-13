import { timed, unwrap, unwrapVoid } from './base'
import { captureAccount, assertCurrentAccount } from './identity'
import { AppError } from '../errors'
import { LIMITS } from '../app'
import { queryClient } from '../query'
import { queryKeys } from '../queryKeys'
import type { Locale, Me } from './types'

/**
 * A profile or legal-record write is on its way or done: the cached get_me proves nothing any more,
 * so the _authed guard asks the server again on the next screen change (lib/consentGate.ts). Called
 * before the request and again when it settled (a timeout may still have been committed). Marks
 * only — no refetch, no data written — so a late call can never fetch or fill in another account.
 */
export function invalidateMe(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.me(), exact: true, refetchType: 'none' })
}

/** get_me(): profile + consents_ok + current legal versions — one call for the guard and settings. */
export function getMe(expectedUserId?: string): Promise<Me> {
  return timed('get_me', async () => {
    const { supabase, userId, accessToken } = await captureAccount(expectedUserId)
    const result = await supabase.rpc('get_me').setHeader('Authorization', `Bearer ${accessToken}`)
    const me = unwrap(result) as unknown as Me
    await assertCurrentAccount(userId)
    if (me.profile?.id !== userId) throw new AppError('session_expired')
    return me
  })
}

/** Own profile row (profiles are created by a database trigger on sign-up). */
export async function getMyProfile(expectedUserId?: string): Promise<Me['profile']> {
  return (await getMe(expectedUserId)).profile
}

export interface ProfilePatch {
  display_name?: string | null
  locale?: Locale
  onboarding_done_at?: string | null
}

/** Only display_name, locale and onboarding_done_at are updatable (column grant). */
export async function updateMyProfile(patch: ProfilePatch, expectedUserId?: string): Promise<Me['profile']> {
  const { supabase, userId, accessToken } = await captureAccount(expectedUserId)
  const values: ProfilePatch = {}
  if ('display_name' in patch) values.display_name = patch.display_name === null ? null : validDisplayName(patch.display_name ?? '')
  if ('locale' in patch) {
    if (patch.locale !== 'de' && patch.locale !== 'en') throw new AppError('invalid_input')
    values.locale = patch.locale
  }
  if ('onboarding_done_at' in patch) values.onboarding_done_at = patch.onboarding_done_at
  invalidateMe()
  try {
    // Returning private columns through REST is intentionally forbidden; get_me is the own-profile path.
    unwrapVoid(await supabase.from('profiles').update(values).eq('id', userId).setHeader('Authorization', `Bearer ${accessToken}`))
    await assertCurrentAccount(userId)
    return (await getMe(userId)).profile
  } finally {
    invalidateMe()
  }
}

/** Validate the original input instead of silently truncating a person's name. */
export function validDisplayName(value: string): string {
  if (!value.trim() || [...value].length > LIMITS.displayName || /[\n\r\t]/.test(value)) throw new AppError('invalid_input')
  return value.trim()
}

/** Sets the display name (≤ 40 chars, single line); used by /welcome/profile. */
export async function setDisplayName(displayName: string, expectedUserId?: string): Promise<void> {
  await updateMyProfile({ display_name: displayName }, expectedUserId)
}

/** Onboarding finished — set once (pilot-decisions §1). */
export async function markOnboardingDone(expectedUserId?: string): Promise<void> {
  await updateMyProfile({ onboarding_done_at: new Date().toISOString() }, expectedUserId)
}

