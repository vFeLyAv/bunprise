import { describe, expect, it } from 'vitest'
import {
  BUDGET_NO_LIMIT,
  BUDGET_PRESETS,
  BUDGET_STEPS,
  budgetShape,
  euroRange,
  euros,
  fitsBudget,
  presetOf,
  snapBudget,
  stepAtOrAbove,
  stepAtOrBelow,
  suggestBudget,
} from './budget'

// The budget of "Geschenk finden": steps, presets, the overlap rule and the numbers of the labels.

const idea = (min: number, max: number) => ({ price_min_cents: min, price_max_cents: max })

describe('steps and presets', () => {
  it('the steps rise, start at 0 and end with "no limit"', () => {
    expect(BUDGET_STEPS[0]).toBe(0)
    expect(BUDGET_STEPS[BUDGET_STEPS.length - 1]).toBe(BUDGET_NO_LIMIT)
    for (let i = 1; i < BUDGET_STEPS.length; i += 1) expect(BUDGET_STEPS[i]).toBeGreaterThan(BUDGET_STEPS[i - 1] ?? 0)
  })

  it('every preset lies on the steps and is recognised again', () => {
    for (const preset of BUDGET_PRESETS) {
      expect(BUDGET_STEPS).toContain(preset.budget.min_cents)
      expect(BUDGET_STEPS).toContain(preset.budget.max_cents)
      expect(presetOf(preset.budget)).toBe(preset.id)
    }
    expect(presetOf({ min_cents: 1500, max_cents: 4000 })).toBeNull()
  })

  it('snaps a budget onto the steps, the lower end down, the upper end up, never empty', () => {
    expect(snapBudget({ min_cents: 1650, max_cents: 3850 })).toEqual({ min_cents: 1500, max_cents: 4000 })
    expect(snapBudget({ min_cents: 2500, max_cents: 2500 })).toEqual({ min_cents: 2500, max_cents: 3000 })
    expect(snapBudget({ min_cents: BUDGET_NO_LIMIT, max_cents: BUDGET_NO_LIMIT })).toEqual({ min_cents: 50000, max_cents: BUDGET_NO_LIMIT })
    expect(stepAtOrBelow(-5)).toBe(0)
    expect(stepAtOrAbove(10 ** 12)).toBe(BUDGET_STEPS.length - 1)
  })
})

describe('suggestBudget (from the list’s own prices, on the device)', () => {
  it('60–140 % around the median, on the steps', () => {
    // Anna's list: 45, 35, 25, 18, 30, 15 € → median 27,50 € → 16,50 … 38,50 → 15–40 €
    expect(suggestBudget([4500, 3500, 2500, 1800, 3000, 1500])).toEqual({ min_cents: 1500, max_cents: 4000 })
    expect(suggestBudget([7999])).toEqual({ min_cents: 4000, max_cents: 15000 })
  })

  it('ignores wishes without a price; none at all → no suggestion', () => {
    expect(suggestBudget([null, 2000, null])).toEqual({ min_cents: 1000, max_cents: 3000 })
    expect(suggestBudget([null, null])).toBeNull()
    expect(suggestBudget([])).toBeNull()
  })
})

describe('fitsBudget: the price range has to touch the budget', () => {
  const budget = { min_cents: 2500, max_cents: 5000 }
  it.each([
    [idea(1700, 3900), true], // the cheapest offer is below, the dearest inside
    [idea(2500, 2500), true],
    [idea(5000, 9000), true], // touches the upper end
    [idea(5001, 9000), false],
    [idea(500, 2499), false],
    [idea(1000, 90000), true], // spans it
  ])('%j → %s', (range, expected) => {
    expect(fitsBudget(range, budget)).toBe(expected)
  })

  it('"Egal" fits everything', () => {
    const any = BUDGET_PRESETS.find((preset) => preset.id === 'any')?.budget
    expect(any && fitsBudget(idea(0, BUDGET_NO_LIMIT), any)).toBe(true)
  })
})

describe('labels', () => {
  it('describes the budget by its shape', () => {
    expect(budgetShape({ min_cents: 0, max_cents: BUDGET_NO_LIMIT })).toEqual({ kind: 'any' })
    expect(budgetShape({ min_cents: 0, max_cents: 2500 })).toEqual({ kind: 'up_to', max: 25 })
    expect(budgetShape({ min_cents: 20000, max_cents: BUDGET_NO_LIMIT })).toEqual({ kind: 'from', min: 200 })
    expect(budgetShape({ min_cents: 2500, max_cents: 5000 })).toEqual({ kind: 'range', min: 25, max: 50 })
  })

  // Intl puts a no-break space before "€" (it keeps the number and the sign together)
  const plain = (text: string) => text.replace(/[  ]/g, ' ')

  it('whole euros: approximate prices', () => {
    expect(plain(euros(2490, 'de'))).toBe('25 €')
    expect(plain(euros(2490, 'en'))).toBe('€25')
    expect(plain(euroRange(1690, 3900, 'de'))).toBe('17–39 €')
    expect(plain(euroRange(2490, 2510, 'de'))).toBe('25 €')
    expect(plain(euroRange(1690, 3900, 'en'))).toMatch(/^€17 ?– ?€39$/)
  })
})
