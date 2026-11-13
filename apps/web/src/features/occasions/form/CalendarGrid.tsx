import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, useIsPresent, type PanInfo } from 'motion/react'
import * as m from 'motion/react-m'
import { fade, haptic, IconButton, springs } from '../../../ui'
import {
  addDays,
  addMonths,
  clampKey,
  endOfWeek,
  lastOfMonth,
  monthGrid,
  monthKey,
  monthOf,
  monthsBetween,
  parseKey,
  shiftMonths,
  startOfWeek,
  type DateKey,
  type YearMonth,
} from './calendar'
import { formatFullDate, formatMonthYear, weekdayLabels } from './dateFormat'
import { IconChevronLeft, IconChevronRight } from './icons'
import { useCalmMotion } from './motion'

// The month grid of the date picker (WAI-ARIA APG "Date Picker" grid, inline instead of a dialog):
// - Monday-first weeks, six rows for every month (one height: nothing below jumps when months change);
// - today has a ring, the selected day a filled accent circle that GLIDES to the next pick (shared layout);
// - months change with the chevrons, PageUp/PageDown or a horizontal swipe — the month slides with the
//   smooth spring and follows the finger while it is dragged;
// - keyboard: arrows (day / week), Home/End (week start / end), PageUp/PageDown (month),
//   Shift+PageUp/PageDown (year), Enter/Space (pick), Esc (close); the month heading is a live region;
// - days before `min` are shown faded and cannot be picked; leading/trailing days of the neighbouring
//   months are shown faded too (a tap picks them and turns the page).

export interface CalendarGridProps {
  /** selected day ('' = none yet) */
  value: DateKey | ''
  today: DateKey
  min?: DateKey
  locale: string
  labels: { previous: string; next: string }
  onSelect: (key: DateKey) => void
  /** Esc inside the grid */
  onEscape?: () => void
  /** move the keyboard focus into the grid once it is shown */
  autoFocus?: boolean
}

interface View {
  focused: DateKey
  /** -1 = the new month comes from the left, 1 = from the right */
  dir: number
}

/** What the sliding months need to know: where from and how far (the viewport's width). */
interface Slide {
  dir: number
  width: number
}

const SWIPE_DISTANCE = 44
const SWIPE_VELOCITY = 320

