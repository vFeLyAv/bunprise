/**
 * The concurrency contract of wave 2b as a table (not a test file): the pairs C01–C23 of
 * docs/spec/follows-design.md §7.3 on the follow world (seedFollowWorld in ./world.ts), plus three pairs outside that
 * list (R1–R3: the database "red button", cancel_reservation and a list deletion against a reservation / "Nur ich").
 * For every pair: the two operations, the row the waiting side queues on in both orders, and the final state of BOTH
 * serial orders.
 *
 * Runners (the same two schedules as ./pairs.ts, docs/decisions/0002-concurrency-tests-real-postgres.md):
 *   holdFollow   deterministic: the first operation runs in an open transaction (all its locks taken), the second
 *                starts on another connection and must WAIT for it (pg_blocking_pids), then the first commits. A first
 *                call that fails holds nothing (an error aborts the transaction and frees its locks at once), so then
 *                the second simply runs after it.
 *   raceFollow   both as independent one-statement transactions sent at the same moment, like two PostgREST requests.
 * After every run: only contract codes (never 40P01 / 55P03 / 57014 / 40001 / 23505 / 23503), INV-1, INV-5, INV-6 and
 * the pilot rules (§6.2). Where §7.3 says so (C01, C03, C04, C18) the answer of one person must be byte-identical in
 * both orders — checked together with that person's whole normalised view (followView), i.e. INV-2 / INV-3 under a race.
 * All names are invented (Paula, Finn, Greta, Rosa, Moritz, Xaver, Ida).
 */
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import { settle, type BlockInfo, type Outcome, type RealPg, type Session } from '../../src/realpg'
import { OK, expectContractOutcome, rpcError } from './pairs'
import {
  L1_TITLE,
  accountExists,
  activeReserversOf,
  activeStandaloneReservations,
  cooldownRows,
  cooldownsShortened,
  followLink,
  followRowsBetween,
  followStatus,
  hasCooldown,
  inv1Violations,
  inv5Violations,
  isBlocked,
  isLiveFollowToken,
  liveFollowLinks,
  pilotRuleViolations,
  reservationsBy,
  rpcAs,
  seedFollowWorld,
  visibilityOf,
  type CooldownRow,
  type FollowWorld,
} from './world'

// ---------------------------------------------------------------------------
// Operations, expectations, pairs
// ---------------------------------------------------------------------------

export interface FollowOp {
  label: string
  /** the signed-in user; null = the superuser (the emergency template runs as the migration owner) */
  as: (w: FollowWorld) => string | null
  /** one statement inside the caller's transaction: the RPC's jsonb, or the affected rows of a REST write */
  run: (s: Session, w: FollowWorld) => Promise<unknown>
}

export function rpcOp(
  label: string,
  fn: string,
  as: (w: FollowWorld) => string,
  args: (w: FollowWorld) => readonly unknown[] = () => [],
): FollowOp {
  return { label, as, run: (s, w) => s.rpc(fn, args(w)) }
}

/** A plain table write through RLS, as PostgREST runs supabase.from(...).delete(). Value = affected rows. */
export function restOp(label: string, sql: string, as: (w: FollowWorld) => string, params: (w: FollowWorld) => readonly unknown[]): FollowOp {
  return { label, as, run: async (s, w) => (await s.query(sql, params(w))).rowCount }
}

export interface FollowCtx {
  db: RealPg
  w: FollowWorld
  x: Outcome
  y: Outcome
  /** hold: the loser read before the winner committed and waited (exact code); race: real timing */
  schedule: 'hold' | 'race'
}

export interface FollowExpectation {
  /** short, used in the test name */
  says: string
  check: (ctx: FollowCtx) => Promise<void>
}

export interface FollowPair {
  /** C01 … C23 (follows-design §7.3; C10 and C20 in both "either side" variants a / b), R1–R3 = outside the list */
  id: string
  name: string
  x: FollowOp
  y: FollowOp
  /**
   * What the waiting side queues on: [y waits while x holds, x waits while y holds]. The table of a row lock, or
   * `table <name>` for a lock on a whole table (LOCK TABLE).
   */
  waitsOn: readonly [string, string]
  prepare?: (db: RealPg, w: FollowWorld) => Promise<void>
  xFirst: FollowExpectation
  yFirst: FollowExpectation
  /** after an unsynchronised race: whose transaction went first? (decides which expectation applies) */
  firstOf: (ctx: FollowCtx) => 'x' | 'y' | Promise<'x' | 'y'>
  /**
   * §7.3: the answer of this side (and the whole normalised view of `viewer` afterwards) is byte-identical in both
   * orders. `extra`: the list screens / cards / link peeks to include in the view.
   */
  sameInBothOrders?: {
    side: 'x' | 'y'
    viewer: (w: FollowWorld) => string
    extra?: (w: FollowWorld) => FollowViewExtra
  }
  /** runs after the checks of every run, also when they fail (global state such as the red button) */
  cleanup?: (db: RealPg) => Promise<void>
}

const ONE_ROW: Outcome = { ok: true, value: 1 }
const REQUESTED: Outcome = { ok: true, value: { status: 'requested' } }
const requestedAt = (w: FollowWorld): Outcome => ({ ok: true, value: { status: 'requested', profile_id: w.paula } })
const TOKEN = /^[0-9a-f]{64}$/
const xOkFirst = ({ x }: FollowCtx): 'x' | 'y' => (x.ok ? 'x' : 'y')

/** The wish id `i` of L1 (0-based, oldest first). */
export function wish(w: FollowWorld, i: number): string {
  const id = w.wishes[i]
  if (id === undefined) throw new Error(`the follow world has no wish ${i}`)
  return id
}

/**
 * The losing call's refusal: with `hold` exactly `held` (it read before the commit and waited); a race may also give
 * one of `raceAlso` (READ COMMITTED: every statement sees the latest commit, so the first check that sees the winner
 * answers). Same rule as expectRefused in ./pairs.ts, for the follow world.
 */
