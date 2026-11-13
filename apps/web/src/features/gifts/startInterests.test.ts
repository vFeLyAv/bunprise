import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIFT_START_KEY, keepStartInterests, readStartInterests, resetStartInterestsForTests, saveStartInterests } from './startInterests'

// The welcome wish box's picks (Felix 25.10): interest ids only, this device, this account.
const ME = 'account-me'
const OTHER = 'account-other'

beforeEach(() => {
  localStorage.clear()
  resetStartInterestsForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('wish box picks for "Ideen" (device only)', () => {
  it('keeps interest ids for the account that picked them, and nothing for anyone else', () => {
    saveStartInterests(ME, ['books', 'plants'])
    expect(JSON.parse(localStorage.getItem(GIFT_START_KEY) ?? 'null')).toEqual({ v: 1, owner: ME, interests: ['books', 'plants'] })
    expect(readStartInterests(ME)).toEqual(['books', 'plants'])
    expect(readStartInterests(OTHER)).toEqual([])
  })

  it('treats storage as input: unknown ids, doubles and too many are dropped', () => {
    localStorage.setItem(GIFT_START_KEY, JSON.stringify({ v: 1, owner: ME, interests: ['books', 'books', 'secret-name', 42, 'audio', 'coffee', 'games', 'travel', 'plants', 'music', 'film', 'tech'] }))
    expect(readStartInterests(ME)).toEqual(['books', 'audio', 'coffee', 'games', 'travel', 'plants', 'music', 'film'])
    localStorage.setItem(GIFT_START_KEY, '{broken')
    expect(readStartInterests(ME)).toEqual([])
  })

  it('an empty box removes the record; a pick taken away in "Ideen" is forgotten', () => {
    saveStartInterests(ME, ['books', 'plants'])
    keepStartInterests(ME, ['plants', 'coffee'])
    expect(readStartInterests(ME)).toEqual(['plants'])
    saveStartInterests(ME, [])
    expect(localStorage.getItem(GIFT_START_KEY)).toBeNull()
  })

  it('blocked storage: the picks live in memory for this visit only', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    saveStartInterests(ME, ['games'])
    expect(readStartInterests(ME)).toEqual(['games'])
    expect(readStartInterests(OTHER)).toEqual([])
  })
})
