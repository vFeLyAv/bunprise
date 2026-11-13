/**
 * F08 — the owner's bytes (INV-2, follows-design §6.2, S1, S4–S6; M3 20261020200200_follow_sharing.sql):
 *   reserve, cancel, reserve again, already_reserved by Finn and Greta on L1 (plus their own screen reads) -> Paula's
 *   whole world is byte-identical: every SELECT-granted column of every API table, every read RPC (get_me, get_feed,
 *   get_lists_overview, get_people_screen, my_reservations, the export, the screens of L1 / L2 / her occasions, her own
 *   card and the cards of the givers). No reservation id ever reaches her, and the owner branch of the list screen
 *   carries only the literal nulls.
 *   The REST probes of test/attack/round1-rest-oracles.test.ts, copied and pointed at L1 (a follower list): for the
 *   owner, both followers, the waiting, the guest, the blocked and the outsider every probe is "permission denied for
 *   table reservations" (anon: denied at the first table), and not one row is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, rpc } from '../pilot/seed'
import { rpcText, seedFollows, type FollowSeed } from '../follows/seed'
import { checkInvariants, cooldownRows, ownerSnapshot } from '../follows/invariants'

let t: TestDb
let s: FollowSeed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedFollows(t)
})
afterAll(() => t.close())

/** The probes of round1-rest-oracles (reservationProbes), against the wishes of a follower list. */
function reservationProbes(w: string, wl: string): string[] {
  return [
    `select count(*) from wishes w where exists (select 1 from reservations r where r.wish_id = w.id)`,
    `select w.id from wishes w where w.id in (select r.wish_id from reservations r)`,
    `select w.id from wishes w where w.id = any (array(select r.wish_id from reservations r))`,
    `select w.id from wishes w join reservations r on r.wish_id = w.id`,
    `select w.id from wishes w left join reservations r on r.wish_id = w.id and r.status = 'active'`,
    `select w.id, (select count(*) from reservations r where r.wish_id = w.id) as n from wishes w`,
    `select w.id from wishes w order by (select count(*) from reservations r where r.wish_id = w.id) desc`,
    `select w.id from wishes w order by exists (select 1 from reservations r where r.wish_id = w.id)`,
    `select w.id from wishes w, lateral (select r.id from reservations r where r.wish_id = w.id) x`,
    `with r as (select wish_id from reservations) select w.id from wishes w join r on r.wish_id = w.id`,
    `select * from reservations limit 0`,
    `select 1 from reservations where false`,
    `select count(*) from reservations where wish_id = '${w}'`,
    `select exists (select 1 from reservations where wish_id = '${w}')`,
    `select reservations from reservations`,
    `table reservations`,
    `select * from public.reservations tablesample system (100)`,
    `explain select * from reservations`,
    `explain (format json) select w.id from wishes w where exists (select 1 from reservations r where r.wish_id = w.id)`,
    `select id from wishes union all select wish_id from reservations`,
    `select wl.id from wishlists wl where exists (select 1 from reservations r where r.wishlist_id = wl.id)`,
    `select wl.id from wishlists wl where wl.id = '${wl}' and exists (select 1 from reservations r where r.wishlist_id = wl.id and r.status = 'active')`,
    `select o.id from occasions o where exists (select 1 from reservations r join wishlists wl on wl.id = r.wishlist_id where wl.occasion_id = o.id)`,
    `select p.id from profiles p where exists (select 1 from reservations r where r.reserver_id = p.id)`,
    `select m.profile_id from occasion_members m where exists (select 1 from reservations r where r.reserver_id = m.profile_id)`,
    `select case when (select count(*) from reservations) > 0 then 1 else 0 end`,
    `select 1 where (select count(*) from reservations where wish_id = '${w}') > 0`,
    `select count(*) filter (where exists (select 1 from reservations r where r.wish_id = w.id)) from wishes w`,
    `select string_agg(r.status, ',') from reservations r`,
    `select r.* from wishes w cross join reservations r`,
    `update wishes set note = null where exists (select 1 from reservations r where r.wish_id = wishes.id)`,
    `delete from wishes where exists (select 1 from reservations r where r.wish_id = wishes.id)`,
    `update wishes set priority = 1 where id in (select wish_id from reservations)`,
    // follower-list specific (M3): through the list's own columns and the follow tables
    `select wl.id, wl.visibility from wishlists wl where wl.id = '${wl}' and exists (select 1 from reservations r where r.recipient_id = wl.owner_id)`,
    `select w.id from wishes w where w.wishlist_id = '${wl}' order by (select max(r.created_at) from reservations r where r.wish_id = w.id)`,
    `select wl.id from wishlists wl join follows f on f.followee_id = wl.owner_id where exists (select 1 from reservations r where r.reserver_id = f.follower_id)`,
  ]
}

