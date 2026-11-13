import { useTranslation } from 'react-i18next'
import { GIFT_INTERESTS, type GiftInterest } from '../../lib/api/giftIdeas'
import { currentLanguage } from '../../lib/i18n'
import { Button, Switch, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import type { InferredInterest } from './interests'
import { interestLabel } from './labels'
import './gifts.css'

// Two sheets of "Warum diese Ideen?": add or take away interests by hand, and the honest explanation of
// how the ideas come about — with the "Nicht personalisieren" switch right there (brief 4.4: explained,
// with an opt-out).

export function InterestSheet({ open, active, onToggle, onClose }: { open: boolean; active: readonly GiftInterest[]; onToggle: (id: GiftInterest) => void; onClose: () => void }) {
  const { t } = useTranslation('gifts')
  const sorted = [...GIFT_INTERESTS].sort((a, b) => interestLabel(t, a).localeCompare(interestLabel(t, b), currentLanguage()))
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('gifts.add_interest_title')}
      closeLabel={t('common.close')}
      footer={
        <Button size="lg" fullWidth onClick={onClose}>
          {t('gifts.add_interest_done')}
        </Button>
      }
    >
      <p className="mb-4 px-1 t-callout text-text-2">{t('gifts.add_interest_hint')}</p>
      <div className="flex flex-wrap gap-2 pb-2" role="group" aria-label={t('gifts.add_interest_title')}>
        {sorted.map((id) => {
          const on = active.includes(id)
          return (
            <button
              key={id}
              type="button"
              className="gift-interest hit-expand"
              data-kind="toggle"
              aria-pressed={on}
              onPointerDown={() => haptic('select')}
              onClick={() => onToggle(id)}
            >
              {interestLabel(t, id)}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

function titleList(titles: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(titles)
  } catch {
    return titles.join(', ')
  }
}

export interface ExplainSheetProps {
  open: boolean
  onClose: () => void
  /** null = for me */
  name: string | null
  inferred: readonly InferredInterest[]
  personalize: boolean
  onPersonalize: (on: boolean) => void
  /** the ideas are the invented demo catalogue (else: our catalogue of real products) */
  demo: boolean
}

export function ExplainSheet({ open, onClose, name, inferred, personalize, onPersonalize, demo }: ExplainSheetProps) {
  const { t } = useTranslation('gifts')
  const points = [
    t('gifts.explain_device'),
    t('gifts.explain_sent'),
    name ? t('gifts.explain_secret_someone', { name }) : t('gifts.explain_secret_me'),
    t('gifts.explain_no_profile'),
  ]
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('gifts.explain_title')}
      closeLabel={t('common.close')}
      footer={
        <Button size="lg" fullWidth variant="secondary" onClick={onClose}>
          {t('gifts.explain_close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <ol className="flex flex-col gap-3">
          {points.map((text, index) => (
            <li key={text} className="flex gap-3">
              <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 t-footnote font-bold text-accent-text">
                {index + 1}
              </span>
              <span className="t-callout text-text">{text}</span>
            </li>
          ))}
        </ol>
        {/* the opt-out right under the explanation (brief 4.4) — before the details */}
        <div className="rounded-lg px-4 py-1 glass-panel">
          <Switch label={t('gifts.personalize_label')} description={t('gifts.personalize_hint')} checked={!personalize} onChange={(off) => onPersonalize(!off)} />
        </div>
        {personalize && inferred.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="px-1 t-caption-1 font-semibold uppercase tracking-[0.06em] text-text-2">{t('gifts.explain_because_title')}</h3>
            <ul className="overflow-hidden rounded-lg glass-panel">
              {inferred.map((interest) => (
                <li key={interest.id} className="flex flex-col gap-0.5 px-4 py-2.5 [&+&]:shadow-[inset_0_1px_0_var(--separator)]">
                  <span className="t-subhead font-semibold text-text">{interestLabel(t, interest.id)}</span>
                  {interest.because.length > 0 ? (
                    <span className="t-footnote text-text-2 [overflow-wrap:anywhere]">
                      {t('gifts.explain_because', { titles: titleList(interest.because.map((title) => t('gifts.quoted', { title })), currentLanguage()) })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {/* the demo catalogue is invented; otherwise the ideas come from our checked catalogue of real products (25.10) */}
        <p className="px-1 t-footnote text-text-2">{t(demo ? 'gifts.explain_demo' : 'gifts.explain_real')}</p>
      </div>
    </Sheet>
  )
}
