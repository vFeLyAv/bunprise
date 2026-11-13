import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('demo storage isolation', () => {
  it('reads and clears demo sessions/caches without touching a real account or device preferences', async () => {
    vi.stubEnv('VITE_DEMO', '1')
    vi.resetModules()
    const app = await import('../lib/app')
    const { hasLocalSession } = await import('../lib/supabase')
    const { clearLocalState, clearPersistedCache } = await import('../lib/query')

    window.localStorage.setItem(app.storageKeys.auth, 'real-session')
    window.localStorage.setItem(app.storageKeys.queryCache, 'real-cache')
    window.localStorage.setItem('sb-real-auth-token', 'legacy-real-session')
    window.localStorage.setItem(app.storageKeys.lang, 'en')
    window.sessionStorage.setItem(app.storageKeys.pendingConsent, 'real-consent')
    expect(hasLocalSession()).toBe(false)
    window.localStorage.setItem(app.AUTH_STORAGE_KEY, 'demo-session')
    window.localStorage.setItem(app.QUERY_CACHE_KEY, 'demo-cache')
    window.sessionStorage.setItem(`${app.ACTIVE_STORAGE_PREFIX}pendingConsent`, 'demo-consent')
    expect(hasLocalSession()).toBe(true)

    await clearPersistedCache()
    expect(window.localStorage.getItem(app.QUERY_CACHE_KEY)).toBeNull()
    expect(window.localStorage.getItem(app.storageKeys.queryCache)).toBe('real-cache')
    clearLocalState()
    expect(hasLocalSession()).toBe(false)
    expect(window.sessionStorage.getItem(`${app.ACTIVE_STORAGE_PREFIX}pendingConsent`)).toBeNull()
    expect(window.localStorage.getItem(app.storageKeys.auth)).toBe('real-session')
    expect(window.localStorage.getItem('sb-real-auth-token')).toBe('legacy-real-session')
    expect(window.localStorage.getItem(app.storageKeys.lang)).toBe('en')
    expect(window.sessionStorage.getItem(app.storageKeys.pendingConsent)).toBe('real-consent')
  })

  it('keeps production auth/cache keys unchanged', async () => {
    vi.stubEnv('VITE_DEMO', '0')
    vi.resetModules()
    const app = await import('../lib/app')
    const { hasLocalSession } = await import('../lib/supabase')
    expect(app.AUTH_STORAGE_KEY).toBe('bunprise.auth')
    expect(app.QUERY_CACHE_KEY).toBe('bunprise.query')
    window.localStorage.setItem('bunprise.demo.auth', 'demo-session')
    expect(hasLocalSession()).toBe(false)
    window.localStorage.setItem(app.AUTH_STORAGE_KEY, 'real-session')
    expect(hasLocalSession()).toBe(true)
  })
})
