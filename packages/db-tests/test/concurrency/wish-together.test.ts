/**
 * "Passt zusammen" under concurrency, on real PostgreSQL 17 (docs/decisions/0002-concurrency-tests-real-postgres.md;
 * supabase/migrations/20261030120000_wish_quantity_together.sql). The pilot world (./world.ts): host Anna, w1 + w2 in
 * her occasion's list, LINKED (w1 <-> w2); guests Ben (b) and Cem (c).
 *   WT-A  reserve_together (Ben: w1 + w2) ↔ reserve_wish (Cem: w2)        whoever holds the pair lock first wins; the
 *         joint reservation is ALL OR NOTHING (Cem first → Ben gets already_reserved and holds neither wish)
 *   WT-B  reserve_together (Ben) ↔ reserve_together (Cem)                   exactly one holds both, the other nothing
 *   WT-C  reserve_together (Ben) ↔ REST delete of w2 (Anna)                 delete first → not_found, nothing reserved;
 *         Ben first → the delete waits, then w2 is gone (Ben keeps w1; his w2 row is dead, the cleanup ends it)
 *   WT-D  reserve_together (Ben) ↔ set_wish_links (Anna unlinks w1)         unlink first → validation, nothing reserved;
 *         Ben first → the unlink waits and succeeds; Ben keeps both
 *   WT-R  unsynchronised races of every pair above (both start orders, staggered): never a deadlock or a raw error,
 *         only contract codes, and never "Ben holds exactly one of the two" after a failed joint call.
 * Every waiting side queues on the same row: the owner's profile (the pair lock / the owner's profile lock).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type Outcome, type RealPg, type Session } from '../../src/realpg'
import { OK, expectContractOutcome, holdThenRun, race, restOp, rpcError, rpcOp, type Op } from './pairs'
import { activeReserversOf, rpcAs, seedWorld, type World } from './world'

const ROUNDS = 8

let db: RealPg
let s1: Session
let s2: Session

beforeAll(async () => {
  db = await startRealPg()
  s1 = await db.session('tx-1')
  s2 = await db.session('tx-2')
  await db.admin.query('update private.features set wish_together = true, wish_quantity = true')
})
afterAll(async () => {
  await db?.close()
})

async function linkedWorld(): Promise<World> {
  const w = await seedWorld(db)
  expect(await rpcAs(db, w.host, 'set_wish_links', [w.w1, [w.w2]])).toEqual({ ok: true, linked: 1 })
  return w
}

const BOTH = (who: 'b' | 'c') => rpcOp(`reserve_together (${who})`, 'reserve_together', (w) => w[who], (w) => [w.w1, [w.w2]])
const SINGLE_W2_C = rpcOp('reserve_wish w2 (c)', 'reserve_wish', (w) => w.c, (w) => [w.w2])
const DELETE_W2 = restOp('REST delete w2 (host)', 'delete from public.wishes where id = $1', (w) => w.host, (w) => [w.w2])
const UNLINK = rpcOp('set_wish_links w1 → [] (host)', 'set_wish_links', (w) => w.host, (w) => [w.w1, []])
const TOGETHER_OK = { ok: true, value: { ok: true, reserved: 2 } }
const UNLINK_OK = { ok: true, value: { ok: true, linked: 0 } }

/** Ben holds both or neither — never one of a failed joint call. */
async function bothOrNeither(w: World, joint: Outcome): Promise<void> {
  const b1 = (await activeReserversOf(db, w.w1)).includes(w.b)
  const b2 = (await activeReserversOf(db, w.w2)).includes(w.b)
  if (joint.ok) expect(b1).toBe(true)
  else expect([b1, b2]).toEqual([false, false])
}

