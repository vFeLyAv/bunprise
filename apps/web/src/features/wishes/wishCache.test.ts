import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { OccasionScreen, OccasionScreenWish } from '../../lib/api/types'
import { qk } from '../../lib/queryKeys'
import { findCachedWish, invalidateWishViews, patchCachedWish, removeCachedWish } from './wishCache'

const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
const LIST_ID = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'

function wish(id: string, priority: 1 | 2 | 3, createdAt: string, flags: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return { id, title: id, url: null, price_cents: null, currency: 'EUR', note: null, priority, created_at: createdAt, reserved: null, reserved_by_me: null, ...flags }
}

function screen(role: 'host' | 'member', wishes: OccasionScreenWish[]): OccasionScreen {
  return {
    occasion: {
      id: OCCASION_ID, title: 'Feier', starts_at: '2026-11-02T00:00:00+00:00', tz: 'Europe/Berlin', all_day: true,
      place_text: null, description: null, created_at: '2026-10-01T09:00:00+00:00', host: { id: 'host', display_name: 'Mila' },
    },
    viewer: { role, rsvp: 'going' },
    members: [],
    invite: null,
    wishlist: { id: LIST_ID, owner_id: 'host', title: null, wishes },
  }
}

describe('wish cache helpers', () => {
  it('finds a cached wish without its reservation fields and knows whether the viewer hosts', () => {
    const client = new QueryClient()
    client.setQueryData(qk.occasion(OCCASION_ID), screen('member', [wish('a', 2, '2026-10-01T10:00:00Z', { reserved: true, reserved_by_me: true })]))
    const found = findCachedWish(client, 'a')
    expect(found).toMatchObject({ occasionId: OCCASION_ID, isHost: false, wish: { id: 'a', title: 'a' } })
    expect(Object.keys(found?.wish ?? {}).some((key) => key.startsWith('reserved'))).toBe(false)
    expect(findCachedWish(client, 'missing')).toBeNull()
  })

  it('patches a wish and keeps the one order (a new priority moves it)', () => {
    const client = new QueryClient()
    client.setQueryData(qk.occasion(OCCASION_ID), screen('host', [wish('a', 3, '2026-10-01T10:00:00Z'), wish('b', 2, '2026-10-02T10:00:00Z')]))
    patchCachedWish(client, OCCASION_ID, 'b', { title: 'B neu', url: null, price_cents: 900, note: null, priority: 3 })
    const wishes = client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.wishlist?.wishes ?? []
    expect(wishes.map((w) => [w.id, w.title, w.priority])).toEqual([['a', 'a', 3], ['b', 'B neu', 3]])
    removeCachedWish(client, OCCASION_ID, 'a')
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.wishlist?.wishes.map((w) => w.id)).toEqual(['b'])
  })

  it('refetches the occasion right away even while its screen is not mounted', async () => {
    const client = new QueryClient()
    const load = vi.fn(() => Promise.resolve(screen('host', [])))
    await client.fetchQuery({ queryKey: qk.occasion(OCCASION_ID), queryFn: load })
    expect(load).toHaveBeenCalledTimes(1)
    await invalidateWishViews(client, OCCASION_ID)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
