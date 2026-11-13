import { dehydrate, QueryClient } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_STORAGE_KEY, OFFLINE_FEED_KEY, QUERY_CACHE_KEY } from '../lib/app'
import { clearPersistedCache, isOfflineFeedEnabled, persistOptions, persister, PERSIST_MAX_AGE, queryClient, setOfflineFeedEnabled } from '../lib/query'

const feed = { upcoming: [{ id: 'occasion-1', title: 'Birthday', my_reservation_count: 3 }], past: [] }

function snapshot(client: QueryClient = queryClient): PersistedClient & { ownerId: string } {
  return { timestamp: Date.now(), buster: persistOptions.buster ?? '', ownerId: 'account-a', clientState: dehydrate(client) }
}

beforeEach(async () => {
  await clearPersistedCache()
  window.localStorage.clear()
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-a' } }))
  queryClient.clear()
})
afterEach(async () => {
  await clearPersistedCache()
  window.localStorage.clear()
  queryClient.clear()
  vi.unstubAllEnvs()
})

describe('offline feed privacy', () => {
  it('defaults off and removes legacy snapshots without an explicit preference', async () => {
    queryClient.setQueryData(['feed'], feed)
    expect(isOfflineFeedEnabled()).toBe(false)
    await persister.persistClient(snapshot())
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    window.localStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(snapshot()))
    expect(await persister.restoreClient()).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
  })

  it('writes only the exact feed key after opt-in, with no reservation counts or mutations', async () => {
    queryClient.setQueryData(['feed'], feed)
    queryClient.setQueryData(['feed', 'other-user'], feed)
    queryClient.setQueryData(['me'], { consents_ok: true, profile: { display_name: 'Private' } })
    queryClient.setQueryData(['occasion', 'occasion-1'], { secret: 'wishlist' })
    queryClient.setQueryData(['myReservations'], [{ secret: 'reservation' }])
    await setOfflineFeedEnabled(true)
    const saved = JSON.parse(window.localStorage.getItem(QUERY_CACHE_KEY) ?? '{}') as PersistedClient
    expect(saved.clientState.queries.map((query) => query.queryKey)).toEqual([['feed']])
    expect(saved.clientState.queries[0]?.state.data).toEqual({ upcoming: [{ ...feed.upcoming[0], my_reservation_count: null }], past: [] })
    expect(saved.clientState.mutations).toEqual([])
    expect(queryClient.getQueryData(['feed'])).toEqual(feed)
  })

  it('filters old unexpected queries and mutation payloads on restore as well as save', async () => {
    await setOfflineFeedEnabled(true)
    queryClient.setQueryData(['feed'], feed)
    queryClient.setQueryData(['me'], { consents_ok: true })
    const saved = snapshot()
    saved.clientState.mutations.push({ state: { variables: { secret: 'reservation' } } } as unknown as typeof saved.clientState.mutations[number])
    window.localStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(saved))
    const restored = await persister.restoreClient()
    expect(restored?.clientState.queries.map((query) => query.queryKey)).toEqual([['feed']])
    expect(restored?.clientState.mutations).toEqual([])
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).not.toContain('consents_ok')
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).not.toContain('secret')
  })

  it('deletes immediately on opt-out and does not restore data through later writes', async () => {
    queryClient.setQueryData(['feed'], feed)
    await setOfflineFeedEnabled(true)
    const saved = snapshot()
    await setOfflineFeedEnabled(false)
    expect(isOfflineFeedEnabled()).toBe(false)
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    await persister.persistClient(saved)
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    await setOfflineFeedEnabled(true)
    await clearPersistedCache()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
    await persister.persistClient(saved)
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
  })

  it.each(['expired', 'future', 'old-version', 'corrupt'])('discards a %s snapshot', async (kind) => {
    await setOfflineFeedEnabled(true)
    const saved = snapshot()
    if (kind === 'expired') saved.timestamp = Date.now() - PERSIST_MAX_AGE - 1
    if (kind === 'future') saved.timestamp = Date.now() + 60_000
    if (kind === 'old-version') saved.buster = 'old-version'
    window.localStorage.setItem(QUERY_CACHE_KEY, kind === 'corrupt' ? '{' : JSON.stringify(saved))
    expect(await persister.restoreClient()).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
  })

  it('keeps the demo preference and cleanup separate from the real account', async () => {
    window.localStorage.setItem(OFFLINE_FEED_KEY, 'account-a')
    window.localStorage.setItem(QUERY_CACHE_KEY, 'real-cache')
    vi.stubEnv('VITE_DEMO', '1')
    vi.resetModules()
    const demoApp = await import('../lib/app')
    const demo = await import('../lib/query')
    expect(demo.isOfflineFeedEnabled()).toBe(false)
    window.localStorage.setItem(demoApp.AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'demo-user' } }))
    await demo.setOfflineFeedEnabled(true)
    expect(window.localStorage.getItem(demoApp.OFFLINE_FEED_KEY)).toBe('demo-user')
    await demo.clearPersistedCache()
    expect(window.localStorage.getItem(demoApp.OFFLINE_FEED_KEY)).toBeNull()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBe('account-a')
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBe('real-cache')
  })

  it('rejects a previous account snapshot and preference after session replacement', async () => {
    queryClient.setQueryData(['feed'], feed)
    await setOfflineFeedEnabled(true)
    const saved = window.localStorage.getItem(QUERY_CACHE_KEY)
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-b' } }))
    expect(isOfflineFeedEnabled()).toBe(false)
    expect(await persister.restoreClient()).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    // Even a preference for B must not restore a snapshot whose declared owner is A.
    window.localStorage.setItem(OFFLINE_FEED_KEY, 'account-b')
    window.localStorage.setItem(QUERY_CACHE_KEY, saved ?? '')
    expect(await persister.restoreClient()).toBeUndefined()
  })

  it('does not save or restore personal feed data without a local account', async () => {
    queryClient.setQueryData(['feed'], feed)
    await setOfflineFeedEnabled(true)
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    expect(isOfflineFeedEnabled()).toBe(false)
    expect(await persister.restoreClient()).toBeUndefined()
    await persister.persistClient(snapshot())
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    await setOfflineFeedEnabled(true)
    expect(isOfflineFeedEnabled()).toBe(false)
  })
})
