import type { Session } from '@supabase/supabase-js'
import { dehydrate, QueryClient, type Query } from '@tanstack/react-query'
import type { PersistedClient, Persister, PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { ACTIVE_STORAGE_PREFIX, APP_VERSION, AUTH_STORAGE_KEY, DEMO_MODE, KEEP_ON_SIGN_OUT, OFFLINE_FEED_KEY, QUERY_CACHE_KEY, storageKeys } from './app'
import type { FeedScreen } from './api/types'
import { getSupabase } from './supabase'
import { AppError } from './errors'
import { internalPath } from './navigation'
import { announceAccountCleared, endAccountEpoch, markPageLeaving } from './accountBoundary'
import { toast } from './toast'

// ---- defaults (performance-plan.md 3.1) ----------------------------------------------------

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // re-entering a screen within 30 s does not hit the server
      gcTime: 5 * 60_000, // 5 min in memory after leaving a screen (persisted keys override → 24 h)
      retry: 1, // one retry on mobile networks; more = a skeleton that hangs
      retryDelay: 800,
      refetchOnWindowFocus: true, // back in the app → quiet refresh (our "freshness" without realtime)
      refetchOnReconnect: true,
      networkMode: 'online', // offline = paused, not an error; cached data stays visible
      throwOnError: false,
    },
    mutations: {
      retry: 0, // reserve / RSVP are never retried automatically (double actions)
      networkMode: 'online',
    },
  },
})

// ---- explicit offline feed opt-in only (pilot-decisions v1.1 §0.16) ----------------------

/** 24 h on disk; older snapshots are dropped and loaded from the server. */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000

/** Profile, consents, reservations, occasion screens and pending mutations never go to disk. */
export const PERSISTED_ROOTS: ReadonlySet<string> = new Set(['feed'])
const CACHE_BUSTER = `${APP_VERSION}:privacy-v1.1`
let memoryOwnerId: string | null = null
// Independent of persistence: Supabase can keep its active session entirely in memory.
let latestSdkUserId: string | null | undefined
const restoredOwners = new WeakMap<object, string>()

interface OwnedSnapshot extends PersistedClient { ownerId: string }

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null // private mode / blocked storage: the app works without a persisted cache
  }
}

/** Read only the account identifier, never a network-dependent session refresh. */
export function localAccountId(): string | null {
  try {
    const raw = safeLocalStorage()?.getItem(AUTH_STORAGE_KEY)
    const session: unknown = raw ? JSON.parse(raw) : null
    if (typeof session !== 'object' || session === null || !('user' in session)) return null
    const user = session.user
    return typeof user === 'object' && user !== null && 'id' in user && typeof user.id === 'string' && user.id
      ? user.id : null
  } catch { return null }
}

export function isOfflineFeedEnabled(): boolean {
  const ownerId = localAccountId()
  try { return ownerId !== null && safeLocalStorage()?.getItem(OFFLINE_FEED_KEY) === ownerId } catch { return false }
}

/** The session watcher also checks its first auth event against already-hydrated data. */
export function getQueryCacheOwnerId(): string | null { return memoryOwnerId }

/** Written synchronously by the auth watcher; undefined means no current observation. */
export function setSdkSessionIdentity(userId: string | null | undefined): void { latestSdkUserId = userId }

function isFeedKey(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 1 && queryKey[0] === 'feed'
}

/** Strip reservation counts even when the person explicitly chooses an offline feed. */
function offlineFeed(data: unknown): FeedScreen | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const feed = data as FeedScreen
  if (!Array.isArray(feed.upcoming) || !Array.isArray(feed.past)) return undefined
  const strip = (items: FeedScreen['upcoming']) => items.map(({
    id, title, starts_at, tz, all_day, place_text, role, rsvp, host_name, member_count, wish_count,
  }) => ({
    id, title, starts_at, tz, all_day, place_text, role, rsvp, host_name, member_count, wish_count,
    my_reservation_count: null,
  }))
  return { upcoming: strip(feed.upcoming), past: strip(feed.past) }
}

function allowedSnapshot(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      mutations: [],
      queries: client.clientState.queries.flatMap((query) => {
        if (!isFeedKey(query.queryKey) || query.state.status !== 'success') return []
        const data = offlineFeed(query.state.data)
        return data ? [{ ...query, state: { ...query.state, data } }] : []
      }),
    },
  }
}

