/**
 * Profile and banner photos under concurrency on real PostgreSQL (docs/decisions/0002-concurrency-tests-real-postgres.md,
 * supabase/migrations/20261024120000_profile_photos.sql). The world of ./world.ts: Anna hosts the occasion, Ben is a
 * guest (so Ben may see Anna's card and photos), Dana is an outsider. The pairs that can meet on the same rows:
 *   set_profile_photo ↔ delete_my_account (Anna)             — both take Anna's profile row first
 *   set_profile_photo ↔ remove_profile_photo                  — Anna's profile row
 *   set_profile_photo ↔ set_profile_photo (two tabs)          — Anna's profile row, the later version wins
 *   set_profile_photo ↔ block_user (Ben blocks Anna)          — the pair lock takes Anna's row too
 *   set_profile_photo ↔ block_user (Anna blocks Ben)          — Anna's row
 *   set_profile_photo ↔ remove_member (Anna removes Ben)      — Anna's row (access through the occasion ends)
 *   set_profile_photo ↔ leave_occasion (Ben leaves)           — the pair lock takes Anna's (the host's) row
 * Each pair in both orders (hold and wait, pg_blocking_pids), then unsynchronised races: never a deadlock, a timeout or
 * a raw constraint error (23503 from the photo's foreign key to the profile), always the state of one serial order.
 * After a block / the end of the shared occasion, Ben's read of the photo is the one answer `not_found` in either
 * order, while Anna still reads her own photo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type Outcome, type RealPg, type Session } from '../../src/realpg'
import { b64, fakeJpeg, fakeWebp } from '../pilot/photo-bytes'
import { CONTRACT_CODES, expectRefused, holdTests, race, rpcError, rpcOp, seedFor, type Ctx, type Pair } from './pairs'
import { accountExists, isBlocked, memberStatus, rpcAs, type World } from './world'

const ROUNDS = 12
const TAB_1 = fakeWebp(4096, 1, 'VP8 ', 512, 512)
const TAB_2 = fakeJpeg(4096, 2, 512, 512)

const setAvatar = (label: string, bytes: Uint8Array, mime: string) =>
  rpcOp(label, 'set_profile_photo', (w) => w.host, () => ['avatar', mime, b64(bytes), 512, 512])
const setTab1 = setAvatar('set_profile_photo (Anna, tab 1)', TAB_1, 'image/webp')
const setTab2 = setAvatar('set_profile_photo (Anna, tab 2)', TAB_2, 'image/jpeg')
const removeAvatar = rpcOp('remove_profile_photo (Anna)', 'remove_profile_photo', (w) => w.host, () => ['avatar'])
const deleteAccount = rpcOp('delete_my_account (Anna)', 'delete_my_account', (w) => w.host)
const benBlocksAnna = rpcOp('block_user (Ben blocks Anna)', 'block_user', (w) => w.b, (w) => [w.host])
const annaBlocksBen = rpcOp('block_user (Anna blocks Ben)', 'block_user', (w) => w.host, (w) => [w.b])
const removeBen = rpcOp('remove_member (Anna removes Ben)', 'remove_member', (w) => w.host, (w) => [w.occasionId, w.b])
const benLeaves = rpcOp('leave_occasion (Ben)', 'leave_occasion', (w) => w.b, (w) => [w.occasionId])

/** Anna's stored avatar (superuser): its bytes, or null without a row. */
async function storedAvatar(db: RealPg, w: World): Promise<Uint8Array | null> {
  const rows = await db.admin.rows<{ bytes: Uint8Array }>(`select bytes from public.profile_photos where profile_id = $1 and kind = 'avatar'`, [w.host])
  return rows[0] ? new Uint8Array(rows[0].bytes) : null
}
/** every profile photo row of Anna (also a would-be orphan: the FK makes one impossible, the count proves it) */
function photoRows(db: RealPg, uid: string): Promise<number> {
  return db.admin.value<number>('select count(*)::int from public.profile_photos where profile_id = $1', [uid])
}
/** `viewer` reads Anna's avatar through the RPC (its own transaction). */
function readAvatar(db: RealPg, viewer: string, w: World): Promise<Outcome> {
  return settle(rpcAs(db, viewer, 'get_profile_photo', [w.host, 'avatar']))
}

const UPLOADED = { ok: true, value: { ok: true, updated_at: expect.any(String) } }
const NOT_FOUND = rpcError('not_found')

/** The version an upload answered (jsonb text of one server: comparing the strings compares the instants). */
function versionOf(out: Outcome): string {
  if (!out.ok) throw new Error(`no upload: ${JSON.stringify(out)}`)
  return (out.value as { updated_at: string }).updated_at
}

/** After the access between Anna and Ben ended: Ben gets the one answer, Anna (and nobody's error) still reads. */
async function accessEnded(ctx: Ctx): Promise<void> {
  expect(await storedAvatar(ctx.db, ctx.w)).toEqual(TAB_1)
  expect(await readAvatar(ctx.db, ctx.w.b, ctx.w)).toEqual(NOT_FOUND)
  expect(await readAvatar(ctx.db, ctx.w.d, ctx.w)).toEqual(NOT_FOUND) // the outsider never did
  const own = await readAvatar(ctx.db, ctx.w.host, ctx.w)
  expect(own.ok && (own.value as { mime: string }).mime).toBe('image/webp')
}

