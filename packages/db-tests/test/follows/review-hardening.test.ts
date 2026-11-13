/** J4 regressions: name gates, a vanished accepted request, and safe live joins for historical reservations. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../src/harness'
import { execAs, expectRpcError, rpc } from '../pilot/seed'
import { seedFollows } from './seed'

let t: TestDb
beforeAll(async () => { t = await createTestDb() })
afterAll(() => t.close())

describe('widening needs a name, narrowing remains available', () => {
  it('accepting an incoming follow requires a complete profile, refusing still works', async () => {
    const s = await seedFollows(t)
    await execAs(t, s.paula, 'update profiles set display_name = null where id = $1', [s.paula])
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, true]), 'profile_incomplete')
    expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, false])).toEqual({ ok: true })
  })
  it('both reservation paths require a name; an existing reservation can still be cancelled', async () => {
    const s = await seedFollows(t)
    for (const [giver, wish] of [[s.finn, s.l1Wishes[0]], [s.moritz, s.o1Wish]]) {
      await rpc(t, giver!, 'reserve_wish', [wish])
      await execAs(t, giver!, 'update profiles set display_name = null where id = $1', [giver])
      await expectRpcError(rpc(t, giver!, 'reserve_wish', [wish]), 'profile_incomplete')
      expect(await rpc(t, giver!, 'cancel_reservation', [wish])).toEqual({ ok: true })
    }
  })
})

it('a stale reservation cannot join a reused wish id to a different private list', async () => {
  const s = await seedFollows(t)
  // Fixture of the corrupt row the pre-fix UUID-reuse race could create; the writer API cannot insert this row.
  await t.asService((tx) => tx.query(`insert into reservations
    (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot, status, end_reason, ended_at)
    values ($1, $2, $3, $4, 'Safe saved title', 'ended', 'access_ended', now())`, [s.l2Wish, s.l1, s.paula, s.finn]))
  const mine = await rpc<{ wish_title: string }[]>(t, s.finn, 'my_reservations')
  const exported = await rpc<{ reservations_made_by_me: { wish_title: string }[] }>(t, s.finn, 'export_my_data')
  expect(mine.map((r) => r.wish_title)).toEqual(['Safe saved title'])
  expect(exported.reservations_made_by_me.map((r) => r.wish_title)).toEqual(['Safe saved title'])
})

it('a stale reservation cannot join a reused list id belonging to a different recipient', async () => {
  const s = await seedFollows(t)
  await t.asService((tx) => tx.query(`insert into reservations
    (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot, status, end_reason, ended_at)
    values ($1, $2, $3, $4, 'Old recipient snapshot', 'ended', 'access_ended', now())`, [s.l1Wishes[0], s.l1, s.xaver, s.finn]))
  const mine = await rpc<{ wish_title: string; list: unknown }[]>(t, s.finn, 'my_reservations')
  const exported = await rpc<{ reservations_made_by_me: { wish_title: string; list: unknown; recipient_name: unknown }[] }>(t, s.finn, 'export_my_data')
  expect(mine).toEqual([expect.objectContaining({ wish_title: 'Old recipient snapshot', list: null })])
  expect(exported.reservations_made_by_me).toEqual([expect.objectContaining({ wish_title: 'Old recipient snapshot', list: null, recipient_name: null })])
})
