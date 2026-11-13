/**
 * The concurrency contract as a table (not a test file). Every pair of operations that can meet on the same
 * rows at the same moment, the row lock the waiting side queues on, and the final state for BOTH serial orders.
 * Expected outcomes: pilot-decisions §0 items 3-5 (snapshot after the end of a membership, remove_member
 * revokes links, lock order) and §1/§2 (lifecycle, error codes), plus the comments in
 * supabase/migrations/20261019120500_pilot_security_v11.sql.
 *
 * Runners:
 *   holdThenRun  deterministic interleaving: the first operation runs inside an open transaction (all its locks
 *                taken), the second starts on another connection and must WAIT (pg_blocking_pids), the first
 *                commits, the second finishes.
 *   race         both operations as independent one-statement transactions sent at the same moment, the way two
 *                PostgREST requests arrive: no barrier, real timing.
 */
import { describe, expect, it } from 'vitest'
import { settle, type BlockInfo, type Outcome, type RealPg, type Session } from '../../src/realpg'
import {
  W1_TITLE,
  accountExists,
  activeReserversOf,
  isBlocked,
  isLiveToken,
  link,
  liveLinks,
  memberStatus,
  occasionExists,
  reservationCountOn,
  reservationsBy,
  rpcAs,
  seedWorld,
  type MyReservation,
  type World,
} from './world'

// ---------------------------------------------------------------------------
// Operations and expectations
// ---------------------------------------------------------------------------

export interface Op {
  label: string
  /** the signed-in user */
  as: (w: World) => string
  /** one statement inside the caller's transaction: the RPC's jsonb, or the affected rows of a REST write */
  run: (s: Session, w: World) => Promise<unknown>
}

/** An RPC call, `select public.<fn>(args)`, as PostgREST sends it for supabase.rpc(). */
export function rpcOp(label: string, fn: string, as: (w: World) => string, args: (w: World) => readonly unknown[] = () => []): Op {
  return { label, as, run: (s, w) => s.rpc(fn, args(w)) }
}

/** A plain table write through RLS, as PostgREST runs it for supabase.from(...).delete(). Value = affected rows. */
export function restOp(label: string, sql: string, as: (w: World) => string, params: (w: World) => readonly unknown[]): Op {
  return { label, as, run: async (s, w) => (await s.query(sql, params(w))).rowCount }
}

export interface Ctx {
  db: RealPg
  w: World
  x: Outcome
  y: Outcome
  /**
   * hold: the loser started before the winner committed and waited for it (deterministic).
   * race: the winner may also commit before the loser has read anything.
   */
  schedule: 'hold' | 'race'
}

export interface Expectation {
  /** short, used in the test name */
  says: string
  check: (ctx: Ctx) => Promise<void>
}

export interface Pair {
  name: string
  x: Op
  y: Op
  /** table of the row the waiting side queues on: [y waits while x holds, x waits while y holds] */
  waitsOn: readonly [string, string]
  seed?: { extraMembers?: number; extraOutsiders?: number }
  prepare?: (db: RealPg, w: World) => Promise<void>
  xFirst: Expectation
  yFirst: Expectation
  /** y-first would repeat x-first with the roles swapped: one hold test is enough */
  symmetric?: boolean
  /** after an unsynchronized race: whose transaction went first? (decides which expectation applies) */
  firstOf: (ctx: Ctx) => 'x' | 'y' | Promise<'x' | 'y'>
}

export const OK: Outcome = { ok: true, value: { ok: true } }
export const rpcError = (message: string): Outcome => ({ ok: false, code: 'P0001', message })
const joined = (w: World): Outcome => ({ ok: true, value: { occasion_id: w.occasionId } })
const oneRow: Outcome = { ok: true, value: 1 }
const xWentFirstIfOk = ({ x }: Ctx): 'x' | 'y' => (x.ok ? 'x' : 'y')

/** The error codes of the RPC contract (pilot-decisions §2). Anything else from a race is a bug. */
export const CONTRACT_CODES = [
  'not_authenticated',
  'not_allowed',
  'not_found',
  'already_reserved',
  'invite_invalid',
  'consent_required',
  'profile_incomplete',
  'validation',
  // wave 2b (follows-design §5.1, §7.3): only the caller's own limits — 20 lists without an occasion,
  // 30 open follow requests, 5 active reservations per recipient on lists without an occasion
  'limit_reached',
] as const