export function expectRefusal(ctx: FollowCtx, out: Outcome, held: string, raceAlso: readonly string[] = []): void {
  if (ctx.schedule === 'hold' || raceAlso.length === 0) {
    expect(out).toEqual(rpcError(held))
    return
  }
  const allowed = [held, ...raceAlso]
  const refused = !out.ok && out.code === 'P0001' && allowed.includes(out.message)
  expect(refused, `expected a refusal with one of ${allowed.join(' | ')}, got ${JSON.stringify(out)}`).toBe(true)
}

function tokenOut(out: Outcome): string {
  if (!out.ok) throw new Error(`create_follow_link failed: ${JSON.stringify(out)}`)
  const token = (out.value as { token?: unknown }).token
  if (typeof token !== 'string') throw new Error(`create_follow_link: no token in ${JSON.stringify(out)}`)
  return token
}

interface MyReservationRow {
  wish_id: string | null
  wish_title: string
  occasion_id: string | null
  status: string
  end_reason: string | null
  list: { id: string; title: string; owner_name: string | null } | null
}
const myReservations = (db: RealPg, uid: string) => rpcAs<MyReservationRow[]>(db, uid, 'my_reservations')

/** Finn lost access: his reservation of „Wunsch 1“ ended with `reason`, he keeps only the snapshot (F23). */
/** 20261027200000: the giver sees his own reasons as they are, everything else as the one neutral 'unavailable' (Q1). */
const publicReason = (reason: string): string => (['by_reserver', 'member_left', 'unfollowed'].includes(reason) ? reason : 'unavailable')

async function finnKeepsOnlyTheSnapshot(db: RealPg, w: FollowWorld, reason: string): Promise<void> {
  expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'ended', end_reason: reason }])
  expect(await myReservations(db, w.finn)).toEqual([
    expect.objectContaining({ wish_id: null, wish_title: 'Wunsch 1', occasion_id: null, status: 'ended', end_reason: publicReason(reason), list: null }),
  ])
}

const reserve = (who: 'finn' | 'greta', i: number, tab = ''): FollowOp =>
  rpcOp(`reserve_wish (${who === 'finn' ? 'Finn' : 'Greta'}${tab}, Wunsch ${i + 1})`, 'reserve_wish', (w) => w[who], (w) => [wish(w, i)])
const reserveFinn = reserve('finn', 0)
const acceptRosa = rpcOp('respond_follow (Paula accepts Rosa)', 'respond_follow', (w) => w.paula, (w) => [w.rosa, true])
const viaLink = (who: 'xaver' | 'ida' | 'rosa', label: string): FollowOp =>
  rpcOp(`request_follow_via_link (${label})`, 'request_follow_via_link', (w) => w[who], (w) => [w.token])
const requestMoritz = rpcOp('request_follow (Moritz → Paula)', 'request_follow', (w) => w.moritz, (w) => [w.paula])

/** Paula's extra live links (her seeded link stays the oldest). */
async function morePaulaLinks(db: RealPg, w: FollowWorld, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await rpcAs(db, w.paula, 'create_follow_link')
}

async function finnReserves(db: RealPg, w: FollowWorld, indexes: readonly number[]): Promise<void> {
  for (const i of indexes) expect(await rpcAs(db, w.finn, 'reserve_wish', [wish(w, i)])).toEqual({ ok: true })
}

const listExists = (db: RealPg, id: string) => db.admin.value<boolean>('select exists (select 1 from public.wishlists where id = $1)', [id])
const memberStatusIn = async (db: RealPg, occasion: string, uid: string): Promise<string | null> =>
  (await db.admin.rows<{ status: string }>('select status from public.occasion_members where occasion_id = $1 and profile_id = $2', [occasion, uid]))[0]
    ?.status ?? null

/** The emergency template, exactly as written (follows-design §9; it is NOT a migration). */
export const RED_BUTTON_SQL = readFileSync(new URL('../../../../supabase/emergency/follower_lists_off.sql', import.meta.url), 'utf8')
const redButtonOff = (db: RealPg) => db.admin.value<boolean>('select not follower_lists from private.features')

