import { afterEach, describe, expect, it } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import {
  WISH_ADDED_KEY,
  WISH_MOMENT_INTERVAL_MS,
  canPlayWishMoment,
  cameFromOwnerList,
  clearWishAdded,
  markWishAdded,
  noteOwnerListLeft,
  noteWishMoment,
  ownWishAddCount,
  peekWishAdded,
  resetOwnerListTrail,
  resetWishMomentThrottle,
} from './wishAdded'

// The "wish added" moment's small memory: the session flag, the 10 s pace, and where the new-wish screen
// was opened from (the owner's list → back there; anywhere else → the occasion opens).

afterEach(() => {
  window.sessionStorage.clear()
  resetWishMomentThrottle()
  resetOwnerListTrail()
  resetAccountBoundaryForTests()
})

describe('wishAdded', () => {
  it('counts only confirmed own creations in memory and resets with the account', () => {
    expect(ownWishAddCount()).toBe(0)
    for (let i = 0; i < 5; i++) markWishAdded('own-list', `own-wish-${i}`)
    expect(ownWishAddCount()).toBe(5)
    clearWishAdded()
    expect(ownWishAddCount()).toBe(5)
    endAccountEpoch()
    expect(ownWishAddCount()).toBe(0)
  })
  it('the flag is read for its own occasion only, while fresh, and holds ids + a time only', () => {
    markWishAdded('occasion-1', 'wish-1', 1_000)
    expect(JSON.parse(window.sessionStorage.getItem(WISH_ADDED_KEY) ?? '{}')).toEqual({ occasionId: 'occasion-1', wishId: 'wish-1', at: 1_000 })
    expect(peekWishAdded('occasion-2', 1_500)).toBeNull()
    expect(peekWishAdded('occasion-1', 1_500)).toMatchObject({ wishId: 'wish-1' })
    expect(peekWishAdded('occasion-1', 1_000 + 61_000)).toBeNull()
    clearWishAdded()
    expect(peekWishAdded('occasion-1', 1_500)).toBeNull()
  })

  it('the moment plays at most once per 10 seconds', () => {
    expect(canPlayWishMoment(0)).toBe(true)
    noteWishMoment(0)
    expect(canPlayWishMoment(WISH_MOMENT_INTERVAL_MS - 1)).toBe(false)
    expect(canPlayWishMoment(WISH_MOMENT_INTERVAL_MS)).toBe(true)
  })

  it('"came from the list": the same occasion, a moment ago — and forgotten when the account ends', () => {
    noteOwnerListLeft('occasion-1', 10_000)
    expect(cameFromOwnerList('occasion-1', 10_400)).toBe(true)
    expect(cameFromOwnerList('occasion-2', 10_400)).toBe(false)
    expect(cameFromOwnerList('occasion-1', 12_500)).toBe(false)
    noteOwnerListLeft('occasion-1', Date.now())
    endAccountEpoch()
    expect(cameFromOwnerList('occasion-1')).toBe(false)
  })
})
