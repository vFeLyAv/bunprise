/**
 * 🔒 INV-7 of docs/spec/shared-wishes-design.md §2.5 — with the default option (decisions, Felix 27.10):
 *   (a) ZERO ACCESS: no action of the owner on her own data — her screens, every write on lists / wishes / places /
 *       occasions / guests / followers / visibility, "Erhalten", the reminder, deleting a wish / list / occasion /
 *       her ACCOUNT, a block — does any work on public.reservations: every counter of the table and of each of its
 *       indexes in the transaction (pg_stat_xact_user_tables, pg_stat_get_xact_* per index) stays 0.
 *   (b) BOUNDED ACCESS: what she does as a GIVER (her history, the export, the feed, a guest screen, the gift search,
 *       reserving and cancelling on somebody else's wish) reads reservations only through an index condition on her
 *       own reserver_id or on the wish_id of somebody else's wish: no sequential scan at all, and every counter is
 *       the same in worlds that differ only by 0 / 20 / 200 reservations OTHER people hold on HER wishes — and with
 *       20 000 unrelated rows after ANALYZE. (The plans themselves are checked on PostgreSQL 17:
 *       test/concurrency/shared-wishes.test.ts.)
 * Plus "owner sees nothing" for every NEW path: each new RPC answers the owner byte-identically with and without
 * reservations on the wishes it touches.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type Querier, type TestDb } from '../../src/harness'
import { rpc } from '../pilot/seed'
import { rpcText } from '../follows/seed'
import { RESERVATION_WORK_SQL, seedShared, type SharedSeed } from './shared-seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

type Work = Record<string, unknown> & { indexes: Record<string, [number, number, number]> }
class Rollback extends Error {}

/** after − before, counter by counter (PGlite flushes the pending statistics lazily: always take the difference) */
function diff(after: Work, before: Work): Work {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(after)) if (k !== 'indexes') out[k] = (v as number) - (before[k] as number)
  const indexes: Record<string, [number, number, number]> = {}
  for (const [k, xs] of Object.entries(after.indexes)) {
    const b = before.indexes[k] ?? [0, 0, 0]
    indexes[k] = [xs[0] - b[0], xs[1] - b[1], xs[2] - b[2]]
  }
  return { ...out, indexes } as Work
}

/**
 * The reservation work of `action`, run in ONE transaction as `uid` that is rolled back afterwards (a refused call
 * aborts the transaction, so a refusal is measured inside a savepoint).
 */
async function workOf(uid: string, action: (tx: Querier) => Promise<unknown>): Promise<Work> {
  let work: Work | null = null
  try {
    await t.asUser(uid, async (tx) => {
      const before = JSON.parse(await scalar<string>(tx, RESERVATION_WORK_SQL)) as Work
      await tx.query('savepoint measured')
      try {
        await action(tx)
      } catch (err) {
        if (!(typeof err === 'object' && err !== null && 'code' in err)) throw err // a refusal is an answer too
        await tx.query('rollback to savepoint measured')
      }
      const after = JSON.parse(await scalar<string>(tx, RESERVATION_WORK_SQL)) as Work
      work = diff(after, before)
      throw new Rollback()
    })
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  }
  if (!work) throw new Error('no counters')
  return work
}

function isZero(w: Work): boolean {
  const { indexes, ...table } = w
  return Object.values(table).every((v) => v === 0) && Object.values(indexes).every((xs) => xs.every((v) => v === 0))
}

const call = (fn: string, args: readonly unknown[] = []) => (tx: Querier) =>
  tx.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, [...args])

/** Reservations held by other people on the owner's wishes (and their history): every giver a stranger, no FK needed. */
async function othersReserveOnHerWishes(s: SharedSeed, n: number): Promise<void> {
  await t.db.query(
    `with mine as (
       insert into public.wishes (wishlist_id, title) select $1, 'Extra ' || g from generate_series(1, $2::int) g returning id)
     insert into public.reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot, status, end_reason, ended_at)
     select m.id, $1, $3, gen_random_uuid(), 'x', s.status, s.reason, s.ended
       from mine m cross join (values ('active', null::text, null::timestamptz), ('ended', 'by_reserver', now())) as s(status, reason, ended)`,
    [s.l1, n, s.paula],
  )
}

describe('the counters work (positive controls)', () => {
  it('a giver reading her history counts index work; a superuser seq scan counts too', async () => {
    const s = await seedShared(t)
    await rpc(t, s.moritz, 'reserve_wish', [s.w1])
    const w = await workOf(s.moritz, call('my_reservations'))
    expect(isZero(w)).toBe(false)
    expect(w['seq_scan']).toBe(0)
  })
})

