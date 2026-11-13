/**
 * One wish in several lists under concurrency, on real PostgreSQL 17 (docs/decisions/0002-concurrency-tests-real-
 * postgres.md; supabase/migrations/20261027200000_shared_wishes.sql; design §6.3). The follow world (./world.ts):
 * Paula owns L1 (followers Finn + Greta) and O1 (guest Moritz); "Wunsch 1" lives in L1 AND in O1's list.
 *   SC-A  reserve_wish (Finn, through L1) ↔ reserve_wish (Moritz, through O1)    exactly one wins, the other
 *         already_reserved — ONE reservation for every place (both orders + unsynchronised races)
 *   SC-B  add_wishes_to_list (into O1) ↔ reserve_wish (Moritz)                   after the add: ok / before: not_allowed
 *   SC-C  remove_wish_from_list (from O1) ↔ reserve_wish (Moritz)                after the removal: not_allowed /
 *         before: ok, then dead (the cleanup ends it)
 *   SC-CL1 the cleanup ↔ the giver's own unfollow on his dead row               ended exactly once, never re-labelled
 *         (Codex v1.4 #3: status re-checked after the row lock)
 *   SC-CL2 the cleanup ↔ another giver reserving the wish of a dead row         never two active rows, no error
 *   SC28  two cleanup runs at once                                              the cursor row serialises them
 *   SC22  the unlink job ↔ the host moving the occasion's date (REST)           the job re-checks the date after the
 *         occasion's row lock: moved into the future first → nothing unlinked
 *   PLANS (INV-7 b) with auto_explain on every nested statement, on a table of 20 000 unrelated rows (analyzed): a
 *         giver's functions touch reservations only by an index condition on wish_id or reserver_id; the owner's
 *         actions do not touch the table at all (INV-7 a).
 */
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type Outcome, type RealPg, type Session } from '../../src/realpg'
import { OK, rpcError } from './pairs'
import { activeReserversOf, cleanupPass, inv1Violations, reservationsBy, rpcAs, seedFollowWorld, type FollowWorld } from './world'

const ROUNDS = 12

let db: RealPg
let s1: Session
let s2: Session

beforeAll(async () => {
  db = await startRealPg()
  s1 = await db.session('tx-1')
  s2 = await db.session('tx-2')
  await db.admin.query('update private.features set shared_wishes = true')
})
afterAll(async () => {
  await db?.close()
})

interface SharedWorld extends FollowWorld {
  ol: string
  shared: string
}

async function sharedWorld(): Promise<SharedWorld> {
  const w = await seedFollowWorld(db)
  const ol = await db.admin.value<string>('select id from public.wishlists where occasion_id = $1', [w.o1])
  expect(await rpcAs(db, w.paula, 'add_wishes_to_list', [ol, [w.wishes[0]]])).toEqual({ ok: true, added: 1 })
  return { ...w, ol, shared: w.wishes[0]! }
}

type Op = { label: string; as: string | null; run: (s: Session) => Promise<unknown> }
const rpcOp = (label: string, as: string | null, fn: string, args: readonly unknown[] = []): Op => ({ label, as, run: (s) => s.rpc(fn, args) })
const sqlOp = (label: string, as: string | null, sql: string, params: readonly unknown[] = []): Op => ({
  label,
  as,
  run: async (s) => (await s.query(sql, params)).rowCount,
})

async function begin(s: Session, as: string | null): Promise<void> {
  if (as === null) await s.begin()
  else await s.begin(as)
}

/**
 * `first` runs in an open transaction; `second` starts on another connection. When `blocks` is set it must wait for
 * the first (pg_blocking_pids) — otherwise it must NOT wait (SKIP LOCKED) — then the first commits.
 */