export const FOLLOW_PAIRS: readonly FollowPair[] = [
  {
    id: 'C01',
    name: 'reserve_wish ↔ remove_follower',
    x: reserveFinn,
    y: rpcOp('remove_follower (Paula removes Finn)', 'remove_follower', (w) => w.paula, (w) => [w.finn]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the new reservation ends as access_ended, Finn keeps only the snapshot',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await followStatus(db, w.finn, w.paula)).toBe(null)
        expect(await hasCooldown(db, w.paula, w.finn)).toBe(true)
        await finnKeepsOnlyTheSnapshot(db, w, 'access_ended')
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await followStatus(db, w.finn, w.paula)).toBe(null)
        expect(await hasCooldown(db, w.paula, w.finn)).toBe(true)
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
    sameInBothOrders: { side: 'y', viewer: (w) => w.paula, extra: (w) => ({ lists: [w.l1], cards: [w.finn] }) },
  },
  {
    id: 'C02',
    name: 'reserve_wish ↔ unfollow (Finn’s second tab)',
    x: reserveFinn,
    y: rpcOp('unfollow (Finn, second tab)', 'unfollow', (w) => w.finn, (w) => [w.paula]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the new reservation ends as unfollowed',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await followStatus(db, w.finn, w.paula)).toBe(null)
        expect(await hasCooldown(db, w.paula, w.finn)).toBe(false) // unfollowing is no refusal
        await finnKeepsOnlyTheSnapshot(db, w, 'unfollowed')
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await followStatus(db, w.finn, w.paula)).toBe(null)
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C03',
    name: 'reserve_wish ↔ set_list_visibility(private)',
    x: reserveFinn,
    y: rpcOp('set_list_visibility (Paula: L1 → Nur ich)', 'set_list_visibility', (w) => w.paula, (w) => [w.l1, 'private']),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the new reservation ends as access_ended, the list is private',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await visibilityOf(db, w.l1)).toBe('private')
        expect(await followStatus(db, w.finn, w.paula)).toBe('accepted') // Finn still follows, the list is hidden
        await finnKeepsOnlyTheSnapshot(db, w, 'access_ended')
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed on the hidden list, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await visibilityOf(db, w.l1)).toBe('private')
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
    sameInBothOrders: { side: 'y', viewer: (w) => w.paula, extra: (w) => ({ lists: [w.l1], cards: [w.finn] }) },
  },
  {
    id: 'C04',
    name: 'reserve_wish ↔ block_user (Paula blocks Finn)',
    x: reserveFinn,
    y: rpcOp('block_user (Paula blocks Finn)', 'block_user', (w) => w.paula, (w) => [w.finn]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the new reservation ends as access_ended, no follows row left in the pair',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await isBlocked(db, w.paula, w.finn)).toBe(true)
        expect(await followRowsBetween(db, w.paula, w.finn)).toBe(0)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'ended', end_reason: 'access_ended' }])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await followRowsBetween(db, w.paula, w.finn)).toBe(0)
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
    sameInBothOrders: { side: 'y', viewer: (w) => w.paula, extra: (w) => ({ lists: [w.l1] }) },
  },
  {
    id: 'C05',
    name: 'reserve_wish ↔ block_user (Finn blocks Paula)',
    x: reserveFinn,
    y: rpcOp('block_user (Finn blocks Paula, second tab)', 'block_user', (w) => w.finn, (w) => [w.paula]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the new reservation is dead (the cleanup ends it as access_ended), no follows row left',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await isBlocked(db, w.finn, w.paula)).toBe(true)
        expect(await followRowsBetween(db, w.paula, w.finn)).toBe(0)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'ended', end_reason: 'access_ended' }])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_allowed, no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await followRowsBetween(db, w.paula, w.finn)).toBe(0)
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C06',
    name: 'reserve_wish ↔ REST delete of L1',
    x: reserveFinn,
    y: restOp('DELETE wishlists L1 (Paula, REST)', 'delete from public.wishlists where id = $1', (w) => w.paula, (w) => [w.l1]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation ends as wish_deleted',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(ONE_ROW)
        expect(await listExists(db, w.l1)).toBe(false)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_found, like for a list deleted earlier',
      async check(ctx) {
        const { db, w, x, y } = ctx
        expect(y).toEqual(ONE_ROW)
        // race: the delete may commit between reserve_wish's reads of the wish and of the list → the list fields
        // are null, no accepted follow of "nobody" exists → not_allowed (the pilot's twin pair has the same note)
        expectRefusal(ctx, x, 'not_found', ['not_allowed'])
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C07',
    name: 'reserve_wish ↔ REST delete of the wish',
    x: reserveFinn,
    y: restOp('DELETE wishes „Wunsch 1“ (Paula, REST)', 'delete from public.wishes where id = $1', (w) => w.paula, (w) => [wish(w, 0)]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation ends as wish_deleted, Finn still sees the list live',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(ONE_ROW)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
        expect(await myReservations(db, w.finn)).toEqual([
          expect.objectContaining({
            wish_id: null,
            wish_title: 'Wunsch 1',
            status: 'ended',
            end_reason: 'unavailable', // 20261027200000: the neutral public reason, no context
            list: null,
          }),
        ])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_found',
      async check({ db, w, x, y }) {
        expect(y).toEqual(ONE_ROW)
        expect(x).toEqual(rpcError('not_found'))
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C08',
    name: 'reserve_wish ↔ reserve_wish (Finn and Greta, one wish)',
    x: reserveFinn,
    y: reserve('greta', 0),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Greta gets already_reserved (never a raw 23505), one active reservation',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(rpcError('already_reserved'))
        expect(await activeReserversOf(db, wish(w, 0))).toEqual([w.finn])
        expect(await reservationsBy(db, w.greta)).toEqual([])
      },
    },
    yFirst: {
      says: 'Finn gets already_reserved, one active reservation',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('already_reserved'))
        expect(await activeReserversOf(db, wish(w, 0))).toEqual([w.greta])
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C09',
    name: 'respond_follow(accept) ↔ unfollow (Rosa withdraws)',
    x: acceptRosa,
    y: rpcOp('unfollow (Rosa withdraws her request)', 'unfollow', (w) => w.rosa, (w) => [w.paula]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'accepted, then withdrawn: no row',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await followStatus(db, w.rosa, w.paula)).toBe(null)
      },
    },
    yFirst: {
      says: 'respond_follow → not_found, no row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await followStatus(db, w.rosa, w.paula)).toBe(null)
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C10a',
    name: 'respond_follow(accept) ↔ block_user (Paula blocks Rosa)',
    x: acceptRosa,
    y: rpcOp('block_user (Paula blocks Rosa, second tab)', 'block_user', (w) => w.paula, (w) => [w.rosa]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'accepted, then the block deletes the follow (INV-5)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await isBlocked(db, w.paula, w.rosa)).toBe(true)
        expect(await followRowsBetween(db, w.paula, w.rosa)).toBe(0)
      },
    },
    yFirst: {
      says: 'the block wins, respond_follow → not_found',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await followRowsBetween(db, w.paula, w.rosa)).toBe(0)
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C10b',
    name: 'respond_follow(accept) ↔ block_user (Rosa blocks Paula)',
    x: acceptRosa,
    y: rpcOp('block_user (Rosa blocks Paula)', 'block_user', (w) => w.rosa, (w) => [w.paula]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'accepted, then the block deletes the follow (INV-5)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await isBlocked(db, w.rosa, w.paula)).toBe(true)
        expect(await followRowsBetween(db, w.paula, w.rosa)).toBe(0)
      },
    },
    yFirst: {
      says: 'the block wins, respond_follow → not_found',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await followRowsBetween(db, w.paula, w.rosa)).toBe(0)
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C11',
    name: 'request_follow_via_link ↔ revoke_follow_links',
    x: viaLink('xaver', 'Xaver, a new person'),
    y: rpcOp('revoke_follow_links (Paula)', 'revoke_follow_links', (w) => w.paula),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Xaver is requested (a place is taken), then the link is switched off',
      async check({ db, w, x, y }) {
        expect(x).toEqual(requestedAt(w))
        expect(y).toEqual(OK)
        expect(await followStatus(db, w.xaver, w.paula)).toBe('pending')
        expect(await followLink(db, w)).toEqual({ use_count: 4, revoked: true })
        expect(await liveFollowLinks(db, w.paula)).toBe(0)
      },
    },
    yFirst: {
      says: 'request_follow_via_link → invite_invalid, no row, no place taken',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await followStatus(db, w.xaver, w.paula)).toBe(null)
        expect(await followLink(db, w)).toEqual({ use_count: 3, revoked: true })
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C12',
    name: 'request_follow_via_link ↔ create_follow_link (the sixth link switches this one off)',
    x: viaLink('xaver', 'Xaver, through Paula’s oldest live link'),
    y: rpcOp('create_follow_link (Paula, the sixth)', 'create_follow_link', (w) => w.paula),
    waitsOn: ['profiles', 'profiles'],
    // Paula has 5 live links; the seeded one is the oldest, so the sixth switches exactly it off
    prepare: (db, w) => morePaulaLinks(db, w, 4),
    xFirst: {
      says: 'Xaver is requested, then the oldest link goes; 5 live',
      async check({ db, w, x, y }) {
        expect(x).toEqual(requestedAt(w))
        expect(tokenOut(y)).toMatch(TOKEN)
        expect(await followStatus(db, w.xaver, w.paula)).toBe('pending')
        expect(await followLink(db, w)).toEqual({ use_count: 4, revoked: true })
        expect(await isLiveFollowToken(db, tokenOut(y))).toBe(true)
        expect(await liveFollowLinks(db, w.paula)).toBe(5)
      },
    },
    yFirst: {
      says: 'request_follow_via_link → invite_invalid, no row; 5 live',
      async check({ db, w, x, y }) {
        expect(tokenOut(y)).toMatch(TOKEN)
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await followStatus(db, w.xaver, w.paula)).toBe(null)
        expect(await followLink(db, w)).toEqual({ use_count: 3, revoked: true })
        expect(await isLiveFollowToken(db, tokenOut(y))).toBe(true)
        expect(await liveFollowLinks(db, w.paula)).toBe(5)
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C13',
    name: 'request_follow (A → B) ↔ request_follow (B → A)',
    x: requestMoritz,
    y: rpcOp('request_follow (Paula → Moritz)', 'request_follow', (w) => w.paula, (w) => [w.moritz]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both requested, no deadlock (one pair lock in UUID order)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(REQUESTED)
        expect(y).toEqual(REQUESTED)
        expect(await followStatus(db, w.moritz, w.paula)).toBe('pending')
        expect(await followStatus(db, w.paula, w.moritz)).toBe('pending')
      },
    },
    yFirst: {
      says: 'both requested, no deadlock (one pair lock in UUID order)',
      async check({ db, w, x, y }) {
        expect(y).toEqual(REQUESTED)
        expect(x).toEqual(REQUESTED)
        expect(await followStatus(db, w.moritz, w.paula)).toBe('pending')
        expect(await followStatus(db, w.paula, w.moritz)).toBe('pending')
      },
    },
    // Both orders end in the same state, so this is for the statistics only: the transaction that reached the pair
    // lock first got the smaller transaction id (assigned when it starts locking the profile rows).
    firstOf: async ({ db, w }) =>
      (await db.admin.value<boolean>(
        `select (select xmin::text::bigint from public.follows where follower_id = $1 and followee_id = $2)
              < (select xmin::text::bigint from public.follows where follower_id = $2 and followee_id = $1)`,
        [w.moritz, w.paula],
      ))
        ? 'x'
        : 'y',
  },
  {
    id: 'C14',
    name: 'create_follow_link ↔ create_follow_link (two tabs)',
    x: rpcOp('create_follow_link (Paula, tab 1)', 'create_follow_link', (w) => w.paula),
    y: rpcOp('create_follow_link (Paula, tab 2)', 'create_follow_link', (w) => w.paula),
    waitsOn: ['profiles', 'profiles'],
    // 4 live links before: the first new one makes 5, the second one switches the oldest (the seeded) off
    prepare: (db, w) => morePaulaLinks(db, w, 3),
    xFirst: {
      says: 'both codes issued and live, at most 5 live, the oldest switched off',
      async check({ db, w, x, y }) {
        const [a, b] = [tokenOut(x), tokenOut(y)]
        expect(a).toMatch(TOKEN)
        expect(b).toMatch(TOKEN)
        expect(a).not.toBe(b)
        expect(await isLiveFollowToken(db, a)).toBe(true)
        expect(await isLiveFollowToken(db, b)).toBe(true)
        expect(await liveFollowLinks(db, w.paula)).toBe(5)
        expect(await isLiveFollowToken(db, w.token)).toBe(false)
      },
    },
    yFirst: {
      says: 'both codes issued and live, at most 5 live, the oldest switched off',
      async check({ db, w, x, y }) {
        const [a, b] = [tokenOut(x), tokenOut(y)]
        expect(a).not.toBe(b)
        expect(await isLiveFollowToken(db, a)).toBe(true)
        expect(await isLiveFollowToken(db, b)).toBe(true)
        expect(await liveFollowLinks(db, w.paula)).toBe(5)
        expect(await isLiveFollowToken(db, w.token)).toBe(false)
      },
    },
    // the link inserted first (created_at = clock_timestamp() after the pair lock) belongs to the first commit
    firstOf: async ({ db, x, y }) =>
      (await db.admin.value<boolean>(
        `select (select created_at from public.follow_links where token_hash = sha256(convert_to($1, 'UTF8')))
              < (select created_at from public.follow_links where token_hash = sha256(convert_to($2, 'UTF8')))`,
        [tokenOut(x), tokenOut(y)],
      ))
        ? 'x'
        : 'y',
  },
  {
    id: 'C15',
    name: 'set_list_visibility ↔ set_list_visibility (two tabs: Nur ich / Meine Follower)',
    x: rpcOp('set_list_visibility (Paula tab 1: → private)', 'set_list_visibility', (w) => w.paula, (w) => [w.l1, 'private']),
    y: rpcOp('set_list_visibility (Paula tab 2: → followers)', 'set_list_visibility', (w) => w.paula, (w) => [w.l1, 'followers']),
    waitsOn: ['profiles', 'profiles'],
    // Finn holds an active reservation on L1
    prepare: (db, w) => finnReserves(db, w, [0]),
    xFirst: {
      // 20261027200000 (lazy liveness, Q20 default): neither switch touches the reservation; back to followers before
      // the cleanup came by → it is live again
      says: 'the last commit wins (followers); the reservation was never ended and is live again',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await visibilityOf(db, w.l1)).toBe('followers')
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'active', end_reason: null }])
      },
    },
    yFirst: {
      says: 'the last commit wins (private); the cleanup ends the reservation exactly once',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await visibilityOf(db, w.l1)).toBe('private')
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'ended', end_reason: 'access_ended' }])
      },
    },
    firstOf: async ({ db, w }) => ((await visibilityOf(db, w.l1)) === 'followers' ? 'x' : 'y'),
  },
  {
    id: 'C16',
    name: 'respond_follow(accept) ↔ delete_my_account (Rosa)',
    x: acceptRosa,
    y: rpcOp('delete_my_account (Rosa)', 'delete_my_account', (w) => w.rosa),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'accepted, then removed by the cascade (never a raw 23503)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await accountExists(db, w.rosa)).toBe(false)
        expect(await followRowsBetween(db, w.paula, w.rosa)).toBe(0)
      },
    },
    yFirst: {
      says: 'respond_follow → not_found, the account is gone',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await accountExists(db, w.rosa)).toBe(false)
        expect(await followRowsBetween(db, w.paula, w.rosa)).toBe(0)
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C17',
    name: 'remove_follower ↔ unfollow (one row)',
    x: rpcOp('remove_follower (Paula removes Finn)', 'remove_follower', (w) => w.paula, (w) => [w.finn]),
    y: rpcOp('unfollow (Finn unfollows Paula)', 'unfollow', (w) => w.finn, (w) => [w.paula]),
    waitsOn: ['profiles', 'profiles'],
    // Finn holds an active reservation on L1: its end reason tells who deleted the row
    prepare: (db, w) => finnReserves(db, w, [0]),
    xFirst: {
      says: 'the removal deletes it (silence, access_ended); unfollow → ok',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await followStatus(db, w.finn, w.paula)).toBe(null)
        expect(await hasCooldown(db, w.paula, w.finn)).toBe(true)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'ended', end_reason: 'access_ended' }])
      },
    },
    yFirst: {
      says: 'unfollow deletes it (unfollowed); remove_follower → not_found',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await followStatus(db, w.finn, w.paula)).toBe(null)
        expect(await hasCooldown(db, w.paula, w.finn)).toBe(false)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'ended', end_reason: 'unfollowed' }])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C18',
    name: 'respond_follow(refuse) ↔ request_follow_via_link (Rosa asks again after withdrawing)',
    x: rpcOp('respond_follow (Paula refuses Rosa’s old request)', 'respond_follow', (w) => w.paula, (w) => [w.rosa, false]),
    y: viaLink('rosa', 'Rosa asks again'),
    // x first = the refusal decides before Rosa's new request exists: it fails (not_found), and a failed call holds
    // no lock (holdFollow), so Rosa's request then runs alone; y first = the refusal waits for Rosa's pair lock
    waitsOn: ['nothing', 'profiles'],
    // Rosa withdrew her request; Paula's people screen still shows it
    prepare: async (db, w) => {
      expect(await rpcAs(db, w.rosa, 'unfollow', [w.paula])).toEqual({ ok: true })
    },
    xFirst: {
      says: 'the refusal finds nothing (not_found); Rosa → requested, not hidden',
      async check({ db, w, x, y }) {
        expect(x).toEqual(rpcError('not_found'))
        expect(y).toEqual(requestedAt(w))
        expect(await followStatus(db, w.rosa, w.paula)).toBe('pending')
        expect(await hasCooldown(db, w.paula, w.rosa)).toBe(false)
        expect(await followLink(db, w)).toEqual({ use_count: 4, revoked: false })
      },
    },
    yFirst: {
      says: 'Rosa → requested, then silently refused (silence row); Rosa’s answer the same',
      async check({ db, w, x, y }) {
        expect(y).toEqual(requestedAt(w))
        expect(x).toEqual(OK)
        expect(await followStatus(db, w.rosa, w.paula)).toBe('pending') // the request row stays (silent refusal)
        expect(await hasCooldown(db, w.paula, w.rosa)).toBe(true)
        expect(await followLink(db, w)).toEqual({ use_count: 4, revoked: false })
      },
    },
    // the refusal succeeds only when Rosa's new request committed before it
    firstOf: ({ x }) => (x.ok ? 'y' : 'x'),
    sameInBothOrders: { side: 'y', viewer: (w) => w.rosa, extra: (w) => ({ cards: [w.paula], tokens: [w.token] }) },
  },
  {
    id: 'C19',
    name: 'reserve_wish ↔ delete_my_account (Paula)',
    x: reserveFinn,
    y: rpcOp('delete_my_account (Paula)', 'delete_my_account', (w) => w.paula),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the reservation and the list are gone with the account (cascade)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(OK)
        expect(await accountExists(db, w.paula)).toBe(false)
        expect(await listExists(db, w.l1)).toBe(false)
        expect(await reservationsBy(db, w.finn)).toEqual([])
        expect(await myReservations(db, w.finn)).toEqual([])
      },
    },
    yFirst: {
      says: 'reserve_wish → not_found (§7.3), no reservation row',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await accountExists(db, w.paula)).toBe(false)
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C20a',
    name: 'request_follow ↔ block_user (Paula blocks the requester)',
    x: requestMoritz,
    y: rpcOp('block_user (Paula blocks Moritz)', 'block_user', (w) => w.paula, (w) => [w.moritz]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'requested, then the block deletes the row (INV-5)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(REQUESTED)
        expect(y).toEqual(OK)
        expect(await followRowsBetween(db, w.paula, w.moritz)).toBe(0)
        expect(await memberStatusIn(db, w.o1, w.moritz)).toBe('removed')
      },
    },
    yFirst: {
      says: 'the block first: request_follow → not_found',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await followRowsBetween(db, w.paula, w.moritz)).toBe(0)
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C20b',
    name: 'request_follow ↔ block_user (the requester blocks, second tab)',
    x: requestMoritz,
    y: rpcOp('block_user (Moritz blocks Paula, second tab)', 'block_user', (w) => w.moritz, (w) => [w.paula]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'requested, then the block deletes the row (INV-5)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(REQUESTED)
        expect(y).toEqual(OK)
        expect(await followRowsBetween(db, w.paula, w.moritz)).toBe(0)
        expect(await memberStatusIn(db, w.o1, w.moritz)).toBe('left')
      },
    },
    yFirst: {
      says: 'the block first: request_follow → not_found',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('not_found'))
        expect(await followRowsBetween(db, w.paula, w.moritz)).toBe(0)
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C21',
    name: 'request_follow_via_link ↔ block_user (Paula blocks the requester)',
    x: viaLink('xaver', 'Xaver'),
    y: rpcOp('block_user (Paula blocks Xaver)', 'block_user', (w) => w.paula, (w) => [w.xaver]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'requested, then the block deletes the row (INV-5)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(requestedAt(w))
        expect(y).toEqual(OK)
        expect(await followRowsBetween(db, w.paula, w.xaver)).toBe(0)
        expect(await followLink(db, w)).toEqual({ use_count: 4, revoked: false })
      },
    },
    yFirst: {
      says: 'the block first: request_follow_via_link → invite_invalid, no place taken',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await followRowsBetween(db, w.paula, w.xaver)).toBe(0)
        expect(await followLink(db, w)).toEqual({ use_count: 3, revoked: false })
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C22',
    name: 'reserve_wish ↔ reserve_wish (Finn’s two tabs at the cap of 5)',
    x: reserve('finn', 4, ' tab 1'),
    y: reserve('finn', 5, ' tab 2'),
    waitsOn: ['profiles', 'profiles'],
    // Finn already holds 4 active reservations on Paula's list
    prepare: (db, w) => finnReserves(db, w, [0, 1, 2, 3]),
    xFirst: {
      says: 'tab 1 ok, tab 2 limit_reached; exactly 5 active',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(rpcError('limit_reached'))
        expect(await activeStandaloneReservations(db, w.finn, w.paula)).toBe(5)
        expect(await activeReserversOf(db, wish(w, 4))).toEqual([w.finn])
        expect(await activeReserversOf(db, wish(w, 5))).toEqual([])
      },
    },
    yFirst: {
      says: 'tab 2 ok, tab 1 limit_reached; exactly 5 active',
      async check({ db, w, x, y }) {
        expect(y).toEqual(OK)
        expect(x).toEqual(rpcError('limit_reached'))
        expect(await activeStandaloneReservations(db, w.finn, w.paula)).toBe(5)
        expect(await activeReserversOf(db, wish(w, 5))).toEqual([w.finn])
        expect(await activeReserversOf(db, wish(w, 4))).toEqual([])
      },
    },
    firstOf: xOkFirst,
  },
  {
    id: 'C23',
    name: 'request_follow_via_link ↔ request_follow_via_link (two new people, the link’s last place)',
    x: viaLink('xaver', 'Xaver'),
    y: viaLink('ida', 'Ida'),
    waitsOn: ['profiles', 'profiles'],
    prepare: async (db, w) => {
      await db.admin.query('update public.follow_links set use_count = 19 where id = $1', [w.linkId])
    },
    xFirst: {
      says: 'Xaver takes the place, Ida gets invite_invalid; use_count 20',
      async check({ db, w, x, y }) {
        expect(x).toEqual(requestedAt(w))
        expect(y).toEqual(rpcError('invite_invalid'))
        expect(await followStatus(db, w.xaver, w.paula)).toBe('pending')
        expect(await followStatus(db, w.ida, w.paula)).toBe(null)
        expect(await followLink(db, w)).toEqual({ use_count: 20, revoked: false })
      },
    },
    yFirst: {
      says: 'Ida takes the place, Xaver gets invite_invalid; use_count 20',
      async check({ db, w, x, y }) {
        expect(y).toEqual(requestedAt(w))
        expect(x).toEqual(rpcError('invite_invalid'))
        expect(await followStatus(db, w.ida, w.paula)).toBe('pending')
        expect(await followStatus(db, w.xaver, w.paula)).toBe(null)
        expect(await followLink(db, w)).toEqual({ use_count: 20, revoked: false })
      },
    },
    firstOf: xOkFirst,
  },
]

