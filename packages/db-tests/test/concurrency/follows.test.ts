/**
 * Follows, lists without an occasion and follower reservations under concurrency on real PostgreSQL 17
 * (docs/decisions/0002-concurrency-tests-real-postgres.md, docs/spec/follows-design.md §7.3). Every pair of
 * ./follow-pairs.ts in BOTH orders ("hold and wait"): the first operation holds its locks in an open transaction,
 * the second must wait for it (pg_blocking_pids, and on the row / table the pair names), then the first commits and
 * the second's answer and the final state are checked — plus INV-1, INV-5, INV-6 and the pilot rules after every run.
 * (A first call that is refused holds nothing — see holdFollow — so that order is the second call running after it.)
 * C01, C03, C04 (Paula) and C18 (Rosa): that person's answer and whole view are byte-identical in both orders.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type RealPg, type Session } from '../../src/realpg'
import {
  EXTRA_FOLLOW_PAIRS,
  FOLLOW_PAIRS,
  cooldownsBefore,
  expectContractAnswers,
  expectFollowInvariants,
  followView,
  holdFollow,
  normalize,
  seedForPair,
  type FollowPair,
} from './follow-pairs'

let db: RealPg
let s1: Session
let s2: Session

beforeAll(async () => {
  db = await startRealPg()
  s1 = await db.session('tx-1')
  s2 = await db.session('tx-2')
})
afterAll(async () => {
  await db?.close()
})

/** One deterministic run: `first` holds, the other waits; returns the world and both outcomes as { x, y }. */
async function runHeld(pair: FollowPair, first: 'x' | 'y') {
  const w = await seedForPair(db, pair)
  const before = await cooldownsBefore(db)
  try {
    const r = first === 'x' ? await holdFollow(db, s1, s2, w, pair.x, pair.y) : await holdFollow(db, s1, s2, w, pair.y, pair.x)
    const out = first === 'x' ? { x: r.first, y: r.second } : { x: r.second, y: r.first }
    expectContractAnswers(pair, out, `${first} holds`)
    expect(r.waitedOn, `${pair.id}: what the waiting side queued on — ${JSON.stringify(r.block)}`).toBe(pair.waitsOn[first === 'x' ? 0 : 1])
    await (first === 'x' ? pair.xFirst : pair.yFirst).check({ db, w, ...out, schedule: 'hold' })
    await expectFollowInvariants(db, before, `${pair.id}, ${first} first`)
    return { w, out }
  } finally {
    await pair.cleanup?.(db)
  }
}

for (const pair of [...FOLLOW_PAIRS, ...EXTRA_FOLLOW_PAIRS]) {
  describe(`${pair.id} ${pair.name}`, () => {
    it(`${pair.x.label} holds its locks → ${pair.y.label} waits on ${pair.waitsOn[0]} → ${pair.xFirst.says}`, async () => {
      await runHeld(pair, 'x')
    })
    it(`${pair.y.label} holds its locks → ${pair.x.label} waits on ${pair.waitsOn[1]} → ${pair.yFirst.says}`, async () => {
      await runHeld(pair, 'y')
    })
    const same = pair.sameInBothOrders
    if (same) {
      const op = same.side === 'x' ? pair.x : pair.y
      it(`the answer of ${op.label} and that person's whole view are byte-identical in both orders`, async () => {
        const a = await runHeld(pair, 'x')
        const viewA = await followView(db, a.w, same.viewer(a.w), same.extra?.(a.w))
        const b = await runHeld(pair, 'y')
        const viewB = await followView(db, b.w, same.viewer(b.w), same.extra?.(b.w))
        expect(normalize(JSON.stringify(a.out[same.side]), a.w)).toBe(normalize(JSON.stringify(b.out[same.side]), b.w))
        expect(viewA).toEqual(viewB)
      })
    }
  })
}
