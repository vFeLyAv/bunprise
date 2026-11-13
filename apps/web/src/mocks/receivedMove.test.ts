import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, DEMO_RESERVED_WISH_ID, seedDemoWorld } from './fixtures'
import { createListsApi, DEMO_LIST_PEOPLE, DEMO_LIST_RECEIVED_WISH, DEMO_LIST_RESERVED_WISH, DEMO_LISTS, seedListsDemo } from './lists'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// "Erhalten" and moving a wish in the demo world follow 20261022160000_list_photos_received_move.sql (parts B, C):
// owner-only writes; received wishes in their own part; never NEWLY reserved; existing reservations untouched;
// a move keeps the reservation of a giver who can read the target and ends every other one as 'wish_moved';
// INV-1 always; the owner's whole view never depends on reservations. Fictional people only.
// Cast: Anna's "Annas Wünsche" (followers: ME + Paula), her occasion "Annas Einweihung" (guests: Ben, Clara, ME),
// her "Nur für mich" list. So ME is follower + guest, Paula follower only, Ben guest only.

const NOW = Date.parse('2026-10-22T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const HOUSEWARMING_LIST = 'd1e0c000-0000-4000-8000-000000000001'
const KOPFHOERER = 'd1e0d000-0000-4000-8000-000000000301'
const { anna, ben } = DEMO_PEOPLE
const { paula } = DEMO_LIST_PEOPLE

function setup() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  seedListsDemo(world, ME, NOW)
  world.addPerson({ id: ME, displayName: () => 'Mila', hasConsents: () => true } satisfies DemoPerson)
  world.addGuest(DEMO_OCCASIONS.housewarming, ME)
  return { world, api: createListsApi(world) }
}

function code(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DemoDbError) return error.code === 'P0001' ? error.message : error.code
    throw error
  }
  throw new Error('expected a refusal')
}

type W = { id: string; reserved: boolean | null; reserved_by_me: boolean | null; received_at?: string | null }
type Screen = { wishes: W[]; received: W[] }
const ids = (list: readonly W[]) => list.map((w) => w.id)
const listScreen = (api: ReturnType<typeof setup>['api'], who: string, id: string) => api.getListScreen(who, id) as unknown as Screen
const occasionList = (world: ReturnType<typeof setup>['world'], who: string) =>
  world.getOccasionScreen(who, DEMO_OCCASIONS.housewarming).wishlist as unknown as Screen
const reservationOf = (world: ReturnType<typeof setup>['world'], wishId: string) =>
  world.internals.reservations.filter((r) => r.wish_id === wishId).map((r) => ({ status: r.status, end_reason: r.end_reason, wishlist_id: r.wishlist_id }))

function expectInv1(world: ReturnType<typeof setup>['world']) {
  for (const r of world.internals.reservations) {
    if (r.status === 'active') expect(world.internals.canReadWishlist(r.wishlist_id, r.reserver_id), `reservation ${r.id}`).toBe(true)
  }
}

