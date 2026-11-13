import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { createFollowsApi, createFollowScript, DEMO_CLARA_LIST, DEMO_FOLLOW_TOKENS, followsExportFor, seedFollowsDemo } from './follows'
import { LINK_USE_LIMIT, OPEN_REQUEST_LIMIT } from './followGraph'
import { createListsApi, DEMO_LIST_PEOPLE, DEMO_LISTS, seedListsDemo } from './lists'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// The follow ACTIONS of the demo world mirror the SQL of follows-design M2 (+ M3) (W10): approval, the silent
// decline and its 30-day silence that block / unblock never shorten, visible_request, the cloak for the asker, the
// limits (30 open requests, 5 live links, 20 new requests per link), invite_invalid for every link failure, the
// consent gate first — and the invariants INV-3 / INV-3b / INV-5 / INV-6 in TypeScript. Fictional people only.

const DAY = 86_400_000
const NOW = Date.parse('2026-10-20T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const XAVER = '00000000-0000-4000-8000-0000000000ee'
const { anna, ben, clara } = DEMO_PEOPLE
const { paula, finn, greta, rosa } = DEMO_LIST_PEOPLE

function person(id: string, name: string | null = 'Mila Sommer', consents = true): DemoPerson {
  return { id, displayName: () => name, hasConsents: () => consents }
}

function setup({ meConsents = true, meName = 'Mila Sommer' as string | null } = {}) {
  let now = NOW
  const world = createDemoWorld(() => now)
  seedDemoWorld(world, NOW)
  seedListsDemo(world, ME, NOW)
  seedFollowsDemo(world, NOW)
  world.addPerson(person(ME, meName, meConsents))
  // a finished demo profile joins "Annas Einweihung" once (handlers.ts enrollWhenComplete)
  world.addGuest(DEMO_OCCASIONS.housewarming, ME)
  const links: { owner: string; token: string }[] = []
  const api = createFollowsApi(world, { onLinkCreated: (owner, token) => links.push({ owner, token }) })
  return {
    world, api, lists: createListsApi(world), links,
    travel: (ms: number) => {
      now += ms
    },
  }
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

type Card = {
  profile: { id: string; display_name: string }
  relation: { self: boolean; i_follow: string; follows_me: string; mutual: boolean }
  can_request: boolean
  can_find_gift: boolean
  lists: { id: string; title: string }[]
  shared_occasions: { id: string; title: string }[]
}
type People = {
  requests_in: { profile: { id: string }; i_follow: string; shared_occasions: { title: string }[] }[]
  requests_out: { profile: { id: string } }[]
  followers: { profile: { id: string }; i_follow: string }[]
  following: { profile: { id: string }; follows_me: string }[]
  blocked: { profile_id: string; display_name: string }[]
  links: { expires_at: string }[]
}

const card = (api: ReturnType<typeof setup>['api'], who: string, target: string) => api.getProfileCard(who, target) as unknown as Card
const people = (api: ReturnType<typeof setup>['api'], who: string) => api.getPeopleScreen(who) as unknown as People
const ids = (rows: { profile: { id: string } }[]) => rows.map((row) => row.profile.id)

/** INV-5: inside a blocked pair there is not a single follows row, accepted or pending. */
function expectInv5(world: ReturnType<typeof setup>['world']) {
  for (const row of world.follows.tables.follows) {
    expect(world.follows.isBlockedPair(row.follower_id, row.followee_id), `${row.follower_id} → ${row.followee_id}`).toBe(false)
  }
}

/** INV-1: no active reservation whose reserver cannot read the list any more. */
function expectInv1(world: ReturnType<typeof setup>['world']) {
  for (const r of world.internals.reservations) {
    if (r.status === 'active') expect(world.internals.canReadWishlist(r.wishlist_id, r.reserver_id), `reservation ${r.id}`).toBe(true)
  }
}

/** A cooldown snapshot (INV-6: rows only ever disappear by the purge or an account's cascade, until only grows). */
const cooldowns = (world: ReturnType<typeof setup>['world']) => JSON.stringify(world.follows.tables.cooldowns)

describe('demo get_profile_card: the relation through MY eyes, never anybody else\'s circle', () => {
  it('requires the accepting account\'s name, while declining still works without it', () => {
    const { api } = setup({ meName: null })
    expect(code(() => api.respondFollow(ME, finn.id, true))).toBe('profile_incomplete')
    expect(api.respondFollow(ME, finn.id, false)).toEqual({ ok: true })
  })

  it('requires a name before reserving, like the current SQL contract', () => {
    const { world } = setup({ meName: null })
    const wish = world.internals.wishesOf(DEMO_LISTS.annaWishes)[0]
    expect(wish).toBeDefined()
    expect(code(() => world.reserveWish(ME, wish?.id ?? null))).toBe('profile_incomplete')
  })

  it('shows every relation state of the seeded circle', () => {
    const { api } = setup()
    expect(card(api, ME, anna.id).relation).toEqual({ self: false, i_follow: 'following', follows_me: 'following', mutual: true })
    expect(card(api, ME, ben.id).relation).toEqual({ self: false, i_follow: 'following', follows_me: 'none', mutual: false })
    expect(card(api, ME, rosa.id).relation).toEqual({ self: false, i_follow: 'none', follows_me: 'following', mutual: false })
    expect(card(api, ME, finn.id).relation).toEqual({ self: false, i_follow: 'none', follows_me: 'requested', mutual: false })
    expect(card(api, ME, clara.id).relation).toEqual({ self: false, i_follow: 'none', follows_me: 'none', mutual: false })
    // can_request = exactly request_follow's rule for a NEW request
    expect(card(api, ME, rosa.id).can_request).toBe(true) // she follows me
    expect(card(api, ME, clara.id).can_request).toBe(true) // "Annas Einweihung"
    expect(card(api, ME, finn.id).can_request).toBe(false) // only his request: no occasion, he does not follow me (yet)
    expect(card(api, ME, anna.id).can_request).toBe(false) // already following
  })

  it('lists only while I follow; can_find_gift only with a readable list; shared occasions', () => {
    const { api } = setup()
    expect(card(api, ME, anna.id).lists.map((list) => list.title)).toEqual(['Geburtstag', 'Annas Wünsche'])
    expect(card(api, ME, anna.id).can_find_gift).toBe(true)
    // Ben does not follow me back, but shares "Brettspiele" with his followers (the demo's "Abonniert", Felix 26.10)
    expect(card(api, ME, ben.id).lists.map((list) => list.title)).toEqual(['Brettspiele'])
    expect(card(api, ME, ben.id).can_find_gift).toBe(true)
    expect(card(api, ME, rosa.id)).toMatchObject({ lists: [], can_find_gift: false })
    expect(card(api, ME, clara.id)).toMatchObject({ lists: [], can_find_gift: false }) // her list is for HER followers
    expect(card(api, ME, clara.id).shared_occasions.map((o) => o.title)).toEqual(['Annas Einweihung'])
    // a guest of Anna's occasion may look for a gift for her too (occasion lists count, like get_free_wishes)
    expect(card(api, clara.id, anna.id).can_find_gift).toBe(true)
  })

  it('one not_found for unknown, a stranger, null and a blocked pair; my own card is "self"', () => {
    const { world, api } = setup()
    world.addPerson(person(XAVER, 'Xaver Fremd'))
    for (const target of [XAVER, '00000000-0000-4000-8000-00000000ffff', null]) expect(code(() => api.getProfileCard(ME, target))).toBe('not_found')
    expect(card(api, ME, ME)).toMatchObject({ relation: { self: true, i_follow: 'none', follows_me: 'none' }, can_request: false, lists: [], shared_occasions: [] })
    api.blockUser(ME, clara.id)
    expect(code(() => api.getProfileCard(ME, clara.id))).toBe('not_found')
    expect(code(() => api.getProfileCard(clara.id, ME))).toBe('not_found')
  })

  it("never names anybody else's followers or followings (P2, INV-4)", () => {
    const { api } = setup()
    // Paula follows Anna and the other way round — my card of Anna says nothing about it
    const text = JSON.stringify(card(api, ME, anna.id))
    expect(text).not.toContain(paula.id)
    expect(text).not.toMatch(/followers|following_count|follower_count/)
    expect(JSON.stringify(people(api, finn.id))).not.toContain(rosa.id)
  })
})

describe('demo get_people_screen', () => {
  it('requests visible to me (with my context), my followers and followings, nothing hidden', () => {
    const { api } = setup()
    const screen = people(api, ME)
    expect(ids(screen.requests_in)).toEqual([greta.id, finn.id]) // newest first
    expect(screen.requests_in.every((row) => row.i_follow === 'none' && row.shared_occasions.length === 0)).toBe(true)
    expect(ids(screen.followers)).toEqual([anna.id, paula.id, rosa.id])
    expect(screen.followers.map((row) => row.i_follow)).toEqual(['following', 'following', 'none'])
    expect(ids(screen.following)).toEqual([anna.id, ben.id, paula.id])
    expect(screen.following.map((row) => row.follows_me)).toEqual(['following', 'none', 'following'])
    expect(screen).toMatchObject({ requests_out: [], blocked: [], links: [] })
  })
})

describe('demo follows: always with approval', () => {
  it('a request waits for a yes; only then the lists open; respond_follow needs a VISIBLE request', () => {
    const { api, lists } = setup()
    expect(lists.requestFollow(ME, clara.id)).toEqual({ status: 'requested' })
    expect(card(api, ME, clara.id)).toMatchObject({ relation: { i_follow: 'requested' }, lists: [] })
    expect(ids(people(api, ME).requests_out)).toEqual([clara.id])
    expect(ids(people(api, clara.id).requests_in)).toEqual([ME])
    expect(code(() => lists.getListScreen(ME, DEMO_CLARA_LIST))).toBe('not_found')
    expect(api.respondFollow(clara.id, ME, true)).toEqual({ ok: true })
    expect(card(api, ME, clara.id)).toMatchObject({ relation: { i_follow: 'following' }, lists: [{ id: DEMO_CLARA_LIST }] })
    expect(code(() => api.respondFollow(clara.id, ME, true))).toBe('not_found') // nothing to answer any more
    expect(code(() => api.respondFollow(clara.id, ME, null))).toBe('validation')
    expect(code(() => api.respondFollow(clara.id, null, true))).toBe('not_found')
  })

  it('accepting needs current consents; declining never does', () => {
    const { api } = setup({ meConsents: false })
    expect(code(() => api.respondFollow(ME, finn.id, true))).toBe('consent_required')
    expect(api.respondFollow(ME, finn.id, false)).toEqual({ ok: true })
  })
})

describe('demo silent decline: the cloak (INV-3) and a real silence (INV-3b, INV-6)', () => {
  it("the asker's whole view is the same whether I wait, declined, or the request is hidden", () => {
    const { world, api, lists } = setup()
    const finnsView = () => JSON.stringify([
      people(api, finn.id), card(api, finn.id, ME), lists.getListsOverview(finn.id), followsExportFor(world, finn.id), world.follows.iFollowState(finn.id, ME),
    ])
    const before = finnsView()
    expect(api.respondFollow(ME, finn.id, false)).toEqual({ ok: true })
    expect(finnsView()).toBe(before)
    // he asks again in the silence: the same answer as for a waiting request
    expect(lists.requestFollow(finn.id, ME)).toEqual({ status: 'requested' })
    expect(finnsView()).toBe(before)
  })

  it("my view does not change with anything the hidden person does: withdraw, ask again, expire", () => {
    const { world, api, lists, travel } = setup()
    const { token } = api.createFollowLink(ME) as { token: string } // (without a shared occasion he asks through a link)
    api.respondFollow(ME, finn.id, false)
    // his card: hidden = no relation I can see (and no shared occasion) → the one not_found, every time
    const cardOf = (target: string) => {
      try {
        return api.getProfileCard(ME, target)
      } catch (error) {
        if (error instanceof DemoDbError) return error.message
        throw error
      }
    }
    const myView = () => JSON.stringify([people(api, ME), lists.getListsOverview(ME), cardOf(finn.id), world.follows.visibleRequestsTo(ME).length])
    const silenced = myView()
    expect(ids(people(api, ME).requests_in)).toEqual([greta.id])
    expect(code(() => api.respondFollow(ME, finn.id, true))).toBe('not_found') // hidden = as if there were none
    lists.unfollow(finn.id, ME) // he withdraws …
    expect(myView()).toBe(silenced)
    expect(code(() => lists.requestFollow(finn.id, ME))).toBe('not_found') // (no occasion with me, no live row)
    expect(api.requestFollowViaLink(finn.id, token)).toMatchObject({ status: 'requested' }) // … and asks again: still hidden for me
    expect(myView()).toBe(silenced)
    travel(29 * DAY) // his new request is still within MY silence
    expect(ids(people(api, ME).requests_in)).not.toContain(finn.id)
    // my own export lists what MY silence hides (Art. 15) — the only deliberate exception
    expect(followsExportFor(world, ME).follows.hidden_requests_received.map((row) => row.display_name)).toEqual(['Finn Weber'])
    expect(JSON.stringify(followsExportFor(world, finn.id))).not.toMatch(/hidden_requests_received":\[\{/)
  })

  it('block → unblock never shortens a silence: of the hidden person, nor of the one who hid (INV-6)', () => {
    const { world, api, lists, travel } = setup()
    api.respondFollow(ME, finn.id, false)
    const silence = cooldowns(world)
    // Finn blocks me and unblocks again — then asks (through a link of mine)
    api.blockUser(finn.id, ME)
    expectInv5(world)
    expect(cooldowns(world)).toBe(silence)
    api.unblockUser(finn.id, ME)
    expect(cooldowns(world)).toBe(silence)
    const { token } = api.createFollowLink(ME) as { token: string }
    expect(api.requestFollowViaLink(finn.id, token)).toMatchObject({ status: 'requested' })
    expect(ids(people(api, ME).requests_in)).not.toContain(finn.id) // still hidden until the old `until`
    // I block and unblock him: my own silence stays as well
    api.blockUser(ME, finn.id)
    api.unblockUser(ME, finn.id)
    expect(cooldowns(world)).toBe(silence)
    // `until` only grows (greatest() in both upserts): a shorter silence later never moves it back
    world.follows.silence(ME, finn.id, 5)
    expect(cooldowns(world)).toBe(silence)
    void lists
    travel(31 * DAY)
    expect(world.follows.hasFollowCooldown(ME, finn.id)).toBe(false)
  })

  it('the silence ends by itself after 30 days: a new request is visible again', () => {
    const { api, travel } = setup()
    api.respondFollow(ME, finn.id, false)
    travel(31 * DAY) // his request expired (30 days) and my silence is over
    const { token } = api.createFollowLink(ME) as { token: string }
    expect(api.requestFollowViaLink(finn.id, token)).toMatchObject({ status: 'requested' })
    expect(ids(people(api, ME).requests_in)).toContain(finn.id)
  })
})

describe('demo block_user / unblock_user (INV-5)', () => {
  it('follows end both ways (accepted and pending); the pair cannot find each other any more', () => {
    const { world, api, lists } = setup()
    expect(api.blockUser(ME, anna.id)).toEqual({ ok: true })
    expect(api.blockUser(ME, finn.id)).toEqual({ ok: true }) // his pending request goes too
    expectInv5(world)
    expect(ids(people(api, ME).following)).not.toContain(anna.id)
    expect(ids(people(api, ME).followers)).not.toContain(anna.id)
    expect(people(api, ME).blocked.map((row) => row.display_name)).toEqual(['Finn Weber', 'Anna Beispiel'])
    expect(code(() => lists.requestFollow(ME, anna.id))).toBe('not_found')
    expect(code(() => lists.requestFollow(anna.id, ME))).toBe('not_found')
    expect(code(() => api.peekFollowLink(ME, DEMO_FOLLOW_TOKENS.anna))).toBe('invite_invalid')
    expect(code(() => api.requestFollowViaLink(ME, DEMO_FOLLOW_TOKENS.anna))).toBe('invite_invalid')
    expect(code(() => lists.getListScreen(ME, DEMO_LISTS.annaWishes))).toBe('not_found')
  })

  it("ends the memberships in each other's occasions and the reservations between the two", () => {
    const { world, api } = setup()
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000303') // on Anna's follower list
    world.reserveWish(ME, 'd1e0d000-0000-4000-8000-000000000103') // in "Annas Einweihung"
    api.blockUser(ME, anna.id)
    // I was a guest of Anna's occasion: 'left' (a block reads like leaving)
    expect(world.internals.members.find((m) => m.occasion_id === DEMO_OCCASIONS.housewarming && m.profile_id === ME)?.status).toBe('left')
    // 20261027200000 (lazy liveness, Q1): the giver sees ONE neutral reason for every reservation no longer on a list they see
    expect(world.myReservations(ME).filter((r) => r.status === 'ended').map((r) => r.end_reason)).toEqual(['unavailable', 'unavailable'])
    expectInv1(world)
  })

  it("in somebody else's occasion both stay guests but do not see each other (M2 occasion_members_select)", () => {
    const { world, api } = setup()
    api.blockUser(ME, ben.id) // both are guests of Anna's "Annas Einweihung"
    const mine = world.memberRows(ME).filter((m) => m.occasion_id === DEMO_OCCASIONS.housewarming).map((m) => m.profile_id)
    expect(mine).toContain(ME)
    expect(mine).not.toContain(ben.id)
    expect(world.memberRows(ben.id).filter((m) => m.occasion_id === DEMO_OCCASIONS.housewarming).map((m) => m.profile_id)).not.toContain(ME)
    expect(world.getOccasionScreen(ME, DEMO_OCCASIONS.housewarming).members.map((m) => m.profile_id)).not.toContain(ben.id)
    expect(world.profileRows(ME).map((p) => p.id)).not.toContain(ben.id)
    // the host still sees both
    expect(world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming).members.map((m) => m.profile_id)).toEqual(expect.arrayContaining([ME, ben.id]))
  })

  it('unblocking gives nothing back; blocking an unknown profile or oneself is not_found', () => {
    const { world, api } = setup()
    api.blockUser(ME, anna.id)
    expect(api.unblockUser(ME, anna.id)).toEqual({ ok: true })
    // no follow either way, no shared occasion any more (I "left" hers): we do not even see each other's card
    expect(code(() => api.getProfileCard(ME, anna.id))).toBe('not_found')
    expect(world.follows.tables.follows.some((row) => [row.follower_id, row.followee_id].includes(anna.id) && [row.follower_id, row.followee_id].includes(ME))).toBe(false)
    expect(world.internals.members.find((m) => m.occasion_id === DEMO_OCCASIONS.housewarming && m.profile_id === ME)?.status).toBe('left')
    expect(code(() => api.blockUser(ME, ME))).toBe('not_found')
    expect(code(() => api.blockUser(ME, '00000000-0000-4000-8000-00000000ffff'))).toBe('not_found')
    expect(api.unblockUser(ME, null)).toEqual({ ok: true })
  })
})

describe('demo remove_follower', () => {
  it('ends their reservations on my lists (access_ended) and silences them — the same answer either way', () => {
    const { world, api, lists } = setup()
    const [list] = world.insertWishlists(ME, [{ owner_id: ME, recipient_id: ME, title: 'Meine Wünsche', visibility: 'followers' }], true)
    const [wish] = world.insertWishes(ME, [{ wishlist_id: list?.id, title: 'Kopfhörer' }], true)
    expect(world.reserveWish(rosa.id, wish?.id ?? null)).toEqual({ ok: true })
    expect(api.removeFollower(ME, rosa.id)).toEqual({ ok: true })
    expectInv1(world)
    expect(world.myReservations(rosa.id)[0]).toMatchObject({ status: 'ended', end_reason: 'unavailable', wish_id: null }) // Q1
    expect(code(() => api.removeFollower(ME, rosa.id))).toBe('not_found')
    expect(code(() => api.removeFollower(ME, finn.id))).toBe('not_found') // only asked
    // without a shared occasion she can only ask through a link again — and that request is hidden for 30 days
    expect(code(() => lists.requestFollow(rosa.id, ME))).toBe('not_found')
    const { token } = api.createFollowLink(ME) as { token: string }
    expect(api.requestFollowViaLink(rosa.id, token)).toMatchObject({ status: 'requested' })
    expect(ids(people(api, ME).requests_in)).not.toContain(rosa.id)
    // removing a follower without reservations answers exactly the same
    expect(api.removeFollower(ME, paula.id)).toEqual({ ok: true })
  })
})

describe('demo follow links: ≤ 5 live, ≤ 20 new requests, one invite_invalid, the consent gate first', () => {
  it('a code of 64 hex, shown once; the 6th live link switches the oldest off', () => {
    const { api, links } = setup()
    const tokens = Array.from({ length: 6 }, () => (api.createFollowLink(ME) as { token: string }).token)
    expect(tokens.every((token) => /^[0-9a-f]{64}$/.test(token))).toBe(true)
    expect(links.map((entry) => entry.token)).toEqual(tokens)
    expect(people(api, ME).links).toHaveLength(5)
    expect(code(() => api.peekFollowLink(finn.id, tokens[0] ?? ''))).toBe('invite_invalid') // the oldest is off
    expect(api.peekFollowLink(finn.id, tokens[5] ?? '')).toMatchObject({ profile: { id: ME }, relation: { self: false, i_follow: 'requested' } })
    expect(api.peekFollowLink(ME, tokens[5] ?? '')).toMatchObject({ relation: { self: true, i_follow: 'none' } })
    expect(api.revokeFollowLinks(ME)).toEqual({ ok: true })
    expect(people(api, ME).links).toEqual([])
    expect(code(() => api.peekFollowLink(finn.id, tokens[5] ?? ''))).toBe('invite_invalid')
  })

  it('peek writes nothing; every unusable code is the same invite_invalid', () => {
    const { world, api, travel } = setup()
    const before = JSON.stringify(world.follows.tables)
    expect(api.peekFollowLink(ME, DEMO_FOLLOW_TOKENS.clara)).toMatchObject({ profile: { id: clara.id, display_name: 'Clara Test' }, relation: { self: false, i_follow: 'none' } })
    expect(JSON.stringify(world.follows.tables)).toBe(before)
    for (const bad of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), ` ${'a'.repeat(63)}`, null, "' or 1=1 --", 'b'.repeat(64)]) {
      expect(code(() => api.peekFollowLink(ME, bad)), String(bad)).toBe('invite_invalid')
      expect(code(() => api.requestFollowViaLink(ME, bad)), String(bad)).toBe('invite_invalid')
    }
    travel(30 * DAY) // Clara's link (29 days left) is expired now
    expect(code(() => api.peekFollowLink(ME, DEMO_FOLLOW_TOKENS.clara))).toBe('invite_invalid')
    expect(code(() => api.requestFollowViaLink(ME, DEMO_FOLLOW_TOKENS.clara))).toBe('invite_invalid')
  })

  it('without current consents ANY code answers consent_required, without a name profile_incomplete (nothing learned about the code)', () => {
    const { api } = setup({ meConsents: false })
    for (const token of ['garbage', 'b'.repeat(64), DEMO_FOLLOW_TOKENS.clara]) {
      expect(code(() => api.peekFollowLink(ME, token))).toBe('consent_required')
      expect(code(() => api.requestFollowViaLink(ME, token))).toBe('consent_required')
    }
    expect(code(() => api.createFollowLink(ME))).toBe('consent_required')
    const { api: nameless } = setup({ meName: null })
    for (const token of ['garbage', DEMO_FOLLOW_TOKENS.clara]) expect(code(() => nameless.peekFollowLink(ME, token))).toBe('profile_incomplete')
  })

  it('a link asks only: a new request takes one of 20 places, the same person again does not; a full link stays open for those who asked', () => {
    const { world, api } = setup()
    const link = world.follows.linkByToken(DEMO_FOLLOW_TOKENS.clara)
    expect(api.requestFollowViaLink(ME, DEMO_FOLLOW_TOKENS.clara)).toEqual({ status: 'requested', profile_id: clara.id })
    expect(link?.use_count).toBe(1)
    expect(api.requestFollowViaLink(ME, DEMO_FOLLOW_TOKENS.clara)).toEqual({ status: 'requested', profile_id: clara.id })
    expect(link?.use_count).toBe(1)
    if (link) link.use_count = LINK_USE_LIMIT // somebody forwarded it into a big chat
    world.addPerson(person(XAVER, 'Xaver Fremd'))
    expect(code(() => api.peekFollowLink(XAVER, DEMO_FOLLOW_TOKENS.clara))).toBe('invite_invalid')
    expect(code(() => api.requestFollowViaLink(XAVER, DEMO_FOLLOW_TOKENS.clara))).toBe('invite_invalid')
    // who already asked still sees it; its owner sees "self"
    expect(api.peekFollowLink(ME, DEMO_FOLLOW_TOKENS.clara)).toMatchObject({ relation: { i_follow: 'requested' } })
    expect(api.peekFollowLink(clara.id, DEMO_FOLLOW_TOKENS.clara)).toMatchObject({ relation: { self: true } })
    expect(code(() => api.requestFollowViaLink(clara.id, DEMO_FOLLOW_TOKENS.clara))).toBe('invite_invalid') // own link
  })

  it('the 31st open request is limit_reached — and it does not take a place on the link', () => {
    const { world, api, lists } = setup()
    for (let n = 0; n < OPEN_REQUEST_LIMIT; n += 1) {
      const id = `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`
      world.addPerson(person(id, `Person ${n}`))
      world.follows.makeFollowRequest(XAVER, id, () => new Error('limit'))
    }
    world.addPerson(person(XAVER, 'Xaver Fremd'))
    const link = world.follows.linkByToken(DEMO_FOLLOW_TOKENS.anna)
    const places = link?.use_count
    expect(code(() => api.requestFollowViaLink(XAVER, DEMO_FOLLOW_TOKENS.anna))).toBe('limit_reached')
    expect(link?.use_count).toBe(places)
    expect(code(() => lists.requestFollow(XAVER, anna.id))).toBe('not_found') // no shared occasion anyway
  })
})