async function hold(first: Op, second: Op, blocks: boolean): Promise<{ first: Outcome; second: Outcome }> {
  await begin(s1, first.as)
  const a = await settle(first.run(s1))
  if (!a.ok) {
    await s1.rollback()
    throw new Error(`${first.label} failed while holding: ${JSON.stringify(a)}`)
  }
  await begin(s2, second.as)
  const pending = settle(second.run(s2))
  if (blocks) {
    try {
      await db.waitUntilBlocked(s2, s1, pending)
    } catch (err) {
      await s1.rollback().catch(() => undefined)
      await pending
      await s2.rollback().catch(() => undefined)
      throw err
    }
    await s1.commit()
    const b = await pending
    await (b.ok ? s2.commit() : s2.rollback())
    return { first: a, second: b }
  }
  const b = await pending // must finish while the first still holds its locks
  await (b.ok ? s2.commit() : s2.rollback())
  await s1.commit()
  return { first: a, second: b }
}

async function race(x: Op, y: Op, xFirst: boolean, stagger: number): Promise<{ x: Outcome; y: Outcome }> {
  const run = async (s: Session, op: Op, delay: number) => {
    for (let i = 0; i < delay; i++) await s.query('select 1')
    await begin(s, op.as)
    const out = await settle(op.run(s))
    await (out.ok ? s.commit() : s.rollback())
    return out
  }
  const [x2, y2] = await Promise.all([run(s1, x, xFirst ? 0 : stagger), run(s2, y, xFirst ? stagger : 0)])
  return { x: x2, y: y2 }
}

const NEVER = ['40P01', '55P03', '57014', '40001', '23505', '23503']
function contract(out: Outcome, label: string): void {
  if (!out.ok) expect(NEVER, `${label}: ${out.code} ${out.message}`).not.toContain(out.code)
}

describe('SC-A one reservation for every place: Finn (L1) ↔ Moritz (O1) on the same wish', () => {
  const finn = (w: SharedWorld) => rpcOp('reserve_wish (Finn, through L1)', w.finn, 'reserve_wish', [w.shared])
  const moritz = (w: SharedWorld) => rpcOp('reserve_wish (Moritz, through O1)', w.moritz, 'reserve_wish', [w.shared])

  it('Finn holds → Moritz waits on the pair lock of the recipient → already_reserved', async () => {
    const w = await sharedWorld()
    const out = await hold(finn(w), moritz(w), true)
    expect(out).toEqual({ first: OK, second: rpcError('already_reserved') })
    expect(await activeReserversOf(db, w.shared)).toEqual([w.finn])
    expect(await inv1Violations(db)).toBe(0)
  })

  it('Moritz holds → Finn waits → already_reserved', async () => {
    const w = await sharedWorld()
    const out = await hold(moritz(w), finn(w), true)
    expect(out).toEqual({ first: OK, second: rpcError('already_reserved') })
    expect(await activeReserversOf(db, w.shared)).toEqual([w.moritz])
  })

  it(`${ROUNDS} unsynchronised rounds: exactly one wins, never a raw error`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const w = await sharedWorld()
      const out = await race(finn(w), moritz(w), round % 2 === 0, Math.floor(round / 2))
      contract(out.x, 'finn')
      contract(out.y, 'moritz')
      expect([out.x, out.y].filter((o) => o.ok)).toEqual([OK])
      expect([out.x, out.y].filter((o) => !o.ok)).toEqual([rpcError('already_reserved')])
      expect(await activeReserversOf(db, w.shared)).toEqual([out.x.ok ? w.finn : w.moritz])
      expect(await inv1Violations(db)).toBe(0)
    }
  })
})