/**
 * Not in the §7.3 list (added like the pilot's extra pairs, docs/decisions/0002-…):
 *   R1  the database "red button" (supabase/emergency/follower_lists_off.sql, follows-design §9, A14) against a running
 *       follower reservation: its first LOCK TABLE profiles IN EXCLUSIVE MODE must wait for the reservation's pair
 *       lock (then it also locks follows), so INV-1 holds and account-deletion cascades cannot invert the lock order;
 *   R2  cancel_reservation (no pair lock) against the loss of access — ADR-0002 listed cancel_reservation as never raced;
 *   R3  two tabs of the owner: "Nur ich" against deleting the same list.
 */
export const EXTRA_FOLLOW_PAIRS: readonly FollowPair[] = [
  {
    id: 'R1',
    name: 'reserve_wish ↔ the red button (emergency template)',
    x: reserveFinn,
    y: { label: 'the red button (supabase/emergency/follower_lists_off.sql)', as: () => null, run: (s) => s.query(RED_BUTTON_SQL) },
    waitsOn: ['table profiles', 'table profiles'],
    xFirst: {
      says: 'the button waits for the reservation, then ends it (access_ended)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y.ok, JSON.stringify(y)).toBe(true)
        expect(await redButtonOff(db)).toBe(true)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: wish(w, 0), status: 'ended', end_reason: 'access_ended' }])
      },
    },
    yFirst: {
      says: 'reserve_wish waits for the button, then → not_allowed',
      async check({ db, w, x, y }) {
        expect(y.ok, JSON.stringify(y)).toBe(true)
        expect(x).toEqual(rpcError('not_allowed'))
        expect(await redButtonOff(db)).toBe(true)
        expect(await reservationsBy(db, w.finn)).toEqual([])
      },
    },
    firstOf: xOkFirst,
    // switch follower lists on again (follows-design §9): the next run starts from the normal state
    cleanup: async (db) => {
      await db.admin.query('update private.features set follower_lists = true')
    },
  },
  // R2 (cancel_reservation ↔ remove_follower) is gone with 20261027200000: remove_follower no longer touches
  // reservations, so the two never meet on a row. The giver's own write against the job that ends dead rows (the
  // one place where two writers can meet on a reservation row now) is SC-CL1/SC-CL2 in shared-wishes.test.ts.
  {
    id: 'R3',
    name: 'set_list_visibility(private) ↔ REST delete of L1 (two tabs of Paula)',
    x: rpcOp('set_list_visibility (Paula: L1 → Nur ich)', 'set_list_visibility', (w) => w.paula, (w) => [w.l1, 'private']),
    y: restOp('DELETE wishlists L1 (Paula, second tab)', 'delete from public.wishlists where id = $1', (w) => w.paula, (w) => [w.l1]),
    waitsOn: ['profiles', 'profiles'],
    prepare: (db, w) => finnReserves(db, w, [0]),
    xFirst: {
      // 20261027200000: neither touches reservations; the cleanup finds the wish gone in both orders
      says: 'hidden, then deleted; the cleanup ends the reservation once (wish_deleted)',
      async check({ db, w, x, y }) {
        expect(x).toEqual(OK)
        expect(y).toEqual(ONE_ROW)
        expect(await listExists(db, w.l1)).toBe(false)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
      },
    },
    yFirst: {
      says: 'deleted (wish_deleted); set_list_visibility → not_found',
      async check({ db, w, x, y }) {
        expect(y).toEqual(ONE_ROW)
        expect(x).toEqual(rpcError('not_found'))
        expect(await listExists(db, w.l1)).toBe(false)
        expect(await reservationsBy(db, w.finn)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
      },
    },
    firstOf: xOkFirst,
  },
]

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

