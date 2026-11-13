import { currentLanguage } from './i18n'

// Date/time helpers on top of Intl (0 KB of libraries, performance-plan.md 4.5).
// Occasions store `starts_at` (UTC instant) + `tz` (IANA zone of the occasion);
// the viewer sees times in their own zone, with a hint when the zones differ.

export type DateInput = Date | string | number

export interface TimeOptions {
  /** BCP-47 locale; defaults to the active UI language */
  locale?: string
  /** IANA zone; defaults to the browser's zone */
  timeZone?: string
}

export function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input)
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  } catch {
    return 'Europe/Berlin'
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch {
    return false
  }
}

function resolve(options?: TimeOptions): { locale: string; timeZone: string } {
  return { locale: options?.locale ?? currentLanguage(), timeZone: options?.timeZone ?? browserTimeZone() }
}

/** "Sa., 12. Dez." / "Sat, Dec 12" */
export function formatDate(input: DateInput, options?: TimeOptions): string {
  const { locale, timeZone } = resolve(options)
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(toDate(input))
}

/** "Samstag, 12. Dezember 2026" */
export function formatLongDate(input: DateInput, options?: TimeOptions): string {
  const { locale, timeZone } = resolve(options)
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(input))
}

/** "12.12.2026" / "12/12/2026" */
export function formatNumericDate(input: DateInput, options?: TimeOptions): string {
  const { locale, timeZone } = resolve(options)
  return new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(toDate(input))
}

/**
 * "09:00" / "19:00" on a 24 h clock, "9:00 AM" / "7:00 PM" on a 12 h one (no leading zero there) — the same rule
 * as the time chip of the occasion form (features/occasions/form/dateFormat.ts formatTimeValue).
 */
export function formatTime(input: DateInput, options?: TimeOptions): string {
  const { locale, timeZone } = resolve(options)
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
  const hour = cycle === 'h12' || cycle === 'h11' ? 'numeric' : '2-digit'
  return new Intl.DateTimeFormat(locale, { timeZone, hour, minute: '2-digit' }).format(toDate(input))
}

/** "Sa., 12. Dez. · 19:00", or just the date for all-day occasions. */
export function formatDateTime(input: DateInput, options: TimeOptions & { allDay?: boolean } = {}): string {
  const { allDay, ...rest } = options
  return allDay ? formatDate(input, rest) : `${formatDate(input, rest)} · ${formatTime(input, rest)}`
}

function parts(input: DateInput, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const list = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(toDate(input))
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(list.find((p) => p.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
}

/** Calendar day of an instant in a zone, as "YYYY-MM-DD". */
export function dayKey(input: DateInput, timeZone: string = browserTimeZone()): string {
  const { year, month, day } = parts(input, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "HH:mm" wall time of an instant in a zone. */
export function wallTime(input: DateInput, timeZone: string = browserTimeZone()): string {
  const { hour, minute } = parts(input, timeZone)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000
}

/** Whole calendar days from `now` to `input` in the zone (negative = past). */
export function daysUntil(input: DateInput, options: { timeZone?: string; now?: DateInput } = {}): number {
  const timeZone = options.timeZone ?? browserTimeZone()
  return dayNumber(dayKey(input, timeZone)) - dayNumber(dayKey(options.now ?? new Date(), timeZone))
}

export function isPastDay(input: DateInput, options?: { timeZone?: string; now?: DateInput }): boolean {
  return daysUntil(input, options) < 0
}

/** "Heute" · "Morgen" · "In 5 Tagen" · "Vor 2 Tagen" (Intl.RelativeTimeFormat, numeric: 'auto'). */
export function relativeDayLabel(input: DateInput, options: TimeOptions & { now?: DateInput } = {}): string {
  const { locale, timeZone } = resolve(options)
  const days = daysUntil(input, { timeZone, now: options.now })
  const label = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export type FeedGroup = 'today' | 'week' | 'later' | 'past'

/** Grouping for the feed "Soon": today · this week (next 6 days) · later · past. */
export function feedGroup(input: DateInput, options?: { timeZone?: string; now?: DateInput }): FeedGroup {
  const days = daysUntil(input, options)
  if (days < 0) return 'past'
  if (days === 0) return 'today'
  if (days <= 6) return 'week'
  return 'later'
}

/** Offset of a zone at an instant, in minutes east of UTC. */
export function zoneOffsetMinutes(input: DateInput, timeZone: string): number {
  const p = parts(input, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - toDate(input).getTime()) / 60_000)
}

/**
 * Wall time entered in the occasion form (date "YYYY-MM-DD", time "HH:mm" or null for all day)
 * in the occasion's zone → UTC ISO string for `starts_at`. Two passes handle DST edges.
 */
export function zonedWallTimeToIso(date: string, time: string | null, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time ?? '00:00').split(':').map(Number)
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0)
  let instant = naive - zoneOffsetMinutes(naive, timeZone) * 60_000
  instant = naive - zoneOffsetMinutes(instant, timeZone) * 60_000
  return new Date(instant).toISOString()
}

/** Inverse of zonedWallTimeToIso: the form values for an existing occasion. */
export function isoToZonedWallTime(input: DateInput, timeZone: string): { date: string; time: string } {
  return { date: dayKey(input, timeZone), time: wallTime(input, timeZone) }
}

/** True when the occasion's zone shows a different wall time than the viewer's zone (→ show the hint). */
export function wallTimeDiffers(input: DateInput, occasionTimeZone: string, viewerTimeZone: string = browserTimeZone()): boolean {
  return zoneOffsetMinutes(input, occasionTimeZone) !== zoneOffsetMinutes(input, viewerTimeZone)
}

/** "2026-12-12" for file names, in the viewer's zone. */
export function isoDateForFilename(input: DateInput = new Date()): string {
  return dayKey(input)
}
