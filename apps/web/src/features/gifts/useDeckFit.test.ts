import { describe, expect, it } from 'vitest'
import { BELOW_DECK_PX, DECK_MAX_PX, DECK_MIN_PX, fitDeckHeight } from './useDeckFit'

// The card takes what the phone has left above the tab bar, so the round buttons stay in view.

describe('fitDeckHeight', () => {
  it('fills the room between the deck and the bar, minus the buttons below it', () => {
    expect(fitDeckHeight(300, 800)).toBe(800 - 300 - BELOW_DECK_PX)
  })

  it('never smaller than a picture needs, never a poster', () => {
    expect(fitDeckHeight(600, 700)).toBe(DECK_MIN_PX)
    expect(fitDeckHeight(100, 2000)).toBe(DECK_MAX_PX)
  })

  it('preserves the picture and actions when larger text needs more room than the viewport', () => {
    expect(fitDeckHeight(600, 700, BELOW_DECK_PX, 398)).toBe(398)
    expect(fitDeckHeight(600, 700, BELOW_DECK_PX, 520)).toBe(520)
  })

  it('a deck below the first screen is fitted to the screen it is scrolled to (under the top bar), not to its minimum', () => {
    // "Noch frei" above the deck: it starts at 690 of a 600 px viewport, so it cannot fit there
    expect(fitDeckHeight(690, 600, BELOW_DECK_PX, DECK_MIN_PX, 110)).toBe(600 - 110 - BELOW_DECK_PX)
    // a deck that fits on the first screen keeps its first-screen fit
    expect(fitDeckHeight(300, 800, BELOW_DECK_PX, DECK_MIN_PX, 110)).toBe(800 - 300 - BELOW_DECK_PX)
    // still within [MIN, MAX]
    expect(fitDeckHeight(1200, 2000, BELOW_DECK_PX, DECK_MIN_PX, 100)).toBe(DECK_MAX_PX)
    expect(fitDeckHeight(700, 400, BELOW_DECK_PX, DECK_MIN_PX, 110)).toBe(DECK_MIN_PX)
  })
})