async function beginAs(s: Session, uid: string | null): Promise<void> {
  await (uid === null ? s.begin() : s.begin(uid))
}

export interface FollowHold {
  first: Outcome
  second: Outcome
  /** null when the first call failed (it held nothing, see holdFollow) */
  block: BlockInfo | null
  /** what the second operation queued on: the table of a row lock, `table <name>` for a table lock, or 'nothing' */
  waitedOn: string
}

/** The table of the lock the waiter queues for: its tuple lock (a row), else its ungranted relation lock. */
async function waitedOn(db: RealPg, waiter: Session, block: BlockInfo): Promise<string> {
  if (block.rowLockOn !== null) return block.rowLockOn
  const rel = await db.admin.rows<{ relname: string }>(
    `select c.relname from pg_locks l join pg_class c on c.oid = l.relation
      where l.pid = $1 and l.locktype = 'relation' and not l.granted order by c.relname limit 1`,
    [waiter.pid],
  )
  return rel[0] ? `table ${rel[0].relname}` : `unknown (${block.waitEvent ?? 'no wait event'})`
}

/**
 * `first` runs in an open transaction on `holder` (all its locks taken), `second` starts on `waiter` and must block
 * on the holder; then the holder commits and `second` finishes.
 * A `first` that FAILS holds nothing: an error aborts the transaction at once (AbortTransaction frees every lock
 * before the client's ROLLBACK arrives), exactly like a refused PostgREST call. Then the serial order "first, then
 * second" is simply the second call running alone afterwards (waitedOn = 'nothing').
 */
