import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { createListsApi, DEMO_HOUSEWARMING_LIST, DEMO_LIST_RECEIVED_WISH, DEMO_LISTS, DEMO_SHARED_WISHES, seedListsDemo } from './lists'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// ONE WISH IN SEVERAL LISTS in the demo world (supabase/migrations/20261027200000_shared_wishes.sql): places, the one
// shared reservation state, liveness ("Nicht mehr verfügbar"), the owner's four RPCs, the old app's delete guard,
// "Ideen" with every place, the reminder after an occasion — and the owner never sees anything about reservations.
// Cast: Anna's "Annas Wünsche" (followers: ME + Paula), her occasion "Annas Einweihung" (guests: Ben, Clara, ME), her
// "Nur für mich" list. The seed put her plant stand ("Annas Wünsche") and her diary ("Nur für mich") into the occasion
// as well. Fictional people only.

const NOW = Date.parse('2026-10-22T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const KOPFHOERER = 'd1e0d000-0000-4000-8000-000000000301'
const { plantStand, diary } = DEMO_SHARED_WISHES
const { anna, ben } = DEMO_PEOPLE

function setup(clock: () => number = () => NOW) {
  const world = createDemoWorld(clock)
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

type Place = { id: string | null; title: string | null; kind: string; home?: boolean; paused?: boolean }
type W = { id: string; reserved: boolean | null; reserved_by_me: boolean | null; home?: boolean; paused?: boolean; also_in?: Place[] | null }
type World = ReturnType<typeof setup>['world']
type Api = ReturnType<typeof setup>['api']
const occasionWishes = (world: World, who: string) => (world.getOccasionScreen(who, DEMO_OCCASIONS.housewarming).wishlist?.wishes ?? []) as unknown as W[]
const listWishes = (api: Api, who: string, id: string) => (api.getListScreen(who, id) as unknown as { wishes: W[] }).wishes
const find = (wishes: readonly W[], id: string) => wishes.find((wish) => wish.id === id)

/** everything Anna (the owner) can read about her own world, as text */
function annaView(world: World, api: Api): string {
  return JSON.stringify([
    world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming), api.getListScreen(anna.id, DEMO_LISTS.annaWishes),
    api.getListScreen(anna.id, DEMO_LISTS.annaPrivate), api.getListsOverview(anna.id), world.getFeed(anna.id),
    world.myReservations(anna.id), world.wishRows(anna.id),
  ])
}

describe('demo shared wishes: what everybody sees', () => {
  it('a guest sees the wish in the occasion with a hint — by name only when they can read that list', () => {
    const { world, api } = setup()
    const mine = occasionWishes(world, ME)
    expect(find(mine, plantStand)?.also_in).toEqual([{ id: DEMO_LISTS.annaWishes, title: 'Annas Wünsche', kind: 'standalone' }])
    expect(find(mine, diary)?.also_in).toEqual([{ id: null, title: null, kind: 'hidden' }]) // "Nur für mich": never its name
    // Ben does not follow Anna: both are "auch in einer anderen Liste"
    expect(find(occasionWishes(world, ben.id), plantStand)?.also_in).toEqual([{ id: null, title: null, kind: 'hidden' }])
    // followers get no hints at all (Q18)
    expect(find(listWishes(api, ME, DEMO_LISTS.annaWishes), plantStand)?.also_in).toBeNull()
  })

  it('the owner sees every place (home, paused) on both screens; her counts are by places', () => {
    const { world, api } = setup()
    expect(find(occasionWishes(world, anna.id), plantStand)).toMatchObject({
      home: false, paused: false, reserved: null, reserved_by_me: null,
      also_in: [{ id: DEMO_LISTS.annaWishes, title: 'Annas Wünsche', kind: 'standalone', home: true, paused: false }],
    })
    expect(find(listWishes(api, anna.id, DEMO_LISTS.annaPrivate), diary)).toMatchObject({
      home: true, also_in: [{ id: DEMO_HOUSEWARMING_LIST, title: 'Annas Einweihung', kind: 'occasion', home: false }],
    })
    const feed = world.getFeed(anna.id).upcoming.find((row) => row.id === DEMO_OCCASIONS.housewarming)
    expect(feed?.wish_count).toBe(occasionWishes(world, anna.id).length + (world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming).wishlist?.received?.length ?? 0))
  })

  it('ONE reservation for every place: reserved in the occasion = taken on the follower list too', () => {
    const { world, api } = setup()
    expect(world.reserveWish(ben.id, plantStand)).toEqual({ ok: true })
    expect(find(listWishes(api, ME, DEMO_LISTS.annaWishes), plantStand)).toMatchObject({ reserved: true, reserved_by_me: false })
    expect(find(occasionWishes(world, ME), plantStand)).toMatchObject({ reserved: true, reserved_by_me: false })
    expect(code(() => world.reserveWish(ME, plantStand))).toBe('already_reserved')
    // "Ideen" for Anna: the taken wish is not offered in either place
    const free = api.getFreeWishes(ME, anna.id, null) as unknown as { ideas: { wish_id: string }[] }
    expect(free.ideas.map((idea) => idea.wish_id)).not.toContain(plantStand)
  })

  it('the owner never sees a reservation — not before, not after, not on any new path', () => {
    const { world, api } = setup()
    const before = annaView(world, api)
    world.reserveWish(ben.id, plantStand)
    world.reserveWish(ME, KOPFHOERER)
    expect(annaView(world, api)).toBe(before)
    // her own writes answer the same with or without reservations
    expect(world.addWishesToList(anna.id, DEMO_HOUSEWARMING_LIST, JSON.stringify([KOPFHOERER]))).toEqual({ ok: true, added: 1 })
    expect(world.removeWishFromList(anna.id, plantStand, DEMO_HOUSEWARMING_LIST)).toEqual({ ok: true })
  })
})

