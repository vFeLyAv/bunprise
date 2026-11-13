/**
 * F21 — "Noch frei auf {{name}}s Listen": get_free_wishes(p_profile_id, p_max_cents) (follows-design §00 item 2,
 * §2.5, §5.5 get_gift_ideas, G1–G7; M4 20261020200300_free_wishes.sql):
 *   oneself, a stranger, a blocked person (either direction), null, an unknown id, waiting / removed people -> ONE
 *   not_found; a bad budget -> validation before anything else; only lists the giver can read anyway (a follower:
 *   the follower lists; a guest: the occasion's list); wishes with an active reservation are left out; the budget
 *   keeps wishes without a price; ended occasions are left out; the order is date, priority, price (none last);
 *   the red button closes it; get_profile_card.can_find_gift is true exactly when get_free_wishes is not not_found.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../src/harness'
import { createMember, execAs, rpc } from '../pilot/seed'
import {
  NAMES,
  UNKNOWN_ID,
  addWish,
  createList,
  createOccasion,
  followLink,
  invite,
  pressRedButton,
  releaseRedButton,
  rpcOutcome,
  seedFollows,
  type FollowSeed,
} from '../follows/seed'
import { checkInvariants } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface Idea {
  wish_id: string
  title: string
  url: string | null
  price_cents: number | null
  currency: string
  priority: number
  created_at: string
  list: { id: string; title: string | null; kind: string; date: string | null; occasion_id: string | null }
}
interface FreeWishes {
  person: { id: string; display_name: string | null; banner: string | null }
  ideas: Idea[]
}
// 20261022120000: + the wish details (brand, color, description, gtin, photo, shop_name)
// 20261022160000: + received_at (always null here: received wishes are no gift ideas) and list.photo
// 20261027200000: + lists (every readable place of the wish, each the shape of `list`; one entry per wish)
const IDEA_KEYS = ['brand', 'color', 'created_at', 'currency', 'description', 'gtin', 'list', 'lists', 'photo', 'price_cents', 'priority', 'quantity', 'received_at', 'shop_name', 'title', 'url', 'wish_id']
const IDEA_LIST_KEYS = ['date', 'id', 'kind', 'occasion_id', 'photo', 'title']

const free = (uid: string, who: string | null, max: number | null = null) => rpc<FreeWishes>(t, uid, 'get_free_wishes', [who, max])
const ideaIds = async (uid: string, who: string, max: number | null = null) => (await free(uid, who, max)).ideas.map((i) => i.wish_id)

describe('F21 who may ask, about whom', () => {
  let s: FollowSeed
  let ben: string
  beforeAll(async () => {
    s = await seedFollows(t)
    ben = await createMember(t, 'Ben') // followed, then removed by Paula
    await rpc(t, ben, 'request_follow_via_link', [s.token])
    await rpc(t, s.paula, 'respond_follow', [ben, true])
    await rpc(t, s.paula, 'remove_follower', [ben])
  })

  it('oneself, strangers, blocked, waiting, removed, null, unknown: one not_found; a bad budget: validation first', async () => {
    const answers = new Set<string>()
    for (const [viewer, target] of [
      [s.paula, s.paula], [s.finn, s.finn], [s.xaver, s.paula], [s.bea, s.paula], [s.paula, s.bea], [s.rosa, s.paula],
      [ben, s.paula], [s.finn, s.greta], [s.greta, s.finn], [s.paula, s.finn], [s.finn, null], [s.finn, UNKNOWN_ID],
    ] as const) {
      answers.add(await rpcOutcome(t, viewer, 'get_free_wishes', [target, null]))
      answers.add(await rpcOutcome(t, viewer, 'get_free_wishes', [target, 5000]))
    }
    expect([...answers]).toEqual(['error:P0001:not_found'])
    for (const bad of [-1, 100000001, -2147483648]) {
      for (const [viewer, target] of [[s.finn, s.paula], [s.xaver, s.paula], [s.paula, s.paula], [s.finn, null]] as const) {
        expect(await rpcOutcome(t, viewer, 'get_free_wishes', [target, bad]), `${bad}`).toBe('error:P0001:validation')
      }
    }
    expect((await free(s.finn, s.paula, 0)).person.id).toBe(s.paula)
    expect((await free(s.finn, s.paula, 100000000)).person.id).toBe(s.paula)
    await expect(t.asAnon((tx) => tx.query('select public.get_free_wishes($1, $2)', [s.paula, null]))).rejects.toMatchObject({ code: '42501' })
  })

  it('a follower gets the follower lists only (never "Nur ich", never the occasion of which he is no guest); a guest only the occasion\'s list', async () => {
    const finn = await free(s.finn, s.paula)
    expect(Object.keys(finn).sort()).toEqual(['ideas', 'person'])
    expect(finn.person).toEqual({ id: s.paula, display_name: NAMES.paula, banner: null, photo: null, banner_photo: null })
    expect(finn.ideas.map((i) => i.wish_id).sort()).toEqual([...s.l1Wishes].sort())
    for (const i of finn.ideas) {
      expect(Object.keys(i).sort()).toEqual(IDEA_KEYS)
      expect(Object.keys(i.list).sort()).toEqual(IDEA_LIST_KEYS)
      expect(i.list).toEqual({ id: s.l1, title: 'Meine Wünsche', kind: 'standalone', date: null, occasion_id: null, photo: null })
    }
    const moritz = await free(s.moritz, s.paula)
    expect(moritz.ideas.map((i) => i.wish_id)).toEqual([s.o1Wish])
    expect(moritz.ideas[0]!.list).toMatchObject({ id: s.o1List, kind: 'occasion', occasion_id: s.o1, title: 'Paulas Gartenfest' })
    expect(moritz.ideas[0]!.list.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Finn as a guest of O2 asks about its host Moritz: the occasion's list (no wishes there yet)
    expect(await free(s.finn, s.moritz)).toEqual({ person: { id: s.moritz, display_name: NAMES.moritz, banner: null, photo: null, banner_photo: null }, ideas: [] })
  })

  it('wishes with an active reservation are left out — for everybody (the reserver included); a cancelled one is back', async () => {
    const [w1] = s.l1Wishes
    await rpc(t, s.greta, 'reserve_wish', [w1])
    expect(await ideaIds(s.finn, s.paula)).not.toContain(w1)
    expect(await ideaIds(s.greta, s.paula)).not.toContain(w1)
    await rpc(t, s.greta, 'cancel_reservation', [w1])
    expect(await ideaIds(s.finn, s.paula)).toContain(w1)
    await checkInvariants(t)
  })

  it('get_profile_card.can_find_gift is true exactly when get_free_wishes does not answer not_found (every pair)', async () => {
    const people = [s.paula, s.finn, s.greta, s.rosa, s.moritz, s.xaver, s.bea, ben]
    let trues = 0
    for (const viewer of people) {
      for (const target of [...people, UNKNOWN_ID]) {
        const card = await rpcOutcome(t, viewer, 'get_profile_card', [target])
        const gift = await rpcOutcome(t, viewer, 'get_free_wishes', [target, null])
        if (card.startsWith('error:')) {
          expect(gift, `${viewer} -> ${target}: no card, so no gift search`).toBe('error:P0001:not_found')
          continue
        }
        const can = (JSON.parse(card) as { can_find_gift: boolean }).can_find_gift
        expect(gift === 'error:P0001:not_found', `${viewer} -> ${target}`).toBe(!can)
        if (can) trues++
      }
    }
    expect(trues).toBeGreaterThanOrEqual(4) // Finn, Greta, Moritz -> Paula; Finn, Paula -> Moritz (O2) …
  })

  it('the red button closes it for followers (their only readable list) — and opens again', async () => {
    expect((await free(s.finn, s.paula)).ideas.length).toBe(3)
    await pressRedButton(t)
    try {
      expect(await rpcOutcome(t, s.finn, 'get_free_wishes', [s.paula, null])).toBe('error:P0001:not_found')
      expect((await rpc<{ can_find_gift: boolean }>(t, s.finn, 'get_profile_card', [s.paula])).can_find_gift).toBe(false)
      expect((await free(s.moritz, s.paula)).ideas.map((i) => i.wish_id)).toEqual([s.o1Wish]) // occasion lists stay
      await checkInvariants(t)
    } finally {
      await releaseRedButton(t)
    }
    expect((await free(s.finn, s.paula)).ideas.length).toBe(3)
  })
})

describe('F21 budget, order, ended occasions', () => {
  it('date (occasion day / due_on), undated last; priority desc; price asc, none last; the budget keeps wishes without a price', async () => {
    const anna = await createMember(t, 'Anna')
    const ben = await createMember(t, 'Ben')
    await rpc(t, ben, 'request_follow_via_link', [await followLink(t, anna)])
    await rpc(t, anna, 'respond_follow', [ben, true])
    const day = async (offset: number) => (await t.db.query<{ d: string }>(`select ((now() at time zone 'Europe/Berlin')::date + $1::int)::text as d`, [offset])).rows[0]!.d
    const birthday = await createList(t, anna, 'Geburtstag', { visibility: 'followers', due_on: await day(12) })
    const general = await createList(t, anna, 'Allgemein', { visibility: 'followers' })
    const secret = await createList(t, anna, 'Geheim') // "Nur ich": never
    const [occ, occList] = await createOccasion(t, anna, 'Annas Einweihung', 5)
    const [past, pastList] = await createOccasion(t, anna, 'Annas Grillfest', 3)
    for (const o of [occ, past]) await rpc(t, ben, 'accept_invite', [await invite(t, anna, o)])
    const priced = async (list: string, title: string, priority: number, price: number | null, minutesAgo: number) => {
      const id = await addWish(t, anna, list, title, priority, minutesAgo)
      if (price !== null) await execAs(t, anna, 'update wishes set price_cents = $2 where id = $1', [id, price])
      return id
    }
    const a = await priced(birthday, 'A', 3, 2990, 9)
    const b = await priced(birthday, 'B', 3, null, 8)
    const c = await priced(birthday, 'C', 2, 990, 7)
    const d = await priced(general, 'D', 3, 500, 6)
    const e = await priced(general, 'E', 1, 100, 5)
    const f = await priced(occList, 'F', 1, 5000, 4)
    const sameDayCheaper = await priced(occList, 'F2', 1, 4000, 3)
    await priced(pastList, 'G', 3, 100, 2)
    await priced(secret, 'H', 3, 100, 1)
    // the grill party ended yesterday: its list stays readable for the guest, its wishes are not offered
    await t.asService((tx) => tx.query(`update occasions set starts_at = now() - interval '2 days' where id = $1`, [past]))

    expect(await ideaIds(ben, anna)).toEqual([sameDayCheaper, f, a, b, c, d, e])
    expect(await ideaIds(ben, anna, 1000)).toEqual([b, c, d, e])
    expect(await ideaIds(ben, anna, 0)).toEqual([b])
    expect(await ideaIds(ben, anna, 100000000)).toHaveLength(7)
    const ideas = (await free(ben, anna)).ideas
    expect(ideas.find((i) => i.wish_id === f)!.list).toMatchObject({ id: occList, kind: 'occasion', occasion_id: occ, title: 'Annas Einweihung' })
    expect(ideas.find((i) => i.wish_id === a)!.list).toEqual({ id: birthday, title: 'Geburtstag', kind: 'standalone', date: await day(12), occasion_id: null, photo: null })
    expect(ideas.find((i) => i.wish_id === d)!.list.date).toBeNull()
    // the ended occasion alone still makes Anna "findable" for a guest who is no follower — with nothing free
    const ida = await createMember(t, 'Ida')
    await rpc(t, ida, 'accept_invite', [await invite(t, anna, past)])
    expect((await rpc<{ can_find_gift: boolean }>(t, ida, 'get_profile_card', [anna])).can_find_gift).toBe(true)
    expect((await free(ida, anna)).ideas).toEqual([])
    // and the person herself never: not_found, whatever her lists hold
    expect(await rpcOutcome(t, anna, 'get_free_wishes', [anna, null])).toBe('error:P0001:not_found')
    await checkInvariants(t)
  })
})
