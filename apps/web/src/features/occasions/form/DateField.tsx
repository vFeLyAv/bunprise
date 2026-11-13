import { useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { Chip, DateBadge, fade, springs, type TileTone } from '../../../ui'
import { addDays, nextWeekday, SATURDAY, type DateKey } from './calendar'
import { CalendarGrid } from './CalendarGrid'
import { badgePartsOf, formatRelativeDay, formatRowDate } from './dateFormat'
import { IconCalendarGlyph, IconChevron, IconSparkle, IconSun, IconSunrise } from './icons'
import { useCalmMotion } from './motion'
import { RowButton, useFormLayoutKey } from './parts'

// "Datum" row of the occasion form (K1: our own picker, no native date input anywhere): the kit's little
// calendar page in the occasion's own colour (the same DateBadge as its feed card and its screen) flips to
// the chosen day; next to it the day in the app language ("Di., 3. Nov. 2026") and how far away it is.
// A tap unfolds the calendar below (the group grows with a transform-based layout animation), with quick
// chips Heute · Morgen · Samstag.

export interface DateFieldProps {
  id: string
  value: string
  onChange: (date: DateKey) => void
  today: DateKey
  min: DateKey
  locale: string
  /** the occasion's colour (tileTone of its id) */
  tone: TileTone
  open: boolean
  onOpenChange: (open: boolean) => void
  /** id of the error line under the group (aria-describedby) */
  errorId?: string
  error?: string
}

export function DateField({ id, value, onChange, today, min, locale, tone, open, onOpenChange, errorId, error }: DateFieldProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const calm = useCalmMotion()
  const layoutKey = useFormLayoutKey()
  const rowRef = useRef<HTMLButtonElement>(null)
  // a keyboard activation (click with detail 0) moves the focus into the grid, a tap leaves it on the row
  const [focusGrid, setFocusGrid] = useState(false)
  const panelId = `${id}-panel`
  const quick = [
    { id: 'today', day: today, label: t('occasionForm.quick_today'), icon: <IconSun /> },
    { id: 'tomorrow', day: addDays(today, 1), label: t('occasionForm.quick_tomorrow'), icon: <IconSunrise /> },
    { id: 'saturday', day: nextWeekday(today, SATURDAY), label: t('occasionForm.quick_saturday'), icon: <IconSparkle /> },
  ].filter((chip) => chip.day >= min)

  return (
    <>
      <RowButton
        ref={rowRef}
        id={id}
        className="of-row-date"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={error ? errorId : undefined}
        invalid={Boolean(error)}
        tile={<FlipBadge value={value} tone={tone} locale={locale} invalid={Boolean(error)} />}
        caption={t('occasion.date_label')}
        label={value ? formatRowDate(value, locale) : t('occasionForm.date_choose')}
        sub={value ? formatRelativeDay(today, value, locale) : undefined}
        trailing={
          <m.span
            aria-hidden="true"
            className="of-row-expand"
            initial={false}
            animate={{ rotate: open ? 90 : 0 }}
            transition={calm ? { duration: 0 } : springs.snappy}
          >
            <IconChevron size={18} />
          </m.span>
        }
        onClick={(event) => {
          setFocusGrid(event.detail === 0)
          onOpenChange(!open)
        }}
      />
      <AnimatePresence initial={false} mode="popLayout">
        {open ? (
          <m.div
            key="calendar"
            id={panelId}
            className="of-panel"
            layout={calm ? false : 'position'}
            layoutDependency={layoutKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={fade}
          >
            <div className="of-chips" role="group" aria-label={t('occasionForm.quick_label')}>
              {quick.map((chip) => (
                <Chip key={chip.id} selected={value === chip.day} icon={chip.icon} onClick={() => onChange(chip.day)}>
                  {chip.label}
                </Chip>
              ))}
            </div>
            <CalendarGrid
              value={value}
              today={today}
              min={min}
              locale={locale}
              labels={{ previous: t('occasionForm.month_previous'), next: t('occasionForm.month_next') }}
              autoFocus={focusGrid}
              onSelect={onChange}
              onEscape={() => {
                onOpenChange(false)
                rowRef.current?.focus()
              }}
            />
          </m.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

/**
 * The calendar page of the row. A new day flips in from the top like a tear-off calendar (bouncy spring),
 * the old page falls away; calm motion: a crossfade. Before a day is chosen: an empty page.
 */
function FlipBadge({ value, tone, locale, invalid }: { value: string; tone: TileTone; locale: string; invalid: boolean }) {
  const calm = useCalmMotion()
  const parts = value ? badgePartsOf(value, locale) : null
  return (
    <span aria-hidden="true" className="of-flip">
      <AnimatePresence initial={false}>
        {parts ? (
          <m.span
            key={value}
            className="of-flip-page"
            initial={calm ? { opacity: 0 } : { rotateX: -100, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={calm ? { opacity: 0 } : { rotateX: 70, y: 10, opacity: 0, transition: { duration: 0.22 } }}
            transition={calm ? fade : springs.bouncy}
          >
            <DateBadge tone={tone} month={parts.month} day={parts.day} weekday={parts.weekday} />
          </m.span>
        ) : (
          <m.span key="empty" className="of-flip-page of-badge-empty" data-invalid={invalid ? '' : undefined} exit={{ opacity: 0 }} transition={fade}>
            <IconCalendarGlyph size={24} />
          </m.span>
        )}
      </AnimatePresence>
    </span>
  )
}
