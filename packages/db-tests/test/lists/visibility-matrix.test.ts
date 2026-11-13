/**
 * F02 — who sees what (follows-design §4.2, §4.3, §7.2 F02, A1, A6, A7, P6, P15; M3 20261020200200_follow_sharing.sql).
 * The roles towards the owner Paula: O Paula · F Finn, Greta (accepted followers) · P Rosa (waiting) and Ida (silently
 * refused — the same for her) · R Ben (removed follower, in Paula's silence) · G Moritz (guest of Paula's occasion O1,
 * no follower) · B Bea (blocked by Paula) · X Xaver (nothing) · A anon.
 * The objects: L1 "Meine Wünsche" ('followers'), L2 "Privat" ('private'), the list of O1 (the occasion's).
 * Every path: REST wishlists / wishes (every granted column) and the embedding (a join), get_list_screen,
 * get_profile_card, get_lists_overview, get_free_wishes; the REST writes of non-owners. Every refusal is the answer
 * for a random UUID: 0 rows through REST, one and the same not_found error through the RPCs.
 * Suggestions: only people with in_suggestions + current legal records, a recent shared occasion, no block, no
 * relation visible to me, not in MY silence; a new profile starts off; switching off removes at once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, scalar, type TestDb } from '../../src/harness'
import { createMember, execAs, queryAs, rpc } from '../pilot/seed'
import { NAMES, O1_TITLE, O2_TITLE, UNKNOWN_ID, createOccasion, invite, rpcOutcome, seedFollows, type FollowSeed } from '../follows/seed'
import { checkInvariants, cooldownRows } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const LIST_COLS = 'id, occasion_id, owner_id, recipient_id, title, created_at, visibility, cover_tone, cover_icon, due_on'
const WISH_COLS = 'id, wishlist_id, title, price_cents, currency, url, note, priority, created_at'
const RANDOM = '3f1c2b8e-0000-4000-8000-00000000abcd'

type Role = 'O' | 'F1' | 'F2' | 'P' | 'Pref' | 'R' | 'G' | 'B' | 'X'
type Obj = 'L1' | 'L2' | 'O1'

/** §4.2: which role reads which list (REST + get_list_screen for standalone lists; REST for the occasion's). */
const READS: Record<Role, Obj[]> = {
  O: ['L1', 'L2', 'O1'],
  F1: ['L1'],
  F2: ['L1'],
  P: [],
  Pref: [],
  R: [],
  G: ['O1'],
  B: [],
  X: [],
}

