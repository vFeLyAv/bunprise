import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen, Me, OccasionInput, OccasionScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { browserTimeZone, dayKey, zonedWallTimeToIso } from '../../lib/time'
import { deferred, HOST_ID, renderWithClient } from './test-utils'

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn(), pathname: '/occasions/new', search: {} as Record<string, unknown> }))
const api = vi.hoisted(() => ({
  createOccasion: vi.fn(),
  newOccasionId: vi.fn(),
  updateOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  leaveOccasion: vi.fn(),
  removeMember: vi.fn(),
  setRsvp: vi.fn(),
  getOccasionScreen: vi.fn(),
  getFeed: vi.fn(),
}))
const places = vi.hoisted(() => ({ search: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: nav.navigate,
    history: { back: nav.back },
    state: {
      location: {
        get pathname() {
          return nav.pathname
        },
        get search() {
          return nav.search
        },
      },
    },
  }),
  useCanGoBack: () => false,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}))
vi.mock('../../lib/api/occasions', () => api)
vi.mock('../../lib/api/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/places')>()),
  searchPlaces: places.search,
}))
vi.mock('../../lib/toast', () => ({ toast: toasts }))
// the bunny's moment is a lazy stage of its own (features/mascot-ui), not part of these checks
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))

import { addDays } from './form/calendar'
import { toOccasionInput } from './form'
import { NewOccasionPage } from './NewOccasionPage'
import { getSaveState, keepDraft, peekDraft, resetSavingForTests } from './saving'

const NEW_ID = '77777777-7777-4777-8777-777777777777'
const ME: Me = {
  profile: { id: HOST_ID, display_name: 'Mila', locale: 'de', onboarding_done_at: null },
  consents_ok: true,
  legal_versions: { terms: 'terms-1', privacy: 'privacy-1', age: 'age-1' },
}
const TZ = browserTimeZone()
const today = () => dayKey(new Date(), TZ)

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  nav.pathname = '/occasions/new'
  nav.search = {}
  nav.navigate.mockImplementation(async ({ to, params, search }: { to: string; params?: { occasionId: string }; search?: Record<string, unknown> }) => {
    nav.pathname = params ? to.replace('$occasionId', params.occasionId) : to
    nav.search = search ?? {}
  })
  api.newOccasionId.mockReturnValue(NEW_ID)
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  places.search.mockResolvedValue([])
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

const saveButton = () => screen.getByRole('button', { name: /Speichern/ }) as HTMLButtonElement
const dateRow = () => screen.getByRole('button', { name: /^Datum/ })

function setTitle(value: string) {
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value } })
}

/** Tomorrow by the quick chip (the calendar unfolds first). */
function chooseTomorrow() {
  fireEvent.click(dateRow())
  fireEvent.click(screen.getByRole('button', { name: 'Morgen' }))
}

