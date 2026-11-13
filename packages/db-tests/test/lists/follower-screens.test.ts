/**
 * The contract of the M3 screens for the UI chain (follows-design §5.2, §5.5; 20261020200200_follow_sharing.sql):
 *   get_list_screen    the FOLLOWER BRANCH: viewer.role 'follower', real reserved / reserved_by_me (never who), the
 *                      owner card with the banner; the same order as the owner's (priority desc, created_at asc, id);
 *   get_lists_overview following[] (by display_name, id; mutual; lists with new_wish_count), upcoming[] ("Bald",
 *                      60 days: guest occasion lists + dated follower lists, by date), suggestions[], friends_lists;
 *   get_profile_card   lists (only for an accepted follower), can_find_gift;
 *   get_me             profile.in_suggestions;   my_reservations  list {id, title, owner_name} | null.
 * Exact jsonb keys everywhere: the database chain and the UI chain implement the same contract in parallel.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type TestDb } from '../../src/harness'
import { createMember, execAs, rpc } from '../pilot/seed'
import { L1_TITLE, L1_WISH_TITLES, NAMES, O1_TITLE, O2_TITLE, addWish, backdateWish, createList, createOccasion, followLink, invite, rpcText, seedFollows, type FollowSeed } from '../follows/seed'
import { checkInvariants } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

// 20261022160000: + photo (list cover meta) on every list part; wishes + received_at; the screen + received[]
const LIST_KEYS = ['cover_icon', 'cover_tone', 'created_at', 'due_on', 'id', 'kind', 'owner', 'photo', 'title', 'visibility']
// 20261022120000: + brand, color, description, gtin, photo, shop_name (the wish details; never about reservations)
// 20261027200000 (shared wishes): + also_in — null for followers (no hints on a follower list, Q18)
const WISH_KEYS = ['also_in', 'brand', 'color', 'created_at', 'currency', 'description', 'gtin', 'id', 'note', 'photo', 'price_cents', 'priority', 'quantity', 'received_at', 'reserved', 'reserved_by_me', 'shop_name', 'title', 'together', 'url']
const CARD_KEYS = ['cover_icon', 'cover_tone', 'due_on', 'id', 'new_wish_count', 'photo', 'title', 'wish_count']
const FOLLOWING_KEYS = ['accepted_at', 'lists', 'mutual', 'profile']
const UPCOMING_KEYS = ['date', 'kind', 'list', 'owner']
const UPCOMING_LIST_KEYS = ['cover_icon', 'cover_tone', 'id', 'occasion_id', 'photo', 'title', 'wish_count']

interface ListScreen {
  list: Record<string, unknown> & { owner: Record<string, unknown> }
  viewer: { role: string }
  wishes: (Record<string, unknown> & { id: string; reserved: boolean | null; reserved_by_me: boolean | null })[]
}
interface ListCard {
  id: string
  title: string
  cover_tone: number | null
  cover_icon: string | null
  due_on: string | null
  wish_count: number
  new_wish_count: number
}
interface Overview {
  me: Record<string, unknown>
  stats: Record<string, number>
  my_lists: { id: string }[]
  following: { profile: { id: string; display_name: string; banner: string | null }; mutual: boolean; accepted_at: string; lists: ListCard[] }[]
  upcoming: { list: Record<string, unknown> & { id: string }; owner: { id: string; display_name: string }; date: string; kind: string }[]
  suggestions: { profile: { id: string; display_name: string }; shared_occasion_title: string }[]
}

/** A day relative to today in Europe/Berlin, as 'YYYY-MM-DD'. */
function berlinDay(offsetDays: number): Promise<string> {
  return scalar<string>(t.db, `select ((now() at time zone 'Europe/Berlin')::date + $1::int)::text`, [offsetDays])
}