const PROFILE_PHOTO_PAIRS: readonly Pair[] = [
  {
    name: 'set_profile_photo ↔ delete_my_account',
    x: setTab1,
    y: deleteAccount,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the upload lands, then the account deletion takes it (cascade)',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await accountExists(ctx.db, ctx.w.host)).toBe(false)
        expect(await photoRows(ctx.db, ctx.w.host)).toBe(0)
      },
    },
    yFirst: {
      says: 'the upload of the deleted account is refused (not_allowed), no photo row',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expectRefused(ctx, ctx.x, 'not_allowed', ['consent_required', 'not_authenticated'])
        expect(await accountExists(ctx.db, ctx.w.host)).toBe(false)
        expect(await photoRows(ctx.db, ctx.w.host)).toBe(0)
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'set_profile_photo ↔ remove_profile_photo',
    x: setTab1,
    y: removeAvatar,
    waitsOn: ['profiles', 'profiles'],
    prepare: async (db, w) => {
      await db.asUser(w.host, (s) => s.rpc('set_profile_photo', ['avatar', 'image/jpeg', b64(fakeJpeg(64, 9, 10, 10)), 10, 10]))
    },
    xFirst: {
      says: 'the new photo lands and the remove takes it away: no photo',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await storedAvatar(ctx.db, ctx.w)).toBeNull()
        expect(await readAvatar(ctx.db, ctx.w.b, ctx.w)).toEqual(NOT_FOUND)
      },
    },
    yFirst: {
      says: 'the old photo goes, then the new one is the photo (Ben reads it)',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        expect(await storedAvatar(ctx.db, ctx.w)).toEqual(TAB_1)
        const ben = await readAvatar(ctx.db, ctx.w.b, ctx.w)
        expect(ben.ok && (ben.value as { updated_at: string }).updated_at).toBe(versionOf(ctx.x))
      },
    },
    firstOf: async (ctx) => ((await storedAvatar(ctx.db, ctx.w)) === null ? 'x' : 'y'),
  },
  {
    name: 'set_profile_photo ↔ set_profile_photo (two tabs)',
    x: setTab1,
    y: setTab2,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both land, tab 2 (later) is the photo with the newer version',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual(UPLOADED)
        expect(versionOf(ctx.y) > versionOf(ctx.x)).toBe(true)
        expect(await storedAvatar(ctx.db, ctx.w)).toEqual(TAB_2)
        expect(await photoRows(ctx.db, ctx.w.host)).toBe(1)
      },
    },
    yFirst: {
      says: 'both land, tab 1 (later) is the photo with the newer version',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual(UPLOADED)
        expect(versionOf(ctx.x) > versionOf(ctx.y)).toBe(true)
        expect(await storedAvatar(ctx.db, ctx.w)).toEqual(TAB_1)
        expect(await photoRows(ctx.db, ctx.w.host)).toBe(1)
      },
    },
    firstOf: async (ctx) => ((await storedAvatar(ctx.db, ctx.w))?.[0] === TAB_2[0] ? 'x' : 'y'),
  },
  {
    name: 'set_profile_photo ↔ block_user (Ben blocks Anna)',
    x: setTab1,
    y: benBlocksAnna,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both succeed; Ben never reads Anna’s photo again',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await isBlocked(ctx.db, ctx.w.b, ctx.w.host)).toBe(true)
        await accessEnded(ctx)
      },
    },
    yFirst: {
      says: 'both succeed; the photo is there, Ben gets not_found',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        await accessEnded(ctx)
      },
    },
    firstOf: () => 'x',
  },
  {
    name: 'set_profile_photo ↔ block_user (Anna blocks Ben)',
    x: setTab1,
    y: annaBlocksBen,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both succeed; Ben never reads Anna’s photo again',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await isBlocked(ctx.db, ctx.w.host, ctx.w.b)).toBe(true)
        await accessEnded(ctx)
      },
    },
    yFirst: {
      says: 'both succeed; the photo is there, Ben gets not_found',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        await accessEnded(ctx)
      },
    },
    firstOf: () => 'x',
  },
  {
    name: 'set_profile_photo ↔ remove_member (the last shared occasion)',
    x: setTab1,
    y: removeBen,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both succeed; Ben (no longer a guest) gets not_found',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.b)).toBe('removed')
        await accessEnded(ctx)
      },
    },
    yFirst: {
      says: 'both succeed; the photo is there, Ben gets not_found',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        await accessEnded(ctx)
      },
    },
    firstOf: () => 'x',
  },
  {
    name: 'set_profile_photo ↔ leave_occasion (Ben)',
    x: setTab1,
    y: benLeaves,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both succeed; Ben (left) gets not_found',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.b)).toBe('left')
        await accessEnded(ctx)
      },
    },
    yFirst: {
      says: 'both succeed; the photo is there, Ben gets not_found',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        await accessEnded(ctx)
      },
    },
    firstOf: () => 'x',
  },
]

function expectPhotoContract(label: string, out: Outcome): void {
  if (out.ok) return
  const contract = out.code === 'P0001' && (CONTRACT_CODES as readonly string[]).includes(out.message)
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

describe('the world: Ben (a guest of Anna’s occasion) reads Anna’s photo, Dana (outsider) does not', () => {
  it('before any race', async () => {
    const w = await seedFor(db, PROFILE_PHOTO_PAIRS[0]!)
    expect(await rpcAs(db, w.host, 'set_profile_photo', ['avatar', 'image/webp', b64(TAB_1), 512, 512])).toEqual({ ok: true, updated_at: expect.any(String) })
    const ben = await readAvatar(db, w.b, w)
    expect(ben.ok && (ben.value as { mime: string }).mime).toBe('image/webp')
    expect(await readAvatar(db, w.d, w)).toEqual(NOT_FOUND)
  })
})

holdTests(PROFILE_PHOTO_PAIRS, () => ({ db, s1, s2 }))

describe('profile photo operations at the same moment', () => {
  for (const pair of PROFILE_PHOTO_PAIRS) {
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
