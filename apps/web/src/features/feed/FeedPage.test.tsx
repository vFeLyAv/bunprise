import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedOccasion, FeedScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { browserTimeZone } from '../../lib/time'

const api = vi.hoisted(() => ({ getFeed: vi.fn() }))
vi.mock('../../lib/api/occasions', () => ({ getFeed: api.getFeed, getOccasionScreen: vi.fn() }))
// The puppet and the welcome stage are tested in features/mascot-ui; here only which moment is requested.
vi.mock('../mascot-ui/WelcomeBunnies', () => ({
  default: (props: { choreography: string }) => <div data-testid="welcome-bunnies" data-choreography={props.choreography} />,
}))
vi.mock('../mascot-ui/Mascot', () => ({
  Mascot: (props: { kind: string; scene?: string }) => <div data-testid="mascot" data-kind={props.kind} data-scene={props.scene} />,
}))

import { FeedPage, FeedPending } from './FeedPage'
import { loadFeed } from './loadFeed'
import { resetFeedSession } from './session'

// Local wall-clock dates (Date constructor = the test machine's zone = the zone the feed uses),
// so the grouping does not depend on where the tests run.
const NOW = new Date(2026, 9, 20, 9, 0) // Tue 20 Oct 2026, 09:00
const at = (day: number, hour = 19, month = 9) => new Date(2026, month, day, hour, 0).toISOString()

const ids = {
  todayHost: '0b7c8a1e-1111-4a5b-9c3d-000000000001',
  tomorrowGuest: '0b7c8a1e-1111-4a5b-9c3d-000000000002',
  weekGuest: '0b7c8a1e-1111-4a5b-9c3d-000000000003',
  laterHost: '0b7c8a1e-1111-4a5b-9c3d-000000000004',
  pastGuest: '0b7c8a1e-1111-4a5b-9c3d-000000000005',
}

function row(overrides: Partial<FeedOccasion> & Pick<FeedOccasion, 'id' | 'title' | 'starts_at'>): FeedOccasion {
  return {
    tz: browserTimeZone(),
    all_day: false,
    place_text: null,
    role: 'member',
    rsvp: 'none',
    host_name: 'Anna',
    member_count: 3,
    wish_count: 2,
    my_reservation_count: 0,
    ...overrides,
  }
}

// Invented fixture people and places (no real data).
const FEED: FeedScreen = {
  upcoming: [
    row({ id: ids.todayHost, title: 'Milas Geburtstag', starts_at: at(20), role: 'host', host_name: 'Mila', member_count: 4, my_reservation_count: null, place_text: 'Bei mir zu Hause' }),
    row({ id: ids.tomorrowGuest, title: 'Spieleabend', starts_at: at(21), rsvp: 'going', my_reservation_count: 2, place_text: 'Café Mitte' }),
    row({ id: ids.weekGuest, title: 'Grillen', starts_at: at(24, 15), host_name: 'Ben', my_reservation_count: 0 }),
    // a host row must never show a reservation count, even if one arrived by mistake
    row({ id: ids.laterHost, title: 'Hochzeitstag', starts_at: at(14, 18, 10), role: 'host', member_count: 1, my_reservation_count: 3 }),
  ],
  past: [row({ id: ids.pastGuest, title: 'Kinoabend', starts_at: at(10), my_reservation_count: 1 })],
}

function OccasionStub() {
  const params = useParams({ strict: false })
  return <p>occasion {params.occasionId}</p>
}

function renderFeed({ pendingMs = 1000 }: { pendingMs?: number } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/soon',
      loader: () => loadFeed(queryClient),
      pendingComponent: FeedPending,
      component: FeedPage,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/occasions/$occasionId', component: OccasionStub }),
    createRoute({ getParentRoute: () => rootRoute, path: '/occasions/new', component: () => <p>new occasion</p> }),
    createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => <p>settings</p> }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/soon'] }),
    defaultPendingMs: pendingMs,
    defaultPendingMinMs: 0,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

/** An occasion card: a link whose accessible name is the title. */
const card = (title: string): HTMLElement => screen.getByRole('link', { name: title })
const titlesIn = (region: HTMLElement): (string | null | undefined)[] =>
  within(region).getAllByRole('link').map((link) => link.querySelector('h3')?.textContent)