describe('get_list_screen: the follower branch', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
    await t.asUser(s.paula, (tx) => tx.query(`update profiles set banner = 'berry' where id = $1`, [s.paula]))
  })

  it('exact keys; role follower; the owner card with the banner; the owner\'s order', async () => {
    const owner = await rpc<ListScreen>(t, s.paula, 'get_list_screen', [s.l1])
    const follower = await rpc<ListScreen>(t, s.finn, 'get_list_screen', [s.l1])
    expect(Object.keys(follower).sort()).toEqual(['list', 'received', 'viewer', 'wishes'])
    expect(Object.keys(follower.list).sort()).toEqual(LIST_KEYS)
    expect(follower.viewer).toEqual({ role: 'follower' })
    expect(owner.viewer).toEqual({ role: 'owner' })
    expect(follower.list).toEqual({ ...owner.list }) // the same list part for both
    expect(follower.list).toMatchObject({ id: s.l1, title: L1_TITLE, kind: 'standalone', visibility: 'followers', cover_tone: 2, cover_icon: 'star', due_on: null })
    expect(follower.list.owner).toEqual({ id: s.paula, display_name: NAMES.paula, banner: 'berry', photo: null, banner_photo: null })
    // w1 (priority 3), w3 (2), w2 (1) — for everybody
    const [w1, w2, w3] = s.l1Wishes
    expect(follower.wishes.map((w) => w.id)).toEqual([w1, w3, w2])
    expect(owner.wishes.map((w) => w.id)).toEqual([w1, w3, w2])
    for (const w of follower.wishes) {
      expect(Object.keys(w).sort()).toEqual(WISH_KEYS)
      expect([w.reserved, w.reserved_by_me]).toEqual([false, false])
    }
    expect(follower.wishes.map((w) => w['title'])).toEqual([L1_WISH_TITLES.w1, L1_WISH_TITLES.w3, L1_WISH_TITLES.w2])
  })

  it('reserved for everybody but the owner, reserved_by_me only for the reserver — never who', async () => {
    const [w1, w2] = s.l1Wishes
    expect(await rpc(t, s.finn, 'reserve_wish', [w1])).toEqual({ ok: true })
    const flags = async (uid: string) =>
      Object.fromEntries((await rpc<ListScreen>(t, uid, 'get_list_screen', [s.l1])).wishes.map((w) => [w.id, [w.reserved, w.reserved_by_me]]))
    expect((await flags(s.finn))[w1]).toEqual([true, true])
    expect((await flags(s.greta))[w1]).toEqual([true, false])
    expect((await flags(s.greta))[w2]).toEqual([false, false])
    expect((await flags(s.paula))[w1]).toEqual([null, null])
    const asGreta = await rpcText(t, s.greta, 'get_list_screen', [s.l1])
    expect(asGreta).not.toContain(s.finn) // the reserver's identity appears nowhere
    const resId = await scalar<string>(t.db, `select id from reservations where wish_id = $1 and status = 'active'`, [w1])
    expect(asGreta).not.toContain(resId)
    expect(await rpc(t, s.finn, 'cancel_reservation', [w1])).toEqual({ ok: true })
    expect((await flags(s.greta))[w1]).toEqual([false, false])
    await checkInvariants(t)
  })
})

