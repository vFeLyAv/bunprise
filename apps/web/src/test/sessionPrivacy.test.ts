import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authEvents = vi.hoisted(() => ({ callback: null as ((event: AuthChangeEvent, session: Session | null) => void) | null }))
vi.mock('../lib/supabase', () => ({
  hasLocalSession: () => false,
  getSupabase: vi.fn(),
  onClientReady: (ready: (client: unknown) => void) => {
    ready({ auth: { onAuthStateChange: (callback: typeof authEvents.callback) => {
      authEvents.callback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    } } })
    return vi.fn()
  },
}))
vi.mock('../router', () => ({ router: { state: { location: { pathname: '/', href: '/' } }, navigate: vi.fn() } }))

import { AUTH_STORAGE_KEY, OFFLINE_FEED_KEY, QUERY_CACHE_KEY } from '../lib/app'
import { resetAccountBoundaryForTests } from '../lib/accountBoundary'
import { clearAccountDeviceState, clearPersistedCache, getQueryCacheOwnerId, persistOptions, persister, queryClient, setOfflineFeedEnabled, setSdkSessionIdentity } from '../lib/query'
import { watchSessionIdentity } from '../lib/session'

// A known account that ends reloads the page (lib/session.ts); jsdom cannot navigate.
const pageExit = vi.hoisted(() => ({ replace: vi.fn<(url: string) => void>() }))

beforeEach(async () => {
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
  authEvents.callback = null
  pageExit.replace.mockReset()
  vi.stubGlobal('location', { ...window.location, replace: pageExit.replace })
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setSdkSessionIdentity(undefined)
  resetAccountBoundaryForTests()
  await clearPersistedCache()
  queryClient.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('first auth event cache ownership', () => {
  it('keeps the opted-in feed when the first session matches its owner', async () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-a' } }))
    queryClient.setQueryData(['feed'], { upcoming: [], past: [] })
    await setOfflineFeedEnabled(true)
    queryClient.clear()
    await persistQueryClientRestore({ ...persistOptions, queryClient })
    const stop = watchSessionIdentity()
    authEvents.callback?.('INITIAL_SESSION', { user: { id: 'account-a' } } as Session)
    expect(queryClient.getQueryData(['feed'])).toBeDefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).not.toBeNull()
    stop()
  })

  it.each(['INITIAL_SESSION', 'SIGNED_IN'] as const)('clears hydrated A data if %s first reports account B', async (event) => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-a' } }))
    queryClient.setQueryData(['feed'], { upcoming: [{ title: 'A private event' }], past: [] })
    await setOfflineFeedEnabled(true)
    await persister.restoreClient()
    expect(getQueryCacheOwnerId()).toBe('account-a')
    const stop = watchSessionIdentity()
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-b' } }))
    authEvents.callback?.(event, { user: { id: 'account-b' } } as Session)
    await Promise.resolve()
    expect(queryClient.getQueryData(['feed'])).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
    stop()
  })

  it('clears hydrated data when the first session is missing', async () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-a' } }))
    queryClient.setQueryData(['feed'], { upcoming: [], past: [] })
    await setOfflineFeedEnabled(true)
    const stop = watchSessionIdentity()
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    authEvents.callback?.('INITIAL_SESSION', null)
    await Promise.resolve()
    expect(queryClient.getQueryData(['feed'])).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    stop()
  })

  it('cannot rehydrate A after an account switch between restore and hydration', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-a' } }))
    queryClient.setQueryData(['feed'], { upcoming: [{ title: 'A private event' }], past: [] })
    await setOfflineFeedEnabled(true)
    queryClient.clear()
    const stop = watchSessionIdentity()
    const restoring = persistQueryClientRestore({ ...persistOptions, queryClient })
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-b' } }))
    authEvents.callback?.('INITIAL_SESSION', { user: { id: 'account-b' } } as Session)
    await expect(restoring).rejects.toThrow('Offline feed account changed during restore')
    expect(queryClient.getQueryData(['feed'])).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    stop()
  })
})

describe('late account cleanup with unavailable auth storage', () => {
  function denyStorage() {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError')
    })
  }

  it('keeps replacement B when an earlier A operation completes after the SDK account changes', () => {
    const stop = watchSessionIdentity()
    try {
      authEvents.callback?.('INITIAL_SESSION', { user: { id: 'account-a' } } as Session)
      denyStorage()
      authEvents.callback?.('SIGNED_IN', { user: { id: 'account-b' } } as Session)
      queryClient.setQueryData(['me'], { id: 'account-b' })
      const clearing = vi.spyOn(queryClient, 'clear')

      expect(clearAccountDeviceState('account-a', null)).toBe(false)
      expect(clearing).not.toHaveBeenCalled()
      expect(queryClient.getQueryData(['me'])).toEqual({ id: 'account-b' })
    } finally { stop() }
  })

  it('clears the confirmed current A in memory even when localStorage is denied', () => {
    const stop = watchSessionIdentity()
    try {
      authEvents.callback?.('INITIAL_SESSION', { user: { id: 'account-a' } } as Session)
      queryClient.setQueryData(['me'], { id: 'account-a' })
      denyStorage()

      expect(clearAccountDeviceState('account-a', null)).toBe(true)
      expect(queryClient.getQueryData(['me'])).toBeUndefined()
    } finally { stop() }
  })

  it('fails closed without either a stored account or a first SDK identity observation', () => {
    const stop = watchSessionIdentity()
    try {
      queryClient.setQueryData(['me'], { id: 'account-b' })
      denyStorage()

      expect(clearAccountDeviceState('account-a', null)).toBe(false)
      expect(queryClient.getQueryData(['me'])).toEqual({ id: 'account-b' })
    } finally { stop() }
  })
})

describe('signed out elsewhere (SIGNED_OUT)', () => {
  // Codex review 2 (H2): the screen of a known account must not survive its sign-out — public screens
  // included (/i shows its name, /legal/* keeps its toasts and timers in memory): a full reload to /login.
  it.each([
    '/i',
    '/',
    '/legal/datenschutz',
    '/soon',
    '/occasions/3f2b9c1e-8a4d-4c2b-9e1f-0a1b2c3d4e5f',
  ])('a known account signed out on %s: the tab resets and reloads to /login', async (pathname) => {
    const { router } = await import('../router')
    const navigate = vi.mocked(router.navigate)
    navigate.mockClear()
    router.state.location.pathname = pathname
    router.state.location.href = pathname
    const stop = watchSessionIdentity()
    try {
      authEvents.callback?.('INITIAL_SESSION', { user: { id: 'account-a' } } as Session)
      authEvents.callback?.('SIGNED_OUT', null)
      expect(pageExit.replace).toHaveBeenCalledWith('/login')
      expect(navigate).not.toHaveBeenCalled()
    } finally { stop() }
  })

  it.each([
    ['/soon', true],
    ['/legal/datenschutz', false],
  ])('without a known account, SIGNED_OUT on %s keeps the in-app redirect to /login: %s', async (pathname, redirects) => {
    const { router } = await import('../router')
    const navigate = vi.mocked(router.navigate)
    navigate.mockClear()
    router.state.location.pathname = pathname
    router.state.location.href = pathname
    const stop = watchSessionIdentity()
    try {
      authEvents.callback?.('INITIAL_SESSION', null)
      authEvents.callback?.('SIGNED_OUT', null)
      expect(pageExit.replace).not.toHaveBeenCalled()
      if (redirects) expect(navigate).toHaveBeenCalledWith({ to: '/login', search: { next: pathname } })
      else expect(navigate).not.toHaveBeenCalled()
    } finally { stop() }
  })
})
