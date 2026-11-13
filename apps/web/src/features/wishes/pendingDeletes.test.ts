import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { getToasts, toast } from '../../lib/toast'

const api = vi.hoisted(() => ({ deleteWish: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>() }))
vi.mock('../../lib/api/wishes', () => ({ deleteWish: api.deleteWish }))

import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { UNDO_WINDOW_MS, isWishDeletePending, resetPendingWishDeletes, scheduleWishDelete, undoWishDelete } from './pendingDeletes'

const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
const WISH = '00000000-0000-4000-8000-00000000000a'
const OTHER = '00000000-0000-4000-8000-00000000000b'
/** the owner account the screen was rendered for (reported by the session watcher in the app) */
const OWNER_ACCOUNT = 'host'

function screenWith(ids: string[]): OccasionScreen {
  return {
    occasion: {
      id: OCCASION_ID, title: 'Feier', starts_at: '2026-11-02T00:00:00+00:00', tz: 'Europe/Berlin', all_day: true,
      place_text: null, description: null, created_at: '2026-10-01T09:00:00+00:00', host: { id: 'host', display_name: 'Mila' },
    },
    viewer: { role: 'host', rsvp: 'going' },
    members: [],
    invite: null,
    wishlist: {
      id: 'list', owner_id: 'host', title: null,
      wishes: ids.map((id) => ({
        id, title: id, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
        created_at: '2026-10-01T10:00:00+00:00', reserved: null, reserved_by_me: null,
      })),
    },
  }
}

function setup() {
  const queryClient = new QueryClient()
  queryClient.setQueryData(qk.occasion(OCCASION_ID), screenWith([WISH, OTHER]))
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const onError = vi.fn<(error: AppError) => void>()
  const schedule = () =>
    scheduleWishDelete({ wishId: WISH, occasionId: OCCASION_ID, queryClient, text: { deleted: '„A“ gelöscht', undo: 'Rückgängig' }, onError })
  return { queryClient, invalidate, onError, schedule }
}

beforeEach(() => {
  vi.useFakeTimers()
  api.deleteWish.mockReset()
  toast.clear()
  setRenderedAccount(OWNER_ACCOUNT)
})
afterEach(() => {
  resetPendingWishDeletes()
  vi.useRealTimers()
  toast.clear()
  resetAccountBoundaryForTests()
})

describe('delete with undo (5 s, client side)', () => {
  it('sends nothing during the pause; undo cancels for good', () => {
    const { schedule } = setup()
    schedule()
    expect(isWishDeletePending(WISH)).toBe(true)
    expect(getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1)
    expect(api.deleteWish).not.toHaveBeenCalled()

    expect(undoWishDelete(WISH)).toBe(true)
    expect(isWishDeletePending(WISH)).toBe(false)
    expect(getToasts()).toHaveLength(0)
    vi.advanceTimersByTime(60_000)
    expect(api.deleteWish).not.toHaveBeenCalled()
  })

  it('the toast action is the undo', () => {
    const { schedule } = setup()
    schedule()
    const item = getToasts()[0]
    expect(item).toMatchObject({ text: '„A“ gelöscht', actionLabel: 'Rückgängig', duration: UNDO_WINDOW_MS })
    item?.onAction?.()
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2)
    expect(api.deleteWish).not.toHaveBeenCalled()
  })

  it('after the pause: one request, the wish leaves the cached list, the screens refetch; undo is too late', async () => {
    api.deleteWish.mockResolvedValue(undefined)
    const { schedule, queryClient, invalidate } = setup()
    schedule()
    schedule() // a second tap does not schedule twice
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    expect(api.deleteWish).toHaveBeenCalledTimes(1)
    expect(api.deleteWish).toHaveBeenCalledWith(WISH, OWNER_ACCOUNT) // for the account that asked for it
    expect(undoWishDelete(WISH)).toBe(false)
    expect(isWishDeletePending(WISH)).toBe(false)
    expect(queryClient.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.wishlist?.wishes.map((w) => w.id)).toEqual([OTHER])
    // the occasion refetches even while its screen is not mounted (the person goes back to it)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.occasion(OCCASION_ID), refetchType: 'all' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.feed() })
    expect(getToasts()).toHaveLength(0)
  })

  it('sends nothing when the account that asked for it ended in this tab during the pause', async () => {
    const { schedule, queryClient, invalidate, onError } = setup()
    schedule()
    endAccountEpoch() // another account signed in / this one signed out (lib/session.ts)
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    expect(api.deleteWish).not.toHaveBeenCalled()
    expect(isWishDeletePending(WISH)).toBe(false)
    expect(invalidate).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(queryClient.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.wishlist?.wishes).toHaveLength(2)
  })

  it('a late answer for an account that ended meanwhile changes nothing', async () => {
    let fail: ((reason: unknown) => void) | undefined
    api.deleteWish.mockImplementation(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    const { schedule, invalidate, onError } = setup()
    schedule()
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    expect(api.deleteWish).toHaveBeenCalledWith(WISH, OWNER_ACCOUNT)
    endAccountEpoch()
    fail?.(new AppError('session_expired'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(isWishDeletePending(WISH)).toBe(false)
    expect(getToasts()).toHaveLength(0)
  })

  it('a failed request brings the wish back and reports the error', async () => {
    api.deleteWish.mockRejectedValue(new AppError('network'))
    const { schedule, queryClient, onError } = setup()
    schedule()
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'network' }))
    expect(isWishDeletePending(WISH)).toBe(false)
    expect(queryClient.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.wishlist?.wishes).toHaveLength(2)
  })
})
