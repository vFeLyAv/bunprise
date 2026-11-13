/**
 * "Erhalten" and moving a wish under concurrency on real PostgreSQL 17 (docs/decisions/0002-concurrency-tests-real-
 * postgres.md; supabase/migrations/20261022160000_list_photos_received_move.sql, parts B and C). The follow world
 * (seedFollowWorld): Paula owns L1 ("Meine Follower": Finn + Greta) and the occasion O1 (Moritz is a guest).
 *   MV1 move_wish (L1 → O1's list) ↔ reserve_wish (Finn, no guest of O1)        the reservation ends as wish_moved / none
 *   MV2 move_wish (L1 → another follower list) ↔ reserve_wish (Finn)              the reservation follows the wish / none
 *   RC1 set_wish_received ↔ reserve_wish (Finn)                                   not_allowed / both ok, reservation kept
 *   RC2 set_wish_received (un-mark) ↔ reserve_wish (Finn)                         ok after the un-mark / not_allowed
 *   MD1 move_wish ↔ the owner deletes the wish (REST)                             wish_moved then deleted / not_found
 *   MD2 move_wish ↔ the owner deletes the target list (REST)                      moved and cascaded away / not_found
 *   LP1 set_list_photo ↔ the owner deletes the list (REST)                        cover cascaded away / not_found
 *   (MC1 move_wish ↔ cancel_reservation: removed with 20261027200000 — move_wish no longer touches reservations)
 * Since 20261027200000 (shared wishes, lazy liveness) no owner action ends a reservation: it is dead at once and the
 * cleanup job ends it ('access_ended' / 'wish_deleted'); the state helpers read the table after a cleanup pass.
 * Every pair in BOTH orders ("hold and wait": the second waits on the row the pair names), then ROUNDS unsynchronised
 * races: only contract codes (never 40P01 / 55P03 / 57014 / 40001 / 23505 / 23503), INV-1 / INV-5 / INV-6 and the
 * pilot rules after every run. For every pair that touches a reservation, Paula's answer and her WHOLE normalised view
 * (every REST column, every read RPC, the export, her list and occasion screens) are byte-identical in both orders —
 * one order has the reservation, the other never had it: the owner cannot tell.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type Outcome, type RealPg, type Session } from '../../src/realpg'
import {
  cooldownsBefore,
  expectContractAnswers,
  expectFollowInvariants,
  expectRefusal,
  followView,
  holdFollow,
  normalize,
  raceFollow,
  restOp,
  rpcOp,
  seedForPair,
  wish,
  type FollowCtx,
  type FollowPair,
} from './follow-pairs'
import { b64, fakeWebp } from '../pilot/photo-bytes'
import { OK, rpcError } from './pairs'
import { activeReserversOf, reservationsBy, rpcAs, type FollowWorld } from './world'

const ROUNDS = 12

/** Ids made in `prepare` (they are not part of the world), by Paula's id. */
const extra = new Map<string, { o1List: string; target: string }>()
const idsOf = (w: FollowWorld) => {
  const ids = extra.get(w.paula)
  if (!ids) throw new Error('prepare did not run for this world')
  return ids
}

async function o1ListOf(db: RealPg, w: FollowWorld): Promise<string> {
  return db.admin.value<string>('select id from public.wishlists where occasion_id = $1', [w.o1])
}
async function newList(db: RealPg, w: FollowWorld, title: string, visibility: 'private' | 'followers'): Promise<string> {
  return db.asUser(w.paula, (s) =>
    s.value<string>(`insert into public.wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, $2, $3) returning id`, [w.paula, title, visibility]),
  )
}
const listOf = (db: RealPg, wishId: string) => db.admin.value<string | null>('select (select wishlist_id from public.wishes where id = $1)', [wishId])
const receivedAt = (db: RealPg, wishId: string) => db.admin.value<string | null>('select (select received_at::text from public.wishes where id = $1)', [wishId])
// 20261027200000: the active reservers after a cleanup pass (reservations.wishlist_id is informational only now)
const activeOn = (db: RealPg, wishId: string) => activeReserversOf(db, wishId)

const moveTo = (label: string, target: (w: FollowWorld) => string) =>
  rpcOp(`move_wish (Paula, Wunsch 1 → ${label})`, 'move_wish', (w) => w.paula, (w) => [wish(w, 0), target(w)])
