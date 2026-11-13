/**
 * Unsynchronised races of the follow pairs on real PostgreSQL 17 (docs/decisions/0002-concurrency-tests-real-postgres.md,
 * docs/spec/follows-design.md §7.3). Every pair of ./follow-pairs.ts is sent as two independent one-statement
 * transactions at the same moment, ROUNDS times with a fresh world: which socket is written first alternates, the
 * other one starts 0–5 round trips later, so the two bodies overlap at different points. Nothing may deadlock (40P01),
 * time out (55P03 / 57014), fail serialisation (40001) or leak a raw constraint error (23505 / 23503); every round ends
 * in exactly the state of one serial order, with INV-1, INV-5, INV-6 and the pilot rules. Both orders are proven
 * deterministically by follows.test.ts. Plus N-way races for the two "only one may win" rules of wave 2b.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type RealPg, type Session } from '../../src/realpg'
import {
  EXTRA_FOLLOW_PAIRS,
  FOLLOW_PAIRS,
  cooldownsBefore,
  expectContractAnswers,
  expectFollowInvariants,
  raceFollow,
  raceManyFollow,
  rpcOp,
  seedForPair,
  wish,
  type FollowCtx,
  type FollowPair,
} from './follow-pairs'
import { expectContractOutcome, rpcError } from './pairs'
import { activeStandaloneReservations, followLink, followStatus, rpcAs, seedFollowWorld } from './world'

const ROUNDS = 12
const N = 5

let db: RealPg
let sessions: Session[]

beforeAll(async () => {
  db = await startRealPg()
  sessions = []
  for (let i = 1; i <= N; i++) sessions.push(await db.session(`race-${i}`))
})
afterAll(async () => {
  await db?.close()
})

const pairOfSessions = (): readonly [Session, Session] => [sessions[0] as Session, sessions[1] as Session]

async function raceRounds(pair: FollowPair): Promise<{ x: number; y: number }> {
  const seen = { x: 0, y: 0 }
  for (let round = 0; round < ROUNDS; round++) {
    const w = await seedForPair(db, pair)
    const before = await cooldownsBefore(db)
    try {
      const out = await raceFollow(pairOfSessions(), w, pair.x, pair.y, round % 2 === 0, Math.floor(round / 2))
      expectContractAnswers(pair, out, `round ${round + 1}`)
      const ctx: FollowCtx = { db, w, ...out, schedule: 'race' }
      const first = await pair.firstOf(ctx)
      seen[first] += 1
      await (first === 'x' ? pair.xFirst : pair.yFirst).check(ctx)
      await expectFollowInvariants(db, before, `${pair.id}, round ${round + 1}`)
    } finally {
      await pair.cleanup?.(db)
    }
  }
  return seen
}

describe('follows: two operations at the same moment', () => {
  for (const pair of [...FOLLOW_PAIRS, ...EXTRA_FOLLOW_PAIRS]) {
    it(`${pair.id} ${pair.name}: ${ROUNDS} rounds, no deadlock or timeout, each round equals one serial order`, async () => {
      const seen = await raceRounds(pair)
      console.info(`[follow races] ${pair.id} ${pair.name}: ${pair.x.label} first ${seen.x}/${ROUNDS}, ${pair.y.label} first ${seen.y}/${ROUNDS}`)
    })
  }
})

describe(`follows: up to ${N} operations at the same moment`, () => {
  it('3 tabs of Finn at 4 active reservations reserve 3 other wishes: exactly one ok, the others limit_reached', async () => {
    for (let round = 0; round < 3; round++) {
      const w = await seedFollowWorld(db)
      for (const i of [0, 1, 2, 3]) expect(await rpcAs(db, w.finn, 'reserve_wish', [wish(w, i)])).toEqual({ ok: true })
      const before = await cooldownsBefore(db)
      const ops = [4, 5, 6].map((i) => rpcOp(`reserve_wish (Finn, tab ${i - 3})`, 'reserve_wish', (x) => x.finn, (x) => [wish(x, i)]))
      const outs = await raceManyFollow(sessions, w, ops)
      outs.forEach((o, i) => expectContractOutcome(`tab ${i + 1}`, o))
      expect(outs.filter((o) => o.ok)).toEqual([{ ok: true, value: { ok: true } }])
      expect(outs.filter((o) => !o.ok)).toEqual([rpcError('limit_reached'), rpcError('limit_reached')])
      expect(await activeStandaloneReservations(db, w.finn, w.paula)).toBe(5)
      await expectFollowInvariants(db, before, `cap, round ${round + 1}`)
    }
  })

  it(`${N} new people take the last place of a follow link: exactly one is requested, the others get invite_invalid`, async () => {
    for (let round = 0; round < 3; round++) {
      const w = await seedFollowWorld(db, { extraOutsiders: N - 2 })
      await db.admin.query('update public.follow_links set use_count = 19 where id = $1', [w.linkId])
      const before = await cooldownsBefore(db)
      const ops = w.outsiders.map((who, i) => rpcOp(`request_follow_via_link (new person ${i + 1})`, 'request_follow_via_link', () => who, (x) => [x.token]))
      const outs = await raceManyFollow(sessions, w, ops)
      outs.forEach((o, i) => expectContractOutcome(`new person ${i + 1}`, o))
      expect(outs.filter((o) => o.ok)).toEqual([{ ok: true, value: { status: 'requested', profile_id: w.paula } }])
      expect(outs.filter((o) => !o.ok)).toEqual(Array.from({ length: N - 1 }, () => rpcError('invite_invalid')))
      expect(await followLink(db, w)).toEqual({ use_count: 20, revoked: false })
      const pending: string[] = []
      for (const who of w.outsiders) if ((await followStatus(db, who, w.paula)) === 'pending') pending.push(who)
      expect(pending).toHaveLength(1)
      await expectFollowInvariants(db, before, `last place, round ${round + 1}`)
    }
  })
})
