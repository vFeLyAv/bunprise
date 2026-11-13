import type { ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../lib/api/types'

// ADVERSARIAL ROUND 1 — Codex review 2, H2 (the previous React tree survives an account switch), with a
// REAL TanStack router: the screens of account A are mounted in routes, the session watcher switches the
// tab, and the `_authed` guard of the next account (getLocalSession + a fresh get_me in the app) is still
// running. Two paths of lib/session.ts endShownAccount():
//   (1) the normal reset: page hidden + inert, then location.replace — A's DOM must be unusable at once;
//   (2) the reload-loop guard (another account change < 5 s after an account reload): no reload, an
//       in-app router.navigate instead. A reload-loop attempt (rapid A → B → A …) lands here.
// SECURE behaviour asserted in both: from the moment of the switch, nothing of A — reservation chips,
// an open sheet portal, a toast, A's name, A's typed text — is visible or usable for the next account.
// Invented fixtures; Supabase is a fixture session source only (no request is sent in this file).

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void

const hooks = vi.hoisted(() => ({
  session: null as Session | null,
  listeners: new Set<(event: AuthChangeEvent, session: Session | null) => void>(),
  router: null as null | { navigate: (options: never) => Promise<void>; state: { location: { pathname: string; href: string } } },
  getMe: vi.fn(),
  acceptInvite: vi.fn(),
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

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(fakeClient),
  hasLocalSession: () => hooks.session !== null,
  getLocalSession: () => Promise.resolve(hooks.session),
  onClientReady: (ready: (client: unknown) => void) => {
    ready(fakeClient)
    return () => {}
  },
}))
// lib/session.ts navigates with the app router: here it is the test router of the running test
vi.mock('../../router', () => ({
  router: {
    navigate: (options: never) => hooks.router?.navigate(options) ?? Promise.resolve(),
    get state() {
      return hooks.router?.state ?? { location: { pathname: '/', href: '/' } }
    },
  },
}))
vi.mock('../../features/mascot-ui/Mascot', () => ({
  Mascot: ({ kind }: { kind: string }) => <div data-testid="mascot" data-kind={kind} />,
  preloadMascot: () => undefined,
}))
vi.mock('../../lib/api/profile', () => ({ getMe: hooks.getMe, updateMyProfile: vi.fn() }))
vi.mock('../../lib/api/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/account')>()),
  getAccountDetails: (userId: string) => Promise.resolve({
    me: { profile: { id: userId, display_name: 'Mila Fixture', locale: 'de', onboarding_done_at: null }, consents_ok: true, legal_versions: { terms: 't', privacy: 'p', age: 'a' } },
    email: 'mila.fixture@example.test',
  }),
}))
vi.mock('../../lib/api/invites', () => ({ acceptInvite: hooks.acceptInvite }))

import { AUTH_STORAGE_KEY } from '../../lib/app'
import { captureEpoch, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import { clearPersistedCache, queryClient, setSdkSessionIdentity } from '../../lib/query'
import { qk } from '../../lib/queryKeys'
import { ACCOUNT_RELOAD_GUARD_MS, ACCOUNT_RELOAD_KEY, watchSessionIdentity } from '../../lib/session'
import { getToasts, toast } from '../../lib/toast'
import { SettingsPage } from '../../features/account/AccountPages'
import JoinGate from '../../features/invite/JoinGate'
import { setPendingInvite } from '../../features/invite/pending'
import { WishlistSection } from '../../features/wishes/WishlistSection'
import { EditWishPage } from '../../features/wishes/WishEditorPages'
import { resetPendingWishDeletes } from '../../features/wishes/pendingDeletes'
import {
  AppProviders, FREE, GUEST_A, HOST_A, INVITE_TOKEN, MINE, OCCASION_ID, OWNER_B, RESERVATION_TEXT,
  deferred, fixtureSession, flush, screenFor, storedSession, visibleMatches,
} from './round1-kit'

// ---- a small app: the same route shapes and guard position as src/routes ---------------------------

const slots = { content: null as ReactNode, guard: null as Promise<void> | null }

function buildRouter(initial: string) {
  const root = createRootRoute({ component: () => <Outlet /> })
  // = routes/_authed.tsx: every private screen waits for the guard (getLocalSession + fresh get_me)
  const authed = createRoute({
    getParentRoute: () => root,
    id: '_authed',
    beforeLoad: async () => {
      if (slots.guard) await slots.guard
    },
  })
  const screenRoute = (path: string) => createRoute({ getParentRoute: () => authed, path, component: () => <>{slots.content}</> })
  const routeTree = root.addChildren([
    authed.addChildren([
      createRoute({ getParentRoute: () => authed, path: '/soon', component: () => <p>Feed des neuen Kontos</p> }),
      createRoute({ getParentRoute: () => authed, path: '/welcome/profile', component: () => <p>Profil</p> }),
      screenRoute('/occasions/$occasionId'),
      screenRoute('/settings'),
      screenRoute('/wishes/$wishId/edit'),
    ]),
    createRoute({ getParentRoute: () => root, path: '/login', component: () => <p>Anmelden</p> }),
    createRoute({ getParentRoute: () => root, path: '/i', component: () => <>{slots.content}</> }),
  ])
  // the app's pending options (src/router.tsx); no defaultPendingComponent there either
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initial] }), defaultPendingMs: 150, defaultPendingMinMs: 300 })
  hooks.router = router as unknown as NonNullable<typeof hooks.router>
  return router
}

