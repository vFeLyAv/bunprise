import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { createFollowsApi } from './follows'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// Demo parity for the end time (supabase/migrations/20261026180000_occasion_end_time.sql; the PGlite twin is
// packages/db-tests/test/occasions/end-time.test.ts): ends_at in get_feed and get_occasion_screen, the three
// checks, "past at its end", and member_count without people hidden by a block (P-I16).

const NOW = Date.parse('2026-10-20T10:00:00Z') // 12:00 in Berlin (summer time)
const HOUR = 3_600_000
const ME = '00000000-0000-4000-8000-0000000000aa'
const { anna, ben } = DEMO_PEOPLE

function person(id: string, name: string | null = 'Mila Sommer'): DemoPerson {
  return { id, displayName: () => name, hasConsents: () => true }
}

function setup() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  world.addPerson(person(ME))
  world.addGuest(DEMO_OCCASIONS.housewarming, ME)
  return { world, follows: createFollowsApi(world) }
}

function failure(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DemoDbError) return `${error.code} ${error.message}`
    throw error
  }
  throw new Error('expected a database error')
}

const iso = (ms: number) => new Date(ms).toISOString()

describe('demo: ends_at in the screens', () => {
  it('the seeded occasions have none (the key is there, null)', () => {
    const { world } = setup()
    for (const row of world.getFeed(ME).upcoming) expect(row).toHaveProperty('ends_at', null)
    expect(world.getOccasionScreen(ME, DEMO_OCCASIONS.housewarming).occasion).toHaveProperty('ends_at', null)
  })

  it('a timed occasion with an end: the same value on the host\'s screen, a guest\'s screen and both feeds', () => {
    const { world } = setup()
    const [created] = world.insertOccasions(ME, [{
      host_id: ME, title: 'Spieleabend', all_day: false, tz: 'Europe/Berlin',
      starts_at: '2026-11-07T18:00:00.000Z', ends_at: '2026-11-08T01:00:00.000Z', // 19:00 until 02:00 the next day
    }], true)
    world.addGuest(created!.id, ben.id)
    for (const viewer of [ME, ben.id]) {
      expect(Date.parse(world.getOccasionScreen(viewer, created!.id).occasion.ends_at!)).toBe(Date.parse('2026-11-08T01:00:00.000Z'))
      expect(Date.parse(world.getFeed(viewer).upcoming.find((row) => row.id === created!.id)!.ends_at!)).toBe(Date.parse('2026-11-08T01:00:00.000Z'))
    }
  })
})

describe('demo: the checks of the database', () => {
  const base = { host_id: ME, title: 'Abend', tz: 'Europe/Berlin', starts_at: '2026-11-07T18:00:00.000Z' }

  it('no end for an all-day occasion; the end after the start; at the latest on the next day (in the zone)', () => {
    const { world } = setup()
    expect(failure(() => world.insertOccasions(ME, [{ ...base, all_day: true, ends_at: '2026-11-07T20:00:00.000Z' }], true))).toContain('occasions_ends_at_timed')
    expect(failure(() => world.insertOccasions(ME, [{ ...base, all_day: false, ends_at: base.starts_at }], true))).toContain('occasions_check')
    // 23:59 the next day is fine; midnight after it is not (Berlin, winter time = UTC+1)
    expect(world.insertOccasions(ME, [{ ...base, all_day: false, ends_at: '2026-11-08T22:59:00.000Z' }], true)).toHaveLength(1)
    expect(failure(() => world.insertOccasions(ME, [{ ...base, all_day: false, ends_at: '2026-11-08T23:00:00.000Z' }], true))).toContain('occasions_ends_at_next_day')
  })

  it('switching to all-day while the end stays is refused; with the end removed in the same update it is fine', () => {
    const { world } = setup()
    const [created] = world.insertOccasions(ME, [{ ...base, all_day: false, ends_at: '2026-11-07T22:00:00.000Z' }], true)
    expect(failure(() => world.updateOccasions(ME, [created!], { all_day: true }, true))).toContain('occasions_ends_at_timed')
    expect(world.updateOccasions(ME, [created!], { all_day: true, ends_at: null }, true)[0]).toMatchObject({ all_day: true, ends_at: null })
  })
})

describe('demo: past at its end', () => {
  it('ended an hour ago → past (before the local midnight); lasting one more hour, also since yesterday → upcoming', () => {
    const { world } = setup()
    const make = (title: string, starts: number, ends: number) =>
      world.insertOccasions(ME, [{ host_id: ME, title, all_day: false, tz: 'Europe/Berlin', starts_at: iso(starts), ends_at: iso(ends) }], true)[0]!.id
    const ended = make('vorbei', NOW - 2 * HOUR, NOW - HOUR)
    const lasting = make('läuft noch', NOW - 2 * HOUR, NOW + HOUR)
    const overnight = make('seit gestern Abend', NOW - 20 * HOUR, NOW + HOUR)
    const feed = world.getFeed(ME)
    expect(feed.past.map((row) => row.id)).toContain(ended)
    expect(feed.upcoming.map((row) => row.id)).toEqual(expect.arrayContaining([lasting, overnight]))
    expect(feed.upcoming.map((row) => row.id)).not.toContain(ended)
  })
})

describe('demo: member_count without people hidden by a block (P-I16)', () => {
  it('the feed counts the people the occasion screen lists, for every viewer', () => {
    const { world, follows } = setup()
    const count = (viewer: string) => world.getFeed(viewer).upcoming.find((row) => row.id === DEMO_OCCASIONS.housewarming)!.member_count
    const listed = (viewer: string) => world.getOccasionScreen(viewer, DEMO_OCCASIONS.housewarming).members.length
    const before = count(ME)
    const annaBefore = count(anna.id)
    follows.blockUser(ME, ben.id) // both stay guests of Anna's "Annas Einweihung"
    expect(count(ME)).toBe(before - 1)
    expect(count(ben.id)).toBe(before - 1)
    expect(count(anna.id)).toBe(annaBefore)
    for (const viewer of [ME, ben.id, anna.id]) expect(count(viewer)).toBe(listed(viewer))
  })
})
