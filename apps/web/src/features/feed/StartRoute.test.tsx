import type { Session } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter, isRedirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedOccasion, FeedScreen } from '../../lib/api/types'
import { queryKeys } from '../../lib/queryKeys'

// Start with the REAL route tree (wave 2): the "Liste | Monat" switch writes the address (/soon ↔
// /soon?view=month), the tab bar's Start link remembers the view, and the old calendar address /calendar
// redirects to the month view — keeping ?created, so the bunny still files a new occasion (K10).
// The guard's session and consent check are stubbed; no request leaves this file. Invented fixtures only.

const api = vi.hoisted(() => ({ getFeed: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => new Promise(() => {}),
  hasLocalSession: () => true,
  getLocalSession: () => Promise.resolve({ access_token: 'fixture', user: { id: '00000000-0000-4000-8000-0000000000f1' } } as Session),
  onClientReady: () => () => {},
}))
vi.mock('../../lib/consentGate', () => ({ hasCurrentConsents: () => Promise.resolve(true) }))
vi.mock('../../lib/api/occasions', () => ({ getFeed: api.getFeed, getOccasionScreen: vi.fn() }))
vi.mock('../mascot-ui/WelcomeBunnies', () => ({
  default: () => <div data-testid="welcome-bunnies" />,
  preloadWelcome: () => undefined,
}))
vi.mock('../mascot-ui/carry', () => ({ playCarry: () => Promise.resolve() }))

import { routeTree } from '../../routeTree.gen'
import { Route as CalendarRoute } from '../../routes/_authed/calendar'
import { setMotionPrefs, resetMotionLevelForTests } from '../../motion/level'
import { resetCalendarSession } from '../calendar/session'
import { resetFeedSession } from './session'

const CREATED = '0b7c8a1e-6666-4a5b-9c3d-000000000001'
const at = (month: number, day: number, hour = 18) => new Date(2026, month - 1, day, hour, 0).toISOString()
const row = (id: string, title: string, startsAt: string, host: string | null = null): FeedOccasion => ({
  id, title, starts_at: startsAt, tz: 'Europe/Berlin', all_day: false, place_text: null, role: host ? 'member' : 'host',
  rsvp: 'going', host_name: host ?? 'Mila Sommer', member_count: 2, wish_count: 0, my_reservation_count: host ? 0 : null,
})
const FEED: FeedScreen = {
  upcoming: [row('0b7c8a1e-6666-4a5b-9c3d-000000000002', 'Annas Einweihung', at(10, 23), 'Anna Beispiel'), row(CREATED, 'Milas Gartenfest', at(11, 1, 15))],
  past: [],
}

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData(queryKeys.feed(), FEED)
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: [path] }), defaultPendingMinMs: 0 })
  // main.tsx provides the query client around the router
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const tabs = () => screen.getByRole('navigation', { name: 'Hauptnavigation' })
const views = () => screen.getByRole('radiogroup', { name: 'Ansicht' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 9, 0))
  api.getFeed.mockResolvedValue(FEED)
  resetFeedSession()
  resetCalendarSession()
  // the landing finishes at once (the carry itself is tested in calendar/MonthView.test.tsx)
  setMotionPrefs({ level: 'off' })
})
afterEach(() => {
  vi.useRealTimers()
  resetMotionLevelForTests()
  window.localStorage.clear()
})

describe('Start: "Liste | Monat"', () => {
  it('opens on the list, with a clean address, the switch in the header and no legal footer', async () => {
    const router = renderApp('/soon')
    expect(await screen.findByRole('heading', { level: 1, name: 'Start' })).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Annas Einweihung' })).toBeTruthy()
    expect(within(views()).getByRole('radio', { name: 'Liste' }).getAttribute('aria-checked')).toBe('true')
    expect(router.state.location.href).toBe('/soon')
    expect(within(tabs()).getByRole('link', { name: 'Start' }).getAttribute('aria-current')).toBe('page')
    expect(document.querySelector('footer')).toBeNull()
  })

  it('"Monat" shows the calendar in Start (the address says so); the Start tab remembers it; "Liste" comes back', async () => {
    const router = renderApp('/soon')
    await screen.findByRole('link', { name: 'Annas Einweihung' })
    fireEvent.click(within(views()).getByRole('radio', { name: 'Monat' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'month' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' }, { timeout: 3000 })).toBeTruthy()
    expect(within(views()).getByRole('radio', { name: 'Monat' }).getAttribute('aria-checked')).toBe('true')
    // still the Start tab, and its link keeps the month view for later
    expect(within(tabs()).getByRole('link', { name: 'Start' }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(within(tabs()).getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/soon?view=month'))
    // to another tab and back: the month view again
    fireEvent.click(within(tabs()).getByRole('link', { name: /Profil/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
    fireEvent.click(within(tabs()).getByRole('link', { name: 'Start' }))
    await waitFor(() => expect(router.state.location.href).toBe('/soon?view=month'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' }, { timeout: 3000 })).toBeTruthy()
    fireEvent.click(within(views()).getByRole('radio', { name: 'Liste' }))
    await waitFor(() => expect(router.state.location.href).toBe('/soon'))
    expect(await screen.findByRole('link', { name: 'Annas Einweihung' })).toBeTruthy()
    await waitFor(() => expect(within(tabs()).getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/soon'))
  })
})

describe('the old calendar address', () => {
  it('/calendar redirects to Start in the month view', async () => {
    const router = renderApp('/calendar')
    expect(await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' }, { timeout: 3000 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/soon')
    expect(router.state.location.search).toEqual({ view: 'month' })
  })

  it('/calendar?created=<id> (after saving an occasion) lands it on its day in Start’s month view, then drops the id', async () => {
    const router = renderApp(`/calendar?created=${CREATED}`)
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/soon')
    const target = document.querySelector<HTMLElement>('[data-landing]')
    expect(target?.dataset.day).toBe('2026-11-01')
    await waitFor(() => expect(target?.querySelector('[data-landing-chip]')?.hasAttribute('data-landed')).toBe(true))
    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'month' }))
    expect(await screen.findByRole('link', { name: 'Freunde zu „Milas Gartenfest“ einladen' })).toBeTruthy()
  })

  it('the redirect keeps only a valid occasion id', () => {
    const beforeLoad = CalendarRoute.options.beforeLoad as (ctx: { search: { created?: string } }) => void
    const caught = (search: { created?: string }) => {
      try {
        beforeLoad({ search })
      } catch (err) {
        return err
      }
      return null
    }
    const withId = caught({ created: CREATED })
    expect(isRedirect(withId)).toBe(true)
    expect((withId as { options: unknown }).options).toMatchObject({ to: '/soon', search: { view: 'month', created: CREATED }, replace: true })
    const without = caught({})
    expect((without as { options: { search: unknown } }).options.search).toEqual({ view: 'month' })
    const validate = CalendarRoute.options.validateSearch as (search: Record<string, unknown>) => unknown
    expect(validate({ created: 'kein-uuid' })).toEqual({})
  })
})
