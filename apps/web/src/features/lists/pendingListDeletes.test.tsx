import { QueryClient } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { getToasts, toast } from '../../lib/toast'

const api = vi.hoisted(() => ({ deleteList: vi.fn<() => Promise<void>>() }))
vi.mock('../../lib/api/lists', () => ({ deleteList: api.deleteList }))
vi.mock('./queries', () => ({ listsKeys: { list: (id: string) => ['list', id], overview: () => ['lists'] }, removeOwnCard: vi.fn(), updateOverview: vi.fn() }))

import { resetPendingListDeletes, scheduleListDelete, usePendingListDeletes } from './pendingListDeletes'

function schedule(userId: string) {
  scheduleListDelete({ listId: 'fixture-list', userId, queryClient: new QueryClient(), text: { deleted: 'Deleted', undo: 'Undo' }, onError: vi.fn(), delayMs: 100 })
}
beforeEach(() => {
  vi.useFakeTimers()
  setRenderedAccount('account-a')
  api.deleteList.mockResolvedValue(undefined)
})
afterEach(() => {
  resetPendingListDeletes()
  resetAccountBoundaryForTests()
  toast.clear()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('a stale screen schedules nothing for the next account', () => {
  setRenderedAccount('account-b')
  const view = renderHook(usePendingListDeletes)
  act(() => schedule('account-a'))
  expect(view.result.current.size).toBe(0)
  expect(getToasts()).toEqual([])
})

it('account end clears pending deletes and undo immediately without sending anything later', async () => {
  const view = renderHook(usePendingListDeletes)
  act(() => schedule('account-a'))
  expect(view.result.current.size).toBe(1)
  act(endAccountEpoch)
  expect(view.result.current.size).toBe(0)
  expect(getToasts()).toEqual([])
  await vi.advanceTimersByTimeAsync(200)
  expect(api.deleteList).not.toHaveBeenCalled()
})

it('a late old delete cannot remove a new account\'s pending entry for the same id', async () => {
  let finish!: () => void
  api.deleteList.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
  const view = renderHook(usePendingListDeletes)
  act(() => schedule('account-a'))
  await act(() => vi.advanceTimersByTimeAsync(100))
  act(endAccountEpoch)
  setRenderedAccount('account-b')
  act(() => schedule('account-b'))
  await act(async () => { finish(); await Promise.resolve() })
  expect(view.result.current.size).toBe(1)
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(api.deleteList).toHaveBeenNthCalledWith(1, 'fixture-list', 'account-a')
  expect(api.deleteList).toHaveBeenNthCalledWith(2, 'fixture-list', 'account-b')
})
