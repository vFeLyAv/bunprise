import type { SupabaseClient } from '@supabase/supabase-js'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../lib/database.types'
import { createDemoHandlers, DEMO_CODE, DEMO_SUPABASE_URL } from '../../mocks/handlers'
import { FakeBroadcastChannel, deferred, flush, json } from './round1-kit'

// ADVERSARIAL ROUND 1 — the account boundary in DEMO MODE with the REAL supabase-js client (no fake
// session source at all): `VITE_DEMO=1` (prefix `bunprise.demo.`, channel `bunprise.demo.session`), the
// real lib/supabaseClient.ts against the MSW demo world (src/mocks/handlers.ts), the real auth-js events
// reaching the real session watcher. Checks: (1) an identity switch A → B through real SIGNED_IN events
// resets the tab and a late answer for A is discarded; (2) demo never touches the real account's keys or
// channel; (3) the "late token refresh" race of a sign-out is closed by auth-js's commit guard (pinned
// @supabase/auth-js 2.118.0) — a refresh of A that lands after the cleanup does not bring A back.
// Invented demo addresses only (example.test).

vi.mock('../../router', () => ({ router: { state: { location: { pathname: '/soon', href: '/soon' } }, navigate: vi.fn() } }))

type AppModules = {
  app: typeof import('../../lib/app')
  boundary: typeof import('../../lib/accountBoundary')
  session: typeof import('../../lib/session')
  supabase: typeof import('../../lib/supabase')
  query: typeof import('../../lib/query')
  occasions: typeof import('../../lib/api/occasions')
}

const server = setupServer()
const replace = vi.fn<(url: string) => void>()
let modules: AppModules
let client: SupabaseClient<Database>
let stop: (() => void) | null = null

/** A fresh page in demo mode: every app module evaluated again with VITE_DEMO=1. */
async function loadDemoPage(): Promise<AppModules> {
  vi.stubEnv('VITE_DEMO', '1')
  vi.resetModules()
  return {
    app: await import('../../lib/app'),
    boundary: await import('../../lib/accountBoundary'),
    session: await import('../../lib/session'),
    supabase: await import('../../lib/supabase'),
    query: await import('../../lib/query'),
    occasions: await import('../../lib/api/occasions'),
  }
}

