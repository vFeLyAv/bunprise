import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The account boundary of a tab (Codex review 2, H1–H3; lib/session.ts + lib/accountBoundary.ts):
// (a) a known account that ends in the same tab resets everything and reloads the page,
// (c) other tabs: the 'bunprise.session' channel and the storage event of the auth key,
// and sign-out / deletion announce the cleared account before their own reload.
// Invented fixture accounts only. jsdom cannot navigate: location.replace is a mock; BroadcastChannel is
// a fake that delivers to the other instances of the same name, like separate tabs.

const sdk = vi.hoisted(() => ({
  callback: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
  session: null as Session | null,
  logout: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../lib/supabase', () => {
  const client = {
    auth: {
      onAuthStateChange: (callback: typeof sdk.callback) => {
        sdk.callback = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      getSession: () => Promise.resolve({ data: { session: sdk.session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: sdk.session?.user ?? null }, error: null }),
      admin: { signOut: sdk.logout },
    },
    rpc: sdk.rpc,
  }
  return {
    hasLocalSession: () => false,
    getSupabase: () => Promise.resolve(client),
    onClientReady: (ready: (client: unknown) => void) => {
      ready(client)
      return vi.fn()
    },
  }
})
vi.mock('../router', () => ({ router: { state: { location: { pathname: '/soon', href: '/soon' } }, navigate: vi.fn() } }))

class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>()
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.add(this)
  }
  postMessage(data: unknown): void {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError')
    for (const other of FakeBroadcastChannel.channels) {
      // like the real one: every OTHER open channel of that name, asynchronously
      if (other !== this && other.name === this.name) {
        const event = new MessageEvent('message', { data: structuredClone(data) })
        queueMicrotask(() => {
          if (!other.closed) other.onmessage?.(event)
        })
      }
    }
  }
  close(): void {
    this.closed = true
    FakeBroadcastChannel.channels.delete(this)
  }
}

import { ACTIVE_STORAGE_PREFIX, AUTH_STORAGE_KEY, OFFLINE_FEED_KEY, QUERY_CACHE_KEY } from '../lib/app'
import {
  SESSION_CHANNEL, captureEpoch, isAccountGateClosed, isAccountSwitching, onAccountEnded, resetAccountBoundaryForTests, subscribeAccountSwitch,
} from '../lib/accountBoundary'
import { deleteMyAccount } from '../lib/api/account'
import { clearPersistedCache, queryClient, setOfflineFeedEnabled, setSdkSessionIdentity, signOutEverywhere } from '../lib/query'
import { ACCOUNT_RELOAD_GUARD_MS, ACCOUNT_RELOAD_KEY, watchSessionIdentity } from '../lib/session'
import { getToasts, toast } from '../lib/toast'
import { router } from '../router'

const A = 'account-a'
const B = 'account-b'
const replace = vi.fn<(url: string) => void>()
const navigate = vi.mocked(router.navigate)

/** Every session-scoped draft of the registry (docs/storage-registry.md), the demo prefix included. */
const DRAFT_KEYS = [
  ...['emailCode', 'loginDraft', 'pendingConsent', 'pendingInvite', 'wishAdded', 'postLoginNext'].map((key) => `${ACTIVE_STORAGE_PREFIX}${key}`),
  `${ACTIVE_STORAGE_PREFIX}demo.emailCode`,
]
const PENDING_INVITE = `${ACTIVE_STORAGE_PREFIX}pendingInvite`

function session(userId: string): Session {
  return { access_token: `token-${userId}`, user: { id: userId } } as Session
}

/** The SDK reports an auth event (and, like the SDK, stores the session first). */
function sdkEvent(event: AuthChangeEvent, userId: string | null) {
  sdk.session = userId ? session(userId) : null
  if (userId) window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: userId } }))
  else window.localStorage.removeItem(AUTH_STORAGE_KEY)
  sdk.callback?.(event, sdk.session)
}