const moveToOccasion = moveTo("O1's list", (w) => idsOf(w).o1List)
const moveToTarget = (label: string) => moveTo(label, (w) => idsOf(w).target)
const reserveFinn = rpcOp('reserve_wish (Finn, Wunsch 1)', 'reserve_wish', (w) => w.finn, (w) => [wish(w, 0)])
const markReceived = (received: boolean) =>
  rpcOp(`set_wish_received (Paula, Wunsch 1, ${received})`, 'set_wish_received', (w) => w.paula, (w) => [wish(w, 0), received])
const RECEIVED_ANSWER = (out: Outcome) => out.ok && typeof (out.value as { received_at?: unknown }).received_at === 'string'
const COVER = fakeWebp(4096, 1)
const coverRows = (db: RealPg, listId: string) => db.admin.value<number>('select count(*)::int from public.list_photos where wishlist_id = $1', [listId])

async function prepareIds(db: RealPg, w: FollowWorld, target?: 'private' | 'followers'): Promise<void> {
  extra.set(w.paula, { o1List: await o1ListOf(db, w), target: target ? await newList(db, w, target === 'private' ? 'Nur für mich' : 'Zweite Liste', target) : '' })
}
async function finnReservesWish1(db: RealPg, w: FollowWorld): Promise<void> {
  expect(await rpcAs(db, w.finn, 'reserve_wish', [wish(w, 0)])).toEqual({ ok: true })
}