/**
 * A failure must be one of the contract's codes (P0001 + code). Never a deadlock (40P01), a lock or statement
 * timeout (55P03 / 57014), a serialization failure (40001) or a raw constraint error (23505 / 23503).
 */
export function expectContractOutcome(label: string, out: Outcome): void {
  if (out.ok) return
  const contractCode = out.code === 'P0001' && (CONTRACT_CODES as readonly string[]).includes(out.message)
  expect(contractCode, `${label}: database error outside the contract: ${out.code} ${out.message}`).toBe(true)
}

/**
 * The losing call's refusal. READ COMMITTED: every statement of a function sees the latest committed data, so in
 * a race the answer comes from whichever check first sees the winner's commit. With `hold` the loser has read
 * before the commit and waited, so the code is exactly `held`; a race may also give one of `raceAlso`.
 */
export function expectRefused(ctx: Ctx, out: Outcome, held: string, raceAlso: readonly string[] = []): void {
  if (ctx.schedule === 'hold' || raceAlso.length === 0) {
    expect(out).toEqual(rpcError(held))
    return
  }
  const allowed = [held, ...raceAlso]
  const refused = !out.ok && out.code === 'P0001' && allowed.includes(out.message)
  expect(refused, `expected a refusal with one of ${allowed.join(' | ')}, got ${JSON.stringify(out)}`).toBe(true)
}

