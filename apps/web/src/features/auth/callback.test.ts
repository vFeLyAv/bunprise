import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeOAuthCallback, consumePostLoginTarget, rememberPostLoginTarget } from '../../lib/api/auth'

const auth = vi.hoisted(() => ({ initialize: vi.fn(), getSession: vi.fn(), exchangeCodeForSession: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ getSupabase: async () => ({ auth }), getLocalSession: async () => null }))

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/auth/callback')
  auth.initialize.mockResolvedValue({ error: null })
})

describe('OAuth callback', () => {
  it('never substitutes an old session when callback initialization failed', async () => {
    auth.initialize.mockResolvedValue({ error: { __isAuthError: true, code: 'bad_oauth_state', status: 400, message: 'bad state' } })
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'old-account' } } }, error: null })
    await expect(completeOAuthCallback()).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(auth.getSession).not.toHaveBeenCalled()
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('exchanges a code still in the URL before using an existing session', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=new-code&flowId=temporary-flow')
    const session = { user: { id: 'new-account' } }
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null })
    expect(await completeOAuthCallback()).toBe(session)
    expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('new-code')
    expect(auth.getSession).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
    auth.getSession.mockResolvedValue({ data: { session }, error: null })
    expect(await completeOAuthCallback()).toBe(session)
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
  })

  it('does not exchange twice after the SDK completed initialization', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=used-code')
    auth.initialize.mockImplementation(async () => {
      window.history.replaceState(null, '', '/auth/callback')
      return { error: null }
    })
    const session = { user: { id: 'new-account' } }
    auth.getSession.mockResolvedValue({ data: { session }, error: null })
    expect(await completeOAuthCallback()).toBe(session)
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('handles cancellation before accessing the client', async () => {
    window.history.replaceState(null, '', '/auth/callback?error=access_denied')
    await expect(completeOAuthCallback()).rejects.toMatchObject({ code: 'oauth_cancelled' })
    expect(auth.initialize).not.toHaveBeenCalled()
  })

  it('handles an unconfigured provider without loading the client or using an old session', async () => {
    window.history.replaceState(null, '', '/auth/callback?error=server_error&error_code=provider_disabled')
    await expect(completeOAuthCallback()).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(auth.initialize).not.toHaveBeenCalled()
    expect(auth.getSession).not.toHaveBeenCalled()
  })
})

describe('stored return address', () => {
  it('rejects an external address created by URL normalization', () => {
    sessionStorage.setItem('bunprise.postLoginNext', '/a/..//outside.example')
    expect(consumePostLoginTarget()).toBeNull()
    expect(sessionStorage.getItem('bunprise.postLoginNext')).toBeNull()
  })

  it('clears a previous target when the new one is invalid', () => {
    rememberPostLoginTarget('/i')
    rememberPostLoginTarget('/\\outside.example')
    expect(consumePostLoginTarget()).toBeNull()
  })
})
