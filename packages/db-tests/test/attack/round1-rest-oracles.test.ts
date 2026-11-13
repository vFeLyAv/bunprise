/**
 * ATTACK ROUND 1 — REST-shaped reads.
 * Goal: as the list owner (host A), a member (C), the reserver (B), an outsider (D) or anon, learn ANYTHING about
 * reservations through SQL the way PostgREST would run it: joins, sub-selects, correlated ORDER BY, LIMIT 0,
 * EXPLAIN, TABLESAMPLE, UNION, catalog statistics, information_schema, the hidden invites.token_hash column,
 * and a byte-identical snapshot of every table + every RPC the host can reach, before/after reservation traffic.
 * Every test asserts the SECURE behaviour; a failing test is a finding.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES, RPC_ONLY_TABLES, countAll, countAs, queryAs, rpc, seedPilot, type Seed } from '../pilot/seed'

let t: TestDb
let s: Seed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedPilot(t)
  await rpc(t, s.b, 'reserve_wish', [s.w1])
})
afterAll(() => t.close())

/** Every query shape that touches reservations, directly or through another table. */
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
    // (explicit column: since wave 2b M1 `select *` on wishes is refused already at wishes.updated_at — see below)
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
    // writes that are conditioned on reservations: must be refused BEFORE any row is touched
    `update wishes set note = null where exists (select 1 from reservations r where r.wish_id = wishes.id)`,
    `delete from wishes where exists (select 1 from reservations r where r.wish_id = wishes.id)`,
    `update wishes set priority = 1 where id in (select wish_id from reservations)`,
  ]
}

describe('reservations through any SQL shape', () => {
  it('host, reserver, member, outsider: every probe is "permission denied for table reservations" and no row is touched', async () => {
    const wishesBefore = await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])
    for (const uid of [s.a, s.b, s.c, s.d]) {
      for (const sql of reservationProbes(s.w1, s.wishlistId)) {
        const err = await expectDbError(t.asUser(uid, (tx) => rows(tx, sql)), '42501')
        expect(err.message, `${uid}: ${sql}`).toMatch(/permission denied for table reservations/)
        expect(err.message, sql).not.toMatch(/duplicate|unique|violates/)
      }
    }
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(wishesBefore)
    expect(await countAll(t, 'reservations', `wish_id = $1 and status = 'active'`, [s.w1])).toBe(1)
  })

  it('wave 2b M1 (P9): updated_at of wishes and wishlists is not readable through REST — so neither is a whole row', async () => {
    for (const uid of [s.a, s.b, s.c, s.d]) {
      for (const sql of [
        'select updated_at from wishes',
        'select * from wishes',
        'select to_jsonb(w) from wishes w',
        `explain (format json) select * from wishes w where exists (select 1 from reservations r where r.wish_id = w.id)`,
        'select updated_at from wishlists',
        'select * from wishlists',
        `select id from wishes order by updated_at`,
      ]) {
        const err = await expectDbError(t.asUser(uid, (tx) => rows(tx, sql)), '42501')
        expect(err.message, `${uid}: ${sql}`).toMatch(/permission denied for table (wishes|wishlists)/)
      }
    }
  })

  it('anon: the same probes fail on the first table they touch, never with a reservations-specific message that differs', async () => {
    for (const sql of reservationProbes(s.w1, s.wishlistId)) {
      const err = await expectDbError(t.asAnon((tx) => rows(tx, sql)), '42501')
      expect(err.message, sql).toMatch(/permission denied for table/)
    }
  })

  it('the outsider reads nothing from any content table (and only self / public rows elsewhere)', async () => {
    const expected: Record<string, number> = { profiles: 1, legal_versions: 3, consents: 3 }
    for (const table of ALL_TABLES) {
      if (table === 'reservations') continue
      // RPC-only tables (no grant at all, like reservations): even the count is refused
      if (RPC_ONLY_TABLES.includes(table)) {
        await expectDbError(countAs(t, s.d, table), '42501')
        continue
      }
      expect(await countAs(t, s.d, table), table).toBe(expected[table] ?? 0)
    }
    // and the only profile row is their own
    expect(await queryAs<{ id: string }>(t, s.d, 'select id from profiles')).toEqual([{ id: s.d }])
  })
})

