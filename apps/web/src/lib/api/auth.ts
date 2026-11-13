import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { getLocalSession, getSupabase } from '../supabase'
import { AppError, toAppError } from '../errors'
import { ACTIVE_STORAGE_PREFIX, APPLE_ENABLED, APP_URL, DEMO_MODE, GOOGLE_ENABLED } from '../app'
import { internalPath } from '../navigation'
import type { Locale } from './types'

// Email one-time code and configured OAuth providers (PKCE).
// The UI answers "if the address is right, the code is on its way" no matter what (brief 7.5a).

export type AuthMode = 'signup' | 'signin'
export type OAuthProvider = 'google' | 'apple'

/** Local session (localStorage), no network. Returns null without loading the client when nobody is signed in. */
export async function getSession(): Promise<Session | null> {
  try {
    return await getLocalSession()
  } catch (err) {
    throw toAppError(err)
  }
}

/** Subscribes once the client exists; the returned function unsubscribes (also before the client loaded). */
export function onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  let unsubscribe: (() => void) | null = null
  let cancelled = false
  void getSupabase().then((supabase) => {
    if (cancelled) return
    const { data } = supabase.auth.onAuthStateChange(callback)
    unsubscribe = () => data.subscription.unsubscribe()
  })
  return () => {
    cancelled = true
    unsubscribe?.()
  }
}

/** Step 1: request a 6-digit code by e-mail (Turnstile token optional, product-pilot F1). */
export async function requestEmailCode(email: string, options: { captchaToken?: string; locale?: Locale; mode?: AuthMode } = {}): Promise<void> {
  const signup = options.mode !== 'signin'
  const supabase = await getSupabase()
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      captchaToken: options.captchaToken,
      shouldCreateUser: signup,
      data: signup && options.locale ? { locale: options.locale } : undefined,
    },
  })
  // Keep the same neutral screen for a missing account; never claim that a code was delivered.
  // Other failures (captcha, rate limits, provider configuration, transport) remain visible.
  if (error && !signup && (error.code === 'otp_disabled' || error.code === 'user_not_found')) return
  if (error) throw toAppError(error)
}

/** Step 2: verify the code; returns the new session. */
export async function verifyEmailCode(email: string, code: string): Promise<Session> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.replace(/\D/g, ''),
    type: 'email',
  })
  if (error) throw toAppError(error)
  if (!data.session) throw new AppError('code_invalid')
  return data.session
}

/**
 * OAuth continuation (redirect flow). Where to continue afterwards is kept in sessionStorage,
 * because the Supabase redirect allow-list matches plain URLs best.
 */
export function isOAuthProviderAvailable(provider: OAuthProvider): boolean {
  return !DEMO_MODE && (provider === 'google' ? GOOGLE_ENABLED : APPLE_ENABLED)
}

export async function signInWithProvider(provider: OAuthProvider, next?: string): Promise<void> {
  // signInWithOAuth redirects without checking provider configuration. Gate before loading the SDK.
  if (!isOAuthProviderAvailable(provider)) throw new AppError('provider_unavailable')
  if (next) rememberPostLoginTarget(next)
  const supabase = await getSupabase()
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${APP_URL}/auth/callback`,
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  })
  if (error) throw toAppError(error)
}

export function signInWithGoogle(next?: string): Promise<void> { return signInWithProvider('google', next) }
export function signInWithApple(next?: string): Promise<void> { return signInWithProvider('apple', next) }

/**
 * /auth/callback: supabase-js (detectSessionInUrl + PKCE) exchanges ?code= while the client
 * initialises; getSession() waits for that. Falls back to a manual exchange.
 */
export async function completeOAuthCallback(): Promise<Session> {
  const params = new URLSearchParams(window.location.search)
  const oauthError = params.get('error')
  if (oauthError) {
    const code = params.get('error_code')
    if (code === 'provider_disabled' || code === 'oauth_provider_not_supported' || oauthError === 'provider_disabled') {
      throw new AppError('provider_unavailable')
    }
    throw new AppError(oauthError === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed')
  }
  const supabase = await getSupabase()
  // The SDK deliberately keeps an old valid session after a failed callback. Surface
  // its initialization error instead of treating that old account as a successful login.
  const initialized = await supabase.auth.initialize()
  if (initialized.error) throw toAppError(initialized.error)
  // Auto-initialization removes a successfully exchanged code from the current URL.
  // A code still present must be exchanged even when an older session already exists.
  const code = new URLSearchParams(window.location.search).get('code')
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw toAppError(error)
    if (!data.session) throw new AppError('oauth_failed')
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('code')
    cleanUrl.searchParams.delete('flowId')
    window.history.replaceState(window.history.state, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
    return data.session
  }
  const current = await supabase.auth.getSession()
  if (current.error) throw toAppError(current.error)
  if (current.data.session) return current.data.session
  throw new AppError('oauth_failed')
}

/** Remember where to go after a login that leaves the app (OAuth) — sessionStorage only. */
export function rememberPostLoginTarget(next: string): void {
  try {
    const path = internalPath(next)
    if (path) window.sessionStorage.setItem(`${ACTIVE_STORAGE_PREFIX}postLoginNext`, path)
    else window.sessionStorage.removeItem(`${ACTIVE_STORAGE_PREFIX}postLoginNext`)
  } catch {
    /* storage unavailable */
  }
}

/** Reads and clears the remembered target; only same-origin paths are accepted. */
export function consumePostLoginTarget(): string | null {
  try {
    const value = window.sessionStorage.getItem(`${ACTIVE_STORAGE_PREFIX}postLoginNext`)
    window.sessionStorage.removeItem(`${ACTIVE_STORAGE_PREFIX}postLoginNext`)
    return internalPath(value)
  } catch {
    return null
  }
}

/** Plain Supabase sign-out. For the full device cleanup use signOutEverywhere() from lib/query.ts. */
export async function signOut(scope: 'global' | 'local' | 'others' = 'global'): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase.auth.signOut({ scope })
  if (error) throw toAppError(error)
}
