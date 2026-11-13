// Calendar math of the occasion form on civil dates ("YYYY-MM-DD"). No time zone is involved: every
// step goes through Date.UTC day numbers, so daylight-saving days are ordinary days here (the zone only
// matters when form.ts turns date + time into `starts_at`). Weeks start on Monday (DE + EN UI).

export type DateKey = string

export interface YearMonth {
  readonly year: number
  /** 1 … 12 */
  readonly month: number
}

export interface DayParts {
  year: number
  month: number
  day: number
}

const KEY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

/** "2026-11-03" → { 2026, 11, 3 }; null for anything that is not a real calendar day. */
export function parseKey(key: string): DayParts | null {
  const match = KEY_SHAPE.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function isDateKey(key: string): boolean {
  return parseKey(key) !== null
}

export function toKey(year: number, month: number, day: number): DateKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dayNumber(key: DateKey): number {
  const parts = parseKey(key)
  if (!parts) throw new RangeError(`not a calendar day: ${key}`)
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS
}

function fromDayNumber(value: number): DateKey {
  const date = new Date(value * DAY_MS)
  return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function addDays(key: DateKey, days: number): DateKey {
  return fromDayNumber(dayNumber(key) + days)
}

/** Whole days from `from` to `to` (negative = `to` is earlier). */
export function daysBetween(from: DateKey, to: DateKey): number {
  return dayNumber(to) - dayNumber(from)
}

/** Valid keys compare like strings; this keeps call sites explicit. */
export function compareKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(key: DateKey): number {
  const parts = parseKey(key)
  if (!parts) throw new RangeError(`not a calendar day: ${key}`)
  const sundayFirst = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  return (sundayFirst + 6) % 7
}

export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -weekdayIndex(key))
}

export function endOfWeek(key: DateKey): DateKey {
  return addDays(key, 6 - weekdayIndex(key))
}

export function monthOf(key: DateKey): YearMonth {
  const parts = parseKey(key)
  if (!parts) throw new RangeError(`not a calendar day: ${key}`)
  return { year: parts.year, month: parts.month }
}

export function addMonths(ym: YearMonth, months: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + months
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 }
}

/** "2026-11" — stable key of a month (React keys, data attributes). */
export function monthKey(ym: YearMonth): string {
  return `${pad(ym.year, 4)}-${pad(ym.month)}`
}

/** Months from `a` to `b` (positive = `b` is later). */
export function monthsBetween(a: YearMonth, b: YearMonth): number {
  return b.year * 12 + b.month - (a.year * 12 + a.month)
}

export function firstOfMonth(ym: YearMonth): DateKey {
  return toKey(ym.year, ym.month, 1)
}

export function lastOfMonth(ym: YearMonth): DateKey {
  return toKey(ym.year, ym.month, daysInMonth(ym.year, ym.month))
}

/** Same day number `months` later, clamped to the target month's length (31 Jan + 1 month = 28/29 Feb). */
export function shiftMonths(key: DateKey, months: number): DateKey {
  const parts = parseKey(key)
  if (!parts) throw new RangeError(`not a calendar day: ${key}`)
  const target = addMonths({ year: parts.year, month: parts.month }, months)
  return toKey(target.year, target.month, Math.min(parts.day, daysInMonth(target.year, target.month)))
}

export interface GridDay {
  key: DateKey
  /** false = a leading/trailing day of the neighbouring month (shown faded) */
  inMonth: boolean
}

/** Six Monday-first weeks that contain the whole month (the grid keeps one height for every month). */
export function monthGrid(ym: YearMonth): GridDay[][] {
  const start = startOfWeek(firstOfMonth(ym))
  const weeks: GridDay[][] = []
  for (let week = 0; week < 6; week += 1) {
    const days: GridDay[] = []
    for (let day = 0; day < 7; day += 1) {
      const key = addDays(start, week * 7 + day)
      const parts = parseKey(key) as DayParts
      days.push({ key, inMonth: parts.month === ym.month && parts.year === ym.year })
    }
    weeks.push(days)
  }
  return weeks
}

/** The next day with this weekday strictly after `from` (Monday = 0 … Sunday = 6). */
export function nextWeekday(from: DateKey, weekday: number): DateKey {
  const distance = (weekday - weekdayIndex(from) + 7) % 7
  return addDays(from, distance === 0 ? 7 : distance)
}

/** `key` moved into [min, max] (either bound optional). */
export function clampKey(key: DateKey, min?: DateKey, max?: DateKey): DateKey {
  if (min !== undefined && key < min) return min
  if (max !== undefined && key > max) return max
  return key
}

export const SATURDAY = 5
