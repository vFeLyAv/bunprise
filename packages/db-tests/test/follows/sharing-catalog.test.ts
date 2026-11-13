/**
 * F01 + F18 for M3 / M4 (20261020200200_follow_sharing.sql, 20261020200300_free_wishes.sql; follows-design §3.4, §4.4,
 * §5.1, S4, S18, A10):
 *   the audience 'followers' (CHECK; only for lists without an occasion), the insert policy's two branches, the
 *   partial index; profiles.in_suggestions (default false, UPDATE grant, no SELECT); the new RPCs are definer +
 *   pinned + authenticated-only; the new helpers (red button, can_find_gift, the list cards) are executable by NO API
 *   role; the final can_read_wishlist asks the red button and the accepted follow; branch markers: the owner part of
 *   get_list_screen and the whole overview never name the secret table, the helpers the owner's screens use neither;
 *   the gift search decides not_found BEFORE it reads anything about reservations; strict_multi_assignment-safe bodies.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, rpc } from '../pilot/seed'
import { createList, createOccasion } from './seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const NEW_RPCS = ['set_list_visibility(uuid, text)', 'get_free_wishes(uuid, integer)'] as const
const NEW_HELPERS = ['follower_lists_on()', 'can_find_gift(uuid, uuid)', 'follower_list_cards(uuid, uuid)', 'lock_owned_delete()'] as const

/**
 * `set search_path = ''` is stored as one config entry (spelled differently by different server versions). Since
 * 20261027200000 the functions that read reservations for a giver also carry enable_seqscan=off + enable_bitmapscan=off (INV-7 b, Codex 27.10 #1) — the only
 * other entry allowed.
 */
function expectPinned(cfg: string[] | null, sig: string): void {
  expect(cfg, sig).not.toBeNull()
  const rest = cfg!.filter((c) => c !== 'enable_seqscan=off' && c !== 'enable_bitmapscan=off')
  expect(rest.length, sig).toBe(1)
  expect(['search_path=""', "search_path=''", 'search_path='], sig).toContain(rest[0])
}

function body(schema: 'public' | 'private', fn: string): Promise<string> {
  return scalar<string>(t.db, `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2`, [schema, fn])
}

