/**
 * The end time of an occasion (supabase/migrations/20261026180000_occasion_end_time.sql, Felix 26.10):
 *   ends_at reaches the host and the members through get_occasion_screen and get_feed (null without an end and for
 *   an all-day occasion); the database refuses an end for an all-day occasion, an end not after the start and an end
 *   later than the next day (in the occasion's zone); an occasion is past at its end, and an end on the next day
 *   keeps it upcoming past midnight; the owner's screen and feed stay byte-identical whatever is reserved; the
 *   feed's member_count no longer counts people hidden by a block (P-I16); rows that would break the new checks lose
 *   their end when the migration runs, nothing else changes.
 */
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, MIGRATIONS_DIR, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, execAs, rpc, screen, screenText, seedPilot, type Feed, type Seed } from '../pilot/seed'

const MIGRATION = '20261026180000_occasion_end_time.sql'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface EndScreen {
  occasion: { ends_at?: string | null; starts_at: string; all_day: boolean }
  members: { profile_id: string }[]
}
type EndFeed = { upcoming: (Feed['upcoming'][number] & { ends_at?: string | null })[]; past: (Feed['past'][number] & { ends_at?: string | null })[] }

const at = (iso: string | null | undefined) => (iso == null ? null : Date.parse(iso))
const feedText = (uid: string) => t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))
const feedRow = async (uid: string, occasionId: string) => {
  const feed = await rpc<EndFeed>(t, uid, 'get_feed')
  return [...feed.upcoming, ...feed.past].find((row) => row.id === occasionId)
}

/** The host makes the seeded occasion a timed one through REST (the app's path: policy occasions_update). */
function setTimes(s: Seed, startsAt: string, endsAt: string | null, allDay = false): Promise<number> {
  return execAs(t, s.a, 'update occasions set all_day = $2, starts_at = $3, ends_at = $4 where id = $1', [s.occasionId, allDay, startsAt, endsAt])
}

describe('ends_at in the screens', () => {
  it('host and members get the same ends_at; null without an end and for an all-day occasion', async () => {
    const s = await seedPilot(t)
    // all-day (the seed): the key is there, null
    for (const uid of [s.a, s.b]) {
      const sc = await screen(t, uid, s.occasionId) as unknown as EndScreen
      expect('ends_at' in sc.occasion).toBe(true)
      expect(sc.occasion.ends_at).toBeNull()
      const row = await feedRow(uid, s.occasionId)
      expect(row && 'ends_at' in row).toBe(true)
      expect(row?.ends_at).toBeNull()
    }

    // timed, 19:00–23:00 (Berlin, winter time = UTC+1)
    expect(await setTimes(s, '2030-11-08 19:00:00+01', '2030-11-08 23:00:00+01')).toBe(1)
    for (const uid of [s.a, s.b, s.c]) {
      const sc = await screen(t, uid, s.occasionId) as unknown as EndScreen
      expect(at(sc.occasion.ends_at)).toBe(Date.parse('2030-11-08T22:00:00Z'))
      expect(sc.occasion.all_day).toBe(false)
      expect(at((await feedRow(uid, s.occasionId))?.ends_at)).toBe(Date.parse('2030-11-08T22:00:00Z'))
    }

    // timed without an end: null again
    expect(await setTimes(s, '2030-11-08 19:00:00+01', null)).toBe(1)
    expect((await screen(t, s.b, s.occasionId) as unknown as EndScreen).occasion.ends_at).toBeNull()
    expect((await feedRow(s.a, s.occasionId))?.ends_at).toBeNull()
  })

  it('an outsider still gets not_found (nothing about the end leaks)', async () => {
    const s = await seedPilot(t)
    await setTimes(s, '2030-11-08 19:00:00+01', '2030-11-08 23:00:00+01')
    await expectDbError(screen(t, s.d, s.occasionId), 'P0001')
    expect(await rpc<EndFeed>(t, s.d, 'get_feed')).toEqual({ upcoming: [], past: [] })
  })
})

