/**
 * The two background jobs and the reminder of 20261027200000_shared_wishes.sql (design §3.2, §4.3; Codex v1.4 #2/#3/#5):
 *   SW32 private.reservations_cleanup_run(): bounded windows over the primary key, a cursor that moves past every row
 *        it looked at, finite passes (rows created after a pass started wait for the next one), dead active rows →
 *        ended ('access_ended' / 'wish_deleted' + wish_id null), orphans of ANY status → deleted, ended rows never
 *        re-labelled, private.shared_wishes_health() numbers. (Locked rows / overlapping runs: real PostgreSQL,
 *        test/concurrency/shared-wishes.test.ts.)
 *   SW33 private.unlink_past_occasion_places_run(): 7 days after an occasion's end the wishes that also live elsewhere
 *        leave its list — a promoted home included (it moves on); wishes only there stay; never early.
 *   SW14 the reminder "Was hast du bekommen?": day 1 … 7 after the end, only the host, until dismissed; in the export.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, expectRpcError, rpc } from '../pilot/seed'
import { addWish } from '../follows/seed'
import { runCleanupPass } from '../follows/invariants'
import { homeOf, placesOf, seedShared } from './shared-seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

type Run = { stale: { seen: number; done: number; pass_complete: boolean }; orphans: { seen: number; done: number; pass_complete: boolean } }
const cleanup = (window = 2000) => scalar<Run>(t.db, 'select private.reservations_cleanup_run($1)', [window])
const health = () => scalar<Record<string, unknown>>(t.db, 'select private.shared_wishes_health()')
const ghosts = (n: number, extra = '') =>
  t.db.query(
    `insert into public.reservations (wish_id, recipient_id, reserver_id, wish_title_snapshot${extra ? ', status, end_reason, ended_at' : ''})
     select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x'${extra} from generate_series(1, $1::int)`,
    [n],
  )

describe('SW32 the cleanup', () => {
  it('nobody but the migration role may run the jobs', async () => {
    const u = await createMember(t, 'Ulla')
    for (const sql of ['select private.reservations_cleanup_run()', 'select private.unlink_past_occasion_places_run()', 'select private.shared_wishes_health()']) {
      await expectDbError(t.asUser(u, (tx) => tx.query(sql)), '42501')
      await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    }
  })

  it('bounded windows: 120 dead rows with a window of 50 take three runs; the cursor resets after a complete pass', async () => {
    await runCleanupPass(t) // start from a clean slate
    await ghosts(120) // active rows whose wish, giver and recipient do not exist: dead AND orphans
    const r1 = await cleanup(50)
    expect([r1.stale.seen, r1.stale.done, r1.stale.pass_complete]).toEqual([50, 50, false])
    expect(await scalar<boolean>(t.db, `select after_id is not null from private.maintenance_state where job = 'stale'`)).toBe(true)
    const r2 = await cleanup(50)
    expect([r2.stale.seen, r2.stale.pass_complete]).toEqual([50, false])
    const r3 = await cleanup(50)
    expect(r3.stale.pass_complete).toBe(true)
    expect(await scalar<boolean>(t.db, `select after_id is null and last_pass_completed_at is not null from private.maintenance_state where job = 'stale'`)).toBe(true)
    expect(await scalar<number>(t.db, `select count(*)::int from reservations where status = 'active' and reserver_id not in (select id from profiles)`)).toBe(0)
    // and the orphans step erased them (all statuses) in its own windows
    await runCleanupPass(t)
    expect(await scalar<number>(t.db, `select count(*)::int from reservations where reserver_id not in (select id from profiles)`)).toBe(0)
  })

  it('a pass is finite: rows that arrive after it started wait for the next pass', async () => {
    await runCleanupPass(t)
    await ghosts(30)
    await t.db.query(`update reservations set created_at = now() - interval '1 hour' where reserver_id not in (select id from profiles)`)
    expect((await cleanup(10)).stale.pass_complete).toBe(false) // the pass started: its upper bound is "now"
    await t.db.query(`update private.maintenance_state set pass_upper = now() - interval '1 minute' where job in ('stale', 'orphans')`)
    await ghosts(5) // created after the pass's upper bound
    let run = await cleanup(10)
    while (!run.stale.pass_complete) run = await cleanup(10)
    expect(await scalar<number>(t.db, `select count(*)::int from reservations where status = 'active' and reserver_id not in (select id from profiles)`)).toBe(5)
    await runCleanupPass(t) // the next pass takes them
    expect(await scalar<number>(t.db, `select count(*)::int from reservations where reserver_id not in (select id from profiles)`)).toBe(0)
  })

  it('live rows stay; a dead row of a deleted wish ends as wish_deleted (wish_id null), of lost access as access_ended; ended rows keep their reason', async () => {
    const s = await seedShared(t)
    await rpc(t, s.moritz, 'reserve_wish', [s.w1]) // stays live (through OL)
    await rpc(t, s.finn, 'reserve_wish', [s.w3]) // the wish will be deleted
    await rpc(t, s.greta, 'reserve_wish', [s.l1Wishes[1]]) // Greta will be removed as follower
    await rpc(t, s.greta, 'cancel_reservation', [s.l1Wishes[1]])
    await rpc(t, s.greta, 'reserve_wish', [s.l1Wishes[1]])
    await t.asUser(s.paula, (tx) => tx.query('delete from wishes where id = $1', [s.w3]))
    await rpc(t, s.paula, 'remove_follower', [s.greta])
    expect(await health()).toMatchObject({ dead_active: 2 })
    await runCleanupPass(t)
    const state = await rows(t.db, `select reserver_id, wish_id, status, end_reason from reservations where recipient_id = $1 order by created_at`, [s.paula])
    expect(state).toEqual([
      { reserver_id: s.moritz, wish_id: s.w1, status: 'active', end_reason: null },
      { reserver_id: s.finn, wish_id: null, status: 'ended', end_reason: 'wish_deleted' },
      { reserver_id: s.greta, wish_id: s.l1Wishes[1], status: 'ended', end_reason: 'by_reserver' },
      { reserver_id: s.greta, wish_id: s.l1Wishes[1], status: 'ended', end_reason: 'access_ended' },
    ])
    // an ended row is never re-labelled (Codex v1.4 #3): not even the superuser may change its reason
    await expectDbError(t.db.query(`update reservations set end_reason = 'access_ended' where reserver_id = $1 and end_reason = 'by_reserver'`, [s.greta]), 'P0001')
    expect(await health()).toMatchObject({ dead_active: 0, orphans: 0, overdue_unlinks: 0 })
  })

  it('the giver\'s own unfollow ends his dead rows with HIS reason first; the cleanup leaves them as they are', async () => {
    const s = await seedShared(t)
    await rpc(t, s.finn, 'reserve_wish', [s.w3])
    await rpc(t, s.finn, 'unfollow', [s.paula])
    expect(await rows(t.db, 'select status, end_reason from reservations where reserver_id = $1', [s.finn])).toEqual([{ status: 'ended', end_reason: 'unfollowed' }])
    await runCleanupPass(t)
    expect(await rows(t.db, 'select status, end_reason from reservations where reserver_id = $1', [s.finn])).toEqual([{ status: 'ended', end_reason: 'unfollowed' }])
  })
})

describe('SW33 after the occasion: its extra places go after 7 days', () => {
  const endIn = (occasion: string, days: number) =>
    t.db.query(`update occasions set starts_at = now() + make_interval(days => $2::int) - interval '1 day', ends_at = null, all_day = true where id = $1`, [occasion, days])

  it('not before day 7; then W1 and W2 leave OL (back to their homes only), W4 stays; reservations are not read', async () => {
    const s = await seedShared(t)
    await rpc(t, s.moritz, 'reserve_wish', [s.w1])
    await endIn(s.o1, -6) // ended 6 days ago
    expect(await scalar(t.db, 'select private.unlink_past_occasion_places_run()')).toEqual({ occasions: 0, removed: 0 })
    expect(await placesOf(t, s.w1)).toHaveLength(2)
    await endIn(s.o1, -8)
    expect(await health()).toMatchObject({ overdue_unlinks: 1 }) // due for a day already: the daily check would flag it
    expect(await scalar(t.db, 'select private.unlink_past_occasion_places_run()')).toEqual({ occasions: 1, removed: 2 })
    expect(await health()).toMatchObject({ overdue_unlinks: 0 })
    expect(await placesOf(t, s.w1)).toEqual([{ wishlist_id: s.l1, home: true }])
    expect(await placesOf(t, s.w2)).toEqual([{ wishlist_id: s.l2, home: true }])
    expect(await placesOf(t, s.w4)).toEqual([{ wishlist_id: s.o1List, home: true }])
    expect(await scalar(t.db, 'select private.unlink_past_occasion_places_run()')).toEqual({ occasions: 0, removed: 0 }) // done
    // Moritz read W1 only through O1: dead now ("unavailable"), the cleanup ends it
    expect((await rpc<{ end_reason: string }[]>(t, s.moritz, 'my_reservations'))[0]!.end_reason).toBe('unavailable')
  })

  it('a promoted home moves on (Codex v1.4 #5): W in L + OL1 + OL2, L deleted → home OL1; OL1 expires → home OL2', async () => {
    const s = await seedShared(t)
    const l5 = await scalar<string>(t.db, `insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, 'L5', 'private') returning id`, [s.paula])
    const w = await addWish(t, s.paula, l5, 'Wandert')
    const [o2b, ol2] = await occasionOf(s.paula, 'Zweites Fest')
    expect(await rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [w]])).toEqual({ ok: true, added: 1 })
    expect(await rpc(t, s.paula, 'add_wishes_to_list', [ol2, [w]])).toEqual({ ok: true, added: 1 })
    await t.asUser(s.paula, (tx) => tx.query('delete from wishlists where id = $1', [l5]))
    expect(await homeOf(t, w)).toBe(s.o1List)
    await endIn(s.o1, -8)
    await t.db.query('select private.unlink_past_occasion_places_run()')
    expect(await homeOf(t, w)).toBe(ol2)
    expect(await placesOf(t, w)).toEqual([{ wishlist_id: ol2, home: true }])
    expect(o2b).toBeTruthy()
  })
})

async function occasionOf(host: string, title: string): Promise<[string, string]> {
  const id = await t.asUser(host, (tx) =>
    scalar<string>(tx, `insert into occasions (host_id, title, starts_at, tz) values ($1, $2, now() + interval '30 days', 'Europe/Berlin') returning id`, [host, title]),
  )
  return [id, await scalar<string>(t.db, 'select id from wishlists where occasion_id = $1', [id])]
}

describe('SW14 "Was hast du bekommen?"', () => {
  it('day 1 … 7 after the end, open wishes left, only the host; dismissed for good; in the export', async () => {
    const s = await seedShared(t)
    const prompt = async () => (await rpc<{ wishlist: { received_prompt?: boolean } }>(t, s.paula, 'get_occasion_screen', [s.o1])).wishlist.received_prompt
    expect(await prompt()).toBe(false) // upcoming
    await t.db.query(`update occasions set starts_at = now() - interval '2 days 1 hour', ends_at = null, all_day = true where id = $1`, [s.o1])
    expect(await prompt()).toBe(true)
    expect((await rpc<{ wishlist: Record<string, unknown> }>(t, s.moritz, 'get_occasion_screen', [s.o1])).wishlist).not.toHaveProperty('received_prompt')
    await expectRpcError(rpc(t, s.moritz, 'dismiss_received_prompt', [s.o1]), 'not_found')
    expect(await rpc(t, s.paula, 'dismiss_received_prompt', [s.o1])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'dismiss_received_prompt', [s.o1])).toEqual({ ok: true }) // idempotent
    expect(await prompt()).toBe(false)
    const exp = JSON.parse(await t.asUser(s.paula, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))) as { wishlists: { id: string; received_prompt_dismissed_at: string | null }[] }
    expect(exp.wishlists.find((l) => l.id === s.o1List)!.received_prompt_dismissed_at).toEqual(expect.any(String))
  })

  it('every open wish received → no reminder; 8 days after → no reminder', async () => {
    const s = await seedShared(t)
    await t.db.query(`update occasions set starts_at = now() - interval '2 days 1 hour', ends_at = null, all_day = true where id = $1`, [s.o1])
    for (const w of [s.w1, s.w2, s.w4]) await rpc(t, s.paula, 'set_wish_received', [w, true])
    expect((await rpc<{ wishlist: { received_prompt: boolean } }>(t, s.paula, 'get_occasion_screen', [s.o1])).wishlist.received_prompt).toBe(false)
    await rpc(t, s.paula, 'set_wish_received', [s.w4, false])
    await t.db.query(`update occasions set starts_at = now() - interval '9 days' where id = $1`, [s.o1])
    expect((await rpc<{ wishlist: { received_prompt: boolean } }>(t, s.paula, 'get_occasion_screen', [s.o1])).wishlist.received_prompt).toBe(false)
  })
})
