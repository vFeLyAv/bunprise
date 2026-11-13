import { describe, expect, it } from 'vitest'
import { THEME_IDS } from '../features/occasions/covers/themes'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { DemoDbError } from './rest'
import { createDemoWorld, OCCASIONS, type DemoPerson } from './world'

// Demo parity for the cover motif (supabase/migrations/20261027140000_occasion_cover_theme.sql; the PGlite twin is
// packages/db-tests/test/occasions/cover-theme.test.ts): cover_theme in get_feed and get_occasion_screen (null by
// default), stored by the host through insert and update, the same allow-list check, a guest cannot write it.

const NOW = Date.parse('2026-10-20T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const { ben } = DEMO_PEOPLE

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

const base = { host_id: ME, title: 'Geburtstag von Anna', tz: 'Europe/Berlin', starts_at: '2026-11-07T18:00:00.000Z', all_day: true }

describe('demo: cover_theme', () => {
  it('the seeded occasions have none (the key is there, null), in the feed and on the screen', () => {
    const world = setup()
    for (const row of world.getFeed(ME).upcoming) expect(row).toHaveProperty('cover_theme', null)
    expect(world.getOccasionScreen(ME, DEMO_OCCASIONS.housewarming).occasion).toHaveProperty('cover_theme', null)
  })

  it('stored with a new occasion, the same for the host and a guest; changed and switched off by the host', () => {
    const world = setup()
    const [created] = world.insertOccasions(ME, [{ ...base, cover_theme: 'birthday' }], true)
    world.addGuest(created!.id, ben.id)
    for (const viewer of [ME, ben.id]) {
      expect(world.getOccasionScreen(viewer, created!.id).occasion.cover_theme).toBe('birthday')
      expect(world.getFeed(viewer).upcoming.find((row) => row.id === created!.id)?.cover_theme).toBe('birthday')
    }
    expect(world.updateOccasions(ME, [created!], { cover_theme: 'none' }, true)[0]).toMatchObject({ cover_theme: 'none' })
    expect(world.getOccasionScreen(ben.id, created!.id).occasion.cover_theme).toBe('none')
    // a guest changes nothing (occasions_update: the host only)
    expect(world.updateOccasions(ben.id, [created!], { cover_theme: 'party' }, false)).toEqual([])
    expect(world.getOccasionScreen(ME, created!.id).occasion.cover_theme).toBe('none')
  })

  it('the allow-list: every motif and "none" are fine, anything else is refused like the database does', () => {
    const world = setup()
    for (const theme of [...THEME_IDS, 'none']) expect(world.insertOccasions(ME, [{ ...base, cover_theme: theme }], true)).toHaveLength(1)
    for (const bad of ['Birthday', '', 'hiking']) {
      expect(failure(() => world.insertOccasions(ME, [{ ...base, cover_theme: bad }], true)), bad).toContain('occasions_cover_theme_check')
    }
    const [created] = world.insertOccasions(ME, [base], true)
    expect(failure(() => world.updateOccasions(ME, [created!], { cover_theme: 'disco' }, true))).toContain('occasions_cover_theme_check')
  })

  it('readable and writable like the other occasion columns', () => {
    expect(OCCASIONS.columns).toContain('cover_theme')
    expect(OCCASIONS.readable).toContain('cover_theme')
  })
})
