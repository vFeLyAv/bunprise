import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../database.types'

// The lists wrappers (lib/api/lists.ts) against the demo server (src/mocks): exactly the requests the lists
// tab and a list's screen send — the column grants of follows-design §4.4, the RPC names and parameters of
// §5.2/§5.3/§5.5 — and every refusal as the AppError code the screens translate. Fictional accounts only.
const access = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(access.client),
  hasLocalSession: () => access.client !== null,
  getLocalSession: () => Promise.resolve(null),
  onClientReady: () => () => {},
}))

import { acceptConsents } from './consents'
import {
  createList, deleteList, getListScreen, getListsOverview, getFreeWishes, newListId, requestFollow, setListVisibility, setMyBanner, unfollow, updateList, validListTitle,
} from './lists'
import { asListsOverview, asOwnerLists } from './lists.types'
import { updateMyProfile } from './profile'
import { getMyReservations, reserveWish } from './reservations'
import { createWish } from './wishes'
import { createDemoHandlers, DEMO_CODE, DEMO_PEOPLE, DEMO_SUPABASE_URL, DEMO_USER_ID } from '../../mocks/handlers'
import { DEMO_LIST_RESERVED_WISH, DEMO_LISTS } from '../../mocks/lists'

type Client = SupabaseClient<Database>

const server = setupServer()
let clientCount = 0

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
beforeEach(() => {
  server.resetHandlers(...createDemoHandlers())
  access.client = null
})
afterAll(() => {
  server.close()
  vi.restoreAllMocks()
})

async function becomes(email: string, name: string): Promise<{ client: Client; id: string }> {
  const client = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `demo-lists-${clientCount++}` },
  })
  await client.auth.signInWithOtp({ email })
  const verified = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  expect(verified.error).toBeNull()
  access.client = client
  await updateMyProfile({ display_name: name, locale: 'de' })
  await acceptConsents('de')
  return { client, id: verified.data.session!.user.id }
}

