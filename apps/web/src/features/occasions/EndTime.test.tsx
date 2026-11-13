import type { ReactNode } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen } from '../../lib/api/types'
import { qk } from '../../lib/queryKeys'
import { browserTimeZone, zonedWallTimeToIso } from '../../lib/time'
import { HOST_ID, hostScreen, makeQueryClient, OCCASION_ID, renderWithClient } from './test-utils'

// The end time in the occasion form and on the occasion screen (Felix 26.10, migration 20261026180000):
// the optional "Ende" row under "Uhrzeit" (TimeField + TimeWheel), the next-day rule, "Ohne Ende", the error for an
// end equal to the start — and a screen from a server without ends_at: no row, and the save leaves the end alone.

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn() }))
const api = vi.hoisted(() => ({
  getOccasionScreen: vi.fn(),
  getFeed: vi.fn(),
  updateOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  createOccasion: vi.fn(),
  leaveOccasion: vi.fn(),
  removeMember: vi.fn(),
  setRsvp: vi.fn(),
  newOccasionId: vi.fn(),
}))
const places = vi.hoisted(() => ({ search: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('@tanstack/react-router', () => {
  const mocked = {
    useRouter: () => ({ navigate: nav.navigate, history: { back: nav.back }, state: { location: { pathname: `/occasions/${OCCASION_ID}/edit` } } }),
    useCanGoBack: () => true,
    Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
  }
  return { ...mocked, createLink: () => mocked.Link }
})
vi.mock('../../lib/api/occasions', () => api)
vi.mock('../../lib/api/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/places')>()),
  searchPlaces: places.search,
}))
vi.mock('../../lib/toast', () => ({ toast: toasts }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))

import { EditOccasionPage } from './EditOccasionPage'
import { OccasionHero } from './OccasionHero'
import { resetSavingForTests } from './saving'

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  api.getFeed.mockReturnValue(new Promise(() => {}))
  api.updateOccasion.mockResolvedValue(undefined)
  places.search.mockResolvedValue([])
  nav.navigate.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

/** hostScreen starts at 16:00Z = 18:00 in Berlin (summer); `endsAt` undefined = a server without the key. */
function withEnd(endsAt: string | null | undefined): OccasionScreen {
  const base = hostScreen()
  return { ...base, occasion: { ...base.occasion, ...(endsAt !== undefined ? { ends_at: endsAt } : {}) } }
}

function renderEdit(data: OccasionScreen) {
  const client = makeQueryClient()
  client.setQueryData(qk.occasion(OCCASION_ID), data)
  return renderWithClient(<EditOccasionPage occasionId={OCCASION_ID} userId={HOST_ID} />, client)
}

const endRow = () => screen.getByRole('button', { name: /^Ende/ })
const save = () => fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
const typeHour = (digits: string) => {
  const hour = screen.getByRole('spinbutton', { name: 'Stunde' })
  for (const key of digits) fireEvent.keyDown(hour, { key })
}
const sent = () => api.updateOccasion.mock.calls[0]?.[1] as Record<string, unknown>

