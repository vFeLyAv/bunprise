/**
 * Invite links under concurrency on real PostgreSQL (docs/decisions/0002-concurrency-tests-real-postgres.md):
 * accept_invite against block_user and remove_member, two create_invite of the same host, and two people
 * taking the last free use of a link. Each pair: the first operation holds its locks in an open transaction,
 * the second must wait (pg_blocking_pids), then the first commits. Pairs + expected outcomes: ./pairs.ts.
 */
import { afterAll, beforeAll } from 'vitest'
import { startRealPg, type RealPg, type Session } from '../../src/realpg'
import { INVITE_PAIRS, holdTests } from './pairs'

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

holdTests(INVITE_PAIRS, () => ({ db, s1, s2 }))
