import type { ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { act, render, screen } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The in-app account switch of the reload-loop guard (lib/session.ts switchInApp, round-1 review H2
// residual) with a REAL TanStack router: the hardest case is a switch to the SAME route (A on /soon →
// B on /soon). The router keeps the element of an unchanged match, so A's screen — subscribed to a query
// that the switch removed from the cache — would stay mounted with A's data. AccountSwitchGate (in the
// app's root shell) renders no routed screen during the switch, so B's screen is built anew.
// Invented fixture accounts only; no request leaves this file.

const hooks = vi.hoisted(() => ({
  session: null as Session | null,
  listeners: new Set<(event: AuthChangeEvent, session: Session | null) => void>(),
  router: null as null | { navigate: (options: never) => Promise<void>; state: { location: { pathname: string; href: string } } },
}))

const fakeClient = vi.hoisted(() => ({
  auth: {
    getSession: () => Promise.resolve({ data: { session: hooks.session }, error: null }),
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      hooks.listeners.add(callback)
      return { data: { subscription: { unsubscribe: () => hooks.listeners.delete(callback) } } }
    },
  },
}))

vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(fakeClient),
  hasLocalSession: () => hooks.session !== null,
  getLocalSession: () => Promise.resolve(hooks.session),
  onClientReady: (ready: (client: unknown) => void) => {
    ready(fakeClient)
    return () => {}
  },
}))
vi.mock('../router', () => ({
  router: {
    navigate: (options: never) => hooks.router?.navigate(options) ?? Promise.resolve(),
    get state() {
      return hooks.router?.state ?? { location: { pathname: '/', href: '/' } }
    },
  },
}))

import { AUTH_STORAGE_KEY } from '../lib/app'
import { captureEpoch, resetAccountBoundaryForTests } from '../lib/accountBoundary'
import { clearPersistedCache, queryClient, setSdkSessionIdentity } from '../lib/query'
import { ACCOUNT_RELOAD_KEY, watchSessionIdentity } from '../lib/session'
import { AccountSwitchGate } from '../features/shell/AccountSwitchGate'

const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b2'

function session(userId: string): Session {
  return { access_token: `fixture-token-${userId}`, user: { id: userId } } as Session
}

function emit(event: AuthChangeEvent) {
  for (const listener of Array.from(hooks.listeners)) listener(event, hooks.session)
}

/** The SDK stores the session, then reports it (as auth-js does). */
function signIn(userId: string, event: AuthChangeEvent) {
  hooks.session = session(userId)
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: `fixture-token-${userId}`, user: { id: userId } }))
  emit(event)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const flush = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A feed screen like FeedPage: reads ['feed'] with useQuery; the data names the account it belongs to. */
function FeedScreen() {
  const feed = useQuery({
    queryKey: ['feed'],
    queryFn: () => Promise.resolve(hooks.session?.user.id === A ? 'Feed von A · 2 von dir reserviert' : 'Feed von B'),
    staleTime: Infinity,
  })
  return <p>{feed.data ?? 'lädt'}</p>
}

const slots = { guard: null as Promise<void> | null }

function mountSoon(root: (props: { children: ReactNode }) => ReactNode) {
  const rootRoute = createRootRoute({ component: () => root({ children: <Outlet /> }) })
  // = routes/_authed.tsx: the next account's guard (getLocalSession + a fresh get_me) runs here
  const authed = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authed',
    beforeLoad: async () => {
      if (slots.guard) await slots.guard
    },
  })
  const routeTree = rootRoute.addChildren([
    authed.addChildren([createRoute({ getParentRoute: () => authed, path: '/soon', component: FeedScreen })]),
    createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => <p>Anmelden</p> }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/soon'] }), defaultPendingMs: 150, defaultPendingMinMs: 300 })
  hooks.router = router as unknown as NonNullable<typeof hooks.router>
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

const replace = vi.fn<(url: string) => void>()
let stop: (() => void) | null = null

beforeEach(async () => {
  vi.stubGlobal('location', { ...window.location, replace })
  vi.stubGlobal('BroadcastChannel', undefined)
  replace.mockReset()
  hooks.session = null
  hooks.router = null
  slots.guard = null
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
  stop = watchSessionIdentity()
})

afterEach(async () => {
  slots.guard = null
  stop?.()
  stop = null
  hooks.listeners.clear()
  vi.unstubAllGlobals()
  resetAccountBoundaryForTests()
  await clearPersistedCache()
  queryClient.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('in-app account switch to the same route (reload-loop guard)', () => {
  it("with AccountSwitchGate (the app's root shell): A's screen is gone at once and B's is built anew", async () => {
    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - 1_000)) // reloaded for an account change 1 s ago
    signIn(A, 'INITIAL_SESSION')
    mountSoon(({ children }) => <AccountSwitchGate>{children}</AccountSwitchGate>)
    expect(await screen.findByText('Feed von A · 2 von dir reserviert')).toBeTruthy()
    const guard = deferred()
    slots.guard = guard.promise

    await act(async () => {
      signIn(B, 'SIGNED_IN')
      await flush(10)
    })

    expect(replace).not.toHaveBeenCalled() // the loop guard: no second reload within 5 s
    expect(captureEpoch().userId).toBe(B)
    expect(document.body.textContent).not.toContain('Feed von A') // not just hidden: unmounted
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(document.body.hasAttribute('inert')).toBe(true)

    await act(async () => {
      guard.resolve()
      await flush(50)
    })

    expect(await screen.findByText('Feed von B')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Feed von A')
    expect(document.documentElement.style.visibility).toBe('') // shown again once B's screen rendered
    expect(document.body.hasAttribute('inert')).toBe(false)
  })

  it('why the gate exists: without it the router keeps the screen of an unchanged match (A stays on screen for B)', async () => {
    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - 1_000))
    signIn(A, 'INITIAL_SESSION')
    mountSoon(({ children }) => children) // a root shell without AccountSwitchGate
    expect(await screen.findByText('Feed von A · 2 von dir reserviert')).toBeTruthy()

    await act(async () => {
      signIn(B, 'SIGNED_IN')
      await flush(50)
    })

    // the page is shown again after the navigation, and the memoized route element still holds A's data
    expect(document.documentElement.style.visibility).toBe('')
    expect(document.body.textContent).toContain('Feed von A')
  })
})