describe('the audience followers', () => {
  it('the CHECK knows followers; a list of an occasion can never be followers (kind check); the partial index exists', async () => {
    const vis = await scalar<string>(t.db, `select pg_get_constraintdef(oid) from pg_constraint where conname = 'wishlists_visibility_check'`)
    for (const v of ['occasion', 'private', 'followers']) expect(vis).toContain(`'${v}'`)
    const u = await createMember(t, 'Paula')
    const [occasionId, occList] = await createOccasion(t, u, 'Paulas Fest')
    const kind = await expectDbError(
      t.asService((tx) => tx.query(`insert into wishlists (occasion_id, owner_id, recipient_id, title, visibility) values ($1, $2, $2, 'x', 'followers')`, [occasionId, u])),
      '23514',
    )
    expect(kind.message).toContain('wishlists_kind_check')
    // the occasion's own list cannot be switched either (set_list_visibility: not_found, it is not a standalone list)
    await expect(rpc(t, u, 'set_list_visibility', [occList, 'followers'])).rejects.toMatchObject({ message: 'not_found' })
    const anything = await expectDbError(t.asService((tx) => tx.query(`update wishlists set visibility = 'followers' where id = $1`, [occList])), '23514')
    expect(anything.message).toContain('wishlists_kind_check')
    expect(await scalar<string>(t.db, `select indexdef from pg_indexes where indexname = 'wishlists_followers_idx'`)).toMatch(/\(owner_id\) WHERE \(visibility = 'followers'::text\)/)
  })

  it('wishlists_insert: the occasion branch unchanged, the standalone branch "private" or "followers" — through REST with returning', async () => {
    const insert = await scalar<string>(t.db, `select with_check from pg_policies where schemaname = 'public' and policyname = 'wishlists_insert'`)
    expect(insert).toMatch(/'private'::text, 'followers'::text/)
    expect(insert).toMatch(/visibility = 'occasion'::text/)
    expect(insert).toMatch(/is_host/)
    const u = await createMember(t, 'Finn')
    const r = await t.asUser(u, (tx) =>
      rows(tx, `insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, 'Für Follower', 'followers') returning id, visibility`, [u]),
    )
    expect(r).toEqual([{ id: expect.any(String), visibility: 'followers' }])
    // a list "for somebody else" stays impossible — also as a follower list
    const other = await createMember(t, 'Greta')
    await expectDbError(t.asUser(u, (tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $2, 'x', 'followers')`, [u, other])), '42501')
    expect(await createList(t, u, 'Nur ich')).toEqual(expect.any(String))
  })

  it('profiles.in_suggestions: not null default false, own UPDATE only, no SELECT through REST', async () => {
    expect(await rows(t.db, `select is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'in_suggestions'`)).toEqual([
      { is_nullable: 'NO', column_default: 'false' },
    ])
    expect(await scalar<boolean>(t.db, `select has_column_privilege('authenticated', 'public.profiles', 'in_suggestions', 'update')`)).toBe(true)
    for (const priv of ['select', 'insert', 'references']) {
      expect(await scalar<boolean>(t.db, `select has_column_privilege('authenticated', 'public.profiles', 'in_suggestions', $1)`, [priv]), priv).toBe(false)
    }
    const u = await createMember(t, 'Moritz')
    for (const sql of ['select in_suggestions from profiles', `update profiles set in_suggestions = true where id = '${u}' returning in_suggestions`, 'select * from profiles']) {
      await expectDbError(t.asUser(u, (tx) => tx.query(sql)), '42501')
    }
    await expectDbError(t.asUser(u, (tx) => tx.query('update profiles set in_suggestions = null where id = $1', [u])), '23502')
  })
})

describe('functions of M3 + M4', () => {
  it('every owned deletion locks the profile before target rows, including occasion cascades', async () => {
    expect(await rows(t.db, `select c.relname, g.tgtype::int as type from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      where g.tgfoid = 'private.lock_owned_delete()'::regprocedure order by c.relname`)).toEqual([
      { relname: 'occasions', type: 10 },
      { relname: 'wishes', type: 10 },
      { relname: 'wishlists', type: 10 },
    ]) // 10 = BEFORE DELETE FOR EACH STATEMENT, before any target row locks
  })

  it('the new RPCs: security definer, search_path pinned, authenticated only; get_free_wishes has the default budget', async () => {
    for (const fn of NEW_RPCS) {
      const sig = `public.${fn}`
      expect(await scalar<boolean>(t.db, `select prosecdef from pg_proc where oid = $1::regprocedure`, [sig]), sig).toBe(true)
      expectPinned(await scalar<string[]>(t.db, `select proconfig from pg_proc where oid = $1::regprocedure`, [sig]), sig)
      expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', $1, 'execute')`, [sig]), sig).toBe(true)
      for (const who of ['anon', 'public']) expect(await scalar<boolean>(t.db, `select has_function_privilege($1, $2, 'execute')`, [who, sig]), `${who} ${sig}`).toBe(false)
    }
    expect(await scalar<number>(t.db, `select pronargdefaults::int from pg_proc where oid = 'public.get_free_wishes(uuid, integer)'::regprocedure`)).toBe(1)
    expect(await scalar<string>(t.db, `select provolatile::text from pg_proc where oid = 'public.get_free_wishes(uuid, integer)'::regprocedure`)).toBe('s') // stable: it reads only
    expect(await scalar<string>(t.db, `select provolatile::text from pg_proc where oid = 'public.set_list_visibility(uuid, text)'::regprocedure`)).toBe('v')
  })

  it('the new helpers are definer + pinned and executable by NO API role', async () => {
    const u = await createMember(t, 'Rosa')
    for (const fn of NEW_HELPERS) {
      const sig = `private.${fn}`
      expect(await scalar<boolean>(t.db, `select prosecdef from pg_proc where oid = $1::regprocedure`, [sig]), sig).toBe(true)
      expectPinned(await scalar<string[]>(t.db, `select proconfig from pg_proc where oid = $1::regprocedure`, [sig]), sig)
      for (const who of ['anon', 'authenticated', 'public']) {
        expect(await scalar<boolean>(t.db, `select has_function_privilege($1, $2, 'execute')`, [who, sig]), `${who} ${sig}`).toBe(false)
      }
    }
    for (const call of ['private.follower_lists_on()', `private.can_find_gift('${u}', '${u}')`, `private.follower_list_cards('${u}', '${u}')`]) {
      const err = await expectDbError(t.asUser(u, (tx) => tx.query(`select ${call}`)), '42501')
      expect(err.message).toMatch(/permission denied for function/)
    }
    // can_read_wishlist stays callable for the policies (it is what REST reads through)
    expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', 'private.can_read_wishlist(uuid, uuid)', 'execute')`)).toBe(true)
  })

  it('can_read_wishlist: the owner, the occasion\'s active guests, and accepted followers of a followers list behind the switch', async () => {
    const src = await body('private', 'can_read_wishlist')
    expect(src).toMatch(/wl\.owner_id = p_uid/)
    expect(src).toMatch(/visibility = 'followers' and private\.follower_lists_on\(\)\s+and private\.is_accepted_follower\(p_uid, wl\.owner_id\)/)
    expect(src).toMatch(/is_blocked_pair\(p_uid, wl\.owner_id\)/)
    expect(src).toMatch(/is_blocked_pair\(p_uid, wl\.recipient_id\)/)
    expect(src).not.toMatch(/reservations/)
  })
})

