/**
 * F04 — follow links (follows-design §2.9, §5.4, P3, P16, P17, review #8 / #16):
 *   64 hex, shown once, only sha256 stored (every row of every table scanned); the 6th live link switches off the
 *   oldest; peek writes and counts nothing; one code — invite_invalid — after revocation, expiry, a block (either
 *   direction), on the own link (request) and for garbage; WITHOUT current consents the same consent_required for
 *   ANY code (garbage, unknown, revoked, live) in peek and in request — the account learns nothing about the code;
 *   without a name the same profile_incomplete; at most 20 NEW requests per link: the 21st new person gets
 *   invite_invalid (in peek too), somebody who already waits / follows asks again for free, the owner sees the full
 *   link as `self`; a requester's limit_reached does not take a place.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES, createMember, expectRpcError, rpc } from '../pilot/seed'
import { followLink, followRows, rpcText, UNKNOWN_TOKEN } from './seed'
import { checkInvariants } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface Peek {
  profile: { id: string; display_name: string | null; banner: string | null }
  relation: { self: boolean; i_follow: string }
}

const HEX64 = /^[0-9a-f]{64}$/

function linkRow(token: string) {
  return rows<{ use_count: number; revoked: boolean; live: boolean }>(
    t.db,
    `select use_count, revoked_at is not null as revoked, (revoked_at is null and expires_at > now()) as live
       from follow_links where token_hash = sha256(convert_to($1::text, 'UTF8'))`,
    [token],
  ).then((r) => r[0] ?? null)
}

function garbageTokens(token: string): (string | null)[] {
  return ['', '0'.repeat(63), '0'.repeat(65), token.toUpperCase(), ` ${token}`, `${token}\n`, `${token}'`, `'; delete from follow_links; --`, 'x'.repeat(64), token.slice(0, 63) + 'g', null]
}

describe('creating links', () => {
  it('a 64-hex code, valid 30 days, shown once: only its sha256 is stored — in no table, no answer of the owner', async () => {
    const paula = await createMember(t, 'Paula')
    const answer = await rpc<{ token: string; expires_at: string }>(t, paula, 'create_follow_link')
    expect(Object.keys(answer).sort()).toEqual(['expires_at', 'token'])
    expect(answer.token).toMatch(HEX64)
    const days = await scalar<number>(t.db, `select (extract(epoch from ($1::timestamptz - now())) / 86400)::float8`, [answer.expires_at])
    expect(days).toBeGreaterThan(29.99)
    expect(days).toBeLessThanOrEqual(30)
    for (const table of [...ALL_TABLES.map((x) => `public.${x}`), 'auth.users']) {
      for (const r of await rows<{ j: string }>(t.db, `select to_jsonb(x)::text as j from ${table} x`)) expect(r.j, table).not.toContain(answer.token)
    }
    const hashHex = await scalar<string>(t.db, `select encode(sha256(convert_to($1::text, 'UTF8')), 'hex')`, [answer.token])
    expect(await scalar<number>(t.db, `select count(*)::int from follow_links where encode(token_hash, 'hex') = $1`, [hashHex])).toBe(1)
    for (const fn of ['export_my_data', 'get_people_screen', 'get_lists_overview', 'get_me']) {
      const text = await rpcText(t, paula, fn)
      expect(text, fn).not.toContain(answer.token)
      expect(text, fn).not.toContain(hashHex)
    }
    // two links never share a code
    expect((await rpc<{ token: string }>(t, paula, 'create_follow_link')).token).not.toBe(answer.token)
  })

  it('at most 5 live links: the 6th switches off the OLDEST live one; the rest keep working; live_links counts them', async () => {
    const paula = await createMember(t, 'Paula')
    const finn = await createMember(t, 'Finn')
    const tokens: string[] = []
    for (let i = 0; i < 6; i++) tokens.push(await followLink(t, paula))
    expect(await scalar<number>(t.db, `select count(*)::int from follow_links where owner_id = $1 and revoked_at is null`, [paula])).toBe(5)
    expect(await linkRow(tokens[0]!)).toMatchObject({ revoked: true })
    for (const tok of tokens.slice(1)) expect(await linkRow(tok)).toMatchObject({ live: true })
    await expectRpcError(rpc(t, finn, 'peek_follow_link', [tokens[0]]), 'invite_invalid')
    await expectRpcError(rpc(t, finn, 'request_follow_via_link', [tokens[0]]), 'invite_invalid')
    expect((await rpc<Peek>(t, finn, 'peek_follow_link', [tokens[1]])).profile.id).toBe(paula)
    expect((await rpc<{ me: { live_links: number } }>(t, paula, 'get_lists_overview')).me.live_links).toBe(5)
    expect((await rpc<{ links: unknown[] }>(t, paula, 'get_people_screen')).links).toHaveLength(5)
    // a 7th: still 5 live, the oldest live one (tokens[1]) goes
    tokens.push(await followLink(t, paula))
    expect(await linkRow(tokens[1]!)).toMatchObject({ revoked: true })
    expect(await scalar<number>(t.db, `select count(*)::int from follow_links where owner_id = $1 and revoked_at is null and expires_at > now()`, [paula])).toBe(5)
  })

  it('revoke_follow_links switches every live link off at once (no consents needed); afterwards a new one works', async () => {
    const paula = await createMember(t, 'Paula')
    const finn = await createMember(t, 'Finn')
    const a = await followLink(t, paula)
    const b = await followLink(t, paula)
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [paula]))
    expect(await rpc(t, paula, 'revoke_follow_links')).toEqual({ ok: true })
    for (const tok of [a, b]) {
      await expectRpcError(rpc(t, finn, 'peek_follow_link', [tok]), 'invite_invalid')
      await expectRpcError(rpc(t, finn, 'request_follow_via_link', [tok]), 'invite_invalid')
    }
    expect((await rpc<{ me: { live_links: number } }>(t, paula, 'get_lists_overview')).me.live_links).toBe(0)
    await t.asUser(paula, (tx) => tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [paula]))
    const c = await followLink(t, paula)
    expect(await rpc(t, finn, 'request_follow_via_link', [c])).toEqual({ status: 'requested', profile_id: paula })
  })
})

describe('peek_follow_link', () => {
  it('shows name + banner + my relation; writes nothing, counts nothing', async () => {
    const paula = await createMember(t, 'Paula')
    await t.asUser(paula, (tx) => tx.query(`update profiles set banner = 'bunnies' where id = $1`, [paula]))
    const xaver = await createMember(t, 'Xaver')
    const token = await followLink(t, paula)
    const tables = () => rows(t.db, `select (select coalesce(jsonb_agg(to_jsonb(f) order by f.follower_id, f.followee_id), '[]') from follows f)::text as f,
                                            (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') from follow_links l)::text as l`)
    const before = await tables()
    const peek = await rpc<Peek>(t, xaver, 'peek_follow_link', [token])
    expect(peek).toEqual({ profile: { id: paula, display_name: 'Paula', banner: 'bunnies', photo: null, banner_photo: null }, relation: { self: false, i_follow: 'none' } })
    await rpc(t, xaver, 'peek_follow_link', [token])
    expect(await tables()).toEqual(before)
    // the own link: self (the owner sees their link as it is, also when it is full — see below)
    expect(await rpc<Peek>(t, paula, 'peek_follow_link', [token])).toEqual({
      profile: { id: paula, display_name: 'Paula', banner: 'bunnies', photo: null, banner_photo: null },
      relation: { self: true, i_follow: 'none' },
    })
    // after asking: requested; after the owner accepts: following
    expect(await rpc(t, xaver, 'request_follow_via_link', [token])).toEqual({ status: 'requested', profile_id: paula })
    expect((await rpc<Peek>(t, xaver, 'peek_follow_link', [token])).relation).toEqual({ self: false, i_follow: 'requested' })
    await rpc(t, paula, 'respond_follow', [xaver, true])
    expect((await rpc<Peek>(t, xaver, 'peek_follow_link', [token])).relation).toEqual({ self: false, i_follow: 'following' })
    expect(await rpc(t, xaver, 'request_follow_via_link', [token])).toEqual({ status: 'following', profile_id: paula })
    expect((await linkRow(token))!.use_count).toBe(1)
  })
})

describe('one code for every failure: invite_invalid', () => {
  it('own link (request), expired, revoked, blocked in either direction, garbage', async () => {
    const paula = await createMember(t, 'Paula')
    const finn = await createMember(t, 'Finn')
    const bea = await createMember(t, 'Bea')
    const token = await followLink(t, paula)
    await expectRpcError(rpc(t, paula, 'request_follow_via_link', [token]), 'invite_invalid')
    for (const tok of garbageTokens(token)) {
      await expectRpcError(rpc(t, finn, 'peek_follow_link', [tok]), 'invite_invalid')
      await expectRpcError(rpc(t, finn, 'request_follow_via_link', [tok]), 'invite_invalid')
    }
    await expectRpcError(rpc(t, finn, 'peek_follow_link', [UNKNOWN_TOKEN]), 'invite_invalid')
    await expectRpcError(rpc(t, finn, 'request_follow_via_link', [UNKNOWN_TOKEN]), 'invite_invalid')
    // a block, in both directions: the link is dead for the pair (and stays alive for everybody else)
    await rpc(t, paula, 'block_user', [finn])
    await rpc(t, bea, 'block_user', [paula])
    for (const who of [finn, bea]) {
      await expectRpcError(rpc(t, who, 'peek_follow_link', [token]), 'invite_invalid')
      await expectRpcError(rpc(t, who, 'request_follow_via_link', [token]), 'invite_invalid')
    }
    // expiry
    const xaver = await createMember(t, 'Xaver')
    expect((await rpc<Peek>(t, xaver, 'peek_follow_link', [token])).profile.id).toBe(paula)
    await t.asService((tx) =>
      tx.query(`update follow_links set created_at = now() - interval '31 days', expires_at = now() - interval '1 minute' where token_hash = sha256(convert_to($1::text, 'UTF8'))`, [token]),
    )
    await expectRpcError(rpc(t, xaver, 'peek_follow_link', [token]), 'invite_invalid')
    await expectRpcError(rpc(t, xaver, 'request_follow_via_link', [token]), 'invite_invalid')
    expect(await followRows(t, 'followee_id = $1', [paula])).toEqual([])
    await checkInvariants(t)
  })
})

describe('the gates come FIRST (review #8): an account without them learns nothing about a code', () => {
  it('no current consents: consent_required for garbage, unknown, revoked and live codes — in peek and in request', async () => {
    const paula = await createMember(t, 'Paula')
    const live = await followLink(t, paula)
    const revoked = await followLink(t, paula)
    await t.asService((tx) => tx.query(`update follow_links set revoked_at = now() where token_hash = sha256(convert_to($1::text, 'UTF8'))`, [revoked]))
    const noConsent = await createMember(t, 'Rosa', { consents: false })
    const noName = await t.createUser('noname-follow@example.test', {})
    await t.asUser(noName, (tx) => tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [noName]))
    for (const tok of ['nope', null, UNKNOWN_TOKEN, revoked, live]) {
      for (const fn of ['peek_follow_link', 'request_follow_via_link']) {
        await expectRpcError(rpc(t, noConsent, fn, [tok]), 'consent_required')
        await expectRpcError(rpc(t, noName, fn, [tok]), 'profile_incomplete')
      }
    }
    expect((await linkRow(live))!.use_count).toBe(0)
    expect(await followRows(t, 'followee_id = $1', [paula])).toEqual([])
  })
})

describe('at most 20 NEW requests per link', () => {
  it('the 21st new person gets invite_invalid (peek too); waiting / following people ask again for free; the owner sees self', async () => {
    const paula = await createMember(t, 'Paula')
    const token = await followLink(t, paula)
    const people: string[] = []
    for (let i = 1; i <= 20; i++) {
      const u = await createMember(t, `Gast${i}`)
      people.push(u)
      expect(await rpc(t, u, 'request_follow_via_link', [token])).toEqual({ status: 'requested', profile_id: paula })
    }
    expect(await linkRow(token)).toMatchObject({ use_count: 20, live: true })
    const late = await createMember(t, 'Spät')
    await expectRpcError(rpc(t, late, 'peek_follow_link', [token]), 'invite_invalid')
    await expectRpcError(rpc(t, late, 'request_follow_via_link', [token]), 'invite_invalid')
    // somebody who already waits: sees the link and asks again without a new place
    expect((await rpc<Peek>(t, people[0]!, 'peek_follow_link', [token])).relation.i_follow).toBe('requested')
    expect(await rpc(t, people[0]!, 'request_follow_via_link', [token])).toEqual({ status: 'requested', profile_id: paula })
    // an accepted follower too
    await rpc(t, paula, 'respond_follow', [people[1], true])
    expect(await rpc(t, people[1]!, 'request_follow_via_link', [token])).toEqual({ status: 'following', profile_id: paula })
    expect((await rpc<Peek>(t, paula, 'peek_follow_link', [token])).relation).toEqual({ self: true, i_follow: 'none' })
    expect(await linkRow(token)).toMatchObject({ use_count: 20 })
    // a new link of the same owner works for the late one (the brake is per link)
    const fresh = await followLink(t, paula)
    expect(await rpc(t, late, 'request_follow_via_link', [fresh])).toEqual({ status: 'requested', profile_id: paula })
  })

  it('limit_reached of the requester (30 open requests) takes no place on the link; withdrawing one frees the requester', async () => {
    const rosa = await createMember(t, 'Rosa')
    for (let i = 1; i <= 30; i++) {
      const owner = await createMember(t, `Ziel${i}`)
      expect(await rpc(t, rosa, 'request_follow_via_link', [await followLink(t, owner)])).toMatchObject({ status: 'requested' })
    }
    const paula = await createMember(t, 'Paula')
    const token = await followLink(t, paula)
    await expectRpcError(rpc(t, rosa, 'request_follow_via_link', [token]), 'limit_reached')
    expect(await linkRow(token)).toMatchObject({ use_count: 0 })
    expect(await followRows(t, 'followee_id = $1', [paula])).toEqual([])
    // peek is not limited (it writes nothing)
    expect((await rpc<Peek>(t, rosa, 'peek_follow_link', [token])).profile.id).toBe(paula)
    const someone = await scalar<string>(t.db, `select followee_id from follows where follower_id = $1 order by requested_at limit 1`, [rosa])
    expect(await rpc(t, rosa, 'unfollow', [someone])).toEqual({ ok: true })
    expect(await rpc(t, rosa, 'request_follow_via_link', [token])).toEqual({ status: 'requested', profile_id: paula })
    expect(await linkRow(token)).toMatchObject({ use_count: 1 })
  })
})
