/**
 * The point of the occasion's place (supabase/migrations/20261027190000_occasion_place_point.sql, Felix 27.10:
 * «мини-карта в событии, просто где точка»): occasions.place_lat / place_lon are null by default, the host stores
 * them through REST together with the place text (insert and update), host and members get the same values through
 * get_occasion_screen (the feed stays unchanged); both or none, only with a place text, in range, rounded to 5
 * decimals; a new place text without a new point drops the old point; a guest or an outsider cannot write them; an
 * outsider and a blocked guest learn nothing new; the owner's screen stays byte-identical whatever is reserved.
 * Invented places and points only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, execAs, rpc, screen, screenText, seedPilot, type Seed } from '../pilot/seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface PointScreen {
  occasion: { place_text: string | null; place_lat?: number | null; place_lon?: number | null }
}

const CAFE = { text: 'Café Morgenrot, Lindenweg 4, 12345 Beispielstadt', lat: 51.16212, lon: 10.45231 }
const PARK = { text: 'Stadtpark Beispielstadt, Parkring, 12345 Beispielstadt', lat: 51.16655, lon: 10.44302 }

const occasionOf = async (uid: string, occasionId: string) => (await screen(t, uid, occasionId) as unknown as PointScreen).occasion
const pointOf = async (uid: string, occasionId: string) => {
  const occasion = await occasionOf(uid, occasionId)
  return [occasion.place_lat, occasion.place_lon]
}
const feedText = (uid: string) => t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))

/** The host picks a place WITH a point (the app's path: column grants + policy occasions_update). */
function pickPlace(s: Seed, place: { text: string; lat: number | string | null; lon: number | string | null }, as = s.a): Promise<number> {
  return execAs(t, as, 'update occasions set place_text = $2, place_lat = $3, place_lon = $4 where id = $1', [s.occasionId, place.text, place.lat, place.lon])
}

describe('the point in the screen', () => {
  it('null by default: both keys are there for host and members', async () => {
    const s = await seedPilot(t)
    for (const uid of [s.a, s.b, s.c]) {
      const occasion = await occasionOf(uid, s.occasionId)
      expect('place_lat' in occasion && 'place_lon' in occasion).toBe(true)
      expect([occasion.place_lat, occasion.place_lon]).toEqual([null, null])
    }
  })

  it('stored by the host, returned to host and members alike (JSON numbers, 5 decimals)', async () => {
    const s = await seedPilot(t)
    expect(await pickPlace(s, CAFE)).toBe(1)
    for (const uid of [s.a, s.b, s.c]) {
      const occasion = await occasionOf(uid, s.occasionId)
      expect(occasion.place_text).toBe(CAFE.text)
      expect([occasion.place_lat, occasion.place_lon]).toEqual([CAFE.lat, CAFE.lon])
    }
  })

  it('the host can create an occasion with a point (the table INSERT grant covers the columns)', async () => {
    const s = await seedPilot(t)
    const id = await t.asUser(s.a, (tx) =>
      scalar<string>(tx, `insert into occasions (host_id, title, starts_at, tz, place_text, place_lat, place_lon)
                          values ($1, 'Picknick', now() + interval '3 days', 'Europe/Berlin', $2, $3, $4) returning id`, [s.a, PARK.text, PARK.lat, PARK.lon]))
    expect(await pointOf(s.a, id)).toEqual([PARK.lat, PARK.lon])
  })

  it('a member reads the columns through REST too (the select grant), like the place text', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    const [row] = await t.asUser(s.b, (tx) =>
      rows<{ lat: number; lon: number }>(tx, 'select place_lat::float8 as lat, place_lon::float8 as lon from occasions where id = $1', [s.occasionId]))
    expect(row).toEqual({ lat: CAFE.lat, lon: CAFE.lon })
  })

  it('more decimals are rounded to 5 (~1 m)', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, { text: CAFE.text, lat: 51.1621249, lon: 10.4523151 })
    expect(await pointOf(s.b, s.occasionId)).toEqual([51.16212, 10.45232])
  })

  it('the feed stays as it was (no point there)', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    expect(await feedText(s.b)).not.toMatch(/place_lat|place_lon/)
  })
})

describe('a new place text drops the old point', () => {
  it('typed text, a recent place (no point) or "Ort entfernen" → no point; a new pick with a point → the new point', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    // the app's edit: every field again, the place typed by hand (no point sent)
    expect(await execAs(t, s.a, `update occasions set title = 'Neu', place_text = 'Bei mir zu Hause' where id = $1`, [s.occasionId])).toBe(1)
    expect(await pointOf(s.a, s.occasionId)).toEqual([null, null])

    await pickPlace(s, CAFE)
    expect(await execAs(t, s.a, 'update occasions set place_text = null where id = $1', [s.occasionId])).toBe(1)
    expect(await pointOf(s.b, s.occasionId)).toEqual([null, null])

    await pickPlace(s, CAFE)
    await pickPlace(s, PARK)
    expect(await pointOf(s.b, s.occasionId)).toEqual([PARK.lat, PARK.lon])
  })

  it('the same place text (or another field) keeps the point', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    expect(await execAs(t, s.a, `update occasions set title = 'Neu', place_text = $2, description = 'Kuchen!' where id = $1`, [s.occasionId, CAFE.text])).toBe(1)
    expect(await pointOf(s.a, s.occasionId)).toEqual([CAFE.lat, CAFE.lon])
  })
})

