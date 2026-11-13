import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, useParams } from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedOccasion, FeedScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { queryKeys } from '../../lib/queryKeys'
import { Route as StartRouteFile } from '../../routes/_authed/soon'
import { setMotionPrefs, resetMotionLevelForTests } from '../../motion/level'
import MonthView, { type TodayControl } from './MonthView'
import { CARRY_SAFETY_MS, CARRY_TINT, dispatchLanded } from './landing'
import { clearInviteFocus, peekInviteFocus } from '../occasions/inviteFocus'
import { lastCalendarFilter, rememberCalendarFilter, resetCalendarSession } from './session'

const api = vi.hoisted(() => ({ getFeed: vi.fn() }))
vi.mock('../../lib/api/occasions', () => ({ getFeed: api.getFeed, getOccasionScreen: vi.fn() }))
// the bunny's carry is its own lazy chunk (features/mascot-ui/carry.ts, tested there): here, what the month view asks of it
const carry = vi.hoisted(() => ({ play: vi.fn() }))
vi.mock('../mascot-ui/carry', () => ({ playCarry: carry.play }))

const ids = {
  a: '0b7c8a1e-4444-4a5b-9c3d-00000000000a',
  b: '0b7c8a1e-4444-4a5b-9c3d-00000000000b',
  c: '0b7c8a1e-4444-4a5b-9c3d-00000000000c',
  d: '0b7c8a1e-4444-4a5b-9c3d-00000000000d',
  e: '0b7c8a1e-4444-4a5b-9c3d-00000000000e',
  f: '0b7c8a1e-4444-4a5b-9c3d-00000000000f',
  g: '0b7c8a1e-4444-4a5b-9c3d-000000000010',
  h: '0b7c8a1e-4444-4a5b-9c3d-000000000011',
}
// local wall-clock instants (the calendar places timed occasions in the viewer's zone = the test machine's)
const at = (month: number, day: number, hour = 18) => new Date(2026, month - 1, day, hour, 0).toISOString()

function row(id: string, title: string, startsAt: string, host: string | null = null): FeedOccasion {
  const role: FeedOccasion['role'] = host ? 'member' : 'host'
  return {
    id, title, starts_at: startsAt, tz: 'Europe/Berlin', all_day: false, place_text: role === 'host' ? 'Café am Markt' : null, role,
    rsvp: 'going', host_name: host ?? 'Mila Sommer', member_count: 2, wish_count: 1, my_reservation_count: role === 'host' ? null : 0,
  }
}

// Invented fixtures (no real people or places).
const FEED: FeedScreen = {
  upcoming: [
    row(ids.a, 'Annas Einweihung', at(10, 23, 18), 'Anna Beispiel'),
    row(ids.b, 'Spieleabend', at(10, 23, 20)),
    row(ids.e, 'Bens Geburtstag', at(10, 27, 19), 'Ben Mustermann'),
    row(ids.f, 'Annas Brunch', at(10, 29, 11), 'Anna Beispiel'),
    // just created: no wishes yet (the calendar offers "Wünsche eintragen")
    { ...row(ids.c, 'Picknick im Park', at(11, 1, 12)), wish_count: 0 },
    row(ids.d, 'Weihnachtsmarkt', at(12, 12, 17)),
  ],
  past: [],
}

// the Start route's own validator (routes/_authed/soon.tsx): ?view=month&created=<id>
const validateSearch = StartRouteFile.options.validateSearch as (search: Record<string, unknown>) => { view?: 'month'; created?: string }