describe('get_lists_overview: following, upcoming, suggestions, friends_lists', () => {
  it('Finn: Paula with L1 (follower lists only), the guest list of O2 under "Bald", Moritz suggested', async () => {
    const s = await seedFollows(t)
    const ov = await rpc<Overview>(t, s.finn, 'get_lists_overview')
    expect(Object.keys(ov).sort()).toEqual(['following', 'me', 'my_lists', 'stats', 'suggestions', 'upcoming'])
    expect(ov.following).toHaveLength(1)
    const paula = ov.following[0]!
    expect(Object.keys(paula).sort()).toEqual(FOLLOWING_KEYS)
    expect(paula.profile).toEqual({ id: s.paula, display_name: NAMES.paula, banner: null, photo: null, banner_photo: null })
    expect(paula.mutual).toBe(false)
    expect(paula.accepted_at).toEqual(expect.any(String))
    expect(paula.lists).toEqual([{ id: s.l1, title: L1_TITLE, cover_tone: 2, cover_icon: 'star', due_on: null, photo: null, wish_count: 3, new_wish_count: 3 }])
    for (const l of paula.lists) expect(Object.keys(l).sort()).toEqual(CARD_KEYS)
    // "Bald": the list of O2 (Moritz's occasion in 10 days, Finn is a guest); L1 has no date
    expect(ov.upcoming).toEqual([
      {
        list: { id: s.o2List, title: O2_TITLE, cover_tone: null, cover_icon: null, wish_count: 0, occasion_id: s.o2, photo: null },
        owner: { id: s.moritz, display_name: NAMES.moritz },
        date: await scalar<string>(t.db, `select ((starts_at at time zone tz)::date)::text from occasions where id = $1`, [s.o2]),
        kind: 'occasion',
      },
    ])
    for (const u of ov.upcoming) {
      expect(Object.keys(u).sort()).toEqual(UPCOMING_KEYS)
      expect(Object.keys(u.list).sort()).toEqual(UPCOMING_LIST_KEYS)
    }
    expect(ov.suggestions).toEqual([{ profile: { id: s.moritz, display_name: NAMES.moritz, photo: null, banner_photo: null }, shared_occasion_title: O2_TITLE }])
    // L1 (Paula's follower list) + the list of O2 (a guest)
    expect(ov.stats).toEqual({ my_wishes: 0, my_lists: 0, friends_lists: 2, followers: 0, following: 1, requests: 0 })
    // nothing about reservations, anywhere; Paula's "Nur ich" list never appears
    const text = JSON.stringify(ov)
    expect(text).not.toMatch(/reserv/i)
    expect(text).not.toContain(s.l2)
  })

  it('mutual, the order of following (display_name, id), new_wish_count over 7 days, the order of a person\'s lists', async () => {
    const s = await seedFollows(t)
    // Finn follows Anna too; Paula follows Finn back (mutual with Finn)
    const anna = await createMember(t, 'Anna')
    const annaList = await createList(t, anna, 'Annas Wünsche', { visibility: 'followers' })
    await rpc(t, s.finn, 'request_follow_via_link', [await followLink(t, anna)])
    await rpc(t, anna, 'respond_follow', [s.finn, true])
    expect(await rpc(t, s.paula, 'request_follow', [s.finn])).toEqual({ status: 'requested' }) // they share O2
    await rpc(t, s.finn, 'respond_follow', [s.paula, true])
    // Paula: a second follower list with a future date, one undated older, and one "Nur ich" (never shown)
    const dated = await createList(t, s.paula, 'Geburtstag', { visibility: 'followers', due_on: await berlinDay(12) })
    const older = await createList(t, s.paula, 'Bücher', { visibility: 'followers' })
    await t.asService((tx) => tx.query(`update wishlists set created_at = now() - interval '2 days' where id = $1`, [older]))
    await createList(t, s.paula, 'Geheim')
    const oldWish = await addWish(t, s.paula, s.l1, 'Alt', 2)
    await backdateWish(t, oldWish, 8 * 24 * 60) // its home place too ("neu" = added to the list within 7 days)

    const ov = await rpc<Overview>(t, s.finn, 'get_lists_overview')
    expect(ov.following.map((f) => [f.profile.display_name, f.mutual])).toEqual([['Anna', false], [NAMES.paula, true]])
    expect(ov.following[0]!.lists.map((l) => l.id)).toEqual([annaList])
    const paulas = ov.following[1]!.lists
    expect(paulas.map((l) => l.id)).toEqual([dated, s.l1, older]) // future date first, then newest first
    expect(paulas.find((l) => l.id === s.l1)).toMatchObject({ wish_count: 4, new_wish_count: 3 })
    // "Bald": Paula's dated list (in 12 days) and O2 (in 10 days), by date
    expect(ov.upcoming.map((u) => [u.list.id, u.kind])).toEqual([[s.o2List, 'occasion'], [dated, 'standalone']])
    const datedItem = ov.upcoming[1]!
    expect(datedItem).toEqual({
      list: { id: dated, title: 'Geburtstag', cover_tone: null, cover_icon: null, wish_count: 0, occasion_id: null, photo: null },
      owner: { id: s.paula, display_name: NAMES.paula },
      date: await berlinDay(12),
      kind: 'standalone',
    })
    // 4 follower lists (Anna 1 + Paula 3) + O2
    expect(ov.stats).toMatchObject({ friends_lists: 5, following: 2, followers: 1 })
    expect(ov.stats.following).toBe(ov.following.length)
    await checkInvariants(t)
  })

  it('"Bald" keeps 60 days: today is in, day 61 and past dates are out; ended guest occasions count ≤ 30 days', async () => {
    const s = await seedFollows(t)
    const today = await createList(t, s.paula, 'Heute', { visibility: 'followers', due_on: await berlinDay(0) })
    const day60 = await createList(t, s.paula, 'Tag 60', { visibility: 'followers', due_on: await berlinDay(60) })
    await createList(t, s.paula, 'Tag 61', { visibility: 'followers', due_on: await berlinDay(61) })
    await createList(t, s.paula, 'Gestern', { visibility: 'followers', due_on: await berlinDay(-1) })
    // a guest occasion (Paula's O1, Finn joins) that ended 10 days ago: no "Bald", but still "Mit dir geteilt"
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite])
    await t.asService((tx) => tx.query(`update occasions set starts_at = now() - interval '10 days' where id = $1`, [s.o1]))
    let ov = await rpc<Overview>(t, s.finn, 'get_lists_overview')
    expect(ov.upcoming.map((u) => u.list.id)).toEqual([today, s.o2List, day60])
    // L1 + 4 dated lists + O2 + O1 (ended 10 days ago)
    expect(ov.stats.friends_lists).toBe(7)
    await t.asService((tx) => tx.query(`update occasions set starts_at = now() - interval '40 days' where id = $1`, [s.o1]))
    ov = await rpc<Overview>(t, s.finn, 'get_lists_overview')
    expect(ov.stats.friends_lists).toBe(6)
  })

  it('a person with only "Nur ich" lists: following[].lists = [] ("teilt gerade keine Liste")', async () => {
    const s = await seedFollows(t, { l1: 'private' })
    const ov = await rpc<Overview>(t, s.greta, 'get_lists_overview')
    expect(ov.following.map((f) => [f.profile.id, f.lists])).toEqual([[s.paula, []]])
    expect(ov.stats.friends_lists).toBe(0)
    expect(ov.upcoming).toEqual([])
  })
})

