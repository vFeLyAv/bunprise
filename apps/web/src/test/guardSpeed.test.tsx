import type { Session } from '@supabase/supabase-js'
import { act, render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../lib/api/types'

// Route change time behind the REAL _authed guard (routes/_authed.tsx beforeLoad + lib/consentGate.ts)
// with a get_me that takes LATENCY_MS, like a round trip Germany → Supabase (Paris) → Postgres.
// docs/decisions/2026-10-20-guard-me-cache.md: before the change every screen change waited for a
// fresh get_me (measured with this harness, get_me 150 ms: 239 · 161 · 157 · 154 · 158 ms, 5 calls).
// Now only a change without a trusted answer waits. Invented fixture account only.

const LATENCY_MS = 200
/** a screen change that does not wait for the network (jsdom + router work only) */
const INSTANT_MS = LATENCY_MS / 2
const A = '00000000-0000-4000-8000-0000000000a1'

const hooks = vi.hoisted(() => ({ session: null as Session | null, getMe: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('no client in this test')),
  hasLocalSession: () => hooks.session !== null,
  getLocalSession: () => Promise.resolve(hooks.session),
  onClientReady: () => () => {},
}))
vi.mock('../lib/api/profile', () => ({ getMe: hooks.getMe }))

import { Route as AuthedRoute } from '../routes/_authed'

function me(id: string, consentsOk = true): Me {
  return {
    profile: { id, display_name: 'Mila', locale: 'de', onboarding_done_at: '2026-10-01T10:00:00Z' },
    consents_ok: consentsOk,
    legal_versions: { terms: 't1', privacy: 'p1', age: 'a1' },
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Guard = (options: unknown) => unknown
const guard = AuthedRoute.options.beforeLoad as unknown as Guard

function mount(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const authed = createRoute({ getParentRoute: () => rootRoute, id: '_authed', beforeLoad: (options) => guard(options) as never })
  const routeTree = rootRoute.addChildren([
    authed.addChildren([
      createRoute({ getParentRoute: () => authed, path: '/soon', component: () => <p>Feed</p> }),
      createRoute({ getParentRoute: () => authed, path: '/occasions/new', component: () => <p>Neuer Anlass</p> }),
      createRoute({
        getParentRoute: () => authed, path: '/welcome/profile', staticData: { allowWithoutConsent: true }, component: () => <p>Profil</p>,
      }),
    ]),
    createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => <p>Anmelden</p> }),
  ])
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: ['/soon'] }) })
  render(<RouterProvider router={router} />)
  return router
}

/** Time from navigate() until the router has committed the next screen. */
async function timed(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now()
  await act(async () => {
    await run()
  })
  return performance.now() - started
}

/** Moves the clock by `ms` (Date only: timers and performance.now stay real). */
function later(ms: number) {
  const now = Date.now()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now + ms)
}

beforeEach(() => {
  hooks.session = { access_token: 'fixture-token', user: { id: A } } as Session
  hooks.getMe.mockReset()
  hooks.getMe.mockImplementation(async () => {
    await sleep(LATENCY_MS)
    return me(A)
  })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('route change time behind the _authed guard', () => {
  it('only the first screen waits for get_me; the next screen changes are instant', async () => {
    const router = mount(new QueryClient())
    const first = performance.now()
    expect(await screen.findByText('Feed')).toBeTruthy()
    const times = [performance.now() - first]
    for (const to of ['/occasions/new', '/soon', '/occasions/new', '/soon'] as const) {
      times.push(await timed(() => router.navigate({ to })))
    }
    console.info(`[guard timing] get_me ${LATENCY_MS} ms · screens (ms): ${times.map((ms) => ms.toFixed(0)).join(' · ')} · get_me calls: ${hooks.getMe.mock.calls.length}`)
    expect(times[0]).toBeGreaterThanOrEqual(LATENCY_MS - 5)
    for (const ms of times.slice(1)) expect(ms).toBeLessThan(INSTANT_MS)
    expect(hooks.getMe).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Feed')).toBeTruthy()
  })

  it('after 30 s a screen change still does not wait, it refreshes in the background; after 60 s it waits again', async () => {
    const router = mount(new QueryClient())
    expect(await screen.findByText('Feed')).toBeTruthy()

    later(31_000)
    expect(await timed(() => router.navigate({ to: '/occasions/new' }))).toBeLessThan(INSTANT_MS)
    expect(hooks.getMe).toHaveBeenCalledTimes(2) // the background refresh is on its way
    await act(() => sleep(LATENCY_MS + 20)) // … and lands: the window starts again from now

    later(59_000) // 59 s after the refresh (90 s after the first answer): still trusted
    expect(await timed(() => router.navigate({ to: '/soon' }))).toBeLessThan(INSTANT_MS)
    await act(() => sleep(LATENCY_MS + 20))

    later(61_000) // more than 60 s without a successful answer: wait for the server
    expect(await timed(() => router.navigate({ to: '/occasions/new' }))).toBeGreaterThanOrEqual(LATENCY_MS - 5)
    expect(screen.getByText('Neuer Anlass')).toBeTruthy()
  })

  it('preloading a screen never sends a background refresh', async () => {
    const router = mount(new QueryClient())
    expect(await screen.findByText('Feed')).toBeTruthy()
    later(31_000)
    await act(async () => {
      await router.preloadRoute({ to: '/occasions/new' })
    })
    expect(hooks.getMe).toHaveBeenCalledTimes(1)
  })

  it('fails closed: without a trusted answer an error sends the person to /welcome/profile', async () => {
    hooks.getMe.mockReset()
    hooks.getMe.mockRejectedValue(new TypeError('Failed to fetch'))
    const router = mount(new QueryClient())
    expect(await screen.findByText('Profil')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/welcome/profile')
    expect(router.state.location.search).toMatchObject({ next: '/soon' })
  })

  it('a trusted "consents missing" answer redirects at once, without a request', async () => {
    hooks.getMe.mockReset()
    hooks.getMe.mockResolvedValue(me(A, false))
    const router = mount(new QueryClient())
    expect(await screen.findByText('Profil')).toBeTruthy()
    expect(await timed(() => router.navigate({ to: '/occasions/new' }))).toBeLessThan(INSTANT_MS)
    expect(router.state.location.pathname).toBe('/welcome/profile')
    expect(hooks.getMe).toHaveBeenCalledTimes(1)
  })

  it("another account's answer in memory is never used (the session decides whose answer counts)", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['me'], me('00000000-0000-4000-8000-0000000000b2'))
    mount(queryClient)
    expect(await screen.findByText('Feed')).toBeTruthy()
    expect(hooks.getMe).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData<Me>(['me'])?.profile.id).toBe(A)
  })
})
