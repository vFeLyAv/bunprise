/**
 * F10 — set_list_visibility (follows-design §2.7, §5.3, §5.5, INV-1, A9, P10, S9; M3 20261020200200_follow_sharing.sql):
 *   followers -> private ends the reservations of Finn AND Greta (access_ended); Paula gets {ok:true} byte for byte
 *   the same with and without reservations; back to followers restores nothing; somebody else's list, an occasion's
 *   list, an unknown id, null -> not_found (one answer); a bad value -> validation (before anything else); REST
 *   `update visibility` -> 42501 even for Paula; widening needs the current legal records (consent_required) and a
 *   name (profile_incomplete); narrowing ("Nur ich") never does; followers read L1 exactly while it is 'followers'.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type TestDb } from '../../src/harness'
import { expectRpcError, queryAs, rpc } from '../pilot/seed'
import { UNKNOWN_ID, createList, rpcOutcome, rpcText, seedFollows } from '../follows/seed'
import { checkInvariants, cooldownRows, ownerSnapshot, runCleanupPass } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const endedOn = (listId: string) =>
  rows<{ reserver_id: string; status: string; end_reason: string | null }>(
    t.db,
    `select reserver_id, status, end_reason from reservations where wishlist_id = $1 order by created_at`,
    [listId],
  )

describe('F10 set_list_visibility', () => {
  it('-> private ends every reservation of the list (access_ended); {ok:true} the same with and without them', async () => {
    const s = await seedFollows(t)
    const [w1, w2] = s.l1Wishes
    await rpc(t, s.finn, 'reserve_wish', [w1])
    await rpc(t, s.greta, 'reserve_wish', [w2])
    const empty = await createList(t, s.paula, 'Leer', { visibility: 'followers' }) // a follower list without reservations
    const cooldownsBefore = await cooldownRows(t)
    const withReservations = await rpcText(t, s.paula, 'set_list_visibility', [s.l1, 'private'])
    const without = await rpcText(t, s.paula, 'set_list_visibility', [empty, 'private'])
    expect(withReservations).toBe('{"ok": true}')
    expect(without).toBe(withReservations)
    await checkInvariants(t, { cooldownsBefore })
    expect(await endedOn(s.l1)).toEqual([
      { reserver_id: s.finn, status: 'ended', end_reason: 'access_ended' },
      { reserver_id: s.greta, status: 'ended', end_reason: 'access_ended' },
    ])
    // the followers lose the list at once: REST, screen, card, overview
    for (const uid of [s.finn, s.greta]) {
      expect(await queryAs(t, uid, 'select id from wishlists where id = $1', [s.l1])).toEqual([])
      expect(await queryAs(t, uid, 'select id from wishes where wishlist_id = $1', [s.l1])).toEqual([])
      expect(await rpcOutcome(t, uid, 'get_list_screen', [s.l1])).toBe('error:P0001:not_found')
      expect((await rpc<{ lists: unknown[] }>(t, uid, 'get_profile_card', [s.paula])).lists).toEqual([])
      expect(await rpcOutcome(t, uid, 'get_lists_overview')).not.toContain(s.l1)
      await expectRpcError(rpc(t, uid, 'reserve_wish', [w1]), 'not_allowed')
    }
  })

  // 20261027200000 (lazy liveness, Q20 default): "restores nothing" once the cleanup has ended the dead rows (every
  // minute); switching back before that finds them alive again — shared-wishes-lifecycle.test.ts
  it('back to followers after the cleanup restores nothing: the reservations stay ended, the wishes are free', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    await rpc(t, s.finn, 'reserve_wish', [w1])
    await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])
    await runCleanupPass(t)
    expect(await rpcText(t, s.paula, 'set_list_visibility', [s.l1, 'followers'])).toBe('{"ok": true}')
    expect(await endedOn(s.l1)).toEqual([{ reserver_id: s.finn, status: 'ended', end_reason: 'access_ended' }])
    const screen = await rpc<{ wishes: { id: string; reserved: boolean; reserved_by_me: boolean }[] }>(t, s.finn, 'get_list_screen', [s.l1])
    expect(screen.wishes.find((w) => w.id === w1)).toMatchObject({ reserved: false, reserved_by_me: false })
    // the same setting twice: still {ok:true}, nothing else happens
    expect(await rpcText(t, s.paula, 'set_list_visibility', [s.l1, 'followers'])).toBe('{"ok": true}')
    expect(await rpc(t, s.greta, 'reserve_wish', [w1])).toEqual({ ok: true })
    await checkInvariants(t)
  })

  it('Paula\'s own view of the list does not depend on the reservations a switch ended', async () => {
    const a = await seedFollows(t)
    const opts = { occasionIds: [a.o1], listIds: [a.l1, a.l2], profileIds: [a.finn] }
    await rpc(t, a.finn, 'reserve_wish', [a.l1Wishes[0]])
    const before = await ownerSnapshot(t, a.paula, opts)
    await rpc(t, a.finn, 'cancel_reservation', [a.l1Wishes[0]])
    expect(await ownerSnapshot(t, a.paula, opts)).toEqual(before)
    await rpc(t, a.finn, 'reserve_wish', [a.l1Wishes[0]])
    expect(await ownerSnapshot(t, a.paula, opts)).toEqual(before)
  })

  it('not_found for somebody else\'s list, an occasion\'s list, an unknown id and null; validation for a bad value first', async () => {
    const s = await seedFollows(t)
    const answers = new Set<string>()
    for (const [uid, list] of [
      [s.finn, s.l1], // a follower
      [s.greta, s.l2],
      [s.xaver, s.l1],
      [s.paula, s.o1List], // her own occasion's list: its audience is the occasion
      [s.moritz, s.o2List],
      [s.paula, UNKNOWN_ID],
      [s.paula, null],
    ] as const) {
      for (const vis of ['private', 'followers']) {
        answers.add(await rpcOutcome(t, uid, 'set_list_visibility', [list, vis]))
      }
    }
    expect([...answers]).toEqual(['error:P0001:not_found'])
    for (const bad of ['occasion', 'public', 'Followers', '', ' private', null]) {
      for (const [uid, list] of [[s.paula, s.l1], [s.xaver, s.l1], [s.paula, UNKNOWN_ID]] as const) {
        expect(await rpcOutcome(t, uid, 'set_list_visibility', [list, bad]), `${bad}`).toBe('error:P0001:validation')
      }
    }
    expect(await rows(t.db, 'select visibility from wishlists where id in ($1, $2) order by visibility', [s.l1, s.l2])).toEqual([
      { visibility: 'followers' },
      { visibility: 'private' },
    ])
    await expectDbError(t.asAnon((tx) => tx.query('select public.set_list_visibility($1, $2)', [s.l1, 'private'])), '42501')
  })

  it('REST never changes the visibility — not even for the owner', async () => {
    const s = await seedFollows(t)
    for (const vis of ['private', 'followers', 'occasion']) {
      await expectDbError(t.asUser(s.paula, (tx) => tx.query('update wishlists set visibility = $2 where id = $1', [s.l1, vis])), '42501')
      await expectDbError(t.asUser(s.finn, (tx) => tx.query('update wishlists set visibility = $2 where id = $1', [s.l1, vis])), '42501')
    }
    expect(await rows(t.db, 'select visibility from wishlists where id = $1', [s.l1])).toEqual([{ visibility: 'followers' }])
  })

  it('widening needs the legal records and a name; narrowing needs nothing (after a version bump too)', async () => {
    const s = await seedFollows(t)
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'privacy_notice'`, [s.paula]))
    await expectRpcError(rpc(t, s.paula, 'set_list_visibility', [s.l2, 'followers']), 'consent_required')
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])).toEqual({ ok: true })
    await t.asUser(s.paula, (tx) =>
      tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions where kind = 'privacy_notice'`, [s.paula]),
    )
    await t.asService((tx) => tx.query('update profiles set display_name = null where id = $1', [s.paula]))
    await expectRpcError(rpc(t, s.paula, 'set_list_visibility', [s.l1, 'followers']), 'profile_incomplete')
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])).toEqual({ ok: true })
    await t.asService((tx) => tx.query(`update profiles set display_name = 'Paula' where id = $1`, [s.paula]))
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'followers'])).toEqual({ ok: true })
    // what M5 would do (new legal versions): "Nur ich" and deleting a follower list still work
    await t.asService((tx) => tx.query(`update legal_versions set version = 'terms-2099-01-test' where kind = 'terms'`))
    try {
      await expectRpcError(rpc(t, s.paula, 'set_list_visibility', [s.l2, 'followers']), 'consent_required')
      expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])).toEqual({ ok: true })
      // a REST insert of a follower list needs the current records as well (policy wishlists_insert)
      await expectDbError(createList(t, s.paula, 'Neu', { visibility: 'followers' }), '42501')
    } finally {
      await t.asService((tx) => tx.query(`update legal_versions set version = 'terms-2026-10-pilot-5' where kind = 'terms'`))
    }
    await checkInvariants(t)
  })
})