describe('the rules in the database', () => {
  it('an all-day occasion has no end (insert and update)', async () => {
    const s = await seedPilot(t)
    const insert = execAs(t, s.a, `insert into occasions (host_id, title, starts_at, ends_at, all_day) values ($1, 'Ganztags mit Ende', '2030-11-08 00:00:00+01', '2030-11-08 12:00:00+01', true)`, [s.a])
    expect((await expectDbError(insert, '23514')).message).toContain('occasions_ends_at_timed')
    await setTimes(s, '2030-11-08 19:00:00+01', '2030-11-08 23:00:00+01')
    // switching to all-day while the end stays: refused; with the end removed in the same update: fine
    expect((await expectDbError(execAs(t, s.a, 'update occasions set all_day = true where id = $1', [s.occasionId]), '23514')).message).toContain('occasions_ends_at_timed')
    expect(await execAs(t, s.a, 'update occasions set all_day = true, ends_at = null where id = $1', [s.occasionId])).toBe(1)
  })

  it('the end is after the start: an end equal to the start is refused', async () => {
    const s = await seedPilot(t)
    expect((await expectDbError(setTimes(s, '2030-11-08 19:00:00+01', '2030-11-08 19:00:00+01'), '23514')).message).toContain('occasions_check')
    expect((await expectDbError(setTimes(s, '2030-11-08 19:00:00+01', '2030-11-08 18:00:00+01'), '23514')).message).toContain('occasions_check')
  })

  it('the next-day rule: until 02:00 the next day is fine, two days later is refused (dates in the occasion zone)', async () => {
    const s = await seedPilot(t)
    expect(await setTimes(s, '2030-11-08 19:00:00+01', '2030-11-09 02:00:00+01')).toBe(1)
    const sc = await screen(t, s.b, s.occasionId) as unknown as EndScreen
    expect(at(sc.occasion.ends_at)).toBe(Date.parse('2030-11-09T01:00:00Z'))
    // the last minute of the next day is still "the next day"; its next minute is not
    expect(await setTimes(s, '2030-11-08 19:00:00+01', '2030-11-09 23:59:00+01')).toBe(1)
    expect((await expectDbError(setTimes(s, '2030-11-08 19:00:00+01', '2030-11-10 00:00:00+01'), '23514')).message).toContain('occasions_ends_at_next_day')
    // the zone decides the dates: 23:30 in New York is already the next day in UTC — still the same day there
    expect(await execAs(t, s.a, `update occasions set tz = 'America/New_York', all_day = false, starts_at = '2030-11-08 19:00:00-05', ends_at = '2030-11-09 23:30:00-05' where id = $1`, [s.occasionId])).toBe(1)
    expect((await expectDbError(execAs(t, s.a, `update occasions set ends_at = '2030-11-10 00:30:00-05' where id = $1`, [s.occasionId]), '23514')).message).toContain('occasions_ends_at_next_day')
  })

  it('both checks exist under their names', async () => {
    const names = await rows<{ conname: string }>(t.db, `select conname from pg_constraint where conrelid = 'public.occasions'::regclass and contype = 'c' and conname like 'occasions_ends_at%' order by 1`)
    expect(names.map((r) => r.conname)).toEqual(['occasions_ends_at_next_day', 'occasions_ends_at_timed'])
  })
})

describe('past and upcoming follow the end', () => {
  it('past at its end — before the local midnight; upcoming while it lasts, also past midnight', async () => {
    const s = await seedPilot(t)
    const ins = (title: string, startsAt: string, endsAt: string | null) =>
      t.asUser(s.a, (tx) => scalar<string>(tx,
        `insert into occasions (host_id, title, starts_at, ends_at, all_day, tz) values ($1, $2, ${startsAt}, ${endsAt ?? 'null'}, false, 'Europe/Berlin') returning id`, [s.a, title]))
    const ended = await ins('ended an hour ago', `now() - interval '2 hours'`, `now() - interval '1 hour'`)
    const lasting = await ins('lasts one more hour', `now() - interval '2 hours'`, `now() + interval '1 hour'`)
    // started 20 hours ago (possibly yesterday in Berlin): without an end it would be over at the last midnight
    const overnight = await ins('all night long', `now() - interval '20 hours'`, `now() + interval '1 hour'`)

    const feed = await rpc<EndFeed>(t, s.a, 'get_feed')
    expect(feed.past.map((o) => o.id)).toContain(ended)
    expect(feed.upcoming.map((o) => o.id)).not.toContain(ended)
    expect(feed.upcoming.map((o) => o.id)).toEqual(expect.arrayContaining([lasting, overnight]))
    expect(feed.past.map((o) => o.id)).not.toContain(lasting)
    expect(feed.past.map((o) => o.id)).not.toContain(overnight)
  })
})