describe('SC-B add_wishes_to_list ↔ reserve_wish of a guest who reads it only through the new place', () => {
  const add = (w: SharedWorld) => rpcOp('add_wishes_to_list (Paula, Wunsch 2 → O1)', w.paula, 'add_wishes_to_list', [w.ol, [w.wishes[1]]])
  const moritz = (w: SharedWorld) => rpcOp('reserve_wish (Moritz, Wunsch 2)', w.moritz, 'reserve_wish', [w.wishes[1]])

  it('the add holds → the reservation waits on profiles → ok (it reads the wish in O1 now)', async () => {
    const w = await sharedWorld()
    expect(await hold(add(w), moritz(w), true)).toEqual({ first: { ok: true, value: { ok: true, added: 1 } }, second: OK })
    expect(await activeReserversOf(db, w.wishes[1]!)).toEqual([w.moritz])
  })

  it(`${ROUNDS} races: ok exactly when the add committed first; a refused reservation leaves nothing`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const w = await sharedWorld()
      const out = await race(add(w), moritz(w), round % 2 === 0, Math.floor(round / 2))
      expect(out.x).toEqual({ ok: true, value: { ok: true, added: 1 } })
      contract(out.y, 'moritz')
      if (out.y.ok) expect(await activeReserversOf(db, w.wishes[1]!)).toEqual([w.moritz])
      else {
        expect(out.y).toEqual(rpcError('not_allowed'))
        expect(await activeReserversOf(db, w.wishes[1]!)).toEqual([])
      }
      expect(await inv1Violations(db)).toBe(0)
    }
  })
})

describe('SC-C remove_wish_from_list ↔ reserve_wish of the guest who reads it only there', () => {
  const remove = (w: SharedWorld) => rpcOp('remove_wish_from_list (Paula, from O1)', w.paula, 'remove_wish_from_list', [w.shared, w.ol])
  const moritz = (w: SharedWorld) => rpcOp('reserve_wish (Moritz)', w.moritz, 'reserve_wish', [w.shared])

  it('the removal holds → the reservation waits → not_allowed, nothing written', async () => {
    const w = await sharedWorld()
    expect(await hold(remove(w), moritz(w), true)).toEqual({ first: OK, second: rpcError('not_allowed') })
    expect(await reservationsBy(db, w.moritz)).toEqual([])
  })

  it('the reservation holds → the removal waits → both ok; the reservation is dead and the cleanup ends it', async () => {
    const w = await sharedWorld()
    expect(await hold(moritz(w), remove(w), true)).toEqual({ first: OK, second: OK })
    expect(await reservationsBy(db, w.moritz)).toEqual([{ wish_id: w.shared, status: 'ended', end_reason: 'access_ended' }])
  })
})

describe('SC-CL1 the cleanup ↔ the giver\'s own unfollow on his dead row: ended exactly once', () => {
  async function deadRowOfFinn(): Promise<SharedWorld> {
    const w = await sharedWorld()
    await cleanupPass(db) // nothing else pending
    expect(await rpcAs(db, w.finn, 'reserve_wish', [w.wishes[2]])).toEqual({ ok: true })
    expect(await rpcAs(db, w.paula, 'set_list_visibility', [w.l1, 'private'])).toEqual({ ok: true }) // dead now
    return w
  }
  const cleanupOp: Op = rpcOp('cleanup run', null, 'reservations_cleanup_run')
  cleanupOp.run = (s) => s.value('select private.reservations_cleanup_run()')
  const unfollow = (w: SharedWorld) => rpcOp('unfollow (Finn)', w.finn, 'unfollow', [w.paula])

  it('unfollow holds its row → the cleanup does not wait (SKIP LOCKED) → unfollowed stays', async () => {
    const w = await deadRowOfFinn()
    await hold(unfollow(w), cleanupOp, false)
    const rows = await db.admin.rows('select status, end_reason from public.reservations where reserver_id = $1', [w.finn])
    expect(rows).toEqual([{ status: 'ended', end_reason: 'unfollowed' }])
    await cleanupPass(db)
    expect(await db.admin.rows('select status, end_reason from public.reservations where reserver_id = $1', [w.finn])).toEqual(rows)
  })

  it('the cleanup holds the row → unfollow waits on it, then finds it ended: access_ended stays (never re-labelled)', async () => {
    const w = await deadRowOfFinn()
    const out = await hold(cleanupOp, unfollow(w), true)
    expect(out.second).toEqual(OK)
    expect(await db.admin.rows('select status, end_reason from public.reservations where reserver_id = $1', [w.finn])).toEqual([
      { status: 'ended', end_reason: 'access_ended' },
    ])
  })
})

