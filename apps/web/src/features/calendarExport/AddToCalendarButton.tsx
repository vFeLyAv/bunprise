import { useTranslation } from 'react-i18next'
import { openExternal } from '../../lib/maps'
import { Button, IconCalendar } from '../../ui'
import { googleCalendarUrl, type CalendarOccasion } from './addToCalendar'

// "Zum Kalender hinzufügen" in the occasion hero (host and guests). Felix 27.10: one tap, Google Kalender only — the
// tap opens Google's "new event" page with everything filled in (synchronously, so no popup blocker stops it). Not
// shown once the occasion is over.

const DAY = 86_400_000

/** Still worth adding: not over yet (a timed occasion until its end, else a day after its start). */
export function calendarWorthy(occasion: Pick<CalendarOccasion, 'starts_at' | 'ends_at'>, now: number = Date.now()): boolean {
  const start = Date.parse(occasion.starts_at)
  const end = occasion.ends_at ? Date.parse(occasion.ends_at) : NaN
  if (!Number.isFinite(start)) return false
  return (Number.isFinite(end) ? end : start + DAY) > now
}

export function AddToCalendarButton({ occasion }: { occasion: CalendarOccasion }) {
  const { t } = useTranslation('occasion')
  if (!calendarWorthy(occasion)) return null
  return (
    <Button variant="secondary" size="sm" className="min-h-11 self-start" data-add-to-calendar=""
      onClick={() => openExternal(googleCalendarUrl(occasion))}>
      <IconCalendar size={18} className="shrink-0" />
      {t('occasion.calendar.add')}
    </Button>
  )
}
