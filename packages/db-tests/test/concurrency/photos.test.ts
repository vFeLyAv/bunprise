/**
 * Occasion cover photos under concurrency on real PostgreSQL (docs/decisions/0002-concurrency-tests-real-postgres.md,
 * supabase/migrations/20261020160000_occasion_photos.sql). The pairs that can meet on the same rows:
 *   set_occasion_photo ↔ the host deletes the occasion (REST)  — serializes on the host profile before either write
 *   set_occasion_photo ↔ delete_my_account (host)              — waits on the host's profile row (first lock)
 *   set_occasion_photo ↔ set_occasion_photo (two tabs)          — waits on the host's profile row
 *   set_occasion_photo ↔ remove_occasion_photo                  — waits on the host's profile row
 * Each pair in both orders (hold and wait, pg_blocking_pids), then unsynchronised races: never a deadlock, a
 * timeout or a raw constraint error (e.g. 23503 from the photo's foreign key), always the state of one
 * serial order. The pair table runners come from ./pairs.ts (no new pair is added to its shared lists).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type RealPg, type Session } from '../../src/realpg'
import { b64, fakeJpeg, fakeWebp } from '../pilot/photo-bytes'
import {
  CONTRACT_CODES,
  expectRefused,
  holdTests,
  race,
  restOp,
  rpcError,
  rpcOp,
  seedFor,
  type Ctx,
  type Pair,
} from './pairs'
import { accountExists, occasionExists, type World } from './world'

const ROUNDS = 12
const TAB_1 = fakeWebp(4096, 1)
const TAB_2 = fakeJpeg(4096, 2)

const setPhotoOp = (label: string, bytes: Uint8Array, mime: string) =>
  rpcOp(label, 'set_occasion_photo', (w) => w.host, (w) => [w.occasionId, mime, b64(bytes), 1600, 1067])
const setTab1 = setPhotoOp('set_occasion_photo (Anna, tab 1)', TAB_1, 'image/webp')
const setTab2 = setPhotoOp('set_occasion_photo (Anna, tab 2)', TAB_2, 'image/jpeg')
const removePhoto = rpcOp('remove_occasion_photo (Anna)', 'remove_occasion_photo', (w) => w.host, (w) => [w.occasionId])
const deleteOccasion = restOp('delete occasion (Anna, REST)', 'delete from public.occasions where id = $1', (w) => w.host, (w) => [w.occasionId])
const deleteAccount = rpcOp('delete_my_account (Anna)', 'delete_my_account', (w) => w.host)

/** The stored cover of the world's occasion (superuser): its bytes, or null without a row. */
async function storedPhoto(db: RealPg, w: World): Promise<Uint8Array | null> {
  const rows = await db.admin.rows<{ bytes: Uint8Array }>('select bytes from public.occasion_photos where occasion_id = $1', [w.occasionId])
  return rows[0] ? new Uint8Array(rows[0].bytes) : null
}

const UPLOADED = { ok: true, value: { ok: true, updated_at: expect.any(String) } }

/**
 * The version an upload answered (timestamptz as jsonb text, microseconds, one server = one offset format:
 * comparing the strings compares the instants — Date.parse would cut the microseconds off).
 */
function versionOf(out: Ctx['x']): string {
  if (!out.ok) throw new Error(`no upload: ${JSON.stringify(out)}`)
  return (out.value as { updated_at: string }).updated_at
}

const PHOTO_PAIRS: readonly Pair[] = [
  {
    name: 'set_occasion_photo ↔ occasion delete (REST)',
    x: setTab1,
    y: deleteOccasion,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the upload lands, then the delete cascades it away',
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
    name: 'set_occasion_photo ↔ delete_my_account (host)',
    x: setTab1,
    y: deleteAccount,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the upload lands, then the account deletion takes it with the occasion',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await accountExists(ctx.db, ctx.w.host)).toBe(false)
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    yFirst: {
      says: 'the upload of the deleted account answers not_allowed (like every RPC), no photo row',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        // held: the upload had read the live profile and then waited for its lock → not_allowed; in a race the
        // consent check (a statement after the deletion's commit) may be the first to see the account gone
        expectRefused(ctx, ctx.x, 'not_allowed', ['consent_required'])
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'set_occasion_photo ↔ set_occasion_photo (two tabs of the host)',
    x: setTab1,
    y: setTab2,
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both succeed, the second upload is the cover with the newer version',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual(UPLOADED)
        expect(await storedPhoto(ctx.db, ctx.w)).toEqual(TAB_2)
        expect(versionOf(ctx.y) > versionOf(ctx.x)).toBe(true) // versions follow the commit order
      },
    },
    yFirst: {
      says: 'both succeed, the second upload is the cover with the newer version',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual(UPLOADED)
        expect(await storedPhoto(ctx.db, ctx.w)).toEqual(TAB_1)
        expect(versionOf(ctx.x) > versionOf(ctx.y)).toBe(true)
      },
    },
    // the cover that stayed was written last
    firstOf: async (ctx) => ((await storedPhoto(ctx.db, ctx.w))?.[0] === TAB_2[0] ? 'x' : 'y'),
  },
  {
    name: 'set_occasion_photo ↔ remove_occasion_photo',
    x: setTab1,
    y: removePhoto,
    waitsOn: ['profiles', 'profiles'],
    // a cover exists already, so both orders change something
    prepare: async (db, w) => {
      await db.asUser(w.host, (s) => s.rpc('set_occasion_photo', [w.occasionId, 'image/jpeg', b64(fakeJpeg(64, 9, 10, 10)), 10, 10]))
    },
    xFirst: {
      says: 'the new cover lands and the remove takes it away: no photo',
      async check(ctx) {
        expect(ctx.x).toEqual(UPLOADED)
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(await storedPhoto(ctx.db, ctx.w)).toBeNull()
      },
    },
    yFirst: {
      says: 'the old cover goes, then the new one is the cover',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: { ok: true } })
        expect(ctx.x).toEqual(UPLOADED)
        expect(await storedPhoto(ctx.db, ctx.w)).toEqual(TAB_1)
      },
    },
    firstOf: async (ctx) => ((await storedPhoto(ctx.db, ctx.w)) === null ? 'x' : 'y'),
  },
]

/** The contract codes plus the photo quota (never reached here: one photo per world). */
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

holdTests(PHOTO_PAIRS, () => ({ db, s1, s2 }))

describe('cover photo operations at the same moment', () => {
  for (const pair of PHOTO_PAIRS) {
    it(`${pair.name}: ${ROUNDS} rounds, no deadlock or timeout, each round equals one serial order`, async () => {
      const seen = { x: 0, y: 0 }
      for (let round = 0; round < ROUNDS; round++) {
        const w = await seedFor(db, pair)
        const out = await race([s1, s2], w, pair.x, pair.y, round % 2 === 0, Math.floor(round / 2))
        expectPhotoContract(`${pair.x.label} (round ${round + 1})`, out.x)
        expectPhotoContract(`${pair.y.label} (round ${round + 1})`, out.y)
        const ctx: Ctx = { db, w, ...out, schedule: 'race' }
        const first = await pair.firstOf(ctx)
        seen[first] += 1
        await (first === 'x' ? pair.xFirst : pair.yFirst).check(ctx)
      }
      console.info(`[races] ${pair.name}: ${pair.x.label} first ${seen.x}/${ROUNDS}, ${pair.y.label} first ${seen.y}/${ROUNDS}`)
    })
  }
})
