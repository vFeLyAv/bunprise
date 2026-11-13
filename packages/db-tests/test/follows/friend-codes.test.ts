/**
 * Friend codes (20261027160000, docs/spec/add-friends-design.md §2–§4): "Mein Code" (QR + K7M4-QX2P), "Code eingeben".
 *   8 characters Crockford Base32, 24 h, only sha256 stored (in no table, in no answer), at most 3 live (the 4th
 *   switches the oldest off, "Neuer Code" all); a lookup answers like the follow link (peek: banner, name, relation;
 *   request: { status, profile_id }) — and ONE value { invalid: true } for everything that does not work (malformed,
 *   unknown, expired, revoked, full for a newcomer, a block either way), which records a MISS (time only); 10 misses
 *   per hour / 30 per day → rate_limited for right and wrong codes alike; a read-only transaction (PostgREST GET) is
 *   refused before the lookup (Codex review 27.10, high); consents / name first (no lookup, no miss); at most 20 new
 *   requests per code; revoke_follow_links switches codes off too; export without the hash; cascade; purge; catalog.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES, createMember, expectRpcError, rpc } from '../pilot/seed'
import { followRows, rpcText } from './seed'
import { checkInvariants } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface NewCode { code: string; expires_at: string }
interface Peek { profile: { id: string; display_name: string | null }; relation: { self: boolean; i_follow: string } }

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/
const INVALID = { invalid: true }

async function newCode(uid: string, replace = false): Promise<string> {
  return (await rpc<NewCode>(t, uid, 'create_friend_code', [replace])).code
}

function codeRow(code: string) {
  return rows<{ use_count: number; revoked: boolean; live: boolean; owner_id: string }>(
    t.db,
    `select use_count, owner_id, revoked_at is not null as revoked, (revoked_at is null and expires_at > now()) as live
       from friend_codes where code_hash = sha256(convert_to($1::text, 'UTF8'))`,
    [code],
  ).then((r) => r[0] ?? null)
}

function misses(uid: string): Promise<number> {
  return scalar<number>(t.db, `select count(*)::int from friend_code_misses where profile_id = $1`, [uid])
}

/** "k7m4-qx2p" style: lower case with a dash in the middle — what people type. */
function typed(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase()
}

describe('creating codes', () => {
  it('8 Crockford characters, 24 hours, shown once: only sha256 is stored — in no table and no answer of the owner', async () => {
    const paula = await createMember(t, 'Paula')
    const answer = await rpc<NewCode>(t, paula, 'create_friend_code', [false])
    expect(Object.keys(answer).sort()).toEqual(['code', 'expires_at'])
    expect(answer.code).toMatch(CROCKFORD)
    const hours = await scalar<number>(t.db, `select (extract(epoch from ($1::timestamptz - now())) / 3600)::float8`, [answer.expires_at])
    expect(hours).toBeGreaterThan(23.99)
    expect(hours).toBeLessThanOrEqual(24)
    for (const table of [...ALL_TABLES.map((x) => `public.${x}`), 'auth.users']) {
      for (const r of await rows<{ j: string }>(t.db, `select to_jsonb(x)::text as j from ${table} x`)) expect(r.j, table).not.toContain(answer.code)
    }
    const hashHex = await scalar<string>(t.db, `select encode(sha256(convert_to($1::text, 'UTF8')), 'hex')`, [answer.code])
    expect(await scalar<number>(t.db, `select count(*)::int from friend_codes where encode(code_hash, 'hex') = $1`, [hashHex])).toBe(1)
    for (const fn of ['export_my_data', 'get_people_screen', 'get_lists_overview', 'get_me']) {
      const text = await rpcText(t, paula, fn)
      expect(text, fn).not.toContain(answer.code)
      expect(text, fn).not.toContain(hashHex)
    }
  })

  it('codes spread over the alphabet (40 random bits): 40 codes, all different, every character class used', async () => {
    const owner = await createMember(t, 'Viele')
    const codes = new Set<string>()
    for (let i = 0; i < 40; i++) codes.add(await newCode(owner))
    expect(codes.size).toBe(40)
    const chars = new Set([...codes].join(''))
    expect([...chars].some((c) => /[0-9]/.test(c))).toBe(true)
    expect([...chars].some((c) => /[A-Z]/.test(c))).toBe(true)
    expect(chars.size).toBeGreaterThan(20)
    for (const c of ['I', 'L', 'O', 'U']) expect(chars.has(c), c).toBe(false)
  })

  it('at most 3 live: the 4th switches the oldest off; "Neuer Code" (p_replace) switches every live one off', async () => {
    const paula = await createMember(t, 'Paula')
    const finn = await createMember(t, 'Finn')
    const codes = [await newCode(paula), await newCode(paula), await newCode(paula), await newCode(paula)]
    expect(await codeRow(codes[0]!)).toMatchObject({ revoked: true })
    for (const c of codes.slice(1)) expect(await codeRow(c)).toMatchObject({ live: true })
    expect(await rpc(t, finn, 'peek_friend_code', [codes[0]])).toEqual(INVALID)
    const fresh = await newCode(paula, true)
    for (const c of codes) expect(await rpc(t, finn, 'peek_friend_code', [c]), c).toEqual(INVALID)
    expect((await rpc<Peek>(t, finn, 'peek_friend_code', [fresh])).profile.id).toBe(paula)
    expect(await scalar<number>(t.db, `select count(*)::int from friend_codes where owner_id = $1 and revoked_at is null`, [paula])).toBe(1)
    // the owner's dead rows go with the next creation (the purge would remove them anyway)
    await newCode(paula)
    expect(await scalar<number>(t.db, `select count(*)::int from friend_codes where owner_id = $1 and revoked_at is not null`, [paula])).toBe(0)
  })

  it('needs consents and a name (like a follow link)', async () => {
    const nobody = await createMember(t, 'Ohne', { consents: false })
    await expectRpcError(rpc(t, nobody, 'create_friend_code', [false]), 'consent_required')
    const noName = await createMember(t, 'Leer')
    await t.asService((tx) => tx.query(`update profiles set display_name = null where id = $1`, [noName]))
    await expectRpcError(rpc(t, noName, 'create_friend_code', [false]), 'profile_incomplete')
  })
})

