/**
 * ATTACK ROUND 1 — privilege escalation and gate bypass.
 * Member / outsider writes on every table, host touching other people's rows, direct inserts into invite-only
 * tables, consent/display_name bypass, the "removed guest comes back with the old link" hole, and what co-members
 * can read from each other's profile row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { NAMES, countAll, countAs, createMember, execAs, expectRpcError, giveConsents, queryAs, rpc, screen, seedPilot, type Seed } from '../pilot/seed'

let t: TestDb
let s: Seed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedPilot(t)
})
afterAll(() => t.close())

describe('member and outsider cannot write what is not theirs', () => {
  it('occasions: member/outsider update or delete the host\'s occasion → 0 rows, nothing changes', async () => {
    for (const uid of [s.b, s.d]) {
      expect(await execAs(t, uid, `update occasions set title = 'pwned' where id = $1`, [s.occasionId])).toBe(0)
      expect(await execAs(t, uid, `update occasions set cancelled_at = now() where id = $1`, [s.occasionId])).toBe(0)
      expect(await execAs(t, uid, `update occasions set starts_at = now() + interval '1 year'`)).toBe(0)
      expect(await execAs(t, uid, `delete from occasions where id = $1`, [s.occasionId])).toBe(0)
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update occasions set host_id = $1 where id = $2`, [uid, s.occasionId])), '42501')
    }
    expect(await rows(t.db, 'select title, cancelled_at from occasions where id = $1', [s.occasionId])).toEqual([{ title: 'Geburtstag Anna', cancelled_at: null }])
  })

  it('wishlists / wishes: member/outsider cannot rename, delete, insert, or move anything', async () => {
    for (const uid of [s.b, s.d]) {
      expect(await execAs(t, uid, `update wishlists set title = 'x' where id = $1`, [s.wishlistId])).toBe(0)
      expect(await execAs(t, uid, `delete from wishlists where id = $1`, [s.wishlistId])).toBe(0)
      expect(await execAs(t, uid, `update wishes set title = 'x', priority = 3, price_cents = 1 where wishlist_id = $1`, [s.wishlistId])).toBe(0)
      expect(await execAs(t, uid, `delete from wishes where wishlist_id = $1`, [s.wishlistId])).toBe(0)
      await expectDbError(t.asUser(uid, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'mine')`, [s.wishlistId])), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`insert into wishlists (occasion_id, owner_id, recipient_id) values ($1, $2, $2)`, [s.occasionId, uid])), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update wishes set wishlist_id = $1`, [s.wishlistId])), '42501')
    }
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(3)
    expect(await countAll(t, 'wishlists', 'occasion_id = $1', [s.occasionId])).toBe(1)
  })

  it('occasion_members: nobody inserts or deletes rows or changes role/status through REST, not even the host', async () => {
    const newcomer = await createMember(t, 'Nora')
    for (const uid of [s.a, s.b, s.d]) {
      await expectDbError(t.asUser(uid, (tx) => tx.query(`insert into occasion_members (occasion_id, profile_id) values ($1, $2)`, [s.occasionId, newcomer])), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`delete from occasion_members where occasion_id = $1`, [s.occasionId])), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update occasion_members set role = 'host' where occasion_id = $1 and profile_id = $2`, [s.occasionId, uid])), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update occasion_members set status = 'removed' where occasion_id = $1`, [s.occasionId])), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update occasion_members set invited_via = null where occasion_id = $1`, [s.occasionId])), '42501')
    }
    // the host cannot set another member's RSVP; the member cannot set the host's
    expect(await execAs(t, s.a, `update occasion_members set rsvp = 'declined' where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.b])).toBe(0)
    expect(await execAs(t, s.b, `update occasion_members set rsvp = 'declined' where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.a])).toBe(0)
    expect(await rows(t.db, `select profile_id, rsvp, role, status from occasion_members where occasion_id = $1 order by joined_at`, [s.occasionId])).toEqual([
      { profile_id: s.a, rsvp: 'going', role: 'host', status: 'active' },
      { profile_id: s.b, rsvp: 'none', role: 'member', status: 'active' },
      { profile_id: s.c, rsvp: 'none', role: 'member', status: 'active' },
    ])
  })

  it('invites: no REST insert for anyone (even the host); member cannot read, revoke or delete', async () => {
    for (const uid of [s.a, s.b, s.d]) {
      await expectDbError(
        t.asUser(uid, (tx) => tx.query(`insert into invites (occasion_id, created_by, token_hash, expires_at) values ($1, $2, sha256('x'::bytea), now() + interval '1 day')`, [s.occasionId, uid])),
        '42501',
      )
    }
    for (const uid of [s.b, s.d]) {
      expect(await countAs(t, uid, 'invites')).toBe(0)
      expect(await execAs(t, uid, `update invites set revoked_at = now()`)).toBe(0)
      expect(await execAs(t, uid, `delete from invites`)).toBe(0)
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update invites set expires_at = now() + interval '10 years'`)), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update invites set max_uses = 100`)), '42501')
    }
    // the host cannot stretch an invite either: only revoked_at is grantable
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update invites set expires_at = now() + interval '10 years' where occasion_id = $1`, [s.occasionId])), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update invites set use_count = 0 where occasion_id = $1`, [s.occasionId])), '42501')
    expect(await countAll(t, 'invites', 'occasion_id = $1 and revoked_at is null', [s.occasionId])).toBe(1)
  })

  it('blocks / reports / legal_versions / consents / profiles: no direct writes beyond the contract', async () => {
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [s.b, s.a])), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`delete from blocks`)), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`update blocks set blocked_id = $1`, [s.c])), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'wish', $2, 'spam')`, [s.a, s.w1])), '42501')
    expect(await execAs(t, s.b, `insert into reports (reporter_id, target_kind, target_id, reason) values ($1, 'wish', $2, 'spam')`, [s.b, s.w1])).toBe(1)
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`update reports set outcome = 'closed'`)), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`update reports set handled_at = now()`)), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`delete from reports`)), '42501')
    expect(await countAs(t, s.a, 'reports')).toBe(0) // the reported host sees no report
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`delete from legal_versions`)), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into legal_versions (kind, version) values ('terms', 'x')`)), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update profiles set id = $1 where id = $2`, [s.b, s.a])), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`delete from profiles`)), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into profiles (id, display_name) values ($1, 'ghost')`, ['11111111-1111-4111-8111-111111111111'])), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`update occasion_addresses set occasion_id = $1`, [s.occasionId])), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`insert into occasion_addresses (occasion_id, address) values ($1, 'x')`, [s.occasionId])), '42501')
  })

  it('cross-occasion visibility: members of different occasions see nothing of each other', async () => {
    const other = await seedPilot(t)
    // B (A's occasion) vs other.b (another host's occasion)
    expect(await countAs(t, s.b, 'profiles', 'id = $1', [other.b])).toBe(0)
    expect(await countAs(t, s.b, 'occasions', 'id = $1', [other.occasionId])).toBe(0)
    expect(await countAs(t, s.b, 'occasion_members', 'occasion_id = $1', [other.occasionId])).toBe(0)
    expect(await countAs(t, s.b, 'wishes', 'wishlist_id = $1', [other.wishlistId])).toBe(0)
    await expectRpcError(screen(t, s.b, other.occasionId), 'not_found')
    await expectRpcError(rpc(t, s.b, 'reserve_wish', [other.w1]), 'not_allowed')
    await expectRpcError(rpc(t, s.b, 'cancel_reservation', [other.w1]), 'not_allowed')
    await expectRpcError(rpc(t, s.b, 'leave_occasion', [other.occasionId]), 'not_found')
    // a host of one occasion is a plain outsider on another host's occasion
    await expectRpcError(rpc(t, s.a, 'create_invite', [other.occasionId]), 'not_found')
    await expectRpcError(rpc(t, s.a, 'remove_member', [other.occasionId, other.b]), 'not_found')
    expect(await execAs(t, s.a, `update wishes set title = 'x' where id = $1`, [other.w1])).toBe(0)
    expect(await execAs(t, s.a, `delete from occasions where id = $1`, [other.occasionId])).toBe(0)
  })
})

describe('gates: consents and display_name', () => {
  it('no way around profile_complete / has_consents for occasions, lists, wishes and invites', async () => {
    const u = await createMember(t, 'Oskar', { consents: false })
    await expectDbError(t.asUser(u, (tx) => tx.query(`insert into occasions (host_id, title, starts_at) values ($1, 'x', now())`, [u])), '42501')
    await expectRpcError(rpc(t, u, 'accept_invite', [s.token]), 'consent_required')
    await expectRpcError(rpc(t, u, 'reserve_wish', [s.w1]), 'consent_required')
    await giveConsents(t, u)
    // consents but a whitespace-only / control-char name is no name
    await expectDbError(t.asUser(u, (tx) => tx.query(`update profiles set display_name = '   ' where id = $1`, [u])), '23514')
    await expectDbError(t.asUser(u, (tx) => tx.query(`update profiles set display_name = E'a\\tb' where id = $1`, [u])), '23514')
    await expectDbError(t.asUser(u, (tx) => tx.query(`update profiles set display_name = repeat('a', 41) where id = $1`, [u])), '23514')
    // Oskar has a name from the metadata, so joining works; a member without a wishlist of their own cannot add wishes anywhere
    expect(await rpc(t, u, 'accept_invite', [s.token])).toEqual({ occasion_id: s.occasionId })
    await expectDbError(t.asUser(u, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'x')`, [s.wishlistId])), '42501')
    await expectDbError(t.asUser(u, (tx) => tx.query(`insert into wishlists (occasion_id, owner_id, recipient_id) values ($1, $2, $2)`, [s.occasionId, u])), '42501')
    // after a legal text bump nobody can create or reserve until re-consent, but reading continues
    await t.asService((tx) => tx.query(`update legal_versions set version = 'terms-2099-01-test' where kind = 'terms'`))
    try {
      await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'x')`, [s.wishlistId])), '42501')
      await expectRpcError(rpc(t, s.c, 'reserve_wish', [s.w3]), 'consent_required')
      await expectRpcError(rpc(t, s.a, 'create_invite', [s.occasionId]), 'consent_required')
      expect((await rpc<{ consents_ok: boolean }>(t, s.a, 'get_me')).consents_ok).toBe(false)
      expect((await screen(t, s.c, s.occasionId)).wishlist!.wishes).toHaveLength(3)
      // the old consent version cannot be (re-)inserted: the policy only accepts the current version (42501 before the PK could even conflict)
      await expectDbError(
        t.asUser(s.a, (tx) => tx.query(`insert into consents (profile_id, kind, version, locale) values ($1, 'terms', 'terms-2026-10-pilot-1', 'de')`, [s.a])),
        '42501',
      )
      await expectDbError(
        t.asUser(s.b, (tx) => tx.query(`insert into consents (profile_id, kind, version, locale) values ($1, 'terms', 'terms-2026-10-pilot-1', 'de')`, [s.b])),
        '42501',
      )
    } finally {
      await t.asService((tx) => tx.query(`update legal_versions set version = 'terms-2026-10-pilot-5' where kind = 'terms'`))
    }
  })

  it('[F-3] consent proof: accepted_at is set by the database, the client cannot backdate or postdate it', async () => {
    const u = await createMember(t, 'Lotte', { consents: false })
    await expectDbError(
      t.asUser(u, (tx) =>
        tx.query(`insert into consents (profile_id, kind, version, locale, accepted_at) select $1, kind, version, 'de', '2000-01-01' from legal_versions`, [u]),
      ),
      '42501',
    )
    expect(await countAll(t, 'consents', 'profile_id = $1', [u])).toBe(0)
  })
})

describe('membership lifecycle holes', () => {
  it('[F-1] a removed guest cannot re-enter with the link that was valid when they were removed; a NEW link lets them back', async () => {
    const s2 = await seedPilot(t)
    await rpc(t, s2.b, 'reserve_wish', [s2.w1])
    expect(await rpc(t, s2.a, 'remove_member', [s2.occasionId, s2.b])).toEqual({ ok: true })
    // the old link is what B still has in their chat history
    await expectRpcError(rpc(t, s2.b, 'accept_invite', [s2.token]), 'invite_invalid')
    await expectRpcError(screen(t, s2.b, s2.occasionId), 'not_found')
    expect(await scalar<string>(t.db, 'select status from occasion_members where occasion_id = $1 and profile_id = $2', [s2.occasionId, s2.b])).toBe('removed')
    // the host decides to invite again → new link → welcome back
    const { token } = await rpc<{ token: string }>(t, s2.a, 'create_invite', [s2.occasionId])
    expect(await rpc(t, s2.b, 'accept_invite', [token])).toEqual({ occasion_id: s2.occasionId })
    expect((await screen(t, s2.b, s2.occasionId)).viewer).toEqual({ role: 'member', rsvp: 'none' })
  })

  it('a guest who left on their own may come back with the same link (contract: left — тоже)', async () => {
    const s3 = await seedPilot(t)
    expect(await rpc(t, s3.c, 'leave_occasion', [s3.occasionId])).toEqual({ ok: true })
    expect(await rpc(t, s3.c, 'accept_invite', [s3.token])).toEqual({ occasion_id: s3.occasionId })
    expect((await screen(t, s3.c, s3.occasionId)).viewer.role).toBe('member')
  })

  it('a member cannot promote themselves, invite others, or remove the host', async () => {
    const s4 = await seedPilot(t)
    await expectRpcError(rpc(t, s4.b, 'remove_member', [s4.occasionId, s4.a]), 'not_found')
    await expectRpcError(rpc(t, s4.b, 'remove_member', [s4.occasionId, s4.c]), 'not_found')
    await expectRpcError(rpc(t, s4.b, 'create_invite', [s4.occasionId]), 'not_found')
    await expectDbError(t.asUser(s4.b, (tx) => tx.query(`update occasion_members set role = 'host' where profile_id = $1`, [s4.b])), '42501')
    expect(await rows(t.db, `select profile_id from occasion_members where occasion_id = $1 and role = 'host'`, [s4.occasionId])).toEqual([{ profile_id: s4.a }])
    expect(await countAll(t, 'occasion_members', `occasion_id = $1 and status = 'active'`, [s4.occasionId])).toBe(3)
  })
})

describe('what co-members learn about each other', () => {
  it('[F-2] a co-member reads only id + display_name of another person: onboarding_done_at / locale / timestamps are private', async () => {
    await t.asUser(s.a, (tx) => tx.query(`update profiles set onboarding_done_at = now(), locale = 'en' where id = $1`, [s.a]))
    expect(await queryAs(t, s.b, 'select id, display_name from profiles where id = $1', [s.a])).toEqual([{ id: s.a, display_name: NAMES.a }])
    for (const col of ['onboarding_done_at', 'locale', 'created_at', 'updated_at']) {
      const err = await expectDbError(t.asUser(s.b, (tx) => rows(tx, `select ${col} from profiles where id = $1`, [s.a])), '42501')
      expect(err.message, col).toMatch(/permission denied/)
    }
    // the person themself still gets their own fields through get_me()
    expect((await rpc<{ profile: { locale: string; onboarding_done_at: string | null } }>(t, s.a, 'get_me')).profile).toMatchObject({ locale: 'en' })
    await t.asUser(s.a, (tx) => tx.query(`update profiles set onboarding_done_at = null, locale = 'de' where id = $1`, [s.a]))
  })
})
