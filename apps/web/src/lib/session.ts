import { ACTIVE_STORAGE_PREFIX, AUTH_STORAGE_KEY } from './app'
import {
  endAccountEpoch, finishAccountSwitch, isPageLeaving, markPageLeaving, onAccountCleared, renderedAccount,
  setRenderedAccount, startAccountSwitch,
} from './accountBoundary'
import { getSupabase, hasLocalSession, onClientReady } from './supabase'
import {
  clearPersistedCache, clearSessionDrafts, getQueryCacheOwnerId, localAccountId, queryClient, setSdkSessionIdentity,
} from './query'
import { toast } from './toast'
import { router } from '../router'

const PUBLIC_PREFIXES = ['/login', '/auth/', '/i/', '/legal/']
/**
 * Public screens matched exactly: the start page, the invite landing (/i#<token>) and the follow link (/f#<code>) —
 * both handle a lost session themselves and keep their code in the fragment (add-friends-design §1.2).
 */
const PUBLIC_PATHS = ['/', '/i', '/f']

/** sessionStorage: when this tab last reloaded because its account ended (reload-loop guard). */
export const ACCOUNT_RELOAD_KEY = `${ACTIVE_STORAGE_PREFIX}accountReload`
/** A second account change this soon after such a reload switches screens without reloading again. */
export const ACCOUNT_RELOAD_GUARD_MS = 5_000

/** Time of this tab's last account reload when it is recent enough to count, else null. */
function recentAccountReload(): number | null {
  try {
    const at = Number(window.sessionStorage.getItem(ACCOUNT_RELOAD_KEY))
    const age = Date.now() - at
    return at > 0 && age >= 0 && age < ACCOUNT_RELOAD_GUARD_MS ? at : null
  } catch {
    return null
  }
}

function rememberReload(at: number): void {
  try {
    window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(at))
  } catch {
    /* storage unavailable: no loop guard, the reload still happens */
  }
}

/** Full reload to `to`: hidden and inert from now on, and recorded for the reload-loop guard. */
function reloadTo(to: string): void {
  if (isPageLeaving()) return // already on its way
  rememberReload(Date.now())
  markPageLeaving()
  window.location.replace(to)
}

/** The in-app switch in progress (reload-loop guard): its number and its fallback reload. */
let switchId = 0
let switchFallback: ReturnType<typeof setTimeout> | undefined

/**
 * Reload-loop guard path: move to the next account inside the page (round-1 review, H2 residual).
 * The page is hidden and inert AT ONCE and AccountSwitchGate stops rendering the routed screens, so
 * nothing of the previous account can be seen or used while the next account's guard
 * (getLocalSession + a fresh get_me) runs. navigate() resolves only after the router has rendered the
 * next account's screen; then the page shows again. If that does not happen within
 * ACCOUNT_RELOAD_GUARD_MS (a hanging get_me, a failed navigation), the tab reloads after all — by then
 * the guard window is over, so it is still at most one reload per ACCOUNT_RELOAD_GUARD_MS.
 */
function switchInApp(to: '/soon' | '/login', next: string | null): void {
  const id = ++switchId
  clearTimeout(switchFallback)
  setRenderedAccount(next)
  startAccountSwitch()
  switchFallback = setTimeout(() => {
    if (id === switchId) reloadTo(to)
  }, ACCOUNT_RELOAD_GUARD_MS)
  const shown = () => {
    if (id !== switchId) return // a newer switch (or the end of the watcher) owns the page now
    clearTimeout(switchFallback)
    finishAccountSwitch()
  }
  let navigation: Promise<void>
  try {
    navigation = Promise.resolve(router.navigate({ to, replace: true }))
  } catch (err) {
    navigation = Promise.reject(err)
  }
  // a navigation that failed may have left the previous screen in place: stay hidden, the fallback reloads
  void navigation.then(shown, () => undefined)
}

/** Stops a switch in progress (the watcher ends): no late `shown`, no fallback reload. */
function abandonSwitch(): void {
  switchId += 1
  clearTimeout(switchFallback)
}

/**
 * The account this tab shows ended: another account signed in (`next`) or it signed out (`null`),
 * here or in another tab. Nothing of the old account may survive — no React state, portal, toast,
 * timer, draft or late answer (Codex review 2, H1–H3):
 * epoch +1 → memory and persisted caches → toasts → this tab's session drafts (the pending invite
 * included) → full reload to /soon or /login, which builds every screen and module again.
 */
function endShownAccount(ended: string, next: string | null): void {
  if (isPageLeaving()) return // the reload is already on its way
  endAccountEpoch()
  void queryClient.cancelQueries()
  queryClient.clear()
  void clearPersistedCache()
  toast.clear()
  const lastReload = recentAccountReload()
  clearSessionDrafts()
  // Signed out: a session of the ended account written back meanwhile (a late token refresh in some
  // tab) must not come back after the reload. Never touches a replacement account.
  if (next === null && localAccountId() === ended) {
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
    } catch {
      /* storage unavailable */
    }
  }
  const to = next === null ? '/login' : '/soon'
  if (lastReload !== null) {
    // Reloaded for an account change a moment ago and it changed again: at most one reload per
    // ACCOUNT_RELOAD_GUARD_MS, no loop. The caches are gone already; the page stays hidden until the
    // next account's screen has rendered (switchInApp).
    rememberReload(lastReload)
    switchInApp(to, next)
    return
  }
  reloadTo(to)
}

