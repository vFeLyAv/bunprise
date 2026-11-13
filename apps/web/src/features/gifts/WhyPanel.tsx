import { useTranslation } from 'react-i18next'
import type { GiftBudget, GiftInterest } from '../../lib/api/giftIdeas'
import { currentLanguage } from '../../lib/i18n'
import { IconForward, Switch, cn, haptic } from '../../ui'
import { IconInfo } from './icons'
import { budgetLabel } from './labels'
import './gifts.css'

// "Ideen anpassen" — the quiet controls under the deck (Felix 27.10: no box that says "because you wish for
// coffee things: Kaffee & Tee, Küche …" — that is not how the ideas are found any more; styles.ts reads brands and
// taste). Three rows: the budget, the interests (a sheet to add or take away by hand; the row only says how many,
// never lists them), the "Nicht personalisieren" switch. The (i) opens the honest explanation (ExplainSheet).

export interface WhyPanelProps {
  interests: readonly GiftInterest[]
  personalize: boolean
  budget: GiftBudget
  /** opens the interest sheet */
  onInterests: () => void
  onBudget: () => void
  onPersonalize: (on: boolean) => void
  onExplain: () => void
}

function Row({ label, value, onPress, aria }: { label: string; value: string; onPress: () => void; aria: string }) {
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 px-4 text-left shadow-[inset_0_1px_0_var(--separator)] tr-colors active:bg-fill"
      aria-label={aria}
      onPointerDown={() => haptic('tap')}
      onClick={onPress}
    >
      <span className="t-body text-text">{label}</span>
      <span className={cn('ml-auto t-body font-semibold tabular-nums text-accent-text')}>{value}</span>
      <IconForward size={18} className="text-text-3" />
    </button>
  )
}

export function WhyPanel({ interests, personalize, budget, onInterests, onBudget, onPersonalize, onExplain }: WhyPanelProps) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const budgetText = budgetLabel(t, budget, locale)
  const interestsText = !personalize ? t('gifts.tune_interests_off') : interests.length > 0 ? t('gifts.tune_interests_count', { count: interests.length }) : t('gifts.tune_interests_none')
  return (
    <section aria-labelledby="gifts-why" className="overflow-hidden rounded-(--r-card) glass-panel">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-2">
        <h2 id="gifts-why" className="t-headline text-text">
          {t('gifts.tune_title')}
        </h2>
        <button
          type="button"
          className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-accent-text tr-colors active:bg-fill"
          aria-label={t('gifts.why_info')}
          onPointerDown={() => haptic('tap')}
          onClick={onExplain}
        >
          <IconInfo size={22} />
        </button>
      </div>
      <Row label={t('gifts.budget_label')} value={budgetText} onPress={onBudget} aria={t('gifts.budget_change', { budget: budgetText })} />
      {personalize ? (
        <Row label={t('gifts.tune_interests')} value={interestsText} onPress={onInterests} aria={`${t('gifts.tune_interests')}: ${interestsText}`} />
      ) : null}
      <div className="px-4 py-1.5 shadow-[inset_0_1px_0_var(--separator)]">
        {/* the switch stays one glance away; what it does is explained once, in the (i) sheet */}
        <Switch label={t('gifts.personalize_label')} checked={!personalize} onChange={(off) => onPersonalize(!off)} />
      </div>
    </section>
  )
}
