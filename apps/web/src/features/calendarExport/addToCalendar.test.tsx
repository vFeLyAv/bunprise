import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleCalendarUrl, type CalendarOccasion } from './addToCalendar'
import { AddToCalendarButton, calendarWorthy } from './AddToCalendarButton'

// "Zum Kalender hinzufügen" (the occasion screen): Google's "new event" address and the one-tap button (Felix 27.10:
// Google Kalender only, no file). Invented data only.

const OCCASION: CalendarOccasion = {
  id: 'd1e0b000-0000-4000-8000-0000000000aa', title: 'Annas Geburtstag', starts_at: '2099-11-04T18:00:00.000Z', ends_at: '2099-11-04T22:00:00.000Z',
  tz: 'Europe/Berlin', all_day: false, place_text: 'Café am Markt, Lindenweg 1', description: 'Bringt gute Laune mit; Sekt ist da.',
}
const ORIGIN = 'https://bunprise.de'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Google Kalender', () => {
  const params = (url: string) => new URL(url).searchParams

  it('timed: local times with the zone; the place and the link', () => {
    const url = googleCalendarUrl(OCCASION, ORIGIN)
    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true)
    const p = params(url)
    expect(p.get('action')).toBe('TEMPLATE')
    expect(p.get('text')).toBe('Annas Geburtstag')
    expect(p.get('dates')).toBe('20991104T190000/20991104T230000')
    expect(p.get('ctz')).toBe('Europe/Berlin')
    expect(p.get('location')).toBe('Café am Markt, Lindenweg 1')
    expect(p.get('details')).toContain(`${ORIGIN}/occasions/${OCCASION.id}`)
  })

  it('all-day: the day and the next one; without an end: start = end; an unknown zone falls back to UTC', () => {
    expect(params(googleCalendarUrl({ ...OCCASION, all_day: true, starts_at: '2099-03-27T23:00:00.000Z', ends_at: null }, ORIGIN)).get('dates')).toBe('20990328/20990329')
    expect(params(googleCalendarUrl({ ...OCCASION, ends_at: null }, ORIGIN)).get('dates')).toBe('20991104T190000/20991104T190000')
    const odd = params(googleCalendarUrl({ ...OCCASION, tz: 'Nowhere/Land' }, ORIGIN))
    expect(odd.get('ctz')).toBe('UTC')
    expect(odd.get('dates')).toBe('20991104T180000/20991104T220000')
  })
})

describe('the button', () => {
  it('only while the occasion is not over', () => {
    const now = Date.UTC(2026, 9, 27, 12)
    expect(calendarWorthy({ starts_at: '2026-10-28T18:00:00Z', ends_at: null }, now)).toBe(true)
    expect(calendarWorthy({ starts_at: '2026-10-27T08:00:00Z', ends_at: null }, now)).toBe(true) // today, a day of grace
    expect(calendarWorthy({ starts_at: '2026-10-26T08:00:00Z', ends_at: '2026-10-26T10:00:00Z' }, now)).toBe(false)
    expect(calendarWorthy({ starts_at: '2026-10-20T08:00:00Z', ends_at: null }, now)).toBe(false)
    const { container } = render(<AddToCalendarButton occasion={{ ...OCCASION, starts_at: '2020-01-01T10:00:00Z', ends_at: null }} />)
    expect(container.innerHTML).toBe('')
  })

  it('one tap opens Google Kalender with the occasion in a new tab — no choice, no file', () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<AddToCalendarButton occasion={OCCASION} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zu Google Kalender hinzufügen' }))
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/calendar\.google\.com\/calendar\/render\?.*text=Annas\+Geburtstag/), '_blank', 'noopener,noreferrer')
    expect(document.querySelector('[data-calendar-sheet]')).toBeNull()
  })

})
