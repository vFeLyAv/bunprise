import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { describe, expect, it } from 'vitest'
import type { FeedOccasion } from '../../lib/api/types'
import { browserTimeZone, zonedWallTimeToIso } from '../../lib/time'
import { FeedCard } from './FeedCard'

// The end time on the Start card (Felix 26.10, migration 20261026180000): "Sa., 31. Okt. · 19:00–23:00", or
// "… · 19:00 bis 02:00 (nächster Tag)"; a feed persisted before the migration (no key) shows only the start.

const zone = browserTimeZone()
const ID = '0b7c8a1e-5555-4a5b-9c3d-000000000001'

// Invented fixture (no real data).
function row(overrides: Partial<FeedOccasion> = {}): FeedOccasion {
  return {
    id: ID, title: 'Spieleabend', starts_at: zonedWallTimeToIso('2030-10-26', '19:00', zone), tz: zone, all_day: false,
    place_text: null, role: 'host', rsvp: 'going', host_name: 'Mila', host_id: 'host-1',
    member_count: 4, wish_count: 2, my_reservation_count: null,
    ...overrides,
  }
}

async function renderCard(occasion: FeedOccasion) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/soon', component: () => <FeedCard occasion={occasion} /> }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/soon'] }) })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return screen.findByRole('link', { name: 'Spieleabend' })
}

const whenLine = (card: HTMLElement) => card.querySelector('.t-footnote')?.textContent ?? ''

describe('the end on the Start card', () => {
  it('"19:00–23:00" on the same day', async () => {
    const card = await renderCard(row({ ends_at: zonedWallTimeToIso('2030-10-26', '23:00', zone) }))
    expect(whenLine(card)).toContain('Sa., 26. Okt. · 19:00–23:00')
  })

  it('"19:00 bis 02:00 (nächster Tag)" when it ends after midnight', async () => {
    const card = await renderCard(row({ ends_at: zonedWallTimeToIso('2030-10-27', '02:00', zone) }))
    expect(whenLine(card)).toContain('Sa., 26. Okt. · 19:00 bis 02:00 (nächster Tag)')
  })

  it('only the start without an end', async () => {
    const card = await renderCard(row({ ends_at: null }))
    expect(whenLine(card)).toContain('Sa., 26. Okt. · 19:00')
    expect(whenLine(card)).not.toContain('–')
  })

  it('only the start from a feed without the key (older server, persisted before the migration)', async () => {
    const card = await renderCard(row())
    expect(whenLine(card)).toContain('Sa., 26. Okt. · 19:00')
    expect(whenLine(card)).not.toContain('–')
  })
})
