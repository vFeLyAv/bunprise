import { APP_URL } from '../../lib/app'
import { offsetMinutes, usableZone, type IcsEvent } from './ics'

// "Zum Kalender hinzufügen" on the occasion screen (host and guests; brief §7.4). Felix 27.10: Google Kalender only,
// one tap — the button opens Google's own "new event" page with the occasion's title, time, place, the host's short
// description and a link back (nothing about guests, wishes or reservations); the calendar file (.ics) is gone. Google
// connected to Apple Kalender shows it there too. Silent adding without the last "Speichern" would need the Google
// Calendar API (OAuth + Google's app review) — "later, maybe" (Felix). The Kalender-Abo in Profil keeps every occasion
// in sync on its own.

/** What the screen knows about the occasion (OccasionScreen['occasion'] fits). */
export interface CalendarOccasion {
  id: string
  title: string
  starts_at: string
  ends_at?: string | null
  tz: string
  all_day: boolean
  place_text: string | null
  description: string | null
}

const DAY = 86_400_000

export function occasionUrl(id: string, origin: string = APP_URL): string {
  return `${origin.replace(/\/+$/, '')}/occasions/${id}`
}

export function occasionEvent(occasion: CalendarOccasion, origin: string = APP_URL): IcsEvent {
  const url = occasionUrl(occasion.id, origin)
  const text = occasion.description?.trim() ?? ''
  return {
    id: occasion.id, title: occasion.title, startsAt: occasion.starts_at, endsAt: occasion.ends_at ?? null, tz: occasion.tz,
    allDay: occasion.all_day, place: occasion.place_text, url,
    // calendars that hide the URL property still show the link
    description: text ? `${text}\n\n${url}` : url,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

function compact(ms: number, tz: string, withTime: boolean): string {
  const local = new Date(ms + offsetMinutes(ms, tz) * 60_000)
  const date = `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}`
  return withTime ? `${date}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}00` : date
}

/** Google Kalender's "new event" address with title, time (in the occasion's zone), place and the link. */
export function googleCalendarUrl(occasion: CalendarOccasion, origin: string = APP_URL): string {
  const event = occasionEvent(occasion, origin)
  const tz = usableZone(occasion.tz) ? occasion.tz : 'UTC'
  const start = Date.parse(occasion.starts_at)
  const endRaw = occasion.ends_at ? Date.parse(occasion.ends_at) : NaN
  let dates: string
  if (occasion.all_day) {
    dates = `${compact(start, tz, false)}/${compact(start + DAY + 2 * 3_600_000, tz, false)}`
  } else {
    const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : start
    dates = `${compact(start, tz, true)}/${compact(end, tz, true)}`
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', text: occasion.title.trim(), dates, ctz: tz, details: event.description ?? '' })
  const place = occasion.place_text?.trim()
  if (place) params.set('location', place)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