const PAIRS: readonly FollowPair[] = [
  {
    id: 'MV1',
    name: "move_wish (into O1's list) ↔ reserve_wish (a follower who is no guest of O1)",
    x: moveToOccasion,
    y: reserveFinn,
    waitsOn: ['profiles', 'profiles'],
    prepare: (db, w) => prepareIds(db, w),
    xFirst: {
      // 20261027200000: the wish is the same wish (same owner) on the occasion list, which Finn cannot read
      says: 'the wish now lives only on the occasion list: not_allowed, no reservation',
      async check(ctx: FollowCtx) {
        expect(ctx.x).toEqual(OK)
        expectRefusal(ctx, ctx.y, 'not_allowed')
        expect(await reservationsBy(ctx.db, ctx.w.finn)).toEqual([])
        expect(await listOf(ctx.db, wish(ctx.w, 0))).toBe(idsOf(ctx.w).o1List)
      },
    },
    yFirst: {
      says: 'the reservation lands; after the move it is dead and the cleanup ends it (access_ended)',
      async check(ctx: FollowCtx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(OK)
        expect(await reservationsBy(ctx.db, ctx.w.finn)).toEqual([{ wish_id: wish(ctx.w, 0), status: 'ended', end_reason: 'access_ended' }])
      },
    },
    firstOf: ({ y }) => (y.ok ? 'y' : 'x'),
    sameInBothOrders: { side: 'x', viewer: (w) => w.paula },
  },
  {
    id: 'MV2',
    name: 'move_wish (into another follower list) ↔ reserve_wish (a follower of both)',
    x: moveToTarget('L3, Meine Follower'),
    y: reserveFinn,
    waitsOn: ['profiles', 'profiles'],
    prepare: (db, w) => prepareIds(db, w, 'followers'),
    xFirst: {
      // 20261027200000: the wish keeps its identity across the move; Finn reads L3 too → he may reserve it there
      says: 'the wish moved to L3 while the reservation waited: Finn reads L3, the reservation lands',
      async check(ctx: FollowCtx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual(OK)
        expect(await activeOn(ctx.db, wish(ctx.w, 0))).toEqual([ctx.w.finn])
      },
    },
    yFirst: {
      says: 'the reservation lands and stays live on L3 (still active) — also when a race reserves on L3 directly',
      async check(ctx: FollowCtx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(OK)
        expect(await activeOn(ctx.db, wish(ctx.w, 0))).toEqual([ctx.w.finn])
      },
    },
    // both serial orders where Finn's call succeeds end in the same state
    firstOf: ({ y }) => (y.ok ? 'y' : 'x'),
    sameInBothOrders: { side: 'x', viewer: (w) => w.paula },
  },
  {
    id: 'RC1',
    name: 'set_wish_received ↔ reserve_wish (a follower)',
    x: markReceived(true),
    y: reserveFinn,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'a received wish is never newly reserved: not_allowed, no reservation',
      async check(ctx: FollowCtx) {
        expect(RECEIVED_ANSWER(ctx.x)).toBe(true)
        expect(ctx.y).toEqual(rpcError('not_allowed'))
        expect(await reservationsBy(ctx.db, ctx.w.finn)).toEqual([])
        expect(await receivedAt(ctx.db, wish(ctx.w, 0))).not.toBeNull()
      },
    },
    yFirst: {
      says: 'both succeed: the existing reservation stays active on the received wish',
      async check(ctx: FollowCtx) {
        expect(ctx.y).toEqual(OK)
        expect(RECEIVED_ANSWER(ctx.x)).toBe(true)
        expect(await activeOn(ctx.db, wish(ctx.w, 0))).toEqual([ctx.w.finn])
        expect(await receivedAt(ctx.db, wish(ctx.w, 0))).not.toBeNull()
      },
    },
    firstOf: ({ y }) => (y.ok ? 'y' : 'x'),
    sameInBothOrders: { side: 'x', viewer: (w) => w.paula, extra: (w) => ({ lists: [w.l1] }) },
  },
  {
    id: 'RC2',
    name: 'set_wish_received (un-mark) ↔ reserve_wish (a follower)',
    x: markReceived(false),
    y: reserveFinn,
    // a refused reservation holds nothing (holdFollow): then the un-mark simply runs after it
    waitsOn: ['profiles', 'nothing'],
    prepare: async (db, w) => {
      expect(await rpcAs<{ ok: boolean }>(db, w.paula, 'set_wish_received', [wish(w, 0), true])).toMatchObject({ ok: true })
    },
    xFirst: {
      says: 'the wish is open again: the reservation lands',
      async check(ctx: FollowCtx) {
        expect(ctx.x).toEqual({ ok: true, value: { ok: true, received_at: null } })
        expect(ctx.y).toEqual(OK)
        expect(await activeOn(ctx.db, wish(ctx.w, 0))).toEqual([ctx.w.finn])
      },
    },
    yFirst: {
      says: 'still received: not_allowed, then the un-mark; no reservation',
      async check(ctx: FollowCtx) {
        expect(ctx.y).toEqual(rpcError('not_allowed'))
        expect(ctx.x).toEqual({ ok: true, value: { ok: true, received_at: null } })
        expect(await reservationsBy(ctx.db, ctx.w.finn)).toEqual([])
      },
    },
    firstOf: ({ y }) => (y.ok ? 'x' : 'y'),
    sameInBothOrders: { side: 'x', viewer: (w) => w.paula, extra: (w) => ({ lists: [w.l1] }) },
  },
  {
    id: 'MD1',
    name: 'move_wish (into "Nur ich") ↔ the owner deletes the wish (REST, second tab) — with a reservation',
    x: moveToTarget('L2, Nur ich'),
    y: restOp('delete Wunsch 1 (Paula, REST)', 'delete from public.wishes where id = $1', (w) => w.paula, (w) => [wish(w, 0)]),
    waitsOn: ['profiles', 'profiles'],
    prepare: async (db, w) => {
      await prepareIds(db, w, 'private')
      await finnReservesWish1(db, w)
    },
    xFirst: {
      says: 'moved, then deleted; the cleanup ends the reservation as wish_deleted',
      async check(ctx: FollowCtx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await listOf(ctx.db, wish(ctx.w, 0))).toBeNull()
        expect(await reservationsBy(ctx.db, ctx.w.finn)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
      },
    },
    yFirst: {
      says: 'deleted (the reservation ends as wish_deleted), the move answers not_found',
      async check(ctx: FollowCtx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await reservationsBy(ctx.db, ctx.w.finn)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    id: 'MD2',
    name: 'move_wish (into a new list) ↔ the owner deletes that list (REST, second tab) — with a reservation',
    x: moveToTarget('L2, Nur ich'),
    y: restOp('delete L2 (Paula, REST)', 'delete from public.wishlists where id = $1', (w) => w.paula, (w) => [idsOf(w).target]),
    waitsOn: ['profiles', 'profiles'],
    prepare: async (db, w) => {
      await prepareIds(db, w, 'private')
      await finnReservesWish1(db, w)
    },
    xFirst: {
      says: 'the wish moves into the list and goes with it (cascade); the cleanup ends the reservation as wish_deleted',
      async check(ctx: FollowCtx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await listOf(ctx.db, wish(ctx.w, 0))).toBeNull()
        expect(await reservationsBy(ctx.db, ctx.w.finn)).toEqual([{ wish_id: null, status: 'ended', end_reason: 'wish_deleted' }])
      },
    },
    yFirst: {
      says: 'the list is gone: not_found, the wish stays on L1 with its reservation',
      async check(ctx: FollowCtx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await listOf(ctx.db, wish(ctx.w, 0))).toBe(ctx.w.l1)
        expect(await activeOn(ctx.db, wish(ctx.w, 0))).toEqual([ctx.w.finn])
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    id: 'LP1',
    name: 'set_list_photo (Paula, L1) ↔ the owner deletes L1 (REST, second tab)',
    x: rpcOp('set_list_photo (Paula, L1)', 'set_list_photo', (w) => w.paula, (w) => [w.l1, 'image/webp', b64(COVER), 1600, 1067]),
    y: restOp('delete L1 (Paula, REST)', 'delete from public.wishlists where id = $1', (w) => w.paula, (w) => [w.l1]),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the cover lands, then the list delete cascades it away',
      async check(ctx: FollowCtx) {
        expect(ctx.x).toMatchObject({ ok: true, value: { ok: true } })
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await coverRows(ctx.db, ctx.w.l1)).toBe(0)
      },
    },
    yFirst: {
      says: 'the list is gone: not_found, no cover row',
      async check(ctx: FollowCtx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await coverRows(ctx.db, ctx.w.l1)).toBe(0)
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  // MC1 (move_wish ↔ cancel_reservation) is gone with 20261027200000: move_wish no longer touches reservations, so the
  // two never meet on a row. The giver's cancel against the job that ends dead rows is SC-CL1 in shared-wishes.test.ts.
]

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

/** Paula's whole normalised view + the occasion screen of O1 (followView has the list screens). */
async function ownerView(w: FollowWorld, pair: FollowPair): Promise<Record<string, string>> {
  const same = pair.sameInBothOrders!
  const view = await followView(db, w, same.viewer(w), same.extra?.(w))
  view['occasion:o1'] = normalize(await db.asUser(w.paula, (s) => s.value<string>('select public.get_occasion_screen($1)::text', [w.o1])), w)
  view['list:l1'] = normalize(await db.asUser(w.paula, (s) => s.value<string>('select public.get_list_screen($1)::text', [w.l1])), w)
  return view
}

async function runHeld(pair: FollowPair, first: 'x' | 'y') {
  const w = await seedForPair(db, pair)
  const before = await cooldownsBefore(db)
  const r = first === 'x' ? await holdFollow(db, s1, s2, w, pair.x, pair.y) : await holdFollow(db, s1, s2, w, pair.y, pair.x)
  const out = first === 'x' ? { x: r.first, y: r.second } : { x: r.second, y: r.first }
  expectContractAnswers(pair, out, `${first} holds`)
  expect(r.waitedOn, `${pair.id}: what the waiting side queued on — ${JSON.stringify(r.block)}`).toBe(pair.waitsOn[first === 'x' ? 0 : 1])
  await (first === 'x' ? pair.xFirst : pair.yFirst).check({ db, w, ...out, schedule: 'hold' })
  await expectFollowInvariants(db, before, `${pair.id}, ${first} first`)
  return { w, out }
}

for (const pair of PAIRS) {
  describe(`${pair.id} ${pair.name}`, () => {
    it(`${pair.x.label} holds its locks → ${pair.y.label} waits on ${pair.waitsOn[0]} → ${pair.xFirst.says}`, async () => {
      await runHeld(pair, 'x')
    })
    it(`${pair.y.label} holds its locks → ${pair.x.label} waits on ${pair.waitsOn[1]} → ${pair.yFirst.says}`, async () => {
      await runHeld(pair, 'y')
    })
    if (pair.sameInBothOrders) {
      const same = pair.sameInBothOrders
      it("the owner's answer and her whole view are byte-identical in both orders (with and without the reservation)", async () => {
        const a = await runHeld(pair, 'x')
        const viewA = await ownerView(a.w, pair)
        const b = await runHeld(pair, 'y')
        const viewB = await ownerView(b.w, pair)
        expect(normalize(JSON.stringify(a.out[same.side]), a.w)).toBe(normalize(JSON.stringify(b.out[same.side]), b.w))
        expect(viewA).toEqual(viewB)
      })
    }
    it(`${ROUNDS} unsynchronised rounds: no deadlock or timeout, each round equals one serial order`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const w = await seedForPair(db, pair)
        const before = await cooldownsBefore(db)
        const out = await raceFollow([s1, s2], w, pair.x, pair.y, round % 2 === 0, Math.floor(round / 2))
        expectContractAnswers(pair, out, `round ${round + 1}`)
        const ctx: FollowCtx = { db, w, ...out, schedule: 'race' }
        await ((await pair.firstOf(ctx)) === 'x' ? pair.xFirst : pair.yFirst).check(ctx)
        await expectFollowInvariants(db, before, `${pair.id}, round ${round + 1}`)
      }
    })
  })
}
