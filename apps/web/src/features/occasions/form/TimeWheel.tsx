import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { haptic } from '../../../ui'
import { dayPeriodLabels, type HourCycle } from './dateFormat'
import { useCalmMotion } from './motion'
import { from12h, hourOptions, minuteOptions, parseTime, to12h, toTimeValue } from './wheelModel'

// The time wheel (K1): native scroll-snap columns — momentum, rubber band and snapping come from the
// platform, so it feels like the system picker — over a frosted selection band. Every column is a
// WAI-ARIA spinbutton: ↑/↓ one step, PageUp/PageDown three, Home/End first/last, and digits typed in a
// row set the value directly (the typed fallback: "1", "9" → 19; any minute, not only 5-minute steps).

export const WHEEL_ITEM = 44

interface WheelColumnProps {
  label: string
  options: readonly number[]
  value: number
  format: (option: number) => string
  /** spoken value ("19 Uhr") */
  valueText: (option: number) => string
  onChange: (option: number) => void
  /** digits typed into the column may set any value in [min, max] (it joins the options) */
  typedRange?: readonly [number, number]
  /** letters that pick an option (AM/PM column) */
  letters?: Readonly<Record<string, number>>
  className?: string
}

function WheelColumn({ label, options, value, format, valueText, onChange, typedRange, letters, className }: WheelColumnProps) {
  const calm = useCalmMotion()
  const ref = useRef<HTMLDivElement>(null)
  const index = Math.max(0, options.indexOf(value))
  // the index the scroll position shows right now (changes while the wheel spins)
  const shown = useRef(index)
  const typed = useRef({ text: '', at: 0 })
  // while the wheel glides to a value set by keys or a tap, its passing scroll positions are not choices
  const gliding = useRef<{ to: number; timer: ReturnType<typeof setTimeout> } | null>(null)

  // first paint: already at the value, no animation
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = shown.current * WHEEL_ITEM
  }, [])

  const endGlide = () => {
    if (gliding.current) clearTimeout(gliding.current.timer)
    gliding.current = null
  }
  useEffect(() => endGlide, [])

  // a value from elsewhere (keys, typing, a tap on an item) → glide there
  useEffect(() => {
    const el = ref.current
    if (!el) return
    shown.current = index
    if (Math.round(el.scrollTop / WHEEL_ITEM) === index) return
    const top = index * WHEEL_ITEM
    if (typeof el.scrollTo === 'function' && !calm) {
      endGlide()
      // a finger (or the end of the glide) takes over at the latest after this
      gliding.current = { to: index, timer: setTimeout(endGlide, 700) }
      el.scrollTo({ top, behavior: 'smooth' })
    } else {
      el.scrollTop = top
    }
  }, [index, calm])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const at = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM)))
    if (gliding.current) {
      if (at === gliding.current.to) endGlide()
      return
    }
    if (at === shown.current) return
    shown.current = at
    haptic('select') // one tick per item, like the system wheel
    const next = options[at]
    if (next !== undefined && next !== value) onChange(next)
  }

  const step = (by: number) => {
    const next = options[Math.min(options.length - 1, Math.max(0, index + by))]
    if (next !== undefined && next !== value) {
      haptic('select')
      onChange(next)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowUp':
        step(1)
        break
      case 'ArrowDown':
        step(-1)
        break
      case 'PageUp':
        step(3)
        break
      case 'PageDown':
        step(-3)
        break
      case 'Home':
        step(-options.length)
        break
      case 'End':
        step(options.length)
        break
      default: {
        const letter = letters?.[event.key.toLowerCase()]
        if (letter !== undefined) {
          if (letter !== value) onChange(letter)
          break
        }
        if (!typedRange || !/^\d$/.test(event.key)) return
        const now = Date.now()
        const text = (now - typed.current.at < 1200 ? typed.current.text + event.key : event.key).slice(-2)
        typed.current = { text, at: now }
        const number = Number(text)
        if (number >= typedRange[0] && number <= typedRange[1] && number !== value) onChange(number)
      }
    }
    event.preventDefault()
  }

  return (
    <div
      ref={ref}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={Math.min(...options)}
      aria-valuemax={Math.max(...options)}
      aria-valuetext={valueText(value)}
      className={className ? `of-wheel-col ${className}` : 'of-wheel-col'}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div aria-hidden="true" className="of-wheel-pad" />
      {options.map((option) => (
        <div
          key={option}
          aria-hidden="true"
          className="of-wheel-item"
          data-selected={option === value ? '' : undefined}
          onClick={() => {
            if (option === value) return
            haptic('select')
            onChange(option)
          }}
        >
          {format(option)}
        </div>
      ))}
      <div aria-hidden="true" className="of-wheel-pad" />
    </div>
  )
}

export interface TimeWheelProps {
  /** "HH:mm" (24 h) */
  value: string
  onChange: (value: string) => void
  locale: string
  cycle: HourCycle
  labels: { group: string; hour: string; minute: string; period: string; hourText: (hour: string) => string; minuteText: (minute: string) => string }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function TimeWheel({ value, onChange, locale, cycle, labels }: TimeWheelProps) {
  const parts = parseTime(value) ?? { hour: 19, minute: 0 }
  const minutes = minuteOptions(parts.minute)
  const twelve = cycle === 'h12'
  const { hour12, pm } = to12h(parts.hour)
  const periods = dayPeriodLabels(locale)
  return (
    <div role="group" aria-label={labels.group} className="of-wheel" data-cycle={cycle}>
      <div aria-hidden="true" className="of-wheel-band" />
      <WheelColumn
        label={labels.hour}
        options={hourOptions(cycle)}
        value={twelve ? hour12 : parts.hour}
        format={(hour) => (twelve ? String(hour) : pad(hour))}
        valueText={(hour) => labels.hourText(twelve ? String(hour) : pad(hour))}
        typedRange={twelve ? [1, 12] : [0, 23]}
        onChange={(hour) => onChange(toTimeValue(twelve ? from12h(hour, pm) : hour, parts.minute))}
      />
      <span aria-hidden="true" className="of-wheel-colon">
        :
      </span>
      <WheelColumn
        label={labels.minute}
        options={minutes}
        value={parts.minute}
        format={pad}
        valueText={(minute) => labels.minuteText(pad(minute))}
        typedRange={[0, 59]}
        onChange={(minute) => onChange(toTimeValue(parts.hour, minute))}
      />
      {twelve ? (
        <WheelColumn
          label={labels.period}
          className="of-wheel-period"
          options={[0, 1]}
          value={pm ? 1 : 0}
          format={(period) => (period === 1 ? periods.pm : periods.am)}
          valueText={(period) => (period === 1 ? periods.pm : periods.am)}
          letters={{ a: 0, p: 1 }}
          onChange={(period) => onChange(toTimeValue(from12h(hour12, period === 1), parts.minute))}
        />
      ) : null}
    </div>
  )
}
