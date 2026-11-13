import type { QueryClient } from '@tanstack/react-query'
import { onAccountEnded } from '../../lib/accountBoundary'
import { DEMO_MODE, STORAGE_PREFIX, storageKeys } from '../../lib/app'
import { getMe } from '../../lib/api/profile'
import type { AuthMode } from '../../lib/api/auth'
import type { Locale } from '../../lib/api/types'
import { LEGAL_VERSIONS } from '../../lib/legal'
import { qk } from '../../lib/queryKeys'
import { getPendingInvite } from '../invite/pending'
import { internalPath } from '../../lib/navigation'

export const RESEND_DELAY_MS = 60_000
export const CODE_LIFETIME_MS = 10 * 60_000
const prefix = DEMO_MODE ? `${STORAGE_PREFIX}demo.` : STORAGE_PREFIX
const emailKey = `${prefix}emailCode`
const consentKey = DEMO_MODE ? `${prefix}pendingConsent` : storageKeys.pendingConsent
const draftKey = `${prefix}loginDraft`

export interface EmailAttempt { email: string; requestedAt: number; mode: AuthMode }
export interface LoginDraft { email: string; adult: boolean; terms: boolean }
export interface PendingConsent {
  age18: true
  terms: true
  locale: Locale
  acceptedAt: number
  termsVersion: string
  ageVersion: string
  privacyNoticeVersion: string
  accountId?: string
}
/**
 * Only while sessionStorage refuses the attempt (blocked or full storage): the copy for this page load.
 * When the stored attempt is gone — removed after sign-in or by the account reset (clearSessionDrafts)
 * — the memory copy must not bring it back (round-2 review: the next person saw A's address on
 * /login). It is also forgotten when the shown account ends.
 */
let memoryAttempt: EmailAttempt | null = null
onAccountEnded(() => {
  memoryAttempt = null
})

