/**
 * F14 — gates and limits (follows-design §5.1, P5, P10, L9): asking (request_follow, request_follow_via_link),
 * accepting, links (create, peek) need the current legal records -> consent_required, and a display name ->
 * profile_incomplete; the 31st open request -> limit_reached (only the requester's own limit). "Narrowing" actions
 * work WITHOUT current records: unfollow / withdraw, refuse, remove a follower, block / unblock, revoke links, delete
 * an own list, the export — and every screen keeps reading.
 * "After the version bump of M5": M5 (new legal texts) is NOT part of this wave (follows-design §00 item 8), so the
 * bump is simulated the way M5 would do it — a new version in legal_versions (round1-privilege does the same) — and
 * restored afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../src/harness'
import { createMember, execAs, expectRpcError, giveConsents, rpc } from '../pilot/seed'
import { followLink, followRows, seedFollows, type FollowSeed } from './seed'
import { checkInvariants } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe('consents and name first', () => {
  it('no current legal records: consent_required for asking, accepting and links; no name: profile_incomplete', async () => {
    const s = await seedFollows(t)
    const noConsent = await createMember(t, 'Ida', { consents: false })
    await rpc(t, noConsent, 'accept_invite', [s.o2Invite]).catch(() => undefined) // cannot join without consents either
    for (const [fn, args] of [
      ['request_follow', [s.paula]],
      ['request_follow_via_link', [s.token]],
      ['peek_follow_link', [s.token]],
      ['create_follow_link', []],
    ] as const) {
      await expectRpcError(rpc(t, noConsent, fn, args), 'consent_required')
    }
    const noName = await t.createUser('noname-gates@example.test', {})
    await giveConsents(t, noName)
    for (const [fn, args] of [
      ['request_follow', [s.paula]],
      ['request_follow_via_link', [s.token]],
      ['peek_follow_link', [s.token]],
      ['create_follow_link', []],
    ] as const) {
      await expectRpcError(rpc(t, noName, fn, args), 'profile_incomplete')
    }
    // accepting needs the records of the one who accepts; refusing does not
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'age_18plus'`, [s.paula]))
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, true]), 'consent_required')
    expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, false])).toEqual({ ok: true })
    expect(await followRows(t, 'follower_id in ($1, $2)', [noConsent, noName])).toEqual([])
  })
})

describe('30 open requests at most', () => {
  it('the 31st open request is limit_reached (also through a shared occasion); withdrawing one frees a place', async () => {
    const asker = await createMember(t, 'Jonas')
    for (let i = 1; i <= 30; i++) {
      const owner = await createMember(t, `Person${i}`)
      expect(await rpc(t, asker, 'request_follow_via_link', [await followLink(t, owner)])).toMatchObject({ status: 'requested' })
    }
    // the 31st: somebody Jonas shares an occasion with
    const host = await createMember(t, 'Kim')
    const occasionId = await t.asUser(host, async (tx) =>
      (await tx.query<{ id: string }>(`insert into occasions (host_id, title, starts_at) values ($1, 'Kims Fest', now() + interval '9 days') returning id`, [host])).rows[0]!.id,
    )
    await rpc(t, asker, 'accept_invite', [(await rpc<{ token: string }>(t, host, 'create_invite', [occasionId])).token])
    await expectRpcError(rpc(t, asker, 'request_follow', [host]), 'limit_reached')
    expect(await followRows(t, 'follower_id = $1 and followee_id = $2', [asker, host])).toEqual([])
    // answered (accepted) or expired requests are not open: accepting one frees a place
    const first = (await followRows(t, 'follower_id = $1', [asker]))[0]!.followee_id
    await rpc(t, first, 'respond_follow', [asker, true])
    expect(await rpc(t, asker, 'request_follow', [host])).toEqual({ status: 'requested' })
    await expectRpcError(rpc(t, asker, 'request_follow_via_link', [await followLink(t, await createMember(t, 'Lea'))]), 'limit_reached')
    // the limit counts only the requester's own rows: the people asked are not limited in being asked
    await checkInvariants(t)
  })
})

describe('narrowing needs no current legal records (L9, follows-design §5.1)', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
  })

  it('after a version bump (what M5 would do): asking is refused, every narrowing action and every screen still works', async () => {
    await t.asService((tx) => tx.query(`update legal_versions set version = 'terms-2099-01-test' where kind = 'terms'`))
    try {
      expect((await rpc<{ consents_ok: boolean }>(t, s.paula, 'get_me')).consents_ok).toBe(false)
      await expectRpcError(rpc(t, s.xaver, 'request_follow_via_link', [s.token]), 'consent_required')
      await expectRpcError(rpc(t, s.paula, 'create_follow_link'), 'consent_required')
      await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, true]), 'consent_required')
      // screens keep reading
      for (const fn of ['get_lists_overview', 'get_people_screen', 'get_me', 'export_my_data']) await rpc(t, s.paula, fn)
      await rpc(t, s.finn, 'get_profile_card', [s.paula])
      await rpc(t, s.paula, 'get_list_screen', [s.l1])
      // narrowing
      expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, false])).toEqual({ ok: true }) // refuse
      expect(await rpc(t, s.paula, 'remove_follower', [s.greta])).toEqual({ ok: true })
      expect(await rpc(t, s.finn, 'unfollow', [s.paula])).toEqual({ ok: true })
      expect(await rpc(t, s.rosa, 'unfollow', [s.paula])).toEqual({ ok: true }) // withdraw
      expect(await rpc(t, s.paula, 'block_user', [s.moritz])).toEqual({ ok: true })
      expect(await rpc(t, s.paula, 'unblock_user', [s.moritz])).toEqual({ ok: true })
      expect(await rpc(t, s.paula, 'revoke_follow_links')).toEqual({ ok: true })
      expect(await execAs(t, s.paula, 'delete from wishlists where id = $1', [s.l2])).toBe(1)
      expect(await followRows(t, 'followee_id = $1', [s.paula])).toEqual([])
      await checkInvariants(t)
    } finally {
      await t.asService((tx) => tx.query(`update legal_versions set version = 'terms-2026-10-pilot-5' where kind = 'terms'`))
    }
  })
})
