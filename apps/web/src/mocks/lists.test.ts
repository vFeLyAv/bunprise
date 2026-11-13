import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { createListsApi, DEMO_LIST_PEOPLE, DEMO_LIST_RESERVED_WISH, DEMO_LISTS, seedListsDemo } from './lists'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// The demo world of wave 2b mirrors the SQL of follows-design M1–M3 (W10): the invariants INV-1…INV-3 as
// TypeScript, the same error codes. Fictional people only (fixtures.ts + DEMO_LIST_PEOPLE).

const NOW = Date.parse('2026-10-20T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const { anna, ben, clara } = DEMO_PEOPLE
const { paula, finn } = DEMO_LIST_PEOPLE

function person(id: string, name: string | null = 'Mila', consents = true): DemoPerson {
  return { id, displayName: () => name, hasConsents: () => consents }
}

function setup({ meConsents = true, meName = 'Mila Sommer' }: { meConsents?: boolean; meName?: string | null } = {}) {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  seedListsDemo(world, ME, NOW)
  world.addPerson(person(ME, meName, meConsents))
  // a finished demo profile joins "Annas Einweihung" once (handlers.ts enrollWhenComplete)
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
  throw new Error('expected a database error')
}

type Overview = {
  me: { banner: string | null; live_links: number }
  stats: Record<string, number>
  my_lists: { id: string; kind: string; visibility: string }[]
  following: { profile: { id: string; display_name: string }; mutual: boolean; lists: { id: string; title: string; wish_count: number; new_wish_count: number }[] }[]
  upcoming: { kind: string; date: string; list: { id: string; occasion_id: string | null } }[]
  suggestions: { profile: { id: string }; shared_occasion_title: string }[]
}
type ScreenWish = { id: string; reserved: boolean | null; reserved_by_me: boolean | null; received_at?: string | null }
type Screen = { viewer: { role: string }; list: { visibility: string; photo?: unknown }; wishes: ScreenWish[]; received: ScreenWish[] }

const overview = (api: ReturnType<typeof setup>['api'], who: string) => api.getListsOverview(who) as unknown as Overview
const screen = (api: ReturnType<typeof setup>['api'], who: string, listId: string) => api.getListScreen(who, listId) as unknown as Screen

/** INV-1: no active reservation whose reserver cannot read the list any more. */
function expectInv1(world: ReturnType<typeof setup>['world']) {
  for (const r of world.internals.reservations) {
    if (r.status === 'active') expect(world.internals.canReadWishlist(r.wishlist_id, r.reserver_id), `reservation ${r.id}`).toBe(true)
  }
}

describe('demo lists tab: get_lists_overview', () => {
  it('shows the seeded circle of the demo account — counters, follow directions, "Bald", suggestions', () => {
    const { api } = setup()
    const view = overview(api, ME)
    expect(view.stats).toEqual({ my_wishes: 0, my_lists: 0, friends_lists: 6, followers: 3, following: 3, requests: 2 })
    expect(view.my_lists).toEqual([])
    expect(view.following.map((entry) => [entry.profile.display_name, entry.mutual, entry.lists.map((list) => list.title)])).toEqual([
      ['Anna Beispiel', true, ['Geburtstag', 'Annas Wünsche']],
      ['Ben Mustermann', false, ['Brettspiele']],
      ['Paula Brandt', true, ['Weihnachten', 'Bücher']],
    ])
    expect(view.following[0]?.lists.map((list) => [list.wish_count, list.new_wish_count])).toEqual([[4, 2], [6, 2]])
    expect(view.upcoming.map((entry) => [entry.kind, entry.list.occasion_id])).toEqual([
      ['occasion', DEMO_OCCASIONS.housewarming],
      ['standalone', null],
    ])
    expect(view.suggestions).toEqual([{ profile: { id: clara.id, display_name: 'Clara Test', photo: null, banner_photo: null }, shared_occasion_title: 'Annas Einweihung' }])
  })

  it('carries no reservation key and no hidden list of anyone — for every viewer', () => {
    const { world, api } = setup()
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303')
    for (const who of [ME, anna.id, paula.id, ben.id, clara.id]) {
      const text = JSON.stringify(api.getListsOverview(who))
      expect(text, who).not.toMatch(/reserv/i)
      // Anna's "Nur ich" list exists only in Anna's own overview
      expect(text.includes(DEMO_LISTS.annaPrivate), who).toBe(who === anna.id)
    }
  })

  it("never shows anyone else's followers: Anna's circle stays Anna's", () => {
    const { api } = setup()
    const text = JSON.stringify(api.getListsOverview(ME))
    // Paula follows Anna too — nothing in my answer says so (INV-4: only people I am related to)
    expect(overview(api, ME).following.find((entry) => entry.profile.id === anna.id)).not.toHaveProperty('followers')
    expect(text).not.toContain(DEMO_LIST_PEOPLE.rosa.id)
    expect(text).not.toContain(finn.id)
  })
})

describe('demo list screen: get_list_screen', () => {
  it('owner branch: literal nulls; follower branch: taken / taken by me, never who', () => {
    const { world, api } = setup()
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303')
    const own = screen(api, anna.id, DEMO_LISTS.annaWishes)
    expect(own.viewer.role).toBe('owner')
    expect(own.wishes.every((wish) => wish.reserved === null && wish.reserved_by_me === null)).toBe(true)
    const mine = screen(api, ME, DEMO_LISTS.annaWishes)
    expect(mine.viewer.role).toBe('follower')
    expect(mine.wishes.filter((wish) => wish.reserved).map((wish) => [wish.id, wish.reserved_by_me])).toEqual(
      expect.arrayContaining([[DEMO_LIST_RESERVED_WISH, false], ['d1e0d000-0000-4000-8000-000000000303', true]]),
    )
    expect(JSON.stringify(mine)).not.toContain(paula.id)
  })

  it('every refusal is the same not_found: "Nur ich", not followed, waiting, an occasion list, unknown', () => {
    const { api } = setup()
    expect(code(() => api.getListScreen(ME, DEMO_LISTS.annaPrivate))).toBe('not_found')
    expect(code(() => api.getListScreen(clara.id, DEMO_LISTS.annaWishes))).toBe('not_found')
    expect(code(() => api.getListScreen(finn.id, DEMO_LISTS.annaWishes))).toBe('not_found')
    expect(code(() => api.getListScreen(ME, 'd1e0c000-0000-4000-8000-000000000001'))).toBe('not_found') // Annas Einweihung's list
    expect(code(() => api.getListScreen(ME, '00000000-0000-4000-8000-00000000ffff'))).toBe('not_found')
    expect(code(() => api.getListScreen(ME, null))).toBe('not_found')
  })

  it("the owner's bytes never change with the givers' actions (INV-2)", () => {
    const { world, api } = setup()
    const before = JSON.stringify([api.getListsOverview(anna.id), api.getListScreen(anna.id, DEMO_LISTS.annaWishes), api.getListScreen(anna.id, DEMO_LISTS.annaBirthday)])
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303')
    world.reserveWish(paula.id, 'd1e0d000-0000-4000-8000-000000000311')
    world.cancelReservation(ME, 'd1e0d000-0000-4000-8000-000000000303')
    expect(code(() => world.reserveWish(ME, DEMO_LIST_RESERVED_WISH))).toBe('already_reserved')
    const after = JSON.stringify([api.getListsOverview(anna.id), api.getListScreen(anna.id, DEMO_LISTS.annaWishes), api.getListScreen(anna.id, DEMO_LISTS.annaBirthday)])
    expect(after).toBe(before)
  })
})

describe('demo reserve_wish / cancel_reservation: the follower path (M3)', () => {
  it('the same not_allowed for the owner, a waiting requester, a stranger and a "Nur ich" list', () => {
    const { world } = setup()
    const wish = 'd1e0d000-0000-4000-8000-000000000303'
    expect(code(() => world.reserveWish(anna.id, wish))).toBe('not_allowed')
    expect(code(() => world.reserveWish(finn.id, wish))).toBe('not_allowed') // finn only asked to follow ME
    expect(code(() => world.reserveWish(clara.id, wish))).toBe('not_allowed')
    expect(code(() => world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000321'))).toBe('not_allowed') // Anna's private list
    expect(code(() => world.reserveWish(ME, 'd1e0d000-0000-4000-8000-00000000ffff'))).toBe('not_found')
    expect(world.reserveWish(ME, wish)).toEqual({ ok: true })
    expect(world.reserveWish(ME, wish)).toEqual({ ok: true }) // the same person again
    expect(code(() => world.cancelReservation(ME, DEMO_LIST_RESERVED_WISH))).toBe('not_found') // Paula's, not mine
    expect(code(() => world.cancelReservation(anna.id, wish))).toBe('not_allowed')
    expect(world.cancelReservation(ME, wish)).toEqual({ ok: true })
    expect(code(() => world.cancelReservation(ME, wish))).toBe('not_found')
    expectInv1(world)
  })

  it('at most 5 active reservations of one giver for one person — the 6th is limit_reached, occasions do not count', () => {
    const { world } = setup()
    // (not 305: since 20261027200000 that wish is also in Anna's occasion, where I am a guest — it does not count)
    const anna5 = ['301', '303', '304', '314', '311'].map((n) => `d1e0d000-0000-4000-8000-000000000${n}`)
    for (const wish of anna5) expect(world.reserveWish(ME, wish)).toEqual({ ok: true })
    expect(world.reserveWish(ME, anna5[0] ?? '')).toEqual({ ok: true }) // pressing an own one again is fine
    expect(code(() => world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000312'))).toBe('limit_reached')
    // the cap is checked before "taken": a 6th on a taken wish still says limit_reached (SQL step 3b)
    expect(code(() => world.reserveWish(ME, DEMO_LIST_RESERVED_WISH))).toBe('limit_reached')
    // reservations in an occasion of Anna's do not count and are not capped
    expect(world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000103')).toEqual({ ok: true })
    world.cancelReservation(ME, anna5[1] ?? '')
    expect(world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000312')).toEqual({ ok: true })
    // Paula's own answers are untouched by my cap
    expect(world.reserveWish(paula.id, 'd1e0d000-0000-4000-8000-000000000313')).toEqual({ ok: true })
    expectInv1(world)
  })
})

describe('demo INV-1: no access, no reservation', () => {
  it('"Nur ich" ends the followers\' reservations (access_ended); sharing again brings nothing back', () => {
    const { world, api } = setup()
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303')
    expect(api.setListVisibility(anna.id, DEMO_LISTS.annaWishes, 'private')).toEqual({ ok: true })
    expectInv1(world)
    expect(code(() => api.getListScreen(ME, DEMO_LISTS.annaWishes))).toBe('not_found')
    const ended = world.myReservations(ME).find((r) => r.wish_title.startsWith('Gutschein'))
    expect(ended).toMatchObject({ status: 'ended', end_reason: 'unavailable', list: null }) // Q1: one neutral reason
    expect(api.setListVisibility(anna.id, DEMO_LISTS.annaWishes, 'followers')).toEqual({ ok: true })
    expect(screen(api, ME, DEMO_LISTS.annaWishes).wishes.find((wish) => wish.id === 'd1e0d000-0000-4000-8000-000000000303')).toMatchObject({ reserved: false })
  })

  it('unfollowing ends the giver\'s reservations as unfollowed; deleting the list as wish_deleted', () => {
    const { world, api } = setup()
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303')
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000331')
    expect(api.unfollow(ME, anna.id)).toEqual({ ok: true })
    expect(api.unfollow(ME, anna.id)).toEqual({ ok: true }) // idempotent
    expectInv1(world)
    expect(world.myReservations(ME).map((r) => [r.wish_title.split(' ')[0], r.status, r.end_reason])).toEqual(
      expect.arrayContaining([['Gutschein', 'ended', 'unfollowed'], ['Wollschal', 'active', null]]),
    )
    world.deleteWishlists(paula.id, [...world.internals.wishlists.values()].filter((list) => list.id === DEMO_LISTS.paulaChristmas), true)
    expect(world.myReservations(ME).find((r) => r.wish_title.startsWith('Wollschal'))).toMatchObject({ status: 'ended', end_reason: 'unavailable' })
    expectInv1(world)
  })

  it('the red button closes reading and reserving for every follower at once', () => {
    const { world, api } = setup()
    world.features.followerLists = false
    expect(code(() => api.getListScreen(ME, DEMO_LISTS.annaWishes))).toBe('not_found')
    expect(code(() => world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303'))).toBe('not_allowed')
    expect(overview(api, ME).following.every((entry) => entry.lists.length === 0)).toBe(true)
    // the owners see their own lists exactly as before (one of Anna's six wishes is in the received part)
    expect(screen(api, anna.id, DEMO_LISTS.annaWishes).wishes).toHaveLength(5)
    expect(screen(api, anna.id, DEMO_LISTS.annaWishes).received).toHaveLength(1)
  })
})

describe('demo set_list_visibility', () => {
  it('only the own list without an occasion; validation; widening needs current consents, narrowing never', () => {
    const { api } = setup()
    expect(code(() => api.setListVisibility(ME, DEMO_LISTS.annaWishes, 'private'))).toBe('not_found')
    expect(code(() => api.setListVisibility(anna.id, 'd1e0c000-0000-4000-8000-000000000001', 'private'))).toBe('not_found')
    expect(code(() => api.setListVisibility(anna.id, '00000000-0000-4000-8000-00000000ffff', 'private'))).toBe('not_found')
    expect(code(() => api.setListVisibility(anna.id, DEMO_LISTS.annaWishes, 'everyone'))).toBe('validation')
    expect(code(() => api.setListVisibility(anna.id, DEMO_LISTS.annaWishes, null))).toBe('validation')
    // an account whose consents are outdated (e.g. after a new text version) keeps its old list
    const { world, api: outdated } = setup({ meConsents: false })
    const id = '0f0f0f0f-0000-4000-8000-000000000001'
    const at = new Date(NOW).toISOString()
    world.seed({ people: [], occasions: [], members: [], invites: [], reservations: [], wishes: [], wishlists: [{ id, occasion_id: null, owner_id: ME, recipient_id: ME, title: 'Alt', created_at: at, updated_at: at, visibility: 'followers' }] })
    expect(code(() => world.insertWishlists(ME, [{ title: 'Neu', owner_id: ME, recipient_id: ME, visibility: 'private' }], true))).toBe('42501')
    expect(outdated.setListVisibility(ME, id, 'private')).toEqual({ ok: true })
    expect(code(() => outdated.setListVisibility(ME, id, 'followers'))).toBe('consent_required')
    // widening also needs a name (profile_complete), like the SQL; narrowing still never
    const { world: nameless, api: noName } = setup({ meName: null })
    nameless.seed({ people: [], occasions: [], members: [], invites: [], reservations: [], wishes: [], wishlists: [{ id, occasion_id: null, owner_id: ME, recipient_id: ME, title: 'Alt', created_at: at, updated_at: at, visibility: 'private' }] })
    expect(code(() => noName.setListVisibility(ME, id, 'followers'))).toBe('profile_incomplete')
    expect(noName.setListVisibility(ME, id, 'private')).toEqual({ ok: true })
  })
})

describe('demo REST wishlists (M1/M3 grants, policy, trigger, checks)', () => {
  const NEW = (n: number) => `0e0e0e0e-0000-4000-8000-${String(n).padStart(12, '0')}`

  it('creates own lists with a client id; "returning" works; the 21st is limit_reached', () => {
    const { world, api } = setup()
    const [first] = world.insertWishlists(ME, [{ id: NEW(1), occasion_id: null, owner_id: ME, recipient_id: ME, title: 'Meine Wünsche', visibility: 'private', cover_tone: 2, cover_icon: 'star', due_on: null }], true)
    expect(first).toMatchObject({ id: NEW(1), visibility: 'private', cover_tone: 2, cover_icon: 'star' })
    expect(overview(api, ME).my_lists.map((list) => [list.id, list.kind, list.visibility])).toEqual([[NEW(1), 'standalone', 'private']])
    for (let n = 2; n <= 20; n += 1) world.insertWishlists(ME, [{ id: NEW(n), owner_id: ME, recipient_id: ME, title: `Liste ${n}`, visibility: n % 2 ? 'private' : 'followers' }], true)
    expect(code(() => world.insertWishlists(ME, [{ id: NEW(21), owner_id: ME, recipient_id: ME, title: 'Zu viel', visibility: 'private' }], true))).toBe('limit_reached')
    // someone else's id as owner: the policy refuses, the limit trigger never counts for others (no oracle)
    expect(code(() => world.insertWishlists(anna.id, [{ id: NEW(22), owner_id: ME, recipient_id: ME, title: 'Fremd', visibility: 'private' }], true))).toBe('42501')
  })

  it('never a follower list without the explicit choice; the checks of M1', () => {
    const { world } = setup()
    // no visibility = the column default 'occasion' → refused for a list without an occasion
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'Ohne Wahl' }], true))).toBe('42501')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'X', visibility: 'occasion' }], true))).toBe('42501')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: anna.id, title: 'Für Anna', visibility: 'private' }], true))).toBe('42501')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'X', visibility: 'private', cover_tone: 5 }], true))).toBe('23514')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'X', visibility: 'private', cover_icon: 'rocket' }], true))).toBe('23514')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'X', visibility: 'private', due_on: '2019-12-31' }], true))).toBe('23514')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'X', visibility: 'private', due_on: '2026-02-30' }], true))).toBe('22007')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'x'.repeat(81), visibility: 'private' }], true))).toBe('23514')
    expect(code(() => world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'X', visibility: 'private', created_at: '2026-01-01T00:00:00Z' }], true))).toBe('42501')
  })

  it('updates title / cover / date only; never the visibility; others change nothing; delete cascades', () => {
    const { world } = setup()
    const annaLists = () => [...world.internals.wishlists.values()].filter((list) => list.owner_id === anna.id)
    expect(code(() => world.updateWishlists(anna.id, annaLists(), { visibility: 'private' }, false))).toBe('42501')
    expect(code(() => world.updateWishlists(anna.id, annaLists(), { owner_id: ME }, false))).toBe('42501')
    expect(world.updateWishlists(ME, annaLists(), { title: 'Gekapert' }, false)).toEqual([])
    const target = annaLists().filter((list) => list.id === DEMO_LISTS.annaWishes)
    expect(world.updateWishlists(anna.id, target, { title: 'Wunschzettel', cover_tone: 3, cover_icon: 'gift', due_on: '2027-01-15' }, true)[0])
      .toMatchObject({ title: 'Wunschzettel', cover_tone: 3, cover_icon: 'gift', due_on: '2027-01-15', visibility: 'followers' })
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303')
    expect(world.deleteWishlists(ME, target, false)).toEqual([]) // not mine: nothing
    expect(world.deleteWishlists(anna.id, target, true)).toHaveLength(1)
    expect([...world.internals.wishes.values()].some((wish) => wish.wishlist_id === DEMO_LISTS.annaWishes)).toBe(false)
    expect(world.myReservations(ME).find((r) => r.wish_title.startsWith('Gutschein'))).toMatchObject({ status: 'ended', end_reason: 'unavailable' })
    expectInv1(world)
  })
})

