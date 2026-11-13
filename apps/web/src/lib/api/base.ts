import { getSupabase } from '../supabase'
import { AppError, toAppError } from '../errors'

// Shared plumbing for the thin API wrappers: every wrapper returns data or throws an AppError.
// Each wrapper starts with `const supabase = await getSupabase()` (lazy client, see lib/supabase.ts).

interface Result<T> {
  data: T | null
  error: unknown
}

/** Data or AppError; a null/undefined payload counts as not_found. */
export function unwrap<T>(result: Result<T>): T {
  if (result.error) throw toAppError(result.error)
  if (result.data === null || result.data === undefined) throw new AppError('not_found')
  return result.data
}

/** Data (possibly null) or AppError. */
export function unwrapNullable<T>(result: Result<T>): T | null {
  if (result.error) throw toAppError(result.error)
  return result.data ?? null
}

/** Throws on error, returns nothing. */
export function unwrapVoid(result: { error: unknown }): void {
  if (result.error) throw toAppError(result.error)
}

/** The signed-in user's id from the local session (no network); throws not_authenticated. */
export async function requireUserId(): Promise<string> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw toAppError(error)
  if (!data.session) throw new AppError('not_authenticated')
  return data.session.user.id
}

/** DEV only: timing events for a future Perf-HUD (performance-plan.md 1.5), e.g. window 'bunprise:rpc'. */
export async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return run()
  const started = performance.now()
  let ok = true
  try {
    return await run()
  } catch (err) {
    ok = false
    throw err
  } finally {
    window.dispatchEvent(new CustomEvent('bunprise:rpc', { detail: { name, ms: performance.now() - started, ok } }))
  }
}