function writeDrafts() {
  for (const key of DRAFT_KEYS) window.sessionStorage.setItem(key, 'fixture')
  window.sessionStorage.setItem('other-app.key', 'not ours')
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let stop: (() => void) | null = null

beforeEach(async () => {
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('location', { ...window.location, replace })
  replace.mockReset()
  navigate.mockReset()
  sdk.logout.mockReset().mockResolvedValue({ error: null })
  sdk.rpc.mockReset()
  sdk.callback = null
  sdk.session = null
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(async () => {
  stop?.()
  stop = null
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
  for (const channel of FakeBroadcastChannel.channels) channel.close() // deleting while iterating a Set is safe
  vi.unstubAllGlobals()
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('account boundary — the same tab (a)', () => {
  it('A → B: epoch ends, queries and persisted cache cleared, toasts dismissed, drafts removed, reload to /soon', async () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: A } }))
    queryClient.setQueryData(['feed'], { upcoming: [], past: [] })
    await setOfflineFeedEnabled(true)
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).not.toBeNull()
    writeDrafts()
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()
    expect(started.userId).toBe(A)
    queryClient.setQueryData(['occasion', 'fixture'], { private: 'A' })
    toast.error('A: reserve.conflict')

    sdkEvent('SIGNED_IN', B)

    expect(started.isCurrent()).toBe(false)
    expect(captureEpoch().isCurrent()).toBe(false) // nothing new starts while the page is replaced
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
    expect(getToasts()).toEqual([])
    for (const key of DRAFT_KEYS) expect(window.sessionStorage.getItem(key)).toBeNull()
    expect(window.sessionStorage.getItem('other-app.key')).toBe('not ours')
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain(B) // B's own session stays
    expect(replace.mock.calls).toEqual([['/soon']])
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(document.body.hasAttribute('inert')).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('A → signed out: the same reset, then a reload to /login', () => {
    writeDrafts()
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()
    toast.info('A: wish.deleted')
    queryClient.setQueryData(['myReservations'], [{ private: 'A' }])

    sdkEvent('SIGNED_OUT', null)

    expect(started.isCurrent()).toBe(false)
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(getToasts()).toEqual([])
    for (const key of DRAFT_KEYS) expect(window.sessionStorage.getItem(key)).toBeNull()
    expect(replace.mock.calls).toEqual([['/login']])
    expect(navigate).not.toHaveBeenCalled()
  })

  it('signed out → A (the first sign-in of the tab): no reload, and the pending invite stays', () => {
    window.sessionStorage.setItem(PENDING_INVITE, 'ab'.repeat(32))
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', null)
    const started = captureEpoch()
    expect(started.userId).toBeUndefined()

    sdkEvent('SIGNED_IN', A)

    expect(replace).not.toHaveBeenCalled()
    expect(started.isCurrent()).toBe(true) // the login flow's own callbacks continue
    expect(captureEpoch().userId).toBe(A)
    expect(window.sessionStorage.getItem(PENDING_INVITE)).toBe('ab'.repeat(32))
    expect(document.documentElement.style.visibility).toBe('')
  })

  it('TOKEN_REFRESHED of the same account changes nothing', () => {
    writeDrafts()
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()
    queryClient.setQueryData(['feed'], { upcoming: [], past: [] })
    toast.success('still A')

    sdkEvent('TOKEN_REFRESHED', A)

    expect(started.isCurrent()).toBe(true)
    expect(queryClient.getQueryData(['feed'])).toEqual({ upcoming: [], past: [] })
    expect(getToasts()).toHaveLength(1)
    for (const key of DRAFT_KEYS) expect(window.sessionStorage.getItem(key)).toBe('fixture')
    expect(replace).not.toHaveBeenCalled()
  })

  it('the first event of a page (INITIAL_SESSION) is never a reset', () => {
    writeDrafts()
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', B)
    expect(replace).not.toHaveBeenCalled()
    for (const key of DRAFT_KEYS) expect(window.sessionStorage.getItem(key)).toBe('fixture')
  })

  it('no reload loop: another change right after an account reload switches in-app, a later one reloads again', () => {
    const reloadedAt = Date.now() - 1_000
    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(reloadedAt))
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()

    sdkEvent('SIGNED_IN', B)

    expect(replace).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ to: '/soon', replace: true })
    expect(started.isCurrent()).toBe(false)
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(window.sessionStorage.getItem(ACCOUNT_RELOAD_KEY)).toBe(String(reloadedAt)) // the guard keeps its time
    expect(captureEpoch()).toMatchObject({ userId: B })
    expect(captureEpoch().isCurrent()).toBe(true) // the page stays: B works on

    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - ACCOUNT_RELOAD_GUARD_MS - 1))
    sdkEvent('SIGNED_OUT', null)
    expect(replace.mock.calls).toEqual([['/login']])
  })
})