describe('secrecy', () => {
  it('the owner: screen and feed byte-identical with 0 and 5 reservations (end set)', async () => {
    const s = await seedPilot(t)
    await setTimes(s, '2030-11-08 19:00:00+01', '2030-11-09 02:00:00+01')
    const extra = await t.asUser(s.a, (tx) =>
      rows<{ id: string }>(tx, `insert into wishes (wishlist_id, title) values ($1, 'Kerze'), ($1, 'Tee') returning id`, [s.wishlistId]))
    const screenBefore = await screenText(t, s.a, s.occasionId)
    const feedBefore = await feedText(s.a)
    expect(at((JSON.parse(screenBefore) as EndScreen).occasion.ends_at)).toBe(Date.parse('2030-11-09T01:00:00Z'))

    for (const wish of [s.w1, s.w2, s.w3]) await rpc(t, s.b, 'reserve_wish', [wish])
    for (const wish of extra) await rpc(t, s.c, 'reserve_wish', [wish.id])
    expect(await scalar<number>(t.db, `select count(*)::int from reservations r join wishlists wl on wl.id = r.wishlist_id where wl.occasion_id = $1 and r.status = 'active'`, [s.occasionId])).toBe(5)

    expect(await screenText(t, s.a, s.occasionId)).toBe(screenBefore)
    expect(await feedText(s.a)).toBe(feedBefore)
  })
})

describe('member_count without people hidden by a block (P-I16)', () => {
  it('two guests who blocked each other count each other no more; the host still counts everybody', async () => {
    const s = await seedPilot(t)
    const count = async (uid: string) => (await feedRow(uid, s.occasionId))?.member_count
    expect([await count(s.a), await count(s.b), await count(s.c)]).toEqual([3, 3, 3])
    const hostFeed = await feedText(s.a)

    expect(await rpc(t, s.b, 'block_user', [s.c])).toEqual({ ok: true })
    // the feed's number = the occasion screen's member list, for every viewer
    for (const uid of [s.a, s.b, s.c]) {
      const members = (await screen(t, uid, s.occasionId) as unknown as EndScreen).members.length
      expect(await count(uid)).toBe(members)
    }
    expect([await count(s.a), await count(s.b), await count(s.c)]).toEqual([3, 2, 2])
    expect(await feedText(s.a)).toBe(hostFeed)

    // a fourth guest who blocked nobody still counts everybody
    const e = await createMember(t, 'Ella')
    await rpc(t, e, 'accept_invite', [s.token])
    expect(await count(e)).toBe(4)
    expect(await count(s.b)).toBe(3)
  })
})

describe('the migration on existing rows', () => {
  it('drops only the ends that break the new checks; the rest stays as it was', async () => {
    // a database with every migration BEFORE this one, then rows the app never wrote but REST allowed
    const dir = await mkdtemp(join(tmpdir(), 'bunprise-ends-'))
    try {
      for (const file of (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql') && f < MIGRATION)) {
        await copyFile(join(MIGRATIONS_DIR, file), join(dir, file))
      }
      const old = await createTestDb({ migrationsDir: dir })
      try {
        const host = await createMember(old, 'Olga')
        const ins = (title: string, allDay: boolean, starts: string, ends: string | null) =>
          scalar<string>(old.db, `insert into occasions (host_id, title, all_day, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning id`, [host, title, allDay, starts, ends])
        const allDayWithEnd = await ins('all day with end', true, '2030-11-08 00:00:00+01', '2030-11-08 12:00:00+01')
        const threeDays = await ins('three days', false, '2030-11-08 19:00:00+01', '2030-11-11 19:00:00+01')
        const evening = await ins('evening', false, '2030-11-08 19:00:00+01', '2030-11-08 23:00:00+01')
        const overnight = await ins('overnight', false, '2030-11-08 19:00:00+01', '2030-11-09 02:00:00+01')
        const noEnd = await ins('no end', false, '2030-11-08 19:00:00+01', null)
        const before = await rows(old.db, 'select id, updated_at from occasions where id = any($1) order by id', [[evening, overnight, noEnd]])

        await old.db.transaction(async (tx) => tx.exec(await readFile(join(MIGRATIONS_DIR, MIGRATION), 'utf8')))

        const ends = new Map((await rows<{ id: string; ends_at: Date | null }>(old.db, 'select id, ends_at from occasions')).map((r) => [r.id, r.ends_at]))
        expect(ends.get(allDayWithEnd)).toBeNull()
        expect(ends.get(threeDays)).toBeNull()
        expect(ends.get(evening)?.toISOString()).toBe('2030-11-08T22:00:00.000Z')
        expect(ends.get(overnight)?.toISOString()).toBe('2030-11-09T01:00:00.000Z')
        expect(ends.get(noEnd)).toBeNull()
        // untouched rows keep their updated_at (the cleanup touched only the two broken ones)
        expect(await rows(old.db, 'select id, updated_at from occasions where id = any($1) order by id', [[evening, overnight, noEnd]])).toEqual(before)
      } finally {
        await old.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