describe('get_profile_card: lists and can_find_gift', () => {
  it('an accepted follower sees the follower lists; waiting, guests and the owner herself get lists []', async () => {
    const s = await seedFollows(t)
    const finnCard = await rpc<{ lists: ListCard[]; can_find_gift: boolean }>(t, s.finn, 'get_profile_card', [s.paula])
    expect(finnCard.lists).toEqual([{ id: s.l1, title: L1_TITLE, cover_tone: 2, cover_icon: 'star', due_on: null, photo: null, wish_count: 3, new_wish_count: 3 }])
    expect(finnCard.can_find_gift).toBe(true)
    const rosaCard = await rpc<{ lists: unknown[]; can_find_gift: boolean }>(t, s.rosa, 'get_profile_card', [s.paula])
    expect([rosaCard.lists, rosaCard.can_find_gift]).toEqual([[], false])
    // Moritz: a guest of O1, not a follower — no lists on the card, but O1's list is readable: can_find_gift
    const moritzCard = await rpc<{ lists: unknown[]; can_find_gift: boolean }>(t, s.moritz, 'get_profile_card', [s.paula])
    expect([moritzCard.lists, moritzCard.can_find_gift]).toEqual([[], true])
    const own = await rpc<{ lists: unknown[]; can_find_gift: boolean }>(t, s.paula, 'get_profile_card', [s.paula])
    expect([own.lists, own.can_find_gift]).toEqual([[], false])
    // the card of a follower for Paula: Finn has no lists she could read
    const paulaOfFinn = await rpc<{ lists: unknown[]; can_find_gift: boolean }>(t, s.paula, 'get_profile_card', [s.finn])
    expect([paulaOfFinn.lists, paulaOfFinn.can_find_gift]).toEqual([[], false])
  })
})