/**
 * Keeps caches and screens tied to ONE account (brief 7.5a, Codex review 2): when the signed-in user
 * changes or the session ends, memory and persisted query caches are wiped before anything else renders.
 * A KNOWN signed-in account that ends (A → B, A → signed out) additionally resets the whole tab (see
 * endShownAccount). Not a reset: the first event (INITIAL_SESSION), the first sign-in of a signed-out
 * tab (signed out → A keeps its pending invite) and token refreshes of the same account.
 * Other tabs: the 'bunprise.session' channel (sign-out / deletion there) and the storage event of the
 * auth key (removed or replaced there) reset a tab that still shows that account; a page shown again
 * (back/forward cache, visible again) compares the stored session with the shown account.
 * Call once at boot. Attaches to Supabase as soon as the client exists (immediately for returning
 * users, after the first sign-in call for new ones) — anonymous visitors never load the client.
 * The callback never awaits Supabase calls (auth-js would deadlock).
 */
export function watchSessionIdentity(): () => void {
  setSdkSessionIdentity(undefined)
  setRenderedAccount(undefined)
  let knownUserId: string | null | undefined
  let unsubscribe: (() => void) | null = null
  // The account whose session this tab has seen in localStorage. An SDK that keeps its session in
  // memory (storage blocked or not writable) never puts it there: then a missing stored session
  // proves nothing, and the page-shown re-check below leaves the tab alone.
  let storedSeen: string | null = null
  const noteStored = (userId: string | null) => {
    if (userId !== null && localAccountId() === userId) storedSeen = userId
  }

  /** One way for every source (SDK event, channel, storage event, page shown) to report the tab's account. */
  function accountChanged(next: string | null): boolean {
    noteStored(next)
    const ended = knownUserId
    knownUserId = next
    void queryClient.cancelQueries()
    queryClient.clear()
    void clearPersistedCache()
    if (typeof ended === 'string') {
      endShownAccount(ended, next)
      return true
    }
    setRenderedAccount(next) // signed out → A: the first sign-in of this tab, no reload
    return false
  }

  const stopWaiting = onClientReady((supabase) => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null
      setSdkSessionIdentity(userId)
      noteStored(userId) // the SDK stores a session before it reports it
      if (knownUserId === undefined) {
        knownUserId = userId // INITIAL_SESSION
        setRenderedAccount(userId)
        const cachedOwnerId = getQueryCacheOwnerId()
        if (cachedOwnerId !== null && cachedOwnerId !== userId) {
          void queryClient.cancelQueries()
          queryClient.clear()
          void clearPersistedCache()
        }
        return
      }
      if (userId !== knownUserId && accountChanged(userId)) return
      if (event === 'SIGNED_OUT') {
        const { pathname, href } = router.state.location
        if (!PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) && !PUBLIC_PATHS.includes(pathname)) {
          // never a fragment inside `next`: a query reaches the server on a reload (Codex review 27.10)
          void router.navigate({ to: '/login', search: { next: href.split('#', 1)[0] } })
        }
      } else if (event === 'SIGNED_IN') {
        void queryClient.invalidateQueries() // e.g. signed in from another tab
      }
    })
    unsubscribe = () => data.subscription.unsubscribe()
  })

  // Another tab signed this account out or deleted it (lib/query.ts clearAccountDeviceState). A tab
  // that already shows another account ignores it: A's sign-out never clears B.
  const stopChannel = onAccountCleared((userId) => {
    if (renderedAccount() === userId) accountChanged(null)
  })

  // Another tab removed or replaced the stored session (also the fallback without BroadcastChannel).
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== AUTH_STORAGE_KEY) return
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return
    } catch {
      return
    }
    const shown = renderedAccount()
    if (typeof shown !== 'string') return // nothing of an account on screen
    const stored = localAccountId()
    if (stored !== shown) accountChanged(stored) // a token refresh of the same account changes nothing
  }
  window.addEventListener('storage', onStorage)

  // The page is shown again: restored from the back/forward cache (pageshow, persisted) or visible
  // again. A cached page never received the storage events and channel messages of that time, and
  // auth-js stays silent when the stored session is gone (_recoverAndRefresh returns without an event
  // for a null session). So compare the stored session with the account on screen, like onStorage.
  const onPageShown = (event: Event) => {
    if (event.type === 'pageshow' ? (event as PageTransitionEvent).persisted !== true : document.visibilityState !== 'visible') return
    if (isPageLeaving()) return
    const shown = renderedAccount()
    if (typeof shown !== 'string') return // nothing of an account on screen
    const stored = localAccountId()
    if (stored === shown) return
    if (stored === null && storedSeen !== shown) return // an in-memory SDK session: nothing to compare
    accountChanged(stored)
  }
  window.addEventListener('pageshow', onPageShown)
  document.addEventListener('visibilitychange', onPageShown)

  // returning user: start loading the client right away (parallel with the first route chunk)
  if (hasLocalSession()) void getSupabase()

  return () => {
    stopWaiting()
    unsubscribe?.()
    stopChannel()
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pageshow', onPageShown)
    document.removeEventListener('visibilitychange', onPageShown)
    abandonSwitch()
    setSdkSessionIdentity(undefined)
    setRenderedAccount(undefined)
  }
}
