import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  load: vi.fn(),
  auth: { signInWithOtp: vi.fn(), signInWithOAuth: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ getSupabase: backend.load, getLocalSession: async () => null }))

function serverError(code: string, status = 422) {
  return { __isAuthError: true, name: 'AuthApiError', code, status, message: 'Server rejected this request' }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubEnv('VITE_DEMO', '0')
  vi.stubEnv('VITE_GOOGLE_ENABLED', '0')
  vi.stubEnv('VITE_APPLE_ENABLED', '0')
  vi.stubEnv('VITE_APP_URL', 'https://app.example.test')
  sessionStorage.clear()
  backend.load.mockResolvedValue({ auth: backend.auth })
  backend.auth.signInWithOtp.mockResolvedValue({ error: null })
  backend.auth.signInWithOAuth.mockResolvedValue({ error: null })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); sessionStorage.clear() })

describe('email registration and existing-account login', () => {
  it('defaults to signup and sends locale metadata only when creating an account is allowed', async () => {
    const { requestEmailCode } = await import('../../lib/api/auth')
    await requestEmailCode(' MILA@EXAMPLE.TEST ', { locale: 'en', captchaToken: 'fixture-captcha' })
    expect(backend.auth.signInWithOtp).toHaveBeenLastCalledWith({
      email: 'mila@example.test', options: { shouldCreateUser: true, data: { locale: 'en' }, captchaToken: 'fixture-captcha' },
    })
    await requestEmailCode(' MILA@EXAMPLE.TEST ', { mode: 'signin', locale: 'en', captchaToken: 'fixture-captcha' })
    expect(backend.auth.signInWithOtp).toHaveBeenLastCalledWith({
      email: 'mila@example.test', options: { shouldCreateUser: false, data: undefined, captchaToken: 'fixture-captcha' },
    })
  })

  it.each(['otp_disabled', 'user_not_found'])('keeps %s neutral only on the existing-account login path', async (code) => {
    const { requestEmailCode } = await import('../../lib/api/auth')
    backend.auth.signInWithOtp.mockResolvedValue({ error: serverError(code) })
    await expect(requestEmailCode('unknown@example.test', { mode: 'signin' })).resolves.toBeUndefined()
    await expect(requestEmailCode('unknown@example.test', { mode: 'signup' })).rejects.toMatchObject({ code: 'generic' })
  })

  it.each([
    ['over_email_send_rate_limit', 'rate_limited'], ['captcha_failed', 'captcha'],
    ['email_address_invalid', 'email_invalid'], ['email_provider_disabled', 'generic'], ['signup_disabled', 'generic'],
  ])('does not conceal %s as an accepted login request', async (serverCode, expectedCode) => {
    const { requestEmailCode } = await import('../../lib/api/auth')
    backend.auth.signInWithOtp.mockResolvedValue({ error: serverError(serverCode) })
    await expect(requestEmailCode('mila@example.test', { mode: 'signin' })).rejects.toMatchObject({ code: expectedCode })
  })

  it('keeps transport failures visible on the existing-account login path', async () => {
    const { requestEmailCode } = await import('../../lib/api/auth')
    backend.auth.signInWithOtp.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } })
    await expect(requestEmailCode('mila@example.test', { mode: 'signin' })).rejects.toMatchObject({ code: 'network' })
  })
})

describe('real provider entry points', () => {
  for (const provider of ['google', 'apple'] as const) {
    it(`keeps unavailable ${provider} on the current page without loading the backend`, async () => {
      const api = await import('../../lib/api/auth')
      expect(api.isOAuthProviderAvailable(provider)).toBe(false)
      await expect(api.signInWithProvider(provider, '/i')).rejects.toMatchObject({ code: 'provider_unavailable' })
      expect(backend.load).not.toHaveBeenCalled()
      expect(backend.auth.signInWithOAuth).not.toHaveBeenCalled()
    })

    it(`uses the configured ${provider} PKCE redirect and retains a safe destination`, async () => {
      vi.stubEnv(provider === 'google' ? 'VITE_GOOGLE_ENABLED' : 'VITE_APPLE_ENABLED', '1')
      const api = await import('../../lib/api/auth')
      expect(api.isOAuthProviderAvailable(provider)).toBe(true)
      await (provider === 'google' ? api.signInWithGoogle('/i') : api.signInWithApple('/i'))
      expect(backend.auth.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
        provider, options: {
          redirectTo: 'https://app.example.test/auth/callback',
          ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
        },
      })
      expect(sessionStorage.getItem('bunprise.postLoginNext')).toBe('/i')
    })

    it(`never simulates ${provider} OAuth success in demo mode, even with an enabled flag`, async () => {
      vi.stubEnv('VITE_DEMO', '1')
      vi.stubEnv('VITE_GOOGLE_ENABLED', '1')
      vi.stubEnv('VITE_APPLE_ENABLED', '1')
      const api = await import('../../lib/api/auth')
      expect(api.isOAuthProviderAvailable(provider)).toBe(false)
      await expect(api.signInWithProvider(provider)).rejects.toMatchObject({ code: 'provider_unavailable' })
      expect(backend.load).not.toHaveBeenCalled()
    })
  }
})