describe('SC-CL2 the cleanup ↔ Greta reserving a wish whose row is dead (Finn lost access)', () => {
  async function deadRow(): Promise<SharedWorld> {
    const w = await sharedWorld()
    await cleanupPass(db)
    expect(await rpcAs(db, w.finn, 'reserve_wish', [w.wishes[3]])).toEqual({ ok: true })
    expect(await rpcAs(db, w.paula, 'remove_follower', [w.finn])).toEqual({ ok: true })
    return w
  }
  const cleanupOp: Op = { label: 'cleanup run', as: null, run: (s) => s.value('select private.reservations_cleanup_run()') }
  const greta = (w: SharedWorld) => rpcOp('reserve_wish (Greta)', w.greta, 'reserve_wish', [w.wishes[3]])

  it('the cleanup holds the row → Greta waits on it → ok; one ended row, one active (hers)', async () => {
    const w = await deadRow()
    expect((await hold(cleanupOp, greta(w), true)).second).toEqual(OK)
    expect(await activeReserversOf(db, w.wishes[3]!)).toEqual([w.greta])
  })

  it('Greta holds (she ended the dead row and inserted hers) → the cleanup skips it, waits for nothing', async () => {
    const w = await deadRow()
    expect((await hold(greta(w), cleanupOp, false)).first).toEqual(OK)
    expect(await activeReserversOf(db, w.wishes[3]!)).toEqual([w.greta])
    expect(await db.admin.rows(`select status, end_reason from public.reservations where reserver_id = $1`, [w.finn])).toEqual([
      { status: 'ended', end_reason: 'access_ended' },
    ])
  })
})

describe('SC28 two cleanup runs at once', () => {
  it('the second waits on the cursor row; every dead row is ended exactly once', async () => {
    await cleanupPass(db)
    await db.admin.query(
      `insert into public.reservations (wish_id, recipient_id, reserver_id, wish_title_snapshot)
       select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x' from generate_series(1, 300)`,
    )
    const run: Op = { label: 'cleanup', as: null, run: (s) => s.value('select private.reservations_cleanup_run(100)') }
    const out = await hold(run, { ...run, label: 'cleanup (overlapping)' }, true)
    expect(out.first.ok && out.second.ok).toBe(true)
    await cleanupPass(db)
    expect(await db.admin.value<number>(`select count(*)::int from public.reservations where wish_title_snapshot = 'x'`)).toBe(0) // orphans: erased
  })
})

describe('SC22 the unlink job ↔ the host moving the occasion into the future (REST)', () => {
  async function expired(): Promise<SharedWorld> {
    const w = await sharedWorld()
    await db.admin.query(`update public.occasions set starts_at = now() - interval '9 days', ends_at = null, all_day = true where id = $1`, [w.o1])
    return w
  }
  const unlink: Op = { label: 'unlink run', as: null, run: (s) => s.value('select private.unlink_past_occasion_places_run()') }
  const move = (w: SharedWorld) =>
    sqlOp('UPDATE occasions starts_at (Paula, REST)', w.paula, `update public.occasions set starts_at = now() + interval '10 days' where id = $1`, [w.o1])
  const placesOf = (w: SharedWorld) => db.admin.value<number>('select count(*)::int from private.wish_placements where wish_id = $1', [w.shared])

  it('the job holds the occasion row → the date change waits → the places are gone (the occasion WAS over)', async () => {
    const w = await expired()
    const out = await hold(unlink, move(w), true)
    expect(out.second).toEqual({ ok: true, value: 1 })
    expect(await placesOf(w)).toBe(1)
  })

  it('the date change holds → the job waits on the occasion row, re-checks, unlinks nothing', async () => {
    const w = await expired()
    const out = await hold(move(w), unlink, true)
    expect(out.second).toMatchObject({ ok: true })
    expect(await placesOf(w)).toBe(2)
  })
})