async function mount(initial: string, content: ReactNode) {
  slots.content = content
  slots.guard = null
  const router = buildRouter(initial)
  render(<RouterProvider router={router} />, { wrapper: AppProviders })
  await act(async () => {
    await router.load()
    await flush(20)
  })
  return router
}

function emit(event: AuthChangeEvent) {
  for (const listener of Array.from(hooks.listeners)) (listener as AuthListener)(event, hooks.session)
}

function openAs(userId: string) {
  hooks.session = fixtureSession(userId)
  window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(userId))
  emit('INITIAL_SESSION')
}

/** The SDK of this tab reports another account (or none). */
async function sdkSwitch(next: string | null) {
  await act(async () => {
    hooks.session = next ? fixtureSession(next) : null
    if (next) window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
    else window.localStorage.removeItem(AUTH_STORAGE_KEY)
    emit(next ? 'SIGNED_IN' : 'SIGNED_OUT')
    await flush(10)
  })
}

/** Another tab replaced / removed the stored session (only the storage event arrives here). */
async function storageSwitch(next: string | null) {
  await act(async () => {
    hooks.session = next ? fixtureSession(next) : null
    if (next) window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
    else window.localStorage.removeItem(AUTH_STORAGE_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: next ? storedSession(next) : null, storageArea: window.localStorage }))
    await flush(10)
  })
}

/** This tab reloaded `ago` ms ago because its previous account ended (the loop guard's record). */
function reloadedAgo(ago: number) {
  window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - ago))
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)
  if (!el) throw new Error(`row ${id} not rendered`)
  return el
}

function guestList() {
  const list = screenFor('guest').wishlist
  if (!list) throw new Error('fixture without wishlist')
  return list
}

/** A's guest view with everything that carries reservation state: chips, the open sheet, a toast. */
async function mountGuestViewOfA() {
  openAs(GUEST_A)
  queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
  const router = await mount(`/occasions/${OCCASION_ID}`, <WishlistSection occasionId={OCCASION_ID} wishlist={guestList()} viewer="guest" />)
  expect(screen.getAllByText('Von dir reserviert').length).toBeGreaterThan(0)
  const button = row(MINE).querySelector('button')
  if (!button) throw new Error('row button missing')
  fireEvent.click(button)
  expect(screen.getByRole('dialog').textContent).toMatch(/Reservierung aufheben/) // a portal in <body>
  act(() => {
    toast.success('Versteckt! Ben erfährt nichts.')
  })
  expect(visibleMatches(RESERVATION_TEXT).length).toBeGreaterThan(0)
  return router
}

const replace = vi.fn<(url: string) => void>()
let stop: (() => void) | null = null

beforeEach(async () => {
  vi.stubGlobal('location', { ...window.location, replace })
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  replace.mockReset()
  hooks.getMe.mockReset()
  hooks.acceptInvite.mockReset()
  hooks.session = null
  hooks.router = null
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  resetPendingWishDeletes()
  window.localStorage.clear()
  window.sessionStorage.clear()
  stop = watchSessionIdentity()
})