export function tokenOf(out: Outcome): string {
  if (!out.ok) throw new Error(`create_invite failed: ${JSON.stringify(out)}`)
  return (out.value as { token: string }).token
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

export interface HoldResult {
  first: Outcome
  second: Outcome
  /** what the second operation was waiting for while the first held its locks */
  block: BlockInfo
}

/**
 * `first` runs in an open transaction on `holder` (it has taken all its locks), `second` starts on `waiter` and
 * must block on the holder; then the holder commits (or rolls back) and `second` finishes.
 */
export async function holdThenRun(
  db: RealPg,
  holder: Session,
  waiter: Session,
  w: World,
  first: Op,
  second: Op,
  holderEnds: 'commit' | 'rollback' = 'commit',
): Promise<HoldResult> {
  await holder.begin(first.as(w))
  const firstOut = await settle(first.run(holder, w))
  if (!firstOut.ok) {
    await holder.rollback()
    throw new Error(`${first.label} failed while taking its locks: ${JSON.stringify(firstOut)}`)
  }
  await waiter.begin(second.as(w))
  const pending = settle(second.run(waiter, w))
  let block: BlockInfo
  try {
    block = await db.waitUntilBlocked(waiter, holder, pending)
  } catch (err) {
    // Leave both sessions usable for the next test, then report.
    await holder.rollback().catch(() => undefined)
    await pending
    await waiter.rollback().catch(() => undefined)
    throw err
  }
  await (holderEnds === 'commit' ? holder.commit() : holder.rollback())
  const secondOut = await pending
  await (secondOut.ok ? waiter.commit() : waiter.rollback())
  return { first: firstOut, second: secondOut, block }
}

/**
 * One operation as its own transaction (begin as the user, the statement, commit / rollback on error), after
 * `delayRoundTrips` extra `select 1` round trips (a fraction of an RPC's run time each).
 */
async function asRequest(s: Session, w: World, op: Op, delayRoundTrips = 0): Promise<Outcome> {
  for (let i = 0; i < delayRoundTrips; i++) await s.query('select 1')
  await s.begin(op.as(w))
  const out = await settle(op.run(s, w))
  await (out.ok ? s.commit() : s.rollback())
  return out
}

/**
 * x and y sent at the same moment on two connections, like two PostgREST requests. `xStartsFirst` decides which
 * socket is written first; the other one is held back by `stagger` round trips, so that over the rounds the two
 * function bodies overlap at different points (a deadlock needs both inside their bodies at once).
 */
export async function race(
  sessions: readonly [Session, Session],
  w: World,
  x: Op,
  y: Op,
  xStartsFirst: boolean,
  stagger = 0,
): Promise<{ x: Outcome; y: Outcome }> {
  const [sx, sy] = sessions
  if (xStartsFirst) {
    const [ox, oy] = await Promise.all([asRequest(sx, w, x), asRequest(sy, w, y, stagger)])
    return { x: ox, y: oy }
  }
  const [oy, ox] = await Promise.all([asRequest(sy, w, y), asRequest(sx, w, x, stagger)])
  return { x: ox, y: oy }
}

/** N operations at the same moment, one connection each. */
export function raceMany(sessions: readonly Session[], w: World, ops: readonly Op[]): Promise<Outcome[]> {
  if (ops.length > sessions.length) throw new Error(`raceMany: ${ops.length} operations but ${sessions.length} sessions`)
  return Promise.all(ops.map((op, i) => asRequest(sessions[i] as Session, w, op)))
}

export function seedFor(db: RealPg, pair: Pair): Promise<World> {
  return seedWorld(db, pair.seed).then(async (w) => {
    await pair.prepare?.(db, w)
    return w
  })
}

export interface Env {
  db: RealPg
  s1: Session
  s2: Session
}

/** Registers the deterministic tests of each pair: x holds → y waits, and (unless symmetric) y holds → x waits. */
export function holdTests(pairs: readonly Pair[], env: () => Env): void {
  for (const pair of pairs) {
    describe(pair.name, () => {
      it(`${pair.x.label} holds its locks → ${pair.y.label} waits on a ${pair.waitsOn[0]} row → ${pair.xFirst.says}`, async () => {
        const { db, s1, s2 } = env()
        const w = await seedFor(db, pair)
        const r = await holdThenRun(db, s1, s2, w, pair.x, pair.y)
        expect(r.block.rowLockOn, JSON.stringify(r.block)).toBe(pair.waitsOn[0])
        await pair.xFirst.check({ db, w, x: r.first, y: r.second, schedule: 'hold' })
      })
      if (pair.symmetric) return
      it(`${pair.y.label} holds its locks → ${pair.x.label} waits on a ${pair.waitsOn[1]} row → ${pair.yFirst.says}`, async () => {
        const { db, s1, s2 } = env()
        const w = await seedFor(db, pair)
        const r = await holdThenRun(db, s1, s2, w, pair.y, pair.x)
        expect(r.block.rowLockOn, JSON.stringify(r.block)).toBe(pair.waitsOn[1])
        await pair.yFirst.check({ db, w, x: r.second, y: r.first, schedule: 'hold' })
      })
    })
  }
}

// ---------------------------------------------------------------------------
// The pairs
// ---------------------------------------------------------------------------

const reserveBen = rpcOp('reserve_wish (Ben)', 'reserve_wish', (w) => w.b, (w) => [w.w1])
const removeBen = rpcOp('remove_member (Anna removes Ben)', 'remove_member', (w) => w.host, (w) => [w.occasionId, w.b])
const acceptDana = rpcOp('accept_invite (Dana)', 'accept_invite', (w) => w.d, (w) => [w.token])

const myReservations = (ctx: Ctx, uid: string) => rpcAs<MyReservation[]>(ctx.db, uid, 'my_reservations')

export const RESERVATION_PAIRS: readonly Pair[] = [
  {
    name: 'reserve_wish ↔ remove_member',
    x: reserveBen,
    y: removeBen,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      // 20261027200000: the removal never touches it — dead at once, the cleanup ends it (access_ended)
      says: 'the new reservation is dead; the cleanup ends it as access_ended',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        expect(await reservationsBy(db, w.b)).toEqual([{ wish_id: w.w1, status: 'ended', end_reason: 'access_ended' }])
        expect(await liveLinks(db, w)).toBe(0) // §0.4: the removal revokes the links
        // §0.3: a former member keeps only the snapshot, no live data; the one neutral public reason
        expect(await myReservations(ctx, w.b)).toEqual([
          expect.objectContaining({ wish_id: null, wish_title: W1_TITLE, occasion_id: null, occasion_title: null, status: 'ended', end_reason: 'unavailable' }),
        ])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        expect(await reservationsBy(db, w.b)).toEqual([])
        expect(await liveLinks(db, w)).toBe(0)
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'reserve_wish ↔ leave_occasion',
    x: reserveBen,
    y: rpcOp('leave_occasion (Ben, second tab)', 'leave_occasion', (w) => w.b, (w) => [w.occasionId]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the new reservation ends as member_left',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await memberStatus(db, w, w.b)).toBe('left')
        expect(await reservationsBy(db, w.b)).toEqual([{ wish_id: w.w1, status: 'ended', end_reason: 'member_left' }])
        expect(await liveLinks(db, w)).toBe(1) // leaving does not touch the link
        expect(await myReservations(ctx, w.b)).toEqual([
          expect.objectContaining({ wish_title: W1_TITLE, occasion_id: null, status: 'ended', end_reason: 'member_left' }),
        ])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await memberStatus(db, w, w.b)).toBe('left')
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'reserve_wish ↔ block_user (the host blocks the reserver)',
    x: reserveBen,
    y: rpcOp('block_user (Anna blocks Ben)', 'block_user', (w) => w.host, (w) => [w.b]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation is dead; the cleanup ends it quietly (access_ended)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await isBlocked(db, w.host, w.b)).toBe(true)
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        // the blocked person never sees 'blocked'
        expect(await reservationsBy(db, w.b)).toEqual([{ wish_id: w.w1, status: 'ended', end_reason: 'access_ended' }])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'reserve_wish ↔ block_user (the reserver blocks the host)',
    x: reserveBen,
    y: rpcOp('block_user (Ben blocks Anna)', 'block_user', (w) => w.b, (w) => [w.host]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation is dead (the cleanup ends it as access_ended), the membership reads as left',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await isBlocked(db, w.b, w.host)).toBe(true)
        expect(await memberStatus(db, w, w.b)).toBe('left')
        expect(await reservationsBy(db, w.b)).toEqual([{ wish_id: w.w1, status: 'ended', end_reason: 'access_ended' }])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await memberStatus(db, w, w.b)).toBe('left')
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'reserve_wish ↔ delete_my_account (the reserver)',
    x: reserveBen,
    y: rpcOp('delete_my_account (Ben, second tab)', 'delete_my_account', (w) => w.b),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'account and reservation are gone, the wish is free again',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await accountExists(db, w.b)).toBe(false)
        expect(await reservationCountOn(db, w.w1)).toBe(0)
        expect(await rpcAs(db, w.c, 'reserve_wish', [w.w1])).toEqual({ ok: true })
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed (the profile is gone once the lock is free)',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(y).toEqual(OK)
        // race: the deletion may commit between require_user() and has_consents() → consent_required
        expectRefused(ctx, x, 'not_allowed', ['consent_required'])
        expect(await accountExists(db, w.b)).toBe(false)
        expect(await reservationCountOn(db, w.w1)).toBe(0)
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'reserve_wish ↔ delete_my_account (the host)',
    x: reserveBen,
    y: rpcOp('delete_my_account (Anna)', 'delete_my_account', (w) => w.host),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the occasion is gone, the reserver loses the row silently',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await accountExists(db, w.host)).toBe(false)
        expect(await occasionExists(db, w)).toBe(false)
        expect(await reservationsBy(db, w.b)).toEqual([])
        expect(await myReservations(ctx, w.b)).toEqual([])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_found (the wish is gone), no reservation row',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(y).toEqual(OK)
        // race: the deletion may commit before reserve_wish reads the wish → not_found (the serial answer)
        expectRefused(ctx, x, 'not_found', ['not_allowed']) // 20261027200000: the wish is re-read under the pair lock first
        expect(await occasionExists(db, w)).toBe(false)
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    // Not in the original list: the app's „Löschen“ of a wish (REST hard delete, trigger wish_before_delete).
    name: 'reserve_wish ↔ the host deletes the wish (REST)',
    x: reserveBen,
    y: restOp('DELETE wishes (Anna)', 'delete from public.wishes where id = $1', (w) => w.host, (w) => [w.w1]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation ends as wish_deleted',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(x).toEqual(OK)
        expect(y).toEqual(oneRow)
        expect(await reservationsBy(db, w.b)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
        expect(await myReservations(ctx, w.b)).toEqual([
          expect.objectContaining({ wish_id: null, wish_title: W1_TITLE, occasion_id: null, status: 'ended', end_reason: 'unavailable' }),
        ])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_found, like for a wish deleted earlier',
      async check({ db, w, x, y }) {
        expect(y).toEqual(oneRow)
        expect(x).toEqual(rpcError('not_found'))
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    // Not used by the app UI, but RLS lets the host do it (policy wishlists_delete): the whole list cascades.
    name: 'reserve_wish ↔ the host deletes the wishlist (REST)',
    x: reserveBen,
    y: restOp('DELETE wishlists (Anna)', 'delete from public.wishlists where id = $1', (w) => w.host, (w) => [w.wishlistId]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation ends as wish_deleted',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(oneRow)
        expect(await reservationsBy(db, w.b)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_found',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(y).toEqual(oneRow)
        // race: the delete may commit between reserve_wish's reads of the wish and of the list → the list is
        // missing, no membership row matches → not_allowed
        expectRefused(ctx, x, 'not_found', ['not_allowed'])
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    // Not in the original list: the app's „Anlass löschen“ (REST delete, everything cascades).
    name: 'reserve_wish ↔ the host deletes the occasion (REST)',
    x: reserveBen,
    y: restOp('DELETE occasions (Anna)', 'delete from public.occasions where id = $1', (w) => w.host, (w) => [w.occasionId]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation ends as wish_deleted, only the snapshot stays',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(x).toEqual(OK)
        expect(y).toEqual(oneRow)
        expect(await occasionExists(db, w)).toBe(false)
        expect(await reservationsBy(db, w.b)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
        expect(await myReservations(ctx, w.b)).toEqual([
          expect.objectContaining({ wish_title: W1_TITLE, occasion_id: null, status: 'ended', end_reason: 'unavailable' }),
        ])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_found (the wish is gone), no reservation row',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(y).toEqual(oneRow)
        // race: the delete may commit before reserve_wish reads the wish → not_found (the serial answer)
        expectRefused(ctx, x, 'not_found', ['not_allowed']) // 20261027200000: the wish is re-read under the pair lock first
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'reserve_wish ↔ reserve_wish (two members, one wish)',
    x: reserveBen,
    y: rpcOp('reserve_wish (Cem)', 'reserve_wish', (w) => w.c, (w) => [w.w1]),
    waitsOn: ['profiles', 'profiles'],
    symmetric: true,
    xFirst: {
      says: 'Cem gets already_reserved (never a raw 23505), one active reservation',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(rpcError('already_reserved'))
        expect(await activeReserversOf(db, w.w1)).toEqual([w.b])
        expect(await reservationsBy(db, w.c)).toEqual([])
      },
    },
    yFirst: {
      says: 'Ben gets already_reserved, one active reservation',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('already_reserved'))
        expect(await activeReserversOf(db, w.w1)).toEqual([w.c])
        expect(await reservationsBy(db, w.b)).toEqual([])
      },
    },
    firstOf: xWentFirstIfOk,
  },
]

const createInviteChecks = (first: 'x' | 'y'): Expectation['check'] => async ({ db, w, x, y }) => {
  const [earlier, later] = first === 'x' ? [x, y] : [y, x]
  const [earlierToken, laterToken] = [tokenOf(earlier), tokenOf(later)]
  expect(earlierToken).not.toBe(laterToken)
  expect(await liveLinks(db, w)).toBe(1)
  expect(await isLiveToken(db, w, laterToken)).toBe(true)
  expect(await isLiveToken(db, w, earlierToken)).toBe(false)
  expect(await isLiveToken(db, w, w.token)).toBe(false)
  await expect(rpcAs(db, w.d, 'accept_invite', [earlierToken])).rejects.toMatchObject({ code: 'P0001', message: 'invite_invalid' })
  expect(await rpcAs(db, w.d, 'accept_invite', [laterToken])).toEqual({ occasion_id: w.occasionId })
}

export const INVITE_PAIRS: readonly Pair[] = [
  {
    name: 'accept_invite ↔ block_user (the host blocks the newcomer)',
    x: acceptDana,
    y: rpcOp('block_user (Anna blocks Dana)', 'block_user', (w) => w.host, (w) => [w.d]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Dana joins, then the block removes her',
      async check({ db, w, x, y }) {
        expect(x).toEqual(joined(w))
        expect(y).toEqual(OK)
        expect(await isBlocked(db, w.host, w.d)).toBe(true)
        expect(await memberStatus(db, w, w.d)).toBe('removed')
        expect(await link(db, w)).toMatchObject({ use_count: 3 })
      },
    },
    yFirst: {
      says: 'accept_invite → invite_invalid, no membership, no use counted',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(db, w, w.d)).toBe(null)
        expect(await link(db, w)).toMatchObject({ use_count: 2 })
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'accept_invite ↔ remove_member (the removed guest re-opens the old link)',
    x: rpcOp('accept_invite (Ben, old link)', 'accept_invite', (w) => w.b, (w) => [w.token]),
    y: removeBen,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Ben is still a member (no use counted), then removed; the link is revoked',
      async check({ db, w, x, y }) {
        expect(x).toEqual(joined(w))
        expect(y).toEqual(OK)
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        expect(await link(db, w)).toEqual({ use_count: 2, max_uses: 50, revoked: true })
      },
    },
    yFirst: {
      says: 'accept_invite → invite_invalid (the link died with the membership)',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        expect(await link(db, w)).toEqual({ use_count: 2, max_uses: 50, revoked: true })
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'accept_invite ↔ remove_member (a newcomer joins while another guest is removed)',
    x: acceptDana,
    y: removeBen,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Dana stays a member, Ben is removed, the link is revoked',
      async check({ db, w, x, y }) {
        expect(x).toEqual(joined(w))
        expect(y).toEqual(OK)
        expect(await memberStatus(db, w, w.d)).toBe('active')
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        expect(await link(db, w)).toEqual({ use_count: 3, max_uses: 50, revoked: true })
      },
    },
    yFirst: {
      says: 'accept_invite → invite_invalid (the removal revoked the link)',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(db, w, w.d)).toBe(null)
        expect(await memberStatus(db, w, w.b)).toBe('removed')
        expect(await link(db, w)).toEqual({ use_count: 2, max_uses: 50, revoked: true })
      },
    },
    firstOf: xWentFirstIfOk,
  },
  {
    name: 'create_invite ↔ create_invite (two tabs of the host)',
    x: rpcOp('create_invite (Anna, tab 1)', 'create_invite', (w) => w.host, (w) => [w.occasionId]),
    y: rpcOp('create_invite (Anna, tab 2)', 'create_invite', (w) => w.host, (w) => [w.occasionId]),
    waitsOn: ['profiles', 'profiles'],
    symmetric: true,
    xFirst: { says: 'both succeed, exactly one link stays live: the later one', check: createInviteChecks('x') },
    yFirst: { says: 'both succeed, exactly one link stays live: the later one', check: createInviteChecks('y') },
    // the live link belongs to the transaction that committed last
    firstOf: async ({ db, w, x }) => ((await isLiveToken(db, w, tokenOf(x))) ? 'y' : 'x'),
  },
  {
    name: 'accept_invite ↔ accept_invite (the last free use of a link)',
    x: acceptDana,
    y: rpcOp('accept_invite (Emil)', 'accept_invite', (w) => w.e, (w) => [w.token]),
    prepare: async (db, w) => {
      await db.admin.query('update public.invites set max_uses = use_count + 1 where id = $1', [w.inviteId])
    },
    waitsOn: ['profiles', 'profiles'],
    symmetric: true,
    xFirst: {
      says: 'Dana takes the slot, Emil gets invite_invalid',
      async check({ db, w, x, y }) {
        expect(x).toEqual(joined(w))
        expect(y).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(db, w, w.d)).toBe('active')
        expect(await memberStatus(db, w, w.e)).toBe(null)
        expect(await link(db, w)).toEqual({ use_count: 3, max_uses: 3, revoked: false })
      },
    },
    yFirst: {
      says: 'Emil takes the slot, Dana gets invite_invalid',
      async check({ db, w, x, y }) {
        expect(y).toEqual(joined(w))
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(db, w, w.e)).toBe('active')
        expect(await memberStatus(db, w, w.d)).toBe(null)
        expect(await link(db, w)).toEqual({ use_count: 3, max_uses: 3, revoked: false })
      },
    },
    firstOf: xWentFirstIfOk,
  },
]
