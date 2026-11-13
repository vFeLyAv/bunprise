import { dayKey, formatTime, zonedWallTimeToIso } from './time'

// The end time of an occasion (supabase/migrations/20261026180000_occasion_end_time.sql, Felix 26.10).
// The form asks for a clock time only: an end earlier than the start means "the next day" (a party until 02:00);
// the same time as the start is an error; an all-day occasion has no end. The database enforces the same rules.
// A server before the migration sends no `ends_at` key: then nothing is shown (and an edit does not touch it).

type Occasionish = { starts_at: string; ends_at?: string | null; all_day: boolean }

/** "YYYY-MM-DD" + 1 civil day (Date.UTC day numbers: daylight saving days are ordinary days). */
function nextDay(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** The end ("HH:mm") lies on the day after the start ("HH:mm") — the end is earlier on the clock. */
export function endsOnNextDay(start: string, end: string): boolean {
  return end < start
}

/** The form's first suggestion when the end is switched on: three hours after the start ("22:00" for "19:00"). */
export function suggestedEnd(start: string, hours = 3): string {
  const match = /^(\d{2}):(\d{2})$/.exec(start)
  if (!match) return '22:00'
  return `${String((Number(match[1]) + hours) % 24).padStart(2, '0')}:${match[2]}`
}

/** The form's start date + start and end clock times in the occasion's zone → the `ends_at` instant (ISO, UTC). */
export function endsAtFor(date: string, start: string, end: string, timeZone: string): string {
  return zonedWallTimeToIso(endsOnNextDay(start, end) ? nextDay(date) : date, end, timeZone)
}

/**
 * The end a screen may show: a timed occasion's ends_at when it lies after the start. null for an all-day occasion,
 * without an end, from a server that does not send the key, and for anything that is not a valid instant.
 */
export function shownEnd(occasion: Occasionish): string | null {
  if (occasion.all_day || typeof occasion.ends_at !== 'string') return null
  const end = Date.parse(occasion.ends_at)
  const start = Date.parse(occasion.starts_at)
  return Number.isFinite(end) && Number.isFinite(start) && end > start ? occasion.ends_at : null
}

export interface TimeSpan {
  /** "19:00" / "7:00 PM" */
  start: string
  /** null without an end */
  end: string | null
  /** the end falls on a later calendar day than the start — in the zone the times are shown in */
  nextDay: boolean
}

/** Start and end on the clock of `timeZone` (the viewer's for a timed occasion). */
export function timeSpan(occasion: Occasionish, timeZone: string, locale?: string): TimeSpan {
  const start = formatTime(occasion.starts_at, { timeZone, locale })
  const end = shownEnd(occasion)
  if (end === null) return { start, end: null, nextDay: false }
  return { start, end: formatTime(end, { timeZone, locale }), nextDay: dayKey(end, timeZone) !== dayKey(occasion.starts_at, timeZone) }
}

/** "19:00" · "19:00–23:00" · "19:00 bis 02:00 (nächster Tag)" (common.time_span*, every namespace falls back to common). */
export function spanText(span: TimeSpan, t: (key: string, options: { start: string; end: string }) => string): string {
  if (span.end === null) return span.start
  return t(span.nextDay ? 'common.time_span_next_day' : 'common.time_span', { start: span.start, end: span.end })
}
