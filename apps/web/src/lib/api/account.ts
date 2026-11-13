import { getSupabase } from '../supabase'
import { APP_NAME } from '../app'
import { clearAccountDeviceState } from '../query'
import { AppError, toAppError } from '../errors'
import { isoDateForFilename } from '../time'
import { requireUserId, timed, unwrap, unwrapVoid } from './base'
import type { ExportedData, Me, ReportTargetKind } from './types'
import { assertCurrentAccount, captureAccount } from './identity'

// Account self-service (legal-pilot.md 1.5–1.7, pilot-decisions §2).

/**
 * export_my_data() (security invoker): everything I created, my reservations as reserver —
 * never reservations on my own wishes. The e-mail is not in the RPC; it is added here from
 * auth.getUser() as `account.email` (pilot-decisions §2, G-19).
 */
export function exportMyData(expectedUserId?: string): Promise<ExportedData> {
  return timed('export_my_data', async () => {
    const { supabase, userId, accessToken } = await captureAccount(expectedUserId)
    const [result, user] = await Promise.all([
      supabase.rpc('export_my_data').setHeader('Authorization', `Bearer ${accessToken}`),
      supabase.auth.getUser(accessToken),
    ])
    if (user.error) throw toAppError(user.error)
    if (user.data.user?.id !== userId) throw new AppError('session_expired')
    const data = unwrap(result)
    if (typeof data !== 'object' || data === null || Array.isArray(data) ||
        typeof data.profile !== 'object' || data.profile === null || Array.isArray(data.profile) || data.profile.id !== userId) {
      throw new AppError('generic')
    }
    await assertCurrentAccount(userId)
    const email = user.data.user?.email ?? null
    return { ...data, account: { email } }
  })
}

export async function getAccountDetails(expectedUserId: string): Promise<{ me: Me; email: string | null; loginMethod: 'email' | 'google' }> {
  const { supabase, userId, accessToken } = await captureAccount(expectedUserId)
  const [result, user] = await Promise.all([
    supabase.rpc('get_me').setHeader('Authorization', `Bearer ${accessToken}`),
    supabase.auth.getUser(accessToken),
  ])
  if (user.error) throw toAppError(user.error)
  if (user.data.user?.id !== userId) throw new AppError('session_expired')
  const me = unwrap(result) as unknown as Me
  if (me.profile?.id !== userId) throw new AppError('session_expired')
  await assertCurrentAccount(userId)
  return { me, email: user.data.user.email ?? null, loginMethod: user.data.user.app_metadata?.provider === 'google' ? 'google' : 'email' }
}

/** "bunprise-export-2026-12-12.json" */
export function exportFilename(now: Date = new Date()): string {
  return `${APP_NAME.toLowerCase()}-export-${isoDateForFilename(now)}.json`
}

/** Saves JSON as a download (Blob, no server). */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try { link.click() }
  finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * Clean only after confirmed deletion, without issuing sign-out against a replacement account.
 */
/**
 * `onDeleted` runs after the server's yes, before the device clean-up: device data of this account that a sign-out
 * keeps on purpose (the Sammlung, features/sammlung/key.ts) goes with the account.
 */
export async function deleteMyAccount(options: { redirectTo?: string | null; expectedUserId?: string; onDeleted?: (userId: string) => void } = {}): Promise<void> {
  const { supabase, userId, accessToken } = await captureAccount(options.expectedUserId)
  await timed('delete_my_account', async () => {
    const user = await supabase.auth.getUser(accessToken)
    if (user.error) throw toAppError(user.error)
    if (user.data.user?.id !== userId) throw new AppError('session_expired')
    await assertCurrentAccount(userId)
    const data = unwrap(await supabase.rpc('delete_my_account').setHeader('Authorization', `Bearer ${accessToken}`))
    if (typeof data !== 'object' || data === null || Array.isArray(data) || data.ok !== true) throw new AppError('generic')
  })
  try {
    options.onDeleted?.(userId)
  } catch {
    /* the account is gone either way: the clean-up below still runs */
  }
  clearAccountDeviceState(userId, options.redirectTo === undefined ? '/' : options.redirectTo)
}

/** Groundwork — no "Blockieren" in the pilot UI (pilot-decisions §1). */
export async function blockUser(profileId: string): Promise<void> {
  const supabase = await getSupabase()
  unwrap(await supabase.rpc('block_user', { p_profile_id: profileId }))
}

export async function unblockUser(profileId: string): Promise<void> {
  const supabase = await getSupabase()
  unwrap(await supabase.rpc('unblock_user', { p_profile_id: profileId }))
}

/** In-app report row (groundwork). The pilot's "Melden" is the mailto below. */
export async function reportTarget(kind: ReportTargetKind, targetId: string, reason: string): Promise<void> {
  const supabase = await getSupabase()
  const userId = await requireUserId()
  unwrapVoid(
    await supabase
      .from('reports')
      .insert({ reporter_id: userId, target_kind: kind, target_id: targetId, reason: reason.trim() }),
  )
}

/** mailto: link for "Melden / Kontakt"; subject and body come from i18n (report.mail_subject / mail_body). */
export function buildMailto(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