describe('peek_friend_code', () => {
  it('the follow-link answer (banner, name, relation); forgiving input; a hit writes nothing at all', async () => {
    const paula = await createMember(t, 'Paula')
    const xaver = await createMember(t, 'Xaver')
    const code = await newCode(paula)
    const snapshot = () => rows(t.db, `select (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]') from friend_codes c)::text as c,
                                              (select count(*) from friend_code_misses)::int as m,
                                              (select count(*) from follows)::int as f`)
    const before = await snapshot()
    const peek = await rpc<Peek>(t, xaver, 'peek_friend_code', [typed(code)])
    expect(peek).toEqual({ profile: { id: paula, display_name: 'Paula', banner: null, photo: null, banner_photo: null }, relation: { self: false, i_follow: 'none' } })
    expect(await rpc(t, xaver, 'peek_friend_code', [` ${code.slice(0, 4)} ${code.slice(4)} `])).toEqual(peek)
    // I and L read as 1, O as 0 (the alphabet has none of them)
    const confusable = code.replace(/1/g, 'l').replace(/0/g, 'O')
    expect(await rpc(t, xaver, 'peek_friend_code', [confusable])).toEqual(peek)
    expect(await snapshot()).toEqual(before)
    expect(await rpc<Peek>(t, paula, 'peek_friend_code', [code])).toMatchObject({ relation: { self: true, i_follow: 'none' } })
  })

  it('ONE answer for everything that does not work — and each is a miss (time only, never the code)', async () => {
    const paula = await createMember(t, 'Paula')
    const finn = await createMember(t, 'Finn')
    const bea = await createMember(t, 'Bea')
    const live = await newCode(paula)
    const expired = await newCode(paula)
    await t.asService((tx) => tx.query(`update friend_codes set created_at = now() - interval '25 hours', expires_at = now() - interval '1 minute'
                                         where code_hash = sha256(convert_to($1::text, 'UTF8'))`, [expired]))
    const revoked = await newCode(paula)
    await t.asService((tx) => tx.query(`update friend_codes set revoked_at = now() where code_hash = sha256(convert_to($1::text, 'UTF8'))`, [revoked]))
    const asker = await createMember(t, 'Frager')
    // exactly 10 — the hourly budget (the 11th would be rate_limited, below)
    const bad = [null, '', 'ZZZZZZZZ', live.slice(0, 7), `${live}2`, 'UUUUUUUU', `'; delete from friend_codes; --`, 'Ä'.repeat(8), expired, revoked]
    for (const [i, input] of bad.entries()) {
      expect(await rpc(t, asker, 'peek_friend_code', [input]), String(input)).toEqual(INVALID)
      expect(await misses(asker)).toBe(i + 1)
    }
    const stored = await rows(t.db, `select * from friend_code_misses where profile_id = $1 limit 1`, [asker])
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual(['missed_at', 'profile_id'])
    // a block, either direction: the same value
    await rpc(t, paula, 'block_user', [finn])
    expect(await rpc(t, finn, 'peek_friend_code', [live])).toEqual(INVALID)
    expect(await rpc(t, finn, 'request_follow_via_code', [live])).toEqual(INVALID)
    await rpc(t, bea, 'block_user', [paula])
    expect(await rpc(t, bea, 'peek_friend_code', [live])).toEqual(INVALID)
    expect(await followRows(t, 'followee_id = $1', [paula])).toEqual([])
    await checkInvariants(t)
  })

  it('without consents / a name: the same refusal for ANY code — no lookup, no miss', async () => {
    const paula = await createMember(t, 'Paula')
    const live = await newCode(paula)
    const nobody = await createMember(t, 'Ohne', { consents: false })
    for (const input of [live, 'ZZZZZZZZ', null]) {
      await expectRpcError(rpc(t, nobody, 'peek_friend_code', [input]), 'consent_required')
      await expectRpcError(rpc(t, nobody, 'request_follow_via_code', [input]), 'consent_required')
    }
    expect(await misses(nobody)).toBe(0)
  })

  it('a read-only transaction (PostgREST GET / HEAD) is refused before the lookup: no oracle, nothing written', async () => {
    const paula = await createMember(t, 'Paula')
    const live = await newCode(paula)
    const xaver = await createMember(t, 'Xaver')
    for (const fn of ['peek_friend_code', 'request_follow_via_code']) {
      for (const input of [live, 'ZZZZZZZZ']) {
        const err = await expectDbError(
          t.asUser(xaver, async (tx) => {
            await tx.exec('set transaction read only')
            return scalar(tx, `select public.${fn}($1) as v`, [input])
          }),
          'P0001',
        )
        expect(err.message, `${fn} ${input}`).toBe('not_allowed')
      }
    }
    expect(await misses(xaver)).toBe(0)
    expect(await codeRow(live)).toMatchObject({ use_count: 0 })
  })
})

