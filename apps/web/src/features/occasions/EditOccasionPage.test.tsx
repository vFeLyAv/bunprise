import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { deferred, GUEST_ID, guestScreen, HOST_ID, hostScreen, makeQueryClient, OCCASION_ID, renderWithClient } from './test-utils'

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
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
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
import { getSaveState, peekDraft, resetSavingForTests } from './saving'

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  api.getFeed.mockReturnValue(new Promise(() => {}))
  places.search.mockResolvedValue([])
  nav.navigate.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

function renderEdit(data: OccasionScreen, userId = HOST_ID) {
  const client = makeQueryClient()
  client.setQueryData(qk.occasion(OCCASION_ID), data)
  return renderWithClient(<EditOccasionPage occasionId={OCCASION_ID} userId={userId} />, client)
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
const BASE_UPDATE = {
  title: 'Milas Gartenfest',
  starts_at: '2030-06-15T16:00:00.000Z',
  tz: 'Europe/Berlin',
  all_day: false,
  place_text: 'Café am Markt',
  description: 'Bring gute Laune mit.',
}

describe('edit occasion (S6)', () => {
  it("is prefilled from the occasion screen, in the occasion's own time zone", () => {
    renderEdit(hostScreen())
    expect(screen.getByRole('heading', { level: 1, name: 'Anlass bearbeiten' })).toBeTruthy()
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Milas Gartenfest')
    expect(within(screen.getByRole('button', { name: /^Datum/ })).getByText('Sa., 15. Juni 2030')).toBeTruthy()
    // 16:00 UTC = 18:00 Berlin (summer)
    expect(within(screen.getByRole('button', { name: /^Uhrzeit/ })).getByText('18:00')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Ganztägig' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: /^Ort Café am Markt/ })).toBeTruthy()
    expect((screen.getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toBe('Bring gute Laune mit.')
  })

  it('is not available to guests (the same page as "not found")', () => {
    renderEdit(guestScreen(), GUEST_ID)
    expect(screen.getByRole('heading', { name: 'Anlass nicht gefunden oder kein Zugriff' })).toBeTruthy()
    expect(screen.queryByLabelText('Titel')).toBeNull()
  })

  it('saves optimistically: the occasion shows the change at once, the update follows', async () => {
    const write = deferred()
    api.updateOccasion.mockReturnValue(write.promise)
    const { client } = renderEdit(hostScreen())
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Milas großes Gartenfest' } })
    save()

    await waitFor(() => expect(nav.back).toHaveBeenCalledTimes(1))
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.title).toBe('Milas großes Gartenfest')
    // untouched date, time and place: exactly the stored values go back
    expect(api.updateOccasion).toHaveBeenCalledWith(OCCASION_ID, { ...BASE_UPDATE, title: 'Milas großes Gartenfest' }, HOST_ID)
    expect(getSaveState(OCCASION_ID)).toBe('saving')
    await act(async () => write.resolve())
    await waitFor(() => expect(getSaveState(OCCASION_ID)).toBeUndefined())
    expect(toasts.error).not.toHaveBeenCalled()
  })

  it('moves the time on the wheel in the occasion\'s zone, and the day on the calendar', async () => {
    api.updateOccasion.mockResolvedValue(undefined)
    renderEdit(hostScreen())
    fireEvent.click(screen.getByRole('button', { name: /^Uhrzeit/ }))
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Stunde' }), { key: 'ArrowUp' })
    fireEvent.click(screen.getByRole('button', { name: /^Datum/ }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'Sonntag, 16. Juni 2030' }))
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    // 19:00 Berlin summer time = 17:00 UTC, one day later
    expect(api.updateOccasion).toHaveBeenCalledWith(OCCASION_ID, { ...BASE_UPDATE, starts_at: '2030-06-16T17:00:00.000Z' }, HOST_ID)
  })

  it('runaway date: a really moved day opens the month view, where the bunny carries it onto the new day', async () => {
    api.updateOccasion.mockReturnValue(new Promise(() => {}))
    const { client } = renderEdit(hostScreen())
    const before = hostScreen().occasion
    client.setQueryData(qk.feed(), {
      upcoming: [{ id: OCCASION_ID, title: before.title, starts_at: before.starts_at, tz: before.tz, all_day: false, place_text: null, role: 'host', rsvp: 'going', host_name: 'Mila', member_count: 1, wish_count: 0, my_reservation_count: null }],
      past: [],
    })
    fireEvent.click(screen.getByRole('button', { name: /^Datum/ }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'Sonntag, 16. Juni 2030' }))
    save()
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', search: { view: 'month', created: OCCASION_ID }, replace: true }))
    expect(nav.back).not.toHaveBeenCalled()
    // the month view reads the feed: the occasion is on its new day before the server answered
    const feed = client.getQueryData<{ upcoming: { starts_at: string }[] }>(qk.feed())
    expect(feed?.upcoming[0]?.starts_at).toBe('2030-06-16T16:00:00.000Z')
  })

  it('a new time on the same day (or all-day) is no move: back to the occasion', async () => {
    api.updateOccasion.mockResolvedValue(undefined)
    renderEdit(hostScreen())
    fireEvent.click(screen.getByRole('switch', { name: 'Ganztägig' }))
    save()
    await waitFor(() => expect(nav.back).toHaveBeenCalledTimes(1))
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it('"Abbrechen" goes back at once when nothing changed, and asks "Änderungen verwerfen?" after an edit', () => {
    renderEdit(hostScreen())
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(nav.back).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Änderungen verwerfen?' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Beschreibung'), { target: { value: 'Mit Kuchen!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    const dialog = screen.getByRole('dialog', { name: 'Änderungen verwerfen?' })
    expect(nav.back).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Weiter bearbeiten' }).at(-1)!)
    expect(nav.back).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toBe('Mit Kuchen!')

    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Änderungen verwerfen?' })).getByRole('button', { name: 'Verwerfen' }))
    expect(nav.back).toHaveBeenCalledTimes(2)
    expect(api.updateOccasion).not.toHaveBeenCalled()
  })

  it('switching to all-day stores midnight of the occasion\'s zone, a removed place becomes null', async () => {
    api.updateOccasion.mockResolvedValue(undefined)
    renderEdit(hostScreen())
    fireEvent.click(screen.getByRole('switch', { name: 'Ganztägig' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ort entfernen' }))
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(api.updateOccasion).toHaveBeenCalledWith(
      OCCASION_ID,
      { ...BASE_UPDATE, starts_at: '2030-06-14T22:00:00.000Z', all_day: true, place_text: null },
      HOST_ID,
    )
  })

  it('rolls back and keeps the input when the update fails', async () => {
    api.updateOccasion.mockRejectedValue(new AppError('generic'))
    const { client } = renderEdit(hostScreen())
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Neuer Titel' } })
    save()
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Hat nicht geklappt – versuch es nochmal', expect.objectContaining({ actionLabel: 'Bearbeiten' })))
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.title).toBe('Milas Gartenfest')
    expect(peekDraft(HOST_ID, OCCASION_ID)?.values.title).toBe('Neuer Titel')
    expect(getSaveState(OCCASION_ID)).toBeUndefined()
  })

  it('keeps an occasion that already happened editable without moving its date', async () => {
    api.updateOccasion.mockResolvedValue(undefined)
    const past = hostScreen()
    renderEdit({ ...past, occasion: { ...past.occasion, starts_at: '2020-05-01T16:00:00.000Z' } })
    fireEvent.change(screen.getByLabelText('Beschreibung'), { target: { value: 'Danke fürs Kommen!' } })
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Das Datum liegt in der Vergangenheit')).toBeNull()
    expect(api.updateOccasion.mock.calls[0]?.[1]).toMatchObject({ starts_at: '2020-05-01T16:00:00.000Z' })
  })

  it('deletes only after the confirmation, then goes to the feed', async () => {
    const removal = deferred()
    api.deleteOccasion.mockReturnValue(removal.promise)
    renderEdit(hostScreen())
    fireEvent.click(screen.getByRole('button', { name: 'Anlass löschen' }))
    const dialog = screen.getByRole('dialog', { name: 'Anlass löschen?' })
    expect(within(dialog).getByText('„Milas Gartenfest“ wird mit allen Wünschen gelöscht. Das lässt sich nicht rückgängig machen.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }))
    expect(api.deleteOccasion).toHaveBeenCalledWith(OCCASION_ID, HOST_ID)
    expect(nav.navigate).not.toHaveBeenCalled() // waits for the server
    await act(async () => removal.resolve())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }))
    expect(toasts.success).toHaveBeenCalledWith('Anlass gelöscht')
  })
})
