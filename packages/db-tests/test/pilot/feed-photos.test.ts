/**
 * The occasion cover on Start (supabase/migrations/20261025130000_feed_occasion_photos.sql, Felix 25.10):
 * get_feed() carries `photo` = { width, height, updated_at } | null per occasion row — the META only, the same
 * shape as get_occasion_screen().occasion.photo — for exactly the people who may load the bytes
 * (get_occasion_photo: active member, not blocked with the host). Never bytes, never anything about reservations:
 * the host's feed stays byte-identical across reservation traffic.
 * Host A (Anna), members B (Ben) and C (Cem), outsider D (Dana) from seedPilot().
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type TestDb } from '../../src/harness'
import { rpc, seedPilot, type Feed, type Seed } from './seed'
import { b64, fakeJpeg, fakeWebp } from './photo-bytes'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

/** A cover of the given size; the fake bytes carry the same dimensions in their header (the database checks them). */
const setPhoto = (uid: string, occasionId: string, kind: 'webp' | 'jpeg' = 'webp', width = 1600, height = 900, seed = 1) => {
  const bytes = kind === 'webp' ? fakeWebp(1024, seed, 'VP8 ', width, height) : fakeJpeg(800, seed, width, height)
  return rpc<{ ok: true; updated_at: string }>(t, uid, 'set_occasion_photo', [occasionId, `image/${kind}`, b64(bytes), width, height])
}
const feedRow = async (uid: string, occasionId: string) => {
  const feed = await rpc<Feed>(t, uid, 'get_feed')
  return [...feed.upcoming, ...feed.past].find((row) => row.id === occasionId)
}
const feedText = (uid: string) => t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))

describe('get_feed: the cover meta', () => {
  let s: Seed
  beforeAll(async () => {
    s = await seedPilot(t)
  })

  it('is null without a cover, for host and members', async () => {
    for (const uid of [s.a, s.b, s.c]) {
      const row = await feedRow(uid, s.occasionId)
      expect(row, uid).toBeDefined()
      expect('photo' in row!).toBe(true)
      expect(row!.photo).toBeNull()
    }
  })

  it('host and members get exactly { width, height, updated_at } of the cover; the outsider no row at all', async () => {
    const set = await setPhoto(s.a, s.occasionId, 'webp', 1600, 900, 7)
    for (const uid of [s.a, s.b, s.c]) {
      const row = await feedRow(uid, s.occasionId)
      expect(row!.photo).toEqual({ width: 1600, height: 900, updated_at: set.updated_at })
    }
    expect(await rpc<Feed>(t, s.d, 'get_feed')).toEqual({ upcoming: [], past: [] })
    // the same meta as the occasion screen's — one version, one cache key in the app
    const screen = await rpc<{ occasion: { photo: unknown } }>(t, s.b, 'get_occasion_screen', [s.occasionId])
    expect((await feedRow(s.b, s.occasionId))!.photo).toEqual(screen.occasion.photo)
  })

  it('never carries bytes: no base64, no size, no mime in the feed', async () => {
    const text = await feedText(s.b)
    expect(text).not.toMatch(/"data"|data_base64|size_bytes|"mime"/)
  })

  it('a replaced cover is a new version; a removed one is null again', async () => {
    const before = (await feedRow(s.b, s.occasionId))!.photo as { updated_at: string }
    const replaced = await setPhoto(s.a, s.occasionId, 'jpeg', 1200, 800, 9)
    const after = (await feedRow(s.b, s.occasionId))!.photo as { updated_at: string; width: number }
    expect(after).toEqual({ width: 1200, height: 800, updated_at: replaced.updated_at })
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at).getTime())
    await rpc(t, s.a, 'remove_occasion_photo', [s.occasionId])
    expect((await feedRow(s.b, s.occasionId))!.photo).toBeNull()
  })

  it('the host feed stays byte-identical across reservations (the cover is not about reservations)', async () => {
    await setPhoto(s.a, s.occasionId, 'webp', 1600, 900, 2)
    const hostBefore = await feedText(s.a)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    expect(await feedText(s.a)).toBe(hostBefore)
    await rpc(t, s.b, 'cancel_reservation', [s.w1])
    expect(await feedText(s.a)).toBe(hostBefore)
  })

  it('a blocked pair that is still a member (defensive): photo null, like get_occasion_photo refuses', async () => {
    const s2 = await seedPilot(t)
    await setPhoto(s2.a, s2.occasionId, 'webp', 1600, 900, 5)
    // block_user also ends the membership; write the block row directly to check the feed rule on its own
    await t.asService((tx) => tx.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [s2.a, s2.b]))
    const row = await feedRow(s2.b, s2.occasionId)
    expect(row).toBeDefined()
    expect(row!.photo).toBeNull()
    expect((await feedRow(s2.c, s2.occasionId))!.photo).not.toBeNull()
  })

  it('past occasions carry the meta too', async () => {
    const s3 = await seedPilot(t)
    const past = await t.asUser(s3.a, (tx) =>
      scalar<string>(tx, `insert into occasions (host_id, title, starts_at, tz) values ($1, 'gestern', now() - interval '3 days', 'Europe/Berlin') returning id`, [s3.a]),
    )
    const set = await setPhoto(s3.a, past, 'webp', 800, 600)
    const feed = await rpc<Feed>(t, s3.a, 'get_feed')
    expect(feed.past.find((row) => row.id === past)!.photo).toEqual({ width: 800, height: 600, updated_at: set.updated_at })
  })
})