describe('F08 INV-2: Paula\'s world does not move with the givers\' traffic on L1', () => {
  it('reserve / cancel / reserve again / already_reserved by Finn and Greta: byte-identical, no reservation id', async () => {
    const [w1, w2, w3] = s.l1Wishes
    const opts = { occasionIds: [s.o1, s.o2], listIds: [s.l1, s.l2], profileIds: [s.finn, s.greta, s.rosa, s.moritz] }
    const before = await ownerSnapshot(t, s.paula, opts)
    const idsBefore = (await rows<{ id: string }>(t.db, 'select id from reservations')).map((r) => r.id)
    const cooldownsBefore = await cooldownRows(t)

    await rpc(t, s.finn, 'reserve_wish', [w1])
    expect(await ownerSnapshot(t, s.paula, opts)).toEqual(before)
    await rpc(t, s.greta, 'reserve_wish', [w2])
    await rpc(t, s.greta, 'cancel_reservation', [w2])
    await rpc(t, s.finn, 'reserve_wish', [w2])
    await rpc(t, s.greta, 'reserve_wish', [w1]).catch(() => undefined) // already_reserved: must leave no trace either
    await rpc(t, s.finn, 'cancel_reservation', [w1])
    await rpc(t, s.greta, 'reserve_wish', [w1])
    await rpc(t, s.greta, 'reserve_wish', [w3])
    await rpc(t, s.finn, 'reserve_wish', [w3]).catch(() => undefined)
    for (const uid of [s.finn, s.greta]) {
      await rpc(t, uid, 'get_list_screen', [s.l1])
      await rpc(t, uid, 'my_reservations')
      await rpc(t, uid, 'get_lists_overview')
      await rpc(t, uid, 'get_free_wishes', [s.paula])
    }
    const after = await ownerSnapshot(t, s.paula, opts)
    expect(after).toEqual(before)
    await checkInvariants(t, { cooldownsBefore })

    const newIds = (await rows<{ id: string }>(t.db, 'select id from reservations')).map((r) => r.id).filter((id) => !idsBefore.includes(id))
    expect(newIds.length).toBeGreaterThanOrEqual(5)
    const text = JSON.stringify(after)
    for (const id of newIds) expect(text).not.toContain(id)
    // the owner's list screen: exactly the literal nulls (3 wishes × 2 keys), the overview: no "reserv" at all
    expect((after[`list:${s.l1}`] as string).match(/reserv/g)).toHaveLength(6)
    expect(after['get_lists_overview']).not.toMatch(/reserv/i)
    expect(after['my_reservations']).toBe('[]')
    // the people screen names her followers (her own data), but nothing next to them changed
    expect(after['get_people_screen']).toContain(s.finn)
  })

  it('the cancelled / ended rows of the givers never surface for the owner either (export, my_reservations)', async () => {
    const exported = await rpcText(t, s.paula, 'export_my_data')
    expect(exported.replace('reservations_made_by_me', '')).not.toMatch(/reserv/)
    expect(JSON.parse(exported)['reservations_made_by_me']).toEqual([])
  })
})

describe('F08 the REST probes of round 1 against the follower list L1', () => {
  it('owner, followers, waiting, guest, blocked, outsider: "permission denied for table reservations", nothing touched', async () => {
    const [w1] = s.l1Wishes
    const wishesBefore = await countAll(t, 'wishes', 'wishlist_id = $1', [s.l1])
    const activeBefore = await countAll(t, 'reservations', `status = 'active'`)
    const probes = reservationProbes(w1, s.l1)
    expect(probes.length).toBeGreaterThanOrEqual(30)
    for (const uid of [s.paula, s.finn, s.greta, s.rosa, s.moritz, s.bea, s.xaver]) {
      for (const sql of probes) {
        const err = await expectDbError(t.asUser(uid, (tx) => rows(tx, sql)), '42501')
        expect(err.message, `${uid}: ${sql}`).toMatch(/permission denied for table (reservations|follows)/)
        expect(err.message, sql).not.toMatch(/duplicate|unique|violates/)
      }
    }
    for (const sql of probes) {
      const err = await expectDbError(t.asAnon((tx) => rows(tx, sql)), '42501')
      expect(err.message, sql).toMatch(/permission denied for table/)
    }
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.l1])).toBe(wishesBefore)
    expect(await countAll(t, 'reservations', `status = 'active'`)).toBe(activeBefore)
    expect(await scalar<string>(t.db, `select visibility from wishlists where id = $1`, [s.l1])).toBe('followers')
  })

  it('a follower reads L1\'s wishes through REST — and nothing about reservations comes with them', async () => {
    const cols = 'id, wishlist_id, title, price_cents, currency, url, note, priority, created_at'
    const asFinn = await t.asUser(s.finn, (tx) => rows<Record<string, unknown>>(tx, `select ${cols} from wishes where wishlist_id = $1 order by id`, [s.l1]))
    expect(asFinn).toHaveLength(3)
    for (const r of asFinn) expect(Object.keys(r).sort()).toEqual(cols.split(', ').sort())
    await expectDbError(t.asUser(s.finn, (tx) => tx.query('select updated_at from wishes where wishlist_id = $1', [s.l1])), '42501')
    await expectDbError(t.asUser(s.finn, (tx) => tx.query('select xmax from wishes where wishlist_id = $1', [s.l1])), '42501')
  })
})