describe('demo shared wishes: the owner\'s RPCs', () => {
  it('add_wishes_to_list: one call, "Schon drin" is nothing to do; the rules of the database', () => {
    const { world } = setup()
    expect(world.addWishesToList(anna.id, DEMO_HOUSEWARMING_LIST, JSON.stringify([KOPFHOERER, plantStand]))).toEqual({ ok: true, added: 1 })
    expect(world.addWishesToList(anna.id, DEMO_HOUSEWARMING_LIST, JSON.stringify([KOPFHOERER]))).toEqual({ ok: true, added: 0 })
    expect(find(occasionWishes(world, ME), KOPFHOERER)).toBeDefined()
    expect(code(() => world.addWishesToList(ME, DEMO_HOUSEWARMING_LIST, JSON.stringify([KOPFHOERER])))).toBe('not_found') // not my list
    expect(code(() => world.addWishesToList(anna.id, DEMO_LISTS.annaPrivate, JSON.stringify([KOPFHOERER])))).toBe('not_found') // no occasion
    expect(code(() => world.addWishesToList(anna.id, DEMO_HOUSEWARMING_LIST, JSON.stringify([DEMO_LIST_RECEIVED_WISH])))).toBe('validation') // received
    expect(code(() => world.addWishesToList(anna.id, DEMO_HOUSEWARMING_LIST, '[]'))).toBe('validation')
    world.features.sharedWishes = false
    expect(code(() => world.addWishesToList(anna.id, DEMO_HOUSEWARMING_LIST, JSON.stringify([KOPFHOERER])))).toBe('not_allowed')
  })

  it('remove_wish_from_list: the home moves on; the last place stays; a giver who loses access sees "Nicht mehr verfügbar"', () => {
    const { world, api } = setup()
    world.reserveWish(ben.id, plantStand) // Ben reads it only through the occasion
    expect(world.removeWishFromList(anna.id, plantStand, DEMO_HOUSEWARMING_LIST)).toEqual({ ok: true })
    expect(find(occasionWishes(world, ben.id), plantStand)).toBeUndefined()
    expect(world.myReservations(ben.id).find((r) => r.wish_title.startsWith('Pflanzenständer'))).toMatchObject({ status: 'ended', end_reason: 'unavailable', wish_id: null, occasion_id: null, list: null })
    // free again for the followers (Ben's row is dead)
    expect(find(listWishes(api, ME, DEMO_LISTS.annaWishes), plantStand)).toMatchObject({ reserved: false })
    expect(code(() => world.removeWishFromList(anna.id, plantStand, DEMO_LISTS.annaWishes))).toBe('validation') // its only list
    // the diary: removing it from its home moves the home into the occasion
    expect(world.removeWishFromList(anna.id, diary, DEMO_LISTS.annaPrivate)).toEqual({ ok: true })
    expect(find(occasionWishes(world, anna.id), diary)).toMatchObject({ home: true, also_in: [] })
  })

  it('an older app cannot delete or move a shared wish; "Überall löschen" can', () => {
    const { world } = setup()
    const row = world.wishRows(anna.id).filter((wish) => wish.id === plantStand)
    expect(code(() => world.deleteWishes(anna.id, row, true))).toBe('not_allowed')
    expect(code(() => world.moveWish(anna.id, plantStand, DEMO_LISTS.annaBirthday))).toBe('validation')
    expect(world.deleteWishEverywhere(anna.id, plantStand)).toEqual({ ok: true })
    expect(world.wishRows(anna.id).some((wish) => wish.id === plantStand)).toBe(false)
    expect(code(() => world.deleteWishEverywhere(ME, diary))).toBe('not_found')
  })

  it('deleting a list keeps a wish that lives elsewhere: its home moves', () => {
    const { world } = setup()
    const list = [...world.internals.wishlists.values()].filter((entry) => entry.id === DEMO_LISTS.annaPrivate)
    world.deleteWishlists(anna.id, list, true)
    expect(find(occasionWishes(world, anna.id), diary)).toMatchObject({ home: true })
    expect(world.internals.wishes.has('d1e0d000-0000-4000-8000-000000000321')).toBe(false) // the unshared one went
  })
})

