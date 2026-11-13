import { getSupabase } from '../supabase'
import { isPageLeaving } from '../accountBoundary'
import { AppError, toAppError } from '../errors'

/**
 * Capture once, then pin each request to this token so account changes cannot retarget it.
 * Nothing is captured while the page is leaving (an account reset decided on a full reload; round-2
 * review): a screen of the ended account that is still mounted — hidden until the unload — could
 * otherwise rebuild a query the reset removed and send it with the account that is current NOW.
 */
export async function captureAccount(expectedUserId?: string) {
  if (isPageLeaving()) throw new AppError('session_expired')
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw toAppError(error)
  const session = data.session
  if (!session) throw new AppError('not_authenticated')
  if (expectedUserId !== undefined && session.user.id !== expectedUserId) throw new AppError('session_expired')
  if (isPageLeaving()) throw new AppError('session_expired') // the reset may have started meanwhile
  return { supabase, userId: session.user.id, accessToken: session.access_token }
}

/** Discard an old account's response before it can populate the current screen/cache. */
export async function assertCurrentAccount(userId: string): Promise<void> {
  await captureAccount(userId)
}

export type CapturedAccount = Awaited<ReturnType<typeof captureAccount>>

/** `Authorization` value that pins one request to the captured account. */
export function bearer(account: CapturedAccount): string {
  return `Bearer ${account.accessToken}`
}

/**
 * One request for one account (the pattern of getMe / acceptConsents / exportMyData): the account is
 * captured first (optionally the expected one), the request carries its bearer token, and the answer
 * — data or error — reaches the caller only while that account is still current; otherwise the
 * caller gets session_expired. A late answer for A therefore never lands in B's screen or cache.
 */
export async function asAccount<T>(expectedUserId: string | undefined, request: (account: CapturedAccount) => Promise<T>): Promise<T> {
  const account = await captureAccount(expectedUserId)
  let result: T
  try {
    result = await request(account)
  } catch (err) {
    await assertCurrentAccount(account.userId)
    throw err
  }
  await assertCurrentAccount(account.userId)
  return result
}
