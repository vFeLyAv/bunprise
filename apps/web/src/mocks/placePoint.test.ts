import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { DemoDbError } from './rest'
import { createDemoWorld, OCCASIONS, type DemoPerson } from './world'

// Demo parity for the point of the occasion's place (supabase/migrations/20261027190000_occasion_place_point.sql; the
// PGlite twin is packages/db-tests/test/occasions/place-point.test.ts): place_lat / place_lon on get_occasion_screen
// (null without a point; the feed unchanged), stored by the host through insert and update (5 decimals), the same
// check (both or neither, only with a place text, in range), a new place text without a new point drops the old
// point, a guest cannot write it. Invented points in the invented town only.

const NOW = Date.parse('2026-10-20T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const { ben } = DEMO_PEOPLE
const CAFE = { place_text: 'Café Morgenrot, Lindenweg 4, 12345 Beispielstadt', place_lat: 51.16212, place_lon: 10.45231 }

function person(id: string, name: string | null = 'Mila Sommer'): DemoPerson {
  return { id, displayName: () => name, hasConsents: () => true }
}

function setup() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  world.addPerson(person(ME))
  world.addGuest(DEMO_OCCASIONS.housewarming, ME)
  return world
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

const base = { host_id: ME, title: 'Kaffee mit Anna', tz: 'Europe/Berlin', starts_at: '2026-11-07T18:00:00.000Z', all_day: true }
const pointOf = (world: ReturnType<typeof setup>, viewer: string, id: string) => {
  const { place_lat, place_lon } = world.getOccasionScreen(viewer, id).occasion
  return [place_lat, place_lon]
}

describe('demo: place_lat / place_lon', () => {
  it('the seeded occasions carry an invented point (the guest screen shows the mini map); the feed has no point', () => {
    const world = setup()
    const [lat, lon] = pointOf(world, ME, DEMO_OCCASIONS.housewarming)
    expect(typeof lat).toBe('number')
    expect(typeof lon).toBe('number')
    for (const row of world.getFeed(ME).upcoming) expect(row).not.toHaveProperty('place_lat')
  })

  it('stored by the host (rounded to 5 decimals), the same for host and guests; a guest cannot write it', () => {
    const world = setup()
    const [created] = world.insertOccasions(ME, [{ ...base, ...CAFE, place_lat: 51.162123 }], true)
    expect(pointOf(world, ME, created!.id)).toEqual([51.16212, CAFE.place_lon])
    world.addGuest(created!.id, ben.id)
    expect(pointOf(world, ben.id, created!.id)).toEqual([51.16212, CAFE.place_lon])
    expect(world.updateOccasions(ben.id, [created!], { place_lat: 1, place_lon: 1 }, false)).toEqual([])
    expect(pointOf(world, ME, created!.id)).toEqual([51.16212, CAFE.place_lon])
  })

  it('a new place text without a new point drops the point; the same text keeps it; a new pick brings the new one', () => {
    const world = setup()
    const [created] = world.insertOccasions(ME, [{ ...base, ...CAFE }], true)
    world.updateOccasions(ME, [created!], { title: 'Neu', place_text: CAFE.place_text }, true)
    expect(pointOf(world, ME, created!.id)).toEqual([CAFE.place_lat, CAFE.place_lon])
    world.updateOccasions(ME, [created!], { place_text: 'Bei mir zu Hause' }, true)
    expect(pointOf(world, ME, created!.id)).toEqual([null, null])
    world.updateOccasions(ME, [created!], { place_text: 'Stadtpark', place_lat: 51.16655, place_lon: 10.44302 }, true)
    expect(pointOf(world, ME, created!.id)).toEqual([51.16655, 10.44302])
    world.updateOccasions(ME, [created!], { place_text: null }, true)
    expect(pointOf(world, ME, created!.id)).toEqual([null, null])
  })

  it('both or neither, only with a place text, in range — refused like the database does', () => {
    const world = setup()
    for (const bad of [
      { ...CAFE, place_lon: null },
      { ...CAFE, place_lat: null },
      { ...CAFE, place_text: null },
      { ...CAFE, place_lat: 90.5 },
      { ...CAFE, place_lon: -180.5 },
      { ...CAFE, place_lat: 'NaN' },
    ]) {
      expect(failure(() => world.insertOccasions(ME, [{ ...base, ...bad }], true)), JSON.stringify(bad)).toContain('occasions_place_point_check')
    }
    expect(failure(() => world.insertOccasions(ME, [{ ...base, ...CAFE, place_lat: 'north' }], true))).toContain('22P02')
  })

  it('readable and writable like the other occasion columns', () => {
    expect(OCCASIONS.columns).toEqual(expect.arrayContaining(['place_lat', 'place_lon']))
    expect(OCCASIONS.readable).toEqual(expect.arrayContaining(['place_lat', 'place_lon']))
  })
})