describe('demo shared wishes: "Ideen" and the reminder', () => {
  it('get_free_wishes: one entry per wish with every place the viewer reads; `list` is the first by date', () => {
    const { api } = setup()
    const free = api.getFreeWishes(ME, anna.id, null) as unknown as { ideas: { wish_id: string; list: { id: string }; lists: { id: string }[] }[] }
    const plant = free.ideas.filter((idea) => idea.wish_id === plantStand)
    expect(plant).toHaveLength(1)
    expect(plant[0]?.lists.map((place) => place.id)).toEqual([DEMO_HOUSEWARMING_LIST, DEMO_LISTS.annaWishes])
    expect(plant[0]?.list.id).toBe(DEMO_HOUSEWARMING_LIST)
    // the diary: only its occasion place is readable for me
    expect(free.ideas.find((idea) => idea.wish_id === diary)?.lists.map((place) => place.id)).toEqual([DEMO_HOUSEWARMING_LIST])
  })

  it('"Was hast du bekommen?": the owner only, day 1..7 after the end, until dismissed', () => {
    let now = NOW
    const { world } = setup(() => now)
    const prompt = (who: string) => (world.getOccasionScreen(who, DEMO_OCCASIONS.housewarming).wishlist as { received_prompt?: boolean } | null)?.received_prompt
    expect(prompt(anna.id)).toBe(false)
    now = NOW + 6 * 86_400_000 // the occasion is on day 3, 18:00: two days after it
    expect(prompt(anna.id)).toBe(true)
    expect(prompt(ME)).toBeUndefined() // guests never get the key
    expect(code(() => world.dismissReceivedPrompt(ME, DEMO_OCCASIONS.housewarming))).toBe('not_found')
    expect(world.dismissReceivedPrompt(anna.id, DEMO_OCCASIONS.housewarming)).toEqual({ ok: true })
    expect(prompt(anna.id)).toBe(false)
  })
})
