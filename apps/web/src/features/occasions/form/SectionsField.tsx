import { useTranslation } from 'react-i18next'
import type { OccasionSections } from '../../../lib/api/types'
import { Chip, ChipGroup } from '../../../ui'
import { FieldMessage, FormBlock, FrostGroup } from './parts'

// "Was gibt's?" (docs/design/2026-10-25-bring-list.md §1.1): Wünsche · Mitbringen · Beides. Only rendered while the
// bring-along list is released (features/potluck/flag.ts); the default "Wünsche" is every occasion as before.
// "Nur Mitbringen" cannot be chosen while the list still holds wishes (they would vanish from sight) — the hint
// says what to do instead.

const OPTIONS: readonly OccasionSections[] = ['wishes', 'bring', 'both']

export interface SectionsFieldProps {
  id: string
  value: OccasionSections
  onChange: (next: OccasionSections) => void
  /** the occasion's list has wishes: "Mitbringen" alone is not offered */
  bringLocked?: boolean
}

export function SectionsField({ id, value, onChange, bringLocked = false }: SectionsFieldProps) {
  const { t } = useTranslation('occasionForm')
  const hintId = `${id}-hint`
  return (
    <>
      <FrostGroup>
        <FormBlock className="of-item of-sections">
          <p id={id} className="of-sections-label t-subhead font-semibold text-text">
            {t('occasionForm.sections_label')}
          </p>
          <ChipGroup label={t('occasionForm.sections_label')} aria-describedby={hintId} className="of-sections-chips">
            {OPTIONS.map((option) => (
              <Chip
                key={option}
                role="radio"
                selected={value === option}
                disabled={option === 'bring' && bringLocked && value !== 'bring'}
                onClick={() => onChange(option)}
              >
                {t(`occasionForm.sections_${option}`)}
              </Chip>
            ))}
          </ChipGroup>
        </FormBlock>
      </FrostGroup>
      <FormBlock>
        <FieldMessage
          id={hintId}
          hint={bringLocked && value !== 'bring' ? `${t(`occasionForm.sections_hint_${value}`)} ${t('occasionForm.sections_bring_locked')}` : t(`occasionForm.sections_hint_${value}`)}
        />
      </FormBlock>
    </>
  )
}