describe('lib/api/lists against the demo server', () => {
  it('free wishes are giver-only, budgeted and omit held wishes through the real RPC wrapper', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const data = await getFreeWishes(DEMO_PEOPLE.anna.id, 3000, me.id)
    expect(data.person.id).toBe(DEMO_PEOPLE.anna.id)
    expect(data.ideas.length).toBeGreaterThan(0)
    expect(data.ideas.every((wish) => wish.price_cents === null || wish.price_cents <= 3000)).toBe(true)
    expect(data.ideas.some((wish) => wish.wish_id === DEMO_LIST_RESERVED_WISH)).toBe(false)
    expect(JSON.stringify(data)).not.toMatch(/reserver|reserved_by/)
    await expect(getFreeWishes(me.id, null, me.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getFreeWishes(DEMO_PEOPLE.anna.id, -1, me.id)).rejects.toMatchObject({ code: 'validation' })
  })
  it('the first demo account: the seeded circle, its own lists through REST, the owner screen', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    expect(me.id).toBe(DEMO_USER_ID)
    const overview = await getListsOverview(me.id)
    expect(overview.stats).toMatchObject({ followers: 3, following: 3, requests: 2, friends_lists: 6 })
    expect(overview.following.map((person) => [person.profile.display_name, person.mutual])).toEqual([['Anna Beispiel', true], ['Ben Mustermann', false], ['Paula Brandt', true]])
    expect(overview.suggestions.map((entry) => entry.profile.id)).toEqual([DEMO_PEOPLE.clara.id])

    const id = newListId()
    expect(await createList({ id, title: '  Meine Wünsche ', visibility: 'private', cover_tone: 2, cover_icon: 'star', due_on: null }, me.id))
      .toMatchObject({ id })
    const own = await getListScreen(id, me.id)
    expect(own).toMatchObject({ viewer: { role: 'owner' }, list: { id, title: 'Meine Wünsche', visibility: 'private', cover_tone: 2, cover_icon: 'star', owner: { id: me.id } } })
    await createWish(id, { title: 'Kopfhörer', priority: 3, price_cents: 4990 })
    expect((await getListScreen(id, me.id)).wishes.map((wish) => [wish.title, wish.reserved, wish.reserved_by_me])).toEqual([['Kopfhörer', null, null]])

    await updateList(id, { title: 'Wunschzettel', cover_icon: 'gift', due_on: '2026-12-24' }, me.id)
    expect((await getListScreen(id, me.id)).list).toMatchObject({ title: 'Wunschzettel', cover_icon: 'gift', due_on: '2026-12-24' })
    await setListVisibility(id, 'followers', me.id)
    const card = (await getListsOverview(me.id)).my_lists.find((entry) => entry.id === id)
    expect(card).toMatchObject({ kind: 'standalone', visibility: 'followers', wish_count: 1, due_on: '2026-12-24' })
    await deleteList(id, me.id)
    await expect(getListScreen(id, me.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('REST never changes the visibility; others cannot touch my lists; the banner is a key', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const id = newListId()
    await createList({ id, title: 'Bücher', visibility: 'private', cover_tone: null, cover_icon: 'book', due_on: null }, me.id)
    const raw = me.client as unknown as SupabaseClient
    expect((await raw.from('wishlists').update({ visibility: 'followers' }).eq('id', id)).error?.code).toBe('42501')
    expect((await raw.from('wishlists').select('updated_at').eq('id', id)).error?.code).toBe('42501')
    await setMyBanner('carrots', me.id)
    expect((await getListsOverview(me.id)).me.banner).toBe('carrots')
    expect((await raw.from('profiles').update({ banner: 'neon' }).eq('id', me.id)).error?.code).toBe('23514')

    const other = await becomes('jonas@example.test', 'Jonas')
    await expect(updateList(id, { title: 'Gekapert' }, other.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(setListVisibility(id, 'followers', other.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getListScreen(id, other.id)).rejects.toMatchObject({ code: 'not_found' })
    // a second account of the demo has no circle: nothing seeded points at it
    expect((await getListsOverview(other.id)).following).toEqual([])
  })

  it("the giver's side: reserve on a follower list, the cap of 5 arrives as limit_reached, plans carry the list", async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const follower = await getListScreen(DEMO_LISTS.annaWishes, me.id)
    expect(follower.viewer.role).toBe('follower')
    expect(follower.wishes.find((wish) => wish.id === DEMO_LIST_RESERVED_WISH)).toMatchObject({ reserved: true, reserved_by_me: false })
    // (not 305: since 20261027200000 it also lives in Anna's occasion, where I am a guest — it is not capped)
    for (const n of ['301', '303', '304', '314', '311']) await reserveWish(`d1e0d000-0000-4000-8000-000000000${n}`, me.id)
    await expect(reserveWish('d1e0d000-0000-4000-8000-000000000312', me.id)).rejects.toMatchObject({ code: 'limit_reached', key: 'errors.limit_reached' })
    const plans = await getMyReservations(me.id)
    expect(plans.filter((plan) => plan.status === 'active')).toHaveLength(5)
    expect(plans[0]?.list).toMatchObject({ owner_name: 'Anna Beispiel' })
    await unfollow(DEMO_PEOPLE.anna.id, me.id)
    expect((await getMyReservations(me.id)).every((plan) => plan.status === 'ended' && plan.end_reason === 'unfollowed' && plan.list === null)).toBe(true)
    await expect(getListScreen(DEMO_LISTS.annaWishes, me.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('request_follow from "Aus deinen Anlässen": requested, not optimistic, one not_found for strangers', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    expect(await requestFollow(DEMO_PEOPLE.clara.id, me.id)).toBe('requested')
    expect(await requestFollow(DEMO_PEOPLE.anna.id, me.id)).toBe('following')
    await expect(requestFollow('00000000-0000-4000-8000-00000000ffff', me.id)).rejects.toMatchObject({ code: 'not_found' })
    expect((await getListsOverview(me.id)).suggestions).toEqual([])
  })

  it('pins every call to the expected account: another one is never sent', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const other = '00000000-0000-4000-8000-0000000000bb'
    await expect(getListsOverview(other)).rejects.toMatchObject({ code: 'session_expired' })
    await expect(createList({ id: newListId(), title: 'X', visibility: 'private', cover_tone: null, cover_icon: null, due_on: null }, other)).rejects.toMatchObject({ code: 'session_expired' })
    expect((await getListsOverview(me.id)).my_lists).toEqual([])
  })
})

describe('lists normalisers', () => {
  it('asOwnerLists keeps exactly the card fields — a stray count or flag never reaches a component', () => {
    const [card] = asOwnerLists([{
      id: 'l1', title: 'Meine Wünsche', kind: 'standalone', visibility: 'followers', cover_tone: 9, cover_icon: 'rocket', due_on: null,
      wish_count: 3, occasion: null, created_at: '2026-10-20T10:00:00Z', reserved_count: 2, reservations: [{}], has_reserved: true,
    }])
    expect(Object.keys(card ?? {}).sort()).toEqual(['cover_icon', 'cover_tone', 'created_at', 'due_on', 'id', 'kind', 'occasion', 'photo', 'title', 'visibility', 'wish_count'])
    expect(card?.photo).toBeNull() // 20261022160000: no cover sent → null
    expect(card).toMatchObject({ cover_tone: null, cover_icon: null, visibility: 'followers' })
    expect(JSON.stringify(asListsOverview({ my_lists: [{ id: 'x', reserved: true }], stats: { my_wishes: 1, reserved: 4 } }))).not.toMatch(/reserv/)
  })

  it('validListTitle takes the original text: 1…80 characters, one line', () => {
    expect(validListTitle('  Bücher ')).toBe('Bücher')
    expect(() => validListTitle('   ')).toThrow()
    expect(() => validListTitle('x'.repeat(81))).toThrow()
    expect(() => validListTitle('Zwei\nZeilen')).toThrow()
  })
})
