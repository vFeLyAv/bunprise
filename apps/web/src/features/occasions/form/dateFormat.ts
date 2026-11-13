import type { Language } from '../../../lib/i18n'
import { daysBetween, parseKey, type DateKey, type YearMonth } from './calendar'

// Intl formatting of the occasion form (0 KB of libraries). Civil dates are formatted at UTC midnight
// with timeZone 'UTC', so the shown day never shifts with the viewer's zone.
//   German UI → de-DE ("Di., 3. Nov. 2026", 24 h);
//   English UI → the browser's own English (en-GB "Tue, 3 Nov 2026" · 24 h, en-US "Tue, Nov 3, 2026" · 12 h),
//   en-GB when the browser has no English preference;
//   Russian UI → ru-RU ("пн, 3 нояб. 2026 г.", 24 h; headings capitalised: "Ноябрь 2026");
//   Ukrainian UI → uk-UA ("вт, 3 лист. 2026 р.", 24 h; headings capitalised: "Листопад 2026").

export type HourCycle = 'h12' | 'h23'

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

function supported(tag: string | undefined): string | undefined {
  if (!tag) return undefined
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag])[0]
  } catch {
    return undefined
  }
}

/** BCP-47 locale for the form's dates and times in this UI language. */
export function intlLocale(language: Language, preferred: readonly string[] = browserLanguages()): string {
  if (language === 'de') return 'de-DE'
  if (language === 'ru') return 'ru-RU'
  if (language === 'uk') return 'uk-UA'
  return supported(preferred.find((tag) => /^en(-|$)/i.test(tag))) ?? 'en-GB'
}

// one formatter per locale + options: the grid names 42 days on every render
const formatters = new Map<string, Intl.DateTimeFormat>()

function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    formatters.set(key, formatter)
  }
  return formatter
}

function utcDate(key: DateKey): Date {
  const parts = parseKey(key)
  if (!parts) throw new RangeError(`not a calendar day: ${key}`)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

/** Row value: "Di., 3. Nov. 2026" / "Tue, 3 Nov 2026". */
export function formatRowDate(key: DateKey, locale: string): string {
  return dtf(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    utcDate(key),
  )
}

/** Accessible name of a day: "Dienstag, 3. November 2026". */
export function formatFullDate(key: DateKey, locale: string): string {
  return dtf(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    utcDate(key),
  )
}

/** Month heading: "November 2026" / "Ноябрь 2026" / "Листопад 2026" (the trailing year word "г." / "р." is dropped, the month capitalised). */
export function formatMonthYear(ym: YearMonth, locale: string): string {
  const parts = dtf(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
  const shown = parts.at(-1)?.type === 'literal' ? parts.slice(0, -1) : parts
  return capitalise(shown.map((part) => part.value).join('').trim())
}

/** "Nov" — short month without a trailing dot. */
export function formatMonthShort(key: DateKey, locale: string): string {
  return dtf(locale, { month: 'short', timeZone: 'UTC' }).format(utcDate(key)).replace(/\.$/, '')
}

/** The parts of the kit's DateBadge for a civil day: { month: "NOV", day: "5", weekday: "Do" } (as features/feed badgeParts). */
export function badgePartsOf(key: DateKey, locale: string): { month: string; day: string; weekday: string } {
  const date = utcDate(key)
  const part = (options: Intl.DateTimeFormatOptions) =>
    dtf(locale, { timeZone: 'UTC', ...options }).format(date).replace(/\.$/, '')
  return { month: part({ month: 'short' }).toLocaleUpperCase(locale), day: part({ day: 'numeric' }), weekday: part({ weekday: 'short' }) }
}

export interface WeekdayLabel {
  /** "Mo" / "Mon" */
  short: string
  /** "Montag" / "Monday" */
  long: string
}

/** Monday-first column headers. */
export function weekdayLabels(locale: string): WeekdayLabel[] {
  const short = dtf(locale, { weekday: 'short', timeZone: 'UTC' })
  const long = dtf(locale, { weekday: 'long', timeZone: 'UTC' })
  // 1 Jan 2024 was a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.UTC(2024, 0, 1 + i))
    return { short: capitalise(short.format(day).replace(/\.$/, '')), long: capitalise(long.format(day)) }
  })
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** "Heute" · "Morgen" · "In 12 Tagen" · "In 5 Wochen" · "In 4 Monaten" · "Vor 2 Tagen" (Intl.RelativeTimeFormat). */
export function formatRelativeDay(today: DateKey, key: DateKey, locale: string): string {
  const days = daysBetween(today, key)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const size = Math.abs(days)
  if (size <= 30) return capitalise(format.format(days, 'day'))
  if (size <= 63) return capitalise(format.format(Math.round(days / 7), 'week'))
  return capitalise(format.format(Math.round(days / 30.44), 'month'))
}

/** 12 h or 24 h clock of a locale (h11/h12 → 12 h; h23/h24 → 24 h). */
export function hourCycleOf(locale: string): HourCycle {
  try {
    const cycle = dtf(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
    return cycle === 'h11' || cycle === 'h12' ? 'h12' : 'h23'
  } catch {
    return 'h23'
  }
}

/** "19:05" (24 h) / "7:05 PM" (12 h) for a "HH:mm" value; '' for anything else. */
export function formatTimeValue(value: string, locale: string, cycle: HourCycle): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return ''
  const instant = Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))
  return dtf(locale, {
    hour: cycle === 'h12' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: cycle,
    timeZone: 'UTC',
  }).format(instant)
}

/** The locale's "AM" / "PM" words (12 h wheel). */
export function dayPeriodLabels(locale: string): { am: string; pm: string } {
  const format = dtf(locale, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' })
  const period = (hour: number) => format.formatToParts(Date.UTC(2000, 0, 1, hour)).find((part) => part.type === 'dayPeriod')?.value
  return { am: period(9) ?? 'AM', pm: period(21) ?? 'PM' }
}