describe('catalog and metadata side channels', () => {
  it('pg_stats exposes no statistics on reservations to the API role (RLS-aware view), even after ANALYZE', async () => {
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    await t.asService((tx) => tx.exec('analyze public.reservations'))
    const asSuper = await scalar<number>(t.db, `select count(*)::int from pg_stats where schemaname = 'public' and tablename = 'reservations'`)
    expect(asSuper).toBeGreaterThan(0) // the check below is not vacuous
    for (const uid of [s.a, s.c, s.d]) {
      expect(await queryAs(t, uid, `select attname from pg_stats where schemaname = 'public' and tablename = 'reservations'`), uid).toEqual([])
    }
    await rpc(t, s.c, 'cancel_reservation', [s.w2])
  })

  it('information_schema shows the API roles no privilege and no column on reservations', async () => {
    for (const uid of [s.a, s.b, s.c, s.d]) {
      expect(await queryAs(t, uid, `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'reservations'`), uid).toEqual([])
      expect(await queryAs(t, uid, `select privilege_type from information_schema.table_privileges where table_schema = 'public' and table_name = 'reservations'`), uid).toEqual([])
    }
    expect(
      await rows(t.db, `select grantee, privilege_type from information_schema.table_privileges where table_schema = 'public' and table_name = 'reservations' and grantee in ('anon', 'authenticated', 'PUBLIC')`),
    ).toEqual([])
    expect(
      await rows(t.db, `select grantee, column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'reservations' and grantee in ('anon', 'authenticated', 'PUBLIC')`),
    ).toEqual([])
  })

  it('invites.token_hash cannot be used in WHERE / ORDER BY / expressions either (not only in the select list)', async () => {
    for (const sql of [
      `select id from invites where token_hash = sha256(convert_to('${s.token}', 'UTF8'))`,
      `select id from invites order by token_hash`,
      `select id from invites where length(token_hash) = 32`,
      `select id, encode(token_hash, 'hex') from invites`,
      `select id from invites where token_hash is not null`,
      `update invites set revoked_at = now() where token_hash = sha256(convert_to('${s.token}', 'UTF8'))`,
      `delete from invites where token_hash is not null`,
      `select (i).token_hash from invites i`,
      `select to_jsonb(i) from invites i`,
    ]) {
      const err = await expectDbError(t.asUser(s.a, (tx) => rows(tx, sql)), '42501')
      expect(err.message, sql).toMatch(/permission denied for table invites/)
    }
    expect(await countAll(t, 'invites', 'occasion_id = $1 and revoked_at is null', [s.occasionId])).toBe(1)
  })

  it('the API role cannot create views, functions or tables that would become a new access path', async () => {
    for (const sql of [
      `create view public.v_res as select 1`,
      `create view private.v_res as select 1`,
      `create function public.f_res() returns int language sql as 'select 1'`,
      `create table public.t_res (id int)`,
    ]) {
      const err = await expectDbError(t.asUser(s.a, (tx) => tx.query(sql)), '42501')
      expect(err.message, sql).toMatch(/permission denied for schema/)
    }
    expect(await rows(t.db, `select viewname from pg_views where schemaname in ('public', 'private')`)).toEqual([])
  })
})

/**
 * Everything the host can read: granted application columns and every read RPC.
 * System columns are deliberately inaccessible after the v1.1 column-grant fix.
 */
async function hostSnapshot(uid: string, occasionId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const table of ALL_TABLES) {
    // no granted column to project (RPC-only); the cover photo of the seeded occasion: none, see occasion-photos.test.ts
    if (RPC_ONLY_TABLES.includes(table)) continue
    const columns = await rows<{ column_name: string }>(t.db,
      `select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' and privilege_type = 'SELECT'
       order by column_name`, [table])
    const projection = columns.map((column) => column.column_name).join(', ')
    const sql = `select to_jsonb(visible)::text as j from (select ${projection} from ${table}) visible order by 1`
    out[table] = await queryAs(t, uid, sql)
  }
  out['get_me'] = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_me()::text'))
  out['get_feed'] = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))
  out['screen'] = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [occasionId]))
  out['my_reservations'] = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.my_reservations()::text'))
  out['export'] = await t.asUser(uid, (tx) => scalar<string>(tx, `select (public.export_my_data() - 'exported_at')::text`))
  return out
}