describe('the miss limit', () => {
  it('10 misses in an hour → rate_limited for right AND wrong codes; older misses count for the day (30)', async () => {
    const paula = await createMember(t, 'Paula')
    const live = await newCode(paula)
    const rater = await createMember(t, 'Rater')
    for (let i = 0; i < 10; i++) expect(await rpc(t, rater, 'peek_friend_code', ['ZZZZZZZZ'])).toEqual(INVALID)
    for (const input of ['ZZZZZZZZ', live]) {
      await expectRpcError(rpc(t, rater, 'peek_friend_code', [input]), 'rate_limited')
      await expectRpcError(rpc(t, rater, 'request_follow_via_code', [input]), 'rate_limited')
    }
    expect(await misses(rater)).toBe(10) // a refusal is not a miss
    expect(await followRows(t, 'follower_id = $1', [rater])).toEqual([])
    // an hour later the hourly budget is back …
    await t.asService((tx) => tx.query(`update friend_code_misses set missed_at = missed_at - interval '2 hours' where profile_id = $1`, [rater]))
    expect((await rpc<Peek>(t, rater, 'peek_friend_code', [live])).profile.id).toBe(paula) // a hit is never a miss
    for (let i = 0; i < 10; i++) expect(await rpc(t, rater, 'peek_friend_code', ['ZZZZZZZZ'])).toEqual(INVALID)
    await expectRpcError(rpc(t, rater, 'peek_friend_code', [live]), 'rate_limited')
    await t.asService((tx) => tx.query(`update friend_code_misses set missed_at = missed_at - interval '2 hours' where profile_id = $1`, [rater]))
    for (let i = 0; i < 10; i++) expect(await rpc(t, rater, 'request_follow_via_code', ['ZZZZZZZZ'])).toEqual(INVALID)
    await t.asService((tx) => tx.query(`update friend_code_misses set missed_at = missed_at - interval '2 hours' where profile_id = $1 and missed_at > now() - interval '1 hour'`, [rater]))
    // … but 30 within 24 hours close the day
    expect(await misses(rater)).toBe(30)
    await expectRpcError(rpc(t, rater, 'peek_friend_code', [live]), 'rate_limited')
    // the limit is per account: somebody else is not affected
    const other = await createMember(t, 'Andere')
    expect((await rpc<Peek>(t, other, 'peek_friend_code', [live])).profile.id).toBe(paula)
  })
})

