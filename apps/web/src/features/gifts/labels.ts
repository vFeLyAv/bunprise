import type { TFunction } from 'i18next'
import type { GiftBudget, GiftIdea, GiftInterest } from '../../lib/api/giftIdeas'
import { budgetShape, euroRange, euros } from './budget'

// The words of "Geschenk finden" that need numbers (i18n keys of the `gifts` namespace + Intl).

export type GiftsT = TFunction<'gifts'>

export function interestLabel(t: GiftsT, id: GiftInterest): string {
  return t(`gifts.interest.${id}`)
}

/** "Kaffee & Tee, Pflanzen und Spiele" (Intl list), for sentences and labels. */
export function interestList(t: GiftsT, ids: readonly GiftInterest[], locale: string): string {
  const labels = ids.map((id) => interestLabel(t, id))
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(labels)
  } catch {
    return labels.join(', ')
  }
}

/** "bis 25 €", "ab 200 €", "25–50 €", "Egal". */
export function budgetLabel(t: GiftsT, budget: GiftBudget, locale: string): string {
  const shape = budgetShape(budget)
  if (shape.kind === 'any') return t('gifts.budget_any')
  if (shape.kind === 'up_to') return t('gifts.budget_up_to', { max: euros(budget.max_cents, locale) })
  if (shape.kind === 'from') return t('gifts.budget_from', { min: euros(budget.min_cents, locale) })
  return euroRange(budget.min_cents, budget.max_cents, locale)
}

/** "ca. 17–39 €" */
export function priceRangeLabel(t: GiftsT, idea: Pick<GiftIdea, 'price_min_cents' | 'price_max_cents'>, locale: string): string {
  return t('gifts.price_range', { range: euroRange(idea.price_min_cents, idea.price_max_cents, locale) })
}

/** "~ 35 €" */
export function offerPriceLabel(t: GiftsT, cents: number, locale: string): string {
  return t('gifts.offer_price', { price: euros(cents, locale) })
}

/** The name in a sentence: "Anna Beispiel" → "Anna" ("Merken für Anna"). */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  return first && first.length > 0 ? first : name.trim()
}

/** "heute, 14:20" / "20. Okt., 14:20" — when the prices were read. */
export function asOfLabel(iso: string, locale: string, todayLabel: string, now = Date.now()): string {
  const at = new Date(iso)
  const today = new Date(now)
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at)
  if (sameDay) return `${todayLabel}, ${time}`
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at)
  return `${day}, ${time}`
}