describe('F02 the matrix of §4.2', () => {
  let s: FollowSeed
  let ids: Record<Role, string>
  let objs: Record<Obj, string>
  beforeAll(async () => {
    s = await seedFollows(t)
    // R: Ben followed (accepted), then Paula removed him; P (refused): Ida asked, Paula refused silently
    const ben = await createMember(t, 'Ben')
    const ida = await createMember(t, 'Ida')
    for (const who of [ben, ida]) await rpc(t, who, 'request_follow_via_link', [s.token])
    await rpc(t, s.paula, 'respond_follow', [ben, true])
    expect(await rpc(t, s.paula, 'remove_follower', [ben])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'respond_follow', [ida, false])).toEqual({ ok: true })
    ids = { O: s.paula, F1: s.finn, F2: s.greta, P: s.rosa, Pref: ida, R: ben, G: s.moritz, B: s.bea, X: s.xaver }
    objs = { L1: s.l1, L2: s.l2, O1: s.o1List }
    await checkInvariants(t)
  })

  it('REST wishlists / wishes / the embedding: exactly the readable lists; every refusal is the random UUID\'s 0 rows', async () => {
    for (const [role, uid] of Object.entries(ids) as [Role, string][]) {
      for (const [obj, listId] of Object.entries(objs) as [Obj, string][]) {
        const list = await queryAs(t, uid, `select ${LIST_COLS} from wishlists where id = $1`, [listId])
        const wishes = await queryAs(t, uid, `select ${WISH_COLS} from wishes where wishlist_id = $1 order by id`, [listId])
        const embed = await queryAs(t, uid, `select wl.id as list_id, w.id as wish_id from wishlists wl join wishes w on w.wishlist_id = wl.id where wl.id = $1 order by w.id`, [listId])
        const label = `${role} ${obj}`
        if (READS[role].includes(obj)) {
          expect(list, label).toHaveLength(1)
          expect(wishes.length, label).toBeGreaterThan(0)
          expect(embed.length, label).toBe(wishes.length)
        } else {
          const random = await queryAs(t, uid, `select ${LIST_COLS} from wishlists where id = $1`, [RANDOM])
          expect([list, wishes, embed], label).toEqual([random, [], []])
        }
      }
      // never a whole row, never updated_at (P9)
      await expectDbError(t.asUser(uid, (tx) => tx.query('select * from wishlists where id = $1', [s.l1])), '42501')
    }
    for (const listId of Object.values(objs)) {
      await expectDbError(t.asAnon((tx) => tx.query(`select ${LIST_COLS} from wishlists where id = $1`, [listId])), '42501')
      await expectDbError(t.asAnon((tx) => tx.query(`select ${WISH_COLS} from wishes where wishlist_id = $1`, [listId])), '42501')
    }
  })

  it('get_list_screen: the owner\'s branch for O, the follower\'s for F on L1, else exactly the random UUID\'s not_found', async () => {
    for (const [role, uid] of Object.entries(ids) as [Role, string][]) {
      const random = await rpcOutcome(t, uid, 'get_list_screen', [RANDOM])
      expect(random).toBe('error:P0001:not_found')
      for (const [obj, listId] of Object.entries(objs) as [Obj, string][]) {
        const outcome = await rpcOutcome(t, uid, 'get_list_screen', [listId])
        const label = `${role} ${obj}`
        if (obj !== 'O1' && READS[role].includes(obj)) {
          const screen = JSON.parse(outcome) as { viewer: { role: string }; wishes: { reserved: boolean | null }[] }
          expect(screen.viewer.role, label).toBe(role === 'O' ? 'owner' : 'follower')
          for (const w of screen.wishes) expect(w.reserved, label).toBe(role === 'O' ? null : false)
        } else {
          expect(outcome, label).toBe(random) // an occasion's list lives on the occasion screen: not_found for everybody
        }
      }
    }
    await expectDbError(t.asAnon((tx) => tx.query('select public.get_list_screen($1)', [s.l1])), '42501')
  })

  it('get_profile_card(Paula): lists only for F; can_find_gift for F and G; R / B / X get the random UUID\'s not_found', async () => {
    const expected: Record<Role, { visible: boolean; lists?: string[]; gift?: boolean }> = {
      O: { visible: true, lists: [], gift: false },
      F1: { visible: true, lists: [s.l1], gift: true },
      F2: { visible: true, lists: [s.l1], gift: true },
      P: { visible: true, lists: [], gift: false }, // her own outgoing request is a relation she sees
      Pref: { visible: true, lists: [], gift: false }, // refused silently: exactly like waiting (INV-3)
      R: { visible: false }, // no shared occasion, no relation she can see — §4.3 "only with a shared occasion"
      G: { visible: true, lists: [], gift: true }, // the occasion list O1 is readable for the guest
      B: { visible: false },
      X: { visible: false },
    }
    for (const [role, uid] of Object.entries(ids) as [Role, string][]) {
      const outcome = await rpcOutcome(t, uid, 'get_profile_card', [s.paula])
      const e = expected[role]
      if (!e.visible) {
        expect(outcome, role).toBe(await rpcOutcome(t, uid, 'get_profile_card', [RANDOM]))
        continue
      }
      const card = JSON.parse(outcome) as { lists: { id: string }[]; can_find_gift: boolean }
      expect(card.lists.map((l) => l.id), role).toEqual(e.lists)
      expect(card.can_find_gift, role).toBe(e.gift)
      expect(outcome, role).not.toContain(s.l2) // "Nur ich" never
    }
  })

  it('get_lists_overview: L1 only for F, L2 only for O, O1\'s list for O (mine) and G ("Bald")', async () => {
    for (const [role, uid] of Object.entries(ids) as [Role, string][]) {
      const text = await rpcOutcome(t, uid, 'get_lists_overview')
      const seen = (Object.entries(objs) as [Obj, string][]).filter(([, id]) => text.includes(id)).map(([obj]) => obj)
      expect(seen, role).toEqual(READS[role])
      expect(text, role).not.toMatch(/reserv/i)
    }
  })

  it('get_free_wishes(Paula): F gets L1\'s wishes, G only O1\'s, everybody else the random UUID\'s not_found', async () => {
    const l1Wishes = [...s.l1Wishes].sort()
    for (const [role, uid] of Object.entries(ids) as [Role, string][]) {
      const outcome = await rpcOutcome(t, uid, 'get_free_wishes', [s.paula, null])
      if (role === 'F1' || role === 'F2' || role === 'G') {
        const ideas = (JSON.parse(outcome) as { ideas: { wish_id: string }[] }).ideas.map((i) => i.wish_id).sort()
        expect(ideas, role).toEqual(role === 'G' ? [s.o1Wish] : l1Wishes)
      } else {
        expect(outcome, role).toBe(await rpcOutcome(t, uid, 'get_free_wishes', [RANDOM, null]))
        expect(outcome, role).toBe('error:P0001:not_found')
      }
    }
  })

  it('REST writes of everybody but the owner: 0 rows / 42501; visibility through REST: 42501 even for the owner', async () => {
    const before = await scalar<string>(t.db, `select string_agg(id::text || title || coalesce(cover_tone::text, '-') || visibility, ',' order by id) from wishlists where owner_id = $1`, [s.paula])
    const wishesBefore = await scalar<number>(t.db, `select count(*)::int from wishes w join wishlists wl on wl.id = w.wishlist_id where wl.owner_id = $1`, [s.paula])
    for (const [role, uid] of Object.entries(ids) as [Role, string][]) {
      for (const listId of Object.values(objs)) {
        await expectDbError(t.asUser(uid, (tx) => tx.query(`update wishlists set visibility = 'followers' where id = $1`, [listId])), '42501')
        if (role === 'O') continue
        expect(await execAs(t, uid, `update wishlists set title = 'x', cover_tone = 1 where id = $1`, [listId]), role).toBe(0)
        expect(await execAs(t, uid, `delete from wishlists where id = $1`, [listId]), role).toBe(0)
        await expectDbError(t.asUser(uid, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'x')`, [listId])), '42501')
        expect(await execAs(t, uid, `update wishes set title = 'x' where wishlist_id = $1`, [listId]), role).toBe(0)
        expect(await execAs(t, uid, `delete from wishes where wishlist_id = $1`, [listId]), role).toBe(0)
      }
      if (role !== 'O') {
        await expectDbError(
          t.asUser(uid, (tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, 'Für Paula', 'followers')`, [s.paula])),
          '42501',
        )
      }
    }
    expect(await scalar<string>(t.db, `select string_agg(id::text || title || coalesce(cover_tone::text, '-') || visibility, ',' order by id) from wishlists where owner_id = $1`, [s.paula])).toBe(before)
    expect(await scalar<number>(t.db, `select count(*)::int from wishes w join wishlists wl on wl.id = w.wishlist_id where wl.owner_id = $1`, [s.paula])).toBe(wishesBefore)
  })

  it('the reservations table is closed for every role and every shape (42501)', async () => {
    for (const uid of Object.values(ids)) {
      for (const sql of [`select count(*) from reservations`, `select r.id from reservations r join wishes w on w.id = r.wish_id where w.wishlist_id = '${s.l1}'`]) {
        const err = await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
        expect(err.message).toMatch(/permission denied for table reservations/)
      }
    }
  })
})