export async function holdFollow(db: RealPg, holder: Session, waiter: Session, w: FollowWorld, first: FollowOp, second: FollowOp): Promise<FollowHold> {
  await beginAs(holder, first.as(w))
  const firstOut = await settle(first.run(holder, w))
  if (!firstOut.ok) {
    await holder.rollback()
    await beginAs(waiter, second.as(w))
    const alone = await settle(second.run(waiter, w))
    await (alone.ok ? waiter.commit() : waiter.rollback())
    return { first: firstOut, second: alone, block: null, waitedOn: 'nothing' }
  }
  await beginAs(waiter, second.as(w))
  const pending = settle(second.run(waiter, w))
  let block: BlockInfo
  let on: string
  try {
    block = await db.waitUntilBlocked(waiter, holder, pending)
    on = await waitedOn(db, waiter, block)
  } catch (err) {
    // leave both sessions usable for the next test, then report
    await holder.rollback().catch(() => undefined)
    await pending
    await waiter.rollback().catch(() => undefined)
    throw err
  }
  await holder.commit()
  const secondOut = await pending
  await (secondOut.ok ? waiter.commit() : waiter.rollback())
  return { first: firstOut, second: secondOut, block, waitedOn: on }
}

async function asRequest(s: Session, w: FollowWorld, op: FollowOp, delayRoundTrips = 0): Promise<Outcome> {
  for (let i = 0; i < delayRoundTrips; i++) await s.query('select 1')
  await beginAs(s, op.as(w))
  const out = await settle(op.run(s, w))
  await (out.ok ? s.commit() : s.rollback())
  return out
}