describe('the rules in the database', () => {
  it('both or none, only with a place text, in range — refused on insert and update', async () => {
    const s = await seedPilot(t)
    const bad: { text: string | null; lat: number | string | null; lon: number | string | null }[] = [
      { text: CAFE.text, lat: CAFE.lat, lon: null },
      { text: CAFE.text, lat: null, lon: CAFE.lon },
      { text: null, lat: CAFE.lat, lon: CAFE.lon },
      { text: CAFE.text, lat: 90.5, lon: 10 },
      { text: CAFE.text, lat: -91, lon: 10 },
      { text: CAFE.text, lat: 51, lon: 180.5 },
      { text: CAFE.text, lat: 51, lon: -181 },
      { text: CAFE.text, lat: 'NaN', lon: 10 },
      { text: CAFE.text, lat: 51, lon: 'NaN' },
    ]
    for (const place of bad) {
      const update = execAs(t, s.a, 'update occasions set place_text = $2, place_lat = $3, place_lon = $4 where id = $1', [s.occasionId, place.text, place.lat, place.lon])
      expect((await expectDbError(update, '23514')).message, JSON.stringify(place)).toContain('occasions_place_point_check')
      const insert = execAs(t, s.a, `insert into occasions (host_id, title, starts_at, place_text, place_lat, place_lon) values ($1, 'Party', now() + interval '1 day', $2, $3, $4)`, [s.a, place.text, place.lat, place.lon])
      expect((await expectDbError(insert, '23514')).message, JSON.stringify(place)).toContain('occasions_place_point_check')
    }
    // too many digits before the point / infinity: the column type itself refuses (numeric field overflow)
    for (const [lat, lon] of [[100, 10], [51, 1000], ['Infinity', 10], [51, '-Infinity']] as const) {
      await expectDbError(pickPlace(s, { text: CAFE.text, lat, lon }), '22003')
    }
    expect(await pointOf(s.a, s.occasionId)).toEqual([null, null])
    // the edges are fine
    expect(await pickPlace(s, { text: CAFE.text, lat: -90, lon: 180 })).toBe(1)
    expect(await pointOf(s.a, s.occasionId)).toEqual([-90, 180])
  })

  it('only the host writes it: a guest and an outsider change nothing', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    expect(await execAs(t, s.b, 'update occasions set place_lat = 1, place_lon = 1 where id = $1', [s.occasionId])).toBe(0)
    expect(await execAs(t, s.d, 'update occasions set place_lat = 1, place_lon = 1 where id = $1', [s.occasionId])).toBe(0)
    expect(await pickPlace(s, PARK, s.b)).toBe(0)
    expect(await pointOf(s.a, s.occasionId)).toEqual([CAFE.lat, CAFE.lon])
  })

  it('an outsider learns nothing (one answer, no REST row)', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    await expectDbError(screen(t, s.d, s.occasionId), 'P0001')
    expect(await t.asUser(s.d, (tx) => rows(tx, 'select place_lat, place_lon from occasions where id = $1', [s.occasionId]))).toEqual([])
  })

  it('a guest blocked by the host gets no screen (like the place text); a left guest no REST row', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    expect(await rpc(t, s.a, 'block_user', [s.c])).toEqual({ ok: true })
    await expectDbError(screen(t, s.c, s.occasionId), 'P0001')
    // REST: the point is readable exactly when the place text is (the same row, the same policy)
    const restRows = async (uid: string, columns: string) =>
      (await t.asUser(uid, (tx) => rows(tx, `select ${columns} from occasions where id = $1`, [s.occasionId]))).length
    for (const uid of [s.a, s.b, s.c, s.d]) expect(await restRows(uid, 'place_lat, place_lon'), uid).toBe(await restRows(uid, 'place_text'))
    await rpc(t, s.b, 'leave_occasion', [s.occasionId])
    expect(await restRows(s.b, 'place_lat, place_lon')).toBe(0)
  })
})

describe('secrecy', () => {
  it('the owner: screen and feed byte-identical with 0 and 5 reservations (point set)', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, CAFE)
    const extra = await t.asUser(s.a, (tx) =>
      rows<{ id: string }>(tx, `insert into wishes (wishlist_id, title) values ($1, 'Kerze'), ($1, 'Tee') returning id`, [s.wishlistId]))
    const screenBefore = await screenText(t, s.a, s.occasionId)
    const feedBefore = await feedText(s.a)
    expect((JSON.parse(screenBefore) as PointScreen).occasion.place_lat).toBe(CAFE.lat)

    for (const wish of [s.w1, s.w2, s.w3]) await rpc(t, s.b, 'reserve_wish', [wish])
    for (const wish of extra) await rpc(t, s.c, 'reserve_wish', [wish.id])
    expect(await scalar<number>(t.db, `select count(*)::int from reservations r join wishlists wl on wl.id = r.wishlist_id where wl.occasion_id = $1 and r.status = 'active'`, [s.occasionId])).toBe(5)

    expect(await screenText(t, s.a, s.occasionId)).toBe(screenBefore)
    expect(await feedText(s.a)).toBe(feedBefore)
  })

  it('the point is the same for every viewer, also for a new guest; a reservation changes nothing', async () => {
    const s = await seedPilot(t)
    await pickPlace(s, PARK)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    const e = await createMember(t, 'Ella')
    await rpc(t, e, 'accept_invite', [s.token])
    for (const uid of [s.a, s.b, s.c, e]) expect(await pointOf(uid, s.occasionId)).toEqual([PARK.lat, PARK.lon])
  })
})