describe('the "Ende" row of the occasion form', () => {
  it('shows the stored end and sends it back unchanged', async () => {
    renderEdit(withEnd('2030-06-15T20:00:00.000Z'))
    expect(within(endRow()).getByText('22:00')).toBeTruthy()
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(sent()).toMatchObject({ starts_at: '2030-06-15T16:00:00.000Z', ends_at: '2030-06-15T20:00:00.000Z', all_day: false })
  })

  it('empty, it says "Optional"; the first tap suggests three hours after the start', async () => {
    renderEdit(withEnd(null))
    expect(within(endRow()).getByText('Optional')).toBeTruthy()
    fireEvent.click(endRow())
    expect(endRow().getAttribute('aria-expanded')).toBe('true')
    expect(within(endRow()).getByText('21:00')).toBeTruthy()
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(sent().ends_at).toBe('2030-06-15T19:00:00.000Z')
  })

  it('an end earlier than the start lies on the next day — the row says so', async () => {
    renderEdit(withEnd('2030-06-15T20:00:00.000Z'))
    fireEvent.click(endRow())
    typeHour('02')
    expect(within(endRow()).getByText('02:00')).toBeTruthy()
    expect(within(endRow()).getByText('am nächsten Tag')).toBeTruthy()
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    // 02:00 Berlin summer time on 16 June = 00:00 UTC
    expect(sent().ends_at).toBe('2030-06-16T00:00:00.000Z')
  })

  it('refuses an end equal to the start, with the message under the group and the wheel open', async () => {
    renderEdit(withEnd('2030-06-15T20:00:00.000Z'))
    fireEvent.click(endRow())
    typeHour('18')
    save()
    expect(await screen.findByText('Ende und Beginn sind gleich – wähle eine andere Endzeit')).toBeTruthy()
    expect(endRow().getAttribute('data-invalid')).toBe('true')
    expect(endRow().getAttribute('aria-expanded')).toBe('true')
    expect(api.updateOccasion).not.toHaveBeenCalled()
  })

  it('"Ohne Ende" takes the end away (ends_at null)', async () => {
    renderEdit(withEnd('2030-06-15T20:00:00.000Z'))
    fireEvent.click(endRow())
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Ende' }))
    expect(within(endRow()).getByText('Optional')).toBeTruthy()
    expect(endRow().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(endRow())
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(sent().ends_at).toBeNull()
  })

  it('all-day hides the row and sends no end', async () => {
    renderEdit(withEnd('2030-06-15T20:00:00.000Z'))
    fireEvent.click(screen.getByRole('switch', { name: 'Ganztägig' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Ende/ })).toBeNull())
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(sent()).toMatchObject({ all_day: true, ends_at: null })
  })

  it('a server without ends_at: no row, and the save leaves the stored end alone', async () => {
    renderEdit(withEnd(undefined))
    expect(screen.queryByRole('button', { name: /^Ende/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Uhrzeit/ })).toBeTruthy()
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect('ends_at' in sent()).toBe(false)
  })
})

describe('the end on the occasion screen', () => {
  const zone = browserTimeZone()
  function heroOf(endsAt: string | null | undefined, allDay = false) {
    const base = hostScreen()
    const occasion = {
      ...base.occasion,
      tz: zone,
      all_day: allDay,
      starts_at: zonedWallTimeToIso('2030-06-15', allDay ? null : '19:00', zone),
      ...(endsAt !== undefined ? { ends_at: endsAt } : {}),
    }
    return renderWithClient(<OccasionHero screen={{ ...base, occasion }} userId={HOST_ID} />)
  }

  it('"19:00–23:00" on the same day', () => {
    heroOf(zonedWallTimeToIso('2030-06-15', '23:00', zone))
    expect(screen.getByText('19:00–23:00')).toBeTruthy()
    expect(screen.queryByText(/am nächsten Tag/)).toBeNull()
  })

  it('"19:00–02:00" and "bis 02:00 am nächsten Tag" when it ends the next day', () => {
    heroOf(zonedWallTimeToIso('2030-06-16', '02:00', zone))
    expect(screen.getByText('19:00–02:00')).toBeTruthy()
    expect(screen.getByText('bis 02:00 am nächsten Tag')).toBeTruthy()
  })

  it('only the start without an end, from an older server, and "Ganztägig" for an all-day occasion', () => {
    for (const [endsAt, allDay, line] of [[null, false, '19:00'], [undefined, false, '19:00'], [null, true, 'Ganztägig']] as const) {
      const { unmount } = heroOf(endsAt, allDay)
      expect(screen.getByText(line)).toBeTruthy()
      expect(screen.queryByText(/–/)).toBeNull()
      unmount()
    }
  })
})
