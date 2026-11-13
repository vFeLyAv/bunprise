/**
 * Wish photos under concurrency on real PostgreSQL (docs/decisions/0002-concurrency-tests-real-postgres.md,
 * supabase/migrations/20261022120000_wish_details.sql). The same pattern as ./photos.test.ts (occasion covers):
 *   set_wish_photo ↔ the owner deletes the wish (REST)        — both take the owner's profile row first
 *   set_wish_photo ↔ the host deletes the occasion (REST)     — cascade occasion → list → wish → photo
 *   set_wish_photo ↔ delete_my_account (owner)                — waits on the owner's profile row
 *   set_wish_photo ↔ remove_wish_photo                         — waits on the owner's profile row
 *   set_wish_photo ↔ reserve_wish (a guest)                    — the pair lock: both succeed in either order,
 *                                                                the photo says nothing about the reservation
 * Each pair in both orders (hold and wait, pg_blocking_pids), then unsynchronised races: never a deadlock, a
 * timeout or a raw constraint error (23503 from the photo's foreign key), always the state of one serial order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type RealPg, type Session } from '../../src/realpg'
import { b64, fakeJpeg, fakeWebp } from '../pilot/photo-bytes'
import { CONTRACT_CODES, expectRefused, holdTests, race, restOp, rpcError, rpcOp, seedFor, type Ctx, type Pair } from './pairs'
import { accountExists, occasionExists, type World } from './world'

const ROUNDS = 12
const PHOTO = fakeWebp(4096, 1)

const setPhoto = rpcOp('set_wish_photo (Anna)', 'set_wish_photo', (w) => w.host, (w) => [w.w1, 'image/webp', b64(PHOTO), 1600, 1067])
const removePhoto = rpcOp('remove_wish_photo (Anna)', 'remove_wish_photo', (w) => w.host, (w) => [w.w1])
const deleteWish = restOp('delete wish (Anna, REST)', 'delete from public.wishes where id = $1', (w) => w.host, (w) => [w.w1])
const deleteOccasion = restOp('delete occasion (Anna, REST)', 'delete from public.occasions where id = $1', (w) => w.host, (w) => [w.occasionId])
const deleteAccount = rpcOp('delete_my_account (Anna)', 'delete_my_account', (w) => w.host)
const reserveBen = rpcOp('reserve_wish (Ben)', 'reserve_wish', (w) => w.b, (w) => [w.w1])

async function storedPhoto(db: RealPg, w: World): Promise<Uint8Array | null> {
  const rows = await db.admin.rows<{ bytes: Uint8Array }>('select bytes from public.wish_photos where wish_id = $1', [w.w1])
  return rows[0] ? new Uint8Array(rows[0].bytes) : null
}
async function wishExists(db: RealPg, w: World): Promise<boolean> {
  return (await db.admin.rows('select 1 from public.wishes where id = $1', [w.w1])).length === 1
}
async function activeReservations(db: RealPg, w: World): Promise<number> {
  return (await db.admin.rows(`select 1 from public.reservations where wish_id = $1 and status = 'active'`, [w.w1])).length
}

const UPLOADED = { ok: true, value: { ok: true, updated_at: expect.any(String) } }

const WISH_PHOTO_PAIRS: readonly Pair[] = [
  {
    name: 'set_wish_photo ↔ wish delete (REST)',
    x: setPhoto,
    y: deleteWish,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the upload lands, then the delete cascades it away',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await wishExists(ctx.db, ctx.w)).toBe(false)
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    yFirst: {
      says: 'the upload answers not_found, no photo row',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'set_wish_photo ↔ occasion delete (REST)',
    x: setPhoto,
    y: deleteOccasion,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the upload lands, then the occasion cascade takes list, wish and photo',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await occasionExists(ctx.db, ctx.w)).toBe(false)
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    yFirst: {
      says: 'the upload answers not_found, no photo row',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'set_wish_photo ↔ delete_my_account (owner)',
    x: setPhoto,
    y: deleteAccount,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the upload lands, then the account deletion takes it with the wish',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await accountExists(ctx.db, ctx.w.host)).toBe(false)
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    yFirst: {
      says: 'the upload of the deleted account is refused (not_allowed), no photo row',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expectRefused(ctx, ctx.x, 'not_allowed', ['consent_required'])
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'set_wish_photo ↔ remove_wish_photo',
    x: setPhoto,
    y: removePhoto,
    waitsOn: ['profiles', 'profiles'],
    prepare: async (db, w) => {
      await db.asUser(w.host, (s) => s.rpc('set_wish_photo', [w.w1, 'image/jpeg', b64(fakeJpeg(64, 9, 10, 10)), 10, 10]))
    },
    xFirst: {
      says: 'the new photo lands and the remove takes it away: no photo',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    yFirst: {
      says: 'the old photo goes, then the new one is the photo',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        expect(await storedPhoto(ctx.db, ctx.w)).toEqual(PHOTO)
      },
    },
    firstOf: async (ctx) => ((await storedPhoto(ctx.db, ctx.w)) === null ? 'x' : 'y'),
  },
  {
    name: 'set_wish_photo ↔ reserve_wish (a guest)',
    x: setPhoto,
    y: reserveBen,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both succeed: one photo, one active reservation',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await storedPhoto(ctx.db, ctx.w)).toEqual(PHOTO)
        expect(await activeReservations(ctx.db, ctx.w)).toBe(1)
      },
    },
    yFirst: {
      says: 'both succeed: one photo, one active reservation',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        expect(await storedPhoto(ctx.db, ctx.w)).toEqual(PHOTO)
        expect(await activeReservations(ctx.db, ctx.w)).toBe(1)
      },
    },
    // the end state is the same for both orders
    firstOf: () => 'x',
  },
]

const PHOTO_CODES: readonly string[] = [...CONTRACT_CODES, 'photo_limit']

function expectPhotoContract(label: string, out: Ctx['x']): void {
  if (out.ok) return
  const contract = out.code === 'P0001' && PHOTO_CODES.includes(out.message)
  expect(contract, `${label}: database error outside the contract: ${out.code} ${out.message}`).toBe(true)
}

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

holdTests(WISH_PHOTO_PAIRS, () => ({ db, s1, s2 }))

describe('wish photo operations at the same moment', () => {
  for (const pair of WISH_PHOTO_PAIRS) {
    it(`${pair.name}: ${ROUNDS} rounds, no deadlock or timeout, each round equals one serial order`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const w = await seedFor(db, pair)
        const out = await race([s1, s2], w, pair.x, pair.y, round % 2 === 0, Math.floor(round / 2))
        expectPhotoContract(`${pair.x.label} (round ${round + 1})`, out.x)
        expectPhotoContract(`${pair.y.label} (round ${round + 1})`, out.y)
        const ctx: Ctx = { db, w, ...out, schedule: 'race' }
        await ((await pair.firstOf(ctx)) === 'x' ? pair.xFirst : pair.yFirst).check(ctx)
      }
    })
  }
})
