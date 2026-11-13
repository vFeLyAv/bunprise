import { acceptConsents, CONSENT_KINDS, getMyConsents, missingConsents, versionsFromMe } from '../../lib/api/consents'
import { assertCurrentAccount } from '../../lib/api/identity'
import { getMe, updateMyProfile, validDisplayName } from '../../lib/api/profile'
import type { ConsentKind, Locale, Me } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import type { LegalVersionMap } from '../../lib/legal'
import { forgetPendingConsent, readPendingConsent, safeNext, signInTarget } from '../auth/flow'

export interface ProfileSetup {
  me: Me
  versions: LegalVersionMap
  missing: ConsentKind[]
  locale: Locale
  legalAvailable: boolean
  checkedAge: boolean
  checkedTerms: boolean
  /**
   * Earlier consent records exist but miss a current version: the person signed up before and has to accept
   * NEW terms (re-consent). False for a first sign-up — then the screen never speaks of 'updated terms'.
   */
  reconsent?: boolean
}

async function textsAvailable(versions: LegalVersionMap, locale: Locale): Promise<boolean> {
  const { loadLegalText } = await import('../legal/archive')
  const texts = await Promise.all(CONSENT_KINDS.map((kind) => loadLegalText(kind, versions[kind], locale)))
  return texts.every((text) => text !== null)
}

export async function loadProfileSetup(userId: string, locale: Locale): Promise<ProfileSetup> {
  const [me, journal] = await Promise.all([getMe(userId), getMyConsents(userId)])
  const versions = versionsFromMe(me)
  const missing = missingConsents(versions, journal)
  const legalAvailable = missing.length === 0 || await textsAvailable(versions, locale)
  await assertCurrentAccount(userId)
  const draft = readPendingConsent()
  const validDraft = draft?.accountId === userId && draft.locale === locale &&
    draft.termsVersion === versions.terms && draft.ageVersion === versions.age_18plus &&
    draft.privacyNoticeVersion === versions.privacy_notice
  const reconsent = missing.length > 0 && journal.length > 0
  return { me, versions, missing, locale, legalAvailable, checkedAge: validDraft, checkedTerms: validDraft, reconsent }
}

/** Explicit submit only. Every server write is pinned to the account that owns this form. */
export async function saveProfileSetup(
  setup: ProfileSetup, input: { name: string; age: boolean; terms: boolean },
): Promise<Me> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new AppError('offline_action')
  const displayName = validDisplayName(input.name)
  if ((setup.missing.includes('age_18plus') && !input.age) ||
      (setup.missing.includes('terms') && !input.terms)) throw new AppError('consent_required')
  const userId = setup.me.profile.id
  const current = await getMe(userId)
  const versions = versionsFromMe(current)
  if (CONSENT_KINDS.some((kind) => versions[kind] !== setup.versions[kind])) throw new AppError('conflict')
  if (!setup.legalAvailable || (setup.missing.length > 0 && !await textsAvailable(versions, setup.locale))) {
    throw new AppError('consent_required')
  }
  await updateMyProfile({ display_name: displayName, locale: setup.locale }, userId)
  await acceptConsents(setup.locale, versions, userId, setup.missing)
  const saved = await getMe(userId)
  if (!saved.consents_ok || !saved.profile.display_name?.trim()) throw new AppError('conflict')
  forgetPendingConsent()
  return saved
}

export function profileDestination(me: Me, next?: string): string {
  let destination = safeNext(signInTarget(next))
  if (/^\/welcome\/profile(?:[/?#]|$)/.test(destination)) destination = '/soon'
  return destination === '/soon' && !me.profile.onboarding_done_at ? '/welcome' : destination
}
