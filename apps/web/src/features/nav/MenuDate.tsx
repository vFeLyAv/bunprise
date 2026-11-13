import type { FeedOccasion } from '../../lib/api/types'
import { currentLanguage } from '../../lib/i18n'
import { browserTimeZone, dayKey, isValidTimeZone, relativeDayLabel } from '../../lib/time'
import { DateBadge, tileTone } from '../../ui'

// An occasion as a choice in the "+" menu (CreateMenu's "Für welchen Anlass?" and ListWishStep's "In welche
// Liste?"): its little calendar page and "In 3 Tagen". Shared by the two lazy chunks of the menu.

/** The zone an occasion's date is shown in — the rule of the feed and the calendar (calendar/grid.ts). */
function zoneOf(occasion: FeedOccasion): string {
  return occasion.all_day && isValidTimeZone(occasion.tz) ? occasion.tz : browserTimeZone()
}

/** "In 3 Tagen" (the date badge next to it shows the date itself). */
export function whenLabel(occasion: FeedOccasion): string {
  if (!Number.isFinite(Date.parse(occasion.starts_at))) return ''
  return relativeDayLabel(occasion.starts_at, { timeZone: zoneOf(occasion) })
}

/** The kit's little calendar page for an occasion (like calendar/DateTile; kept here so the menu's chunks stay apart). */
export function MenuDate({ occasion }: { occasion: FeedOccasion }) {
  const valid = Number.isFinite(Date.parse(occasion.starts_at))
  const [year, month, day] = (valid ? dayKey(occasion.starts_at, zoneOf(occasion)) : '').split('-').map(Number)
  const date = year && month && day ? new Date(Date.UTC(year, month - 1, day)) : null
  const format = (options: Intl.DateTimeFormatOptions) =>
    date ? new Intl.DateTimeFormat(currentLanguage(), { ...options, timeZone: 'UTC' }).format(date).replace(/\.$/, '') : ''
  return <DateBadge tone={tileTone(occasion.id)} month={format({ month: 'short' })} day={day ? String(day) : '·'} weekday={format({ weekday: 'short' }) || undefined} />
}
