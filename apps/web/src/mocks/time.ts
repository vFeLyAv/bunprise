// Zone-aware date maths for the demo server — Intl only, no imports from the app, so the mock
// mirrors the SQL (`at time zone`) without depending on UI code (src/lib/time.ts uses i18n).

interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone)
  if (!format) {
    // Throws a RangeError for an unknown zone (nothing is cached then).
    format = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formatters.set(timeZone, format)
  }
  return format
}

/** True when Postgres' `now() at time zone tz` would accept the zone (occasion_guard). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}

function wallTime(ms: number, timeZone: string): WallTime {
  const parts = formatter(timeZone).formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
}

function offsetMs(ms: number, timeZone: string): number {
  const wall = wallTime(ms, timeZone)
  const wholeSecond = ms - (((ms % 1000) + 1000) % 1000)
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - wholeSecond
}

/** A wall-clock time in `timeZone` → epoch ms. Two passes handle the DST switch days. */
export function zonedToMs(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const firstGuess = naive - offsetMs(naive, timeZone)
  return naive - offsetMs(firstGuess, timeZone)
}

/** `days` calendar days after the local date of `ms` in `timeZone`, at hour:minute local time. */
export function localDayAt(ms: number, timeZone: string, days: number, hour: number, minute: number): number {
  const wall = wallTime(ms, timeZone)
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days))
  return zonedToMs(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone)
}

/**
 * get_feed()'s end of an occasion without ends_at:
 * `((starts_at at time zone tz)::date + 1)::timestamp at time zone tz` — the next local midnight.
 */
export function endOfLocalDay(ms: number, timeZone: string): number {
  return localDayAt(ms, timeZone, 1, 0, 0)
}
