import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { listsSource, loadPeople } from './sources'
const api = vi.hoisted(() => ({ getListsOverview: vi.fn(), getListScreen: vi.fn() }))
vi.mock('../../lib/api/lists', () => api)
vi.mock('../../lib/api/occasions', () => ({ getFeed: vi.fn(), getOccasionScreen: vi.fn() }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
it('followed people merge with hosted occasions by identity, and own standalone lists feed For me', async () => {
  vi.stubEnv('VITE_LISTS', '1')
  const ctx = { userId: 'me', queryClient: new QueryClient() }
  ctx.queryClient.setQueryData(['feed'], { upcoming: [{ id: 'occasion', role: 'member', host_id: 'anna', host_name: 'Anna', title: 'Geburtstag', starts_at: '2026-11-01', wish_count: 3 }], past: [] })
  api.getListsOverview.mockResolvedValue({ following: [{ profile: { id: 'anna', display_name: 'Anna' }, lists: [{ id: 'anna-list', title: 'Bücher', due_on: null, wish_count: 2 }] }], my_lists: [{ id: 'mine', title: 'Meine Wünsche', kind: 'standalone', due_on: null, wish_count: 1 }] })
  const people = await loadPeople(ctx)
  expect(people).toHaveLength(1)
  expect(people[0]?.key).toBe('profile:anna')
  expect(people[0]?.lists.map((list) => list.key)).toEqual(['occasion:occasion', 'list:anna-list'])
  expect((await listsSource.myLists(ctx))[0]?.key).toBe('list:mine')
  const refs = people[0]!.lists
  api.getListScreen.mockResolvedValue({ list: { id: 'anna-list', owner: { id: 'anna', display_name: 'Anna' } }, viewer: { role: 'follower' }, wishes: [{ id: 'w', title: 'Buch', url: null, price_cents: 1000, priority: 2, reserved: true, reserved_by_me: true }] })
  const loaded = await listsSource.loadList(refs[1]!, ctx)
  expect(loaded.wishlistId).toBeNull()
  expect(loaded.wishes).toEqual([{ title: 'Buch', url: null, priceCents: 1000, priority: 2 }])
})
it('the release flag leaves the old database completely alone', async () => {
  vi.stubEnv('VITE_LISTS', '')
  const ctx = { userId: 'me', queryClient: new QueryClient() }
  expect(await listsSource.people(ctx)).toEqual([])
  expect(await listsSource.myLists(ctx)).toEqual([])
  expect(api.getListsOverview).not.toHaveBeenCalled()
})
