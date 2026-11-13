/**
 * F06 — removing a follower (follows-design §2.10, §5.4 remove_follower, INV-1, INV-2, INV-6, A2, S9, S10; M3):
 *   Finn reserves -> Paula removes him -> L1 is not visible to Finn any more (REST + RPC), the wish is free for Greta,
 *   Finn's reservation reads access_ended, Paula's answers do not depend on whether Finn had reserved anything
 *   ({ok:true} byte for byte, her snapshot as without the reservation); Finn's new requests stay hidden for 30 days,
 *   also after his block -> unblock; after Paula accepts him again the wish is still free (nothing comes back).
 *   unfollow (Finn's own decision) ends his reservations as 'unfollowed' instead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, type TestDb } from '../../src/harness'
import { expectRpcError, queryAs, rpc } from '../pilot/seed'
import { L1_WISH_TITLES, followRows, rpcOutcome, rpcText, seedFollows } from '../follows/seed'
import { checkInvariants, cooldownRows, ownerSnapshot, runCleanupPass } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface MyReservation {
  wish_id: string | null
  wish_title: string
  status: string
  end_reason: string | null
  list: unknown
}

const ended = (uid: string) => rows<{ wish_id: string; status: string; end_reason: string }>(t.db, `select wish_id, status, end_reason from reservations where reserver_id = $1 order by created_at`, [uid])

describe('F06 remove_follower', () => {
  it('ends access and the reservation in one step; the wish is free for Greta; Finn reads access_ended', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    const opts = { occasionIds: [s.o1, s.o2], listIds: [s.l1, s.l2], profileIds: [s.greta, s.moritz] }
    const paulaBefore = await ownerSnapshot(t, s.paula, opts)
    expect(await rpc(t, s.finn, 'reserve_wish', [w1])).toEqual({ ok: true })
    expect(await ownerSnapshot(t, s.paula, opts)).toEqual(paulaBefore) // INV-2 while Finn holds it
    const cooldownsBefore = await cooldownRows(t)

    expect(await rpcText(t, s.paula, 'remove_follower', [s.finn])).toBe('{"ok": true}')
    await checkInvariants(t, { cooldownsBefore })
    expect(await ended(s.finn)).toEqual([{ wish_id: w1, status: 'ended', end_reason: 'access_ended' }])
    // Finn: no REST row, no screen, no reservation, no card lists
    expect(await queryAs(t, s.finn, 'select id from wishlists where id = $1', [s.l1])).toEqual([])
    expect(await queryAs(t, s.finn, 'select id from wishes where wishlist_id = $1', [s.l1])).toEqual([])
    expect(await rpcOutcome(t, s.finn, 'get_list_screen', [s.l1])).toBe('error:P0001:not_found')
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [w1]), 'not_allowed')
    await expectRpcError(rpc(t, s.finn, 'cancel_reservation', [w1]), 'not_allowed')
    // 20261027200000: the giver sees the one neutral public reason, without the wish id or any context
    const mine = await rpc<MyReservation[]>(t, s.finn, 'my_reservations')
    expect(mine).toEqual([expect.objectContaining({ wish_id: null, wish_title: L1_WISH_TITLES.w1, status: 'ended', end_reason: 'unavailable', list: null })])
    // the wish is free for the other follower
    expect(await rpc(t, s.greta, 'reserve_wish', [w1])).toEqual({ ok: true })
    await checkInvariants(t)
  })

  it('Paula\'s answer and world are the same whether the removed follower had reservations or not', async () => {
    // two identical worlds: in A Finn reserved twice before the removal, in B he did not
    const a = await seedFollows(t)
    const b = await seedFollows(t)
    await rpc(t, a.finn, 'reserve_wish', [a.l1Wishes[0]])
    await rpc(t, a.finn, 'reserve_wish', [a.l1Wishes[1]])
    const answerA = await rpcText(t, a.paula, 'remove_follower', [a.finn])
    const answerB = await rpcText(t, b.paula, 'remove_follower', [b.finn])
    expect(answerA).toBe(answerB)
    // Paula's own screens of L1 in both worlds: identical up to the ids of the worlds
    const norm = (text: string, s: typeof a) => {
      let out = text
      const map: [string, string][] = [
        [s.paula, 'PAULA'], [s.finn, 'FINN'], [s.greta, 'GRETA'], [s.l1, 'L1'], [s.l2, 'L2'], [s.o1, 'O1'], [s.o2, 'O2'],
        [s.o1List, 'O1L'], [s.o2List, 'O2L'], [s.l1Wishes[0], 'W1'], [s.l1Wishes[1], 'W2'], [s.l1Wishes[2], 'W3'], [s.l2Wish, 'W4'], [s.o1Wish, 'W5'],
        [s.rosa, 'ROSA'], [s.moritz, 'MORITZ'], [s.bea, 'BEA'], [s.xaver, 'XAVER'],
      ]
      for (const [id, name] of map) out = out.split(id).join(name)
      return out.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?/g, 'T')
    }
    for (const [fn, args] of [['get_list_screen', (s: typeof a) => [s.l1]], ['get_lists_overview', () => []], ['get_people_screen', () => []], ['get_me', () => []]] as const) {
      expect(norm(await rpcText(t, a.paula, fn, args(a)), a), fn).toBe(norm(await rpcText(t, b.paula, fn, args(b)), b))
    }
    await checkInvariants(t)
  })

  it('his new requests stay hidden for 30 days, also after block -> unblock; after a new accept nothing comes back', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    await rpc(t, s.finn, 'reserve_wish', [w1])
    await rpc(t, s.paula, 'remove_follower', [s.finn])
    // (30 days of silence: the cleanup has long ended the dead row — before it runs, a regained access would find
    // the row alive again, Q20; that case: shared-wishes-lifecycle.test.ts)
    await runCleanupPass(t)
    const silence = await cooldownRows(t)
    // Finn shares O2 with Paula and asks again: stored, but Paula does not see it
    expect(await rpc(t, s.finn, 'request_follow', [s.paula])).toEqual({ status: 'requested' })
    expect((await rpc<{ inbox: { follow_requests: number } }>(t, s.paula, 'get_me')).inbox.follow_requests).toBe(1) // Rosa only
    await rpc(t, s.finn, 'block_user', [s.paula])
    await rpc(t, s.finn, 'unblock_user', [s.paula])
    expect(await cooldownRows(t)).toEqual(silence)
    expect(await rpc(t, s.finn, 'request_follow', [s.paula])).toEqual({ status: 'requested' })
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.finn, true]), 'not_found')
    // the silence ends (superuser moves it), Paula accepts: L1 visible again, but the reservation stays ended
    await t.asService((tx) => tx.query(`update follow_cooldowns set until = now() - interval '1 second' where followee_id = $1 and follower_id = $2`, [s.paula, s.finn]))
    const movedSilence = await cooldownRows(t) // the superuser's change is the new "before" of INV-6
    expect(await rpc(t, s.paula, 'respond_follow', [s.finn, true])).toEqual({ ok: true })
    expect(await followRows(t, 'follower_id = $1 and followee_id = $2', [s.finn, s.paula])).toEqual([{ follower_id: s.finn, followee_id: s.paula, status: 'accepted' }])
    const screen = await rpc<{ wishes: { id: string; reserved: boolean; reserved_by_me: boolean }[] }>(t, s.finn, 'get_list_screen', [s.l1])
    expect(screen.wishes.find((w) => w.id === w1)).toMatchObject({ reserved: false, reserved_by_me: false })
    expect(await ended(s.finn)).toEqual([{ wish_id: w1, status: 'ended', end_reason: 'access_ended' }])
    await checkInvariants(t, { cooldownsBefore: movedSilence })
  })

  it('unfollow (his own decision): his reservations end as unfollowed; a pending withdraw ends nothing', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite])
    await rpc(t, s.finn, 'reserve_wish', [s.o1Wish]) // the occasion list is not part of the follow
    expect(await rpc(t, s.finn, 'unfollow', [s.paula])).toEqual({ ok: true })
    expect(await rows(t.db, `select wish_id, status, end_reason from reservations where reserver_id = $1 order by created_at`, [s.finn])).toEqual([
      { wish_id: s.l1Wishes[0], status: 'ended', end_reason: 'unfollowed' },
      { wish_id: s.o1Wish, status: 'active', end_reason: null },
    ])
    expect(await rpc(t, s.rosa, 'unfollow', [s.paula])).toEqual({ ok: true }) // withdraw: no reservations to end
    await checkInvariants(t)
  })
})
