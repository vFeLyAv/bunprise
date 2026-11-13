import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { QUANTITY_MAX, QUANTITY_MIN } from '../../lib/api/wishExtras'
import { IconButton, IconPlus, fade, useReducedMotionPref, useSpring } from '../../ui'

// "Anzahl" (Felix 30.10, 20261030120000): a compact − n + stepper, 1..10, in the owner's wish form. Two 44 px round
// buttons; the number slides up / down with the snappy spring (reduced motion: a cross-fade). One friend reserves the
// whole set — the hint under it says so. Owner module: nothing here knows about reservations.

function IconMinus() {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  )
}

export interface QuantityStepperProps {
  value: number
  onChange: (value: number) => void
  /** id of the visible heading that names the group */
  labelledBy: string
  /** id of the hint under it */
  describedBy?: string
}

export function QuantityStepper({ value, onChange, labelledBy, describedBy }: QuantityStepperProps) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const snappy = useSpring('snappy')
  // the number always slides up (new from below, old out above): calm, and the same for both buttons
  const set = (next: number) => onChange(Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, next)))
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex items-center gap-2" data-quantity-stepper="">
      <IconButton label={t('wish.quantity_less')} variant="filled" hapticKind="select" disabled={value <= QUANTITY_MIN} onClick={() => set(value - 1)}>
        <IconMinus />
      </IconButton>
      <output
        aria-live="polite"
        aria-label={t('wish.quantity_value', { count: value, max: QUANTITY_MAX })}
        className="relative grid h-11 w-10 place-items-center overflow-hidden t-title-3 tabular-nums text-text"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <m.span
            key={value}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={reduced ? fade : { ...snappy, opacity: fade }}
          >
            {value}
          </m.span>
        </AnimatePresence>
      </output>
      <IconButton label={t('wish.quantity_more')} variant="filled" hapticKind="select" disabled={value >= QUANTITY_MAX} onClick={() => set(value + 1)}>
        <IconPlus />
      </IconButton>
    </div>
  )
}
