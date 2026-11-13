/**
 * Pins for the behaviour changed by the attack-round-1 fixes (F-1 … F-5 are asserted by test/attack/*; this file
 * covers the side effects and the new access path those fixes introduced):
 *   - remove_member revokes the occasion's active link (a guest who never joined cannot use it either; the host's
 *     screen shows invite: null; a NEW link works for everybody again), leave_occasion keeps the link;
 *   - a block by a guest against the host looks like a voluntary exit ('left') in everything the host can read;
 *   - private.my_profile_export(): own row only, used by export_my_data for the fields REST no longer serves;
 *   - consents.accepted_at is set by the database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, one, rows, scalar, type TestDb } from '../../src/harness'
import { NAMES, createMember, expectRpcError, giveConsents, queryAs, rpc, screen, seedPilot, type MyReservation } from './seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

// wave 2b M1: + banner (follows-design §3.2 item 8); M3: + in_suggestions (§5.5 private.my_profile_export)
// 20261024120000: + photo / banner_photo (the meta of the own photos; the bytes come from export_my_profile_photos)
const PROFILE_KEYS = ['banner', 'banner_photo', 'created_at', 'display_name', 'id', 'in_suggestions', 'invitations_from', 'locale', 'onboarding_done_at', 'photo', 'updated_at']

describe('remove_member and invite links (F-1)', () => {
  it('removing a guest revokes the active link for everyone; the host creates a new one', async () => {
    const s = await seedPilot(t)
    expect((await screen(t, s.a, s.occasionId)).invite).toEqual({ active: true, expires_at: expect.any(String) })
    expect(await rpc(t, s.a, 'remove_member', [s.occasionId, s.b])).toEqual({ ok: true })
    expect(await scalar<number>(t.db, `select count(*)::int from invites where occasion_id = $1 and revoked_at is null`, [s.occasionId])).toBe(0)
    expect((await screen(t, s.a, s.occasionId)).invite).toBeNull()
    // the removed guest, an outsider who never joined, and a current member: the old link is dead for all of them
    await expectRpcError(rpc(t, s.b, 'accept_invite', [s.token]), 'invite_invalid')
    await expectRpcError(rpc(t, s.d, 'accept_invite', [s.token]), 'invite_invalid')
    await expectRpcError(rpc(t, s.c, 'accept_invite', [s.token]), 'invite_invalid')
    expect((await screen(t, s.c, s.occasionId)).viewer.role).toBe('member') // C's membership is untouched
    const { token } = await rpc<{ token: string }>(t, s.a, 'create_invite', [s.occasionId])
    expect(await rpc(t, s.d, 'accept_invite', [token])).toEqual({ occasion_id: s.occasionId })
    expect(await rpc(t, s.b, 'accept_invite', [token])).toEqual({ occasion_id: s.occasionId })
    expect((await screen(t, s.a, s.occasionId)).members.map((m) => m.profile_id).sort()).toEqual([s.a, s.b, s.c, s.d].sort())
  })

  it('a failed removal (not the host / not a member) revokes nothing', async () => {
    const s = await seedPilot(t)
    await expectRpcError(rpc(t, s.b, 'remove_member', [s.occasionId, s.c]), 'not_found')
    await expectRpcError(rpc(t, s.a, 'remove_member', [s.occasionId, s.d]), 'not_found')
    expect(await scalar<number>(t.db, `select count(*)::int from invites where occasion_id = $1 and revoked_at is null`, [s.occasionId])).toBe(1)
    expect(await rpc(t, s.d, 'accept_invite', [s.token])).toEqual({ occasion_id: s.occasionId })
  })

  it('leaving keeps the link alive (contract: "left" may come back by the same link)', async () => {
    const s = await seedPilot(t)
    expect(await rpc(t, s.b, 'leave_occasion', [s.occasionId])).toEqual({ ok: true })
    expect(await scalar<number>(t.db, `select count(*)::int from invites where occasion_id = $1 and revoked_at is null`, [s.occasionId])).toBe(1)
    expect(await rpc(t, s.d, 'accept_invite', [s.token])).toEqual({ occasion_id: s.occasionId })
    expect(await rpc(t, s.b, 'accept_invite', [s.token])).toEqual({ occasion_id: s.occasionId })
  })
})

describe('block_user is quiet towards the host', () => {
  it('a guest blocking the host looks exactly like a guest who left: status left, reservations ended as blocked for the blocker only', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'leave_occasion', [s.occasionId]) // the reference: a voluntary exit
    expect(await rpc(t, s.b, 'block_user', [s.a])).toEqual({ ok: true })
    const hostView = await queryAs<{ profile_id: string; status: string }>(
      t,
      s.a,
      `select profile_id, status from occasion_members where occasion_id = $1 and role = 'member' order by profile_id`,
      [s.occasionId],
    )
    expect(hostView).toEqual([{ profile_id: s.b, status: 'left' }, { profile_id: s.c, status: 'left' }].sort((x, y) => (x.profile_id < y.profile_id ? -1 : 1)))
    expect((await screen(t, s.a, s.occasionId)).members.map((m) => m.profile_id)).toEqual([s.a])
    // the blocker's own reservation is dead at once (20261027200000: block_user never touches reservations; the
    // cleanup ends it): the blocker sees the one neutral reason, the wish is free again
    expect(await one(t.db, `select status, end_reason from reservations where reserver_id = $1`, [s.b])).toEqual({ status: 'active', end_reason: null })
    expect((await rpc<MyReservation[]>(t, s.b, 'my_reservations')).map((r) => r.end_reason)).toEqual(['unavailable'])
    expect(await rpc(t, s.d, 'accept_invite', [s.token])).toEqual({ occasion_id: s.occasionId })
    expect(await rpc(t, s.d, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    // while blocked the link does not let B back; the host cannot see B's profile and vice versa
    await expectRpcError(rpc(t, s.b, 'accept_invite', [s.token]), 'invite_invalid')
    expect(await queryAs(t, s.a, 'select id from profiles where id = $1', [s.b])).toEqual([])
    expect(await queryAs(t, s.b, 'select id from profiles where id = $1', [s.a])).toEqual([])
  })

  it('the host blocking a guest still reads as removed (the host did it)', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.a, 'block_user', [s.c])
    expect(await one(t.db, 'select status from occasion_members where occasion_id = $1 and profile_id = $2', [s.occasionId, s.c])).toEqual({ status: 'removed' })
  })
})

describe('profile fields after the F-2 column grant', () => {
  it('export_my_data carries the full own profile row through private.my_profile_export(); REST serves only id + display_name', async () => {
    const s = await seedPilot(t)
    await t.asUser(s.b, (tx) => tx.query(`update profiles set locale = 'en' where id = $1`, [s.b]))
    const exp = await rpc<{ profile: Record<string, unknown> }>(t, s.b, 'export_my_data')
    expect(Object.keys(exp.profile).sort()).toEqual(PROFILE_KEYS)
    expect(exp.profile).toMatchObject({ id: s.b, display_name: NAMES.b, locale: 'en', onboarding_done_at: null })
    expect(exp.profile).not.toHaveProperty('last_seen_at')
    // the helper answers for the caller only and cannot be pointed at somebody else (no arguments)
    const own = await t.asUser(s.b, (tx) => scalar<Record<string, unknown>>(tx, 'select private.my_profile_export() as v'))
    expect(own['id']).toBe(s.b)
    expect(await t.asUser(s.d, (tx) => scalar<Record<string, unknown>>(tx, 'select private.my_profile_export() as v'))).toMatchObject({ id: s.d })
    await expectDbError(t.asAnon((tx) => tx.query('select private.my_profile_export()')), '42501')
    // own row through REST: id + display_name yes, the rest no (same rule as for co-members)
    expect(await queryAs(t, s.b, 'select id, display_name from profiles where id = $1', [s.b])).toEqual([{ id: s.b, display_name: NAMES.b }])
    await expectDbError(t.asUser(s.b, (tx) => rows(tx, 'select locale from profiles where id = $1', [s.b])), '42501')
    await expectDbError(t.asUser(s.b, (tx) => rows(tx, 'select * from profiles where id = $1', [s.b])), '42501')
    expect(await scalar<number>(t.db, `select count(*)::int from information_schema.column_privileges where grantee = 'authenticated' and table_name = 'profiles' and privilege_type = 'SELECT'`)).toBe(2)
  })

  it('get_me still serves the own fields the client needs for the guards', async () => {
    const u = await createMember(t, 'Pia')
    await t.asUser(u, (tx) => tx.query(`update profiles set onboarding_done_at = now(), locale = 'en' where id = $1`, [u]))
    const me = await rpc<{ profile: { id: string; display_name: string; locale: string; onboarding_done_at: string | null } }>(t, u, 'get_me')
    expect(me.profile).toMatchObject({ id: u, display_name: 'Pia', locale: 'en' })
    expect(me.profile.onboarding_done_at).not.toBeNull()
  })
})

describe('consents (F-3)', () => {
  it('accepted_at comes from the database: the column is not insertable, the stored value is "now"', async () => {
    const u = await createMember(t, 'Quirin', { consents: false })
    await giveConsents(t, u)
    const ages = await rows<{ age_s: number }>(t.db, `select extract(epoch from (now() - accepted_at))::float8 as age_s from consents where profile_id = $1`, [u])
    expect(ages).toHaveLength(3)
    for (const r of ages) expect(r.age_s).toBeGreaterThanOrEqual(0)
    for (const r of ages) expect(r.age_s).toBeLessThan(60)
    expect(await scalar<boolean>(t.db, `select has_column_privilege('authenticated', 'public.consents', 'accepted_at', 'insert')`)).toBe(false)
    expect(await scalar<boolean>(t.db, `select has_column_privilege('authenticated', 'public.consents', 'accepted_at', 'select')`)).toBe(true)
  })
})