const tagsOf = (link: HTMLElement): string[] =>
  Array.from(link.querySelectorAll('[id$="-tags"] > span'), (tag) => tag.textContent ?? '')
const transitionName = (element: HTMLElement): string => element.style.viewTransitionName || ''

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  api.getFeed.mockReset()
  resetFeedSession()
  onlineManager.setOnline(true)
})
afterEach(() => {
  vi.useRealTimers()
  onlineManager.setOnline(true)
})

describe('feed "Start"', () => {
  it('groups upcoming occasions into Heute · In den nächsten Tagen · Später and keeps the past collapsed', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderFeed()
    expect(await screen.findByRole('heading', { level: 1, name: 'Start' })).toBeTruthy()
    expect(titlesIn(screen.getByRole('region', { name: 'Heute' }))).toEqual(['Milas Geburtstag'])
    expect(titlesIn(screen.getByRole('region', { name: 'In den nächsten Tagen' }))).toEqual(['Spieleabend', 'Grillen'])
    expect(titlesIn(screen.getByRole('region', { name: 'Später' }))).toEqual(['Hochzeitstag'])
    const groupOrder = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(groupOrder.slice(0, 3)).toEqual(['Heute', 'In den nächsten Tagen', 'Später'])

    // past 30 days: collapsed until opened, shown with the count
    const toggle = await screen.findByRole('button', { name: /Vergangen \(30 Tage\)/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('1')
    expect(screen.queryByRole('link', { name: 'Kinoabend' })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const past = await screen.findByRole('link', { name: 'Kinoabend' })
    expect(past.textContent).toContain('Vor 10 Tagen')
    // a past occasion no longer asks for an answer; the guest still sees their own reservations
    expect(tagsOf(past)).toEqual([])
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Kinoabend' })).toBeNull())
  })

  it('renders host and member cards with their own details and chips', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderFeed()
    const host = await screen.findByRole('link', { name: 'Milas Geburtstag' })
    expect(host.getAttribute('href')).toBe(`/occasions/${ids.todayHost}`)
    expect(host.textContent).toContain('Heute · ')
    expect(host.textContent).toContain('19:00')
    expect(within(host).getByText('Bei mir zu Hause')).toBeTruthy()
    expect(host.textContent).not.toContain('lädt ein') // the host is not told who hosts
    expect(tagsOf(host)).toEqual(['Du lädst ein', '3 Gäste'])
    expect(tagsOf(card('Hochzeitstag'))).toEqual(['Du lädst ein', 'Noch keine Gäste'])

    const guest = card('Spieleabend')
    expect(guest.textContent).toContain('Morgen · ')
    // narrow: only the name gives way, never the verb ("Anna Beispiel läd…" at 320 px)
    const hostName = within(guest).getByText('Anna')
    expect(hostName.className).toContain('truncate')
    expect(hostName.parentElement?.textContent).toBe('Anna lädt ein')
    expect(within(guest).getByText('Café Mitte')).toBeTruthy()
    expect(tagsOf(guest)).toEqual(['Zugesagt'])

    const unanswered = card('Grillen')
    expect(within(unanswered).getByText('Ben').parentElement?.textContent).toBe('Ben lädt ein')
    expect(tagsOf(unanswered)).toEqual(['Kommst du?']) // 0 own reservations → no chip at all
  })

  it('never shows anything about reservations on a host card (secrecy)', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderFeed()
    // the regular host row (null) and a host row with a stray number look exactly alike
    for (const host of [await screen.findByRole('link', { name: 'Milas Geburtstag' }), card('Hochzeitstag')]) {
      expect(host.textContent).not.toMatch(/reserv/i)
      expect(tagsOf(host)).toHaveLength(2)
      expect(host.getAttribute('href')).not.toMatch(/reserv/i)
    }
  })

  it('hides the guest’s reservation count while offline', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderFeed()
    expect(tagsOf(await screen.findByRole('link', { name: 'Spieleabend' }))).toEqual(['Zugesagt'])
    act(() => onlineManager.setOnline(false))
    expect(tagsOf(card('Spieleabend'))).toEqual(['Zugesagt'])
  })

  it('has identical guest and host card markup at zero and five reservations; only the own wish hint changes', async () => {
    const zero = { ...FEED, upcoming: FEED.upcoming.map((item) => ({ ...item, my_reservation_count: 0, wish_count: 0 })) }
    api.getFeed.mockResolvedValue(zero)
    const { queryClient } = renderFeed()
    await screen.findByRole('link', { name: 'Spieleabend' })
    const guest = card('Spieleabend').innerHTML
    const host = card('Milas Geburtstag').innerHTML
    expect(tagsOf(card('Milas Geburtstag'))).toContain('Noch keine Wünsche')
    expect(tagsOf(card('Spieleabend'))).not.toContain('Noch keine Wünsche')
    await act(async () => {
      queryClient.setQueryData(['feed'], { ...zero, upcoming: zero.upcoming.map((item) => ({ ...item, my_reservation_count: 5 })) })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(card('Spieleabend').innerHTML).toBe(guest)
    expect(card('Milas Geburtstag').innerHTML).toBe(host)
    await act(async () => {
      queryClient.setQueryData(['feed'], FEED)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(tagsOf(card('Milas Geburtstag'))).not.toContain('Noch keine Wünsche')
  })

  it('opens the occasion with the shared-element name, and that card keeps it on the way back', async () => {
    api.getFeed.mockResolvedValue(FEED)
    const { router } = renderFeed()
    const guest = await screen.findByRole('link', { name: 'Spieleabend' })
    expect(transitionName(guest)).toBe('')
    fireEvent.click(guest)
    expect(transitionName(guest)).toBe(`occasion-${ids.tomorrowGuest}`)
    expect(await screen.findByText(`occasion ${ids.tomorrowGuest}`)).toBeTruthy()
    expect(router.state.location.pathname).toBe(`/occasions/${ids.tomorrowGuest}`)

    act(() => router.history.back())
    const again = await screen.findByRole('link', { name: 'Spieleabend' })
    expect(transitionName(again)).toBe(`occasion-${ids.tomorrowGuest}`)
    expect(transitionName(card('Grillen'))).toBe('')
  })

  it('has no gear and no FAB any more (the tab bar: "+" creates, Profil opens the settings — features/nav)', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderFeed()
    expect(await screen.findByRole('link', { name: 'Milas Geburtstag' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Einstellungen' })).toBeNull()
    expect(document.querySelector('a[href="/settings"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Anlass anlegen' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Anlass anlegen' })).toBeNull()
  })

  it('shows the bunny on an empty feed with a single call to create an occasion', async () => {
    api.getFeed.mockResolvedValue({ upcoming: [], past: [] } satisfies FeedScreen)
    renderFeed()
    expect(await screen.findByRole('heading', { level: 2, name: 'Noch nichts geplant' })).toBeTruthy()
    expect(screen.getByText('Leg einen Anlass an oder warte auf eine Einladung.')).toBeTruthy()
    // This illustration reserves layout space: every director variant must stay on the
    // card edge after its show, rather than disappearing and leaving an empty stage.
    expect(['peek-once', 'wave', 'lift']).toContain((await screen.findByTestId('welcome-bunnies')).dataset.choreography)
    expect(screen.getByRole('link', { name: 'Anlass anlegen' }).getAttribute('href')).toBe('/occasions/new')
    // the empty state's button is the only call to action (no FAB next to it), no past group
    expect(screen.queryByRole('button', { name: 'Anlass anlegen' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Vergangen/ })).toBeNull()
  })

  it('keeps past occasions reachable when nothing is upcoming', async () => {
    api.getFeed.mockResolvedValue({ upcoming: [], past: FEED.past } satisfies FeedScreen)
    renderFeed()
    expect(await screen.findByRole('heading', { level: 2, name: 'Noch nichts geplant' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Vergangen \(30 Tage\)/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('shows a load error inline and recovers with "Nochmal versuchen"', async () => {
    api.getFeed.mockRejectedValueOnce(new AppError('network'))
    renderFeed()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Laden hat nicht geklappt')
    expect(alert.textContent).toContain('Keine Verbindung')
    // the loader already tried once: no second automatic request on mount
    expect(api.getFeed).toHaveBeenCalledTimes(1)
    // the top bar stays meanwhile (the brand mark; the settings are the tab bar's Profil tab)
    expect(screen.getByRole('banner')).toBeTruthy()

    api.getFeed.mockResolvedValueOnce(FEED)
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }))
    expect(await screen.findByRole('link', { name: 'Milas Geburtstag' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(api.getFeed).toHaveBeenCalledTimes(2)
  })

  it('reassures instead of showing a technical reason when the failure is unspecific', async () => {
    api.getFeed.mockRejectedValueOnce(new AppError('generic'))
    renderFeed()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Laden hat nicht geklappt')
    expect(alert.textContent).toContain('Deine Anlässe sind nicht weg – versuch es gleich nochmal.')
  })

  it('shows card skeletons while the feed loads, never a spinner', async () => {
    api.getFeed.mockReturnValue(new Promise<FeedScreen>(() => undefined))
    renderFeed({ pendingMs: 0 })
    expect((await screen.findByRole('status')).textContent).toBe('Lädt …')
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(3)
    expect(document.querySelector('.spinner')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Start' })).toBeTruthy()
  })
})

describe('feed cards: preloading the occasion screen (docs/decisions/2026-10-20-guard-me-cache.md)', () => {
  /** loader runs of the occasion route: in the app it starts get_occasion_screen (features/occasions/data.ts) */
  let loads: { preload: boolean; occasionId: string }[] = []

  /** The app's router options (src/router.tsx): intent preloading after 50 ms. */
  function renderWithPreload() {
    loads = []
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/soon', loader: () => loadFeed(queryClient), component: FeedPage }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/occasions/$occasionId',
        loader: ({ preload, params }) => {
          loads.push({ preload, occasionId: params.occasionId })
        },
        component: OccasionStub,
      }),
      createRoute({ getParentRoute: () => rootRoute, path: '/occasions/new', component: () => <p>new occasion</p> }),
      createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => <p>settings</p> }),
    ])
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/soon'] }),
      defaultPreload: 'intent',
      defaultPreloadDelay: 50,
      defaultPreloadStaleTime: 0,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domMax} strict>
          <RouterProvider router={router} />
        </LazyMotion>
      </QueryClientProvider>,
    )
    return router
  }

  /** Longer than the intent delay: a preload would have started by now. */
  const pause = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 120)))

  it('a finger that starts scrolling the feed touches cards: no loader runs, no get_occasion_screen', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderWithPreload()
    for (const title of ['Spieleabend', 'Grillen', 'Hochzeitstag']) {
      const link = await screen.findByRole('link', { name: title })
      fireEvent.touchStart(link)
      fireEvent.touchMove(link)
      fireEvent.touchEnd(link)
    }
    await pause()
    expect(loads).toEqual([])
  })

  it('a mouse resting on a card (or the keyboard focus) preloads that occasion after 50 ms', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderWithPreload()
    fireEvent.mouseEnter(await screen.findByRole('link', { name: 'Spieleabend' }))
    await pause()
    expect(loads).toEqual([{ preload: true, occasionId: ids.tomorrowGuest }])
    fireEvent.focus(card('Grillen'))
    await pause()
    expect(loads).toEqual([{ preload: true, occasionId: ids.tomorrowGuest }, { preload: true, occasionId: ids.weekGuest }])
  })

  it('passing over a card (or tabbing past it) within 50 ms preloads nothing', async () => {
    api.getFeed.mockResolvedValue(FEED)
    renderWithPreload()
    const link = await screen.findByRole('link', { name: 'Spieleabend' })
    fireEvent.mouseEnter(link)
    fireEvent.mouseLeave(link)
    fireEvent.focus(card('Grillen'))
    fireEvent.blur(card('Grillen'))
    await pause()
    expect(loads).toEqual([])
  })

  it('a tap opens the occasion at once: the click starts its loader, no preload is left behind', async () => {
    api.getFeed.mockResolvedValue(FEED)
    const router = renderWithPreload()
    const link = await screen.findByRole('link', { name: 'Spieleabend' })
    // a tap on a phone: touch events, then the compatibility mouse events and the click
    fireEvent.touchStart(link)
    fireEvent.touchEnd(link)
    fireEvent.mouseEnter(link)
    fireEvent.click(link)
    expect(await screen.findByText(`occasion ${ids.tomorrowGuest}`)).toBeTruthy()
    await pause()
    expect(loads).toEqual([{ preload: false, occasionId: ids.tomorrowGuest }])
    expect(router.state.location.pathname).toBe(`/occasions/${ids.tomorrowGuest}`)
  })
})
