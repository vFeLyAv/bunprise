import { getSupabase } from '../supabase'
import { LEGAL_VERSIONS, type LegalVersionMap } from '../legal'
import { unwrap, unwrapVoid } from './base'
import { captureAccount, assertCurrentAccount } from './identity'
import { invalidateMe } from './profile'
import { AppError } from '../errors'
import type { Consent, ConsentKind, LegalVersion, Locale, Me } from './types'

// Versioned consent records (legal-pilot.md 1.4, pilot-decisions §5). The guard reads get_me().consents_ok;
// The privacy notice row records information shown, not consent to processing (v1.1 §0.12).

export const CONSENT_KINDS: readonly ConsentKind[] = ['terms', 'privacy_notice', 'age_18plus']

/** Current version of every legal text (one row per kind) — REST; get_me() carries the same data. */
export async function getLegalVersions(): Promise<LegalVersion[]> {
  const supabase = await getSupabase()
  const result = await supabase.from('legal_versions').select('kind, version, published_at')
  return unwrap(result) as LegalVersion[]
}

/** My consent journal (RLS: own rows only). */
export async function getMyConsents(expectedUserId?: string): Promise<Consent[]> {
  const { supabase, userId, accessToken } = await captureAccount(expectedUserId)
  const result = await supabase.from('consents').select('profile_id, kind, version, locale, accepted_at')
    .eq('profile_id', userId).setHeader('Authorization', `Bearer ${accessToken}`)
  const journal = unwrap(result) as Consent[]
  await assertCurrentAccount(userId)
  if (journal.some((entry) => entry.profile_id !== userId)) throw new AppError('session_expired')
  return journal
}

/** Missing server versions fail closed; never silently record a different bundled version. */
export function versionsFromMe(me: Me): LegalVersionMap {
  if (!me.legal_versions.terms || !me.legal_versions.privacy || !me.legal_versions.age) throw new AppError('consent_required')
  return {
    terms: me.legal_versions.terms,
    privacy_notice: me.legal_versions.privacy,
    age_18plus: me.legal_versions.age,
  }
}

/** Which current text versions are missing from my journal. Empty = good to go. */
export function missingConsents(versions: LegalVersionMap, consents: readonly Consent[]): ConsentKind[] {
  return CONSENT_KINDS.filter((kind) => !consents.some((c) => c.kind === kind && c.version === versions[kind]))
}

/**
 * Records terms/age declarations and the privacy notice shown in the language the person read.
 * Append-only; re-accepting the same version is ignored (ignoreDuplicates).
 */
export async function acceptConsents(
  locale: Locale, versions: LegalVersionMap = LEGAL_VERSIONS, expectedUserId?: string,
  kinds: readonly ConsentKind[] = CONSENT_KINDS,
): Promise<void> {
  const { supabase, userId, accessToken } = await captureAccount(expectedUserId)
  const rows = kinds.map((kind) => ({ profile_id: userId, kind, version: versions[kind], locale }))
  if (rows.length === 0) return
  // the guard's cached get_me (consents_ok) must not outlive this write (lib/consentGate.ts)
  invalidateMe()
  try {
    unwrapVoid(await supabase.from('consents').upsert(rows, { ignoreDuplicates: true }).setHeader('Authorization', `Bearer ${accessToken}`))
    await assertCurrentAccount(userId)
  } finally {
    invalidateMe()
  }
}
