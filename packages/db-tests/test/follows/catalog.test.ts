/**
 * F01 — catalog of wave 2b M1 + M2 (follows-design §4.4, §7.2 F01, S2, S3, S12, S18, A8):
 *   the three follow tables: RLS enabled + forced, NOT ONE privilege of any kind (table, column, REFERENCES, TRIGGER,
 *   TRUNCATE) for anon / authenticated / PUBLIC and NOT ONE policy; cascades from profiles;
 *   column grants of wishlists / wishes / profiles exactly as §4.4 (updated_at of wishes and wishlists under
 *   authenticated -> 42501); the policy text of occasion_members_select with the block filter; the new end reasons;
 *   the new RPCs are definer + pinned search_path, executable by authenticated only, and none of them takes a
 *   "role / viewer / as" argument; the relation helpers are executable by nobody but definer code.
 * (The exact allow-lists of executable functions live in test/attack/round1-meta.test.ts.)
 * private.features is M3 (agent J2), not part of this step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { createMember } from '../pilot/seed'
import { m3Applied } from './seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const FOLLOW_TABLES = ['follows', 'follow_cooldowns', 'follow_links'] as const
const NEW_RPCS = [
  'get_list_screen(uuid)',
  'get_lists_overview()',
  'request_follow(uuid)',
  'request_follow_via_link(text)',
  'peek_follow_link(text)',
  'respond_follow(uuid, boolean)',
  'unfollow(uuid)',
  'remove_follower(uuid)',
  'create_follow_link()',
  'revoke_follow_links()',
  'get_profile_card(uuid)',
  'get_people_screen()',
] as const
const HELPERS = [
  'is_accepted_follower(uuid, uuid)',
  'has_follow_cooldown(uuid, uuid)',
  'visible_request(uuid, uuid)',
  'i_follow_state(uuid, uuid)',
  'follows_me_state(uuid, uuid)',
  'visible_relation(uuid, uuid)',
  'knows_profile(uuid, uuid)',
  'profile_card(uuid)',
  'make_follow_request(uuid, uuid)',
  'end_follow_reservations(uuid, uuid, text)',
  'end_list_reservations(uuid, text)',
  'shared_occasions(uuid, uuid)',
] as const

async function columns(table: string, privilege: 'SELECT' | 'INSERT' | 'UPDATE'): Promise<string[]> {
  const r = await rows<{ column_name: string }>(
    t.db,
    `select column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' and privilege_type = $2 order by 1`,
    [table, privilege],
  )
  return r.map((x) => x.column_name)
}

describe('the three follow tables are RPC-only', () => {
  it('RLS enabled + forced, no policy, no privilege of any kind for anon / authenticated / PUBLIC', async () => {
    for (const table of FOLLOW_TABLES) {
      expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass`, [`public.${table}`]), table).toEqual([
        { relrowsecurity: true, relforcerowsecurity: true },
      ])
      expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'public' and tablename = $1`, [table]), table).toEqual([])
      for (const who of ['anon', 'authenticated', 'public']) {
        for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
          expect(await scalar<boolean>(t.db, `select has_table_privilege($1, $2, $3)`, [who, `public.${table}`, priv]), `${who} ${priv} ${table}`).toBe(false)
        }
        for (const priv of ['select', 'insert', 'update', 'references']) {
          expect(await scalar<boolean>(t.db, `select has_any_column_privilege($1, $2, $3)`, [who, `public.${table}`, priv]), `${who} column ${priv} ${table}`).toBe(false)
        }
      }
      expect(await rows(t.db, `select grantee from information_schema.table_privileges where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated', 'PUBLIC')`, [table])).toEqual([])
      expect(await rows(t.db, `select grantee from information_schema.column_privileges where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated', 'PUBLIC')`, [table])).toEqual([])
    }
  })

  it('every reference to profiles cascades on delete; follow_links.token_hash is a 32-byte unique sha256', async () => {
    const fks = await rows<{ tbl: string; col: string; action: string }>(
      t.db,
      `select c.conrelid::regclass::text as tbl, a.attname as col, c.confdeltype as action from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f' and c.conrelid in ('public.follows'::regclass, 'public.follow_cooldowns'::regclass, 'public.follow_links'::regclass)
        order by 1, 2`,
    )
    expect(fks).toEqual([
      { tbl: 'follow_cooldowns', col: 'followee_id', action: 'c' },
      { tbl: 'follow_cooldowns', col: 'follower_id', action: 'c' },
      { tbl: 'follow_links', col: 'owner_id', action: 'c' },
      { tbl: 'follows', col: 'followee_id', action: 'c' },
      { tbl: 'follows', col: 'follower_id', action: 'c' },
    ])
    const u = await createMember(t, 'Paula')
    for (const [bad, code] of [[`'\\x00'::bytea`, '23514'], [`sha256('a'::bytea)`, null]] as const) {
      const insert = t.asService((tx) => tx.query(`insert into follow_links (owner_id, token_hash, expires_at) values ($1, ${bad}, now() + interval '1 day')`, [u]))
      if (code) await expectDbError(insert, code)
      else await insert
    }
    await expectDbError(t.asService((tx) => tx.query(`insert into follow_links (owner_id, token_hash, expires_at) values ($1, sha256('a'::bytea), now() + interval '1 day')`, [u])), '23505')
    await expectDbError(t.asService((tx) => tx.query(`insert into follow_links (owner_id, token_hash, expires_at, use_count) values ($1, sha256('b'::bytea), now() + interval '1 day', 21)`, [u])), '23514')
    // follows: no self-follow, the status / timestamps are consistent
    for (const sql of [
      `insert into follows (follower_id, followee_id, status, expires_at) values ($1, $1, 'pending', now() + interval '1 day')`,
      `insert into follows (follower_id, followee_id, status) values ($1, $2, 'pending')`,
      `insert into follows (follower_id, followee_id, status, expires_at) values ($1, $2, 'accepted', now())`,
      `insert into follows (follower_id, followee_id, status, expires_at) values ($1, $2, 'blocked', now())`,
    ]) {
      const other = await createMember(t, 'Finn')
      await expectDbError(t.asService((tx) => tx.query(sql, sql.includes('$2') ? [u, other] : [u])), '23514')
    }
  })

  it('the API role reads, writes and counts nothing of them (42501), not even xmin / xmax', async () => {
    const u = await createMember(t, 'Rosa')
    for (const table of FOLLOW_TABLES) {
      for (const sql of [
        `select * from ${table}`,
        `select count(*) from ${table}`,
        `select xmax from ${table}`,
        `delete from ${table}`,
        `update ${table} set ${table === 'follow_links' ? 'use_count = 0' : table === 'follows' ? "status = 'accepted'" : 'until = now()'}`,
        `table ${table}`,
      ]) {
        const err = await expectDbError(t.asUser(u, (tx) => tx.query(sql)), '42501')
        expect(err.message, sql).toMatch(new RegExp(`permission denied for table ${table}`))
        await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
      }
    }
  })
})

describe('column grants after M1 (follows-design §4.4)', () => {
  it('wishlists: SELECT without updated_at, INSERT only as column grant, UPDATE title / cover / date, DELETE by policy', async () => {
    expect(await columns('wishlists', 'SELECT')).toEqual(['cover_icon', 'cover_tone', 'created_at', 'due_on', 'id', 'occasion_id', 'owner_id', 'recipient_id', 'title', 'visibility'])
    expect(await columns('wishlists', 'INSERT')).toEqual(['cover_icon', 'cover_tone', 'due_on', 'id', 'occasion_id', 'owner_id', 'recipient_id', 'title', 'visibility'])
    expect(await columns('wishlists', 'UPDATE')).toEqual(['cover_icon', 'cover_tone', 'due_on', 'title'])
    for (const priv of ['select', 'insert', 'update', 'truncate', 'references', 'trigger']) {
      expect(await scalar<boolean>(t.db, `select has_table_privilege('authenticated', 'public.wishlists', $1)`, [priv]), priv).toBe(false)
    }
    expect(await scalar<boolean>(t.db, `select has_table_privilege('authenticated', 'public.wishlists', 'delete')`)).toBe(true)
  })

  it('wishes: SELECT without updated_at (the rest unchanged); profiles: SELECT id + display_name, UPDATE + banner', async () => {
    // 20261022120000: + the wish details (brand, color, description, gtin, shop_name), the same readers and writer
    // 20261022160000: + received_at (readable like the rest; written only by set_wish_received, no UPDATE grant)
    expect(await columns('wishes', 'SELECT')).toEqual(['brand', 'color', 'created_at', 'currency', 'description', 'gtin', 'id', 'note', 'price_cents', 'priority', 'quantity', 'received_at', 'shop_name', 'title', 'url', 'wishlist_id'])
    expect(await columns('wishes', 'UPDATE')).toEqual(['brand', 'color', 'currency', 'description', 'gtin', 'note', 'price_cents', 'priority', 'quantity', 'shop_name', 'title', 'url'])
    expect(await columns('profiles', 'SELECT')).toEqual(['display_name', 'id'])
    // M3 (20261020200200): + in_suggestions — writable by the person, never SELECT-granted (§4.4)
    // 20261027120000: + invitations_from ("Einladungen in Anlässe") — the same pattern
    expect(await columns('profiles', 'UPDATE')).toEqual(
      (await m3Applied(t)) ? ['banner', 'display_name', 'in_suggestions', 'invitations_from', 'locale', 'onboarding_done_at'] : ['banner', 'display_name', 'locale', 'onboarding_done_at'],
    )
    const u = await createMember(t, 'Greta')
    for (const sql of ['select updated_at from wishes', 'select updated_at from wishlists', 'select banner from profiles', 'select * from wishlists']) {
      await expectDbError(t.asUser(u, (tx) => tx.query(sql)), '42501')
    }
  })
})

describe('policies, constraints, triggers', () => {
  it('occasion_members_select hides ACTIVE rows of a blocked pair; wishlists_select has the owner short path first', async () => {
    const pol = await rows<{ policyname: string; qual: string }>(
      t.db,
      `select policyname, qual from pg_policies where schemaname = 'public' and policyname in ('occasion_members_select', 'wishlists_select', 'wishlists_insert') order by 1`,
    )
    const members = pol.find((p) => p.policyname === 'occasion_members_select')!.qual
    expect(members).toMatch(/status = 'active'::text\) AND \(NOT private\.is_blocked_pair\(profile_id/)
    expect(members).toMatch(/status <> 'active'::text\) AND private\.is_host\(occasion_id/)
    expect(pol.find((p) => p.policyname === 'wishlists_select')!.qual).toMatch(/^\(\(owner_id = \( SELECT auth\.uid\(\)/)
    const insert = await scalar<string>(t.db, `select with_check from pg_policies where schemaname = 'public' and policyname = 'wishlists_insert'`)
    expect(insert).toMatch(/'private'::text/)
    if (!(await m3Applied(t))) expect(insert).not.toMatch(/followers/) // M3 adds the explicit 'followers' choice
  })

  it('the end reasons of reservations include access_ended and unfollowed; the visibility check knows no followers before M3', async () => {
    const reasons = await scalar<string>(t.db, `select pg_get_constraintdef(oid) from pg_constraint where conname = 'reservations_end_reason_check'`)
    for (const r of ['by_reserver', 'member_removed', 'member_left', 'blocked', 'wish_deleted', 'access_ended', 'unfollowed']) expect(reasons).toContain(`'${r}'`)
    const vis = await scalar<string>(t.db, `select pg_get_constraintdef(oid) from pg_constraint where conname = 'wishlists_visibility_check'`)
    expect(vis).toContain(`'private'`)
    expect(vis).toContain(`'occasion'`)
    if (!(await m3Applied(t))) expect(vis).not.toContain('followers')
  })

  it('wishlists has the guard (UPDATE) and the 20-lists limit (BEFORE INSERT); the guard compares NULL-safe', async () => {
    const trg = await rows<{ tgname: string }>(
      t.db,
      `select tgname from pg_trigger where tgrelid = 'public.wishlists'::regclass and not tgisinternal order by 1`,
    )
    // + wishlist_before_delete (20261027200000: a shared wish's home moves to its oldest other place)
    expect(trg.map((x) => x.tgname)).toEqual(['set_updated_at', 'wishlist_before_delete', 'wishlist_guard', 'wishlist_limit', 'wishlists_lock_owned_delete'])
    expect(await scalar<string>(t.db, `select prosrc from pg_proc where proname = 'wishlist_guard'`)).toMatch(/is distinct from old\.occasion_id/)
    expect(await scalar<boolean>(t.db, `select prosecdef from pg_proc where proname = 'wishlist_limit'`)).toBe(false) // invoker
  })
})

describe('functions of M1 + M2', () => {
  it('every new RPC: security definer, search_path pinned, executable by authenticated, never by anon / PUBLIC', async () => {
    for (const fn of NEW_RPCS) {
      const sig = `public.${fn}`
      expect(await scalar<boolean>(t.db, `select prosecdef from pg_proc where oid = $1::regprocedure`, [sig]), sig).toBe(true)
      const cfg = await scalar<string[]>(t.db, `select proconfig from pg_proc where oid = $1::regprocedure`, [sig])
      expect(cfg.length, sig).toBe(1)
      expect(['search_path=""', "search_path=''", 'search_path='], sig).toContain(cfg[0])
      expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', $1, 'execute')`, [sig]), sig).toBe(true)
      expect(await scalar<boolean>(t.db, `select has_function_privilege('anon', $1, 'execute')`, [sig]), sig).toBe(false)
      expect(await scalar<boolean>(t.db, `select has_function_privilege('public', $1, 'execute')`, [sig]), sig).toBe(false)
    }
    expect(await scalar<boolean>(t.db, `select prosecdef from pg_proc where oid = 'public.export_my_data()'::regprocedure`)).toBe(false) // stays invoker
  })

  it('the relation helpers are definer + pinned and executable by NO API role; the two export helpers only by authenticated', async () => {
    for (const fn of HELPERS) {
      const sig = `private.${fn}`
      expect(await scalar<boolean>(t.db, `select prosecdef from pg_proc where oid = $1::regprocedure`, [sig]), sig).toBe(true)
      for (const who of ['anon', 'authenticated', 'public']) {
        expect(await scalar<boolean>(t.db, `select has_function_privilege($1, $2, 'execute')`, [who, sig]), `${who} ${sig}`).toBe(false)
      }
    }
    for (const sig of ['private.my_follows_export()', 'private.my_wishlists_export()']) {
      expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', $1, 'execute')`, [sig]), sig).toBe(true)
      expect(await scalar<boolean>(t.db, `select has_function_privilege('anon', $1, 'execute')`, [sig]), sig).toBe(false)
      expect(await scalar<number>(t.db, `select pronargs::int from pg_proc where oid = $1::regprocedure`, [sig]), sig).toBe(0)
    }
    const u = await createMember(t, 'Moritz')
    for (const call of [`private.visible_request('${u}', '${u}')`, `private.profile_card('${u}')`, `private.i_follow_state('${u}', '${u}')`]) {
      const err = await expectDbError(t.asUser(u, (tx) => tx.query(`select ${call}`)), '42501')
      expect(err.message).toMatch(/permission denied for function/)
    }
  })

  it('no RPC takes a "role / viewer / as somebody" argument (S18: no "look as a follower")', async () => {
    const args = await rows<{ fn: string; arg: string }>(
      t.db,
      `select p.proname as fn, unnest(p.proargnames) as arg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proargnames is not null`,
    )
    expect(args.length).toBeGreaterThan(10)
    for (const a of args) expect(a.arg, a.fn).not.toMatch(/role|viewer|as_|view_as|impersonat|for_user|uid/i)
  })

  it('no view, no sequence, no publication appeared; reservations keep only the reservation_guard trigger', async () => {
    expect(await rows(t.db, `select viewname from pg_views where schemaname in ('public', 'private')`)).toEqual([])
    expect(await rows(t.db, `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S'`)).toEqual([])
    expect(await rows(t.db, `select pubname from pg_publication`)).toEqual([])
    expect(await rows(t.db, `select tgname from pg_trigger where tgrelid = 'public.reservations'::regclass and not tgisinternal`)).toEqual([{ tgname: 'reservation_guard' }])
  })
})
