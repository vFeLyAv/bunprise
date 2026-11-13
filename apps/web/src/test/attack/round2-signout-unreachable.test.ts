import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../lib/database.types'

// ADVERSARIAL ROUND 2 — H3 on the device itself: "Abmelden" must leave nothing of the account on the
// device, and the code promises that "offline/server failures still clear locally" (lib/query.ts
// signOutEverywhere; account handoff: «При недоступной сети остаётся локальная очистка»).
// Here with the REAL auth-js 2.118 client (persistSession, the app's storage key), only its fetch is a
// stand-in: the auth server cannot be reached (captive portal / lie-fi / Supabase outage — navigator.onLine
// stays true, so the settings screen takes the online path). The stored access token has expired (JWT
// expiry = 15 min, pilot-decisions §0.6: any tab that sat in the background longer), so getSession()
// must refresh first — and that refresh fails with a retryable network error after its back-off.
// SECURE: the device is cleared anyway (session, own storage keys, reload to /login).
// Invented fixture account; no request leaves this file.

const hooks = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(hooks.client),
  hasLocalSession: () => true,
  getLocalSession: () => Promise.resolve(null),
  onClientReady: (ready: (client: unknown) => void) => {
    ready(hooks.client)
    return () => {}
  },
}))
vi.mock('../../router', () => ({ router: { state: { location: { pathname: '/settings', href: '/settings' } }, navigate: vi.fn() } }))

import { AUTH_STORAGE_KEY, OFFLINE_FEED_KEY } from '../../lib/app'
import { resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import { clearPersistedCache, queryClient, setSdkSessionIdentity, signOutEverywhere } from '../../lib/query'

const A = '00000000-0000-4000-8000-0000000000a1'
const API = 'http://unreachable-auth.localhost'

/** What auth-js stores under the app's key: a session whose access token expired a minute ago. */
function expiredSession(): string {
  const now = Math.floor(Date.now() / 1000)
  return JSON.stringify({
    access_token: `fixture-token-${A}`,
    refresh_token: `fixture-refresh-${A}`,
    token_type: 'bearer',
    expires_in: 900,
    expires_at: now - 60,
    user: { id: A, aud: 'authenticated', role: 'authenticated', email: 'mila.fixture@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T10:00:00Z' },
  })
}

const replace = vi.fn<(url: string) => void>()
const sent: string[] = []
let client: SupabaseClient<Database>

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.stubGlobal('location', { ...window.location, replace })
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  replace.mockReset()
  sent.length = 0
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem(AUTH_STORAGE_KEY, expiredSession())
  window.localStorage.setItem(OFFLINE_FEED_KEY, A)
  window.localStorage.setItem('bunprise.haptics', '1')
  window.sessionStorage.setItem('bunprise.pendingInvite', '7b'.repeat(32))
  // the app's client options (lib/supabaseClient.ts), the network replaced by an unreachable one
  client = createClient<Database>(API, 'fixture-publishable-key', {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY, flowType: 'pkce' },
    global: {
      fetch: (input: RequestInfo | URL) => {
        sent.push(String(input))
        return Promise.reject(new TypeError('Failed to fetch'))
      },
    },
  })
  hooks.client = client
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetAccountBoundaryForTests()
  await clearPersistedCache()
  queryClient.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

/** Run `work` while fake time passes (auth-js backs off 200, 400, 800 … ms between refresh attempts). */
async function withTimePassing<T>(work: Promise<T>): Promise<T> {
  let done = false
  const settled = work.finally(() => {
    done = true
  })
  for (let i = 0; i < 60 && !done; i += 1) await vi.advanceTimersByTimeAsync(1_000)
  return settled
}

describe('sign-out while the auth server cannot be reached and the access token has expired', () => {
  it('control: auth-js really answers getSession() with an error here (no session, AuthRetryableFetchError)', async () => {
    const result = await withTimePassing(client.auth.getSession())
    expect(result.data.session).toBeNull()
    expect(result.error?.name).toBe('AuthRetryableFetchError')
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).not.toBeNull() // auth-js keeps the session for later
    expect(sent.some((url) => url.includes('/auth/v1/token'))).toBe(true)
  })

  it("signOutEverywhere({ expectedUserId: A }) still clears A from the device and reloads to /login", async () => {
    const outcome = await withTimePassing(signOutEverywhere({ expectedUserId: A }).then(() => 'resolved', (err: unknown) => err))

    // SECURE (and documented): a failed server round trip never keeps the account on the device
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
    expect(window.localStorage.getItem('bunprise.haptics')).toBeNull()
    expect(window.sessionStorage.getItem('bunprise.pendingInvite')).toBeNull()
    expect(replace).toHaveBeenCalledWith('/login')
    expect(outcome).toBe('resolved')
  })
})
