/**
 * F07 — blocking, the reservation parts (follows-design §5.4 block_user, INV-1, INV-5, A3, P14; M3 follower lists):
 *   Paula blocks Finn (who reserved on L1): his reservation ends as access_ended — byte for byte what a removed
 *   follower (Greta) sees, except the wish and the times: list null, the title snapshot, no recipient name in the
 *   export; occasion lists keep the pilot's member_removed. Finn blocks Paula: his own action -> 'blocked'.
 *   Afterwards nothing of L1 is readable for the blocked side, reserve / cancel are not_allowed, and the follows of
 *   the pair are gone in both directions (INV-5).
 * Since 20261027200000 (shared wishes, LAZY liveness): block_user never touches reservations. Both sides' reservations
 *   are dead at once (a block closes reading); the giver sees ONE neutral reason, 'unavailable', without context —
 *   whoever blocked — and the cleanup ends the rows as 'access_ended' (checkInvariants runs it).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, type TestDb } from '../../src/harness'
import { expectRpcError, queryAs, rpc } from '../pilot/seed'
import { followRows, rpcOutcome, seedFollows } from './seed'
import { checkInvariants, cooldownRows } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const TIME_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?/g

describe('F07 blocking ends the reservations between the two', () => {
  it('blocked by the owner reads exactly like removed by the owner: unavailable, list null, snapshot, no name', async () => {
    const s = await seedFollows(t)
    const [w1, w2] = s.l1Wishes
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite])
    expect(await rpc(t, s.finn, 'reserve_wish', [w1])).toEqual({ ok: true })
    expect(await rpc(t, s.finn, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'reserve_wish', [w2])).toEqual({ ok: true })
    // Paula renames both wishes AFTER the reservations: the giver without access keeps only the snapshot
    await t.asUser(s.paula, (tx) => tx.query(`update wishes set title = title || ' (neu)' where id in ($1, $2)`, [w1, w2]))
    const cooldownsBefore = await cooldownRows(t)

    expect(await rpc(t, s.paula, 'block_user', [s.finn])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'remove_follower', [s.greta])).toEqual({ ok: true })
    await checkInvariants(t, { cooldownsBefore })
    expect(await followRows(t, '(follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)', [s.paula, s.finn])).toEqual([])
    // (the cleanup inside checkInvariants ended them: one internal reason for both lists)
    expect(await rows(t.db, `select wish_id, end_reason from reservations where reserver_id = $1 order by created_at`, [s.finn])).toEqual([
      { wish_id: w1, end_reason: 'access_ended' },
      { wish_id: s.o1Wish, end_reason: 'access_ended' },
    ])

    // byte for byte, except the title and the times: blocked Finn vs removed Greta
    const finnRow = (await rpc<Record<string, unknown>[]>(t, s.finn, 'my_reservations')).find((r) => r['wish_title'] === 'Kopfhörer')!
    const gretaRow = (await rpc<Record<string, unknown>[]>(t, s.greta, 'my_reservations')).find((r) => r['wish_title'] === 'Buch')!
    const neutral = (r: Record<string, unknown>) => JSON.stringify({ ...r, wish_id: 'W', wish_title: 'T', created_at: 'C' })
    expect(neutral(finnRow)).toBe(neutral(gretaRow))
    expect(finnRow).toMatchObject({ wish_id: null, status: 'ended', end_reason: 'unavailable', list: null, occasion_id: null })
    expect([finnRow['wish_title'], gretaRow['wish_title']]).toEqual(['Kopfhörer', 'Buch']) // the snapshots, not "(neu)"
    const exportRow = async (uid: string, title: string) =>
      ((await rpc<{ reservations_made_by_me: Record<string, unknown>[] }>(t, uid, 'export_my_data')).reservations_made_by_me).find((r) => r['wish_title'] === title)!
    const finnExport = await exportRow(s.finn, 'Kopfhörer')
    const gretaExport = await exportRow(s.greta, 'Buch')
    const neutralExport = (r: Record<string, unknown>) => JSON.stringify({ ...r, wish_title: 'T', created_at: 'C', ended_at: 'E' })
    expect(neutralExport(finnExport)).toBe(neutralExport(gretaExport))
    expect(finnExport).toMatchObject({ recipient_name: null, occasion_title: null, list: null, end_reason: 'unavailable' })

    // nothing of L1 for Finn, and no way back into the reservation
    expect(await queryAs(t, s.finn, 'select id from wishlists where owner_id = $1', [s.paula])).toEqual([])
    expect(await rpcOutcome(t, s.finn, 'get_list_screen', [s.l1])).toBe('error:P0001:not_found')
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [w2]), 'not_allowed')
    await expectRpcError(rpc(t, s.finn, 'cancel_reservation', [w1]), 'not_allowed')
    // the screens of the two others: no trace of a reservation id, no reserver id anywhere
    for (const uid of [s.finn, s.greta]) {
      const text = await rpcOutcome(t, uid, 'my_reservations')
      for (const id of text.match(UUID_RE) ?? []) expect([w1, w2, s.o1Wish, s.o1], `${uid}: ${id}`).toContain(id)
      expect(text.replace(TIME_RE, 'T')).not.toContain(s.paula)
    }
  })

  it('the giver blocks the owner: his reservation is dead at once (unavailable), the cleanup ends it; the follows are gone (INV-5)', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    await rpc(t, s.finn, 'reserve_wish', [w1])
    const cooldownsBefore = await cooldownRows(t)
    expect(await rpc(t, s.finn, 'block_user', [s.paula])).toEqual({ ok: true })
    expect((await rpc<Record<string, unknown>[]>(t, s.finn, 'my_reservations')).map((r) => r['end_reason'])).toEqual(['unavailable'])
    await checkInvariants(t, { cooldownsBefore })
    expect(await rows(t.db, `select end_reason from reservations where reserver_id = $1`, [s.finn])).toEqual([{ end_reason: 'access_ended' }])
    expect(await followRows(t, 'follower_id = $1', [s.finn])).toEqual([])
    // unblocking restores nothing: no follow, no list, the wish free
    await rpc(t, s.finn, 'unblock_user', [s.paula])
    expect(await rpcOutcome(t, s.finn, 'get_list_screen', [s.l1])).toBe('error:P0001:not_found')
    expect(await rpc(t, s.greta, 'reserve_wish', [w1])).toEqual({ ok: true })
    await checkInvariants(t)
  })

  it('a block with somebody else (not the owner) changes nothing on Paula\'s lists', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    await rpc(t, s.finn, 'reserve_wish', [w1])
    await rpc(t, s.finn, 'block_user', [s.greta]) // two followers block each other
    expect(await rows(t.db, `select status from reservations where reserver_id = $1`, [s.finn])).toEqual([{ status: 'active' }])
    const greta = await rpc<{ wishes: { id: string; reserved: boolean }[] }>(t, s.greta, 'get_list_screen', [s.l1])
    expect(greta.wishes.find((w) => w.id === w1)!.reserved).toBe(true) // "taken" stays (no double gift), never who
    await checkInvariants(t)
  })
})
