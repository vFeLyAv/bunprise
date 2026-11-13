import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMe, updateMyProfile, validDisplayName } from '../../lib/api/profile'
import { acceptConsents, getMyConsents } from '../../lib/api/consents'
import { assertCurrentAccount } from '../../lib/api/identity'
import type { Consent, ConsentKind, Me } from '../../lib/api/types'
import { LEGAL_VERSIONS } from '../../lib/legal'
import { AppError } from '../../lib/errors'
import { bindPendingConsentToAccount, readPendingConsent, rememberPendingConsent } from '../auth/flow'
import { loadLegalText } from '../legal/archive'
import { loadProfileSetup, profileDestination, saveProfileSetup, type ProfileSetup } from './setup'

vi.mock('../../lib/api/profile', async (original) => ({
  ...await original<typeof import('../../lib/api/profile')>(), getMe: vi.fn(), updateMyProfile: vi.fn(),
}))
vi.mock('../../lib/api/consents', async (original) => ({
  ...await original<typeof import('../../lib/api/consents')>(), getMyConsents: vi.fn(), acceptConsents: vi.fn(),
}))
vi.mock('../../lib/api/identity', () => ({ assertCurrentAccount: vi.fn() }))
vi.mock('../legal/archive', () => ({ loadLegalText: vi.fn() }))

const me: Me = {
  profile: { id: 'account-a', display_name: null, locale: 'de', onboarding_done_at: null },
  consents_ok: false,
  legal_versions: { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy_notice, age: LEGAL_VERSIONS.age_18plus },
}
const complete: Me = { ...me, consents_ok: true, profile: { ...me.profile, display_name: 'Mila' } }
const setup: ProfileSetup = { me, versions: LEGAL_VERSIONS, locale: 'de', missing: ['terms', 'age_18plus', 'privacy_notice'],
  legalAvailable: true, checkedAge: false, checkedTerms: false }
const input = { name: 'Mila', age: true, terms: true }

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  vi.mocked(getMe).mockResolvedValue(me)
  vi.mocked(getMyConsents).mockResolvedValue([])
  vi.mocked(assertCurrentAccount).mockResolvedValue()
  vi.mocked(loadLegalText).mockImplementation(async (kind, version, locale) => ({ kind, version, locale, text: 'Fixture text' }))
})

describe('profile prerequisites', () => {
  it('uses a fresh login draft only after it is bound to this account and language', async () => {
    rememberPendingConsent('de')
    expect((await loadProfileSetup('account-a', 'de')).checkedTerms).toBe(false)
    bindPendingConsentToAccount('account-a')
    expect((await loadProfileSetup('account-a', 'de')).checkedTerms).toBe(true)
    expect((await loadProfileSetup('account-b', 'de')).checkedTerms).toBe(false)
    expect((await loadProfileSetup('account-a', 'en')).checkedTerms).toBe(false)
    bindPendingConsentToAccount('account-b')
    expect(readPendingConsent()).toBeNull()
  })

  it('requires the exact archived server versions and fails closed when they are absent', async () => {
    vi.mocked(loadLegalText).mockResolvedValue(null)
    expect((await loadProfileSetup('account-a', 'de')).legalAvailable).toBe(false)
    vi.mocked(getMe).mockResolvedValue({ ...me, legal_versions: { ...me.legal_versions, privacy: null } })
    await expect(loadProfileSetup('account-a', 'de')).rejects.toMatchObject({ code: 'consent_required' })
  })

  it('a privacy-only update does not ask for another acceptance of age or terms', async () => {
    const journal = (['terms', 'age_18plus'] as ConsentKind[]).map((kind) => ({
      profile_id: 'account-a', kind, version: LEGAL_VERSIONS[kind], locale: 'de', accepted_at: '2026-10-19T10:00:00Z',
    })) as Consent[]
    vi.mocked(getMyConsents).mockResolvedValue(journal)
    const state = await loadProfileSetup('account-a', 'de')
    expect(state.missing).toEqual(['privacy_notice'])
    vi.mocked(getMe).mockResolvedValueOnce(me).mockResolvedValueOnce(complete)
    await saveProfileSetup(state, { name: 'Mila', age: false, terms: false })
    expect(acceptConsents).toHaveBeenCalledWith('de', LEGAL_VERSIONS, 'account-a', ['privacy_notice'])
  })
})

describe('explicit profile submit', () => {
  it('records exact versions for the captured account and requires a fresh successful server result', async () => {
    rememberPendingConsent('de')
    bindPendingConsentToAccount('account-a')
    vi.mocked(getMe).mockResolvedValueOnce(me).mockResolvedValueOnce(complete)
    expect(await saveProfileSetup(setup, input)).toEqual(complete)
    expect(updateMyProfile).toHaveBeenCalledWith({ display_name: 'Mila', locale: 'de' }, 'account-a')
    expect(acceptConsents).toHaveBeenCalledWith('de', LEGAL_VERSIONS, 'account-a', setup.missing)
    expect(readPendingConsent()).toBeNull()
  })

  it('does not write when versions changed after the form was shown', async () => {
    vi.mocked(getMe).mockResolvedValue({ ...me, legal_versions: { ...me.legal_versions, terms: 'new-terms' } })
    await expect(saveProfileSetup(setup, input)).rejects.toMatchObject({ code: 'conflict' })
    expect(updateMyProfile).not.toHaveBeenCalled()
    expect(acceptConsents).not.toHaveBeenCalled()
  })

  it('does not write after account replacement or accept unchecked required declarations', async () => {
    await expect(saveProfileSetup(setup, { ...input, age: false })).rejects.toMatchObject({ code: 'consent_required' })
    vi.mocked(getMe).mockRejectedValue(new AppError('session_expired'))
    await expect(saveProfileSetup(setup, input)).rejects.toMatchObject({ code: 'session_expired' })
    expect(updateMyProfile).not.toHaveBeenCalled()
  })

  it('retains the draft and does not finish after a partial write/network failure', async () => {
    rememberPendingConsent('de')
    bindPendingConsentToAccount('account-a')
    vi.mocked(acceptConsents).mockRejectedValue(new AppError('network'))
    await expect(saveProfileSetup(setup, input)).rejects.toMatchObject({ code: 'network' })
    expect(readPendingConsent()).not.toBeNull()
  })

  it('does not finish if the server still requires consent after writes', async () => {
    await expect(saveProfileSetup(setup, input)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('names and return destination', () => {
  it('rejects raw overflow instead of truncating and counts Unicode characters like PostgreSQL', () => {
    expect(validDisplayName('  Mila  ')).toBe('Mila')
    expect(validDisplayName('🐰'.repeat(40))).toBe('🐰'.repeat(40))
    for (const name of [' '.repeat(41) + 'Mila', '🐰'.repeat(41), 'Mila\nName', '\tMila', '   ']) {
      expect(() => validDisplayName(name)).toThrow(AppError)
    }
  })

  it('preserves explicit invite/settings destinations and avoids profile/auth loops', () => {
    expect(profileDestination(complete, '/i')).toBe('/i')
    expect(profileDestination(complete, '/settings')).toBe('/settings')
    expect(profileDestination(complete, '/soon')).toBe('/welcome')
    expect(profileDestination(complete, '/welcome/profile?next=/i')).toBe('/welcome')
    expect(profileDestination({ ...complete, profile: { ...complete.profile, onboarding_done_at: '2026-10-19T10:00:00Z' } }, '//external.test')).toBe('/soon')
  })
})
