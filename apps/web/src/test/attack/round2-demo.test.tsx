import type { SupabaseClient } from '@supabase/supabase-js'
import { dehydrate } from '@tanstack/react-query'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../lib/database.types'
import { createDemoHandlers, DEMO_CODE, DEMO_SUPABASE_URL, DEMO_USER_ID } from '../../mocks/handlers'
import { FakeBroadcastChannel, deferred, flush } from './round1-kit'

// ADVERSARIAL ROUND 2 — the identity switch in DEMO MODE (`npm run dev:demo`: VITE_DEMO=1, prefix
// `bunprise.demo.`, MSW demo world) with the REAL supabase-js client, the REAL session watcher and the
// REAL startDemo() of src/mocks/browser.ts (only msw/browser's service worker is replaced: the same demo
// handlers answer through msw/node). A "page load" = every app module evaluated again + a fresh demo
// world, exactly what a reload does in the browser (the world lives in page memory).
// SECURE expectations:
//   (1) one person's account-bound choices never apply to another person — in particular the explicit
//       offline-feed opt-in (pilot-decisions §0.16) of A never makes B's feed go to disk;
//   (2) the in-app switch of the reload-loop guard behaves in demo mode as in the real build.
// Invented demo addresses only (example.test).

vi.mock('msw/browser', () => ({
  // startDemo() registers the MSW service worker in the browser; in node the same handlers run in msw/node
  setupWorker: () => ({ start: () => Promise.resolve() }),
}))
vi.mock('../../router', () => ({ router: { state: { location: { pathname: '/soon', href: '/soon' } }, navigate: vi.fn(() => Promise.resolve()) } }))

type Page = {
  app: typeof import('../../lib/app')
  boundary: typeof import('../../lib/accountBoundary')
  session: typeof import('../../lib/session')
  supabase: typeof import('../../lib/supabase')
  query: typeof import('../../lib/query')
  queries: typeof import('../../lib/queries')
  browser: typeof import('../../mocks/browser')
  reservations: typeof import('../../lib/api/reservations')
}

const server = setupServer()
const replace = vi.fn<(url: string) => void>()
let page: Page
let client: SupabaseClient<Database>
let stop: (() => void) | null = null

/** A page load in demo mode: fresh modules, startDemo()'s storage cleanup, a fresh demo world. */
async function loadDemoPage(): Promise<void> {
  stop?.()
  stop = null
  if (client) await client.auth.stopAutoRefresh()
  vi.stubEnv('VITE_DEMO', '1')
  vi.resetModules()
  page = {
    app: await import('../../lib/app'),
    boundary: await import('../../lib/accountBoundary'),
    session: await import('../../lib/session'),
    supabase: await import('../../lib/supabase'),
    query: await import('../../lib/query'),
    queries: await import('../../lib/queries'),
    browser: await import('../../mocks/browser'),
    reservations: await import('../../lib/api/reservations'),
  }
  await page.browser.startDemo() // main.tsx: demo mocks first (removes the demo session and snapshot)
  server.resetHandlers(...createDemoHandlers())
  stop = page.session.watchSessionIdentity()
  client = await page.supabase.getSupabase()
  await flush(20)
}

async function signUp(email: string): Promise<string> {
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

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('location', { ...window.location, replace })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  replace.mockReset()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(async () => {
  stop?.()
  stop = null
  await client.auth.stopAutoRefresh()
  page.boundary.resetAccountBoundaryForTests()
  page.query.queryClient.clear()
  FakeBroadcastChannel.closeAll()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('demo mode: two people on one device, one after the other (page reload in between, no sign-out)', () => {
  // Every demo page load hands its FIRST account the same fixed id (handlers.ts DEMO_USER_ID), so A and B
  // share an id here; the demo server still binds every request to the exact token of its own world.
  it("B never inherits A's offline-feed opt-in although both got the same demo id: B's feed stays off disk", async () => {
    await loadDemoPage()
    const a = await signUp('gast.a@example.test')
    await page.query.setOfflineFeedEnabled(true) // A: Einstellungen → "Schnellstart: Liste offline speichern"
    expect(page.query.isOfflineFeedEnabled()).toBe(true)

    // A closes the tab or reloads; the next person opens the demo and creates an account
    await loadDemoPage()
    await signUp('besitzer.b@example.test')
    expect(a).toBe(DEMO_USER_ID)

    // SECURE: B never opted in
    expect(page.query.isOfflineFeedEnabled()).toBe(false)
    await page.query.queryClient.fetchQuery(page.queries.feedQuery())
    await page.query.persister.persistClient({
      timestamp: Date.now(),
      buster: page.query.persistOptions.buster ?? '',
      clientState: dehydrate(page.query.queryClient, page.query.persistOptions.dehydrateOptions),
    })
    expect(window.localStorage.getItem(page.app.QUERY_CACHE_KEY)).toBeNull()
  })
})

describe('demo mode: the in-app switch of the reload-loop guard with the real SDK', () => {
  it('A → B within 5 s of an account reload: hidden at once, demo drafts gone, real drafts kept, a late answer for A is discarded', async () => {
    await loadDemoPage()
    const a = await signUp('gast.a@example.test')
    const epochA = page.boundary.captureEpoch()
    expect(epochA.userId).toBe(a)
    window.sessionStorage.setItem(page.session.ACCOUNT_RELOAD_KEY, String(Date.now() - 1_000))
    window.sessionStorage.setItem('bunprise.demo.pendingInvite', '6a'.repeat(32))
    window.sessionStorage.setItem('bunprise.pendingInvite', 'real tab draft')
    const arrived = deferred()
    const gate = deferred()
    server.use(http.post(`${DEMO_SUPABASE_URL}/rest/v1/rpc/my_reservations`, async () => {
      arrived.resolve()
      await gate.promise
      return undefined // fall through to the demo world: A's own (empty) reservations
    }, { once: true }))
    const late = page.reservations.getMyReservations(a).then(() => 'resolved', (err: unknown) => (err as { code?: string }).code)
    await arrived.promise

    const b = await signUp('besitzer.b@example.test')
    expect(b).not.toBe(a)

    expect(replace).not.toHaveBeenCalled() // the guard: an in-app switch, no second reload
    expect(epochA.isCurrent()).toBe(false)
    expect(page.boundary.captureEpoch().userId).toBe(b)
    expect(window.sessionStorage.getItem('bunprise.demo.pendingInvite')).toBeNull()
    expect(window.sessionStorage.getItem('bunprise.pendingInvite')).toBe('real tab draft')
    gate.resolve()
    expect(await late).toBe('session_expired')
  })
})
