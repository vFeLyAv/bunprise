import type { FeedOccasion } from '../../lib/api/types'
import { browserTimeZone, dayKey, isValidTimeZone } from '../../lib/time'

// Month grid math of the calendar tab (wave 1, reference (a) in the light style). Pure functions on
// calendar dates: a day is a "YYYY-MM-DD" key, a month a { year, month: 1…12 }. All arithmetic runs on
// UTC midnights, so a daylight-saving change never moves a day. Weeks start on Monday (Germany, ISO 8601).

export interface YearMonth {
  year: number
  /** 1 … 12 */
  month: number
}

export interface GridDay {
  /** "YYYY-MM-DD" — also the cell's data-day */
  key: string
  /** 1 … 31 */
  day: number
  /** belongs to the shown month (else a greyed neighbour day) */
  inMonth: boolean
  /** 0 = Monday … 6 = Sunday */
  weekday: number
}

/** Always six weeks: every month has the same height, a month change never moves the list below. */
export const GRID_WEEKS = 6

const DAY_MS = 86_400_000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function utcKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** Monday-first weekday of a UTC midnight: 0 = Monday … 6 = Sunday. */
function mondayIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7
}

/** Normalises month overflow: { 2026, 13 } → { 2027, 1 }, { 2026, 0 } → { 2025, 12 }. */
export function normalizeMonth(year: number, month: number): YearMonth {
  const index = year * 12 + (month - 1)
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 }
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  return normalizeMonth(ym.year, ym.month + delta)
}

/** Whole months from `a` to `b` (positive = b is later). */
export function monthsBetween(a: YearMonth, b: YearMonth): number {
  return b.year * 12 + b.month - (a.year * 12 + a.month)
}

export function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month
}

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** "2026-10-24" → { year, month, day }, or null for anything that is not a real calendar date. */
export function parseDayKey(key: string): { year: number; month: number; day: number } | null {
  const match = KEY.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return null
  if (utcKey(Date.UTC(year, month - 1, day)) !== key) return null
  return { year, month, day }
}

/** The month a day key lies in (null for an invalid key). */
export function monthOfDay(key: string): YearMonth | null {
  const parts = parseDayKey(key)
  return parts ? { year: parts.year, month: parts.month } : null
}

export function daysInMonth(ym: YearMonth): number {
  return new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate()
}

/**
 * The month as 6 weeks × 7 days, Monday first. Leading and trailing days of the neighbour months fill
 * the first and the last weeks (inMonth: false).
 */
export function monthGrid(ym: YearMonth, weeks: number = GRID_WEEKS): GridDay[][] {
  const first = Date.UTC(ym.year, ym.month - 1, 1)
  const start = first - mondayIndex(first) * DAY_MS
  const rows: GridDay[][] = []
  for (let w = 0; w < weeks; w += 1) {
    const row: GridDay[] = []
    for (let d = 0; d < 7; d += 1) {
      const ms = start + (w * 7 + d) * DAY_MS
      const date = new Date(ms)
      row.push({
        key: utcKey(ms),
        day: date.getUTCDate(),
        inMonth: date.getUTCFullYear() === ym.year && date.getUTCMonth() + 1 === ym.month,
        weekday: d,
      })
    }
    rows.push(row)
  }
  return rows
}

/** Russian and Ukrainian dates start lower case ("суббота", "жовтень"); labels and headings start with a capital. */
function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** "Mo", "Di", … / "Пн", "Вт", … / "Пн", "Вт", … "Нд" in the UI language, Monday first (a fixed Monday: 2024-01-01). */
export function weekdayLabels(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, index) => capitalise(format.format(new Date(Date.UTC(2024, 0, 1 + index))).replace(/\.$/, '')))
}

/** "Oktober 2026" / "October 2026" / "Октябрь 2026" / "Жовтень 2026" (the trailing year word "г." / "р." is dropped). */
export function monthTitle(ym: YearMonth, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
  const shown = parts.at(-1)?.type === 'literal' ? parts.slice(0, -1) : parts
  return capitalise(shown.map((part) => part.value).join('').trim())
}

/** "Samstag, 24. Oktober" / "Saturday, October 24" / "Суббота, 24 октября" (the selected day's heading and the cell's name). */
export function longDayLabel(key: string, locale: string): string {
  const parts = parseDayKey(key)
  if (!parts) return key
  return capitalise(new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
  ))
}

/**
 * The day an occasion lies on for this viewer: an all-day occasion is a date of its own zone (a birthday
 * on 12 Dec is 12 Dec everywhere), a timed one is placed in the viewer's zone — the same rule as the feed
 * cards (features/feed/model.ts displayZone). Null for an unreadable start.
 */
export function occasionDay(occasion: Pick<FeedOccasion, 'starts_at' | 'tz' | 'all_day'>, viewerZone: string = browserTimeZone()): string | null {
  if (!Number.isFinite(Date.parse(occasion.starts_at))) return null
  return dayKey(occasion.starts_at, occasionZone(occasion, viewerZone))
}

/** The zone an occasion's date and time are shown in (see occasionDay). */
export function occasionZone(occasion: Pick<FeedOccasion, 'tz' | 'all_day'>, viewerZone: string = browserTimeZone()): string {
  return occasion.all_day && isValidTimeZone(occasion.tz) ? occasion.tz : viewerZone
}

/** Occasions by day key; within a day the input order (the feed's ascending start) is kept. Duplicates (same id) once. */
export function groupByDay<T extends Pick<FeedOccasion, 'id' | 'starts_at' | 'tz' | 'all_day'>>(
  occasions: readonly T[],
  viewerZone: string = browserTimeZone(),
): Map<string, T[]> {
  const days = new Map<string, T[]>()
  const seen = new Set<string>()
  for (const occasion of occasions) {
    if (seen.has(occasion.id)) continue
    seen.add(occasion.id)
    const key = occasionDay(occasion, viewerZone)
    if (!key) continue
    const list = days.get(key)
    if (list) list.push(occasion)
    else days.set(key, [occasion])
  }
  return days
}

/** Today's key in the viewer's zone. */
export function todayKey(now: Date | number = Date.now(), viewerZone: string = browserTimeZone()): string {
  return dayKey(now, viewerZone)
}
