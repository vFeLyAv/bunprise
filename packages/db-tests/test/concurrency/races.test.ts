/**
 * Unsynchronized races on real PostgreSQL (docs/decisions/0002-concurrency-tests-real-postgres.md). Every pair
 * from ./pairs.ts is sent as two independent one-statement transactions at the same moment, ROUNDS times with
 * a fresh world: which socket is written first alternates, and the other one starts 0-5 round trips later, so
 * the two bodies overlap at different points. Nothing may deadlock (40P01) or time out (55P03 / 57014), no raw
 * constraint error may leak, and every round must end in exactly the state of one serial order. Which order
 * wins is up to the timing; both orders are proven deterministically by reservations/invites.test.ts.
 * Plus N-way races for the three "only one may win" rules.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type RealPg, type Session } from '../../src/realpg'
import {
  INVITE_PAIRS,
  RESERVATION_PAIRS,
  expectContractOutcome,
  race,
  raceMany,
  rpcError,
  rpcOp,
  seedFor,
  tokenOf,
  type Ctx,
} from './pairs'
import { activeReserversOf, isLiveToken, link, liveLinks, memberStatus, reservationCountOn, seedWorld } from './world'

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

describe('two operations at the same moment', () => {
  for (const pair of [...RESERVATION_PAIRS, ...INVITE_PAIRS]) {
    it(`${pair.name}: ${ROUNDS} rounds, no deadlock or timeout, each round equals one serial order`, async () => {
      const seen = { x: 0, y: 0 }
      for (let round = 0; round < ROUNDS; round++) {
        const w = await seedFor(db, pair)
        const out = await race(pairOfSessions(), w, pair.x, pair.y, round % 2 === 0, Math.floor(round / 2))
        expectContractOutcome(`${pair.x.label} (round ${round + 1})`, out.x)
        expectContractOutcome(`${pair.y.label} (round ${round + 1})`, out.y)
        const ctx: Ctx = { db, w, ...out, schedule: 'race' }
        const first = await pair.firstOf(ctx)
        seen[first] += 1
        await (first === 'x' ? pair.xFirst : pair.yFirst).check(ctx)
      }
      console.info(`[races] ${pair.name}: ${pair.x.label} first ${seen.x}/${ROUNDS}, ${pair.y.label} first ${seen.y}/${ROUNDS}`)
    })
  }
})

describe(`${N} operations at the same moment`, () => {
  it(`${N} members reserve the same wish: exactly one wins, the others get already_reserved`, async () => {
    for (let round = 0; round < 3; round++) {
      const w = await seedWorld(db, { extraMembers: N - 2 })
      const ops = w.members.map((m, i) => rpcOp(`reserve_wish (member ${i + 1})`, 'reserve_wish', () => m, (x) => [x.w1]))
      const outs = await raceMany(sessions, w, ops)
      outs.forEach((o, i) => expectContractOutcome(`member ${i + 1}`, o))
      const winners = outs.flatMap((o, i) => (o.ok ? [w.members[i]] : []))
      expect(winners).toHaveLength(1)
      expect(outs.filter((o) => !o.ok)).toEqual(Array.from({ length: N - 1 }, () => rpcError('already_reserved')))
      expect(await activeReserversOf(db, w.w1)).toEqual(winners)
      expect(await reservationCountOn(db, w.w1)).toBe(1)
    }
  })

  it(`${N - 1} tabs of the host create a link: all succeed, exactly one link stays live`, async () => {
    for (let round = 0; round < 3; round++) {
      const w = await seedWorld(db)
      const ops = Array.from({ length: N - 1 }, (_, i) =>
        rpcOp(`create_invite (tab ${i + 1})`, 'create_invite', (x) => x.host, (x) => [x.occasionId]),
      )
      const outs = await raceMany(sessions, w, ops)
      outs.forEach((o, i) => expectContractOutcome(`tab ${i + 1}`, o))
      const tokens = outs.map(tokenOf)
      expect(new Set(tokens).size).toBe(N - 1)
      expect(await liveLinks(db, w)).toBe(1)
      const live: string[] = []
      for (const token of tokens) if (await isLiveToken(db, w, token)) live.push(token)
      expect(live).toHaveLength(1)
    }
  })

  it(`${N} outsiders take the last free use of a link: exactly one joins, the others get invite_invalid`, async () => {
    for (let round = 0; round < 3; round++) {
      const w = await seedWorld(db, { extraOutsiders: N - 2 })
      await db.admin.query('update public.invites set max_uses = use_count + 1 where id = $1', [w.inviteId])
      const ops = w.outsiders.map((o, i) => rpcOp(`accept_invite (outsider ${i + 1})`, 'accept_invite', () => o, (x) => [x.token]))
      const outs = await raceMany(sessions, w, ops)
      outs.forEach((o, i) => expectContractOutcome(`outsider ${i + 1}`, o))
      expect(outs.filter((o) => o.ok)).toEqual([{ ok: true, value: { occasion_id: w.occasionId } }])
      expect(outs.filter((o) => !o.ok)).toEqual(Array.from({ length: N - 1 }, () => rpcError('invite_invalid')))
      expect(await link(db, w)).toEqual({ use_count: 3, max_uses: 3, revoked: false })
      const statuses: (string | null)[] = []
      for (const o of w.outsiders) statuses.push(await memberStatus(db, w, o))
      expect(statuses.filter((s) => s === 'active')).toHaveLength(1)
    }
  })
})
