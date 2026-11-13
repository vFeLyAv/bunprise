/**
 * F15 — deleting an account (follows-design §8.3, A4, pilot delete_my_account unchanged): the cascades from profiles
 * take follows (both directions), silences (both sides), follow links, standalone lists and their wishes along;
 * the reservations as in the pilot. Afterwards the id is in no row of any table in public, and an old JWT gets
 * not_allowed from every new RPC (require_user checks that the profile exists).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES, countAll, expectRpcError, rpc } from '../pilot/seed'
import { UNKNOWN_TOKEN, followLink, seedFollows } from './seed'
import { checkInvariants, runCleanupPass } from './invariants'

// Since 20261027200000 (shared wishes, design §3.2 / Q21 default): delete_my_account never touches reservations. The
// rows where the person gives or receives are hidden from every answer at once ("orphans") and the background cleanup
// erases them; only then is the id in no row at all (public AND the internal tables of private).

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

async function rowsMentioning(id: string): Promise<string[]> {
  const hits: string[] = []
  for (const table of [...ALL_TABLES.map((x) => `public.${x}`), 'auth.users', 'private.wish_placements', 'private.occasion_prompts']) {
    const n = await scalar<number>(t.db, `select count(*)::int from ${table} x where to_jsonb(x)::text like '%' || $1 || '%'`, [id])
    if (n > 0) hits.push(`${table}: ${n}`)
  }
  return hits
}

const NEW_RPCS: [string, (id: string) => unknown[]][] = [
  ['get_list_screen', (id) => [id]],
  ['get_lists_overview', () => []],
  ['get_profile_card', (id) => [id]],
  ['get_people_screen', () => []],
  ['peek_follow_link', () => [UNKNOWN_TOKEN]],
  ['request_follow', (id) => [id]],
  ['request_follow_via_link', () => [UNKNOWN_TOKEN]],
  ['respond_follow', (id) => [id, true]],
  ['unfollow', (id) => [id]],
  ['remove_follower', (id) => [id]],
  ['create_follow_link', () => []],
  ['revoke_follow_links', () => []],
]

describe('delete_my_account with follows', () => {
  it('a follower (Finn) is deleted: his follows, silences, links and reservations are gone; Paula\'s data stays', async () => {
    const s = await seedFollows(t)
    await followLink(t, s.finn)
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite])
    await rpc(t, s.finn, 'reserve_wish', [s.o1Wish])
    await rpc(t, s.paula, 'respond_follow', [s.rosa, false]) // a silence Paula -> Rosa (unrelated, must stay)
    await t.asService((tx) =>
      tx.query(`insert into follow_cooldowns (followee_id, follower_id, until) values ($1, $2, now() + interval '10 days'), ($2, $3, now() + interval '10 days')`, [
        s.finn,
        s.greta,
        s.paula,
      ]),
    ) // Finn hid Greta; Paula hid Finn
    expect(await rpc(t, s.finn, 'delete_my_account')).toEqual({ ok: true })
    expect(await rowsMentioning(s.finn)).toEqual(['public.reservations: 1']) // an orphan, hidden everywhere
    expect(await rpc(t, s.moritz, 'my_reservations')).toEqual([])
    await runCleanupPass(t)
    expect(await rowsMentioning(s.finn)).toEqual([])
    expect(await countAll(t, 'follows', 'followee_id = $1', [s.paula])).toBe(2) // Greta, Rosa
    expect(await countAll(t, 'follow_cooldowns', 'followee_id = $1 and follower_id = $2', [s.paula, s.rosa])).toBe(1)
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.o1List])).toBe(1)
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true }) // the wish is free again
    for (const [fn, args] of NEW_RPCS) await expectRpcError(rpc(t, s.finn, fn, args(s.paula)), 'not_allowed')
    await checkInvariants(t)
  })

  it('the owner (Paula) is deleted: lists, wishes, follows, links, silences and the reservations on her wishes are gone', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.paula, 'respond_follow', [s.rosa, false])
    await rpc(t, s.moritz, 'reserve_wish', [s.o1Wish])
    const ids = [s.l1, s.l2, s.o1List, ...s.l1Wishes, s.l2Wish, s.o1Wish, s.o1]
    expect(await rpc(t, s.paula, 'delete_my_account')).toEqual({ ok: true })
    expect(await rowsMentioning(s.paula)).toEqual(['public.reservations: 1']) // Moritz's row: an orphan
    expect(await rpc(t, s.moritz, 'my_reservations')).toEqual([]) // hidden at once
    await runCleanupPass(t)
    expect(await rowsMentioning(s.paula)).toEqual([])
    for (const id of ids) expect(await rowsMentioning(id), id).toEqual([])
    expect(await countAll(t, 'follows', 'follower_id = $1 or followee_id = $1', [s.paula])).toBe(0)
    expect(await countAll(t, 'follow_links', 'owner_id = $1', [s.paula])).toBe(0)
    expect(await countAll(t, 'follow_cooldowns', 'followee_id = $1 or follower_id = $1', [s.paula])).toBe(0)
    expect(await rows(t.db, `select reserver_id from reservations where reserver_id = $1`, [s.moritz])).toEqual([])
    // the others are fine and see nothing of her
    expect((await rpc<{ following: unknown[] }>(t, s.finn, 'get_people_screen')).following).toEqual([])
    await expectRpcError(rpc(t, s.finn, 'peek_follow_link', [s.token]), 'invite_invalid')
    for (const [fn, args] of NEW_RPCS) await expectRpcError(rpc(t, s.paula, fn, args(s.finn)), 'not_allowed')
    await checkInvariants(t)
  })
})
