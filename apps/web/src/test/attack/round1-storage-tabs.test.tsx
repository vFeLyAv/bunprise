import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { act, render, screen } from '@testing-library/react'
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen } from '../../lib/api/types'

// ADVERSARIAL ROUND 1 — Codex review 2, H2 (drafts), H3 (other tabs), the opt-in feed snapshot and L5:
// - sessionStorage drafts of A are gone after every kind of switch (same tab, other tab's storage write,
//   other tab's announcement, the reload-loop guard path);
// - sign-out / deletion in another tab reset this tab, offline too; the stored session is gone before
//   the reload (a refresh still in flight is then discarded by auth-js — see round1-demo-world);
// - A's persisted feed never hydrates for B;
// - DEV logs carry no server text.
// SECURE behaviour is asserted; a failing test is a finding. Invented fixtures only.

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void

const hooks = vi.hoisted(() => ({
  session: null as Session | null,
  listeners: new Set<(event: AuthChangeEvent, session: Session | null) => void>(),
  logout: vi.fn(),
  rpc: vi.fn(),
  navigate: vi.fn(),
}))

const fakeClient = vi.hoisted(() => ({
  auth: {
    getSession: () => Promise.resolve({ data: { session: hooks.session }, error: null }),
    getUser: () => Promise.resolve({ data: { user: hooks.session?.user ?? null }, error: null }),
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      hooks.listeners.add(callback)
      return { data: { subscription: { unsubscribe: () => hooks.listeners.delete(callback) } } }
    },
    admin: { signOut: hooks.logout },
  },
  rpc: hooks.rpc,
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
vi.mock('../../router', () => ({
  router: { state: { location: { pathname: '/occasions/x', href: '/occasions/x' } }, navigate: hooks.navigate },
}))
vi.mock('../../features/mascot-ui/Mascot', () => ({
  Mascot: ({ kind }: { kind: string }) => <div data-testid="mascot" data-kind={kind} />,
  preloadMascot: () => undefined,
}))

import { ACTIVE_STORAGE_PREFIX, AUTH_STORAGE_KEY, OFFLINE_FEED_KEY, QUERY_CACHE_KEY } from '../../lib/app'
import { SESSION_CHANNEL, captureEpoch, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import { deleteMyAccount } from '../../lib/api/account'
import { AppError, toAppError } from '../../lib/errors'
import { clearPersistedCache, persistOptions, persister, queryClient, setOfflineFeedEnabled, setSdkSessionIdentity, signOutEverywhere } from '../../lib/query'
import { qk } from '../../lib/queryKeys'
import { ACCOUNT_RELOAD_KEY, watchSessionIdentity } from '../../lib/session'
import { getToasts, toast } from '../../lib/toast'
import { WishlistSection } from '../../features/wishes/WishlistSection'
import {
  AppProviders, FakeBroadcastChannel, GUEST_A, OCCASION_ID, OWNER_B, RESERVATION_TEXT,
  fixtureSession, flush, screenFor, storedSession, visibleMatches,
} from './round1-kit'

/** Every session-scoped draft of docs/storage-registry.md (both prefixes in the normal build). */
const DRAFTS = ['emailCode', 'loginDraft', 'pendingConsent', 'pendingInvite', 'wishAdded', 'postLoginNext']
const DRAFT_KEYS = [...DRAFTS.map((key) => `${ACTIVE_STORAGE_PREFIX}${key}`), ...DRAFTS.map((key) => `${ACTIVE_STORAGE_PREFIX}demo.${key}`)]

function writeDraftsOfA() {
  for (const key of DRAFT_KEYS) window.sessionStorage.setItem(key, `draft of A (${key})`)
  window.sessionStorage.setItem('other-app.key', 'not ours')
}

function remainingDrafts(): string[] {
  return DRAFT_KEYS.filter((key) => window.sessionStorage.getItem(key) !== null)
}

function emit(event: AuthChangeEvent) {
  for (const listener of Array.from(hooks.listeners)) (listener as AuthListener)(event, hooks.session)
}

function openAs(userId: string) {
  hooks.session = fixtureSession(userId)
  window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(userId))
  emit('INITIAL_SESSION')
}

/** What another tab's sign-out / deletion of `userId` produces here: its storage event and its announcement. */
async function otherTabClears(userId: string, { storageEvent = true, announce = true } = {}) {
  await act(async () => {
    const oldValue = window.localStorage.getItem(AUTH_STORAGE_KEY)
    hooks.session = null
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    if (storageEvent) {
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue, newValue: null, storageArea: window.localStorage }))
    }
    if (announce) new FakeBroadcastChannel(SESSION_CHANNEL).postMessage({ type: 'account-cleared', userId })
    await flush()
  })
}

