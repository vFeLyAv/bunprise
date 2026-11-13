import { describe, expect, it } from 'vitest'
import type { GiftIdea, GiftIdeasPage } from '../../lib/api/giftIdeas'
import {
  DECK_CAP,
  DECK_HARD_CAP,
  MORE_LIKE_MAX,
  cardsFromTop,
  deckAppended,
  deckBusy,
  deckFailed,
  deckFinished,
  deckIds,
  deckLoaded,
  deckPosition,
  deckSimilarInserted,
  deckSwiped,
  deckUndone,
  likedIdeas,
  loadingDeck,
  topCard,
  wantsNextPage,
} from './deckState'

// The finite deck (brief 4.4: "на сегодня всё"): verdicts, undo, paging up to the cap, "Mehr wie das".

function idea(n: number): GiftIdea {
  return {
    id: `idea-${n}`,
    title: `Idee ${n}`,
    image_url: null,
    price_min_cents: 1000,
    price_max_cents: 2000,
    offers: [{ shop: 'Markt', price_cents: 1000, url: 'https://markt.example/p/1', sponsored: false }],
    interests: ['coffee'],
  }
}

const page = (from: number, count: number, cursor: string | null = 'more'): GiftIdeasPage => ({
  items: Array.from({ length: count }, (_, i) => idea(from + i)),
  next_cursor: cursor,
  as_of: '2026-10-20T12:00:00.000Z',
})

describe('loading and paging', () => {
  it('a fresh deck shows its first card; it is not finished while cards are left', () => {
    const deck = deckLoaded(page(1, 6), 'server', 3)
    expect(deck.status).toBe('ready')
    expect(topCard(deck)?.id).toBe('idea-1')
    expect(cardsFromTop(deck).map((card) => card.id)).toEqual(['idea-1', 'idea-2', 'idea-3'])
    // a next page may still come: no total yet (no "1 von 6" that later jumps to "6 von 12")
    expect(deckPosition(deck)).toEqual({ at: 1, of: null })
    expect(deckFinished(deck)).toBe(false)
    expect(deck.loadSeq).toBe(3)
    expect(topCard(loadingDeck())).toBeNull()
  })

  it('asks for the next page only when few cards are left, and never past the cap', () => {
    let deck = deckLoaded(page(1, 6), 'server')
    expect(wantsNextPage(deck)).toBe(false)
    for (let i = 0; i < 4; i += 1) deck = deckSwiped(deck, 'skip')
    expect(wantsNextPage(deck)).toBe(true)
    deck = deckAppended(deck, page(7, 10))
    expect(deck.cards).toHaveLength(DECK_CAP)
    expect(deck.cursor).toBeNull() // full: no more pages, ever
    expect(wantsNextPage(deck)).toBe(false)
  })

  it('a first page that already fills the deck has no cursor', () => {
    expect(deckLoaded(page(1, 30), 'server').cards).toHaveLength(DECK_CAP)
    expect(deckLoaded(page(1, 30), 'server').cursor).toBeNull()
  })

  it('a page that brings nothing new ends the deck (a provider repeating itself)', () => {
    const deck = deckAppended(deckLoaded(page(1, 3), 'server'), page(1, 3))
    expect(deck.cards).toHaveLength(3)
    expect(deck.cursor).toBeNull()
  })

  it('a failed first load is an error; a failed later page just ends the deck', () => {
    expect(deckFailed(loadingDeck(), 'offline')).toMatchObject({ status: 'error', error: 'offline' })
    const ready = deckFailed(deckLoaded(page(1, 3), 'server'), 'unavailable')
    expect(ready.status).toBe('ready')
    expect(ready.cursor).toBeNull()
  })
})

describe('verdicts, undo and the end of the day', () => {
  it('a swipe judges the top card and brings the next one up', () => {
    let deck = deckLoaded(page(1, 3, null), 'server')
    deck = deckSwiped(deck, 'like')
    expect(topCard(deck)?.id).toBe('idea-2')
    expect(deck.verdicts).toEqual({ 'idea-1': 'like' })
    deck = deckSwiped(deck, 'skip')
    expect(likedIdeas(deck).map((card) => card.id)).toEqual(['idea-1'])
    expect(deckPosition(deck)).toEqual({ at: 3, of: 3 })
  })

  it('the counter names a total only once the deck is complete', () => {
    let deck = deckLoaded(page(1, 6), 'server')
    deck = deckSwiped(deckSwiped(deckSwiped(deckSwiped(deck, 'skip'), 'skip'), 'skip'), 'skip')
    expect(deckPosition(deck)).toEqual({ at: 5, of: null })
    deck = deckAppended(deckBusy(deck), page(7, 6))
    // the cap is reached: nothing more comes, so now the total is true
    expect(deck.cursor).toBeNull()
    expect(deckPosition(deck)).toEqual({ at: 5, of: 12 })
  })

  it('"Für heute war’s das" once every card has its verdict and nothing more comes', () => {
    let deck = deckLoaded(page(1, 2, null), 'server')
    deck = deckSwiped(deckSwiped(deck, 'skip'), 'like')
    expect(deckFinished(deck)).toBe(true)
    expect(topCard(deck)).toBeNull()
    // a swipe on a finished deck changes nothing
    expect(deckSwiped(deck, 'like')).toBe(deck)
  })

  it('not finished while a next page may still come', () => {
    let deck = deckLoaded(page(1, 2, 'more'), 'server')
    deck = deckSwiped(deckSwiped(deck, 'skip'), 'skip')
    expect(deckFinished(deck)).toBe(false)
  })

  it('undo brings the last judged card back on top, without its verdict', () => {
    let deck = deckSwiped(deckLoaded(page(1, 3, null), 'server'), 'like')
    const undone = deckUndone(deck)
    expect(undone.card?.id).toBe('idea-1')
    expect(undone.verdict).toBe('like')
    deck = undone.state
    expect(topCard(deck)?.id).toBe('idea-1')
    expect(deck.verdicts).toEqual({})
    // nothing to undo at the start
    expect(deckUndone(deck).card).toBeNull()
  })
})

describe('"Mehr wie das"', () => {
  it('puts at most three new similar cards right behind the current one', () => {
    const deck = deckLoaded(page(1, 4, null), 'server')
    const more = deckSimilarInserted(deck, [idea(1), idea(50), idea(51), idea(52), idea(53)])
    expect(more.cards.map((card) => card.id)).toEqual(['idea-1', 'idea-50', 'idea-51', 'idea-52', 'idea-2', 'idea-3', 'idea-4'])
    expect(more.similar).toEqual(['idea-50', 'idea-51', 'idea-52'])
    expect(more.similar).toHaveLength(MORE_LIKE_MAX)
  })

  it('never grows the deck past its hard cap, and leaves out what it already has', () => {
    let deck = deckLoaded(page(1, 12, null), 'server')
    for (let i = 0; i < 5; i += 1) deck = deckSimilarInserted(deck, [idea(100 + i * 3), idea(101 + i * 3), idea(102 + i * 3)])
    expect(deck.cards.length).toBe(DECK_HARD_CAP)
    expect(new Set(deckIds(deck)).size).toBe(DECK_HARD_CAP)
  })
})
