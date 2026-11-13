import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { endAccountEpoch, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import { getMe } from '../../lib/api/profile'
import type { Me } from '../../lib/api/types'
import { setPendingInvite } from '../invite/pending'
import { CODE_LIFETIME_MS, codeFromText, destinationAfterSignIn, forgetEmailAttempt, readEmailAttempt, readPendingConsent, rememberEmailAttempt, rememberPendingConsent, safeNext, signInTarget } from './flow'

vi.mock('../../lib/api/profile', () => ({ getMe: vi.fn() }))

beforeEach(() => {
  sessionStorage.clear()
  forgetEmailAttempt()
  vi.clearAllMocks()
})

describe('post-login destinations', () => {
  it.each([
    'https://outside.example', '//outside.example', '/\\outside.example', '/%5coutside.example',
    '/%2foutside.example', '/\noutside.example', '/a/..//outside.example', '/%2e%2e//outside.example',
    '/login', '/login/code', '/auth/callback?code=secret', '/%zz',
  ])('rejects unsafe or looping destination %j', (value) => {
    expect(safeNext(value)).toBe('/soon')
  })

  it('keeps an internal path, search and fragment', () => {
    expect(safeNext('/occasions/123?view=wishes#gift')).toBe('/occasions/123?view=wishes#gift')
  })

  it('preserves a pending invitation without accepting it', () => {
    setPendingInvite('a'.repeat(64))
    expect(signInTarget()).toBe('/i')
    expect(sessionStorage.getItem('bunprise.pendingInvite')).toBeTruthy()
  })

  it('requires server-confirmed consent and profile even when the cache looks complete', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['me'], { consents_ok: true, profile: { display_name: 'Demo' } })
    vi.mocked(getMe).mockResolvedValue({ consents_ok: false, profile: { display_name: 'Demo' } } as Me)
    expect(await destinationAfterSignIn(queryClient, 'account-a', '/i')).toBe('/welcome/profile?next=%2Fi')
    expect(getMe).toHaveBeenCalledExactlyOnceWith('account-a')
  })

  it('fails closed when the profile request fails', async () => {
    vi.mocked(getMe).mockRejectedValue(new Error('offline'))
    await expect(destinationAfterSignIn(new QueryClient(), 'account-a', '/i')).rejects.toThrow('offline')
  })

  it('returns to a safe destination for a complete profile', async () => {
    vi.mocked(getMe).mockResolvedValue({ consents_ok: true, profile: { display_name: 'Demo' } } as Me)
    expect(await destinationAfterSignIn(new QueryClient(), 'account-a', '//outside.example')).toBe('/soon')
  })

  it('never binds the login declarations to a replacement account', async () => {
    rememberPendingConsent('de')
    vi.mocked(getMe).mockRejectedValue(new Error('account changed'))
    const cache = new QueryClient()
    await expect(destinationAfterSignIn(cache, 'signed-in-account', '/i')).rejects.toThrow('account changed')
    expect(getMe).toHaveBeenCalledWith('signed-in-account')
    expect(readPendingConsent()?.accountId).toBeUndefined()
    expect(cache.getQueryData(['me'])).toBeUndefined()
  })
})

describe('email attempt', () => {
  it('keeps its original timestamp so reload cannot bypass the resend delay', () => {
    rememberEmailAttempt('  DEMO@example.test ', 100_000)
    expect(readEmailAttempt(130_000)).toEqual({ email: 'demo@example.test', requestedAt: 100_000, mode: 'signup' })
  })

  it('rejects expired and future attempts', () => {
    rememberEmailAttempt('demo@example.test', 100_000)
    expect(readEmailAttempt(100_001 + CODE_LIFETIME_MS)).toBeNull()
    expect(readEmailAttempt(99_999)).toBeNull()
  })

  it('rejects a malformed stored attempt', () => {
    sessionStorage.setItem('bunprise.emailCode', JSON.stringify({ email: 'bad', requestedAt: 'yesterday' }))
    expect(readEmailAttempt()).toBeNull()
  })

  it('keeps existing-account mode across restoration and resend', () => {
    rememberEmailAttempt('known@example.test', 100_000, 'signin')
    const restored = readEmailAttempt(130_000)!
    expect(restored.mode).toBe('signin')
    rememberEmailAttempt(restored.email, 170_000, restored.mode)
    expect(readEmailAttempt(180_000)?.mode).toBe('signin')
  })

  it('rejects an unrecognized stored mode', () => {
    sessionStorage.setItem('bunprise.emailCode', JSON.stringify({ email: 'demo@example.test', requestedAt: Date.now(), mode: 'unknown' }))
    expect(readEmailAttempt()).toBeNull()
  })

  it('preserves signup semantics for an attempt created before modes were introduced', () => {
    sessionStorage.setItem('bunprise.emailCode', JSON.stringify({ email: 'demo@example.test', requestedAt: 100_000 }))
    expect(readEmailAttempt(130_000)?.mode).toBe('signup')
  })

  // round 2: the account reset removes the stored attempt (clearSessionDrafts); no memory copy may bring it back
  it('a stored attempt that was removed stays gone (no memory copy behind it)', () => {
    rememberEmailAttempt('mila.fixture@example.test')
    sessionStorage.removeItem('bunprise.emailCode')
    expect(readEmailAttempt()).toBeNull()
  })

  it('storage refuses the attempt: the memory copy serves this page, until the shown account ends', () => {
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      rememberEmailAttempt('mila.fixture@example.test', Date.now(), 'signin')
      expect(readEmailAttempt()?.email).toBe('mila.fixture@example.test')
      endAccountEpoch()
      expect(readEmailAttempt()).toBeNull()
    } finally {
      refuse.mockRestore()
      resetAccountBoundaryForTests()
    }
  })
})

describe('consent draft', () => {
  it('accepts a fresh versioned draft without treating it as server approval', () => {
    rememberPendingConsent('de')
    expect(readPendingConsent()).toMatchObject({ age18: true, terms: true, locale: 'de' })
  })

  it('rejects an expired or future draft', () => {
    rememberPendingConsent('en')
    const draft = readPendingConsent()!
    expect(readPendingConsent(draft.acceptedAt + CODE_LIFETIME_MS + 1)).toBeNull()
    expect(readPendingConsent(draft.acceptedAt - 1)).toBeNull()
  })

  it.each([
    { termsVersion: 'outdated' }, { privacyNoticeVersion: 'outdated' },
    { ageVersion: 'outdated' }, { age18: false }, { terms: false }, { locale: 'xx' },
  ])('rejects an invalid draft: %j', (patch) => {
    rememberPendingConsent('de')
    const draft = readPendingConsent()!
    sessionStorage.setItem('bunprise.pendingConsent', JSON.stringify({ ...draft, ...patch }))
    expect(readPendingConsent()).toBeNull()
  })
})

// QA ACCOUNT-1: mail apps copy the code with spaces, line breaks or a whole line around it
describe('codeFromText', () => {
  it.each([
    ['123456', '123456'], ['123 456', '123456'], [' 123456\n', '123456'], ['123-456', '123456'],
    ['Dein Code: 123456', '123456'], ['Code 123 456 – gültig 10 Minuten', '123456'], ['12 34 56', '123456'],
    ['1234', '1234'], ['kein Code', ''],
  ])('%j → %j', (text, code) => {
    expect(codeFromText(text)).toBe(code)
  })
})