describe('request_follow_via_code', () => {
  it('a request like through the link; at most 20 new people per code; the same person again for free; own code', async () => {
    const paula = await createMember(t, 'Paula')
    const code = await newCode(paula)
    const finn = await createMember(t, 'Finn')
    expect(await rpc(t, finn, 'request_follow_via_code', [typed(code)])).toEqual({ status: 'requested', profile_id: paula })
    expect(await rpc(t, finn, 'request_follow_via_code', [code])).toEqual({ status: 'requested', profile_id: paula })
    expect(await codeRow(code)).toMatchObject({ use_count: 1 })
    expect(await followRows(t, 'followee_id = $1', [paula])).toMatchObject([{ follower_id: finn, status: 'pending' }])
    // the own code: nothing to ask — not a miss either
    expect(await rpc(t, paula, 'request_follow_via_code', [code])).toEqual(INVALID)
    expect(await misses(paula)).toBe(0)
    for (let i = 2; i <= 20; i++) {
      const someone = await createMember(t, `Gast${i}`)
      expect(await rpc(t, someone, 'request_follow_via_code', [code])).toMatchObject({ status: 'requested' })
    }
    expect(await codeRow(code)).toMatchObject({ use_count: 20 })
    const late = await createMember(t, 'Spät')
    expect(await rpc(t, late, 'peek_friend_code', [code])).toEqual(INVALID)
    expect(await rpc(t, late, 'request_follow_via_code', [code])).toEqual(INVALID)
    // the full code still answers the owner (self) and those with a live relation
    expect(await rpc<Peek>(t, paula, 'peek_friend_code', [code])).toMatchObject({ relation: { self: true } })
    expect(await rpc<Peek>(t, finn, 'peek_friend_code', [code])).toMatchObject({ relation: { i_follow: 'requested' } })
    expect(await rpc(t, finn, 'request_follow_via_code', [code])).toEqual({ status: 'requested', profile_id: paula })
    expect(await codeRow(code)).toMatchObject({ use_count: 20 })
    await checkInvariants(t)
  })

  it('accepted → "following"; limit_reached (30 open requests) takes no place on the code', async () => {
    const paula = await createMember(t, 'Paula')
    const code = await newCode(paula)
    const greta = await createMember(t, 'Greta')
    await rpc(t, greta, 'request_follow_via_code', [code])
    await rpc(t, paula, 'respond_follow', [greta, true])
    expect(await rpc(t, greta, 'request_follow_via_code', [code])).toEqual({ status: 'following', profile_id: paula })
    const rosa = await createMember(t, 'Rosa')
    for (let i = 1; i <= 30; i++) {
      const owner = await createMember(t, `Ziel${i}`)
      expect(await rpc(t, rosa, 'request_follow_via_code', [await newCode(owner)])).toMatchObject({ status: 'requested' })
    }
    const before = (await codeRow(code))?.use_count
    await expectRpcError(rpc(t, rosa, 'request_follow_via_code', [code]), 'limit_reached')
    expect((await codeRow(code))?.use_count).toBe(before)
  })
})

