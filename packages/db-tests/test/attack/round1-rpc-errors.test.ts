/**
 * ATTACK ROUND 1 — RPC surface.
 * Error texts + SQLSTATEs compared between "own reserved wish", "own unreserved wish", "own wish with history",
 * "foreign wish" (owner vs outsider vs member); crafted arguments (nulls, unknown ids, invalid uuids, other people's
 * occasions, garbage tokens); anon on every RPC and on the private helpers; and the blocked-pair name leaks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, scalar, type DbError, type TestDb } from '../../src/harness'
import { NAMES, expectRpcError, rpc, screen, seedPilot, type Seed } from '../pilot/seed'

let t: TestDb
let s: Seed
/** D's own occasion + wish: a "foreign wish" from A's point of view. */
let dOccasion: string
let dWish: string
beforeAll(async () => {
  t = await createTestDb()
  s = await seedPilot(t)
  dOccasion = await t.asUser(s.d, (tx) =>
    scalar<string>(tx, `insert into occasions (host_id, title, starts_at) values ($1, 'Danas Fest', now() + interval '20 days') returning id`, [s.d]),
  )
  const dList = await t.asUser(s.d, (tx) => scalar<string>(tx, 'select id from wishlists where occasion_id = $1', [dOccasion]))
  dWish = await t.asUser(s.d, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, 'Lampe') returning id`, [dList]))
})
afterAll(() => t.close())

const UNKNOWN = '00000000-0000-4000-8000-000000000000'

async function fail(uid: string, fn: string, args: readonly unknown[]): Promise<DbError> {
  return expectDbError(rpc(t, uid, fn, args), 'P0001')
}

describe('reserve_wish / cancel_reservation: owner vs outsider vs member, reserved vs free vs history', () => {
  it('the owner and an outsider get byte-identical errors for reserved, free, historic and foreign wishes', async () => {
    // state: w1 reserved by B; w2 reserved by C then cancelled (history, no active row); w3 free
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    await rpc(t, s.c, 'cancel_reservation', [s.w2])

    for (const fn of ['reserve_wish', 'cancel_reservation']) {
      const ownerErrors = await Promise.all([s.w1, s.w2, s.w3, dWish].map((w) => fail(s.a, fn, [w])))
      const outsiderErrors = await Promise.all([s.w1, s.w2, s.w3].map((w) => fail(s.d, fn, [w])))
      const all = [...ownerErrors, ...outsiderErrors]
      for (const e of all) {
        expect(e.code, fn).toBe('P0001')
        expect(e.message, fn).toBe('not_allowed')
      }
      // unknown and null wish: the same answer for everybody (no role-dependent branch before the lookup)
      for (const uid of [s.a, s.b, s.c, s.d]) {
        expect((await fail(uid, fn, [UNKNOWN])).message, `${fn} unknown`).toBe('not_found')
        expect((await fail(uid, fn, [null])).message, `${fn} null`).toBe('not_found')
      }
    }
    expect(await scalar<number>(t.db, `select count(*)::int from reservations where status = 'active'`)).toBe(1)
  })

  it('a member without an own reservation gets the same not_found whether the wish is taken by someone else or free', async () => {
    const taken = await fail(s.c, 'cancel_reservation', [s.w1]) // B holds it
    const free = await fail(s.c, 'cancel_reservation', [s.w3])
    const history = await fail(s.c, 'cancel_reservation', [s.w2]) // C held it earlier
    expect([taken.message, free.message, history.message]).toEqual(['not_found', 'not_found', 'not_found'])
  })

  it('invalid uuid text fails identically (22P02) for every role, before any function logic runs', async () => {
    const msgs = new Set<string>()
    for (const uid of [s.a, s.b, s.c, s.d]) {
      for (const fn of ['reserve_wish', 'cancel_reservation', 'get_occasion_screen', 'create_invite', 'leave_occasion', 'block_user', 'unblock_user']) {
        const err = await expectDbError(rpc(t, uid, fn, ['not-a-uuid']), '22P02')
        msgs.add(err.message)
      }
      msgs.add((await expectDbError(rpc(t, uid, 'remove_member', ['x', 'y']), '22P02')).message)
    }
    // one message text for "not-a-uuid", one for "x": nothing role-dependent
    expect(msgs.size).toBe(2)
  })
})

describe('every RPC with crafted arguments', () => {
  it('get_occasion_screen: foreign occasion, unknown, null → not_found for host and outsider alike', async () => {
    expect((await fail(s.a, 'get_occasion_screen', [dOccasion])).message).toBe('not_found')
    expect((await fail(s.d, 'get_occasion_screen', [s.occasionId])).message).toBe('not_found')
    expect((await fail(s.a, 'get_occasion_screen', [UNKNOWN])).message).toBe('not_found')
    expect((await fail(s.a, 'get_occasion_screen', [null])).message).toBe('not_found')
    expect((await fail(s.b, 'get_occasion_screen', [dOccasion])).message).toBe('not_found')
  })

  it('create_invite / remove_member / leave_occasion / block_user / unblock_user with foreign, unknown and null ids', async () => {
    expect((await fail(s.a, 'create_invite', [dOccasion])).message).toBe('not_found')
    expect((await fail(s.a, 'create_invite', [null])).message).toBe('not_found')
    expect((await fail(s.b, 'create_invite', [s.occasionId])).message).toBe('not_found')

    expect((await fail(s.a, 'remove_member', [dOccasion, s.d])).message).toBe('not_found')
    expect((await fail(s.a, 'remove_member', [s.occasionId, null])).message).toBe('not_found')
    expect((await fail(s.a, 'remove_member', [null, s.b])).message).toBe('not_found')
    expect((await fail(s.a, 'remove_member', [s.occasionId, UNKNOWN])).message).toBe('not_found')
    expect((await fail(s.b, 'remove_member', [s.occasionId, s.c])).message).toBe('not_found')
    expect((await fail(s.d, 'remove_member', [s.occasionId, s.b])).message).toBe('not_found')

    expect((await fail(s.a, 'leave_occasion', [s.occasionId])).message).toBe('not_allowed')
    expect((await fail(s.a, 'leave_occasion', [dOccasion])).message).toBe('not_found')
    expect((await fail(s.b, 'leave_occasion', [null])).message).toBe('not_found')
    expect((await fail(s.b, 'leave_occasion', [UNKNOWN])).message).toBe('not_found')

    expect((await fail(s.a, 'block_user', [null])).message).toBe('not_found')
    expect((await fail(s.a, 'block_user', [UNKNOWN])).message).toBe('not_found')
    expect((await fail(s.a, 'block_user', [s.a])).message).toBe('not_found')
    expect(await rpc(t, s.a, 'unblock_user', [UNKNOWN])).toEqual({ ok: true })
    expect(await rpc(t, s.a, 'unblock_user', [null])).toEqual({ ok: true })

    // nothing changed
    expect(await scalar<number>(t.db, `select count(*)::int from occasion_members where occasion_id = $1 and status = 'active'`, [s.occasionId])).toBe(3)
    expect(await scalar<number>(t.db, 'select count(*)::int from blocks')).toBe(0)
  })

  it('accept_invite: garbage, wrong length, upper-case, padded, injected and null tokens are all invite_invalid', async () => {
    const guest = s.d
    for (const token of [
      '',
      '0'.repeat(63),
      '0'.repeat(65),
      s.token.toUpperCase(),
      ` ${s.token}`,
      `${s.token}\n`,
      `${s.token}'`,
      `'; delete from invites; --`,
      'x'.repeat(64),
      null,
    ]) {
      expect((await fail(guest, 'accept_invite', [token])).message, JSON.stringify(token)).toBe('invite_invalid')
    }
    expect(await scalar<number>(t.db, 'select count(*)::int from invites')).toBeGreaterThan(0)
    expect(await scalar<number>(t.db, `select count(*)::int from occasion_members where occasion_id = $1 and profile_id = $2`, [s.occasionId, guest])).toBe(0)
  })
})

