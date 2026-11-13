import type { GiftIdea, GiftIdeasErrorCode, GiftIdeasPage, GiftTopicCount } from '../../lib/api/giftIdeas'

// The finite deck of "Geschenk finden" (brief 4.4: "Лента конечная — «на сегодня всё»"). Pure state
// transitions; the hook (useGiftDeck.ts) does the requests, the screen draws it.
// - A deck holds at most DECK_CAP cards from the pages it asks for; "Mehr wie das" may put up to three
//   similar ones right behind the current card (at most DECK_HARD_CAP cards in all). Then: "Für heute
//   war's das".
// - Swipe right = like, left = skip; one step back (undo) is possible.

export const DECK_CAP = 12
export const DECK_HARD_CAP = 20
/** "Mehr wie das" adds at most this many cards per tap */
export const MORE_LIKE_MAX = 3
/** the next page is asked for when this many cards are left */
export const PREFETCH_REMAINING = 2

export type Verdict = 'like' | 'skip'
export type DeckStatus = 'loading' | 'ready' | 'error'
/** where the ideas came from: our Worker (the demo server in the demo) or the demo catalogue on this device */
export type DeckOrigin = 'server' | 'device'

export interface DeckState {
  status: DeckStatus
  cards: GiftIdea[]
  /** index of the card on top */
  index: number
  verdicts: Readonly<Record<string, Verdict>>
  /** the order of the verdicts (undo takes the last one back) */
  history: readonly string[]
  cursor: string | null
  /** a next page or "Mehr wie das" is on its way */
  busy: boolean
  error: GiftIdeasErrorCode | null
  asOf: string | null
  origin: DeckOrigin
  /** ids the last "Mehr wie das" added (the screen marks them) */
  similar: readonly string[]
  /** which load of this visit filled it (0 = not loaded): Pompon cheers only for a deck that arrived while
   *  the screen was open, not for one kept from earlier */
  loadSeq: number
  /** the shelves of "Stöbern nach Thema" the first page named (none from the demo on the device) */
  topics: readonly GiftTopicCount[]
}

export function loadingDeck(): DeckState {
  return { status: 'loading', cards: [], index: 0, verdicts: {}, history: [], cursor: null, busy: false, error: null, asOf: null, origin: 'server', similar: [], loadSeq: 0, topics: [] }
}

function append(cards: readonly GiftIdea[], items: readonly GiftIdea[], cap: number): GiftIdea[] {
  const seen = new Set(cards.map((card) => card.id))
  const out = [...cards]
  for (const item of items) {
    if (out.length >= cap) break
    if (!seen.has(item.id)) {
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/** The first page arrived. */
export function deckLoaded(page: GiftIdeasPage, origin: DeckOrigin, loadSeq = 1): DeckState {
  const cards = append([], page.items, DECK_CAP)
  return {
    ...loadingDeck(),
    status: 'ready',
    cards,
    cursor: cards.length >= DECK_CAP ? null : page.next_cursor,
    asOf: page.as_of,
    origin,
    loadSeq,
    topics: page.topics ?? [],
  }
}

/** A next page arrived (up to the cap; past the cap the deck is complete). */
export function deckAppended(state: DeckState, page: GiftIdeasPage): DeckState {
  const cards = append(state.cards, page.items, Math.max(DECK_CAP, state.cards.length))
  const full = cards.length >= DECK_CAP
  // a page that brings nothing new ends the deck too (a provider that repeats itself)
  const stalled = cards.length === state.cards.length
  return { ...state, cards, busy: false, cursor: full || stalled ? null : page.next_cursor, asOf: page.as_of ?? state.asOf }
}

export function deckFailed(state: DeckState, code: GiftIdeasErrorCode): DeckState {
  // a failed first load is an error screen; a failed next page just ends the deck where it is
  if (state.status !== 'ready') return { ...state, status: 'error', error: code, busy: false }
  return { ...state, busy: false, cursor: null }
}

export function topCard(state: DeckState): GiftIdea | null {
  return state.status === 'ready' ? (state.cards[state.index] ?? null) : null
}

/** The cards from the top down (the screen draws the first three). */
export function cardsFromTop(state: DeckState, count = 3): GiftIdea[] {
  return state.status === 'ready' ? state.cards.slice(state.index, state.index + count) : []
}

export function remaining(state: DeckState): number {
  return Math.max(0, state.cards.length - state.index)
}

/** Every card has its verdict and no more are coming: "Für heute war's das". */
export function deckFinished(state: DeckState): boolean {
  return state.status === 'ready' && state.index >= state.cards.length && !state.busy && state.cursor === null
}

/** Time to ask for the next page (a few cards left, below the cap, nothing on its way). */
export function wantsNextPage(state: DeckState): boolean {
  return state.status === 'ready' && !state.busy && state.cursor !== null && state.cards.length < DECK_CAP && remaining(state) <= PREFETCH_REMAINING
}

export function deckBusy(state: DeckState, busy = true): DeckState {
  return { ...state, busy }
}

/** The top card gets its verdict; the next one comes up. */
export function deckSwiped(state: DeckState, verdict: Verdict): DeckState {
  const card = topCard(state)
  if (!card) return state
  return {
    ...state,
    index: state.index + 1,
    verdicts: { ...state.verdicts, [card.id]: verdict },
    history: [...state.history, card.id],
    similar: state.similar.filter((id) => id !== card.id),
  }
}

/** One step back: the last judged card is on top again, without its verdict. */
export function deckUndone(state: DeckState): { state: DeckState; card: GiftIdea | null; verdict: Verdict | null } {
  const last = state.history[state.history.length - 1]
  if (state.status !== 'ready' || last === undefined || state.index === 0) return { state, card: null, verdict: null }
  const card = state.cards[state.index - 1] ?? null
  if (!card || card.id !== last) return { state, card: null, verdict: null }
  const verdicts = { ...state.verdicts }
  const verdict = verdicts[last] ?? null
  delete verdicts[last]
  return { state: { ...state, index: state.index - 1, verdicts, history: state.history.slice(0, -1) }, card, verdict }
}

/** "Mehr wie das": up to three new similar cards right behind the current one. */
export function deckSimilarInserted(state: DeckState, items: readonly GiftIdea[]): DeckState {
  if (state.status !== 'ready') return state
  const known = new Set(state.cards.map((card) => card.id))
  const room = Math.max(0, DECK_HARD_CAP - state.cards.length)
  const fresh = items.filter((item) => !known.has(item.id)).slice(0, Math.min(MORE_LIKE_MAX, room))
  if (fresh.length === 0) return { ...state, busy: false }
  const at = Math.min(state.cards.length, state.index + 1)
  const cards = [...state.cards.slice(0, at), ...fresh, ...state.cards.slice(at)]
  return { ...state, cards, busy: false, similar: fresh.map((item) => item.id) }
}

export function likedIdeas(state: DeckState): GiftIdea[] {
  return state.cards.filter((card) => state.verdicts[card.id] === 'like')
}

/** Ids a next request must leave out: every card of this deck (judged or still waiting). */
export function deckIds(state: DeckState): string[] {
  return state.cards.map((card) => card.id)
}

/**
 * 1-based position of the top card and the deck's size, for "3 von 8". The size only once it is known: while
 * a next page may still come it is null ("Idee 3") — "5 von 6" would jump to "6 von 12" and make the deck look
 * almost done when it is not.
 */
export function deckPosition(state: DeckState): { at: number; of: number | null } {
  return { at: Math.min(state.cards.length, state.index + 1), of: state.cursor === null ? state.cards.length : null }
}
