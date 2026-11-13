import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDemoCalendar, DEMO_BIRTHDAYS, nextAnniversary } from './calendar'
import { DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { DEMO_SUPABASE_URL } from './rest'
import { createDemoWorld } from './world'

// The demo's Kalender-Abo + birthday suggestion (src/mocks/calendar.ts) answers like
// supabase/migrations/20261027170000_calendar_feed.sql (the SQL itself is proven in packages/db-tests/test/calendar):
// one feed per person, shown once, status without the token, export; anniversaries 14–28 days ahead. Invented ids only.

const NOW = Date.parse('2026-10-27T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'

let viewer: string | null = ME
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

function setup() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  world.addPerson({ id: ME, displayName: () => 'Mila', hasConsents: () => true })
  const calendar = createDemoCalendar(world, { now: () => NOW })
  calendar.seedDemo(ME, NOW)
  server.resetHandlers(...calendar.handlers(() => viewer))
  return { world, calendar }
}

beforeEach(() => {
  viewer = ME
})

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  return { status: response.status, body: await response.json() as unknown }
}

describe('demo calendar', () => {
  it('next anniversary like the database', () => {
    expect(nextAnniversary('2025-11-14', '2026-10-27')).toBe('2026-11-14')
    expect(nextAnniversary('2025-01-02', '2026-10-27')).toBe('2027-01-02')
    expect(nextAnniversary('2024-02-29', '2026-01-01')).toBe('2026-02-28')
  })

  it('the seeded birthdays: mine (host, 18 days) and Clara’s (guest, 25 days)', async () => {
    setup()
    const { body } = await rpc('get_anniversary_suggestions')
    expect(body).toMatchObject([
      { occasion_id: DEMO_BIRTHDAYS.mine, role: 'host', title: 'Mein Geburtstag', cover_theme: 'birthday', days_ahead: 18 },
      { occasion_id: DEMO_BIRTHDAYS.clara, role: 'member', host_id: DEMO_PEOPLE.clara.id, host_name: 'Clara Test', days_ahead: 25 },
    ])
  })

  it('the feed: none → create (token once) → status without the token → export → revoke', async () => {
    setup()
    expect((await rpc('get_calendar_feed')).body).toEqual({ active: false, created_at: null, last_fetched_at: null, lang: null })
    expect((await rpc('create_calendar_feed', { p_lang: 'xx' })).status).toBe(400)
    const made = (await rpc('create_calendar_feed', { p_lang: 'ru' })).body as { token: string }
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const status = (await rpc('get_calendar_feed')).body
    expect(status).toMatchObject({ active: true, lang: 'ru' })
    expect(JSON.stringify(status)).not.toContain(made.token)
    expect(JSON.stringify((await rpc('export_my_calendar_feed')).body)).not.toContain(made.token)
    expect((await rpc('revoke_calendar_feed')).body).toEqual({ ok: true })
    expect((await rpc('export_my_calendar_feed')).body).toBeNull()
    viewer = null
    expect((await rpc('get_calendar_feed')).status).toBe(400)
  })
})
