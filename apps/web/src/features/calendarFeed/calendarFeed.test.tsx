import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getToasts, toast } from '../../lib/toast'
import type { CalendarFeedStatus } from '../../lib/api/calendarFeed'

// Kalender-Abo in the client (docs/handoffs/2026-10-27-calendar.md): the flag, the addresses, the sheet in its states
// (off → create → the address ONCE; active → since / last fetched, new address, end) and that the token never lands in
// storage. The RPCs are mocked. Invented data only.

const api = vi.hoisted(() => ({
  getCalendarFeed: vi.fn<(userId?: string) => Promise<CalendarFeedStatus & { available: boolean }>>(),
  createCalendarFeed: vi.fn<(lang: string, userId?: string) => Promise<{ token: string; created_at: string }>>(),
  revokeCalendarFeed: vi.fn<(userId?: string) => Promise<void>>(),
}))
vi.mock('../../lib/api/calendarFeed', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/calendarFeed')>()), ...api }))

import CalendarFeedSheet from './CalendarFeedSheet'
import { calendarFeedEnabled } from './flag'
import { feedHttpsUrl, feedLanguage, feedWebcalUrl, withCalendarFeed } from '../../lib/api/calendarFeed'

const ME = '00000000-0000-4000-8000-0000000000aa'
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE'
const OFF = { available: true, active: false, created_at: null, last_fetched_at: null, lang: null } as const
const ON = { available: true, active: true, created_at: '2026-10-20T10:00:00Z', last_fetched_at: '2026-10-27T08:15:00Z', lang: 'de' } as const

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  api.getCalendarFeed.mockReset().mockResolvedValue({ ...OFF })
  api.createCalendarFeed.mockReset().mockResolvedValue({ token: TOKEN, created_at: '2026-10-27T10:00:00Z' })
  api.revokeCalendarFeed.mockReset().mockResolvedValue()
  toast.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('flag and addresses', () => {
  it('shows the row only with VITE_CALENDAR_FEED=1 or in the demo', () => {
    expect(calendarFeedEnabled({})).toBe(false)
    expect(calendarFeedEnabled({ VITE_CALENDAR_FEED: '1' })).toBe(true)
    expect(calendarFeedEnabled({ VITE_DEMO: '1' })).toBe(true)
    expect(calendarFeedEnabled({ VITE_CALENDAR_FEED: 'true' })).toBe(false)
  })

  it('https for Google, webcal for Apple / Outlook; the language falls back to German', () => {
    expect(feedHttpsUrl(TOKEN, 'https://bunprise.de/')).toBe(`https://bunprise.de/api/calendar/${TOKEN}.ics`)
    expect(feedWebcalUrl(TOKEN, 'https://bunprise.de')).toBe(`webcal://bunprise.de/api/calendar/${TOKEN}.ics`)
    expect(feedLanguage('uk')).toBe('uk')
    expect(feedLanguage('fr')).toBe('de')
  })

  it('the export gets the status part only when there is one', () => {
    expect(withCalendarFeed({ profile: { id: ME } }, { created_at: 'x', last_fetched_at: null, lang: 'de' })).toEqual({ profile: { id: ME }, calendar_feed: { created_at: 'x', last_fetched_at: null, lang: 'de' } })
    expect(withCalendarFeed({ profile: { id: ME } }, null)).toEqual({ profile: { id: ME } })
  })
})

describe('the sheet', () => {
  it('off → create → the address once (webcal link, copy, Google steps); closing forgets it; nothing in storage', async () => {
    const onClose = vi.fn()
    const view = render(wrap(<CalendarFeedSheet userId={ME} open onClose={onClose} />))
    expect(await screen.findByText(/nie Gäste, Wünsche oder Reservierungen/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Abo-Adresse erstellen' }))
    await waitFor(() => expect(api.createCalendarFeed).toHaveBeenCalledWith('de', ME))
    const input = await screen.findByLabelText('Deine Abo-Adresse')
    expect((input as HTMLInputElement).value).toBe(`${window.location.origin}/api/calendar/${TOKEN}.ics`)
    expect(screen.getByRole('link', { name: 'In Apple Kalender abonnieren' }).getAttribute('href')).toMatch(new RegExp(`^webcal://.*/api/calendar/${TOKEN}\\.ics$`))
    expect(screen.getByText(/oft erst nach 12 bis 24 Stunden/)).toBeTruthy()
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage })
    expect(stored).not.toContain(TOKEN)
    // the close button forgets the address: opening again shows the status, not the token
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(onClose).toHaveBeenCalled()
    api.getCalendarFeed.mockResolvedValue({ ...ON })
    view.rerender(wrap(<CalendarFeedSheet userId={ME} open onClose={onClose} />))
    await waitFor(() => expect(screen.queryByLabelText('Deine Abo-Adresse')).toBeNull())
  })

  it('active: since when, last fetched; "Neue Adresse erstellen" asks first; "Abo beenden" asks and ends it', async () => {
    api.getCalendarFeed.mockResolvedValue({ ...ON })
    render(wrap(<CalendarFeedSheet userId={ME} open onClose={() => {}} />))
    expect(await screen.findByText(/^Abo aktiv seit/)).toBeTruthy()
    expect(screen.getByText(/^Zuletzt abgerufen:/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Neue Adresse erstellen' }))
    expect(await screen.findByText('Neue Adresse erstellen?')).toBeTruthy()
    expect(api.createCalendarFeed).not.toHaveBeenCalled()
    const confirmRotate = screen.getAllByRole('button', { name: 'Neue Adresse erstellen' }).at(-1)!
    fireEvent.click(confirmRotate)
    await waitFor(() => expect(api.createCalendarFeed).toHaveBeenCalledTimes(1))
    expect(await screen.findByLabelText('Deine Abo-Adresse')).toBeTruthy()
  })

  it('ending the subscription', async () => {
    api.getCalendarFeed.mockResolvedValue({ ...ON })
    render(wrap(<CalendarFeedSheet userId={ME} open onClose={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Abo beenden' }))
    expect(await screen.findByText('Kalender-Abo beenden?')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Abo beenden' }).at(-1)!)
    await waitFor(() => expect(api.revokeCalendarFeed).toHaveBeenCalledWith(ME))
    await waitFor(() => expect(getToasts().map((x) => x.text)).toContain('Kalender-Abo beendet'))
  })

  it('a failed create says so and shows no address', async () => {
    api.createCalendarFeed.mockRejectedValue(new Error('nope'))
    render(wrap(<CalendarFeedSheet userId={ME} open onClose={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Abo-Adresse erstellen' }))
    await waitFor(() => expect(getToasts().map((x) => x.text)).toContain('Das hat nicht geklappt. Versuch es gleich noch einmal.'))
    expect(screen.queryByLabelText('Deine Abo-Adresse')).toBeNull()
  })
})
