import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../lib/api/types'
import { trustedMe } from '../../lib/consentGate'
import { queryKeys } from '../../lib/queryKeys'

// The request dot's hook (for the integration step: the dot on the "Listen" tab) reads get_me().inbox.follow_requests
// from the guard's ['me'] answer and never sends a request of its own; keeping that number in step after an own
// action must never extend or restore the consent guard's trust (lib/consentGate.ts). And none of the follow keys
// ever goes to disk (W05): the persist allow-list stays exactly ['feed'].

const profile = vi.hoisted(() => ({ getMe: vi.fn() }))
vi.mock('../../lib/api/profile', () => ({ getMe: profile.getMe }))
const follows = vi.hoisted(() => ({ peekFollowLink: vi.fn() }))
vi.mock('../../lib/api/follows', async (original) => ({ ...(await original<typeof import('../../lib/api/follows')>()), peekFollowLink: follows.peekFollowLink }))

import { followPeekQuery, patchFollowRequestCount, patchInSuggestions, peopleKeys, useFollowRequestCount } from './queries'

const ME = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-0000000000bb'

function me(id = ME, requests: number | null = 2): Me {
  return {
    profile: { id, display_name: 'Mila', locale: 'de', onboarding_done_at: null, in_suggestions: false },
    consents_ok: true,
    legal_versions: { terms: 't', privacy: 'p', age: 'a' },
    ...(requests === null ? {} : { inbox: { follow_requests: requests } }),
  }
}

function setup(data?: Me, updatedAt?: number) {
  const queryClient = new QueryClient()
  if (data) queryClient.setQueryData(queryKeys.me(), data, updatedAt === undefined ? undefined : { updatedAt })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { queryClient, wrapper }
}

beforeEach(() => vi.stubEnv('VITE_LISTS', '1'))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('useFollowRequestCount', () => {
  it("reads this account's inbox from the cached get_me — no request of its own", () => {
    const { wrapper } = setup(me())
    expect(renderHook(() => useFollowRequestCount(ME), { wrapper }).result.current).toBe(2)
    expect(profile.getMe).not.toHaveBeenCalled()
  })

  it('0 for another account, without an answer, before the migrations (no inbox) and with the flag off', () => {
    expect(renderHook(() => useFollowRequestCount(OTHER), { wrapper: setup(me()).wrapper }).result.current).toBe(0)
    expect(renderHook(() => useFollowRequestCount(ME), { wrapper: setup().wrapper }).result.current).toBe(0)
    expect(renderHook(() => useFollowRequestCount(ME), { wrapper: setup(me(ME, null)).wrapper }).result.current).toBe(0)
    vi.stubEnv('VITE_LISTS', '')
    expect(renderHook(() => useFollowRequestCount(ME), { wrapper: setup(me()).wrapper }).result.current).toBe(0)
    expect(profile.getMe).not.toHaveBeenCalled()
  })
})

describe('patching the cached get_me never touches the guard\'s trust', () => {
  it('keeps dataUpdatedAt: an answer about to expire stays about to expire', () => {
    const old = Date.now() - 59_000
    const { queryClient } = setup(me(), old)
    patchFollowRequestCount(queryClient, ME, (count) => count - 1)
    expect(queryClient.getQueryData<Me>(queryKeys.me())?.inbox).toEqual({ follow_requests: 1 })
    expect(queryClient.getQueryState(queryKeys.me())?.dataUpdatedAt).toBe(old)
    expect(trustedMe(queryClient, ME, old + 61_000)).toBeNull() // still ends after 60 s from the server's answer
    patchInSuggestions(queryClient, ME, true)
    expect(queryClient.getQueryData<Me>(queryKeys.me())?.profile.in_suggestions).toBe(true)
    expect(queryClient.getQueryState(queryKeys.me())?.dataUpdatedAt).toBe(old)
  })

  it('an invalidated answer (a profile write on its way) or another account is left alone', async () => {
    const { queryClient } = setup(me())
    await queryClient.invalidateQueries({ queryKey: queryKeys.me(), refetchType: 'none' })
    patchFollowRequestCount(queryClient, ME, () => 0)
    expect(queryClient.getQueryState(queryKeys.me())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryData<Me>(queryKeys.me())?.inbox).toEqual({ follow_requests: 2 })
    const other = setup(me(OTHER))
    patchFollowRequestCount(other.queryClient, ME, () => 0)
    expect(other.queryClient.getQueryData<Me>(queryKeys.me())?.inbox).toEqual({ follow_requests: 2 })
  })

  it('never below zero', () => {
    const { queryClient } = setup(me(ME, 0))
    patchFollowRequestCount(queryClient, ME, (count) => count - 1)
    expect(queryClient.getQueryData<Me>(queryKeys.me())?.inbox).toEqual({ follow_requests: 0 })
  })
})

describe('W05: the follow keys live in memory only', () => {
  it('a newer link gets its own request while the previous peek is still in flight', async () => {
    let finish!: (value: unknown) => void
    follows.peekFollowLink.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    follows.peekFollowLink.mockResolvedValueOnce({ profile: { id: OTHER } })
    const queryClient = new QueryClient()
    const first = queryClient.fetchQuery(followPeekQuery('a'.repeat(64), ME))
    const second = queryClient.fetchQuery(followPeekQuery('b'.repeat(64), ME))
    expect(follows.peekFollowLink).toHaveBeenCalledTimes(2)
    finish({ profile: { id: ME } })
    expect(await first).toEqual({ profile: { id: ME } })
    expect(await second).toEqual({ profile: { id: OTHER } })
  })

  it('people, person and followPeek are never persisted (the allow-list stays exactly ["feed"])', async () => {
    const { PERSISTED_ROOTS, shouldPersistQuery } = await import('../../lib/query')
    expect([...PERSISTED_ROOTS]).toEqual(['feed'])
    const queryClient = new QueryClient()
    for (const key of [peopleKeys.screen(), peopleKeys.person(ME), peopleKeys.peek('a'.repeat(64), ME), ['followGate']]) {
      queryClient.setQueryData(key, { any: 'data' })
      const query = queryClient.getQueryCache().find({ queryKey: key })
      expect(query && shouldPersistQuery(query), JSON.stringify(key)).toBe(false)
    }
  })
})