describe('account boundary — other tabs (c)', () => {
  function otherTab(): FakeBroadcastChannel {
    return new FakeBroadcastChannel(SESSION_CHANNEL)
  }

  it("'account-cleared' for the account on screen: reset and reload to /login", async () => {
    writeDrafts()
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()
    queryClient.setQueryData(['occasion', 'fixture'], { private: 'A' })
    toast.info('A')

    otherTab().postMessage({ type: 'account-cleared', userId: A })
    await flush()

    expect(started.isCurrent()).toBe(false)
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(getToasts()).toEqual([])
    for (const key of DRAFT_KEYS) expect(window.sessionStorage.getItem(key)).toBeNull()
    expect(replace.mock.calls).toEqual([['/login']])
  })

  it("'account-cleared' for another account is ignored: A's sign-out never clears B", async () => {
    writeDrafts()
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', B)
    const started = captureEpoch()
    queryClient.setQueryData(['feed'], { upcoming: [], past: [] })

    otherTab().postMessage({ type: 'account-cleared', userId: A })
    otherTab().postMessage({ type: 'something-else', userId: B })
    await flush()

    expect(started.isCurrent()).toBe(true)
    expect(queryClient.getQueryData(['feed'])).toBeDefined()
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain(B)
    for (const key of DRAFT_KEYS) expect(window.sessionStorage.getItem(key)).toBe('fixture')
    expect(replace).not.toHaveBeenCalled()
  })

  it('a tab that shows nothing of an account (signed out, client not loaded) ignores it', async () => {
    stop = watchSessionIdentity()
    otherTab().postMessage({ type: 'account-cleared', userId: A })
    await flush()
    expect(replace).not.toHaveBeenCalled()
  })

  it('storage event: the auth key removed by another tab (manual sign-out path, also without BroadcastChannel)', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()
    window.localStorage.removeItem(AUTH_STORAGE_KEY) // done by the other tab
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue: '{}', newValue: null, storageArea: window.localStorage }))
    expect(started.isCurrent()).toBe(false)
    expect(replace.mock.calls).toEqual([['/login']])
  })

  it('storage event: the auth key replaced with another account → reset to /soon; the same account refreshed → nothing', () => {
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()
    const refreshed = JSON.stringify({ user: { id: A }, access_token: 'newer' })
    window.localStorage.setItem(AUTH_STORAGE_KEY, refreshed)
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: refreshed, storageArea: window.localStorage }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'bunprise.lang', newValue: 'en', storageArea: window.localStorage }))
    expect(started.isCurrent()).toBe(true)
    expect(replace).not.toHaveBeenCalled()

    const other = JSON.stringify({ user: { id: B } })
    window.localStorage.setItem(AUTH_STORAGE_KEY, other)
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: other, storageArea: window.localStorage }))
    expect(started.isCurrent()).toBe(false)
    expect(replace.mock.calls).toEqual([['/soon']])
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBe(other) // never removes the replacement
  })

  it('signOutEverywhere announces the cleared account to the other tabs before its own reload', async () => {
    const received: unknown[] = []
    otherTab().onmessage = (event) => { received.push(event.data) }
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const order: string[] = []
    // synchronous delivery here, to see the order of "announce" and "reload"
    vi.spyOn(FakeBroadcastChannel.prototype, 'postMessage').mockImplementation(function (this: FakeBroadcastChannel, data: unknown) {
      order.push('announce')
      for (const other of FakeBroadcastChannel.channels) {
        if (other !== this && other.name === this.name) other.onmessage?.(new MessageEvent('message', { data }))
      }
    })
    replace.mockImplementation(() => { order.push('reload') })

    await signOutEverywhere({ expectedUserId: A })

    expect(sdk.logout).toHaveBeenCalledWith(`token-${A}`, 'global')
    expect(received).toEqual([{ type: 'account-cleared', userId: A }])
    expect(order).toEqual(['announce', 'reload'])
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })

  it('deleteMyAccount announces the deleted account to the other tabs, too', async () => {
    const received: unknown[] = []
    otherTab().onmessage = (event) => { received.push(event.data) }
    sdk.rpc.mockImplementation(() => ({ setHeader: () => Promise.resolve({ data: { ok: true }, error: null }) }))
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)

    await deleteMyAccount({ expectedUserId: A })
    await flush()

    expect(received).toEqual([{ type: 'account-cleared', userId: A }])
    expect(replace.mock.calls).toEqual([['/']])
  })

  it('no announcement when the cleanup is refused (a replacement account B is active)', async () => {
    const received: unknown[] = []
    otherTab().onmessage = (event) => { received.push(event.data) }
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    sdk.logout.mockImplementationOnce(async () => {
      sdk.session = session(B)
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: B } }))
      setSdkSessionIdentity(B)
      return { error: null }
    })
    await expect(signOutEverywhere({ expectedUserId: A, redirectTo: null })).rejects.toMatchObject({ code: 'session_expired' })
    await flush()
    expect(received).toEqual([])
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain(B)
  })
})