/** Only local app destinations; URL parsing also catches slash/control-character tricks. */
export function safeNext(value: string | undefined | null): string {
  const path = internalPath(value)
  return path && !/^\/(?:login|auth)(?:[/?#]|$)/.test(path) ? path : '/soon'
}

export function rememberEmailAttempt(email: string, now = Date.now(), mode: AuthMode = 'signup'): EmailAttempt {
  const attempt = { email: email.trim().toLowerCase(), requestedAt: now, mode }
  try {
    sessionStorage.setItem(emailKey, JSON.stringify(attempt))
    memoryAttempt = null // stored: the stored copy is the only one
  } catch {
    memoryAttempt = attempt // storage refused it: the current tab still works
  }
  return attempt
}

export function readEmailAttempt(now = Date.now()): EmailAttempt | null {
  let candidate: unknown = memoryAttempt
  try {
    const raw = sessionStorage.getItem(emailKey)
    candidate = raw ? JSON.parse(raw) as unknown : memoryAttempt
  } catch { /* use memory if storage is blocked */ }
  if (typeof candidate !== 'object' || candidate === null) return null
  const attempt = candidate as Partial<EmailAttempt>
  if (typeof attempt.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(attempt.email) ||
      attempt.email.length > 254 || typeof attempt.requestedAt !== 'number' ||
      !Number.isFinite(attempt.requestedAt) || attempt.requestedAt > now ||
      now - attempt.requestedAt > CODE_LIFETIME_MS ||
      (attempt.mode !== undefined && attempt.mode !== 'signup' && attempt.mode !== 'signin')) return null
  // Attempts created before separate modes used signup semantics. The stored attempt,
  // rather than an editable query parameter, controls every resend of this code.
  return { email: attempt.email, requestedAt: attempt.requestedAt, mode: attempt.mode ?? 'signup' }
}

/** A draft for the profile step, never a substitute for server-side consent records. */
export function rememberPendingConsent(locale: Locale): void {
  try {
    sessionStorage.setItem(consentKey, JSON.stringify({
      age18: true, terms: true, locale, acceptedAt: Date.now(),
      termsVersion: LEGAL_VERSIONS.terms,
      ageVersion: LEGAL_VERSIONS.age_18plus,
      privacyNoticeVersion: LEGAL_VERSIONS.privacy_notice,
    }))
  } catch { /* profile must request confirmation again if this draft is unavailable */ }
}

/** Profile setup may use this fresh draft, but must still write/check the server records. */
export function readPendingConsent(now = Date.now()): PendingConsent | null {
  try {
    const raw = sessionStorage.getItem(consentKey)
    if (!raw) return null
    const candidate: unknown = JSON.parse(raw)
    if (typeof candidate !== 'object' || candidate === null) return null
    const draft = candidate as Partial<PendingConsent>
    if (draft.age18 !== true || draft.terms !== true || !['de', 'en'].includes(draft.locale ?? '') ||
        typeof draft.acceptedAt !== 'number' || !Number.isFinite(draft.acceptedAt) ||
        draft.acceptedAt > now || now - draft.acceptedAt > CODE_LIFETIME_MS ||
        draft.termsVersion !== LEGAL_VERSIONS.terms || draft.ageVersion !== LEGAL_VERSIONS.age_18plus ||
        draft.privacyNoticeVersion !== LEGAL_VERSIONS.privacy_notice ||
        (draft.accountId !== undefined && typeof draft.accountId !== 'string')) return null
    return draft as PendingConsent
  } catch { return null }
}

/** A checkbox draft from this login belongs only to the account that completed it. */
export function bindPendingConsentToAccount(accountId: string): void {
  const draft = readPendingConsent()
  if (!draft || (draft.accountId !== undefined && draft.accountId !== accountId)) {
    forgetPendingConsent()
    return
  }
  try { sessionStorage.setItem(consentKey, JSON.stringify({ ...draft, accountId })) } catch { /* ask again on profile */ }
}

export function forgetPendingConsent(): void {
  try { sessionStorage.removeItem(consentKey) } catch { /* storage unavailable */ }
}

export function forgetEmailAttempt(): void {
  memoryAttempt = null
  try { sessionStorage.removeItem(emailKey) } catch { /* storage unavailable */ }
  try { sessionStorage.removeItem(draftKey) } catch { /* storage unavailable */ }
}

/** Keep a form draft while its public legal links are read in the same tab. */
export function rememberLoginDraft(draft: LoginDraft): void {
  try {
    sessionStorage.setItem(draftKey, JSON.stringify({ ...draft, savedAt: Date.now(), termsVersion: LEGAL_VERSIONS.terms }))
  } catch { /* storage unavailable */ }
}

export function readLoginDraft(now = Date.now()): LoginDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey)
    if (!raw) return null
    const draft: unknown = JSON.parse(raw)
    if (typeof draft !== 'object' || draft === null) return null
    const value = draft as Record<string, unknown>
    if (typeof value.email !== 'string' || value.email.length > 254 || typeof value.adult !== 'boolean' ||
        typeof value.terms !== 'boolean' || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) ||
        value.savedAt > now || now - value.savedAt > CODE_LIFETIME_MS || value.termsVersion !== LEGAL_VERSIONS.terms) return null
    return { email: value.email, adult: value.adult, terms: value.terms }
  } catch { return null }
}

/**
 * The digits of a pasted or dropped one-time code. Mail apps copy "123 456", " 123456\n" or a whole line
 * ("Dein Code: 123-456"): a six-digit group (optionally split by one space or dash) wins; otherwise every
 * digit counts, at most six. '' when the text has no digit.
 */
export function codeFromText(text: string): string {
  const group = /(?<!\d)\d{3}[\s-]?\d{3}(?!\d)/.exec(text)
  return (group ? group[0] : text).replace(/\D/g, '').slice(0, 6)
}

export function signInTarget(next?: string | null): string {
  return next ? safeNext(next) : getPendingInvite() ? '/i' : '/soon'
}

/** Fresh server state decides the screen; pending checkboxes cannot unlock the app. */
export async function destinationAfterSignIn(queryClient: QueryClient, authenticatedUserId: string, next?: string): Promise<string> {
  const me = await getMe(authenticatedUserId)
  bindPendingConsentToAccount(me.profile.id)
  queryClient.setQueryData(qk.me(), me)
  const destination = signInTarget(next)
  if (!me.consents_ok || !me.profile.display_name?.trim()) {
    return `/welcome/profile?next=${encodeURIComponent(destination)}`
  }
  return destination
}