describe('demo "Erhalten"', () => {
  it('the seed: one of Anna\'s wishes is received — followers see it in `received`, never in the open part', () => {
    const { api } = setup()
    const mine = listScreen(api, ME, DEMO_LISTS.annaWishes)
    expect(ids(mine.wishes)).not.toContain(DEMO_LIST_RECEIVED_WISH)
    expect(mine.received.map((w) => [w.id, typeof w.received_at])).toEqual([[DEMO_LIST_RECEIVED_WISH, 'string']])
    expect(listScreen(api, anna.id, DEMO_LISTS.annaWishes).received.map((w) => [w.id, w.reserved])).toEqual([[DEMO_LIST_RECEIVED_WISH, null]])
  })

  it('only the owner marks (one not_found); null is validation; marking keeps the first moment; un-marking restores', () => {
    const { world, api } = setup()
    for (const who of [ME, paula.id, ben.id]) expect(code(() => world.setWishReceived(who, KOPFHOERER, true))).toBe('not_found')
    expect(code(() => world.setWishReceived(anna.id, '00000000-0000-4000-8000-00000000ffff', true))).toBe('not_found')
    expect(code(() => world.setWishReceived(anna.id, KOPFHOERER, null))).toBe('validation')
    const first = world.setWishReceived(anna.id, KOPFHOERER, true)
    expect(world.setWishReceived(anna.id, KOPFHOERER, true)).toEqual(first)
    expect(ids(listScreen(api, ME, DEMO_LISTS.annaWishes).received)).toContain(KOPFHOERER)
    expect(world.setWishReceived(anna.id, KOPFHOERER, false)).toEqual({ ok: true, received_at: null })
    expect(ids(listScreen(api, ME, DEMO_LISTS.annaWishes).wishes)).toContain(KOPFHOERER)
  })

  it('never NEWLY reserved; the holder keeps it, sees it (screen + plans), may cancel; free wishes leave it out', () => {
    const { world, api } = setup()
    // Paula reserved "Wanderrucksack" (seed); Anna marks it received
    world.setWishReceived(anna.id, DEMO_LIST_RESERVED_WISH, true)
    expect(reservationOf(world, DEMO_LIST_RESERVED_WISH)).toEqual([{ status: 'active', end_reason: null, wishlist_id: DEMO_LISTS.annaWishes }])
    expect(code(() => world.reserveWish(ME, DEMO_LIST_RESERVED_WISH))).toBe('not_allowed')
    expect(code(() => world.reserveWish(ME, DEMO_LIST_RECEIVED_WISH))).toBe('not_allowed')
    expect(world.reserveWish(paula.id, DEMO_LIST_RESERVED_WISH)).toEqual({ ok: true }) // idempotent for the holder
    const paulas = listScreen(api, paula.id, DEMO_LISTS.annaWishes).received.find((w) => w.id === DEMO_LIST_RESERVED_WISH)
    expect([paulas?.reserved, paulas?.reserved_by_me]).toEqual([true, true])
    expect(world.myReservations(paula.id).find((r) => r.wish_id === DEMO_LIST_RESERVED_WISH)?.received_at).toEqual(expect.any(String))
    const free = api.getFreeWishes(ME, anna.id, null) as unknown as { ideas: { wish_id: string }[] }
    expect(free.ideas.map((i) => i.wish_id)).not.toContain(DEMO_LIST_RECEIVED_WISH)
    expect(world.cancelReservation(paula.id, DEMO_LIST_RESERVED_WISH)).toEqual({ ok: true })
    expect(code(() => world.reserveWish(paula.id, DEMO_LIST_RESERVED_WISH))).toBe('not_allowed')
    // an occasion list the same: Ben's reserved coffee grinder stays reserved, Clara cannot take it
    world.setWishReceived(anna.id, DEMO_RESERVED_WISH_ID, true)
    expect(reservationOf(world, DEMO_RESERVED_WISH_ID)[0]?.status).toBe('active')
    expect(ids(occasionList(world, ME).received)).toEqual([DEMO_RESERVED_WISH_ID])
    expect(code(() => world.reserveWish(ME, DEMO_RESERVED_WISH_ID))).toBe('not_allowed')
    expectInv1(world)
  })

  it('the cap of 5 counts no reservations of received wishes', () => {
    const { world } = setup()
    // (not 305: since 20261027200000 that wish is also in Anna's occasion, where I am a guest — it does not count)
    const wishes = ['301', '303', '304', '314', '311', '312'].map((n) => `d1e0d000-0000-4000-8000-000000000${n}`)
    for (const w of wishes.slice(0, 5)) expect(world.reserveWish(ME, w)).toEqual({ ok: true })
    expect(code(() => world.reserveWish(ME, wishes[5]!))).toBe('limit_reached')
    world.setWishReceived(anna.id, wishes[0]!, true)
    expect(world.reserveWish(ME, wishes[5]!)).toEqual({ ok: true })
  })
})