describe('demo follows: request_follow, the cloak (INV-3) and the silence (INV-3b)', () => {
  it('request_follow only with a shared occasion or when they follow me; one not_found for the rest', () => {
    const { api } = setup()
    expect(api.requestFollow(ME, anna.id)).toEqual({ status: 'following' }) // already accepted
    expect(api.requestFollow(ME, clara.id)).toEqual({ status: 'requested' }) // shared "Annas Einweihung"
    expect(api.requestFollow(ME, clara.id)).toEqual({ status: 'requested' }) // the same again
    expect(api.requestFollow(ME, DEMO_LIST_PEOPLE.rosa.id)).toEqual({ status: 'requested' }) // Rosa follows me
    expect(code(() => api.requestFollow(ME, DEMO_LIST_PEOPLE.greta.id))).toBe('not_found') // only she asked me
    expect(code(() => api.requestFollow(ME, ME))).toBe('not_found')
    expect(code(() => api.requestFollow(ME, null))).toBe('not_found')
    expect(code(() => api.requestFollow(ME, '00000000-0000-4000-8000-00000000ffff'))).toBe('not_found')
    const { api: noConsents } = setup({ meConsents: false })
    expect(code(() => noConsents.requestFollow(ME, clara.id))).toBe('consent_required')
  })

  it('a caller with a live outgoing row gets its state back, even without a shared occasion (also after a silence)', () => {
    const { world, api } = setup()
    // Finn asked me (e.g. through a follow link) and shares no occasion with me
    expect(api.requestFollow(finn.id, ME)).toEqual({ status: 'requested' })
    world.follows.silence(ME, finn.id) // I decline: his answer stays the same (INV-3)
    expect(api.requestFollow(finn.id, ME)).toEqual({ status: 'requested' })
    world.follows.removeFollow(finn.id, ME) // his request is gone: back to the one not_found
    expect(code(() => api.requestFollow(finn.id, ME))).toBe('not_found')
  })

  it("a silently declined request looks exactly like a waiting one to the person who asked (INV-3)", () => {
    const { world, api } = setup()
    expect(api.requestFollow(clara.id, ME)).toEqual({ status: 'requested' })
    const waiting = JSON.stringify(api.getListsOverview(clara.id))
    world.follows.silence(ME, clara.id) // ME declines: a silence, the request row stays
    expect(JSON.stringify(api.getListsOverview(clara.id))).toBe(waiting)
    expect(api.requestFollow(clara.id, ME)).toEqual({ status: 'requested' })
    expect(JSON.stringify(api.getListsOverview(clara.id))).toBe(waiting)
  })

  it("the silence is real: the hidden person's actions never change my answer (INV-3b)", () => {
    const { world, api } = setup()
    api.requestFollow(clara.id, ME)
    expect(overview(api, ME).stats.requests).toBe(3)
    world.follows.silence(ME, clara.id)
    const silenced = JSON.stringify(api.getListsOverview(ME))
    expect(overview(api, ME).stats.requests).toBe(2)
    expect(overview(api, ME).suggestions).toEqual([]) // in MY silence: no suggestion either
    api.unfollow(clara.id, ME) // she withdraws …
    expect(JSON.stringify(api.getListsOverview(ME))).toBe(silenced)
    api.requestFollow(clara.id, ME) // … and asks again
    expect(JSON.stringify(api.getListsOverview(ME))).toBe(silenced)
  })

  it('suggestions only for people who switched them on, without a visible relation', () => {
    const { world, api } = setup()
    world.setProfileSettings(clara.id, { in_suggestions: false })
    expect(overview(api, ME).suggestions).toEqual([])
    world.setProfileSettings(clara.id, { in_suggestions: true })
    api.requestFollow(ME, clara.id) // my own request is a relation I see
    expect(overview(api, ME).suggestions).toEqual([])
  })

  it('a suggestion names the first shared occasion: upcoming ones by start, then past ones latest first', () => {
    const { world, api } = setup()
    const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString()
    const past = (id: string, title: string, startDays: number) => ({
      id, host_id: ben.id, title, starts_at: at(startDays), ends_at: at(startDays + 1), tz: 'Europe/Berlin', all_day: false,
      place_text: null, description: null, cancelled_at: null, created_at: at(-40), updated_at: at(-40),
    })
    const member = (occasionId: string, profileId: string, role: 'host' | 'member') =>
      ({ occasion_id: occasionId, profile_id: profileId, role, rsvp: 'going' as const, status: 'active' as const, invited_via: null, joined_at: at(-40), updated_at: at(-40) })
    const summer = '0d0d0d0d-0000-4000-8000-000000000001'
    const autumn = '0d0d0d0d-0000-4000-8000-000000000002'
    world.seed({
      people: [], invites: [], reservations: [], wishes: [], wishlists: [],
      occasions: [past(summer, 'Sommerfest', -12), past(autumn, 'Herbstmarkt', -5)],
      members: [summer, autumn].flatMap((id) => [member(id, ben.id, 'host'), member(id, ME, 'member'), member(id, clara.id, 'member')]),
    })
    // "Annas Einweihung" (in 3 days) wins over both past ones, although it starts last
    expect(overview(api, ME).suggestions).toEqual([{ profile: { id: clara.id, display_name: 'Clara Test', photo: null, banner_photo: null }, shared_occasion_title: 'Annas Einweihung' }])
    const housewarming = world.internals.members.find((row) => row.occasion_id === DEMO_OCCASIONS.housewarming && row.profile_id === ME)
    if (housewarming) housewarming.status = 'left'
    // only past ones left: the latest one
    expect(overview(api, ME).suggestions.map((entry) => entry.shared_occasion_title)).toEqual(['Herbstmarkt'])
  })
})

