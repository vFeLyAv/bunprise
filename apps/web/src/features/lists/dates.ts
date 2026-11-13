import { browserTimeZone, dayKey } from '../../lib/time'

// Calendar days of the lists tab: a list's optional date (`due_on`, YYYY-MM-DD) and an occasion's local start
// day. Pure helpers (no i18n); the screens turn them into words. A list's date is the day of a celebration,
// never a birthday: the create sheet offers today … +24 months (§2.6, review #12).

export type DateKey = string

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function dayNumber(key: DateKey): number | null {
  const match = KEY.exec(key)
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000
}

/** Today in the person's zone. */
export function todayKey(now: Date = new Date(), timeZone: string = browserTimeZone()): DateKey {
  return dayKey(now, timeZone)
}

/** Whole days from `today` to `key` (negative = past); null for a malformed key. */
export function daysBetween(today: DateKey, key: DateKey): number | null {
  const from = dayNumber(today)
  const to = dayNumber(key)
  return from === null || to === null ? null : Math.round(to - from)
}

export function addMonthsKey(key: DateKey, months: number): DateKey {
  const match = KEY.exec(key)
  if (!match) return key
  const year = Number(match[1])
  const month = Number(match[2]) - 1 + months
  const day = Number(match[3])
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const date = new Date(Date.UTC(year, month, Math.min(day, last)))
  return date.toISOString().slice(0, 10)
}

/** "24. Dez." / "Dec 24" (the year only when it is not this year's). */
export function shortDate(key: DateKey, locale: string, today: DateKey): string {
  const n = dayNumber(key)
  if (n === null) return key
  const date = new Date(n * 86_400_000)
  const sameYear = key.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date)
}

/** "Mittwoch, 24. Dezember 2026" */
export function longDate(key: DateKey, locale: string): string {
  const n = dayNumber(key)
  if (n === null) return key
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(n * 86_400_000))
}

/** The local start day of an occasion. */
export function occasionDayKey(startsAt: string, timeZone: string): DateKey {
  return dayKey(startsAt, timeZone)
}

/** What a card says about a date: 'today' · 'tomorrow' · in N days (≤ 60) · the date itself · past. */
export type DateWords =
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'days'; count: number }
  | { kind: 'date'; text: string }
  | { kind: 'past'; text: string }

export function dateWords(key: DateKey, locale: string, today: DateKey = todayKey()): DateWords | null {
  const days = daysBetween(today, key)
  if (days === null) return null
  if (days < 0) return { kind: 'past', text: shortDate(key, locale, today) }
  if (days === 0) return { kind: 'today' }
  if (days === 1) return { kind: 'tomorrow' }
  if (days <= 60) return { kind: 'days', count: days }
  return { kind: 'date', text: shortDate(key, locale, today) }
}