describe('WT-A reserve_together ↔ reserve_wish on the partner', () => {
  it('Ben first: Cem waits on the owner profile, then already_reserved; Ben holds both', async () => {
    const w = await linkedWorld()
    const r = await holdThenRun(db, s1, s2, w, BOTH('b'), SINGLE_W2_C)
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual(TOGETHER_OK)
    expect(r.second).toEqual(rpcError('already_reserved'))
    expect(await activeReserversOf(db, w.w1)).toEqual([w.b])
    expect(await activeReserversOf(db, w.w2)).toEqual([w.b])
  })

  it('Cem first: Ben waits, then already_reserved — and holds NEITHER wish (all or nothing)', async () => {
    const w = await linkedWorld()
    const r = await holdThenRun(db, s1, s2, w, SINGLE_W2_C, BOTH('b'))
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual(OK)
    expect(r.second).toEqual(rpcError('already_reserved'))
    expect(await activeReserversOf(db, w.w1)).toEqual([])
    expect(await activeReserversOf(db, w.w2)).toEqual([w.c])
  })
})

describe('WT-B reserve_together ↔ reserve_together', () => {
  it('exactly one holds both, the other nothing', async () => {
    const w = await linkedWorld()
    const r = await holdThenRun(db, s1, s2, w, BOTH('b'), BOTH('c'))
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual(TOGETHER_OK)
    expect(r.second).toEqual(rpcError('already_reserved'))
    expect(await activeReserversOf(db, w.w1)).toEqual([w.b])
    expect(await activeReserversOf(db, w.w2)).toEqual([w.b])
  })
})

describe('WT-C reserve_together ↔ deleting the partner', () => {
  it('delete first: Ben waits on the owner profile, then not_found; nothing reserved', async () => {
    const w = await linkedWorld()
    const r = await holdThenRun(db, s1, s2, w, DELETE_W2, BOTH('b'))
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual({ ok: true, value: 1 })
    expect(r.second).toEqual(rpcError('not_found'))
    expect(await activeReserversOf(db, w.w1)).toEqual([])
  })

  it('Ben first: the delete waits, then succeeds; Ben keeps w1 (w2 is gone)', async () => {
    const w = await linkedWorld()
    const r = await holdThenRun(db, s1, s2, w, BOTH('b'), DELETE_W2)
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual(TOGETHER_OK)
    expect(r.second).toEqual({ ok: true, value: 1 })
    expect(await activeReserversOf(db, w.w1)).toEqual([w.b])
    expect(await db.admin.value<number>('select count(*)::int from private.wish_links where wish_a = $1 or wish_b = $1', [w.w1])).toBe(0)
  })
})

describe('WT-D reserve_together ↔ the owner unlinking', () => {
  it('unlink first: Ben waits, then validation; nothing reserved', async () => {
    const w = await linkedWorld()
    const r = await holdThenRun(db, s1, s2, w, UNLINK, BOTH('b'))
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual(UNLINK_OK)
    expect(r.second).toEqual(rpcError('validation'))
    expect(await activeReserversOf(db, w.w1)).toEqual([])
    expect(await activeReserversOf(db, w.w2)).toEqual([])
  })

  it('Ben first: the unlink waits and succeeds; Ben keeps both', async () => {
    const w = await linkedWorld()
    const r = await holdThenRun(db, s1, s2, w, BOTH('b'), UNLINK)
    expect(r.block.rowLockOn).toBe('profiles')
    expect(r.first).toEqual(TOGETHER_OK)
    expect(r.second).toEqual(UNLINK_OK)
    expect(await activeReserversOf(db, w.w1)).toEqual([w.b])
    expect(await activeReserversOf(db, w.w2)).toEqual([w.b])
  })
})

describe('WT-R unsynchronised races (no barrier): only contract codes, never a deadlock, all or nothing', () => {
  const pairs: [string, Op][] = [
    ['reserve_wish w2 (c)', SINGLE_W2_C],
    ['reserve_together (c)', BOTH('c')],
    ['REST delete w2', DELETE_W2],
    ['unlink', UNLINK],
  ]
  for (const [name, other] of pairs) {
    it(`reserve_together (b) ↔ ${name}, ${ROUNDS} rounds`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const w = await linkedWorld()
        const { x, y } = await race([s1, s2], w, BOTH('b'), other, round % 2 === 0, round % 4)
        expectContractOutcome(`reserve_together round ${round}`, x)
        expectContractOutcome(`${name} round ${round}`, y)
        await bothOrNeither(w, x)
        // the two joint calls: never both
        if (name === 'reserve_together (c)') expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1)
      }
    })
  }
})
