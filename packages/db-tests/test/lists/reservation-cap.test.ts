/**
 * F24 — at most 5 active reservations of one giver for one recipient on lists without an occasion (follows-design
 * §00 item 6, §5.5 step 3b, S19 "capture"; M3 20261020200200_follow_sharing.sql):
 *   L1 gets 4 more wishes (7), Finn is also a guest of Paula's occasion O1 for this test. Finn reserves 5 wishes of L1
 *   -> the 6th is limit_reached; pressing an own reservation again -> ok; cancelling one -> possible again; the cap
 *   spans ALL of Paula's lists without an occasion; Finn's reservations on O1 are neither counted nor limited; the cap
 *   is per recipient (another person's lists have their own 5); Greta on the same wishes gets her usual answers;
 *   Paula's snapshot (INV-2) is the same at 0, at 5 reservations and after Finn's limit_reached.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type TestDb } from '../../src/harness'
import { createMember, expectRpcError, rpc } from '../pilot/seed'
import { addWish, createList, followLink, seedFollows, type FollowSeed } from '../follows/seed'
import { checkInvariants, cooldownRows, ownerSnapshot, runCleanupPass } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

// (20261027200000: a reservation counts only while it is LIVE)
const activeOf = (reserver: string, recipient: string) =>
  scalar<number>(
    t.db,
    `select count(*)::int from reservations r join wishlists wl on wl.id = r.wishlist_id
      where r.reserver_id = $1 and r.recipient_id = $2 and r.status = 'active' and wl.occasion_id is null
        and private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)`,
    [reserver, recipient],
  )

describe('F24 the cap of 5', () => {
  let s: FollowSeed
  let wishes: string[]
  let snapshotOpts: { occasionIds: string[]; listIds: string[]; profileIds: string[] }
  beforeAll(async () => {
    s = await seedFollows(t)
    const more: string[] = []
    for (let i = 1; i <= 4; i++) more.push(await addWish(t, s.paula, s.l1, `Extra ${i}`, 2, 10 + i))
    wishes = [...s.l1Wishes, ...more] // 7 wishes in L1
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite]) // Finn is also a guest of O1
    snapshotOpts = { occasionIds: [s.o1, s.o2], listIds: [s.l1, s.l2], profileIds: [s.finn, s.greta, s.moritz] }
  })

  it('five reservations, the 6th is limit_reached (only for Finn); Paula\'s world never moves', async () => {
    const cooldownsBefore = await cooldownRows(t)
    const paulaAt0 = await ownerSnapshot(t, s.paula, snapshotOpts)
    for (const wish of wishes.slice(0, 5)) expect(await rpc(t, s.finn, 'reserve_wish', [wish])).toEqual({ ok: true })
    expect(await activeOf(s.finn, s.paula)).toBe(5)
    const paulaAt5 = await ownerSnapshot(t, s.paula, snapshotOpts)
    expect(paulaAt5).toEqual(paulaAt0)

    const err = await expectRpcError(rpc(t, s.finn, 'reserve_wish', [wishes[5]]), 'limit_reached')
    expect(err.code).toBe('P0001')
    expect(await activeOf(s.finn, s.paula)).toBe(5)
    expect(await ownerSnapshot(t, s.paula, snapshotOpts)).toEqual(paulaAt0)
    // the 6th wish stays free: Greta takes it as usual; on Finn's wishes she gets already_reserved
    expect(await rpc(t, s.greta, 'reserve_wish', [wishes[5]])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.greta, 'reserve_wish', [wishes[0]]), 'already_reserved')
    expect(await ownerSnapshot(t, s.paula, snapshotOpts)).toEqual(paulaAt0)
    await checkInvariants(t, { cooldownsBefore })
  })

  it('pressing an own reservation again is ok at the cap; a wish taken by somebody else at the cap is limit_reached', async () => {
    expect(await rpc(t, s.finn, 'reserve_wish', [wishes[2]])).toEqual({ ok: true }) // idempotent, no new row
    expect(await activeOf(s.finn, s.paula)).toBe(5)
    // the cap comes before the insert: at 5 Finn cannot even learn that wishes[5] is taken (by Greta)
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [wishes[5]]), 'limit_reached')
  })

  it('cancelling one frees a place; the occasion list O1 is neither counted nor limited', async () => {
    expect(await rpc(t, s.finn, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true }) // at 5 on lists without an occasion
    expect(await activeOf(s.finn, s.paula)).toBe(5)
    expect(await rpc(t, s.finn, 'cancel_reservation', [wishes[0]])).toEqual({ ok: true })
    expect(await rpc(t, s.finn, 'reserve_wish', [wishes[6]])).toEqual({ ok: true })
    expect(await activeOf(s.finn, s.paula)).toBe(5)
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [wishes[0]]), 'limit_reached')
    await checkInvariants(t)
  })

  it('the cap spans every list of the same recipient, and each recipient has their own five', async () => {
    // a second follower list of Paula: still the same 5 for Finn
    const l3 = await createList(t, s.paula, 'Weihnachten', { visibility: 'followers' })
    const l3Wish = await addWish(t, s.paula, l3, 'Schal')
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [l3Wish]), 'limit_reached')
    // Anna's lists: Finn's reservations at Paula's do not count there
    const anna = await createMember(t, 'Anna')
    const annaList = await createList(t, anna, 'Annas Wünsche', { visibility: 'followers' })
    const annaWishes: string[] = []
    for (let i = 1; i <= 6; i++) annaWishes.push(await addWish(t, anna, annaList, `Anna ${i}`))
    await rpc(t, s.finn, 'request_follow_via_link', [await followLink(t, anna)])
    await rpc(t, anna, 'respond_follow', [s.finn, true])
    for (const wish of annaWishes.slice(0, 5)) expect(await rpc(t, s.finn, 'reserve_wish', [wish])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [annaWishes[5]]), 'limit_reached')
    expect([await activeOf(s.finn, s.paula), await activeOf(s.finn, anna)]).toEqual([5, 5])
    // Greta's own count at Paula's is 1 — the cap of somebody else never touches her
    expect(await rpc(t, s.greta, 'reserve_wish', [l3Wish])).toEqual({ ok: true })
    await checkInvariants(t)
  })

  it('ended reservations do not count: after "Nur ich" (access_ended) the same giver starts at 0 again', async () => {
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])).toEqual({ ok: true })
    expect(await activeOf(s.finn, s.paula)).toBe(0) // dead at once
    await runCleanupPass(t) // ... and ended by the cleanup (before it runs, switching back would revive them, Q20)
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'followers'])).toEqual({ ok: true })
    for (const wish of wishes.slice(0, 5)) expect(await rpc(t, s.finn, 'reserve_wish', [wish])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [wishes[5]]), 'limit_reached')
    await checkInvariants(t)
  })
})