describe('anon', () => {
  it('cannot execute a single public RPC (the 14 of the pilot + wave 2b) nor reach schema private', async () => {
    const UNKNOWN_TOKEN = 'a'.repeat(64)
    const calls: [string, unknown[]][] = [
      // wave 2b M1 + M2 (follows-design §5.2–§5.3; spec §7.5: the anon loop grows with every new RPC)
      ['public.get_list_screen($1)', [s.wishlistId]],
      ['public.get_lists_overview()', []],
      ['public.get_profile_card($1)', [s.a]],
      ['public.get_people_screen()', []],
      ['public.peek_follow_link($1)', [UNKNOWN_TOKEN]],
      ['public.request_follow($1)', [s.a]],
      ['public.request_follow_via_link($1)', [UNKNOWN_TOKEN]],
      ['public.respond_follow($1, $2)', [s.a, true]],
      ['public.unfollow($1)', [s.a]],
      ['public.remove_follower($1)', [s.a]],
      ['public.create_follow_link()', []],
      ['public.revoke_follow_links()', []],
      // wave 2b M3 + M4: 14 pilot RPCs + 14 new ones = 28
      ['public.set_list_visibility($1, $2)', [s.wishlistId, 'private']],
      ['public.get_free_wishes($1, $2)', [s.a, null]],
      ['public.get_me()', []],
      ['public.get_feed()', []],
      ['public.get_occasion_screen($1)', [s.occasionId]],
      ['public.create_invite($1)', [s.occasionId]],
      ['public.accept_invite($1)', [s.token]],
      ['public.reserve_wish($1)', [s.w3]],
      ['public.cancel_reservation($1)', [s.w1]],
      ['public.my_reservations()', []],
      ['public.leave_occasion($1)', [s.occasionId]],
      ['public.remove_member($1, $2)', [s.occasionId, s.b]],
      ['public.block_user($1)', [s.b]],
      ['public.unblock_user($1)', [s.b]],
      ['public.export_my_data()', []],
      ['public.delete_my_account()', []],
    ]
    for (const [call, args] of calls) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(`select ${call}`, args)), '42501')
      expect(err.message, call).toMatch(/permission denied for function/)
    }
    for (const call of [
      'private.require_user()', `private.is_host('${s.occasionId}', '${s.a}')`, 'private.my_reservations_export()', `private.has_consents('${s.a}')`,
      // wave 2b
      'private.my_follows_export()', 'private.my_wishlists_export()', `private.visible_request('${s.b}', '${s.a}')`, `private.profile_card('${s.a}')`,
      'private.follower_lists_on()', `private.can_find_gift('${s.b}', '${s.a}')`,
    ]) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(`select ${call}`)), '42501')
      expect(err.message, call).toMatch(/permission denied for schema private/)
    }
    // state untouched by the attempts
    expect(await scalar<number>(t.db, 'select count(*)::int from auth.users where id = $1', [s.a])).toBe(1)
    expect(await scalar<number>(t.db, `select count(*)::int from occasion_members where occasion_id = $1 and status = 'active'`, [s.occasionId])).toBe(3)
  })

  it('authenticated cannot call the internal lifecycle / trigger functions directly', async () => {
    for (const call of [
      `private.end_reservations_in_occasion('${s.occasionId}', '${s.b}', 'member_removed')`,
      'private.wish_before_delete()',
      'private.occasion_after_insert()',
      'private.handle_new_user()',
    ]) {
      const err = await expectDbError(t.asUser(s.a, (tx) => tx.query(`select ${call}`)), '42501')
      expect(err.message, call).toMatch(/permission denied for function/)
    }
    // trigger functions that policies/trigger creation needed a grant for cannot be invoked as functions
    for (const call of ['private.set_updated_at()', 'private.reservation_guard()', 'private.wish_guard()']) {
      await expectDbError(t.asUser(s.a, (tx) => tx.query(`select ${call}`)), '0A000')
    }
    expect(await scalar<number>(t.db, `select count(*)::int from reservations where status = 'active'`)).toBe(1)
  })
})