describe('the demo script: friends who answer (W10, W11)', () => {
  function scripted() {
    const env = setup()
    const queue: { run: () => void; ms: number }[] = []
    const script = createFollowScript(env.world, { schedule: (run, ms) => queue.push({ run, ms }) })
    const api = createFollowsApi(env.world, { onLinkCreated: script.onLinkCreated })
    const flush = () => {
      for (const job of queue.splice(0)) job.run()
    }
    return { ...env, api, queue, flush }
  }

  it('Anna and Clara say yes to a demo account after a moment — only while the request is still there', () => {
    const { world, api, lists, queue, flush } = scripted()
    lists.requestFollow(ME, clara.id)
    expect(queue.map((job) => job.ms)).toEqual([2_500])
    expect(world.follows.iFollowState(ME, clara.id)).toBe('requested') // nothing happens before the moment
    flush()
    expect(world.follows.iFollowState(ME, clara.id)).toBe('following')
    // Anna: unfollow, ask again through her link, withdraw before she looks — no yes
    lists.unfollow(ME, anna.id)
    api.requestFollowViaLink(ME, DEMO_FOLLOW_TOKENS.anna)
    lists.unfollow(ME, anna.id)
    flush()
    expect(world.follows.iFollowState(ME, anna.id)).toBe('none')
    // the fictional friends among themselves are no script: Finn asks Clara → nothing scheduled
    expect(() => api.requestFollowViaLink(finn.id, DEMO_FOLLOW_TOKENS.clara)).not.toThrow()
    expect(queue).toEqual([])
  })

  it('Ben knocks through my fresh link once, a little later — following the link rules', () => {
    const { api, queue, flush } = scripted()
    const { token } = api.createFollowLink(ME) as { token: string }
    expect(queue.map((job) => job.ms)).toEqual([4_000])
    flush()
    expect(people(api, ME).requests_in.map((row) => [row.profile.id, row.i_follow])).toContainEqual([ben.id, 'following'])
    api.createFollowLink(ME) // a second link: no second knock
    expect(queue).toEqual([])
    // a revoked link stays silent
    const second = scripted()
    second.api.createFollowLink(ME)
    second.api.revokeFollowLinks(ME)
    expect(() => second.flush()).not.toThrow()
    expect(ids(people(second.api, ME).requests_in)).not.toContain(ben.id)
    void token
  })
})

