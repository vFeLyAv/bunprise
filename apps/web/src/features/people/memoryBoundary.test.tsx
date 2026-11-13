import { QueryClient } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { getToasts, toast } from '../../lib/toast'

const api = vi.hoisted(() => ({ respondFollow: vi.fn<() => Promise<void>>() }))
vi.mock('../../lib/api/follows', () => ({ respondFollow: api.respondFollow }))
vi.mock('./queries', () => ({ invalidatePeople: vi.fn(() => Promise.resolve()), patchFollowRequestCount: vi.fn() }))

import { forgetFollowLinksForTests, rememberedFollowLink, rememberFollowLink } from './followLinkMemory'
import { resetPendingDeclines, scheduleDecline, usePendingDeclines } from './pendingDeclines'

const ME = 'account-a'
const NEXT = 'account-b'
const PERSON = 'person-c'

function decline(userId = NEXT) {
  scheduleDecline({ profileId: PERSON, userId, queryClient: new QueryClient(), text: { declined: 'Declined', undo: 'Undo' }, onError: vi.fn(), delayMs: 100 })
}

beforeEach(() => {
  vi.useFakeTimers()
  setRenderedAccount(ME)
  api.respondFollow.mockResolvedValue(undefined)
})
afterEach(() => {
  resetPendingDeclines()
  forgetFollowLinksForTests()
  resetAccountBoundaryForTests()
  toast.clear()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('people module memory at an in-page account switch', () => {
  it('forgets previously shared links immediately, including when the same account signs in later', () => {
    rememberFollowLink(ME, { url: '/f#fixture', expiresAt: new Date(Date.now() + 60_000).toISOString() })
    endAccountEpoch()
    setRenderedAccount(NEXT)
    expect(rememberedFollowLink(ME)).toBeNull()
    setRenderedAccount(ME)
    expect(rememberedFollowLink(ME)).toBeNull()
  })

  it('clears hidden declines and undo toasts before the next account renders; sends nothing later', async () => {
    setRenderedAccount(NEXT)
    const view = renderHook(usePendingDeclines)
    act(decline)
    expect(view.result.current.has(PERSON)).toBe(true)
    act(endAccountEpoch)
    expect(view.result.current.size).toBe(0)
    expect(getToasts()).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(api.respondFollow).not.toHaveBeenCalled()
  })

  it('a late old decline cannot remove the next account\'s pending decline of the same person', async () => {
    let finish!: () => void
    api.respondFollow.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    const view = renderHook(usePendingDeclines)
    act(() => decline(ME))
    await act(() => vi.advanceTimersByTimeAsync(100))
    act(endAccountEpoch)
    setRenderedAccount(NEXT)
    act(decline)
    await act(async () => { finish(); await Promise.resolve() })
    expect(view.result.current.has(PERSON)).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(api.respondFollow).toHaveBeenCalledTimes(2)
  })
})