function renderMonth(path = '/soon?view=month', feed: FeedScreen | null = FEED, onToday: (control: TodayControl | null) => void = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (feed) queryClient.setQueryData(queryKeys.feed(), feed)
  const root = createRootRoute({ component: () => <Outlet /> })
  const start = createRoute({
    getParentRoute: () => root,
    path: '/soon',
    validateSearch,
    component: function StartRoute() {
      const { created } = start.useSearch()
      const navigate = start.useNavigate()
      return (
        <MonthView
          created={created ?? null}
          onLandingDone={created ? () => void navigate({ search: { view: 'month' }, replace: true }) : undefined}
          onToday={onToday}
        />
      )
    },
  })
  function OccasionStub() {
    const params = useParams({ strict: false }) as { occasionId?: string }
    return <p>occasion {params.occasionId}</p>
  }
  const routeTree = root.addChildren([
    start,
    createRoute({ getParentRoute: () => root, path: '/occasions/$occasionId', component: OccasionStub }),
    createRoute({ getParentRoute: () => root, path: '/occasions/new', component: () => <p>new occasion</p> }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { router, queryClient, ...view }
}

const cell = (key: string) => document.querySelector<HTMLButtonElement>(`.cal-month:not([inert]) [data-day="${key}"]`)
const chipsOf = (key: string) => Array.from(cell(key)?.querySelectorAll<HTMLElement>('.cal-chip') ?? [])
const chipText = (key: string) => chipsOf(key).map((chip) => chip.textContent)
const filter = () => screen.getByRole('group', { name: 'Wessen Anlässe?' })
const pill = (name: string | RegExp) => within(filter()).getByRole('button', { name })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 9, 0)) // Tue 20 Oct 2026
  resetCalendarSession()
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('month view: the grid', () => {
  it('shows this month Monday-first, a cell per day with data-day, today marked, weekends set apart', async () => {
    renderMonth()
    expect(await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })).toBeTruthy()
    const heads = document.querySelector('.cal-weekdays')!
    expect(Array.from(heads.children).map((el) => el.textContent)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])
    const month = document.querySelector('.cal-month:not([inert])')!
    const days = Array.from(month.querySelectorAll<HTMLElement>('[data-day]')).map((el) => el.dataset.day)
    expect(days).toHaveLength(42)
    expect(days[0]).toBe('2026-09-28')
    expect(cell('2026-10-20')?.getAttribute('aria-current')).toBe('date')
    expect(cell('2026-10-20')?.getAttribute('aria-label')).toBe('Dienstag, 20. Oktober, heute')
    expect(cell('2026-10-24')?.hasAttribute('data-weekend')).toBe(true)
    expect(cell('2026-10-23')?.hasAttribute('data-weekend')).toBe(false)
    // the neighbour months beside it are only there for the swipe: hidden and not focusable
    expect(document.querySelectorAll('.cal-month[inert]')).toHaveLength(2)
  })

  it('a day reads from afar: chips in the colour of whose it is (you = the accent), a glyph for the kind and a word', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    const day = cell('2026-10-23')!
    expect(day.getAttribute('aria-label')).toBe('Freitag, 23. Oktober, 2 Anlässe')
    const [annas, mine] = chipsOf('2026-10-23') as [HTMLElement, HTMLElement]
    // the colour says WHO, the word says WHAT (a birthday says whose)
    expect(annas.textContent).toBe('Einweihung')
    expect(annas.dataset.personTone).toMatch(/^[1-8]$/)
    expect(annas.dataset.kind).toBe('other')
    expect(mine.textContent).toBe('Spieleabend')
    expect(mine.dataset.personTone).toBe('me')
    const birthday = chipsOf('2026-10-27')[0]!
    expect(birthday.dataset.kind).toBe('birthday')
    expect(birthday.textContent).toBe('Bens')
    // chips are decoration: the cell's own label names the day
    expect(day.querySelector('.cal-chips')?.getAttribute('aria-hidden')).toBe('true')
    expect(chipsOf('2026-10-24')).toHaveLength(0)
  })

  it('a person keeps one colour on every day, and two friends never share one', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    const anna1 = chipsOf('2026-10-23')[0]!.dataset.personTone
    const anna2 = chipsOf('2026-10-29')[0]!.dataset.personTone
    const ben = chipsOf('2026-10-27')[0]!.dataset.personTone
    expect(anna2).toBe(anna1)
    expect(ben).not.toBe(anna1)
    expect(ben).not.toBe('me')
  })

  it('more than two on a day: the first chip and "+N" with a dot per hidden person', async () => {
    const busy: FeedScreen = {
      upcoming: [
        row(ids.a, 'Annas Einweihung', at(10, 23, 9), 'Anna Beispiel'),
        row(ids.b, 'Spieleabend', at(10, 23, 12)),
        row(ids.e, 'Bens Geburtstag', at(10, 23, 15), 'Ben Mustermann'),
        row(ids.g, 'Claras Kochabend', at(10, 23, 19), 'Clara Test'),
      ],
      past: [],
    }
    renderMonth('/soon?view=month', busy)
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    expect(chipText('2026-10-23')).toEqual(['Einweihung'])
    const more = cell('2026-10-23')!.querySelector('.cal-more')!
    expect(more.textContent).toBe('+3')
    expect(Array.from(more.querySelectorAll<HTMLElement>('.cal-more-dot')).map((dot) => dot.dataset.personTone)).toHaveLength(3)
    expect(cell('2026-10-23')!.getAttribute('aria-label')).toBe('Freitag, 23. Oktober, 4 Anlässe')
    // the day's list tells them all
    fireEvent.click(cell('2026-10-23')!)
    const day = await screen.findByRole('region', { name: 'Freitag, 23. Oktober' })
    await waitFor(() => expect(within(day).getAllByRole('link')).toHaveLength(4))
  })

  it('without a chosen day it lists the month; a tap on a day lists its occasions; the same day again shows the month', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    const agenda = screen.getByRole('region', { name: 'Im Oktober 2026' })
    expect(within(agenda).getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Annas Einweihung'),
      expect.stringContaining('Spieleabend'),
      expect.stringContaining('Bens Geburtstag'),
      expect.stringContaining('Annas Brunch'),
    ])
    expect(within(agenda).getByText('Du lädst ein')).toBeTruthy()
    // only the name truncates in a narrow row, the verb stays
    expect(within(agenda).getAllByText('Anna Beispiel').map((name) => [name.className.includes('truncate'), name.parentElement?.textContent]))
      .toEqual([[true, 'Anna Beispiel lädt ein'], [true, 'Anna Beispiel lädt ein']])
    fireEvent.click(cell('2026-10-23')!)
    expect(cell('2026-10-23')!.getAttribute('aria-pressed')).toBe('true')
    const day = await screen.findByRole('region', { name: 'Freitag, 23. Oktober' })
    // the month's list fades out while the day's fades in
    await waitFor(() => expect(within(day).getAllByRole('link')).toHaveLength(2))
    fireEvent.click(cell('2026-10-24')!)
    expect(await screen.findByText('An diesem Tag ist nichts geplant.')).toBeTruthy()
    fireEvent.click(cell('2026-10-24')!)
    expect(await screen.findByRole('region', { name: 'Im Oktober 2026' })).toBeTruthy()
  })

  it('an empty day ahead offers "Anlass erstellen"; a day or a month that is over offers nothing to create', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    fireEvent.click(cell('2026-10-24')!)
    expect(await screen.findByText('An diesem Tag ist nichts geplant.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Anlass erstellen' }).getAttribute('href')).toBe('/occasions/new')
    fireEvent.click(cell('2026-10-14')!)
    expect(await screen.findByText('Dieser Tag ist schon vorbei.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Anlass erstellen' })).toBeNull())
    fireEvent.click(cell('2026-10-14')!)
    fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'September 2026' })).toBeTruthy()
    expect(await screen.findByText('Dieser Monat ist schon vorbei.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Anlass erstellen' })).toBeNull())
  })

  it('chevrons change the month; "Heute" (in Start’s top bar) shows once the view left today and brings it back', async () => {
    const reports: (TodayControl | null)[] = []
    renderMonth('/soon?view=month', FEED, (control) => reports.push(control))
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    // on today's month (no day chosen) there is nothing to come back to
    await waitFor(() => expect(reports.at(-1)?.visible).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Im November 2026' })).getByText(/Picknick im Park/)).toBeTruthy()
    await waitFor(() => expect(reports.at(-1)?.visible).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }))
    // a month without data simply has no chips
    expect(await screen.findByRole('heading', { level: 2, name: 'Januar 2027' })).toBeTruthy()
    expect(document.querySelectorAll('.cal-month:not([inert]) .cal-chip')).toHaveLength(0)
    expect(screen.getByText('In diesem Monat ist noch nichts geplant.')).toBeTruthy()
    act(() => reports.at(-1)?.go())
    expect(await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })).toBeTruthy()
    await waitFor(() => expect(reports.at(-1)?.visible).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'September 2026' })).toBeTruthy()
  })

  it('a greyed day of the next month switches to that month with the day chosen', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    fireEvent.click(cell('2026-11-01')!)
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Sonntag, 1. November' })).toBeTruthy()
  })

  it('a tap on an occasion opens its page', async () => {
    const { router } = renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    fireEvent.click(screen.getByRole('link', { name: /Spieleabend/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/occasions/${ids.b}`))
  })

  it('shows a calm error with a retry instead of an empty grid', async () => {
    api.getFeed.mockRejectedValueOnce(new AppError('network'))
    renderMonth('/soon?view=month', null)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Der Kalender konnte nicht geladen werden.')
    api.getFeed.mockResolvedValueOnce(FEED)
    fireEvent.click(within(alert).getByRole('button', { name: 'Nochmal versuchen' }))
    expect(await screen.findByRole('region', { name: 'Im Oktober 2026' })).toBeTruthy()
  })
})

describe('month view: the people filter', () => {
  it('"Alle · Du · Anna · Ben": the pills are the colour legend; a tap on a person shows only theirs', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    const pills = within(filter()).getAllByRole('button')
    expect(pills.map((button) => button.textContent)).toEqual(['Alle', 'Du', 'ABAnna', 'BMBen'])
    expect(pill('Alle').getAttribute('aria-pressed')).toBe('true')
    // the legend: Anna's pill avatar wears the colour of her chips
    const annaTone = chipsOf('2026-10-23')[0]!.dataset.personTone
    expect(pill(/Anna/).querySelector<HTMLElement>('[data-person-tone]')?.dataset.personTone).toBe(annaTone)

    fireEvent.click(pill(/Anna/))
    expect(pill(/Anna/).getAttribute('aria-pressed')).toBe('true')
    expect(pill('Alle').getAttribute('aria-pressed')).toBe('false')
    expect(chipText('2026-10-23')).toEqual(['Einweihung'])
    expect(chipsOf('2026-10-27')).toHaveLength(0)
    expect(cell('2026-10-23')!.getAttribute('aria-label')).toBe('Freitag, 23. Oktober, 1 Anlass')
    const agenda = screen.getByRole('region', { name: 'Im Oktober 2026' })
    await waitFor(() => expect(within(agenda).getAllByRole('link')).toHaveLength(2))
    // a second person joins
    fireEvent.click(pill('Du'))
    expect(chipText('2026-10-23')).toEqual(['Einweihung', 'Spieleabend'])
    // remembered for this page session (coming back from an occasion)
    expect([...(lastCalendarFilter() ?? [])].sort()).toEqual(['me', 'name:anna beispiel'])
    fireEvent.click(pill('Alle'))
    expect(pill('Alle').getAttribute('aria-pressed')).toBe('true')
    expect(chipsOf('2026-10-27')).toHaveLength(1)
  })

  it('a month with nothing for the chosen people says so and offers "Alle zeigen"', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    fireEvent.click(pill(/Ben/))
    fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }))
    expect(await screen.findByText('Für deine Auswahl ist in diesem Monat nichts geplant.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Alle zeigen' }))
    expect(await screen.findByRole('link', { name: /Picknick im Park/ })).toBeTruthy()
    expect(pill('Alle').getAttribute('aria-pressed')).toBe('true')
  })

  it('the legend effect: a person under the mouse lets everyone else’s chips step back', async () => {
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    fireEvent.pointerEnter(pill(/Anna/), { pointerType: 'mouse' })
    const [annas, mine] = chipsOf('2026-10-23') as [HTMLElement, HTMLElement]
    expect(annas.hasAttribute('data-dim')).toBe(false)
    expect(mine.hasAttribute('data-dim')).toBe(true)
    fireEvent.pointerLeave(pill(/Anna/), { pointerType: 'mouse' })
    expect(chipsOf('2026-10-23').some((chip) => chip.hasAttribute('data-dim'))).toBe(false)
  })

  it('a filter remembered from before still applies when the view comes back', async () => {
    rememberCalendarFilter(new Set(['name:ben mustermann']))
    renderMonth()
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    expect(pill(/Ben/).getAttribute('aria-pressed')).toBe('true')
    expect(chipsOf('2026-10-23')).toHaveLength(0)
    expect(chipText('2026-10-27')).toEqual(['Bens'])
  })

  it('with only you there is nobody to tell apart: no filter row', async () => {
    renderMonth('/soon?view=month', { upcoming: [row(ids.b, 'Spieleabend', at(10, 23, 20))], past: [] })
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    expect(screen.queryByRole('group', { name: 'Wessen Anlässe?' })).toBeNull()
  })
})

describe('month view: the landing target of a new occasion (K10)', () => {
  it('?created opens that occasion’s month and day; its chip waits until the bunny dropped it', async () => {
    const { router } = renderMonth(`/soon?view=month&created=${ids.d}`)
    expect(await screen.findByRole('heading', { level: 2, name: 'Dezember 2026' })).toBeTruthy()
    const target = document.querySelector<HTMLElement>('[data-landing]')
    expect(target?.dataset.day).toBe('2026-12-12')
    const chip = target!.querySelector<HTMLElement>('[data-landing-chip]')!
    expect(chip.dataset.personTone).toBe('me')
    expect(chip.hasAttribute('data-landed')).toBe(false)
    // not in the day's list yet either (and no "nothing planned" in its place)
    expect(screen.queryByRole('link', { name: /Weihnachtsmarkt/ })).toBeNull()
    expect(screen.queryByText('An diesem Tag ist nichts geplant.')).toBeNull()
    act(() => dispatchLanded(ids.d))
    expect(chip.hasAttribute('data-landed')).toBe(true)
    expect(await screen.findByRole('link', { name: /^Weihnachtsmarkt/ })).toBeTruthy()
    // done once: the param is dropped (the month view stays), a later visit does not replay the landing
    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'month' }))
  })

  it('a filter that would hide the new occasion is lifted for the landing', async () => {
    rememberCalendarFilter(new Set(['name:anna beispiel']))
    renderMonth(`/soon?view=month&created=${ids.c}`)
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
    expect(pill('Alle').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-landing] [data-landing-chip]')).not.toBeNull()
  })

  it('full motion: the bunny carries your card from the "+" onto the day cell; then the invite pill appears', async () => {
    let land: () => void = () => {}
    carry.play.mockImplementation(() => new Promise<void>((resolve) => (land = resolve)))
    renderMonth(`/soon?view=month&created=${ids.c}`)
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
    const target = document.querySelector<HTMLElement>('[data-landing]')!
    const chip = target.querySelector<HTMLElement>('[data-landing-chip]')!
    await waitFor(() => expect(carry.play).toHaveBeenCalledTimes(1))
    const [request] = carry.play.mock.calls[0] as [{ to: Element; item: string; tint: string; from: DOMRect }]
    expect(request.to).toBe(target)
    expect(request.item).toBe('card')
    // the card is yours: it flies in your colour (the accent) and becomes your chip
    expect(request.tint).toBe(CARRY_TINT)
    // the card is in flight: the chip, the row and the pill wait
    expect(chip.hasAttribute('data-landed')).toBe(false)
    expect(screen.queryByRole('link', { name: /Freunde zu/ })).toBeNull()
    await act(async () => land())
    expect(chip.hasAttribute('data-landed')).toBe(true)
    expect(await screen.findByRole('link', { name: /^Picknick im Park/ })).toBeTruthy()
    const invite = await screen.findByRole('link', { name: 'Freunde zu „Picknick im Park“ einladen' })
    // a clean address (no "#…"): the invite card's focus travels in memory (occasions/inviteFocus.ts)
    expect(invite.getAttribute('href')).toBe(`/occasions/${ids.c}`)
    expect(invite.textContent).toContain('Freunde einladen')
    expect(screen.getByRole('status').textContent).toContain('„Picknick im Park“ steht jetzt in deinem Kalender.')
    expect(screen.getByRole('link', { name: 'Wünsche eintragen' }).getAttribute('href')).toBe(`/occasions/${ids.c}/wishes/new`)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')))
    fireEvent.click(invite)
    expect(peekInviteFocus(ids.c)).toBe(true)
    expect(await screen.findByText(`occasion ${ids.c}`)).toBeTruthy()
    clearInviteFocus(ids.c)
  })

  it('reduced motion: no bunny, no flight — the chip and the row simply fade in', async () => {
    setMotionPrefs({ level: 'reduced' })
    try {
      renderMonth(`/soon?view=month&created=${ids.c}`)
      expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
      const chip = document.querySelector<HTMLElement>('[data-landing] [data-landing-chip]')!
      await waitFor(() => expect(chip.hasAttribute('data-landed')).toBe(true), { timeout: 2000 })
      expect(carry.play).not.toHaveBeenCalled()
      expect(await screen.findByRole('link', { name: 'Freunde zu „Picknick im Park“ einladen' })).toBeTruthy()
    } finally {
      resetMotionLevelForTests()
      window.localStorage.clear()
    }
  })

  it('wishes already added in the form (or a bring-along-only occasion): no "Wünsche eintragen", only the invite', async () => {
    setMotionPrefs({ level: 'off' })
    try {
      for (const changes of [{ wish_count: 2 }, { wish_count: 0, sections: 'bring' as const }]) {
        const feed: FeedScreen = { ...FEED, upcoming: FEED.upcoming.map((item) => (item.id === ids.c ? { ...item, ...changes } : item)) }
        const view = renderMonth(`/soon?view=month&created=${ids.c}`, feed)
        expect(await screen.findByRole('link', { name: 'Freunde zu „Picknick im Park“ einladen' })).toBeTruthy()
        expect(screen.queryByRole('link', { name: 'Wünsche eintragen' })).toBeNull()
        expect(screen.getByRole('status').textContent).not.toContain('Jetzt die Wünsche')
        view.unmount()
      }
    } finally {
      resetMotionLevelForTests()
      window.localStorage.clear()
    }
  })

  it('motion off: the chip is there at once, without a carry', async () => {
    setMotionPrefs({ level: 'off' })
    try {
      renderMonth(`/soon?view=month&created=${ids.c}`)
      expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
      const chip = document.querySelector<HTMLElement>('[data-landing] [data-landing-chip]')!
      await waitFor(() => expect(chip.hasAttribute('data-landed')).toBe(true))
      expect(carry.play).not.toHaveBeenCalled()
    } finally {
      resetMotionLevelForTests()
      window.localStorage.clear()
    }
  })

  it('a carry that never reports back still ends with the chip on its day (safety net)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0))
    carry.play.mockReturnValue(new Promise(() => {}))
    renderMonth(`/soon?view=month&created=${ids.c}`)
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
    const chip = document.querySelector<HTMLElement>('[data-landing] [data-landing-chip]')!
    await waitFor(() => expect(carry.play).toHaveBeenCalledTimes(1))
    expect(chip.hasAttribute('data-landed')).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(CARRY_SAFETY_MS)
    })
    await waitFor(() => expect(chip.hasAttribute('data-landed')).toBe(true))
  })

  it('on a full day the landing occasion always gets a chip of its own', async () => {
    const full: FeedScreen = {
      upcoming: [
        row(ids.a, 'Annas Einweihung', at(11, 1, 9), 'Anna Beispiel'),
        row(ids.e, 'Bens Geburtstag', at(11, 1, 10), 'Ben Mustermann'),
        row(ids.h, 'Claras Kochabend', at(11, 1, 11), 'Clara Test'),
        row(ids.c, 'Picknick im Park', at(11, 1, 12)),
      ],
      past: [],
    }
    renderMonth(`/soon?view=month&created=${ids.c}`, full)
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeTruthy()
    const target = document.querySelector<HTMLElement>('[data-landing]')!
    expect(target.querySelector('[data-landing-chip]')?.textContent).toBe('Picknick')
    expect(target.querySelector('.cal-more')?.textContent).toBe('+3')
  })

  it('the Start route keeps only a month view and an occasion id', () => {
    expect(validateSearch({ view: 'month', created: 'nicht-gueltig' })).toEqual({ view: 'month' })
    expect(validateSearch({ view: 'month', created: ids.a })).toEqual({ view: 'month', created: ids.a })
    expect(validateSearch({ view: 'woche', created: 42 })).toEqual({})
    expect(validateSearch({})).toEqual({})
  })
})

describe('month view: the end time (Felix 26.10, migration 20261026180000)', () => {
  it('the agenda row shows the end: "20:00–23:00" on the same day, "18:00 bis 02:00 (nächster Tag)" after midnight', async () => {
    const feed: FeedScreen = {
      upcoming: [
        { ...row(ids.a, 'Annas Einweihung', at(10, 23, 18), 'Anna Beispiel'), ends_at: at(10, 24, 2) },
        { ...row(ids.b, 'Spieleabend', at(10, 23, 20)), ends_at: at(10, 23, 23) },
        // a feed persisted before the migration has no key: only the start
        row(ids.e, 'Bens Geburtstag', at(10, 27, 19), 'Ben Mustermann'),
      ],
      past: [],
    }
    renderMonth('/soon?view=month', feed)
    await screen.findByRole('heading', { level: 2, name: 'Oktober 2026' })
    const agenda = screen.getByRole('region', { name: 'Im Oktober 2026' })
    expect(within(agenda).getByText('18:00 bis 02:00 (nächster Tag)')).toBeTruthy()
    expect(within(agenda).getByText('20:00–23:00 · Café am Markt')).toBeTruthy()
    expect(within(agenda).getByText('19:00')).toBeTruthy()
  })
})
