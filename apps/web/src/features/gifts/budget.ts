import { GIFT_PRICE_MAX_CENTS, type GiftBudget } from '../../lib/api/giftIdeas'

// The budget of "Geschenk finden": a € range with presets (brief 4.4 — "фильтры по бюджету" is one of the
// things we do better). Pure: steps of the range control, presets, the price-overlap rule and the labels'
// numbers (the words come from i18n). Whole euros everywhere: these are approximate prices.

/** "No upper limit" (= the database's highest wish price). */
export const BUDGET_NO_LIMIT = GIFT_PRICE_MAX_CENTS

/** The stops of the range control, in cents (the last one = "500 € +", no limit). */
export const BUDGET_STEPS: readonly number[] = [
  0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 10000, 15000, 20000, 30000, 50000, BUDGET_NO_LIMIT,
]

export type BudgetPresetId = 'u25' | '25-50' | '50-100' | '100-200' | 'any'

export const BUDGET_PRESETS: ReadonlyArray<{ id: BudgetPresetId; budget: GiftBudget }> = [
  { id: 'u25', budget: { min_cents: 0, max_cents: 2500 } },
  { id: '25-50', budget: { min_cents: 2500, max_cents: 5000 } },
  { id: '50-100', budget: { min_cents: 5000, max_cents: 10000 } },
  { id: '100-200', budget: { min_cents: 10000, max_cents: 20000 } },
  { id: 'any', budget: { min_cents: 0, max_cents: BUDGET_NO_LIMIT } },
]

/** Before anything is known about a list: a typical present among friends. */
export const DEFAULT_BUDGET: GiftBudget = { min_cents: 2000, max_cents: 5000 }

export function sameBudget(a: GiftBudget, b: GiftBudget): boolean {
  return a.min_cents === b.min_cents && a.max_cents === b.max_cents
}

export function presetOf(budget: GiftBudget): BudgetPresetId | null {
  return BUDGET_PRESETS.find((preset) => sameBudget(preset.budget, budget))?.id ?? null
}

/** Index of the highest step ≤ cents. */
export function stepAtOrBelow(cents: number): number {
  let index = 0
  for (let i = 0; i < BUDGET_STEPS.length; i += 1) if ((BUDGET_STEPS[i] ?? 0) <= cents) index = i
  return index
}

/** Index of the lowest step ≥ cents (the last step when it is above everything). */
export function stepAtOrAbove(cents: number): number {
  const index = BUDGET_STEPS.findIndex((step) => step >= cents)
  return index < 0 ? BUDGET_STEPS.length - 1 : index
}

export function stepCents(index: number): number {
  const clamped = Math.min(BUDGET_STEPS.length - 1, Math.max(0, Math.round(index)))
  return BUDGET_STEPS[clamped] ?? 0
}

/** A budget whose ends lie on the steps, min < max (the range control's two thumbs never meet). */
export function snapBudget(budget: GiftBudget): GiftBudget {
  let lo = stepAtOrBelow(Math.max(0, budget.min_cents))
  let hi = stepAtOrAbove(Math.max(0, budget.max_cents))
  if (hi <= lo) {
    if (lo >= BUDGET_STEPS.length - 1) lo = BUDGET_STEPS.length - 2
    hi = lo + 1
  }
  return { min_cents: stepCents(lo), max_cents: stepCents(hi) }
}

/**
 * A budget around what the list's wishes cost (local, from the prices it shows): 60 % … 140 % of the
 * median, snapped to the steps. Null when no wish has a price.
 */
export function suggestBudget(prices: ReadonlyArray<number | null>): GiftBudget | null {
  const known = prices.filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0).sort((a, b) => a - b)
  if (known.length === 0) return null
  const mid = Math.floor(known.length / 2)
  const median = known.length % 2 === 1 ? (known[mid] ?? 0) : ((known[mid - 1] ?? 0) + (known[mid] ?? 0)) / 2
  return snapBudget({ min_cents: Math.round(median * 0.6), max_cents: Math.round(median * 1.4) })
}

/** An idea fits the budget when its price range touches it (one of its offers may be inside). */
export function fitsBudget(idea: { price_min_cents: number; price_max_cents: number }, budget: GiftBudget): boolean {
  return idea.price_min_cents <= budget.max_cents && idea.price_max_cents >= budget.min_cents
}

export type BudgetShape =
  | { kind: 'any' }
  | { kind: 'up_to'; max: number }
  | { kind: 'from'; min: number }
  | { kind: 'range'; min: number; max: number }

/** Which words describe a budget ("bis 25 €", "ab 200 €", "25–50 €", "Egal") — euros, not cents. */
export function budgetShape(budget: GiftBudget): BudgetShape {
  const open = budget.max_cents >= BUDGET_NO_LIMIT
  if (budget.min_cents <= 0 && open) return { kind: 'any' }
  if (open) return { kind: 'from', min: Math.round(budget.min_cents / 100) }
  if (budget.min_cents <= 0) return { kind: 'up_to', max: Math.round(budget.max_cents / 100) }
  return { kind: 'range', min: Math.round(budget.min_cents / 100), max: Math.round(budget.max_cents / 100) }
}

// narrowSymbol: "25 €" in Ukrainian too (its default symbol is "25 EUR"); DE / EN / RU already write €
function euroFormat(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0, minimumFractionDigits: 0 })
}

/** 2490 → "25 €" / "€25" (whole euros: approximate prices). */
export function euros(cents: number, locale: string): string {
  return euroFormat(locale).format(Math.round(cents / 100))
}

/** "25–40 €" / "€25 – €40"; one price when both ends round to the same euro. */
export function euroRange(minCents: number, maxCents: number, locale: string): string {
  const lo = Math.round(minCents / 100)
  const hi = Math.round(maxCents / 100)
  const format = euroFormat(locale)
  if (lo === hi) return format.format(lo)
  return typeof format.formatRange === 'function' ? format.formatRange(lo, hi) : `${format.format(lo)} – ${format.format(hi)}`
}