interface Suggestion {
  profile: { id: string; display_name: string }
  shared_occasion_title: string
}
const suggestionsOf = async (uid: string) => (await rpc<{ suggestions: Suggestion[] }>(t, uid, 'get_lists_overview')).suggestions
const suggestedIds = async (uid: string) => (await suggestionsOf(uid)).map((x) => x.profile.id)

describe('F02 suggestions "Aus deinen Anlässen" (§2.4, §5.2, review #7)', () => {
  it('the seed: Moritz (switched on, shares O1/O2) for Paula, Finn and Bea; nobody for Moritz, Greta, Rosa, Xaver', async () => {
    const s = await seedFollows(t)
    // Paula shares O2 (in 10 days) and O1 (in 20 days) with Moritz: the first upcoming one names the suggestion
    expect(await suggestionsOf(s.paula)).toEqual([{ profile: { id: s.moritz, display_name: NAMES.moritz, photo: null, banner_photo: null }, shared_occasion_title: O2_TITLE }])
    expect(await suggestionsOf(s.finn)).toEqual([{ profile: { id: s.moritz, display_name: NAMES.moritz, photo: null, banner_photo: null }, shared_occasion_title: O2_TITLE }])
    expect(await suggestedIds(s.bea)).toEqual([s.moritz])
    for (const uid of [s.moritz, s.greta, s.rosa, s.xaver]) expect(await suggestedIds(uid), uid).toEqual([])
    // Moritz switches off: gone at once, for everybody
    await execAs(t, s.moritz, 'update profiles set in_suggestions = false where id = $1', [s.moritz])
    for (const uid of [s.paula, s.finn, s.bea]) expect(await suggestedIds(uid), uid).toEqual([])
    // a new profile is off by default
    const fresh = await createMember(t, 'Anna')
    expect((await rpc<{ profile: { in_suggestions: boolean } }>(t, fresh, 'get_me')).profile.in_suggestions).toBe(false)
    expect(await scalar<boolean>(t.db, 'select in_suggestions from profiles where id = $1', [fresh])).toBe(false)
  })

  it('no block, no relation visible to me, current legal records, a name', async () => {
    const s = await seedFollows(t)
    // Bea switches on: blocked with Paula -> never for Paula, but for Finn and Moritz (O2)
    await execAs(t, s.bea, 'update profiles set in_suggestions = true where id = $1', [s.bea])
    expect(await suggestedIds(s.paula)).toEqual([s.moritz])
    expect((await suggestedIds(s.finn)).sort()).toEqual([s.bea, s.moritz].sort())
    expect(await suggestedIds(s.moritz)).toEqual([s.bea])
    // Greta (switched on) joins Paula's O1 — she follows Paula: a relation Paula sees, so no suggestion …
    await rpc(t, s.greta, 'accept_invite', [s.o1Invite])
    expect(await suggestedIds(s.paula)).toEqual([s.moritz])
    // … until she unfollows: then she is suggested (O1)
    await rpc(t, s.greta, 'unfollow', [s.paula])
    expect(await suggestionsOf(s.paula)).toEqual([
      { profile: { id: s.greta, display_name: NAMES.greta, photo: null, banner_photo: null }, shared_occasion_title: O1_TITLE },
      { profile: { id: s.moritz, display_name: NAMES.moritz, photo: null, banner_photo: null }, shared_occasion_title: O2_TITLE },
    ])
    // my own outgoing request is a relation, too
    expect(await rpc(t, s.paula, 'request_follow', [s.greta])).toEqual({ status: 'requested' })
    expect(await suggestedIds(s.paula)).toEqual([s.moritz])
    await rpc(t, s.paula, 'unfollow', [s.greta])
    // without the current legal records Moritz is not suggested
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'terms'`, [s.moritz]))
    expect(await suggestedIds(s.paula)).toEqual([s.greta])
    await t.asUser(s.moritz, (tx) =>
      tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions where kind = 'terms'`, [s.moritz]),
    )
    expect(await suggestedIds(s.paula)).toEqual([s.greta, s.moritz])
    // a person without a name is never suggested
    await t.asService((tx) => tx.query('update profiles set display_name = null where id = $1', [s.greta]))
    expect(await suggestedIds(s.paula)).toEqual([s.moritz])
    await checkInvariants(t)
  })

  it('MY silence hides the person from MY suggestions; THEIR silence never matters (P4, INV-3b)', async () => {
    const s = await seedFollows(t)
    // Moritz asks Paula (shared O1) — a visible request = a relation — Paula refuses silently: still hidden
    expect(await rpc(t, s.moritz, 'request_follow', [s.paula])).toEqual({ status: 'requested' })
    expect(await suggestedIds(s.paula)).toEqual([])
    const cooldownsBefore = await cooldownRows(t)
    await rpc(t, s.paula, 'respond_follow', [s.moritz, false])
    expect(await suggestedIds(s.paula)).toEqual([])
    const paulaBefore = await rpcOutcome(t, s.paula, 'get_lists_overview')
    // whatever Moritz does now, Paula's overview does not move (withdraw, ask again, switch suggestions off / on)
    await rpc(t, s.moritz, 'unfollow', [s.paula])
    expect(await rpcOutcome(t, s.paula, 'get_lists_overview')).toBe(paulaBefore)
    await rpc(t, s.moritz, 'request_follow', [s.paula])
    expect(await rpcOutcome(t, s.paula, 'get_lists_overview')).toBe(paulaBefore)
    await execAs(t, s.moritz, 'update profiles set in_suggestions = false where id = $1', [s.moritz])
    await execAs(t, s.moritz, 'update profiles set in_suggestions = true where id = $1', [s.moritz])
    await rpc(t, s.moritz, 'unfollow', [s.paula])
    expect(await rpcOutcome(t, s.paula, 'get_lists_overview')).toBe(paulaBefore)
    await checkInvariants(t, { cooldownsBefore })
    // Paula's silence never touches Moritz's suggestions: Paula switches on and appears for him (shared O1 / O2)
    await execAs(t, s.paula, 'update profiles set in_suggestions = true where id = $1', [s.paula])
    expect(await suggestedIds(s.moritz)).toEqual([s.paula])
    // the silence ends by time: Moritz is suggested to Paula again
    await t.asService((tx) => tx.query(`update follow_cooldowns set until = now() - interval '1 second' where followee_id = $1 and follower_id = $2`, [s.paula, s.moritz]))
    expect(await suggestedIds(s.paula)).toEqual([s.moritz])
  })

  it('only recent occasions (upcoming or ended ≤ 30 days ago), both active; at most 10, by display_name', async () => {
    const host = await createMember(t, 'Zora')
    const [occ] = await createOccasion(t, host, 'Großes Fest', 3)
    const token = await invite(t, host, occ)
    const guests: string[] = []
    for (const name of ['Lena', 'Karl', 'Jule', 'Ivo', 'Hanna', 'Gil', 'Fee', 'Emil', 'Dora', 'Carl', 'Bo', 'Aki']) {
      const g = await createMember(t, name)
      await rpc(t, g, 'accept_invite', [token])
      await execAs(t, g, 'update profiles set in_suggestions = true where id = $1', [g])
      guests.push(g)
    }
    const names = (list: Suggestion[]) => list.map((x) => x.profile.display_name)
    expect(names(await suggestionsOf(host))).toEqual(['Aki', 'Bo', 'Carl', 'Dora', 'Emil', 'Fee', 'Gil', 'Hanna', 'Ivo', 'Jule'])
    // a guest who left is not suggested any more (both must be active)
    await rpc(t, guests[11]!, 'leave_occasion', [occ]) // Aki
    expect(names(await suggestionsOf(host))[0]).toBe('Bo')
    // ended 20 days ago: still suggested; 31 days ago: not any more
    await t.asService((tx) => tx.query(`update occasions set starts_at = now() - interval '20 days' where id = $1`, [occ]))
    expect(await suggestionsOf(host)).toHaveLength(10)
    await t.asService((tx) => tx.query(`update occasions set starts_at = now() - interval '32 days' where id = $1`, [occ]))
    expect(await suggestionsOf(host)).toEqual([])
    // and nobody is ever suggested to themself, nor via an occasion I am not in
    const outsider = await createMember(t, 'Yuri')
    expect(await suggestionsOf(outsider)).toEqual([])
    expect(await rpcOutcome(t, outsider, 'get_profile_card', [UNKNOWN_ID])).toBe('error:P0001:not_found')
  })
})