/** Synchronous guarded writes prevent a delayed save resurrecting data after opt-out/sign-out. */
export const persister: Persister = {
  persistClient(client) {
    try {
      const storage = safeLocalStorage()
      const ownerId = localAccountId()
      if (!ownerId || !isOfflineFeedEnabled() || (memoryOwnerId !== null && memoryOwnerId !== ownerId)) {
        storage?.removeItem(QUERY_CACHE_KEY)
        return
      }
      memoryOwnerId = ownerId
      const owned: OwnedSnapshot = { ...allowedSnapshot(client), ownerId }
      storage?.setItem(QUERY_CACHE_KEY, JSON.stringify(owned))
    } catch { /* private mode/storage quota: keep only the in-memory cache */ }
  },
  restoreClient() {
    const storage = safeLocalStorage()
    try {
      if (!isOfflineFeedEnabled()) {
        storage?.removeItem(QUERY_CACHE_KEY)
        return
      }
      const raw = storage?.getItem(QUERY_CACHE_KEY)
      if (!raw) return
      const client = JSON.parse(raw) as OwnedSnapshot
      if (!client.ownerId || client.ownerId !== localAccountId() || client.buster !== CACHE_BUSTER || !Number.isFinite(client.timestamp) ||
          client.timestamp > Date.now() || Date.now() - client.timestamp > PERSIST_MAX_AGE) {
        storage?.removeItem(QUERY_CACHE_KEY)
        return
      }
      const allowed = allowedSnapshot(client)
      storage?.setItem(QUERY_CACHE_KEY, JSON.stringify(allowed))
      for (const query of allowed.clientState.queries) {
        if (typeof query.state.data === 'object' && query.state.data !== null) {
          restoredOwners.set(query.state.data, client.ownerId)
        }
      }
      memoryOwnerId = client.ownerId
      return allowed
    } catch {
      try { storage?.removeItem(QUERY_CACHE_KEY) } catch { /* storage unavailable */ }
      return
    }
  },
  removeClient() {
    try { safeLocalStorage()?.removeItem(QUERY_CACHE_KEY) } catch { /* storage unavailable */ }
  },
}

/**
 * The allow-list. Occasion screens (reservation state), my reservations and everything else
 * stay in memory only — never on disk, never on a shared device after sign-out.
 */
export function shouldPersistQuery(query: Query): boolean {
  return isOfflineFeedEnabled() && query.state.status === 'success' && isFeedKey(query.queryKey)
}

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: PERSIST_MAX_AGE,
  buster: CACHE_BUSTER, // v1.1 also rejects older snapshots that stored profile/consent state
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery, shouldDehydrateMutation: () => false },
  hydrateOptions: {
    defaultOptions: {
      deserializeData(data: unknown) {
        // Auth may change between restoreClient() and TanStack's awaited hydration step.
        if (typeof data === 'object' && data !== null && isOfflineFeedEnabled() &&
            restoredOwners.get(data) === localAccountId()) return data
        throw new Error('Offline feed account changed during restore')
      },
    },
  },
}

/** Settings can opt in explicitly; disabling immediately deletes the personal snapshot. */
export async function setOfflineFeedEnabled(enabled: boolean): Promise<void> {
  try {
    const storage = safeLocalStorage()
    const ownerId = localAccountId()
    if (enabled && ownerId) storage?.setItem(OFFLINE_FEED_KEY, ownerId)
    else storage?.removeItem(OFFLINE_FEED_KEY)
  } catch { /* unavailable storage cannot enable persistence */ }
  if (enabled && isOfflineFeedEnabled()) {
    await persister.persistClient({
      timestamp: Date.now(), buster: CACHE_BUSTER,
      clientState: dehydrate(queryClient, persistOptions.dehydrateOptions),
    })
  } else {
    await persister.removeClient()
  }
}