afterEach(async () => {
  slots.guard = null
  stop?.()
  stop = null
  hooks.listeners.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetAccountBoundaryForTests()
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('control: the normal reset (no recent account reload)', () => {
  it.each(['sdk', 'storage'] as const)('via %s: A\'s guest view, its sheet portal and its toast are unusable at once', async (channel) => {
    await mountGuestViewOfA()
    slots.guard = deferred().promise // a navigation would wait here; the reset must not depend on it

    if (channel === 'sdk') await sdkSwitch(OWNER_B)
    else await storageSwitch(OWNER_B)

    expect(replace.mock.calls).toEqual([['/soon']])
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([])
    expect(getToasts()).toEqual([])
  })
})

describe('the reload-loop guard path (an account change < 5 s after an account reload)', () => {
  it("rapid A → B: while B's guard still runs, nothing of A's guest view (chips, open sheet, toast) is visible or usable", async () => {
    reloadedAgo(1_000)
    await mountGuestViewOfA()
    slots.guard = deferred().promise // B's fresh get_me is still on its way (slow network)

    await sdkSwitch(OWNER_B)

    expect(replace).not.toHaveBeenCalled() // by design of the loop guard: no reload, an in-app switch
    expect(captureEpoch().userId).toBe(OWNER_B)
    // SECURE: the owner B must not see which of B's wishes are reserved
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([])
  })

  it('rapid A → B via the storage event (other tab): the same — A\'s guest view must be gone or hidden at once', async () => {
    reloadedAgo(2_000)
    await mountGuestViewOfA()
    slots.guard = deferred().promise

    await storageSwitch(OWNER_B)

    expect(replace).not.toHaveBeenCalled()
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([])
  })

  it('the exposure lasts exactly as long as the next account\'s guard: A\'s view disappears only when it resolves', async () => {
    reloadedAgo(1_000)
    await mountGuestViewOfA()
    const guard = deferred()
    slots.guard = guard.promise

    await sdkSwitch(OWNER_B)
    await act(() => flush(400)) // longer than defaultPendingMs + defaultPendingMinMs: no pending UI replaces it
    const stillShown = visibleMatches(RESERVATION_TEXT)

    await act(async () => {
      guard.resolve()
      await flush(50)
    })
    expect(screen.getByText('Feed des neuen Kontos')).toBeTruthy()
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([]) // gone once B's guard resolved …
    expect(stillShown).toEqual([]) // … SECURE would be: gone before it, too
  })

  it("JoinGate: A's name is not shown to the next account while the switch is in progress", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    setPendingInvite(INVITE_TOKEN)
    const profile: Me = {
      profile: { id: GUEST_A, display_name: 'Mila Fixture', locale: 'de', onboarding_done_at: null },
      consents_ok: true,
      legal_versions: { terms: 't', privacy: 'p', age: 'a' },
    }
    hooks.getMe.mockResolvedValue(profile)
    await mount('/i', <JoinGate onSignedOut={() => {}} onInvalid={() => {}} />)
    await screen.findByRole('heading', { name: 'Möchtest du beitreten?' })
    expect(visibleMatches(/Mila Fixture/).length).toBeGreaterThan(0)
    slots.guard = deferred().promise

    await sdkSwitch(OWNER_B)

    expect(visibleMatches(/Mila Fixture/)).toEqual([])
    // and "Beitreten" on A's screen joins nobody (the link went with A's drafts)
    const join = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Beitreten'))
    if (join) fireEvent.click(join)
    await act(() => flush(20))
    expect(hooks.acceptInvite).not.toHaveBeenCalled()
  })

  it("EditWishPage / WishForm: A's typed private text is not left on screen for the next account", async () => {
    reloadedAgo(1_000)
    openAs(HOST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('owner', HOST_A, 'Mila'))
    await mount(`/wishes/${FREE}/edit`, <EditWishPage wishId={FREE} userId={HOST_A} />)
    const note = await screen.findByLabelText('Notiz')
    fireEvent.change(note, { target: { value: 'Geheim: Überraschung für Ben' } })
    slots.guard = deferred().promise

    await sdkSwitch(OWNER_B)

    expect(visibleMatches(/Geheim: Überraschung|Grillzange/)).toEqual([])
  })

  it("SettingsPage: A's name and e-mail address stay off the screen once another tab replaced the session", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    await mount('/settings', <SettingsPage userId={GUEST_A} />)
    // shown twice since wave 1: in the profile header and in the "Konto" row
    expect((await screen.findAllByText('mila.fixture@example.test')).length).toBeGreaterThan(0)
    slots.guard = deferred().promise

    await storageSwitch(OWNER_B) // B signed in in another tab: only the storage event arrives here

    expect(visibleMatches(/mila.fixture@example.test|Mila Fixture/)).toEqual([])
  })

  it('a reload-loop attempt (A → B → A → B within the guard window) never reloads more than once and leaves no A/B residue', async () => {
    await mountGuestViewOfA()
    slots.guard = deferred().promise
    await sdkSwitch(OWNER_B) // the first change: the normal reset, one reload
    await sdkSwitch(GUEST_A)
    await sdkSwitch(OWNER_B)
    expect(replace.mock.calls).toEqual([['/soon']])
    expect(window.sessionStorage.getItem(ACCOUNT_RELOAD_KEY)).not.toBeNull()
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([])
    expect(captureEpoch().isCurrent()).toBe(false) // the page is being replaced: nothing new starts
    expect(ACCOUNT_RELOAD_GUARD_MS).toBe(5_000)
  })
})