describe('account boundary — the in-app switch of the reload-loop guard (adversarial round 1)', () => {
  /** This tab reloaded for an account change 1 s ago, shows A, and B signs in: the guard path. */
  function switchToBWithinGuard() {
    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - 1_000))
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    sdkEvent('SIGNED_IN', B)
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hidden and inert at once; shown again only once the navigation has rendered the next screen', async () => {
    let rendered!: () => void
    navigate.mockReturnValue(new Promise<void>((resolve) => { rendered = resolve }))

    switchToBWithinGuard()

    expect(replace).not.toHaveBeenCalled()
    expect(isAccountSwitching()).toBe(true)
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(document.body.hasAttribute('inert')).toBe(true)
    await flush()
    expect(document.documentElement.style.visibility).toBe('hidden') // B's guard still runs

    rendered()
    await flush()

    expect(isAccountSwitching()).toBe(false)
    expect(document.documentElement.style.visibility).toBe('')
    expect(document.body.hasAttribute('inert')).toBe(false)
    expect(captureEpoch()).toMatchObject({ userId: B })
    expect(replace).not.toHaveBeenCalled()
  })

  it('a navigation that has not rendered within the guard window reloads after all — once, and recorded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    navigate.mockReturnValue(new Promise<void>(() => {})) // B's get_me hangs

    switchToBWithinGuard()
    await vi.advanceTimersByTimeAsync(ACCOUNT_RELOAD_GUARD_MS - 1)
    expect(replace).not.toHaveBeenCalled()
    expect(document.documentElement.style.visibility).toBe('hidden')

    await vi.advanceTimersByTimeAsync(1)

    expect(replace.mock.calls).toEqual([['/soon']])
    expect(window.sessionStorage.getItem(ACCOUNT_RELOAD_KEY)).toBe(String(Date.now())) // the next guard window starts now
    expect(captureEpoch().isCurrent()).toBe(false) // the page is being replaced
    expect(document.documentElement.style.visibility).toBe('hidden')
  })

  it('a failed navigation keeps the page hidden (the previous screen may still be mounted) until the fallback reload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    navigate.mockReturnValue(Promise.reject(new Error('navigation failed')))

    switchToBWithinGuard()
    await vi.advanceTimersByTimeAsync(0)
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(replace).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(ACCOUNT_RELOAD_GUARD_MS)
    expect(replace.mock.calls).toEqual([['/soon']])
  })

  it('a navigation that rendered in time cancels the fallback reload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    navigate.mockResolvedValue(undefined)

    switchToBWithinGuard()
    await vi.advanceTimersByTimeAsync(3 * ACCOUNT_RELOAD_GUARD_MS)

    expect(replace).not.toHaveBeenCalled()
    expect(document.documentElement.style.visibility).toBe('')
  })

  it('a reload decided during the switch wins: the page stays hidden, the gate closed, and nothing reloads twice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let rendered!: () => void
    navigate.mockReturnValue(new Promise<void>((resolve) => { rendered = resolve }))
    switchToBWithinGuard()
    await vi.advanceTimersByTimeAsync(ACCOUNT_RELOAD_GUARD_MS - 500) // the guard window (from the last reload) is over now

    sdkEvent('SIGNED_OUT', null) // → a normal reset with a full reload
    expect(replace.mock.calls).toEqual([['/login']])
    rendered() // B's navigation finishes after all
    await vi.advanceTimersByTimeAsync(ACCOUNT_RELOAD_GUARD_MS) // and the switch's fallback time passes

    expect(isAccountSwitching()).toBe(true) // no routed screen is built again for a page that goes
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(replace.mock.calls).toEqual([['/login']])
  })

  it('a second change during the switch (B → signed out): the newest navigation decides when the page shows', async () => {
    const pending: Array<() => void> = []
    navigate.mockImplementation(() => new Promise<void>((resolve) => { pending.push(resolve) }))

    switchToBWithinGuard()
    sdkEvent('SIGNED_OUT', null) // still within the guard window: in-app again, to /login

    expect(navigate.mock.calls).toEqual([[{ to: '/soon', replace: true }], [{ to: '/login', replace: true }]])
    pending[0]?.() // the superseded navigation to /soon settles first
    await flush()
    expect(document.documentElement.style.visibility).toBe('hidden')

    pending[1]?.()
    await flush()
    expect(document.documentElement.style.visibility).toBe('')
    expect(captureEpoch().userId).toBeUndefined() // signed out: no account on screen
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('account boundary — a page shown again re-checks the stored session (bfcache, adversarial round 1)', () => {
  function shownAgain({ persisted = true, visibility = 'visible' as DocumentVisibilityState } = {}) {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility)
    const pageshow = new Event('pageshow')
    Object.defineProperty(pageshow, 'persisted', { value: persisted })
    window.dispatchEvent(pageshow)
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('visible again after another tab signed A out while no event reached this page: reset to /login', () => {
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    const started = captureEpoch()
    window.localStorage.removeItem(AUTH_STORAGE_KEY) // done by the other tab; no storage event arrived here

    shownAgain({ persisted: false }) // a frozen / background page: only visibilitychange

    expect(started.isCurrent()).toBe(false)
    expect(replace.mock.calls).toEqual([['/login']])
  })

  it('a normal page load (pageshow, not persisted) or a page that is still hidden changes nothing', () => {
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    window.localStorage.removeItem(AUTH_STORAGE_KEY)

    shownAgain({ persisted: false, visibility: 'hidden' })

    expect(replace).not.toHaveBeenCalled()
    expect(captureEpoch().isCurrent()).toBe(true)
  })

  it('the same account (token refreshed in another tab) changes nothing', () => {
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: A }, access_token: 'newer' }))

    shownAgain()

    expect(replace).not.toHaveBeenCalled()
    expect(captureEpoch()).toMatchObject({ userId: A })
  })

  it('an SDK session kept in memory only (blocked or read-only storage) is never taken for a sign-out', () => {
    stop = watchSessionIdentity()
    sdk.session = session(A)
    sdk.callback?.('INITIAL_SESSION', sdk.session) // nothing in localStorage: auth-js fell back to memory
    const started = captureEpoch()

    shownAgain()

    expect(replace).not.toHaveBeenCalled()
    expect(started.isCurrent()).toBe(true)
    expect(captureEpoch()).toMatchObject({ userId: A })
  })
})