describe('INV-7 (a): zero access for every action of the owner on her own data', () => {
  let s: SharedSeed
  beforeAll(async () => {
    s = await seedShared(t)
    // reservations of three givers on her wishes, one through an extra place, plus a cancelled one
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect(await rpc(t, s.finn, 'reserve_wish', [s.w3])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'reserve_wish', [s.w4])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'reserve_wish', [s.l1Wishes[1]])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'cancel_reservation', [s.l1Wishes[1]])).toEqual({ ok: true })
  })

  const actions: [string, (s: SharedSeed) => (tx: Querier) => Promise<unknown>][] = [
    ['get_occasion_screen (host)', (s) => call('get_occasion_screen', [s.o1])],
    ['get_list_screen L1', (s) => call('get_list_screen', [s.l1])],
    ['get_list_screen L2', (s) => call('get_list_screen', [s.l2])],
    ['get_lists_overview', () => call('get_lists_overview')],
    ['get_me', () => call('get_me')],
    ['get_people_screen', () => call('get_people_screen')],
    ['get_profile_card (self)', (s) => call('get_profile_card', [s.paula])],
    ['get_wish_photo', (s) => call('get_wish_photo', [s.w1])],
    ['add_wishes_to_list', (s) => call('add_wishes_to_list', [s.o1List, [s.w3]])],
    ['add_wishes_to_list (already there)', (s) => call('add_wishes_to_list', [s.o1List, [s.w1, s.w2]])],
    ['remove_wish_from_list (extra place)', (s) => call('remove_wish_from_list', [s.w1, s.o1List])],
    ['remove_wish_from_list (home)', (s) => call('remove_wish_from_list', [s.w1, s.l1])],
    ['remove_wish_from_list (last place: validation)', (s) => call('remove_wish_from_list', [s.w4, s.o1List])],
    ['delete_wish_everywhere', (s) => call('delete_wish_everywhere', [s.w1])],
    ['move_wish (unshared)', (s) => call('move_wish', [s.w3, s.l2])],
    ['move_wish (shared: validation)', (s) => call('move_wish', [s.w1, s.l2])],
    ['set_wish_received', (s) => call('set_wish_received', [s.w1, true])],
    ['set_list_visibility → private', (s) => call('set_list_visibility', [s.l1, 'private'])],
    ['dismiss_received_prompt', (s) => call('dismiss_received_prompt', [s.o1])],
    ['remove_member (Moritz)', (s) => call('remove_member', [s.o1, s.moritz])],
    ['remove_follower (Finn)', (s) => call('remove_follower', [s.finn])],
    ['block_user (Greta)', (s) => call('block_user', [s.greta])],
    ['REST insert wish', (s) => (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'Neu') returning id`, [s.l1])],
    ['REST update wish', (s) => (tx) => tx.query(`update wishes set title = 'Neu', price_cents = 100 where id = $1`, [s.w1])],
    ['REST delete wish (unshared)', (s) => (tx) => tx.query('delete from wishes where id = $1', [s.w3])],
    ['REST delete wish (shared: guard)', (s) => (tx) => tx.query('delete from wishes where id = $1', [s.w1])],
    ['REST delete list L1', (s) => (tx) => tx.query('delete from wishlists where id = $1', [s.l1])],
    ['REST delete occasion O1', (s) => (tx) => tx.query('delete from occasions where id = $1', [s.o1])],
    ['REST update occasion date', (s) => (tx) => tx.query(`update occasions set starts_at = now() - interval '9 days' where id = $1`, [s.o1])],
    ['delete_my_account', () => call('delete_my_account')],
  ]

  for (const [name, action] of actions) {
    it(`${name}: no work on reservations`, async () => {
      const w = await workOf(s.paula, action(s))
      expect(w, JSON.stringify(w)).toSatisfy(isZero)
    })
  }
})

describe('INV-7 (b): the owner as a giver — bounded work, independent of the reservations on her wishes', () => {
  /**
   * What must not move: sequential scans, and the index entries every index hands out (pg_stat_get_xact_tuples_returned).
   * (Heap fetches are left out on purpose: an index scan and a bitmap scan attribute them differently, and the planner
   * may switch between the two when the table grows — Codex v1.4 #4. The entries returned are the work either way.)
   */
  const bounded = (w: Work) => ({
    seq_scan: w['seq_scan'],
    seq_tup_read: w['seq_tup_read'],
    returned: Object.fromEntries(Object.entries(w.indexes).map(([k, xs]) => [k, xs[1]])),
  })

  /** Paula is a guest of O2 (Moritz's occasion) with one live reservation and one cancelled; Moritz holds W1. */
  async function giverWorld(): Promise<{ s: SharedSeed; free: string }> {
    const s = await seedShared(t)
    const free = await scalar<string>(t.db, `insert into public.wishes (wishlist_id, title) values ($1, 'Würfel') returning id`, [s.o2List])
    const other = await scalar<string>(t.db, `insert into public.wishes (wishlist_id, title) values ($1, 'Karten') returning id`, [s.o2List])
    const gone = await scalar<string>(t.db, `insert into public.wishes (wishlist_id, title) values ($1, 'Puzzle') returning id`, [s.o2List])
    expect(await rpc(t, s.paula, 'reserve_wish', [other])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'reserve_wish', [gone])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'cancel_reservation', [gone])).toEqual({ ok: true })
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    return { s, free }
  }

  const reads: [string, (s: SharedSeed) => (tx: Querier) => Promise<unknown>][] = [
    ['my_reservations', () => call('my_reservations')],
    ['export_my_data', () => call('export_my_data')],
    ['get_feed', () => call('get_feed')],
    ['get_occasion_screen (guest of O2)', (x) => call('get_occasion_screen', [x.o2])],
    ['get_free_wishes (Moritz)', (x) => call('get_free_wishes', [x.moritz, null])],
  ]

  it('her reads: 0 / 20 / 200 reservations of others on her wishes, then 20 000 unrelated rows (analyzed) — the same work, no sequential scan', async () => {
    const { s } = await giverWorld()
    const measure = async () => {
      // dead index entries of HER OWN earlier writes (a cancelled row) get pruned at some later read: normalise with
      // VACUUM so every world starts from the same index pages
      await t.db.exec('vacuum public.reservations')
      const out: Record<string, ReturnType<typeof bounded>> = {}
      for (const [name, action] of reads) out[name] = bounded(await workOf(s.paula, action(s)))
      return out
    }
    const w0 = await measure()
    for (const [name, w] of Object.entries(w0)) expect([w.seq_scan, w.seq_tup_read], name).toEqual([0, 0])
    expect(w0['my_reservations']!.returned['reservations_reserver_idx']).toBeGreaterThan(0) // the control: she does read her rows
    await othersReserveOnHerWishes(s, 10) // 20 rows
    expect(await measure()).toEqual(w0)
    await othersReserveOnHerWishes(s, 90) // 200 rows
    expect(await measure()).toEqual(w0)
    await t.db.query('analyze public.reservations')
    expect(await measure()).toEqual(w0)
    await t.db.query(
      `insert into public.reservations (wish_id, recipient_id, reserver_id, wish_title_snapshot)
       select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'fremd' from generate_series(1, 20000)`,
    )
    await t.db.query('analyze public.reservations')
    expect(await measure()).toEqual(w0)
  })

  it('her writes as a giver (reserve + cancel on Moritz\'s wish, leaving O2): the same work in a world with 200 reservations on her wishes', async () => {
    const writes: [string, (x: { s: SharedSeed; free: string }) => (tx: Querier) => Promise<unknown>][] = [
      ['reserve_wish + cancel_reservation', ({ free }) => async (tx) => {
        await tx.query('select public.reserve_wish($1)', [free])
        await tx.query('select public.cancel_reservation($1)', [free])
      }],
      ['leave_occasion (O2)', ({ s }) => call('leave_occasion', [s.o2])],
    ]
    const empty = await giverWorld()
    const busy = await giverWorld()
    await othersReserveOnHerWishes(busy.s, 100)
    for (const [name, action] of writes) {
      const a = bounded(await workOf(empty.s.paula, action(empty)))
      const b = bounded(await workOf(busy.s.paula, action(busy)))
      expect([a.seq_scan, a.seq_tup_read], name).toEqual([0, 0])
      expect(b, name).toEqual(a)
    }
  })
})

describe('owner sees nothing: every new path answers her the same with and without reservations', () => {
  it('add / remove / delete everywhere / dismiss / move refusal: byte-identical answers in two worlds', async () => {
    const a = await seedShared(t)
    const b = await seedShared(t)
    // world A: every wish involved is reserved (through each kind of place); world B: none
    expect(await rpc(t, a.moritz, 'reserve_wish', [a.w1])).toEqual({ ok: true })
    expect(await rpc(t, a.greta, 'reserve_wish', [a.w2])).toEqual({ ok: true })
    expect(await rpc(t, a.finn, 'reserve_wish', [a.w3])).toEqual({ ok: true })
    const steps: [string, (s: SharedSeed) => readonly unknown[]][] = [
      ['add_wishes_to_list', (s) => [s.o1List, [s.w3]]],
      ['add_wishes_to_list', (s) => [s.o1List, [s.w1, s.w2, s.w3]]],
      ['move_wish', (s) => [s.w1, s.l2]],
      ['remove_wish_from_list', (s) => [s.w3, s.o1List]],
      ['remove_wish_from_list', (s) => [s.w1, s.l1]],
      ['remove_wish_from_list', (s) => [s.w1, s.o1List]],
      ['dismiss_received_prompt', (s) => [s.o1]],
      ['delete_wish_everywhere', (s) => [s.w2]],
    ]
    for (const [fn, args] of steps) {
      const answer = async (s: SharedSeed) => {
        try {
          return await rpcText(t, s.paula, fn, args(s))
        } catch (err) {
          return `error:${(err as { message?: string }).message ?? '?'}`
        }
      }
      expect(await answer(a), fn).toBe(await answer(b))
    }
  })
})
