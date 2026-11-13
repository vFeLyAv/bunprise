import { useTranslation } from 'react-i18next'
import { endsOnNextDay, suggestedEnd } from '../../../lib/occasionTime'
import type { HourCycle } from './dateFormat'
import { IconMoon } from './icons'
import { RowIcon } from './parts'
import { TimeField } from './TimeField'

// "Ende" (Felix 26.10, migration 20261026180000): an optional end time under "Uhrzeit", the same row and wheel.
// Empty, the pill says "Optional"; the first tap suggests three hours after the start. An end earlier than the
// start lies on the next day — the row says so ("am nächsten Tag"). "Ohne Ende" under the wheel takes it away.

export interface EndTimeFieldProps {
  id: string
  /** the start time "HH:mm" */
  start: string
  /** "HH:mm", '' = no end */
  value: string
  onChange: (value: string) => void
  locale: string
  cycle: HourCycle
  open: boolean
  onOpenChange: (open: boolean) => void
  errorId?: string
  error?: string
}

export function EndTimeField({ id, start, value, onChange, locale, cycle, open, onOpenChange, errorId, error }: EndTimeFieldProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const nextDay = value !== '' && endsOnNextDay(start, value)
  return (
    <TimeField
      id={id}
      value={value}
      onChange={onChange}
      locale={locale}
      cycle={cycle}
      open={open}
      onOpenChange={(next) => {
        // a suggestion, like 19:00 for the start: the wheel opens on a real time
        if (next && value === '') onChange(suggestedEnd(start))
        onOpenChange(next)
      }}
      error={error}
      errorId={errorId}
      label={t('occasion.end_label')}
      placeholder={t('occasionForm.end_optional')}
      sub={nextDay ? t('occasionForm.end_next_day') : undefined}
      tile={
        <RowIcon kind="end">
          <IconMoon size={18} />
        </RowIcon>
      }
      footer={
        value !== '' ? (
          <div className="of-wheel-foot">
            <button
              type="button"
              className="of-wheel-clear"
              onClick={() => {
                onChange('')
                onOpenChange(false)
                // the button goes with the panel: the focus returns to the row
                document.getElementById(id)?.focus()
              }}
            >
              {t('occasionForm.end_remove')}
            </button>
          </div>
        ) : null
      }
    />
  )
}