/** The free text of the place sheet ("„…“ übernehmen" with Enter). */
async function choosePlace(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Ort hinzufügen' }))
  const search = await screen.findByRole('combobox', { name: 'Ort suchen' })
  fireEvent.change(search, { target: { value: text } })
  fireEvent.keyDown(search, { key: 'Enter' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

async function fillValidForm() {
  setTitle('  Milas Gartenfest ')
  chooseTomorrow()
  await choosePlace('Café am Markt')
}

describe('new occasion (S6, F4)', () => {
  it('has no native date or time input anywhere', () => {
    const { container } = renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Neuer Anlass' })).toBeTruthy()
    expect(container.querySelector('input[type="date"], input[type="time"], input[type="datetime-local"]')).toBeNull()
    fireEvent.click(dateRow())
    fireEvent.click(screen.getByRole('switch', { name: 'Ganztägig' }))
    expect(document.querySelector('input[type="date"], input[type="time"], input[type="datetime-local"]')).toBeNull()
    expect(screen.getByRole('grid')).toBeTruthy()
  })

  it('shows inline errors and sends nothing while title and date are missing', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(screen.getByText('Nenne einen öffentlichen Treffpunkt, keine fremde Privatadresse')).toBeTruthy()
    fireEvent.click(saveButton())
    expect(screen.getByText('Bitte gib einen Titel ein')).toBeTruthy()
    expect(screen.getByText('Bitte wähle ein Datum')).toBeTruthy()
    expect(screen.getByLabelText('Titel').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Titel'))
    expect(api.createOccasion).not.toHaveBeenCalled()
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it('a missing date unfolds the calendar and takes the focus', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Gartenfest')
    fireEvent.click(saveButton())
    expect(document.activeElement).toBe(dateRow())
    expect(dateRow().getAttribute('aria-expanded')).toBe('true')
    expect(dateRow().getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(dateRow().getAttribute('aria-describedby') ?? '')?.textContent).toBe('Bitte wähle ein Datum')
    expect(screen.getByRole('grid')).toBeTruthy()
  })

  it('counts title characters and refuses a too long title instead of cutting it', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('x'.repeat(81))
    expect(screen.getByText('81/80')).toBeTruthy()
    chooseTomorrow()
    fireEvent.click(saveButton())
    expect(screen.getByText('Höchstens 80 Zeichen')).toBeTruthy()
    expect(api.createOccasion).not.toHaveBeenCalled()
  })

  it('writes the chosen day in the app language and how far away it is', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(within(dateRow()).getByText('Tag wählen')).toBeTruthy()
    chooseTomorrow()
    expect(within(dateRow()).getByText('Morgen')).toBeTruthy()
    const expected = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${addDays(today(), 1)}T00:00:00Z`),
    )
    expect(within(dateRow()).getByText(expected)).toBeTruthy()
  })

  it('shows the time only when "Ganztägig" is off, suggests 19:00 and unfolds the wheel', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(screen.queryByRole('button', { name: /^Uhrzeit/ })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Ganztägig' }))
    expect(screen.getByRole('switch', { name: 'Ganztägig' }).getAttribute('aria-checked')).toBe('false')
    expect(within(screen.getByRole('button', { name: /^Uhrzeit/ })).getByText('19:00')).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Stunde' }).getAttribute('aria-valuenow')).toBe('19')
    expect(screen.getByRole('spinbutton', { name: 'Minute' }).getAttribute('aria-valuenow')).toBe('0')
  })

  it('files the new occasion at once (K10): the calendar opens with ?created, optimistic screen and feed row, then the server confirms', async () => {
    const insert = deferred<{ occasionId: string }>()
    api.createOccasion.mockReturnValue(insert.promise)
    const { client } = renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    client.setQueryData(qk.me(), ME)
    const later = new Date(Date.now() + 40 * 86_400_000).toISOString()
    client.setQueryData<FeedScreen>(qk.feed(), {
      upcoming: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Später', starts_at: later, tz: TZ, all_day: true, place_text: null, role: 'member', rsvp: 'none', host_name: 'Anna', member_count: 3, wish_count: 2, my_reservation_count: 0 }],
      past: [],
    })
    await fillValidForm()
    fireEvent.click(saveButton())

    const expected: OccasionInput = {
      id: NEW_ID,
      title: 'Milas Gartenfest',
      starts_at: zonedWallTimeToIso(addDays(today(), 1), null, TZ),
      ends_at: null,
      tz: TZ,
      all_day: true,
      place_text: 'Café am Markt',
      description: null,
    }
    expect(api.createOccasion).toHaveBeenCalledWith(expected, HOST_ID)
    // the calendar tab, where the bunny carries it onto its day (features/calendar) — not the occasion page
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', search: { view: 'month', created: NEW_ID }, replace: true })
    const optimistic = client.getQueryData<OccasionScreen>(qk.occasion(NEW_ID))
    expect(optimistic?.occasion).toMatchObject({ id: NEW_ID, title: 'Milas Gartenfest', host: { id: HOST_ID, display_name: 'Mila' } })
    expect(optimistic?.viewer.role).toBe('host')
    // the feed (the calendar's data) has it right away: mine, in date order, no reservation count for a host
    const feed = client.getQueryData<FeedScreen>(qk.feed())
    expect(feed?.upcoming.map((row) => row.id)).toEqual([NEW_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
    expect(feed?.upcoming[0]).toMatchObject({ title: 'Milas Gartenfest', role: 'host', host_name: 'Mila', my_reservation_count: null, wish_count: 0 })
    expect(getSaveState(NEW_ID)).toBe('saving')

    // a second tap during the transition does not create a second occasion
    fireEvent.click(saveButton())
    expect(api.createOccasion).toHaveBeenCalledTimes(1)

    const confirmed = { ...optimistic!, wishlist: { id: 'confirmed-list', owner_id: HOST_ID, title: null, wishes: [] } }
    api.getOccasionScreen.mockResolvedValue(confirmed)
    await act(async () => insert.resolve({ occasionId: NEW_ID }))
    await waitFor(() => expect(getSaveState(NEW_ID)).toBe('created'))
    expect(toasts.error).not.toHaveBeenCalled()
    await waitFor(() => expect(client.getQueryData<OccasionScreen>(qk.occasion(NEW_ID))?.wishlist?.id).toBe('confirmed-list'))
    expect(api.getOccasionScreen).toHaveBeenCalledWith(NEW_ID)
  })

  it('sends exactly the payload of the same values: day and time picked with the keyboard', async () => {
    api.createOccasion.mockReturnValue(new Promise(() => {}))
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Gartenfest')
    // a keyboard activation (click detail 0) moves the focus into the grid, on today
    fireEvent.click(dateRow())
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset['date']).toBe(today()))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' })
    fireEvent.click(screen.getByRole('switch', { name: 'Ganztägig' }))
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Stunde' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Minute' }), { key: 'PageUp' })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Minute' }), { key: 'PageUp' })
    expect(within(screen.getByRole('button', { name: /^Uhrzeit/ })).getByText('20:30')).toBeTruthy()
    await choosePlace('Rosengarten am Fluss')
    fireEvent.change(screen.getByLabelText('Beschreibung'), { target: { value: ' Bring Musik mit \n' } })
    fireEvent.click(saveButton())

    const day = addDays(today(), 2)
    const values = { title: 'Gartenfest', date: day, time: '20:30', end: '', allDay: false, place: 'Rosengarten am Fluss', description: ' Bring Musik mit \n' }
    expect(api.createOccasion).toHaveBeenCalledWith(toOccasionInput(values, TZ, NEW_ID), HOST_ID)
    expect(api.createOccasion.mock.calls[0]?.[0]).toMatchObject({ starts_at: zonedWallTimeToIso(day, '20:30', TZ), all_day: false, description: 'Bring Musik mit' })
  })

  it('returns to the form with the input kept in memory when the server says no', async () => {
    const insert = deferred<{ occasionId: string }>()
    api.createOccasion.mockReturnValue(insert.promise)
    const { client } = renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    client.setQueryData<FeedScreen>(qk.feed(), { upcoming: [], past: [] })
    await fillValidForm()
    fireEvent.click(saveButton())
    expect(nav.pathname).toBe('/soon')
    expect(nav.search).toEqual({ view: 'month', created: NEW_ID })
    expect(client.getQueryData<FeedScreen>(qk.feed())?.upcoming.map((row) => row.id)).toEqual([NEW_ID])

    await act(async () => insert.reject(new AppError('network')))
    await waitFor(() => expect(nav.navigate).toHaveBeenLastCalledWith({ to: '/occasions/new', replace: true }))
    expect(toasts.error).toHaveBeenCalledWith('Keine Verbindung')
    expect(getSaveState(NEW_ID)).toBeUndefined()
    // the occasion that does not exist leaves the calendar again
    expect(client.getQueryData<FeedScreen>(qk.feed())?.upcoming).toEqual([])
    expect(peekDraft(HOST_ID, 'new')).toMatchObject({ id: NEW_ID, values: { title: '  Milas Gartenfest ', date: addDays(today(), 1), place: 'Café am Markt' } })
  })

  it('a refusal after the person moved on: no jump back, the toast offers the form with the input', async () => {
    const insert = deferred<{ occasionId: string }>()
    api.createOccasion.mockReturnValue(insert.promise)
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    await fillValidForm()
    fireEvent.click(saveButton())
    // meanwhile on another screen (the landing is over and the person went to the feed)
    nav.pathname = '/soon'
    nav.search = {}
    await act(async () => insert.reject(new AppError('network')))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Keine Verbindung', expect.objectContaining({ actionLabel: 'Nochmal versuchen' })))
    expect(nav.navigate).not.toHaveBeenLastCalledWith({ to: '/occasions/new', replace: true })
    const options = toasts.error.mock.calls[0]?.[1] as { onAction: () => void }
    options.onAction()
    expect(nav.navigate).toHaveBeenLastCalledWith({ to: '/occasions/new' })
    expect(peekDraft(HOST_ID, 'new')).toMatchObject({ id: NEW_ID })
  })

  it('treats "this id exists already" as success (an earlier attempt did arrive)', async () => {
    api.createOccasion.mockRejectedValue(new AppError('conflict'))
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    await fillValidForm()
    fireEvent.click(saveButton())
    await waitFor(() => expect(getSaveState(NEW_ID)).toBe('created'))
    expect(toasts.error).not.toHaveBeenCalled()
  })

  it('restores a failed draft and retries it with the same client id', () => {
    api.createOccasion.mockReturnValue(new Promise(() => {}))
    keepDraft(HOST_ID, 'new', {
      id: NEW_ID,
      values: { title: 'Gartenfest', date: '2030-06-15', time: '19:00', end: '', allDay: true, place: 'Café am Markt', description: '' },
    })
    api.newOccasionId.mockReturnValue('99999999-9999-4999-8999-999999999999')
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(screen.getByRole('alert').textContent).toContain('Nicht gespeichert')
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Gartenfest')
    expect(within(dateRow()).getByText('Sa., 15. Juni 2030')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Ort Café am Markt/ })).toBeTruthy()
    expect(peekDraft(HOST_ID, 'new')).toBeUndefined() // taken over by this form
    fireEvent.click(saveButton())
    expect(api.createOccasion).toHaveBeenCalledWith(expect.objectContaining({ id: NEW_ID, title: 'Gartenfest', place_text: 'Café am Markt' }), HOST_ID)
  })

  it('never shows another account the draft of a failed save', () => {
    keepDraft('someone-else', 'new', {
      values: { title: 'Fremder Entwurf', date: '2030-06-15', time: '19:00', end: '', allDay: true, place: '', description: '' },
    })
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a chosen place shows in its row and can be removed again', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    await choosePlace('Café am Markt')
    expect(screen.getByRole('button', { name: /^Ort Café am Markt/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ort entfernen' }))
    expect(screen.getByRole('button', { name: 'Ort hinzufügen' })).toBeTruthy()
  })

  it('cannot save offline and says why', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    await fillValidForm()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByText('Dafür brauchst du Netz')).toBeTruthy()
    fireEvent.submit(saveButton().closest('form')!)
    expect(api.createOccasion).not.toHaveBeenCalled()
  })
})
