/**
 * F09 — the reservation matrix of a follower list (follows-design §4.2 row reserve_wish / cancel_reservation, §5.5,
 * S7; M3 20261020200200_follow_sharing.sql):
 *   the SAME not_allowed (code and text) for the owner Paula, Rosa waiting, Rosa refused, the removed Finn, Moritz
 *   (guest of O1, no follower), Bea (blocked), Xaver — on L1 — and for Greta on L2 ("Nur ich") — with the wish free
 *   or taken; Greta on L1 -> ok, again -> ok (idempotent); Finn on the same wish -> already_reserved; cancelling
 *   without an own reservation -> not_found whether the wish is taken or free; a deleted wish -> not_found (the
 *   random UUID's answer); a malformed UUID -> 22P02 for everybody, before any logic.
 * The owner is refused in step 1, before anything about the audience or reservations is read (the order of checks).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, scalar, type DbError, type TestDb } from '../../src/harness'
import { countAll, createMember, execAs, rpc } from '../pilot/seed'
import { UNKNOWN_ID, seedFollows, type FollowSeed } from '../follows/seed'
import { checkInvariants, cooldownRows } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

async function failure(uid: string, fn: string, args: readonly unknown[]): Promise<DbError> {
  return expectDbError(rpc(t, uid, fn, args), 'P0001')
}
const signature = (e: DbError) => JSON.stringify({ code: e.code, message: e.message })

describe('F09 reserve_wish / cancel_reservation on the lists of Paula', () => {
  let s: FollowSeed
  let ida: string
  beforeAll(async () => {
    s = await seedFollows(t)
    ida = await createMember(t, 'Ida') // "Rosa refused": asks via the link, Paula refuses silently
    await rpc(t, ida, 'request_follow_via_link', [s.token])
    await rpc(t, s.paula, 'respond_follow', [ida, false])
  })

  it('Greta on L1: ok, again ok (one row); Finn on the same wish: already_reserved', async () => {
    const [w1] = s.l1Wishes
    const cooldownsBefore = await cooldownRows(t)
    expect(await rpc(t, s.greta, 'reserve_wish', [w1])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'reserve_wish', [w1])).toEqual({ ok: true })
    expect(await countAll(t, 'reservations', 'wish_id = $1', [w1])).toBe(1)
    expect((await failure(s.finn, 'reserve_wish', [w1])).message).toBe('already_reserved')
    expect(await scalar<string>(t.db, `select reserver_id from reservations where wish_id = $1 and status = 'active'`, [w1])).toBe(s.greta)
    await checkInvariants(t, { cooldownsBefore })
  })

  it('cancel without an own reservation: not_found, the same for a taken and a free wish', async () => {
    const [w1, w2] = s.l1Wishes
    const taken = await failure(s.finn, 'cancel_reservation', [w1]) // Greta holds it
    const free = await failure(s.finn, 'cancel_reservation', [w2])
    expect([taken.message, free.message]).toEqual(['not_found', 'not_found'])
    expect(signature(taken)).toBe(signature(free))
    expect(await countAll(t, 'reservations', `wish_id = $1 and status = 'active'`, [w1])).toBe(1)
  })

  it('everybody without access — and the owner — gets ONE not_allowed, with the wish taken or free', async () => {
    const [w1, w2] = s.l1Wishes // w1 taken by Greta, w2 free
    // the removed Finn (now in Paula's silence)
    expect(await rpc(t, s.paula, 'remove_follower', [s.finn])).toEqual({ ok: true })
    const refused: [string, string][] = []
    for (const uid of [s.paula, s.rosa, ida, s.finn, s.moritz, s.bea, s.xaver]) {
      for (const wish of [w1, w2]) refused.push([uid, wish])
    }
    // Greta (an accepted follower) on L2 = "Nur ich"; Paula on her own L2 and on her occasion's list as well
    refused.push([s.greta, s.l2Wish], [s.paula, s.l2Wish], [s.paula, s.o1Wish], [s.xaver, s.l2Wish], [s.moritz, s.l2Wish])
    const signatures = new Set<string>()
    for (const [uid, wish] of refused) {
      for (const fn of ['reserve_wish', 'cancel_reservation']) {
        const e = await failure(uid, fn, [wish])
        expect(e.message, `${fn} ${uid} ${wish}`).toBe('not_allowed')
        signatures.add(signature(e))
      }
    }
    expect([...signatures]).toEqual([JSON.stringify({ code: 'P0001', message: 'not_allowed' })])
    // nothing was written: Greta's reservation is the only active one on Paula's lists
    expect(await countAll(t, 'reservations', `recipient_id = $1 and status = 'active'`, [s.paula])).toBe(1)
    expect(await countAll(t, 'reservations', `reserver_id <> $1`, [s.greta])).toBe(0)
    await checkInvariants(t)
  })

  it('the guest Moritz still reserves on the occasion list O1 (the pilot path is untouched)', async () => {
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true })
    expect(await rpc(t, s.moritz, 'cancel_reservation', [s.o1Wish])).toEqual({ ok: true })
    // Greta is no guest of O1: not_allowed like everybody else without access
    expect((await failure(s.greta, 'reserve_wish', [s.o1Wish])).message).toBe('not_allowed')
  })

  it('a deleted wish and an unknown id: not_found for everybody (the owner too); a malformed UUID: 22P02 for everybody', async () => {
    const [, , w3] = s.l1Wishes
    expect(await execAs(t, s.paula, 'delete from wishes where id = $1', [w3])).toBe(1)
    for (const uid of [s.paula, s.greta, s.rosa, s.xaver, s.bea]) {
      for (const fn of ['reserve_wish', 'cancel_reservation']) {
        for (const wish of [w3, UNKNOWN_ID, null]) {
          expect((await failure(uid, fn, [wish])).message, `${fn} ${uid} ${wish}`).toBe('not_found')
        }
      }
    }
    const messages = new Set<string>()
    for (const uid of [s.paula, s.greta, s.finn, s.rosa, s.moritz, s.bea, s.xaver]) {
      for (const fn of ['reserve_wish', 'cancel_reservation', 'get_list_screen', 'get_free_wishes']) {
        messages.add((await expectDbError(rpc(t, uid, fn, ['nicht-uuid']), '22P02')).message)
      }
      messages.add((await expectDbError(rpc(t, uid, 'set_list_visibility', ['nicht-uuid', 'private']), '22P02')).message)
    }
    expect(messages.size).toBe(1)
  })

  it('anon cannot call either RPC at all', async () => {
    for (const fn of ['reserve_wish', 'cancel_reservation']) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(`select public.${fn}($1)`, [s.l1Wishes[0]])), '42501')
      expect(err.message).toMatch(/permission denied for function/)
    }
  })
})

describe('F09 the order of the checks: the owner before anything else', () => {
  it('without current legal records the owner still gets consent_required first — like everybody (step 0), then not_allowed', async () => {
    const s = await seedFollows(t)
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'terms'`, [s.greta]))
    expect((await failure(s.greta, 'reserve_wish', [s.l1Wishes[0]])).message).toBe('consent_required')
    // cancelling (narrowing) needs no legal records: Greta keeps the way out of her reservation
    await t.asUser(s.greta, (tx) =>
      tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions where kind = 'terms'`, [s.greta]),
    )
    expect(await rpc(t, s.greta, 'reserve_wish', [s.l1Wishes[0]])).toEqual({ ok: true })
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'terms'`, [s.greta]))
    expect(await rpc(t, s.greta, 'cancel_reservation', [s.l1Wishes[0]])).toEqual({ ok: true })
    // the owner's answer does not depend on the state of the wish (taken by someone or not): step 1
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'terms'`, [s.paula]))
    expect((await failure(s.paula, 'reserve_wish', [s.l1Wishes[0]])).message).toBe('consent_required')
    await checkInvariants(t)
  })
})