describe('account boundary — module memory and the gate while the page leaves (adversarial round 2)', () => {
  it('a known account that ends tells the registered modules; a failing one never stops the reset', () => {
    const forgotten: string[] = []
    const stopBroken = onAccountEnded(() => {
      throw new Error('broken module cleanup')
    })
    const stopSaving = onAccountEnded(() => {
      forgotten.push('saving')
    })
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    expect(forgotten).toEqual([]) // the first event of a page is no account end

    sdkEvent('SIGNED_IN', B)

    expect(forgotten).toEqual(['saving'])
    expect(replace.mock.calls).toEqual([['/soon']]) // the reset went through
    stopBroken()
    stopSaving()
  })

  it('signed out → A (the first sign-in of the tab) is no account end: module memory stays', () => {
    const forgotten = vi.fn()
    const unsubscribe = onAccountEnded(forgotten)
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', null)

    sdkEvent('SIGNED_IN', A)

    expect(forgotten).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('the reload path closes AccountSwitchGate at once (no screen of A stays mounted until the unload)', () => {
    const notified = vi.fn()
    const unsubscribe = subscribeAccountSwitch(notified)
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', A)
    expect(isAccountGateClosed()).toBe(false)

    sdkEvent('SIGNED_IN', B)

    expect(replace.mock.calls).toEqual([['/soon']])
    expect(isAccountSwitching()).toBe(false) // no in-app switch: the page is leaving
    expect(isAccountGateClosed()).toBe(true)
    expect(notified).toHaveBeenCalled()
    unsubscribe()
  })
})
