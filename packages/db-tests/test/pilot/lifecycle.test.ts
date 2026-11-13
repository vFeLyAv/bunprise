/**
 * Lifecycle (data-and-secrecy.md §7, pilot-decisions §1): deleting a reserved wish, deleting the occasion,
 * leaving, being removed, blocking, deleting the account (host and member), and export_my_data.
 * Every test seeds its own occasion because each one destroys state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, one, rows, type TestDb } from '../../src/harness'
import {
  NAMES,
  OCCASION_TITLE,
  WISH_TITLES,
  countAll,
  countAs,
  execAs,
  expectRpcError,
  rpc,
  screen,
  seedPilot,
  type Feed,
  type MyReservation,
} from './seed'
import { runCleanupPass } from '../follows/invariants'

// Since 20261027200000 (shared wishes, LAZY liveness): no owner action touches reservations. A reservation that lost
// its wish / access is DEAD at once — the giver sees "unavailable" with the snapshot title and no context — and the
// background cleanup (private.reservations_cleanup_run, pg_cron every minute) ends it in the table.

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface Export {
  format: string
  exported_at: string
  profile: Record<string, unknown>
  consents: unknown[]
  occasions_hosted: { title: string; invites: Record<string, unknown>[]; members: { display_name: string | null }[] }[]
  memberships: unknown[]
  wishlists: { wishes: unknown[] }[]
  reservations_made_by_me: { wish_title: string; recipient_name: string | null; occasion_title: string | null; status: string }[]
  blocks: unknown[]
  reports: unknown[]
}

describe('wishes and occasions', () => {
  it('host deletes a reserved wish through REST: works like any delete; the reserver sees unavailable with the title', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    expect(await execAs(t, s.a, 'delete from wishes where id = $1', [s.w1])).toBe(1) // reserved
    expect(await execAs(t, s.a, 'delete from wishes where id = $1', [s.w2])).toBe(1) // not reserved: same outcome
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(1)

    const mine = await rpc<MyReservation[]>(t, s.b, 'my_reservations')
    expect(mine).toEqual([
      expect.objectContaining({ wish_id: null, wish_title: WISH_TITLES.w1, occasion_id: null, occasion_title: null, status: 'ended', end_reason: 'unavailable' }),
    ])
    expect(await one(t.db, `select status from reservations where reserver_id = $1`, [s.b])).toEqual({ status: 'active' }) // dead, not cleaned yet
    await runCleanupPass(t)
    expect(await one(t.db, `select wish_id, status, end_reason, ended_at is not null as ended from reservations where reserver_id = $1`, [s.b])).toEqual({
      wish_id: null,
      status: 'ended',
      end_reason: 'wish_deleted',
      ended: true,
    })
    // host screen: one wish left, still nulls; the other members see the wish gone and w3 free
    const host = await screen(t, s.a, s.occasionId)
    expect(host.wishlist!.wishes.map((w) => [w.id, w.reserved])).toEqual([[s.w3, null]])
    expect((await screen(t, s.c, s.occasionId)).wishlist!.wishes.map((w) => [w.id, w.reserved])).toEqual([[s.w3, false]])
  })

  it('host deletes the occasion: everything cascades; reservations are dead at once, the cleanup ends them as wish_deleted', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    expect(await execAs(t, s.b, 'delete from occasions where id = $1', [s.occasionId])).toBe(0) // a member: RLS, 0 rows
    expect(await countAll(t, 'occasions', 'id = $1', [s.occasionId])).toBe(1)
    expect(await execAs(t, s.a, 'delete from occasions where id = $1', [s.occasionId])).toBe(1)
    for (const [table, col] of [
      ['occasion_members', 'occasion_id'],
      ['invites', 'occasion_id'],
      ['wishlists', 'occasion_id'],
      ['occasion_addresses', 'occasion_id'],
    ] as const) {
      expect(await countAll(t, table, `${col} = $1`, [s.occasionId]), table).toBe(0)
    }
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(0)
    const mine = await rpc<MyReservation[]>(t, s.b, 'my_reservations')
    expect(mine).toEqual([expect.objectContaining({ wish_id: null, wish_title: WISH_TITLES.w1, occasion_id: null, occasion_title: null, starts_at: null, status: 'ended', end_reason: 'unavailable' })])
    await runCleanupPass(t)
    expect(await rows(t.db, `select wish_id, status, end_reason from reservations where reserver_id in ($1, $2) order by reserver_id`, [s.b, s.c])).toEqual([
      { wish_id: null, status: 'ended', end_reason: 'wish_deleted' },
      { wish_id: null, status: 'ended', end_reason: 'wish_deleted' },
    ])
    expect(await rpc<MyReservation[]>(t, s.b, 'my_reservations')).toEqual(mine)
    expect(await rpc<Feed>(t, s.b, 'get_feed')).toEqual({ upcoming: [], past: [] })
    await expectRpcError(screen(t, s.b, s.occasionId), 'not_found')
  })
})

describe('membership', () => {
  it('leave_occasion: status left, own reservations end (member_left), wish free again; host cannot leave', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await expectRpcError(rpc(t, s.a, 'leave_occasion', [s.occasionId]), 'not_allowed')
    await expectRpcError(rpc(t, s.d, 'leave_occasion', [s.occasionId]), 'not_found')
    expect(await rpc(t, s.b, 'leave_occasion', [s.occasionId])).toEqual({ ok: true })
    expect(await one(t.db, 'select status from occasion_members where occasion_id = $1 and profile_id = $2', [s.occasionId, s.b])).toEqual({ status: 'left' })
    expect(await one(t.db, 'select status, end_reason from reservations where reserver_id = $1', [s.b])).toEqual({ status: 'ended', end_reason: 'member_left' })
    await expectRpcError(rpc(t, s.b, 'leave_occasion', [s.occasionId]), 'not_found')
    await expectRpcError(screen(t, s.b, s.occasionId), 'not_found')
    await expectRpcError(rpc(t, s.b, 'reserve_wish', [s.w2]), 'not_allowed')
    expect(await rpc<Feed>(t, s.b, 'get_feed')).toEqual({ upcoming: [], past: [] })
    expect(await countAs(t, s.b, 'wishes')).toBe(0)
    expect(await rpc(t, s.c, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect((await rpc<MyReservation[]>(t, s.b, 'my_reservations')).map((r) => r.end_reason)).toEqual(['member_left'])
  })

  it('remove_member: host only; status removed, the reservation is dead (unavailable) at once; the host learns nothing about it', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await expectRpcError(rpc(t, s.b, 'remove_member', [s.occasionId, s.c]), 'not_found')
    await expectRpcError(rpc(t, s.d, 'remove_member', [s.occasionId, s.c]), 'not_found')
    await expectRpcError(rpc(t, s.a, 'remove_member', [s.occasionId, s.a]), 'not_found') // not themselves
    await expectRpcError(rpc(t, s.a, 'remove_member', [s.occasionId, s.d]), 'not_found') // not a member
    const hostBefore = await screen(t, s.a, s.occasionId)
    expect(await rpc(t, s.a, 'remove_member', [s.occasionId, s.b])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.a, 'remove_member', [s.occasionId, s.b]), 'not_found')
    expect(await one(t.db, 'select status from occasion_members where occasion_id = $1 and profile_id = $2', [s.occasionId, s.b])).toEqual({ status: 'removed' })
    expect(await one(t.db, 'select status, end_reason from reservations where reserver_id = $1', [s.b])).toEqual({ status: 'active', end_reason: null }) // the host's action never touches it
    await expectRpcError(screen(t, s.b, s.occasionId), 'not_found')
    expect((await screen(t, s.c, s.occasionId)).wishlist!.wishes.find((w) => w.id === s.w1)!.reserved).toBe(false) // dead: free for the others
    const hostAfter = await screen(t, s.a, s.occasionId)
    expect(hostAfter.members.map((m) => m.profile_id)).toEqual([s.a, s.c])
    expect(hostAfter.wishlist).toEqual(hostBefore.wishlist) // still all nulls, same order
    // the host sees the removed row through REST, the other member does not, the removed one sees only their own row
    expect(await countAs(t, s.a, 'occasion_members', 'occasion_id = $1', [s.occasionId])).toBe(3)
    expect(await countAs(t, s.c, 'occasion_members', 'occasion_id = $1', [s.occasionId])).toBe(2)
    expect(await countAs(t, s.b, 'occasion_members')).toBe(1)
    expect((await rpc<MyReservation[]>(t, s.b, 'my_reservations')).map((r) => r.end_reason)).toEqual(['unavailable'])
    await runCleanupPass(t)
    expect(await one(t.db, 'select status, end_reason from reservations where reserver_id = $1', [s.b])).toEqual({ status: 'ended', end_reason: 'access_ended' })
    expect((await rpc<MyReservation[]>(t, s.b, 'my_reservations')).map((r) => r.end_reason)).toEqual(['unavailable'])
  })

  it('block_user (groundwork): membership removed, the reservation dead at once (the cleanup ends it), nothing of each other visible', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await expectRpcError(rpc(t, s.a, 'block_user', [s.a]), 'not_found')
    expect(await rpc(t, s.a, 'block_user', [s.b])).toEqual({ ok: true })
    expect(await rpc(t, s.a, 'block_user', [s.b])).toEqual({ ok: true }) // idempotent
    expect(await one(t.db, 'select status from occasion_members where occasion_id = $1 and profile_id = $2', [s.occasionId, s.b])).toEqual({ status: 'removed' })
    expect(await one(t.db, 'select status, end_reason from reservations where reserver_id = $1', [s.b])).toEqual({ status: 'active', end_reason: null })
    expect((await rpc<MyReservation[]>(t, s.b, 'my_reservations')).map((r) => [r.status, r.end_reason])).toEqual([['ended', 'unavailable']])
    await runCleanupPass(t)
    expect(await one(t.db, 'select status, end_reason from reservations where reserver_id = $1', [s.b])).toEqual({ status: 'ended', end_reason: 'access_ended' })
    expect(await countAs(t, s.b, 'occasions')).toBe(0)
    expect(await countAs(t, s.b, 'profiles', 'id = $1', [s.a])).toBe(0)
    expect(await countAs(t, s.a, 'profiles', 'id = $1', [s.b])).toBe(0)
    expect(await countAs(t, s.a, 'blocks')).toBe(1)
    expect(await countAs(t, s.c, 'blocks')).toBe(0)
    await expectRpcError(rpc(t, s.b, 'accept_invite', [s.token]), 'invite_invalid')
    expect(await rpc(t, s.a, 'unblock_user', [s.b])).toEqual({ ok: true })
    expect(await countAs(t, s.a, 'blocks')).toBe(0)
    await expectRpcError(rpc(t, s.b, 'accept_invite', [s.token]), 'invite_invalid')
    const fresh = await rpc<{ token: string }>(t, s.a, 'create_invite', [s.occasionId])
    expect(await rpc(t, s.b, 'accept_invite', [fresh.token])).toEqual({ occasion_id: s.occasionId })
    expect((await screen(t, s.b, s.occasionId)).wishlist!.wishes.find((w) => w.id === s.w1)!.reserved).toBe(false)
  })
})

describe('accounts', () => {
  it('delete_my_account as a member: account and membership gone; the reservation an orphan (hidden, the wish free); the cleanup erases it', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    expect(await rpc(t, s.b, 'delete_my_account')).toEqual({ ok: true })
    expect(await countAll(t, 'auth.users', 'id = $1', [s.b])).toBe(0)
    expect(await countAll(t, 'profiles', 'id = $1', [s.b])).toBe(0)
    expect(await countAll(t, 'occasion_members', 'profile_id = $1', [s.b])).toBe(0)
    expect(await countAll(t, 'reservations', 'reserver_id = $1', [s.b])).toBe(1) // not touched by the deletion (INV-7 a)
    expect((await screen(t, s.c, s.occasionId)).wishlist!.wishes.find((w) => w.id === s.w1)!.reserved).toBe(false)
    await runCleanupPass(t)
    expect(await countAll(t, 'reservations', 'reserver_id = $1', [s.b])).toBe(0)
    expect(await countAll(t, 'consents', 'profile_id = $1', [s.b])).toBe(0)
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(3)
    expect((await screen(t, s.a, s.occasionId)).members.map((m) => m.profile_id)).toEqual([s.a, s.c])
    expect(await rpc(t, s.c, 'reserve_wish', [s.w1])).toEqual({ ok: true })
  })

  it('delete_my_account as the host: all occasions cascade; reservers lose the row silently', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    expect(await rpc(t, s.a, 'delete_my_account')).toEqual({ ok: true })
    expect(await countAll(t, 'auth.users', 'id = $1', [s.a])).toBe(0)
    expect(await countAll(t, 'occasions', 'id = $1', [s.occasionId])).toBe(0)
    expect(await countAll(t, 'wishlists', 'id = $1', [s.wishlistId])).toBe(0)
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(0)
    expect(await countAll(t, 'invites', 'occasion_id = $1', [s.occasionId])).toBe(0)
    expect(await countAll(t, 'occasion_members', 'occasion_id = $1', [s.occasionId])).toBe(0)
    expect(await rpc(t, s.b, 'my_reservations')).toEqual([]) // orphans (recipient gone) are hidden at once
    expect(await countAll(t, 'reservations', 'recipient_id = $1', [s.a])).toBe(2)
    await runCleanupPass(t)
    expect(await countAll(t, 'reservations', 'recipient_id = $1 or reserver_id in ($2, $3)', [s.a, s.b, s.c])).toBe(0)
    expect(await rpc<Feed>(t, s.b, 'get_feed')).toEqual({ upcoming: [], past: [] })
    expect(await countAll(t, 'profiles', 'id in ($1, $2)', [s.b, s.c])).toBe(2)
    await expectDbError(t.asAnon((tx) => tx.query('select public.delete_my_account()')), '42501')
  })

  it('export_my_data: the host never sees reservations on their wishes (identical export before/after), the reserver sees their own', async () => {
    const s = await seedPilot(t)
    const strip = (e: Export) => JSON.stringify({ ...e, exported_at: null })
    const hostBefore = await rpc<Export>(t, s.a, 'export_my_data')
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    const host = await rpc<Export>(t, s.a, 'export_my_data')

    expect(strip(host)).toBe(strip(hostBefore))
    // wave 2b: + follows (M2); format bunprise-export-v2 since M1 (follows-design §8.3)
    expect(Object.keys(host).sort()).toEqual(['blocks', 'consents', 'exported_at', 'follows', 'format', 'memberships', 'occasions_hosted', 'profile', 'reports', 'reservations_made_by_me', 'wishlists'])
    expect(host.reservations_made_by_me).toEqual([])
    const text = JSON.stringify(host).replace('reservations_made_by_me', '')
    expect(text).not.toMatch(/reserv/)
    expect(text).not.toContain(s.b)
    expect(text).not.toContain(s.c)
    expect(host.profile).toMatchObject({ id: s.a, display_name: NAMES.a })
    expect(host.consents).toHaveLength(3)
    expect(host.occasions_hosted).toHaveLength(1)
    expect(host.occasions_hosted[0]!.title).toBe(OCCASION_TITLE)
    expect(host.occasions_hosted[0]!.members.map((m) => m.display_name)).toEqual([NAMES.a, NAMES.b, NAMES.c])
    expect(host.occasions_hosted[0]!.invites).toHaveLength(1)
    expect(Object.keys(host.occasions_hosted[0]!.invites[0]!)).not.toContain('token_hash')
    expect(JSON.stringify(host)).not.toContain(s.token)
    expect(host.wishlists[0]!.wishes).toHaveLength(3)
    expect(host.memberships).toEqual([])

    const reserver = await rpc<Export>(t, s.b, 'export_my_data')
    expect(reserver.reservations_made_by_me).toEqual([
      expect.objectContaining({ wish_title: WISH_TITLES.w1, recipient_name: NAMES.a, occasion_title: OCCASION_TITLE, status: 'active' }),
    ])
    expect(reserver.occasions_hosted).toEqual([])
    expect(reserver.memberships).toEqual([expect.objectContaining({ occasion_id: s.occasionId, occasion_title: OCCASION_TITLE, role: 'member', status: 'active' })])
    expect(JSON.stringify(reserver)).not.toContain(s.c) // the other reserver is nobody's business

    // the outsider's export is just as well-formed
    const outsider = await rpc<Export>(t, s.d, 'export_my_data')
    expect(outsider).toMatchObject({ format: 'bunprise-export-v2', occasions_hosted: [], memberships: [], wishlists: [], reservations_made_by_me: [], blocks: [], reports: [] })
    await expectDbError(t.asAnon((tx) => tx.query('select public.export_my_data()')), '42501')
  })
})