describe('F18 branch markers and the order of checks (M3 / M4)', () => {
  // since 20261027200000 the wishes of both list screens come from private.list_wish_objects (one owner branch, one
  // audience branch); get_list_screen itself never names the secret table
  it('get_list_screen / list_wish_objects: nothing before the AUDIENCE BRANCH names the secret table; the audience sees no reserver', async () => {
    expect(await body('public', 'get_list_screen')).not.toMatch(/reserv/i)
    const src = await body('private', 'list_wish_objects')
    const audience = src.search(/--\s*AUDIENCE BRANCH/)
    expect(audience).toBeGreaterThan(0)
    expect(src.indexOf('-- OWNER BRANCH')).toBeLessThan(audience)
    // (the owner part carries the two contract keys with literal nulls — never the table)
    const ownerPart = src.slice(0, audience).replace(/--[^\n]*/g, '')
    expect(ownerPart).not.toMatch(/reservations/i)
    expect(ownerPart.match(/reserv/g)).toHaveLength(2)
    const audiencePart = src.slice(audience)
    // one bounded lookup per wish (the unique active index), only a LIVE row counts (INV-7 b)
    expect(audiencePart).toMatch(/where r\.wish_id = w\.id and r\.status = 'active'\s+and private\.reservation_is_live\(r\.wish_id, r\.reserver_id, r\.recipient_id\)\s+limit 1/)
    expect(audiencePart).toMatch(/'reserved', rr\.by_id is not null, 'reserved_by_me', coalesce\(rr\.by_id = p_viewer, false\)/)
    expect(audiencePart).not.toMatch(/'reserver|display_name|reserved_by_name/)
  })

  it('the overview and every helper an owner\'s screen calls never name the secret table', async () => {
    expect(await body('public', 'get_lists_overview')).not.toMatch(/reservation/i)
    for (const fn of ['follower_list_cards', 'can_find_gift', 'follower_lists_on', 'profile_card', 'shared_occasions']) {
      expect(await body('private', fn), fn).not.toMatch(/reservation/i)
    }
    for (const fn of ['get_profile_card', 'get_me']) expect(await body('public', fn), fn).not.toMatch(/reservation/i)
    // 20261027200000 (INV-7 a): set_list_visibility does no reservation work at all (liveness decides)
    const vis = await body('public', 'set_list_visibility')
    expect(vis.replace(/--[^\n]*/g, '')).not.toMatch(/reservation/i)
  })

  // 20261027200000: one path for every place of the wish — the pair lock, the wish's identity under it, then the
  // reader rule of the WISH (private.can_read_wish: any effective place; follower lists behind the red button)
  it('reserve_wish: the owner is refused before the audience; under the pair lock the wish, then the reader rule, then reservations', async () => {
    const src = await body('public', 'reserve_wish')
    const order = [
      'if v_uid in (v_owner, v_recipient) then raise',
      'private.lock_profile_pair(v_uid, v_recipient)',
      // received_at is read under the lock (a received wish is never newly reserved)
      'select w.title, w.received_at, w.wishlist_id into v_title, v_received, v_home',
      'where w.id = p_wish_id and h.recipient_id = v_recipient and h.owner_id = v_owner',
      'for key share of w',
      'private.can_read_wish(p_wish_id, v_uid)',
      "from public.reservations r where r.wish_id = p_wish_id and r.status = 'active'",
      "if v_received is not null then raise exception using message = 'not_allowed'",
      "message = 'limit_reached'",
      'insert into public.reservations',
    ]
    let at = -1
    for (const piece of order) {
      const next = src.indexOf(piece, at + 1)
      expect(next, piece).toBeGreaterThan(at)
      at = next
    }
    // the first mention of the secret table comes after every access decision
    expect(src.indexOf('public.reservations')).toBeGreaterThan(src.indexOf('private.can_read_wish(p_wish_id, v_uid)'))
    expect(await body('private', 'can_read_wish')).toMatch(/private\.can_read_wishlist\(p\.wishlist_id, p_uid\)/)
  })

  it('get_free_wishes decides not_found (can_find_gift) before it reads anything about reservations', async () => {
    const src = await body('public', 'get_free_wishes')
    expect(src.indexOf("message = 'validation'")).toBeLessThan(src.indexOf('private.can_find_gift(v_uid, p_profile_id)'))
    expect(src.indexOf('private.can_find_gift(v_uid, p_profile_id)')).toBeLessThan(src.indexOf('public.reservations'))
    // one bounded lookup per wish (a scalar SubPlan, never an anti-join over the table); only a LIVE row hides a wish
    expect(src).toMatch(/\(select r\.id from public\.reservations r\s+where r\.wish_id = w\.id and r\.status = 'active'\s+and private\.reservation_is_live\(r\.wish_id, r\.reserver_id, r\.recipient_id\)\s+limit 1\) is null/)
    expect(src).not.toMatch(/'reserver|reserved_by|recipient_id = v_uid then/)
  })

  it('no function still declares a wishlists %rowtype; the new bodies compile under strict_multi_assignment', async () => {
    expect(await scalar<string>(t.db, `select current_setting('plpgsql.extra_errors')`)).toBe('strict_multi_assignment')
    const offenders = await scalar<string[]>(
      t.db,
      `select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosrc ~* 'wishlists%rowtype'`,
    )
    expect(offenders).toEqual([])
  })
})