/** x and y sent at the same moment on two connections; the later socket is held back by `stagger` round trips. */
export async function raceFollow(
  sessions: readonly [Session, Session],
  w: FollowWorld,
  x: FollowOp,
  y: FollowOp,
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
export function raceManyFollow(sessions: readonly Session[], w: FollowWorld, ops: readonly FollowOp[]): Promise<Outcome[]> {
  if (ops.length > sessions.length) throw new Error(`raceManyFollow: ${ops.length} operations but ${sessions.length} sessions`)
  return Promise.all(ops.map((op, i) => asRequest(sessions[i] as Session, w, op)))
}

export async function seedForPair(db: RealPg, pair: FollowPair, opts: { extraOutsiders?: number } = {}): Promise<FollowWorld> {
  const w = await seedFollowWorld(db, opts)
  await pair.prepare?.(db, w)
  return w
}

// ---------------------------------------------------------------------------
// Invariants after every run (follows-design §6.2)
// ---------------------------------------------------------------------------

export function cooldownsBefore(db: RealPg): Promise<CooldownRow[]> {
  return cooldownRows(db)
}

/** INV-1, INV-5, the pilot rules (all 0) and INV-6 against the silences taken before the run. */
export async function expectFollowInvariants(db: RealPg, before: readonly CooldownRow[], label: string): Promise<void> {
  expect(await inv1Violations(db), `${label}: INV-1 — an active reservation on a list its reserver cannot read`).toBe(0)
  expect(await inv5Violations(db), `${label}: INV-5 — a follows row inside a blocked pair`).toBe(0)
  expect(await pilotRuleViolations(db), `${label}: pilot — one active reservation per wish, never by owner / recipient`).toBe(0)
  expect(await cooldownsShortened(db, before), `${label}: INV-6 — a silence got shorter or vanished`).toEqual([])
}

/** Both outcomes are contract answers (never 40P01 / 55P03 / 57014 / 40001 / 23505 / 23503 or another raw error). */
export function expectContractAnswers(pair: FollowPair, out: { x: Outcome; y: Outcome }, label: string): void {
  expectContractOutcome(`${pair.x.label} (${label})`, out.x)
  expectContractOutcome(`${pair.y.label} (${label})`, out.y)
}

// ---------------------------------------------------------------------------
// One person's whole view, normalised (INV-2 / INV-3 across two worlds)
// ---------------------------------------------------------------------------

export interface FollowViewExtra {
  lists?: readonly string[]
  cards?: readonly string[]
  tokens?: readonly string[]
}

async function textAs(db: RealPg, uid: string, sql: string, params: readonly unknown[] = []): Promise<string> {
  const out = await settle(db.asUser(uid, (s) => s.value<string>(sql, params)))
  return out.ok ? out.value : `error:${out.code}:${out.message}`
}

/**
 * Everything `uid` can read: every SELECT-granted column of every API table (RLS applied; rows sorted after
 * normalising) and every read RPC as text (export without exported_at), plus list screens / cards / link peeks.
 */
export async function followView(db: RealPg, w: FollowWorld, uid: string, extra: FollowViewExtra = {}): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const tables = await db.admin.rows<{ table_name: string; cols: string }>(
    `select table_name, string_agg(column_name, ', ' order by column_name) as cols
       from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'
      group by table_name order by table_name`,
  )
  for (const t of tables) {
    const rows = await settle(db.asUser(uid, (s) => s.rows<{ j: string }>(`select to_jsonb(v)::text as j from (select ${t.cols} from public.${t.table_name}) v`)))
    out[`table:${t.table_name}`] = rows.ok
      ? rows.value
          .map((r) => normalize(r.j, w))
          .sort()
          .join('\n')
      : `error:${rows.code}:${rows.message}`
  }
  for (const fn of ['get_me', 'get_feed', 'get_lists_overview', 'get_people_screen', 'my_reservations']) {
    out[fn] = normalize(await textAs(db, uid, `select public.${fn}()::text`), w)
  }
  out['export'] = normalize(await textAs(db, uid, `select (public.export_my_data() - 'exported_at')::text`), w)
  for (const id of [uid, ...(extra.cards ?? [])]) {
    out[`card:${roleOf(w, id)}`] = normalize(await textAs(db, uid, 'select public.get_profile_card($1)::text', [id]), w)
  }
  for (const id of extra.lists ?? []) out[`list:${roleOf(w, id)}`] = normalize(await textAs(db, uid, 'select public.get_list_screen($1)::text', [id]), w)
  for (const [i, token] of (extra.tokens ?? []).entries()) {
    out[`peek:${i}`] = normalize(await textAs(db, uid, 'select public.peek_follow_link($1)::text', [token]), w)
  }
  return out
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?/g

function roleOf(w: FollowWorld, id: string): string {
  for (const [key, value] of Object.entries(w)) {
    if (value === id) return key
    if (Array.isArray(value)) {
      const i = value.indexOf(id)
      if (i >= 0) return `${key}[${i}]`
    }
  }
  return '<uuid>'
}

/** World ids → their role ("paula", "wishes[0]"), the link's code → <token>, every timestamp → T. */
export function normalize(text: string, w: FollowWorld): string {
  return text
    .split(w.token)
    .join('<token>')
    .replace(UUID_RE, (id) => `<${roleOf(w, id.toLowerCase())}>`)
    .replace(TIMESTAMP_RE, 'T')
}