function feedOfA(): FeedScreen {
  return {
    upcoming: [{
      id: OCCASION_ID, title: 'Annas Geheimfest', starts_at: '2030-06-15T16:00:00.000Z', tz: 'Europe/Berlin', all_day: false,
      place_text: null, role: 'member', rsvp: 'going', host_name: 'Anna', member_count: 4, wish_count: 3, my_reservation_count: 2,
    }],
    past: [],
  }
}

const replace = vi.fn<(url: string) => void>()
let stop: (() => void) | null = null

beforeEach(async () => {
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('location', { ...window.location, replace })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  replace.mockReset()
  hooks.logout.mockReset().mockResolvedValue({ error: null })
  hooks.rpc.mockReset()
  hooks.navigate.mockReset().mockResolvedValue(undefined)
  hooks.session = null
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
  stop = watchSessionIdentity()
})

afterEach(async () => {
  stop?.()
  stop = null
  hooks.listeners.clear()
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
  FakeBroadcastChannel.closeAll()
  vi.unstubAllGlobals()
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('H2 — every session draft of A is gone after the switch', () => {
  const cases: Array<[string, () => Promise<void>]> = [
    ['this tab: A → B (SIGNED_IN)', async () => {
      hooks.session = fixtureSession(OWNER_B)
      window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(OWNER_B))
      emit('SIGNED_IN')
    }],
    ['this tab: A → signed out (SIGNED_OUT)', async () => {
      hooks.session = null
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      emit('SIGNED_OUT')
    }],
    ['other tab: stored session replaced by B (storage event)', async () => {
      window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(OWNER_B))
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: storedSession(OWNER_B), storageArea: window.localStorage }))
    }],
    ['other tab: localStorage.clear() (storage event with key null)', async () => {
      window.localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: window.localStorage }))
    }],
    ['other tab: sign-out announcement only (no storage event yet)', () => otherTabClears(GUEST_A, { storageEvent: false })],
    ['other tab: storage event only (no BroadcastChannel in this browser)', async () => {
      vi.stubGlobal('BroadcastChannel', undefined)
      await otherTabClears(GUEST_A, { announce: false })
    }],
  ]

  it.each(cases)('%s', async (_name, change) => {
    openAs(GUEST_A)
    writeDraftsOfA()
    await act(async () => {
      await change()
      await flush()
    })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(remainingDrafts()).toEqual([])
    expect(window.sessionStorage.getItem('other-app.key')).toBe('not ours')
  })

  it('the reload-loop guard path (no reload) removes them as well', async () => {
    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - 1_000))
    openAs(GUEST_A)
    writeDraftsOfA()
    hooks.session = fixtureSession(OWNER_B)
    window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(OWNER_B))
    emit('SIGNED_IN')
    expect(replace).not.toHaveBeenCalled()
    expect(remainingDrafts()).toEqual([])
  })
})

describe('H3 — sign-out / deletion of A in another tab resets this tab', () => {
  function renderGuestViewOfA() {
    openAs(GUEST_A)
    const guest = screenFor('guest')
    queryClient.setQueryData(qk.occasion(OCCASION_ID), guest)
    queryClient.setQueryData(qk.myReservations(), [{ wish_id: 'w', wish_title: 'Schürze' }])
    if (!guest.wishlist) throw new Error('fixture without wishlist')
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={guest.wishlist} viewer="guest" />, { wrapper: AppProviders })
    act(() => {
      toast.success('Versteckt! Ben erfährt nichts.')
    })
    // online the chips show; offline the guest view hides the reservation state by itself (F8)
    if (navigator.onLine) expect(screen.getAllByText('Von dir reserviert').length).toBeGreaterThan(0)
    else expect(screen.getAllByText('Reservieren geht nur online').length).toBeGreaterThan(0)
    expect(visibleMatches(RESERVATION_TEXT).length).toBeGreaterThan(0)
  }

  it.each([
    ['online', true],
    ['offline', false],
  ])('%s: the other tab signed A out — guest DOM, toast, cache and epoch of A end here at once', async (_name, online) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
    renderGuestViewOfA()
    const started = captureEpoch()

    await otherTabClears(GUEST_A)

    expect(started.isCurrent()).toBe(false)
    expect(replace.mock.calls).toEqual([['/login']])
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(getToasts()).toEqual([])
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([])
  })

  it('the other tab deleted the account: the same reset', async () => {
    renderGuestViewOfA()
    await otherTabClears(GUEST_A, { storageEvent: false }) // deleteMyAccount announces; storage may follow later
    expect(replace.mock.calls).toEqual([['/login']])
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([])
  })

  /** The page comes back from the back/forward cache: `pageshow` with persisted = true, then visible. */
  function restoreFromBfcache() {
    const pageshow = new Event('pageshow')
    Object.defineProperty(pageshow, 'persisted', { value: true })
    window.dispatchEvent(pageshow)
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it.each([
    ['signed A out', null],
    ['signed B in (replacing A)', OWNER_B],
  ])('a page restored from the back/forward cache after another tab %s re-checks its account (no event reached the cached page)', async (_name, next) => {
    renderGuestViewOfA()
    // while the page sat in the bfcache: the stored session changed, but no storage event / channel
    // message was delivered to it — and auth-js emits nothing on restore when the session is gone or
    // replaced (_recoverAndRefresh returns silently for a null session)
    hooks.session = next ? fixtureSession(next) : null
    if (next) window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
    else window.localStorage.removeItem(AUTH_STORAGE_KEY)

    await act(async () => {
      restoreFromBfcache()
      await flush()
    })

    expect(replace).toHaveBeenCalledTimes(1)
    expect(visibleMatches(RESERVATION_TEXT)).toEqual([])
  })

  // A token refresh of A still in flight when A is signed out (here or in another tab) is discarded by
  // auth-js's commit guard because the stored session changed under it — verified with the REAL client
  // in round1-demo-world.test.tsx. The app's part: the stored session is gone BEFORE the reload starts.
  it('signOutEverywhere and deleteMyAccount remove the stored session of A before their reload', async () => {
    openAs(GUEST_A)
    replace.mockImplementation(() => {
      expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    })
    await signOutEverywhere({ expectedUserId: GUEST_A })
    expect(hooks.logout).toHaveBeenCalledWith(`fixture-token-${GUEST_A}`, 'global')
    expect(replace.mock.calls).toEqual([['/login']])

    resetAccountBoundaryForTests()
    openAs(GUEST_A)
    hooks.rpc.mockImplementation(() => ({ setHeader: () => Promise.resolve({ data: { ok: true }, error: null }) }))
    await deleteMyAccount({ expectedUserId: GUEST_A })
    expect(replace.mock.calls).toEqual([['/login'], ['/']])
  })
})