describe('demo move_wish', () => {
  it('only the owner of both lists (one not_found); the same list does nothing; widening needs consents', () => {
    const { world } = setup()
    for (const [who, wish, list] of [
      [ME, KOPFHOERER, DEMO_LISTS.annaPrivate], [paula.id, KOPFHOERER, DEMO_LISTS.annaBirthday], // not the owner
      [anna.id, KOPFHOERER, DEMO_LISTS.paulaBooks], // a foreign target
      [anna.id, 'd1e0d000-0000-4000-8000-000000000201', DEMO_LISTS.annaWishes], // a foreign wish (Ben's barbecue)
      [anna.id, '00000000-0000-4000-8000-00000000ffff', DEMO_LISTS.annaWishes], [anna.id, KOPFHOERER, null],
    ] as const) {
      expect(code(() => world.moveWish(who, wish, list)), `${who} ${wish} → ${list}`).toBe('not_found')
    }
    expect(world.moveWish(anna.id, KOPFHOERER, DEMO_LISTS.annaWishes)).toEqual({ ok: true })
    expect(world.internals.wishes.get(KOPFHOERER)?.wishlist_id).toBe(DEMO_LISTS.annaWishes)
  })

  it('every reader category: follower-only and guest-only givers lose it (wish_moved), follower + guest keeps it', () => {
    const { world, api } = setup()
    expect(world.reserveWish(ME, KOPFHOERER)).toEqual({ ok: true })
    // annaWishes → her occasion list: Paula (follower only) loses "Wanderrucksack", ME (also a guest) keeps "Kopfhörer"
    world.moveWish(anna.id, DEMO_LIST_RESERVED_WISH, HOUSEWARMING_LIST)
    world.moveWish(anna.id, KOPFHOERER, HOUSEWARMING_LIST)
    expect(reservationOf(world, DEMO_LIST_RESERVED_WISH)).toEqual([{ status: 'ended', end_reason: 'wish_moved', wishlist_id: DEMO_LISTS.annaWishes }])
    expect(reservationOf(world, KOPFHOERER)).toEqual([{ status: 'active', end_reason: null, wishlist_id: HOUSEWARMING_LIST }])
    const kopf = occasionList(world, ME).wishes.find((w) => w.id === KOPFHOERER)
    expect([kopf?.reserved, kopf?.reserved_by_me]).toEqual([true, true])
    // Paula keeps only the snapshot: a later rename does not reach her
    world.internals.wishes.get(DEMO_LIST_RESERVED_WISH)!.title = 'Neuer Titel'
    // 20261027200000 (Q1): no context, no wish id, one neutral reason
    expect(world.myReservations(paula.id).find((r) => r.wish_title === 'Wanderrucksack, 28 Liter'))
      .toMatchObject({ status: 'ended', end_reason: 'unavailable', wish_id: null, received_at: null })
    // her occasion list → annaWishes: Ben (guest only) loses the coffee grinder
    world.moveWish(anna.id, DEMO_RESERVED_WISH_ID, DEMO_LISTS.annaWishes)
    expect(reservationOf(world, DEMO_RESERVED_WISH_ID)).toEqual([{ status: 'ended', end_reason: 'wish_moved', wishlist_id: HOUSEWARMING_LIST }])
    expect(listScreen(api, ME, DEMO_LISTS.annaWishes).wishes.find((w) => w.id === DEMO_RESERVED_WISH_ID)).toMatchObject({ reserved: false })
    // into "Nur für mich": everybody loses it
    world.moveWish(anna.id, KOPFHOERER, DEMO_LISTS.annaPrivate)
    expect(reservationOf(world, KOPFHOERER)).toEqual([{ status: 'ended', end_reason: 'wish_moved', wishlist_id: HOUSEWARMING_LIST }])
    expect(code(() => api.getListScreen(ME, DEMO_LISTS.annaPrivate))).toBe('not_found')
    expectInv1(world)
  })

  it("the owner's whole view is the same with and without reservations, after marking and moving", () => {
    const view = (withReservations: boolean) => {
      const { world, api } = setup()
      if (withReservations) {
        expect(world.reserveWish(ME, KOPFHOERER)).toEqual({ ok: true })
        expect(world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000102')).toEqual({ ok: true })
      } else {
        world.internals.reservations.length = 0 // the seed's reservations (Ben, Paula) gone too
      }
      const answers = [
        world.setWishReceived(anna.id, KOPFHOERER, true),
        world.moveWish(anna.id, KOPFHOERER, HOUSEWARMING_LIST),
        world.moveWish(anna.id, DEMO_LIST_RESERVED_WISH, DEMO_LISTS.annaPrivate),
        world.moveWish(anna.id, DEMO_RESERVED_WISH_ID, DEMO_LISTS.annaBirthday),
      ]
      const text = JSON.stringify({
        answers,
        overview: api.getListsOverview(anna.id),
        lists: [DEMO_LISTS.annaWishes, DEMO_LISTS.annaPrivate, DEMO_LISTS.annaBirthday].map((id) => api.getListScreen(anna.id, id)),
        occasion: world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming),
        export: world.exportFor(anna.id),
        rest: world.wishRows(anna.id),
      })
      // the demo clock ticks 1 ms per write: compare the facts, not the milliseconds
      return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'T')
    }
    expect(view(true)).toBe(view(false))
  })
})
