import type { FeedOccasion } from '../../lib/api/types'
import { currentLanguage } from '../../lib/i18n'
import { timeSpan, type TimeSpan } from '../../lib/occasionTime'
import {
  browserTimeZone,
  feedGroup,
  formatDate,
  formatDateTime,
  formatTime,
  isValidTimeZone,
  relativeDayLabel,
  wallTimeDiffers,
  type DateInput,
} from '../../lib/time'

// Pure helpers for the feed "Soon" (product-pilot S5/F10, pilot-decisions §2 get_feed).
// The server decides upcoming vs past (an occasion is past at its end — ends_at, else once its day ended in its own zone);
// the client only sorts the upcoming ones into today · this week · later.

export type UpcomingGroup = 'today' | 'week' | 'later'

export interface FeedSection {
  group: UpcomingGroup
  /** ascending start; the same start by title (byStart) */
  items: FeedOccasion[]
}

export interface FeedClock {
  now?: DateInput
  /** IANA zone of the viewer; defaults to the browser's */
  viewerZone?: string
}

const GROUP_ORDER: readonly UpcomingGroup[] = ['today', 'week', 'later']

export function isValidInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

/**
 * Zone a card is shown in: an all-day occasion is a calendar date of its own zone (a birthday on
 * 12 Dec is 12 Dec everywhere); a timed one is shown in the viewer's local time.
 */
export function displayZone(occasion: Pick<FeedOccasion, 'all_day' | 'tz'>, viewerZone: string = browserTimeZone()): string {
  return occasion.all_day && isValidTimeZone(occasion.tz) ? occasion.tz : viewerZone
}

/**
 * Start's order: by start, and occasions that start at the same moment (three all-day ones on a Saturday) by
 * title. The server breaks that tie by id — a random UUID, so the same day read differently in every session.
 */
export function byStart(a: Pick<FeedOccasion, 'starts_at' | 'title'>, b: Pick<FeedOccasion, 'starts_at' | 'title'>): number {
  return Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.title.localeCompare(b.title, currentLanguage())
}

export function groupUpcoming(upcoming: readonly FeedOccasion[], clock: FeedClock = {}): FeedSection[] {
  const buckets: Record<UpcomingGroup, FeedOccasion[]> = { today: [], week: [], later: [] }
  for (const occasion of [...upcoming].sort(byStart)) {
    let group: UpcomingGroup = 'later'
    if (isValidInstant(occasion.starts_at)) {
      const day = feedGroup(occasion.starts_at, { timeZone: displayZone(occasion, clock.viewerZone), now: clock.now })
      // Still "upcoming" for the server although it started on an earlier day = it is going on now.
      group = day === 'past' ? 'today' : day
    }
    buckets[group].push(occasion)
  }
  return GROUP_ORDER.filter((group) => buckets[group].length > 0).map((group) => ({ group, items: buckets[group] }))
}

/** Guests besides the host ("n Gäste"); `member_count` includes the host (docs/contract.md §14.2). */
export function guestCount(occasion: Pick<FeedOccasion, 'member_count'>): number {
  return Math.max(0, Math.trunc(occasion.member_count) - 1)
}


export interface BadgeParts {
  /** "OKT" — short month, upper case, without the trailing dot */
  month: string
  /** "23" */
  day: string
  /** "Fr" — short weekday without the trailing dot */
  weekday: string
}

/** The little calendar page of a card (ui/DateBadge): month · day · weekday in the occasion's display zone. */
export function badgeParts(occasion: Pick<FeedOccasion, 'starts_at' | 'tz' | 'all_day'>, clock: FeedClock & { locale?: string } = {}): BadgeParts | null {
  if (!isValidInstant(occasion.starts_at)) return null
  const timeZone = displayZone(occasion, clock.viewerZone ?? browserTimeZone())
  const date = new Date(occasion.starts_at)
  const locale = clock.locale ?? currentLanguage()
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date).replace(/\.$/, '')
  return {
    month: part({ month: 'short' }).toLocaleUpperCase(locale),
    day: part({ day: 'numeric' }),
    weekday: part({ weekday: 'short' }),
  }
}

export interface WhenParts {
  /** "Heute" · "Morgen" · "In 5 Tagen" · "Vor 2 Tagen" */
  relative: string
  /** "Sa., 12. Dez. · 19:00" (all-day: date only) — without the end */
  absolute: string
  /** "Sa., 12. Dez." */
  date: string
  /** 20261026180000: start and end on the display zone's clock; null for an all-day occasion (lib/occasionTime.ts) */
  span: TimeSpan | null
  /** wall time in the occasion's own zone when it differs from the viewer's (timed occasions only) */
  occasionTime: { time: string; tz: string; span: TimeSpan } | null
}

export function describeWhen(occasion: Pick<FeedOccasion, 'starts_at' | 'ends_at' | 'tz' | 'all_day'>, clock: FeedClock = {}): WhenParts | null {
  if (!isValidInstant(occasion.starts_at)) return null
  const viewerZone = clock.viewerZone ?? browserTimeZone()
  const zone = displayZone(occasion, viewerZone)
  const relative = relativeDayLabel(occasion.starts_at, { timeZone: zone, now: clock.now })
  const absolute = formatDateTime(occasion.starts_at, { allDay: occasion.all_day, timeZone: zone })
  const date = formatDate(occasion.starts_at, { timeZone: zone })
  const span = occasion.all_day ? null : timeSpan(occasion, zone)
  const differs = !occasion.all_day && isValidTimeZone(occasion.tz) && wallTimeDiffers(occasion.starts_at, occasion.tz, viewerZone)
  const occasionTime = differs
    ? { time: formatTime(occasion.starts_at, { timeZone: occasion.tz }), tz: occasion.tz, span: timeSpan(occasion, occasion.tz) }
    : null
  return { relative, absolute, date, span, occasionTime }
}