describe('blocked pairs and names (data-spec §7 row 16: "профили скрыты")', () => {
  it('two members who blocked each other do not see each other in the members list', async () => {
    const s2 = await seedPilot(t)
    await rpc(t, s2.b, 'block_user', [s2.c])
    expect((await screen(t, s2.b, s2.occasionId)).members.map((m) => m.profile_id)).toEqual([s2.a, s2.b])
    expect((await screen(t, s2.c, s2.occasionId)).members.map((m) => m.profile_id)).toEqual([s2.a, s2.c])
    expect((await screen(t, s2.a, s2.occasionId)).members.map((m) => m.profile_id)).toEqual([s2.a, s2.b, s2.c])
  })

  it('[F-4] reserved_by_name must not reveal the display name of a person the viewer is blocked with', async () => {
    const s3 = await seedPilot(t)
    await rpc(t, s3.b, 'block_user', [s3.c])
    await rpc(t, s3.c, 'reserve_wish', [s3.w1])
    const w1 = (await screen(t, s3.b, s3.occasionId)).wishlist!.wishes.find((w) => w.id === s3.w1)!
    expect(w1.reserved).toBe(true) // the fact "taken" is fine (B must not double-gift)
    expect(w1).not.toHaveProperty('reserved_by_name') // but not WHO, when the profile is hidden from B
    expect(JSON.stringify(await screen(t, s3.b, s3.occasionId))).not.toContain(NAMES.c)
  })

  it('[F-5] export_my_data must not reveal the display name of a host who blocked the exporting user', async () => {
    const s4 = await seedPilot(t)
    await rpc(t, s4.b, 'reserve_wish', [s4.w1])
    await rpc(t, s4.a, 'block_user', [s4.b])
    const exp = await rpc<{ reservations_made_by_me: { recipient_name: string | null; status: string }[] }>(t, s4.b, 'export_my_data')
    expect(exp.reservations_made_by_me).toHaveLength(1)
    expect(exp.reservations_made_by_me[0]!.status).toBe('ended')
    expect(exp.reservations_made_by_me[0]!.recipient_name).toBeNull()
  })
})