describe('demo account deletion (follows)', () => {
  it('a deleted owner takes the links (and their codes) along', () => {
    const { world, api } = setup()
    world.deletePerson(clara.id)
    expect(world.follows.linkByToken(DEMO_FOLLOW_TOKENS.clara)).toBeUndefined()
    expect(code(() => api.peekFollowLink(ME, DEMO_FOLLOW_TOKENS.clara))).toBe('invite_invalid')
    expect(code(() => api.getProfileCard(ME, clara.id))).toBe('not_found')
    void greta
  })
})

describe('demo friend codes (20261027160000, add-friends-design §2.2–§3)', () => {
  it('create → peek → request like the link; ≤ 3 live; "Neuer Code" switches all off; the fixed demo codes', () => {
    const { api, world } = setup()
    const first = api.createFriendCode(ME, false) as { code: string; expires_at: string }
    expect(first.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
    expect((api.peekFriendCode(XAVER_SETUP(world), first.code) as { profile: { id: string } }).profile.id).toBe(ME)
    const codes = [first.code, ...[1, 2, 3].map(() => (api.createFriendCode(ME, false) as { code: string }).code)]
    expect(api.peekFriendCode(ME, codes[0] ?? '')).toEqual({ invalid: true }) // the 4th switched the oldest off
    const fresh = (api.createFriendCode(ME, true) as { code: string }).code
    for (const old of codes) expect(api.peekFriendCode(ME, old)).toEqual({ invalid: true })
    expect((api.peekFriendCode(ME, fresh) as { relation: { self: boolean } }).relation.self).toBe(true)
    // Clara's fixed code, typed loosely (Anna's: the demo account follows her already)
    expect(api.requestFollowViaCode(ME, 'cara-2O26')).toEqual({ status: 'requested', profile_id: clara.id })
    expect(api.requestFollowViaCode(ME, 'ANNA2026')).toEqual({ status: 'following', profile_id: anna.id })
    expect(api.requestFollowViaCode(ME, fresh)).toEqual({ invalid: true }) // the own code
  })

  it('10 misses → rate_limited for right and wrong codes; revoke_follow_links switches codes off too', () => {
    const { api } = setup()
    for (let i = 0; i < 10; i++) expect(api.peekFriendCode(ME, 'ZZZZZZZZ')).toEqual({ invalid: true })
    expect(code(() => api.peekFriendCode(ME, 'ANNA2026'))).toBe('rate_limited')
    const other = setup()
    const mine = (other.api.createFriendCode(ME, false) as { code: string }).code
    other.api.revokeFollowLinks(ME)
    expect(other.api.peekFriendCode(ME, mine)).toEqual({ invalid: true })
    const exported = followsExportFor(other.world, ME).follows
    expect(exported.friend_codes).toHaveLength(1)
    expect(exported.friend_code_misses).toHaveLength(1)
    expect(JSON.stringify(exported)).not.toContain(mine)
  })
})

/** A second signed-up demo account (consents + name) to look at somebody else's code. */
function XAVER_SETUP(world: ReturnType<typeof setup>['world']): string {
  world.addPerson(person(XAVER, 'Xaver'))
  return XAVER
}
