/**
 * Proves the harness is trustworthy WITHOUT depending on the real migrations:
 * a scratch table with RLS is created here, and every claim the project relies
 * on (RLS bites for `authenticated`, anon sees nothing, service sees all,
 * SECURITY DEFINER crosses users, partial unique index guards the reservation
 * race) is asserted against PGlite directly.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, createTestDb, expectDbError, rows, scalar, type TestDb } from '../src/harness'

const SCRATCH_SCHEMA = `
create table scratch_items (
  id uuid default gen_random_uuid() primary key,
  owner uuid not null,
  secret text
);
alter table scratch_items enable row level security;
alter table scratch_items force row level security;
create policy scratch_items_select_own on scratch_items
  for select to authenticated using (owner = auth.uid());
create policy scratch_items_insert_own on scratch_items
  for insert to authenticated with check (owner = auth.uid());
grant select, insert on scratch_items to authenticated;

-- (f) SECURITY DEFINER (runs as its owner = superuser) vs plain SECURITY INVOKER
create function scratch_count_all_secdef() returns integer
  language sql security definer set search_path = public
  as $$ select count(*)::integer from scratch_items $$;
create function scratch_count_all_plain() returns integer
  language sql
  as $$ select count(*)::integer from scratch_items $$;
grant execute on function scratch_count_all_secdef(), scratch_count_all_plain() to authenticated;

-- (g) one ACTIVE reservation per wish, enforced by a partial unique index
create table scratch_reservations (
  id uuid default gen_random_uuid() primary key,
  wish_id uuid not null,
  reserved_by uuid not null,
  status text not null default 'active' check (status in ('active', 'cancelled'))
);
create unique index scratch_reservations_one_active
  on scratch_reservations (wish_id) where status = 'active';
alter table scratch_reservations enable row level security;
alter table scratch_reservations force row level security;
create policy scratch_reservations_own on scratch_reservations
  for all to authenticated using (reserved_by = auth.uid()) with check (reserved_by = auth.uid());
grant select, insert, update on scratch_reservations to authenticated;
`

type Item = { id: string; owner: string; secret: string }

let t: TestDb
let userA: string
let userB: string

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

beforeAll(async () => {
  // migrationsDir: false -> this suite never depends on the real migrations.
  t = await createTestDb({ migrationsDir: false, extraSql: [SCRATCH_SCHEMA] })
  userA = await t.createUser('a@example.test', { name: 'A' })
  userB = await t.createUser('b@example.test')
})

afterAll(async () => {
  await t.close()
})

describe('harness basics', () => {
  it('boots a superuser Postgres with the Supabase shims applied', async () => {
    expect(await scalar<string>(t.db, 'select current_user')).toBe('postgres')
    expect(await scalar<boolean>(t.db, 'select rolsuper from pg_roles where rolname = current_user')).toBe(true)
    const roles = await rows<{ rolname: string; rolbypassrls: boolean }>(
      t.db,
      `select rolname, rolbypassrls from pg_roles where rolname in ('anon', 'authenticated', 'service_role') order by rolname`,
    )
    expect(roles).toEqual([
      { rolname: 'anon', rolbypassrls: false },
      { rolname: 'authenticated', rolbypassrls: false },
      { rolname: 'service_role', rolbypassrls: true },
    ])
    expect(await scalar<string>(t.db, 'select gen_random_uuid()::text')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await scalar<string>(t.db, 'select uuid_generate_v4()::text')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('resolves the default migrations folder to <repo>/supabase/migrations', () => {
    const testDir = fileURLToPath(new URL('.', import.meta.url))
    expect(resolve(MIGRATIONS_DIR)).toBe(resolve(testDir, '..', '..', '..', 'supabase', 'migrations'))
    expect(t.appliedMigrations).toEqual([])
  })

  it('createUser stores email + metadata in auth.users', async () => {
    const user = await rows<{ email: string; raw_user_meta_data: { name?: string } }>(
      t.db,
      'select email, raw_user_meta_data from auth.users where id = $1',
      [userA],
    )
    expect(user).toEqual([{ email: 'a@example.test', raw_user_meta_data: { name: 'A' } }])
  })
})

describe('row level security through the harness', () => {
  it('(a) user A inserts a row and reads it back', async () => {
    const inserted = await t.asUser(userA, (tx) =>
      rows<Item>(tx, `insert into scratch_items (owner, secret) values ($1, 'A secret') returning *`, [userA]),
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.owner).toBe(userA)

    const seen = await t.asUser(userA, (tx) => rows<Item>(tx, 'select * from scratch_items'))
    expect(seen.map((r) => r.secret)).toEqual(['A secret'])
  })

  it('(b) user B reads 0 rows', async () => {
    const seen = await t.asUser(userB, (tx) => rows<Item>(tx, 'select * from scratch_items'))
    expect(seen).toEqual([])
  })

  it('(c) anon: 0 rows while it holds a GRANT, 42501 once the GRANT is revoked', async () => {
    // Postgres behaviour, verified: a role with table privileges but no matching
    // policy gets an EMPTY result (RLS = default deny), not an error.
    // The shim's default privileges give anon SELECT on new tables, like Supabase does.
    const who = await t.asAnon(async (tx) => ({
      role: await scalar<string>(tx, 'select current_user'),
      uid: await scalar<string | null>(tx, 'select auth.uid()'),
      claimRole: await scalar<string | null>(tx, 'select auth.role()'),
      seen: await rows<Item>(tx, 'select * from scratch_items'),
    }))
    expect(who).toEqual({ role: 'anon', uid: null, claimRole: 'anon', seen: [] })

    // Without the GRANT it is a hard permission error instead.
    await t.asService((tx) => tx.exec('revoke all on scratch_items from anon'))
    const err = await expectDbError(t.asAnon((tx) => rows(tx, 'select * from scratch_items')), '42501')
    expect(err.message).toMatch(/permission denied for table scratch_items/)
    await t.asService((tx) => tx.exec('grant select on scratch_items to anon'))
  })

  it('(d) user B cannot insert a row owned by A (WITH CHECK fails with 42501)', async () => {
    const err = await expectDbError(
      t.asUser(userB, (tx) => rows(tx, `insert into scratch_items (owner, secret) values ($1, 'forged') returning id`, [userA])),
      '42501',
    )
    expect(err.message).toMatch(/row-level security policy/)
    // ...and the failed transaction left nothing behind.
    expect(await scalar<number>(t.db, `select count(*)::int from scratch_items where secret = 'forged'`)).toBe(0)
  })

  it('(e) asService sees all rows', async () => {
    await t.asUser(userB, (tx) => tx.query(`insert into scratch_items (owner, secret) values ($1, 'B secret')`, [userB]))
    const all = await t.asService((tx) => rows<Item>(tx, 'select owner, secret from scratch_items order by secret'))
    expect(all).toEqual([
      { owner: userA, secret: 'A secret' },
      { owner: userB, secret: 'B secret' },
    ])
    expect(await t.asService((tx) => scalar<string | null>(tx, 'select auth.role()'))).toBe('service_role')
    // A and B still only see their own row.
    expect(await t.asUser(userA, (tx) => scalar<number>(tx, 'select count(*)::int from scratch_items'))).toBe(1)
    expect(await t.asUser(userB, (tx) => scalar<number>(tx, 'select count(*)::int from scratch_items'))).toBe(1)
  })

  it('(f) SECURITY DEFINER owned by the superuser reads across users, a plain function does not', async () => {
    const counts = await t.asUser(userB, async (tx) => ({
      secdef: await scalar<number>(tx, 'select scratch_count_all_secdef()'),
      plain: await scalar<number>(tx, 'select scratch_count_all_plain()'),
    }))
    expect(counts).toEqual({ secdef: 2, plain: 1 })
  })

  it('(g) partial unique index allows only one active reservation per wish (23505)', async () => {
    const wish = '11111111-1111-4111-8111-111111111111'
    const reserve = (user: string) =>
      t.asUser(user, (tx) =>
        rows<{ id: string }>(tx, 'insert into scratch_reservations (wish_id, reserved_by) values ($1, $2) returning id', [wish, user]),
      )

    expect(await reserve(userA)).toHaveLength(1)

    // Second reserver loses the race: unique_violation, nothing inserted.
    const err = await expectDbError(reserve(userB), '23505')
    expect(err.message).toMatch(/scratch_reservations_one_active/)
    expect(await t.asUser(userB, (tx) => rows(tx, 'select * from scratch_reservations'))).toEqual([])

    // After A cancels, the slot is free again.
    await t.asUser(userA, (tx) => tx.query(`update scratch_reservations set status = 'cancelled' where wish_id = $1`, [wish]))
    expect(await reserve(userB)).toHaveLength(1)
    expect(await t.asService((tx) => scalar<number>(tx, 'select count(*)::int from scratch_reservations'))).toBe(2)
  })

  it('(h) auth.uid() is null outside asUser, and claims do not leak between calls', async () => {
    expect(await scalar<string | null>(t.db, 'select auth.uid()')).toBeNull()
    expect(await scalar<string | null>(t.db, 'select auth.role()')).toBeNull()
    expect(await scalar<object>(t.db, 'select auth.jwt()')).toEqual({})
    expect(await scalar<string>(t.db, 'select current_user')).toBe('postgres')
    // Inside: set. Right after: gone again.
    expect(await t.asUser(userA, (tx) => scalar<string | null>(tx, 'select auth.uid()'))).toBe(userA)
    expect(await scalar<string | null>(t.db, 'select auth.uid()')).toBeNull()
    expect(await t.asService((tx) => scalar<string | null>(tx, 'select auth.uid()'))).toBeNull()
  })
})

describe('migration runner', () => {
  it('applies *.sql files in lexical order, one transaction each', async () => {
    const m = await createTestDb({ migrationsDir: resolve(FIXTURES, 'migrations') })
    try {
      expect(m.appliedMigrations).toEqual(['0001_things.sql', '0002_things_add_note.sql'])
      const user = await m.createUser('m@example.test')
      const seen = await m.asUser(user, async (tx) => {
        await tx.query(`insert into things (owner, name, note) values ($1, 'thing', 'added by 0002')`, [user])
        return rows<{ name: string; note: string }>(tx, 'select name, note from things')
      })
      expect(seen).toEqual([{ name: 'thing', note: 'added by 0002' }])
      // RLS declared in a migration is live for other users too.
      const other = await m.createUser('other@example.test')
      expect(await m.asUser(other, (tx) => rows(tx, 'select * from things'))).toEqual([])
    } finally {
      await m.close()
    }
  })

  it('tolerates a missing migrations folder', async () => {
    const m = await createTestDb({ migrationsDir: resolve(FIXTURES, 'does-not-exist'), quiet: true })
    try {
      expect(m.appliedMigrations).toEqual([])
      expect(await scalar<string>(m.db, 'select current_user')).toBe('postgres')
    } finally {
      await m.close()
    }
  })

  it('reports a failing migration by file name', async () => {
    await expect(createTestDb({ migrationsDir: resolve(FIXTURES, 'broken-migrations') })).rejects.toThrow(
      /migration 0001_broken\.sql failed: .*syntax error/,
    )
  })
})

describe('the one thing the project depends on: PGlite enforces RLS after SET LOCAL ROLE', () => {
  it('asUser really runs as the non-superuser role `authenticated`', async () => {
    const who = await t.asUser(userA, async (tx) => ({
      currentUser: await scalar<string>(tx, 'select current_user'),
      sessionUser: await scalar<string>(tx, 'select session_user'),
      superuser: await scalar<boolean>(tx, 'select rolsuper from pg_roles where rolname = current_user'),
      bypassRls: await scalar<boolean>(tx, 'select rolbypassrls from pg_roles where rolname = current_user'),
      jwt: await scalar<Record<string, string>>(tx, 'select auth.jwt()'),
    }))
    expect(who).toEqual({
      currentUser: 'authenticated',
      sessionUser: 'postgres',
      superuser: false,
      bypassRls: false,
      jwt: { sub: userA, role: 'authenticated' },
    })
  })

  it('negative control: the same claims WITHOUT SET ROLE bypass RLS (superuser)', async () => {
    // If this ever started returning 1, RLS would be "enforced" for the wrong
    // reason (e.g. the policy filtering) and the SET ROLE evidence would be moot.
    const asSuperuserWithClaims = await t.db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userB])
      return scalar<number>(tx, 'select count(*)::int from scratch_items')
    })
    expect(asSuperuserWithClaims).toBe(2)
    expect(await t.asUser(userB, (tx) => scalar<number>(tx, 'select count(*)::int from scratch_items'))).toBe(1)
  })

  it('a throw inside asUser rolls the transaction back and restores the superuser', async () => {
    await expect(
      t.asUser(userA, async (tx) => {
        await tx.query(`insert into scratch_items (owner, secret) values ($1, 'rolled back')`, [userA])
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await scalar<number>(t.db, `select count(*)::int from scratch_items where secret = 'rolled back'`)).toBe(0)
    expect(await scalar<string>(t.db, 'select current_user')).toBe('postgres')
    expect(await scalar<string | null>(t.db, 'select auth.uid()')).toBeNull()
  })
})
