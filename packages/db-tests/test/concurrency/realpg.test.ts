/**
 * Facts about the real-Postgres harness that the concurrency tests rely on (what test/harness.test.ts is for
 * PGlite): a real PostgreSQL 17 with every migration, independent backends, "as user" only inside the
 * transaction, RLS for `authenticated`, and lock observation that really sees a wait, a lock timeout and a
 * deadlock (so "no 40P01 in the races" means something).
 */
import { readFile, readdir } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type RealPg, type Session } from '../../src/realpg'
import { rpcAs, seedFollowWorld } from './world'

let db: RealPg
let s1: Session
let s2: Session

beforeAll(async () => {
  db = await startRealPg()
  s1 = await db.session('tx-1')
  s2 = await db.session('tx-2')
})
afterAll(async () => {
  await db?.close()
})

const lockProfile = (s: Session, id: string) => s.query('select id from public.profiles where id = $1 for no key update', [id])

describe('realpg harness', () => {
  it('runs a real PostgreSQL 17 (read committed, like PostgREST) with the shims and every migration in order', async () => {
    expect(db.serverVersion).toMatch(/^17\./)
    const files = (await readdir(new URL('../../../../supabase/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()
    expect(files.length).toBeGreaterThanOrEqual(6)
    expect(db.appliedMigrations).toEqual(files)
    expect(await db.admin.value<string>(`select current_setting('default_transaction_isolation')`)).toBe('read committed')
    // pg_cron does not exist here: the cron migrations skip their jobs (as on PGlite)
    expect(await db.admin.value<boolean>(`select exists (select 1 from pg_available_extensions where name = 'pg_cron')`)).toBe(false)
  })

  it('every session is its own backend; "as user" holds only inside the transaction', async () => {
    const uid = await db.createUser('harness-1@example.test', { name: 'Test' })
    expect(new Set([db.admin.pid, s1.pid, s2.pid]).size).toBe(3)
    await s1.begin(uid)
    expect(
      await s1.rows(`select current_user::text as role, auth.uid() as uid, (select rolsuper from pg_roles where rolname = current_user) as su`),
    ).toEqual([{ role: 'authenticated', uid, su: false }])
    await s1.commit()
    expect(await s1.rows(`select current_user::text as role, auth.uid() as uid`)).toEqual([{ role: 'postgres', uid: null }])
  })

  it('grants and RLS apply to a session as authenticated', async () => {
    const uid = await db.createUser('harness-2@example.test', { name: 'Test' })
    await db.createUser('harness-3@example.test', { name: 'Other' })
    await s1.begin(uid)
    expect(await settle(s1.query('select id from public.reservations'))).toMatchObject({ ok: false, code: '42501' })
    await s1.rollback()
    await s1.begin(uid)
    expect(await s1.rows('select id from public.profiles')).toEqual([{ id: uid }]) // only the own row
    await s1.commit()
  })

  it('sees a session that waits for a row lock of another transaction: blocking pid, wait event, table', async () => {
    const uid = await db.createUser('harness-4@example.test', { name: 'Test' })
    await s1.begin()
    await lockProfile(s1, uid)
    await s2.begin()
    const pending = settle(lockProfile(s2, uid))
    const block = await db.waitUntilBlocked(s2, s1, pending)
    expect(block).toEqual({ blockedBy: [s1.pid], waitEvent: 'Lock:transactionid', rowLockOn: 'profiles' })
    await s1.commit()
    expect(await pending).toMatchObject({ ok: true })
    await s2.commit()
  })

  it('reports a statement that does not block instead of waiting for nothing', async () => {
    const uid = await db.createUser('harness-5@example.test', { name: 'Test' })
    await s2.begin()
    const pending = settle(lockProfile(s2, uid))
    await expect(db.waitUntilBlocked(s2, s1, pending)).rejects.toThrow(/did not block/)
    await s2.rollback()
  })

  it('a wait that hangs fails fast with lock_timeout (55P03)', async () => {
    const uid = await db.createUser('harness-6@example.test', { name: 'Test' })
    await s1.begin()
    await lockProfile(s1, uid)
    await s2.begin()
    await s2.query(`set local lock_timeout = '150ms'`)
    expect(await settle(lockProfile(s2, uid))).toMatchObject({ ok: false, code: '55P03' })
    await s2.rollback()
    await s1.commit()
  })

  it('a real deadlock is detected within deadlock_timeout (40P01): the races would report one', async () => {
    const a = await db.createUser('harness-7@example.test', { name: 'A' })
    const b = await db.createUser('harness-8@example.test', { name: 'B' })
    await s1.begin()
    await lockProfile(s1, a)
    await s2.begin()
    await lockProfile(s2, b)
    const first = settle(lockProfile(s1, b)) // s1 waits for s2
    await db.waitUntilBlocked(s1, s2, first)
    const second = settle(lockProfile(s2, a)) // s2 waits for s1: a cycle
    const codes = (await Promise.all([first, second])).map((o) => (o.ok ? 'ok' : o.code)).sort()
    expect(codes).toEqual(['40P01', 'ok'])
    await s1.rollback()
    await s2.rollback()
  })
})

// ---------------------------------------------------------------------------
// plpgsql.extra_errors = 'strict_multi_assignment' for the whole real-PG suite (follows-design §7.3, §0.4 item 4,
// A10; src/realpg.ts SERVER_FLAGS): a SELECT / RETURNING … INTO with a different number of columns than its targets
// fails instead of silently filling nulls. The check fires only when a row is found, so besides the setting itself:
// a static check of EVERY latest plpgsql body, and the bodies with %rowtype targets run on their main paths.
// ---------------------------------------------------------------------------

interface IntoStatement {
  fn: string
  /** the statement up to INTO, whitespace collapsed */
  text: string
  columns: number
  targets: string[]
  /** columns the targets take; null = a `record` target (it takes any shape) */
  expected: number | null
}

/** Splits at commas outside parentheses and single-quoted strings. */
function topLevelParts(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") quoted = !quoted
    else if (!quoted && c === '(') depth++
    else if (!quoted && c === ')') depth--
    else if (!quoted && depth === 0 && c === ',') {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

/** End index of the last `keyword` outside parentheses / strings, -1 when there is none. */
function lastTopLevel(s: string, keyword: string): number {
  let depth = 0
  let quoted = false
  let found = -1
  const re = new RegExp(`^${keyword}\\b`, 'i')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") quoted = !quoted
    else if (!quoted && c === '(') depth++
    else if (!quoted && c === ')') depth--
    else if (!quoted && depth === 0 && /[a-z]/i.test(c ?? '') && !/[a-z0-9_.]/i.test(s[i - 1] ?? ' ') && re.test(s.slice(i))) {
      found = i + keyword.length
    }
  }
  return found
}

/** Every SELECT / RETURNING … INTO of one plpgsql body with its column count and what its targets take. */
function intoStatements(fn: string, source: string, tableColumns: ReadonlyMap<string, number>): IntoStatement[] {
  const code = source.replace(/--[^\n]*/g, ' ')
  const declare = /\bdeclare\b([\s\S]*?)\bbegin\b/i.exec(code)?.[1] ?? ''
  const types = new Map<string, string>()
  for (const d of declare.matchAll(/([a-z_][a-z0-9_]*)\s+([^;:]+?)\s*(?::=[^;]*)?;/gi)) {
    types.set((d[1] ?? '').toLowerCase(), (d[2] ?? '').trim().toLowerCase())
  }
  const out: IntoStatement[] = []
  for (const m of code.matchAll(/\binto\s+(?:strict\s+)?([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)/gi)) {
    const prefix = code.slice(0, m.index)
    if (/\binsert\s*$/i.test(prefix)) continue // INSERT INTO <table>
    const statement = prefix.slice(prefix.lastIndexOf(';') + 1)
    const returning = lastTopLevel(statement, 'returning')
    const from = returning >= 0 ? returning : lastTopLevel(statement, 'select')
    const targets = (m[1] ?? '').split(',').map((t) => t.trim().toLowerCase())
    let expected: number | null = targets.length
    if (targets.length === 1) {
      const type = types.get(targets[0] ?? '') ?? ''
      const rowtype = /^public\.([a-z_]+)%rowtype$/.exec(type)
      expected = type === 'record' ? null : rowtype ? (tableColumns.get(rowtype[1] ?? '') ?? -1) : 1
    }
    out.push({
      fn,
      text: statement.replace(/\s+/g, ' ').trim(),
      columns: from >= 0 ? topLevelParts(statement.slice(from)).length : -1,
      targets,
      expected,
    })
  }
  return out
}

const isMismatch = (st: IntoStatement) => st.columns < 1 || (st.expected !== null && st.columns !== st.expected)

/** The pilot's last reserve_wish (20261020120000, read-only): `v_wl public.wishlists%rowtype` filled with 7 columns. */
async function pilotReserveWish(): Promise<{ create: string; body: string }> {
  const sql = await readFile(new URL('../../../../supabase/migrations/20261020120000_concurrency_fix.sql', import.meta.url), 'utf8')
  const create = /create or replace function public\.reserve_wish\(p_wish_id uuid\)[\s\S]*?\nend \$\$;/.exec(sql)?.[0]
  const body = create === undefined ? undefined : /as \$\$([\s\S]*)\$\$;$/.exec(create)?.[1]
  if (create === undefined || body === undefined) throw new Error('reserve_wish not found in 20261020120000_concurrency_fix.sql')
  return { create, body }
}

describe('plpgsql.extra_errors = strict_multi_assignment (follows-design §7.3, A10)', () => {
  it('is set for every connection of the suite, also inside a transaction as authenticated', async () => {
    const uid = await db.createUser('harness-strict@example.test', { name: 'Test' })
    expect(await db.admin.value<string>(`select current_setting('plpgsql.extra_errors')`)).toBe('strict_multi_assignment')
    await s1.begin(uid)
    expect(await s1.value<string>(`select current_setting('plpgsql.extra_errors')`)).toBe('strict_multi_assignment')
    await s1.commit()
    // a server default (postgres -c …), not a session SET: a new connection has it too
    const fresh = await db.session('strict-fresh')
    expect(await fresh.value<string>(`select current_setting('plpgsql.extra_errors')`)).toBe('strict_multi_assignment')
  })

  it('is enforced: 3 columns into 2 variables and 2 columns into a 3-field %rowtype both fail (42804)', async () => {
    await s2.query(`create temp table strict_probe (a int, b int, c int)`)
    await s2.query(`create function pg_temp.strict_scalars() returns int language plpgsql as $$
                      declare a int; b int; begin select 1, 2, 3 into a, b; return a; end $$`)
    await s2.query(`create function pg_temp.strict_rowtype() returns int language plpgsql as $$
                      declare r strict_probe%rowtype; begin select 1, 2 into r; return r.a; end $$`)
    for (const fn of ['strict_scalars', 'strict_rowtype']) {
      expect(await settle(s2.query(`select pg_temp.${fn}()`))).toMatchObject({
        ok: false,
        code: '42804',
        message: 'number of source and target fields in assignment does not match',
      })
    }
  })

  it('the pilot’s last reserve_wish body (7 columns into wishlists%rowtype, now 11 fields) fails under it; M1’s `record` body runs', async () => {
    const w = await seedFollowWorld(db)
    const { create } = await pilotReserveWish()
    const s = await db.session('strict-pilot-body')
    await s.query(create.replace('function public.reserve_wish(', 'function pg_temp.pilot_reserve_wish('))
    await s.begin()
    await s.query(`select set_config('request.jwt.claim.sub', $1, true)`, [w.finn])
    expect(await settle(s.query('select pg_temp.pilot_reserve_wish($1)', [w.wishes[0]]))).toMatchObject({
      ok: false,
      code: '42804',
      message: 'number of source and target fields in assignment does not match',
    })
    await s.rollback()
    expect(await rpcAs(db, w.finn, 'reserve_wish', [w.wishes[0]])).toEqual({ ok: true }) // the current (M3) body
  })

  it('no latest body of public / private assigns a different number of columns than its INTO targets take', async () => {
    const tableColumns = new Map(
      (
        await db.admin.rows<{ relname: string; n: number }>(
          `select c.relname, count(*)::int as n from pg_attribute a join pg_class c on c.oid = a.attrelid
             join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped group by c.relname`,
        )
      ).map((r) => [r.relname, r.n] as const),
    )
    const bodies = await db.admin.rows<{ fn: string; src: string }>(
      `select ns.nspname || '.' || p.proname as fn, p.prosrc as src
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace join pg_language l on l.oid = p.prolang
        where ns.nspname in ('public', 'private') and l.lanname = 'plpgsql' order by 1`,
    )
    const statements = bodies.flatMap((b) => intoStatements(b.fn, b.src, tableColumns))
    // the scanner sees the statements it must see (34 after M1–M4, e.g. reserve_wish's 10 wish columns into `v_wish record`;
    // a %rowtype until 20261022120000 added the wish details — a record takes any number of columns)
    expect(statements.length).toBeGreaterThanOrEqual(30)
    // (20261027200000: reserve_wish reads the wish's owner / recipient, then under the pair lock title, received_at
    // and home into three scalars; the active row into `v_row record`)
    expect(statements).toContainEqual(expect.objectContaining({ fn: 'public.reserve_wish', columns: 3, targets: ['v_title', 'v_received', 'v_home'] }))
    expect(statements).toContainEqual(expect.objectContaining({ fn: 'public.reserve_wish', columns: 5, expected: null, targets: ['v_row'] }))
    expect(statements).toContainEqual(expect.objectContaining({ fn: 'public.get_lists_overview', columns: 3, expected: 3 }))
    expect(statements.filter(isMismatch)).toEqual([])
    // the scanner does catch the old pilot body that strict mode breaks (A10)
    const pilot = intoStatements('pilot reserve_wish', (await pilotReserveWish()).body, tableColumns)
    // (since 20261022120000 also its `v_wish public.wishes%rowtype`: 10 columns into 15 fields — why the bodies use `record`;
    // 16 fields since 20261022160000 added received_at, 17 since 20261030120000 added quantity)
    expect(pilot.filter(isMismatch)).toEqual([
      expect.objectContaining({ targets: ['v_wish'], columns: 10, expected: 17 }),
      expect.objectContaining({ targets: ['v_wl'], columns: 7, expected: 11 }),
    ])
  })

  it('every body with a %rowtype target runs its main path under it (the check fires only when a row is found)', async () => {
    // seedFollowWorld already ran accept_invite (invites%rowtype), the follow RPCs and the REST writes under the setting
    const w = await seedFollowWorld(db)
    const o1List = await db.admin.value<string>('select id from public.wishlists where occasion_id = $1', [w.o1])
    const gift = await db.asUser(w.paula, (s) =>
      s.value<string>(`insert into public.wishes (wishlist_id, title, priority) values ($1, 'Gartenstuhl', 2) returning id`, [o1List]),
    )
    const first = w.wishes[0]
    // get_occasion_screen: occasions%rowtype + occasion_members%rowtype, host branch and member branch
    expect(await rpcAs(db, w.paula, 'get_occasion_screen', [w.o1])).toMatchObject({ viewer: { role: 'host' } })
    expect(await rpcAs(db, w.moritz, 'get_occasion_screen', [w.o1])).toMatchObject({ viewer: { role: 'member' } })
    // reserve_wish / cancel_reservation: wishes%rowtype, the follower path and the occasion path
    for (const [who, wishId] of [
      [w.finn, first],
      [w.moritz, gift],
    ] as const) {
      expect(await rpcAs(db, who, 'reserve_wish', [wishId])).toEqual({ ok: true })
      expect(await rpcAs(db, who, 'cancel_reservation', [wishId])).toEqual({ ok: true })
    }
    // the other INTO bodies on their found-a-row paths
    expect(await rpcAs(db, w.finn, 'get_list_screen', [w.l1])).toMatchObject({ viewer: { role: 'follower' } })
    expect(await rpcAs(db, w.paula, 'get_list_screen', [w.l1])).toMatchObject({ viewer: { role: 'owner' } })
    expect(await rpcAs(db, w.rosa, 'request_follow_via_link', [w.token])).toEqual({ status: 'requested', profile_id: w.paula })
    expect(await rpcAs(db, w.rosa, 'request_follow', [w.paula])).toEqual({ status: 'requested' })
    expect(await rpcAs(db, w.rosa, 'peek_follow_link', [w.token])).toMatchObject({ relation: { i_follow: 'requested' } })
    expect(await rpcAs(db, w.paula, 'get_lists_overview')).toMatchObject({ stats: { followers: 2 } })
    expect(await rpcAs(db, w.paula, 'set_list_visibility', [w.l1, 'followers'])).toEqual({ ok: true })
    expect(await rpcAs(db, w.paula, 'create_invite', [w.o1])).toMatchObject({ token: expect.any(String) })
    expect(await rpcAs(db, w.rosa, 'unfollow', [w.paula])).toEqual({ ok: true })
    expect(await rpcAs(db, w.moritz, 'leave_occasion', [w.o1])).toEqual({ ok: true })
  })
})
