/**
 * reserve_wish against everything that can end or forbid the reservation at the same moment, on real
 * PostgreSQL (docs/decisions/0002-concurrency-tests-real-postgres.md). Each pair in both orders: the first
 * operation holds its locks in an open transaction, the second must wait for it (pg_blocking_pids), then the
 * first commits and the second's answer and the final state are checked. Pairs + expected outcomes: ./pairs.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type RealPg, type Session } from '../../src/realpg'
import { OK, RESERVATION_PAIRS, holdTests, holdThenRun, rpcError, rpcOp } from './pairs'
import { activeReserversOf, reservationsBy, seedWorld } from './world'

let db: RealPg
let s1: Session
let s2: Session
let s3: Session

beforeAll(async () => {
  db = await startRealPg()
  s1 = await db.session('tx-1')
  s2 = await db.session('tx-2')
  s3 = await db.session('tx-3')
})
afterAll(async () => {
  await db?.close()
})

holdTests(RESERVATION_PAIRS, () => ({ db, s1, s2 }))

describe('reserve_wish ↔ reserve_wish when the first transaction rolls back', () => {
  it('the waiting member gets the wish: a reservation that never committed blocks nobody', async () => {
    const w = await seedWorld(db)
    const ben = rpcOp('reserve_wish (Ben)', 'reserve_wish', (x) => x.b, (x) => [x.w1])
    const cem = rpcOp('reserve_wish (Cem)', 'reserve_wish', (x) => x.c, (x) => [x.w1])
    const r = await holdThenRun(db, s1, s2, w, ben, cem, 'rollback')
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual(OK)
    expect(r.second).toEqual(OK)
    expect(await activeReserversOf(db, w.w1)).toEqual([w.c])
  })
})

describe('reserve_wish ↔ wishlist delete with a third transaction on the wish (lock order)', () => {
  // The cascading delete locks the list, then the wish. A third transaction holding a share lock on the wish
  // pauses the delete exactly between the two. Before 20261020120000_concurrency_fix.sql the reservation's
  // foreign-key checks took the wish first (share locks are compatible) and then waited for the list: a
  // deadlock (40P01) as soon as the third transaction ended. Now reserve_wish locks the list first, so it
  // simply queues behind the delete. M3's statement-level delete trigger now serializes both even earlier on the
  // owner's profile, preserving the same not_found result while preventing bulk-delete/access-revocation cycles.
  it('no deadlock: reserve_wish waits behind the delete for the owner profile and answers not_found', async () => {
    const w = await seedWorld(db)
    await s3.begin()
    await s3.query('select id from public.wishes where id = $1 for key share', [w.w1])

    await s1.begin(w.host)
    const deleting = settle(s1.query('delete from public.wishlists where id = $1', [w.wishlistId]))
    expect((await db.waitUntilBlocked(s1, s3, deleting)).rowLockOn).toBe('wishes')

    await s2.begin(w.b)
    const reserving = settle(s2.rpc('reserve_wish', [w.w1]))
    expect((await db.waitUntilBlocked(s2, s1, reserving)).rowLockOn).toBe('profiles')

    await s3.commit()
    const deleted = await deleting
    await (deleted.ok ? s1.commit() : s1.rollback())
    const reserved = await reserving
    await (reserved.ok ? s2.commit() : s2.rollback())

    expect(deleted).toMatchObject({ ok: true, value: { rowCount: 1 } })
    expect(reserved).toEqual(rpcError('not_found'))
    expect(await reservationsBy(db, w.b)).toEqual([])
  })
})
