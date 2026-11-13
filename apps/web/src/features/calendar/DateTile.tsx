import type { FeedOccasion } from '../../lib/api/types'
import { currentLanguage } from '../../lib/i18n'
import { DateBadge, tileTone } from '../../ui'
import { occasionDay, parseDayKey } from './grid'

/**
 * The kit's little calendar page (ui/DateBadge) for an occasion: month, day and weekday of the day it lies
 * on for this viewer (grid.ts occasionDay), in its own tile colour (a stable hash of its id — the same tint
 * as its calendar dot, its feed card and its hero). Decorative: the row writes the date out.
 */
export function DateTile({ occasion, className }: { occasion: Pick<FeedOccasion, 'id' | 'starts_at' | 'tz' | 'all_day'>; className?: string }) {
  const key = occasionDay(occasion)
  const parts = key ? parseDayKey(key) : null
  const locale = currentLanguage()
  const date = parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : null
  const month = date ? new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date).replace(/\.$/, '') : ''
  const weekday = date ? new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date).replace(/\.$/, '') : undefined
  return <DateBadge tone={tileTone(occasion.id)} month={month} day={parts ? String(parts.day) : '·'} weekday={weekday} className={className} />
}