describe('the persisted feed (opt-in) of A never hydrates for B', () => {
  async function persistFeedOfA() {
    window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(GUEST_A))
    queryClient.setQueryData(qk.feed(), feedOfA())
    await setOfflineFeedEnabled(true)
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toContain('Annas Geheimfest')
    queryClient.clear() // the next page load starts with an empty memory cache
  }

  it('B is stored when the next page loads: nothing is restored and the snapshot is deleted', async () => {
    await persistFeedOfA()
    window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(OWNER_B))
    await persistQueryClientRestore({ queryClient, ...persistOptions })
    expect(queryClient.getQueryData(qk.feed())).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
  })

  it('B arrives between restoreClient() and hydration: the hydration refuses A\'s data', async () => {
    await persistFeedOfA()
    const restoring = persistQueryClientRestore({ queryClient, ...persistOptions })
    window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(OWNER_B))
    await restoring.catch(() => undefined)
    expect(queryClient.getQueryData(qk.feed())).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
  })

  it("A's feed was hydrated, then the page's first auth event is B: cache and snapshot are wiped", async () => {
    await persistFeedOfA()
    await persistQueryClientRestore({ queryClient, ...persistOptions })
    expect(queryClient.getQueryData<FeedScreen>(qk.feed())?.upcoming[0]?.my_reservation_count).toBeNull() // A's own feed, stripped
    hooks.session = fixtureSession(OWNER_B)
    window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(OWNER_B))
    emit('INITIAL_SESSION')
    expect(queryClient.getQueryData(qk.feed())).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
  })

  it('switch A → B without a reload (loop guard): B\'s feed never reaches disk, A\'s snapshot is gone', async () => {
    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - 1_000))
    openAs(GUEST_A)
    queryClient.setQueryData(qk.feed(), feedOfA())
    await setOfflineFeedEnabled(true)
    hooks.session = fixtureSession(OWNER_B)
    window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(OWNER_B))
    emit('SIGNED_IN')
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()

    queryClient.setQueryData(qk.feed(), { upcoming: [], past: [] })
    void persister.persistClient({ timestamp: Date.now(), buster: persistOptions.buster ?? '', clientState: { queries: [], mutations: [] } })
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
  })
})

describe('L5 — the DEV log never carries server text', () => {
  it('a PostgREST error with private message/details/hint is logged as key + code (+ status) only', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const mapped = toAppError({ code: '23505', message: 'duplicate key: reservation of Mila for Schürze', details: 'Key (wish_id)=(f002) already exists', hint: 'reserved by Mila' })
    expect(mapped).toBeInstanceOf(AppError)
    const logged = JSON.stringify(debug.mock.calls)
    expect(logged).not.toMatch(/Mila|Schürze|f002|duplicate|reserved by/)
  })

  it('an auth error with a message is logged without it', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    toAppError({ __isAuthError: true, name: 'AuthApiError', message: 'User mila@example.test is banned', code: 'user_banned', status: 400 })
    // the code ('user_banned') is our safe enum value; the server's sentence and the address are not
    expect(JSON.stringify(debug.mock.calls)).not.toMatch(/mila@example\.test|is banned/)
  })
})