describe('switching codes off, export, deletion, purge', () => {
  it('revoke_friend_codes and revoke_follow_links ("Alle Links deaktivieren", the block switch) — no consents needed', async () => {
    const paula = await createMember(t, 'Paula')
    const finn = await createMember(t, 'Finn')
    const a = await newCode(paula)
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [paula]))
    expect(await rpc(t, paula, 'revoke_follow_links')).toEqual({ ok: true })
    expect(await rpc(t, finn, 'peek_friend_code', [a])).toEqual(INVALID)
    await t.asUser(paula, (tx) => tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [paula]))
    const b = await newCode(paula)
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [paula]))
    expect(await rpc(t, paula, 'revoke_friend_codes')).toEqual({ ok: true })
    expect(await rpc(t, finn, 'peek_friend_code', [b])).toEqual(INVALID)
  })

  it('the export lists my codes (times, counter — never the hash) and my misses (time only)', async () => {
    const paula = await createMember(t, 'Paula')
    const code = await newCode(paula)
    await rpc(t, paula, 'peek_friend_code', ['ZZZZZZZZ'])
    const exported = await rpc<{ follows: { friend_codes: Record<string, unknown>[]; friend_code_misses: Record<string, unknown>[] } }>(t, paula, 'export_my_data')
    expect(exported.follows.friend_codes).toHaveLength(1)
    expect(Object.keys(exported.follows.friend_codes[0] ?? {}).sort()).toEqual(['created_at', 'expires_at', 'revoked_at', 'use_count'])
    expect(exported.follows.friend_code_misses).toHaveLength(1)
    expect(Object.keys(exported.follows.friend_code_misses[0] ?? {})).toEqual(['missed_at'])
    expect(JSON.stringify(exported)).not.toContain(code)
  })

  it('deleting the account removes its codes and misses', async () => {
    const paula = await createMember(t, 'Paula')
    await newCode(paula)
    await rpc(t, paula, 'peek_friend_code', ['ZZZZZZZZ'])
    expect(await rpc(t, paula, 'delete_my_account')).toEqual({ ok: true })
    expect(await scalar<number>(t.db, `select count(*)::int from friend_codes where owner_id = $1`, [paula])).toBe(0)
    expect(await misses(paula)).toBe(0)
  })

  it('the daily purge removes dead codes and misses older than a day — nothing live', async () => {
    const paula = await createMember(t, 'Paula')
    const live = await newCode(paula)
    const dead = await newCode(paula)
    await t.asService((tx) => tx.query(`update friend_codes set revoked_at = now() where code_hash = sha256(convert_to($1::text, 'UTF8'))`, [dead]))
    await rpc(t, paula, 'peek_friend_code', ['ZZZZZZZZ'])
    await rpc(t, paula, 'peek_friend_code', ['ZZZZZZZY'])
    await t.asService((tx) => tx.query(`update friend_code_misses set missed_at = now() - interval '25 hours' where ctid = (select ctid from friend_code_misses where profile_id = $1 limit 1)`, [paula]))
    await t.asService((tx) => tx.query('select private.purge_friend_codes()'))
    expect(await codeRow(dead)).toBeNull()
    expect(await codeRow(live)).toMatchObject({ live: true })
    expect(await misses(paula)).toBe(1)
  })
})

describe('catalog', () => {
  it('both tables: RLS enabled + forced, NOT ONE policy, NOT ONE privilege for anon / authenticated / PUBLIC', async () => {
    for (const table of ['friend_codes', 'friend_code_misses']) {
      expect(await rows(t.db, `select relrowsecurity as rls, relforcerowsecurity as forced from pg_class where oid = $1::regclass`, [`public.${table}`]))
        .toEqual([{ rls: true, forced: true }])
      expect(await scalar<number>(t.db, `select count(*)::int from pg_policies where schemaname = 'public' and tablename = $1`, [table])).toBe(0)
      for (const role of ['anon', 'authenticated', 'public']) {
        expect(await rows(t.db, `select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee = $2`, [table, role]), `${table} ${role}`).toEqual([])
        expect(await rows(t.db, `select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = $1 and grantee = $2`, [table, role]), `${table} ${role}`).toEqual([])
      }
    }
  })

  it('the RPCs: security definer, pinned search_path, authenticated only; the helpers nobody', async () => {
    for (const fn of ['create_friend_code(boolean)', 'peek_friend_code(text)', 'request_follow_via_code(text)', 'revoke_friend_codes()']) {
      expect(await rows(t.db, `select p.prosecdef as definer, 'search_path=""' = any(p.proconfig) as pinned, p.provolatile as volatility,
                                      has_function_privilege('authenticated', p.oid, 'execute') as auth,
                                      has_function_privilege('anon', p.oid, 'execute') as anon
                                 from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`]), fn)
        .toEqual([{ definer: true, pinned: true, volatility: 'v', auth: true, anon: false }])
    }
    for (const fn of ['normalize_friend_code(text)', 'friend_code_gate(uuid)', 'friend_code_owner(uuid, text)', 'purge_friend_codes()']) {
      expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', $1::regprocedure, 'execute')`, [`private.${fn}`]), fn).toBe(false)
    }
  })
})