describe('byte-identical host world', () => {
  it('every permitted application column and RPC output is identical across reserve / cancel / re-reserve traffic', async () => {
    const s2 = await seedPilot(t)
    const before = await hostSnapshot(s2.a, s2.occasionId)
    const reservationIdsBefore = await rows<{ id: string }>(t.db, 'select id from reservations')

    await rpc(t, s2.b, 'reserve_wish', [s2.w1])
    await rpc(t, s2.c, 'reserve_wish', [s2.w3])
    await rpc(t, s2.b, 'reserve_wish', [s2.w2])
    await rpc(t, s2.b, 'cancel_reservation', [s2.w2])
    await rpc(t, s2.c, 'reserve_wish', [s2.w2])
    await rpc(t, s2.b, 'cancel_reservation', [s2.w1])
    await rpc(t, s2.c, 'reserve_wish', [s2.w1])
    await rpc(t, s2.b, 'reserve_wish', [s2.w1]).catch(() => undefined) // already_reserved: must leave no trace either
    await rpc(t, s2.c, 'my_reservations')
    await rpc(t, s2.c, 'get_feed')
    await rpc(t, s2.c, 'get_occasion_screen', [s2.occasionId])

    const after = await hostSnapshot(s2.a, s2.occasionId)
    expect(after).toEqual(before)

    // no reservation id, and no "reserv" beyond the null-valued contract keys, anywhere in what the host got
    const newIds = (await rows<{ id: string }>(t.db, 'select id from reservations')).map((r) => r.id).filter((id) => !reservationIdsBefore.some((x) => x.id === id))
    expect(newIds.length).toBeGreaterThanOrEqual(5)
    const text = JSON.stringify(after)
    for (const id of newIds) expect(text).not.toContain(id)
    const screen = after['screen'] as string
    expect(screen.match(/reserv/g)).toHaveLength(6) // 3 wishes × 2 null keys
    expect((after['get_feed'] as string).match(/reserv/g)).toHaveLength(1)
    expect(after['my_reservations']).toBe('[]')
  })

  it('the member screen never carries reservation ids or reserver ids either (only reserved / reserved_by_me)', async () => {
    const s3 = await seedPilot(t)
    await rpc(t, s3.b, 'reserve_wish', [s3.w1])
    const resId = await scalar<string>(t.db, `select id from reservations where wish_id = $1 and status = 'active'`, [s3.w1])
    const asC = await t.asUser(s3.c, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [s3.occasionId]))
    expect(asC).not.toContain(resId)
    // B's uuid appears exactly once: in the members list, not next to the wish
    expect(asC.split(s3.b).length - 1).toBe(1)
    expect(asC).not.toContain('reserved_by_name')
  })
})

describe('defence in depth: the reservations_select policy behind the missing grants', () => {
  // since 20261027200000 the policy is "own rows only": a reservation's liveness is not a column (design §5.5)
  it('even with a hypothetical SELECT grant the owner sees 0 rows, the reserver only own rows, a member none', async () => {
    const s4 = await seedPilot(t)
    await rpc(t, s4.b, 'reserve_wish', [s4.w1])
    await rpc(t, s4.b, 'reserve_wish', [s4.w2])
    await rpc(t, s4.b, 'cancel_reservation', [s4.w2])
    const db = t.db
    const as = async (uid: string) => {
      await db.query(
        `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)`,
        [uid, JSON.stringify({ sub: uid, role: 'authenticated' })],
      )
      return (await db.query<{ n: number; mine: number }>(`select count(*)::int as n, count(*) filter (where reserver_id = $1)::int as mine from public.reservations where wishlist_id = $2`, [uid, s4.wishlistId])).rows[0]!
    }
    await db.exec('begin')
    try {
      await db.exec('grant select on public.reservations to authenticated')
      await db.exec('set local role authenticated')
      expect(await as(s4.a), 'owner').toEqual({ n: 0, mine: 0 })
      expect(await as(s4.d), 'outsider').toEqual({ n: 0, mine: 0 })
      expect(await as(s4.c), 'member').toEqual({ n: 0, mine: 0 })
      expect(await as(s4.b), 'reserver').toEqual({ n: 2, mine: 2 })
    } finally {
      await db.exec('rollback')
    }
    expect(await scalar<boolean>(db, `select has_table_privilege('authenticated', 'public.reservations', 'select')`)).toBe(false)
  })
})
