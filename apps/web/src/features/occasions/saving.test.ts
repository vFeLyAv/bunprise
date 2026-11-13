import { afterEach, describe, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import { emptyOccasionValues } from './form'
import { getSaveState, keepDraft, peekDraft, resetSavingForTests, setSaveState, startCelebration } from './saving'

// The save state / draft memory of the occasion screens belongs to the account the tab shows
// (adversarial round 2): an answer for an ended account changes nothing any more, so without this an
// interrupted edit stayed "saving" — and B's "…" menu of that occasion disabled — until a reload.
// Invented fixture ids only.

const OCCASION = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'

afterEach(() => {
  vi.useRealTimers()
  resetSavingForTests()
  resetAccountBoundaryForTests()
})

describe('occasion save state and drafts (memory of the shown account)', () => {
  it('an account that ends in the tab takes its save states, celebrations and drafts with it', () => {
    vi.useFakeTimers()
    setSaveState(OCCASION, 'saving')
    setSaveState('new-occasion', 'created')
    startCelebration('new-occasion', 6_000)
    keepDraft('account-a', OCCASION, { values: { ...emptyOccasionValues(), title: 'Geheimes Fest' } })

    endAccountEpoch() // lib/session.ts: A → B, A signed out (also the in-app switch)

    expect(getSaveState(OCCASION)).toBeUndefined()
    expect(getSaveState('new-occasion')).toBeUndefined()
    expect(peekDraft('account-a', OCCASION)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0) // the celebration timer of A is gone, too
  })

  it('without an account end the state stays (a screen change is no reset)', () => {
    setSaveState(OCCASION, 'saving')
    keepDraft('account-a', OCCASION, { values: emptyOccasionValues() })
    expect(getSaveState(OCCASION)).toBe('saving')
    expect(peekDraft('account-a', OCCASION)).toBeDefined()
  })
})