export function CalendarGrid({ value, today, min, locale, labels, onSelect, onEscape, autoFocus = false }: CalendarGridProps) {
  const calm = useCalmMotion()
  const labelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const focusCell = useRef(autoFocus)
  const dragMoved = useRef(false)
  const startDay = (value || clampKey(today, min)) as DateKey
  const [view, setView] = useState<View>({ focused: startDay, dir: 0 })
  const [width, setWidth] = useState(320)
  const [seenValue, setSeenValue] = useState(value)
  const month = monthOf(view.focused)
  const weekdays = useMemo(() => weekdayLabels(locale), [locale])

  const go = (next: DateKey) => {
    const target = min !== undefined && next < min ? min : next
    setView((current) => {
      const months = monthsBetween(monthOf(current.focused), monthOf(target))
      return { focused: target, dir: months === 0 ? current.dir : Math.sign(months) }
    })
  }

  // A pick from outside (quick chips) turns the page to that day.
  if (value !== seenValue) {
    setSeenValue(value)
    if (value && value !== view.focused) {
      const months = monthsBetween(month, monthOf(value))
      setView({ focused: value, dir: months === 0 ? view.dir : Math.sign(months) })
    }
  }

  // the slide distance = the viewport's width (measured, and again when it changes)
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setWidth(el.offsetWidth || 320)
    measure()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // keyboard: the focused day follows the roving focus (also into the next month's grid)
  useEffect(() => {
    if (!focusCell.current) return
    focusCell.current = false
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-month="${monthKey(monthOf(view.focused))}"] [data-date="${view.focused}"]`)
      ?.focus({ preventScroll: true })
  })

  const canGoBack = min === undefined || lastOfMonth(addMonths(month, -1)) >= min

  const turn = (months: number) => {
    if (months < 0 && !canGoBack) return
    go(shiftMonths(view.focused, months))
  }

  const pick = (key: DateKey) => {
    if (min !== undefined && key < min) {
      haptic('warning')
      return
    }
    haptic('select')
    onSelect(key)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const from = view.focused
    let next: DateKey | null = null
    switch (event.key) {
      case 'ArrowRight':
        next = addDays(from, 1)
        break
      case 'ArrowLeft':
        next = addDays(from, -1)
        break
      case 'ArrowDown':
        next = addDays(from, 7)
        break
      case 'ArrowUp':
        next = addDays(from, -7)
        break
      case 'Home':
        next = startOfWeek(from)
        break
      case 'End':
        next = endOfWeek(from)
        break
      case 'PageUp':
        next = shiftMonths(from, event.shiftKey ? -12 : -1)
        break
      case 'PageDown':
        next = shiftMonths(from, event.shiftKey ? 12 : 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        pick(from)
        return
      case 'Escape':
        if (onEscape) {
          event.preventDefault()
          event.stopPropagation()
          onEscape()
        }
        return
      default:
        return
    }
    event.preventDefault()
    focusCell.current = true
    go(next)
  }

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) turn(1)
    else if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) turn(-1)
  }

  const slideOf: Slide = { dir: view.dir, width }
  const slide = calm
    ? { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        enter: (v: Slide) => ({ x: v.dir * v.width, opacity: 0.4 }),
        center: { x: 0, opacity: 1 },
        exit: (v: Slide) => ({ x: -v.dir * v.width, opacity: 0.4 }),
      }

  return (
    <div ref={rootRef} className="of-cal">
      <div className="of-cal-head">
        <div id={labelId} className="of-cal-title" aria-live="polite">
          {formatMonthYear(month, locale)}
        </div>
        <div className="of-cal-nav">
          <IconButton label={labels.previous} disabled={!canGoBack} onClick={() => turn(-1)}>
            <IconChevronLeft />
          </IconButton>
          <IconButton label={labels.next} onClick={() => turn(1)}>
            <IconChevronRight />
          </IconButton>
        </div>
      </div>
      <div aria-hidden="true" className="of-cal-weekdays">
        {weekdays.map((day) => (
          <span key={day.long}>{day.short}</span>
        ))}
      </div>
      <div ref={viewportRef} className="of-cal-viewport">
        <AnimatePresence initial={false} custom={slideOf}>
          <m.div
            key={monthKey(month)}
            className="of-cal-month"
            custom={slideOf}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={calm ? fade : springs.smooth}
            drag={calm ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.5}
            dragMomentum={false}
            onPointerDown={() => {
              dragMoved.current = false
            }}
            onDragStart={() => {
              dragMoved.current = true
            }}
            onDragEnd={onDragEnd}
            style={{ touchAction: 'pan-y' }}
          >
            <MonthTable
              month={month}
              focused={view.focused}
              value={value}
              today={today}
              min={min}
              locale={locale}
              labelId={labelId}
              weekdays={weekdays.map((day) => day.long)}
              calm={calm}
              onKeyDown={onKeyDown}
              onPick={(key) => {
                // the end of a swipe is no tap; a picked day becomes the roving focus through `value`
                if (dragMoved.current) return
                pick(key)
              }}
            />
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

interface MonthTableProps {
  month: YearMonth
  focused: DateKey
  value: DateKey | ''
  today: DateKey
  min?: DateKey
  locale: string
  labelId: string
  weekdays: string[]
  calm: boolean
  onKeyDown: (event: KeyboardEvent<HTMLTableElement>) => void
  onPick: (key: DateKey) => void
}

function MonthTable({ month, focused, value, today, min, locale, labelId, weekdays, calm, onKeyDown, onPick }: MonthTableProps) {
  // the month that slides out stays visible for a moment, but it is no longer part of the page
  const present = useIsPresent()
  const weeks = useMemo(() => monthGrid(month), [month])
  const mk = monthKey(month)
  return (
    <table
      role="grid"
      aria-labelledby={labelId}
      data-month={mk}
      className="of-cal-table"
      inert={!present}
      aria-hidden={present ? undefined : true}
      onKeyDown={onKeyDown}
    >
      <thead className="sr-only">
        <tr>
          {weekdays.map((name) => (
            <th key={name} scope="col" abbr={name}>
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]?.key}>
            {week.map((day) => {
              const number = parseKey(day.key)?.day
              if (!day.inMonth) {
                return (
                  <td key={day.key} className="of-cal-day" data-outside="" onClick={() => onPick(day.key)}>
                    <span aria-hidden="true" className="of-cal-num">
                      {number}
                    </span>
                  </td>
                )
              }
              const selected = day.key === value
              const disabled = min !== undefined && day.key < min
              return (
                <td
                  key={day.key}
                  role="gridcell"
                  tabIndex={day.key === focused ? 0 : -1}
                  aria-selected={selected}
                  aria-disabled={disabled || undefined}
                  aria-current={day.key === today ? 'date' : undefined}
                  aria-label={formatFullDate(day.key, locale)}
                  data-date={day.key}
                  data-today={day.key === today ? '' : undefined}
                  data-selected={selected ? '' : undefined}
                  data-disabled={disabled ? '' : undefined}
                  className="of-cal-day"
                  onClick={() => onPick(day.key)}
                >
                  {selected ? (
                    <m.span
                      aria-hidden="true"
                      layoutId={calm ? undefined : `of-cal-selected-${mk}`}
                      className="of-cal-selected"
                      transition={springs.snappy}
                    />
                  ) : null}
                  <span aria-hidden="true" className="of-cal-num">
                    {number}
                  </span>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
