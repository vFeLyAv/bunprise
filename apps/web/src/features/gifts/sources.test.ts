import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen, OccasionScreen } from '../../lib/api/types'

// The pluggable sources of "Geschenk finden": today the occasions (hosts of the occasions I joined; my own
// hosted ones). Only what the giver may read, through the screen RPCs already in memory; a wish leaves a
// source as title + link + price + "Wie sehr?" — never with reservation fields.

const api = vi.hoisted(() => ({ getFeed: vi.fn(), getOccasionScreen: vi.fn() }))
vi.mock('../../lib/api/occasions', () => ({ getFeed: api.getFeed, getOccasionScreen: api.getOccasionScreen }))

import { qk } from '../../lib/queryKeys'
import { giftSources, loadList, loadMyLists, loadPeople, registerGiftSource, type GiftSource } from './sources'

const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
const row = (id: string, title: string, role: 'host' | 'member', host: string, days: number) => ({
  id, title, starts_at: soon(days), tz: 'Europe/Berlin', all_day: true, place_text: null, role, rsvp: 'none' as const,
  host_name: host, member_count: 2, wish_count: 3, my_reservation_count: role === 'host' ? null : 1,
})

const FEED: FeedScreen = {
  upcoming: [row('o-ben', 'Bens Grillabend', 'member', 'Ben Mustermann', 30), row('o-anna', 'Annas Einweihung', 'member', 'Anna Beispiel', 3), row('o-mine', 'Milas Geburtstag', 'host', 'Mila', 12), row('o-anna2', 'Annas Geburtstag', 'member', 'Anna Beispiel', 60)],
  past: [row('o-old', 'Clara war gestern', 'member', 'Clara Test', -2)],
}

function context() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(qk.feed(), FEED)
  return { userId: 'me', queryClient }
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })

describe('the occasions source', () => {
  it('people = hosts of the upcoming occasions I joined, each once with their lists, the nearest first', async () => {
    const people = await loadPeople(context())
    expect(people.map((person) => person.name)).toEqual(['Anna Beispiel', 'Ben Mustermann'])
    expect(people[0]?.lists.map((list) => list.title)).toEqual(['Annas Einweihung', 'Annas Geburtstag'])
    // no request of its own: the feed in memory is used
    expect(api.getFeed).not.toHaveBeenCalled()
  })

  it('my lists = the upcoming occasions I host', async () => {
    expect((await loadMyLists(context())).map((list) => list.title)).toEqual(['Milas Geburtstag'])
  })

  it('legacy feed keeps the clicked host profile from an already cached occasion, without another RPC or lists', async () => {
    vi.stubEnv('VITE_LISTS', '')
    const ctx = context()
    ctx.queryClient.setQueryData(qk.feed(), {
      upcoming: [row('o-anna', 'Annas Einweihung', 'member', 'Anna', 3), row('o-other', 'Andere Anna', 'member', 'Anna', 4), row('o-uncached', 'Noch eine Anna', 'member', 'Anna', 5)],
      past: [],
    } satisfies FeedScreen)
    const cached = (id: string, host: string): OccasionScreen => ({
      occasion: { id, title: 'Feier', starts_at: soon(3), tz: 'Europe/Berlin', all_day: true, place_text: null, description: null, created_at: soon(-5), host: { id: host, display_name: 'Anna' } },
      viewer: { role: 'member', rsvp: 'none' }, members: [], invite: null, wishlist: null,
    })
    ctx.queryClient.setQueryData(qk.occasion('o-anna'), cached('o-anna', 'p-clicked-anna'))
    ctx.queryClient.setQueryData(qk.occasion('o-other'), cached('o-other', 'p-other-anna'))
    // A cache entry with a mismatched identity must never supply another occasion's host.
    ctx.queryClient.setQueryData(qk.occasion('o-uncached'), cached('wrong-occasion', 'p-wrong'))
    const people = await loadPeople(ctx)
    expect(people.map((person) => [person.key, person.profileId, person.lists.map((list) => list.key)])).toEqual([
      ['profile:p-clicked-anna', 'p-clicked-anna', ['occasion:o-anna']],
      ['profile:p-other-anna', 'p-other-anna', ['occasion:o-other']],
      ['host:anna', null, ['occasion:o-uncached']],
    ])
    expect(api.getFeed).not.toHaveBeenCalled()
    expect(api.getOccasionScreen).not.toHaveBeenCalled()
  })

  it('a list leaves the source without anything about reservations', async () => {
    const screen: OccasionScreen = {
      occasion: { id: 'o-anna', title: 'Annas Einweihung', starts_at: soon(3), tz: 'Europe/Berlin', all_day: true, place_text: null, description: null, created_at: soon(-5), host: { id: 'p-anna', display_name: 'Anna Beispiel' } },
      viewer: { role: 'member', rsvp: 'none' },
      members: [],
      invite: null,
      wishlist: { id: 'l-anna', owner_id: 'p-anna', title: null, wishes: [{ id: 'w', title: 'Kaffeemühle', url: null, price_cents: 4500, currency: 'EUR', note: 'Gern aus Holz', priority: 3, created_at: soon(-4), reserved: true, reserved_by_me: true }] },
    }
    api.getOccasionScreen.mockResolvedValue(screen)
    const people = await loadPeople(context())
    const ref = people[0]?.lists[0]
    if (!ref) throw new Error('no list')
    const list = await loadList(ref, context())
    expect(api.getOccasionScreen).toHaveBeenCalledWith('o-anna', 'me')
    expect(list.owner).toEqual({ profileId: 'p-anna', name: 'Anna Beispiel' })
    expect(list.wishlistId).toBeNull() // not mine: no wish can be added to it
    expect(list.wishes).toEqual([{ title: 'Kaffeemühle', url: null, priceCents: 4500, priority: 3 }])
    expect(JSON.stringify(list)).not.toMatch(/reserv|Holz/)
  })
})

describe('the registry', () => {
  it('a later source (wave 2b: follows) plugs in once; people of the same key merge', async () => {
    const follows: GiftSource = {
      id: 'follows-test',
      people: async () => [{ key: 'host:anna beispiel', name: 'Anna Beispiel', profileId: null, lists: [{ key: 'list:wunsch', sourceId: 'follows-test', title: 'Annas Wünsche', startsAt: null, wishCount: 4 }] }],
      myLists: async () => [],
      loadList: async (ref) => ({ ref, owner: { profileId: 'p-anna', name: 'Anna Beispiel' }, wishlistId: null, occasionId: null, wishes: [] }),
    }
    registerGiftSource(follows)
    registerGiftSource(follows)
    expect(giftSources().filter((source) => source.id === 'follows-test')).toHaveLength(1)
    const anna = (await loadPeople(context())).find((person) => person.name === 'Anna Beispiel')
    expect(anna?.lists.map((list) => list.title)).toEqual(['Annas Einweihung', 'Annas Geburtstag', 'Annas Wünsche'])
    await expect(loadList({ key: 'x', sourceId: 'nobody', title: 'x', startsAt: null, wishCount: null }, context())).rejects.toThrow()
  })
})
