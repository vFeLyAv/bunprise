import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endAccountEpoch } from '../../lib/accountBoundary'
import type { GiftIdea } from '../../lib/api/giftIdeas'
import {
  GIFT_PREFS_KEY,
  GIFT_SAVED_KEY,
  SAVED_PER_PERSON,
  forgetIdeaFor,
  isSavedFor,
  personalizeEnabled,
  resetGiftStorageForTests,
  saveIdeaFor,
  savedFor,
  setPersonalize,
} from './storage'

// What "Geschenk finden" keeps on this device: the "Nicht personalisieren" choice and "Merken für Anna".
// Both name their account and count for nobody else; what is read back is checked like any answer.

const A = 'account-a'
const B = 'account-b'
const ANNA = { profileId: 'profile-anna', name: 'Anna Beispiel' }

const idea = (id: string, extra: Partial<GiftIdea> = {}): GiftIdea => ({
  id,
  title: `Idee ${id}`,
  image_url: '/api/gift-ideas/demo-art/grinder',
  price_min_cents: 1690,
  price_max_cents: 3900,
  offers: [{ shop: 'Markt', price_cents: 1690, url: 'https://markt.example/p/1', sponsored: false }],
  interests: ['coffee'],
  ...extra,
})

beforeEach(() => {
  window.localStorage.clear()
  resetGiftStorageForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  resetGiftStorageForTests()
})

describe('"Nicht personalisieren"', () => {
  it('forgets private-mode memory when an account ends, including a later sign-in to the same account', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    setPersonalize(A, false)
    saveIdeaFor(A, ANNA, idea('private-memory'))
    expect(personalizeEnabled(A)).toBe(false)
    expect(savedFor(A, ANNA.profileId)).toHaveLength(1)
    endAccountEpoch()
    expect(personalizeEnabled(B)).toBe(true)
    expect(savedFor(B, ANNA.profileId)).toEqual([])
    expect(personalizeEnabled(A)).toBe(true)
    expect(savedFor(A, ANNA.profileId)).toEqual([])
  })
  it('personalised by default; the choice is kept for this account on this device only', () => {
    expect(personalizeEnabled(A)).toBe(true)
    setPersonalize(A, false)
    expect(personalizeEnabled(A)).toBe(false)
    expect(personalizeEnabled(B)).toBe(true)
    const stored = JSON.parse(window.localStorage.getItem(GIFT_PREFS_KEY) ?? '{}') as Record<string, unknown>
    expect(stored).toEqual({ v: 1, owner: A, personalize: false })
  })
})

describe('"Merken für Anna"', () => {
  it('keeps ideas per person, newest first; saving again moves it to the top', () => {
    saveIdeaFor(A, ANNA, idea('a'), 1)
    saveIdeaFor(A, ANNA, idea('b'), 2)
    saveIdeaFor(A, ANNA, idea('a'), 3)
    expect(savedFor(A, ANNA.profileId).map((saved) => saved.id)).toEqual(['a', 'b'])
    expect(isSavedFor(A, ANNA.profileId, 'b')).toBe(true)
    forgetIdeaFor(A, ANNA.profileId, 'a')
    expect(savedFor(A, ANNA.profileId).map((saved) => saved.id)).toEqual(['b'])
  })

  it('"Rückgängig" after removing one puts it back at its old place (its old saved_at)', () => {
    saveIdeaFor(A, ANNA, idea('a'), 1)
    saveIdeaFor(A, ANNA, idea('b'), 2)
    saveIdeaFor(A, ANNA, idea('c'), 3)
    const removed = savedFor(A, ANNA.profileId)[1]!
    forgetIdeaFor(A, ANNA.profileId, removed.id)
    saveIdeaFor(A, ANNA, removed, removed.saved_at)
    expect(savedFor(A, ANNA.profileId).map((saved) => saved.id)).toEqual(['c', 'b', 'a'])
  })

  it('belongs to its account: another account on this device sees nothing', () => {
    saveIdeaFor(A, ANNA, idea('a'))
    expect(savedFor(B, ANNA.profileId)).toEqual([])
  })

  it('stores only the idea and the name shown in the app — nothing about the list or reservations', () => {
    saveIdeaFor(A, ANNA, idea('a'), 7)
    const raw = window.localStorage.getItem(GIFT_SAVED_KEY) ?? ''
    expect(raw).not.toMatch(/reserv|wish_|occasion|list/i)
    expect(JSON.parse(raw)).toMatchObject({ v: 1, owner: A, people: { [ANNA.profileId]: { name: 'Anna Beispiel', items: [{ id: 'a', saved_at: 7 }] } } })
  })

  it('caps what it keeps per person', () => {
    for (let i = 0; i < SAVED_PER_PERSON + 5; i += 1) saveIdeaFor(A, ANNA, idea(`i${i}`), i)
    expect(savedFor(A, ANNA.profileId)).toHaveLength(SAVED_PER_PERSON)
    expect(savedFor(A, ANNA.profileId)[0]?.id).toBe(`i${SAVED_PER_PERSON + 4}`)
  })

  it('reads storage like any answer: broken or foreign pictures are cleaned, garbage is ignored', () => {
    window.localStorage.setItem(
      GIFT_SAVED_KEY,
      JSON.stringify({
        v: 1,
        owner: A,
        people: {
          [ANNA.profileId]: { name: 'Anna', items: [{ ...idea('a'), image_url: 'https://tracker.example/pixel.gif', saved_at: 1 }, { id: 'broken', saved_at: 2 }] },
          other: 'nonsense',
        },
      }),
    )
    resetGiftStorageForTests()
    const kept = savedFor(A, ANNA.profileId)
    expect(kept.map((saved) => saved.id)).toEqual(['a'])
    expect(kept[0]?.image_url).toBeNull()
    window.localStorage.setItem(GIFT_SAVED_KEY, '{not json')
    resetGiftStorageForTests()
    expect(savedFor(A, ANNA.profileId)).toEqual([])
  })

  it('keys live under the app prefix, so signing out clears them (lib/query.ts clearLocalState)', () => {
    expect(GIFT_PREFS_KEY.startsWith('bunprise.')).toBe(true)
    expect(GIFT_SAVED_KEY.startsWith('bunprise.')).toBe(true)
  })
})
