import type { ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { fade } from '../../../ui'
import { formatTimeValue, type HourCycle } from './dateFormat'
import { IconClock } from './icons'
import { useCalmMotion } from './motion'
import { RowButton, RowIcon, useFormLayoutKey, ValuePill } from './parts'
import { TimeWheel } from './TimeWheel'

// "Uhrzeit" row (only when the occasion is not all-day): the time in the locale's clock ("19:00" /
// "7:00 PM"); a tap unfolds the wheel below it. The end time row (EndTimeField) is the same row with its own
// label, icon, a second line ("am nächsten Tag") and a button under the wheel.

export interface TimeFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  locale: string
  cycle: HourCycle
  open: boolean
  onOpenChange: (open: boolean) => void
  errorId?: string
  error?: string
  /** default "Uhrzeit" */
  label?: string
  /** the pill while there is no value; default "Zeit wählen" */
  placeholder?: string
  /** small second line under the label */
  sub?: ReactNode
  /** default the clock tile */
  tile?: ReactNode
  /** under the wheel, inside the open panel */
  footer?: ReactNode
}

export function TimeField({ id, value, onChange, locale, cycle, open, onOpenChange, errorId, error, label, placeholder, sub, tile, footer }: TimeFieldProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const calm = useCalmMotion()
  const layoutKey = useFormLayoutKey()
  const panelId = `${id}-panel`
  const shown = formatTimeValue(value, locale, cycle)
  const name = label ?? t('occasion.time_label')
  return (
    <>
      <RowButton
        id={id}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={error ? errorId : undefined}
        invalid={Boolean(error)}
        tile={
          tile ?? (
            <RowIcon kind="time">
              <IconClock size={18} />
            </RowIcon>
          )
        }
        label={name}
        sub={sub}
        trailing={
          <ValuePill active={open} placeholder={!shown} invalid={Boolean(error)}>
            {shown || placeholder || t('occasionForm.time_choose')}
          </ValuePill>
        }
        onClick={() => onOpenChange(!open)}
      />
      <AnimatePresence initial={false} mode="popLayout">
        {open ? (
          <m.div
            key="wheel"
            id={panelId}
            className="of-panel of-panel-wheel"
            layout={calm ? false : 'position'}
            layoutDependency={layoutKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={fade}
          >
            <TimeWheel
              value={value}
              onChange={onChange}
              locale={locale}
              cycle={cycle}
              labels={{
                group: name,
                hour: t('occasionForm.hour'),
                minute: t('occasionForm.minute'),
                period: t('occasionForm.period'),
                hourText: (hour) => t('occasionForm.hour_value', { hour }),
                minuteText: (minute) => t('occasionForm.minute_value', { minute }),
              }}
            />
            {footer}
          </m.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