describe('get_me.in_suggestions and the REST switch', () => {
  it('a new profile starts off; the person switches it through REST (no SELECT grant); nobody else can', async () => {
    const u = await createMember(t, 'Ida')
    const other = await createMember(t, 'Jonas')
    const me = async () => (await rpc<{ profile: Record<string, unknown> }>(t, u, 'get_me')).profile
    expect(await me()).toMatchObject({ in_suggestions: false })
    expect(Object.keys(await me()).sort()).toEqual(['banner', 'banner_photo', 'display_name', 'id', 'in_suggestions', 'invitations_from', 'locale', 'onboarding_done_at', 'photo'])
    expect(await execAs(t, u, 'update profiles set in_suggestions = true where id = $1', [u])).toBe(1)
    expect(await me()).toMatchObject({ in_suggestions: true })
    expect(await execAs(t, other, 'update profiles set in_suggestions = false where id = $1', [u])).toBe(0)
    expect(await me()).toMatchObject({ in_suggestions: true })
    expect(await execAs(t, u, 'update profiles set in_suggestions = false where id = $1', [u])).toBe(1)
    expect(await me()).toMatchObject({ in_suggestions: false })
  })
})

describe('my_reservations: the key list', () => {
  it('{id, title, owner_name} for a follower list while readable; null for an occasion\'s reservation', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite])
    await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])
    await rpc(t, s.finn, 'reserve_wish', [s.o1Wish])
    const mine = await rpc<Record<string, unknown>[]>(t, s.finn, 'my_reservations')
    const l1Row = mine.find((r) => r['wish_id'] === s.l1Wishes[0])!
    const o1Row = mine.find((r) => r['wish_id'] === s.o1Wish)!
    expect(l1Row).toMatchObject({ wish_title: L1_WISH_TITLES.w1, occasion_id: null, occasion_title: null, starts_at: null, status: 'active', end_reason: null })
    expect(l1Row['list']).toEqual({ id: s.l1, title: L1_TITLE, owner_name: NAMES.paula })
    expect(o1Row).toMatchObject({ occasion_id: s.o1, occasion_title: O1_TITLE, list: null })
    expect(JSON.stringify(mine)).not.toContain(s.paula) // the owner by name only
    await checkInvariants(t)
  })
})

describe('the occasion of a guest is never "mine" and an invite does not open a follower list', () => {
  it('a guest of Paula\'s occasion reads O1 only; her follower list stays closed without an accepted follow', async () => {
    const s = await seedFollows(t)
    const guest = await createMember(t, 'Ben')
    const [otherOccasion, otherList] = await createOccasion(t, s.paula, 'Paulas Zweites Fest', 5)
    await rpc(t, guest, 'accept_invite', [await invite(t, s.paula, otherOccasion)])
    const ov = await rpc<Overview>(t, guest, 'get_lists_overview')
    expect(ov.following).toEqual([])
    expect(ov.upcoming.map((u) => u.list.id)).toEqual([otherList])
    expect(JSON.stringify(ov)).not.toContain(s.l1)
    await expectNotFound(guest, s.l1)
  })
})

async function expectNotFound(uid: string, listId: string): Promise<void> {
  await expect(rpc(t, uid, 'get_list_screen', [listId])).rejects.toMatchObject({ code: 'P0001', message: 'not_found' })
}