describe('demo account deletion (wave 2b cascades)', () => {
  it("a deleted owner takes their lists, wishes and follows along; a giver's reservations vanish", () => {
    const { world, api } = setup()
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303')
    world.deletePerson(anna.id)
    expect([...world.internals.wishlists.values()].some((list) => list.owner_id === anna.id)).toBe(false)
    expect(world.follows.tables.follows.some((row) => row.follower_id === anna.id || row.followee_id === anna.id)).toBe(false)
    expect(overview(api, ME).following.map((entry) => entry.profile.display_name)).toEqual(['Ben Mustermann', 'Paula Brandt'])
    expect(world.myReservations(ME)).toEqual([])
    expectInv1(world)
  })
})

describe('the demo profile banner', () => {
  it('lives in the profile settings and reaches others only through the RPCs', () => {
    const { world, api } = setup()
    expect(overview(api, ME).me.banner).toBeNull()
    world.setProfileSettings(ME, { banner: 'meadow' })
    expect(overview(api, ME).me.banner).toBe('meadow')
    expect((api.getListScreen(ME, DEMO_LISTS.annaWishes) as unknown as { list: { owner: { banner: string } } }).list.owner.banner).toBe('meadow')
    expect(overview(api, ME).following.find((entry) => entry.profile.id === paula.id)?.profile).toMatchObject({ banner: 'confetti' })
    expect(world.profileRows(ME).every((row) => !('banner' in row))).toBe(true)
  })
})