/** /login → /login/code with the demo code: real OTP requests, real SIGNED_IN of auth-js. */
async function signIn(email: string): Promise<string> {
  expect((await client.auth.signInWithOtp({ email })).error).toBeNull()
  const { data, error } = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  expect(error).toBeNull()
  await flush(10)
  const id = data.session?.user.id
  if (!id) throw new Error('demo sign-in without a session')
  return id
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

beforeEach(async () => {
  server.resetHandlers(...createDemoHandlers())
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('location', { ...window.location, replace })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  replace.mockReset()
  window.localStorage.clear()
  window.sessionStorage.clear()
  modules = await loadDemoPage()
  stop = modules.session.watchSessionIdentity()
  client = await modules.supabase.getSupabase()
  await flush(20) // auth-js initialised, INITIAL_SESSION (signed out) delivered
})

afterEach(async () => {
  stop?.()
  stop = null
  await client.auth.stopAutoRefresh()
  modules.boundary.resetAccountBoundaryForTests()
  modules.query.queryClient.clear()
  FakeBroadcastChannel.closeAll()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('demo mode: identity switch through the real SDK', () => {
  it('runs in demo mode with its own keys and channel', () => {
    expect(modules.app.DEMO_MODE).toBe(true)
    expect(modules.app.AUTH_STORAGE_KEY).toBe('bunprise.demo.auth')
    expect(modules.boundary.SESSION_CHANNEL).toBe('bunprise.demo.session')
  })

  it('A → B (real SIGNED_IN events): reset + reload, demo drafts gone, real drafts and session untouched, late answer for A discarded', async () => {
    window.localStorage.setItem('bunprise.auth', '{"user":{"id":"real-account"}}') // a real session on the same origin
    const guestA = await signIn('gast.a@example.test')
    const epochA = modules.boundary.captureEpoch()
    expect(epochA.userId).toBe(guestA)
    expect(replace).not.toHaveBeenCalled() // signed out → A is the first sign-in: no reset
    window.sessionStorage.setItem('bunprise.demo.pendingInvite', '6a'.repeat(32))
    window.sessionStorage.setItem('bunprise.demo.loginDraft', '{"email":"gast.a@example.test"}')
    window.sessionStorage.setItem('bunprise.pendingInvite', 'real tab draft')

    const arrived = deferred()
    const gate = deferred()
    server.use(http.post(`${DEMO_SUPABASE_URL}/rest/v1/rpc/get_feed`, async () => {
      arrived.resolve()
      await gate.promise
      return json({ upcoming: [{ id: 'x', title: 'Geheimes Fest von A' }], past: [] })
    }))
    const late = modules.occasions.getFeed(guestA)
    const outcome = late.then(() => 'resolved', (err: unknown) => (err as { code?: string }).code)
    await arrived.promise

    const ownerB = await signIn('besitzer.b@example.test')
    expect(ownerB).not.toBe(guestA)

    expect(epochA.isCurrent()).toBe(false)
    expect(replace.mock.calls).toEqual([['/soon']])
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(window.sessionStorage.getItem('bunprise.demo.pendingInvite')).toBeNull()
    expect(window.sessionStorage.getItem('bunprise.demo.loginDraft')).toBeNull()
    expect(window.sessionStorage.getItem('bunprise.pendingInvite')).toBe('real tab draft') // demo never touches the real prefix
    expect(window.localStorage.getItem('bunprise.auth')).toBe('{"user":{"id":"real-account"}}')
    expect(window.localStorage.getItem('bunprise.demo.auth')).toContain(ownerB) // B's own session stays

    gate.resolve()
    expect(await outcome).toBe('session_expired')
  })

  it("a real-mode tab's sign-out (bunprise.session / bunprise.auth) never resets the demo tab; the demo channel does", async () => {
    const guestA = await signIn('gast.a@example.test')
    window.localStorage.setItem('bunprise.auth', '{"user":{"id":"real-account"}}')
    new FakeBroadcastChannel('bunprise.session').postMessage({ type: 'account-cleared', userId: guestA })
    window.localStorage.removeItem('bunprise.auth')
    window.dispatchEvent(new StorageEvent('storage', { key: 'bunprise.auth', newValue: null, storageArea: window.localStorage }))
    await flush()
    expect(replace).not.toHaveBeenCalled()
    expect(modules.boundary.captureEpoch().isCurrent()).toBe(true)

    new FakeBroadcastChannel('bunprise.demo.session').postMessage({ type: 'account-cleared', userId: guestA })
    await flush()
    expect(replace.mock.calls).toEqual([['/login']])
  })

  it('demo sign-out announces on the demo channel only and leaves real keys (also sb-*) alone', async () => {
    const guestA = await signIn('gast.a@example.test')
    window.localStorage.setItem('bunprise.auth', '{"user":{"id":"real-account"}}')
    window.localStorage.setItem('sb-fixture-auth-token', 'real sdk leftover')
    const demoTab = new FakeBroadcastChannel('bunprise.demo.session')
    const realTab = new FakeBroadcastChannel('bunprise.session')
    const demoHeard: unknown[] = []
    const realHeard: unknown[] = []
    demoTab.onmessage = (event) => { demoHeard.push(event.data) }
    realTab.onmessage = (event) => { realHeard.push(event.data) }

    await modules.query.signOutEverywhere({ expectedUserId: guestA })
    await flush()

    expect(demoHeard).toEqual([{ type: 'account-cleared', userId: guestA }])
    expect(realHeard).toEqual([])
    expect(window.localStorage.getItem('bunprise.demo.auth')).toBeNull()
    expect(window.localStorage.getItem('bunprise.auth')).toBe('{"user":{"id":"real-account"}}')
    expect(window.localStorage.getItem('sb-fixture-auth-token')).toBe('real sdk leftover')
    expect(replace.mock.calls).toEqual([['/login']])
  })
})

describe('sign-out vs. a token refresh of A that is still in flight (real auth-js)', () => {
  /** The next /auth/v1/token request waits for the test, then the demo server answers it as usual. */
  function holdRefresh() {
    const arrived = deferred()
    const gate = deferred()
    server.use(http.post(`${DEMO_SUPABASE_URL}/auth/v1/token`, async () => {
      arrived.resolve()
      await gate.promise
      return undefined // fall through to the demo handler: a valid rotated session for A
    }, { once: true }))
    return { arrived, gate }
  }

  it("another tab signs A out while this tab refreshes A: the rotated tokens are discarded, A stays signed out", async () => {
    const guestA = await signIn('gast.a@example.test')
    const refresh = holdRefresh()
    const refreshing = client.auth.refreshSession()
    await refresh.arrived.promise

    // the other tab: logout + cleanup (removes the shared stored session), announces, reloads
    const oldValue = window.localStorage.getItem('bunprise.demo.auth')
    window.localStorage.removeItem('bunprise.demo.auth')
    window.dispatchEvent(new StorageEvent('storage', { key: 'bunprise.demo.auth', oldValue, newValue: null, storageArea: window.localStorage }))
    new FakeBroadcastChannel('bunprise.demo.session').postMessage({ type: 'account-cleared', userId: guestA })
    await flush()
    expect(replace.mock.calls).toEqual([['/login']])

    refresh.gate.resolve()
    const result = await refreshing
    await flush(20)
    // the protection is auth-js's commit guard (storage changed under the refresh), not luck
    expect(result.error?.name).toBe('AuthRefreshDiscardedError')

    expect(window.localStorage.getItem('bunprise.demo.auth')).toBeNull() // the reload finds the device signed out
  })

  it('the tab that signs out: a refresh in flight when the cleanup runs does not write A back', async () => {
    const guestA = await signIn('gast.a@example.test')
    const refresh = holdRefresh()
    const refreshing = client.auth.refreshSession()
    await refresh.arrived.promise

    // = clearAccountDeviceState(A) of this tab (signOutEverywhere waits for the SDK lock, so its local part is used here)
    expect(modules.query.clearAccountDeviceState(guestA, '/login')).toBe(true)
    expect(window.localStorage.getItem('bunprise.demo.auth')).toBeNull()

    refresh.gate.resolve()
    const result = await refreshing
    await flush(20)
    // the protection is auth-js's commit guard (storage changed under the refresh), not luck
    expect(result.error?.name).toBe('AuthRefreshDiscardedError')

    expect(window.localStorage.getItem('bunprise.demo.auth')).toBeNull()
  })
})
