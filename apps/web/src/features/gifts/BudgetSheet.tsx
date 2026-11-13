import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { GiftBudget } from '../../lib/api/giftIdeas'
import { currentLanguage } from '../../lib/i18n'
import { Button, Chip, ChipGroup, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { BUDGET_PRESETS, BUDGET_STEPS, presetOf, sameBudget, stepAtOrAbove, stepAtOrBelow, stepCents, snapBudget, euros } from './budget'
import { budgetLabel } from './labels'
import './gifts.css'

// The budget: presets for one tap, and a two-thumb € range for the exact span (two native range inputs on
// one track — each thumb is a real slider for the keyboard and screen readers, 44 px to touch). Every change
// applies at once (the deck behind the sheet looks again); "Fertig" only closes.

const LAST = BUDGET_STEPS.length - 1

function stepLabel(index: number, locale: string, noLimit: (max: string) => string): string {
  if (index >= LAST) return noLimit(euros(BUDGET_STEPS[LAST - 1] ?? 0, locale))
  return euros(stepCents(index), locale)
}

export function DualRange({ budget, onChange, minLabel, maxLabel }: { budget: GiftBudget; onChange: (next: GiftBudget) => void; minLabel: string; maxLabel: string }) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const lo = stepAtOrBelow(budget.min_cents)
  const hi = Math.max(lo + 1, stepAtOrAbove(budget.max_cents))
  const noLimit = (max: string) => t('gifts.budget_no_limit', { max })
  const left = (lo / LAST) * 100
  const right = 100 - (hi / LAST) * 100
  // the lower thumb lies on top when both sit at the upper end (it must stay reachable)
  const lowOnTop = lo >= LAST - 1
  return (
    <div className="gift-range">
      <div className="gift-range-track" aria-hidden="true">
        <div className="gift-range-fill" style={{ left: `${left}%`, right: `${right}%` }} />
      </div>
      <input
        type="range"
        min={0}
        max={LAST}
        step={1}
        value={lo}
        aria-label={minLabel}
        aria-valuetext={stepLabel(lo, locale, noLimit)}
        style={{ zIndex: lowOnTop ? 2 : 1 }}
        onChange={(event) => {
          const next = Math.min(Number(event.target.value), hi - 1)
          if (next === lo) return
          haptic('select')
          onChange({ min_cents: stepCents(next), max_cents: stepCents(hi) })
        }}
      />
      <input
        type="range"
        min={0}
        max={LAST}
        step={1}
        value={hi}
        aria-label={maxLabel}
        aria-valuetext={stepLabel(hi, locale, noLimit)}
        style={{ zIndex: lowOnTop ? 1 : 2 }}
        onChange={(event) => {
          const next = Math.max(Number(event.target.value), lo + 1)
          if (next === hi) return
          haptic('select')
          onChange({ min_cents: stepCents(lo), max_cents: stepCents(next) })
        }}
      />
    </div>
  )
}

export interface BudgetSheetProps {
  open: boolean
  budget: GiftBudget
  /** the budget guessed from the list's prices (marked as the suggestion) */
  suggested: GiftBudget | null
  onChange: (next: GiftBudget) => void
  onClose: () => void
}

export function BudgetSheet({ open, budget, suggested, onChange, onClose }: BudgetSheetProps) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const rangeId = useId()
  const active = presetOf(budget)
  const snapped = snapBudget(budget)
  const lo = stepAtOrBelow(snapped.min_cents)
  const hi = stepAtOrAbove(snapped.max_cents)
  const noLimit = (max: string) => t('gifts.budget_no_limit', { max })
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('gifts.budget_sheet_title')}
      closeLabel={t('common.close')}
      footer={
        <Button size="lg" fullWidth onClick={onClose}>
          {t('gifts.budget_done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <p className="text-center t-title-2 tabular-nums text-text" aria-live="polite">
          {budgetLabel(t, budget, locale)}
        </p>
        <section className="flex flex-col gap-2">
          <h3 className="px-1 t-caption-1 font-semibold uppercase tracking-[0.06em] text-text-2">{t('gifts.budget_presets')}</h3>
          <ChipGroup label={t('gifts.budget_presets')}>
            {suggested && presetOf(suggested) === null ? (
              <Chip role="radio" selected={sameBudget(budget, suggested)} onClick={() => onChange(suggested)}>
                {budgetLabel(t, suggested, locale)}
              </Chip>
            ) : null}
            {BUDGET_PRESETS.map((preset) => (
              <Chip key={preset.id} role="radio" selected={active === preset.id} onClick={() => onChange(preset.budget)}>
                {budgetLabel(t, preset.budget, locale)}
              </Chip>
            ))}
          </ChipGroup>
          {suggested ? <p className="px-1 t-footnote text-text-2">{t('gifts.budget_suggested')}: {budgetLabel(t, suggested, locale)}</p> : null}
        </section>
        <section className="flex flex-col gap-1" aria-labelledby={rangeId}>
          <h3 id={rangeId} className="px-1 t-caption-1 font-semibold uppercase tracking-[0.06em] text-text-2">
            {t('gifts.budget_exact')}
          </h3>
          <DualRange budget={snapped} onChange={onChange} minLabel={t('gifts.budget_min')} maxLabel={t('gifts.budget_max')} />
          <div className="flex justify-between px-1 t-footnote tabular-nums text-text-2" aria-hidden="true">
            <span>{stepLabel(lo, locale, noLimit)}</span>
            <span>{stepLabel(hi, locale, noLimit)}</span>
          </div>
        </section>
      </div>
    </Sheet>
  )
}