/** Removes the persisted snapshot from disk (sign-out, account switch, account deletion). */
export async function clearPersistedCache(): Promise<void> {
  memoryOwnerId = null
  try {
    window.localStorage.removeItem(OFFLINE_FEED_KEY)
    window.localStorage.removeItem(QUERY_CACHE_KEY)
  } catch {
    /* storage unavailable */
  }
  try {
    await persister.removeClient()
  } catch {
    /* storage unavailable */
  }
}

/** Clear the active account namespace; demo cleanup never touches a real account or sb-* keys. */
export function clearLocalState(): void {
  memoryOwnerId = null
  try {
    for (const key of Object.keys(window.localStorage)) {
      const ours = key.startsWith(ACTIVE_STORAGE_PREFIX) && !KEEP_ON_SIGN_OUT.includes(key)
      if (ours || (!DEMO_MODE && key.startsWith('sb-'))) window.localStorage.removeItem(key)
    }
  } catch {
    /* storage unavailable */
  }
  clearSessionDrafts()
}

/**
 * Every session-scoped draft of this tab (sessionStorage keys of the active prefix — in the normal
 * build that includes the `bunprise.demo.` ones): e-mail attempt, login and consent drafts, pending
 * invite, OAuth target, "wish added" flag (docs/storage-registry.md).
 */
export function clearSessionDrafts(): void {
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(ACTIVE_STORAGE_PREFIX) && key !== storageKeys.telegram && key !== storageKeys.telegramScheme) window.sessionStorage.removeItem(key)
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * Synchronous final cleanup cannot wipe a replacement account while awaiting network/SDK locks.
 * After the cleanup the other tabs that still show this account are told to reset as well
 * (account boundary, H3), then this tab reloads.
 */
export function clearAccountDeviceState(expectedUserId: string, redirectTo: string | null = '/login'): boolean {
  const currentId = localAccountId()
  if (currentId !== null && currentId !== expectedUserId) return false
  if (latestSdkUserId !== undefined && latestSdkUserId !== null && latestSdkUserId !== expectedUserId) return false
  if (currentId === null && latestSdkUserId === undefined) return false
  endAccountEpoch() // late answers of this account change nothing any more
  queryClient.clear()
  toast.clear()
  clearLocalState()
  announceAccountCleared(expectedUserId)
  if (redirectTo !== null) {
    markPageLeaving()
    window.location.replace(internalPath(redirectTo) ?? '/login')
  }
  return true
}

/**
 * Sign out and leave nothing personal on the device (performance-plan.md 3.3):
 * memory cache → persisted cache → Supabase session → own storage keys → full reload.
 * `scope: 'global'` requests revocation on other devices; offline/server failures still clear locally.
 * That includes the case where the SDK cannot even hand out the session (round-2 review): the stored
 * access token has expired (JWT 15 min) and its refresh cannot reach the auth server (captive portal,
 * outage — navigator.onLine stays true). Then the expected account is cleared from the device with the
 * same owner-checked cleanup as the offline sign-out; server-side revocation is not possible then.
 * Pass `redirectTo: null` to skip the reload (tests); storage/query state is cleared,
 * but the SDK instance is not reinitialized until the caller reloads or recreates it.
 */
export async function signOutEverywhere(
  options: { scope?: 'global' | 'local' | 'others'; redirectTo?: string | null; expectedUserId?: string } = {},
): Promise<void> {
  const { scope = 'global', redirectTo = '/login' } = options
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let session: Session | null
  try {
    supabase = await getSupabase()
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    session = data.session
  } catch (err) {
    // No session from the SDK (unreachable auth server, client not loadable): nothing to send the
    // logout with. Without a known account there is nothing safe to clear; with one, the cleanup
    // keeps its own guards (never a replacement account, never an unknown owner).
    if (options.expectedUserId === undefined) throw err
    if (!clearAccountDeviceState(options.expectedUserId, redirectTo)) throw new AppError('session_expired')
    return
  }
  const userId = options.expectedUserId ?? session?.user.id
  if (!userId || session?.user.id !== userId) throw new AppError('session_expired')
  try {
    // This API sends the captured JWT and never removes a subsequently signed-in SDK session.
    await supabase.auth.admin.signOut(session.access_token, scope)
  } catch {
    /* offline or already signed out: the local cleanup below still happens */
  }
  if (!clearAccountDeviceState(userId, redirectTo)) throw new AppError('session_expired')
}