describe('SC23 dismiss_received_prompt ↔ the host deleting the occasion (REST) — Codex 27.10 #3', () => {
  const dismiss = (w: SharedWorld) => rpcOp('dismiss_received_prompt (Paula)', w.paula, 'dismiss_received_prompt', [w.o1])
  const remove = (w: SharedWorld) => sqlOp('DELETE occasions (Paula, REST)', w.paula, 'delete from public.occasions where id = $1', [w.o1])
  const prompts = (w: SharedWorld) => db.admin.value<number>('select count(*)::int from private.occasion_prompts where occasion_id = $1', [w.o1])

  it('the dismiss holds the occasion row → the delete waits → both ok; the prompt row goes with the occasion', async () => {
    const w = await sharedWorld()
    const out = await hold(dismiss(w), remove(w), true)
    expect(out.first).toEqual(OK)
    expect(out.second).toEqual({ ok: true, value: 1 })
    expect(await prompts(w)).toBe(0)
  })

  it('the delete holds → the dismiss waits → not_found (never a raw FK error)', async () => {
    const w = await sharedWorld()
    const out = await hold(remove(w), dismiss(w), true)
    expect(out.second).toEqual(rpcError('not_found'))
    expect(await prompts(w)).toBe(0)
  })

  it(`${ROUNDS} unsynchronised rounds: only ok / not_found, nothing left behind`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const w = await sharedWorld()
      const out = await race(dismiss(w), remove(w), i % 2 === 0, i % 4)
      contract(out.x, `round ${i} dismiss`)
      expect([JSON.stringify(OK), JSON.stringify(rpcError('not_found'))], `round ${i}`).toContain(JSON.stringify(out.x))
      expect(out.y).toEqual({ ok: true, value: 1 })
      expect(await prompts(w)).toBe(0)
    }
  })
})

describe('PLANS: INV-7 on PostgreSQL 17 (auto_explain of every nested statement)', () => {
  let probe: Session
  const plans: string[] = []
  beforeAll(async () => {
    probe = await db.session('plans')
    const client = Reflect.get(probe, 'client') as pg.Client
    client.on('notice', (msg) => {
      if (typeof msg.message === 'string' && msg.message.includes('Query Text')) plans.push(msg.message)
    })
    await probe.query(`load 'auto_explain'`)
    await probe.query('set auto_explain.log_min_duration = 0')
    await probe.query('set auto_explain.log_nested_statements = on')
    await probe.query('set client_min_messages = log')
    // a table of realistic size: 20 000 rows of strangers, statistics fresh
    await db.admin.query(
      `insert into public.reservations (wish_id, recipient_id, reserver_id, wish_title_snapshot, status, end_reason, ended_at)
       select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'fremd', s, case when s = 'ended' then 'by_reserver' end,
              case when s = 'ended' then now() end
         from generate_series(1, 20000) g cross join lateral (select case when g % 3 = 0 then 'ended' else 'active' end as s) x`,
    )
    await db.admin.query('analyze public.reservations')
  })
  afterAll(async () => {
    await probe?.end()
  })

  async function plansOf(as: string, sql: string, params: readonly unknown[] = []): Promise<string[]> {
    plans.length = 0
    await probe.begin(as)
    await settle(probe.query(sql, params))
    await probe.rollback()
    return [...plans]
  }
  /** the plan blocks that touch reservations (one auto_explain message per statement) */
  // (plan NODES only — the query text may carry comments like "never depends on reservations")
  const touching = (ps: readonly string[]) => ps.filter((p) => /(Scan|Update|Delete|Insert)[^\n]* on reservations\b/.test(p))

  function expectBounded(ps: readonly string[], label: string): void {
    for (const p of touching(ps)) {
      expect(p, label).not.toMatch(/Seq Scan on reservations/)
      // every scan node on reservations is an index access with a condition on ONE wish or the caller's own rows
      const lines = p.split('\n')
      lines.forEach((line, i) => {
        if (!/Scan.* on reservations\b/.test(line)) return
        const node = lines.slice(i, i + 4).join('\n')
        // a bitmap can turn lossy (small work_mem) and then rechecks every row of a heap page — rows of other people
        // included (Codex 27.10 #1): the giver functions run with enable_bitmapscan = off, so none may appear
        expect(line, `${label}: bitmap scan on reservations`).not.toMatch(/Bitmap Heap Scan/)
        expect(node, `${label}: ${line.trim()}`).toMatch(/Index (Only )?Scan using reservations_(one_active_per_wish|reserver_idx) on reservations[\s\S]*Index Cond: \(?\(?(wish_id|reserver_id) = /)
      })
    }
  }

  it('the owner\'s actions plan nothing on reservations; her giver functions only bounded index access', async () => {
    const w = await sharedWorld()
    expect(await rpcAs(db, w.moritz, 'reserve_wish', [w.shared])).toEqual({ ok: true })
    expect(await rpcAs(db, w.finn, 'reserve_wish', [w.wishes[2]])).toEqual({ ok: true })
    // Paula as a giver: a guest of an occasion of Greta's with one reservation
    const go = await db.asUser(w.greta, (s) =>
      s.value<string>(`insert into public.occasions (host_id, title, starts_at, tz) values ($1, 'Gretas Fest', now() + interval '5 days', 'Europe/Berlin') returning id`, [w.greta]),
    )
    const gl = await db.admin.value<string>('select id from public.wishlists where occasion_id = $1', [go])
    const gw = await db.asUser(w.greta, (s) => s.value<string>(`insert into public.wishes (wishlist_id, title) values ($1, 'Vase') returning id`, [gl]))
    const { token } = await rpcAs<{ token: string }>(db, w.greta, 'create_invite', [go])
    await rpcAs(db, w.paula, 'accept_invite', [token])
    expect(await rpcAs(db, w.paula, 'reserve_wish', [gw])).toEqual({ ok: true })

    const owner: [string, string, readonly unknown[]][] = [
      ['get_occasion_screen (host)', 'select public.get_occasion_screen($1)', [w.o1]],
      ['get_list_screen (owner)', 'select public.get_list_screen($1)', [w.l1]],
      ['get_lists_overview', 'select public.get_lists_overview()', []],
      ['add_wishes_to_list', 'select public.add_wishes_to_list($1, $2)', [w.ol, [w.wishes[4]]]],
      ['remove_wish_from_list', 'select public.remove_wish_from_list($1, $2)', [w.shared, w.ol]],
      ['delete_wish_everywhere', 'select public.delete_wish_everywhere($1)', [w.shared]],
      ['set_list_visibility', 'select public.set_list_visibility($1, $2)', [w.l1, 'private']],
      ['remove_follower', 'select public.remove_follower($1)', [w.finn]],
      ['block_user', 'select public.block_user($1)', [w.moritz]],
      ['delete_my_account', 'select public.delete_my_account()', []],
      ['REST delete list', 'delete from public.wishlists where id = $1', [w.l1]],
    ]
    for (const [label, sql, params] of owner) {
      const ps = await plansOf(w.paula, sql, params)
      expect(ps.length, `${label}: auto_explain logged nothing`).toBeGreaterThan(0)
      expect(touching(ps).join('\n=====\n'), label).toEqual('')
    }
    const giver: [string, string, readonly unknown[]][] = [
      ['my_reservations', 'select public.my_reservations()', []],
      ['export_my_data', 'select public.export_my_data()', []],
      ['get_feed', 'select public.get_feed()', []],
      ['get_occasion_screen (guest)', 'select public.get_occasion_screen($1)', [go]],
      ['get_free_wishes', 'select public.get_free_wishes($1, null)', [w.greta]],
      ['reserve + cancel', 'select public.cancel_reservation($1), public.reserve_wish($1)', [gw]],
      ['leave_occasion', 'select public.leave_occasion($1)', [go]],
    ]
    for (const [label, sql, params] of giver) {
      const ps = await plansOf(w.paula, sql, params)
      expect(touching(ps).length, `${label}: reads its own rows`).toBeGreaterThan(0)
      expectBounded(ps, label)
    }
    // the guests' and followers' screens of Paula's lists, too
    expectBounded(await plansOf(w.moritz, 'select public.get_occasion_screen($1)', [w.o1]), 'guest screen')
    expectBounded(await plansOf(w.finn, 'select public.get_list_screen($1)', [w.l1]), 'follower screen')
  })
})
