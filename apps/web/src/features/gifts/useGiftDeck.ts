import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { captureEpoch, onAccountEnded } from '../../lib/accountBoundary'
import {
  buildGiftIdeasRequest,
  fetchGiftIdeas,
  GiftIdeasError,
  isAbortError,
  isGiftIdeasError,
  parseGiftIdeasPage,
  type GiftBudget,
  type GiftIdea,
  type GiftIdeasErrorCode,
  type GiftIdeasMode,
  type GiftIdeasPage,
  type GiftIdeasRequest,
  type GiftInterest,
  type GiftStyle,
} from '../../lib/api/giftIdeas'
import { currentLanguage } from '../../lib/i18n'
import {
  deckAppended,
  deckBusy,
  deckFailed,
  deckIds,
  deckLoaded,
  deckSimilarInserted,
  deckSwiped,
  deckUndone,
  loadingDeck,
  topCard,
  wantsNextPage,
  type DeckOrigin,
  type DeckState,
  type Verdict,
} from './deckState'

// The deck of one recipient + interests + budget, kept for this visit of the tab (memory only), so going
// to Start and back shows the same cards at the same place. Requests:
// - POST /api/gift-ideas through lib/api/giftIdeas.ts (our Worker; in the demo the MSW demo server),
//   pinned to the screen's account; every answer is applied only while that account is still the tab's
//   (captureEpoch, contract.md §5.5) — a late answer never lands in the next account's deck;
// - our Worker has no provider yet (404 / 501, `not_available`): the invented demo catalogue answers ON
//   THE DEVICE from then on (this visit) — the same contract and parser, no other server is asked;
// - what was judged (liked or skipped) for a recipient is left out of their next decks in this visit.

export interface DeckParams {
  userId: string
  mode: GiftIdeasMode
  /** whose deck: 'me' or the person's key — decks and verdicts are kept per recipient */
  recipientKey: string
  interests: readonly GiftInterest[]
  /** taste directions read on the device from the wishes (styles.ts); [] = none */
  styles: readonly GiftStyle[]
  budget: GiftBudget
  /** false while the list is still loading: nothing is asked yet */
  enabled: boolean
}

/** The on-device demo answers after a short pause, like the demo server (Pompon's sniff stays visible). */
const DEVICE_ANSWER_MS = 600

const decks = new Map<string, DeckState>()
const inflight = new Map<string, AbortController>()
const judged = new Map<string, Set<string>>()
const listeners = new Set<() => void>()
let deviceOnly = false
/** counts the loads of this visit (DeckState.loadSeq) */
let loadSeq = 0

/** The newest load so far: a screen remembers it when it opens; a deck loaded later is "new" for it. */
export function currentLoadSeq(): number {
  return loadSeq
}

function emit(): void {
  for (const listener of Array.from(listeners)) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setDeck(key: string, next: DeckState): void {
  decks.set(key, next)
  emit()
}

function judgedFor(recipientKey: string): Set<string> {
  let set = judged.get(recipientKey)
  if (!set) {
    set = new Set()
    judged.set(recipientKey, set)
  }
  return set
}

function forgetEverything(): void {
  for (const controller of inflight.values()) controller.abort()
  inflight.clear()
  decks.clear()
  judged.clear()
  deviceOnly = false
  emit()
}

onAccountEnded(forgetEverything)

/**
 * Back online: a deck that failed (offline, a timeout, a busy server) is forgotten, so it is asked for again —
 * the screen showing it right now asks at once (useGiftDeck's own 'online' listener, registered after this
 * one), the others when they are opened next. Without this the deck kept saying "Du bist offline" after the
 * network was back, until "Nochmal versuchen".
 */
export function forgetFailedDecks(): void {
  for (const [key, deck] of decks) if (deck.status === 'error') decks.delete(key)
}

if (typeof window !== 'undefined') window.addEventListener('online', forgetFailedDecks)

/** Tests only. */
export function resetGiftDecksForTests(): void {
  forgetEverything()
}

export function deckKey(params: Pick<DeckParams, 'userId' | 'mode' | 'recipientKey' | 'interests' | 'budget'> & { styles?: readonly GiftStyle[] }): string {
  // the UI language too: the cards' titles come in it, so a deck kept in one language is never shown in another
  return JSON.stringify([params.userId, params.mode, params.recipientKey, params.interests, params.budget.min_cents, params.budget.max_cents, params.styles ?? [], currentLanguage()])
}

function codeOf(err: unknown): GiftIdeasErrorCode {
  return err instanceof GiftIdeasError ? err.code : 'unavailable'
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }, { once: true })
  })
}

async function requestPage(request: GiftIdeasRequest, userId: string, signal: AbortSignal): Promise<{ page: GiftIdeasPage; origin: DeckOrigin }> {
  if (!deviceOnly) {
    try {
      return { page: await fetchGiftIdeas(request, { signal, expectedUserId: userId }), origin: 'server' }
    } catch (err) {
      if (!isGiftIdeasError(err, 'not_available')) throw err
      deviceOnly = true
    }
  }
  const [{ answerDemoGiftIdeas }] = await Promise.all([import('./demo/answer'), wait(DEVICE_ANSWER_MS, signal)])
  signal.throwIfAborted()
  const page = parseGiftIdeasPage(answerDemoGiftIdeas(request))
  if (!page) throw new GiftIdeasError('unavailable')
  return { page, origin: 'device' }
}

function baseRequest(params: DeckParams, excludeIds: readonly string[], interests: readonly GiftInterest[] = params.interests, cursor: string | null = null, styles: readonly GiftStyle[] = params.styles): GiftIdeasRequest {
  return buildGiftIdeasRequest({ mode: params.mode, interests, budget: params.budget, excludeIds, lang: currentLanguage(), cursor, styles })
}

function start(key: string, params: DeckParams): void {
  const epoch = captureEpoch()
  if (!epoch.isCurrent()) return
  inflight.get(key)?.abort()
  const controller = new AbortController()
  inflight.set(key, controller)
  setDeck(key, loadingDeck())
  const request = baseRequest(params, [...judgedFor(params.recipientKey)])
  requestPage(request, params.userId, controller.signal).then(
    ({ page, origin }) => {
      if (!epoch.isCurrent() || controller.signal.aborted) return
      loadSeq += 1
      setDeck(key, deckLoaded(page, origin, loadSeq))
    },
    (err: unknown) => {
      if (!epoch.isCurrent() || isAbortError(err) || controller.signal.aborted) return
      setDeck(key, deckFailed(decks.get(key) ?? loadingDeck(), codeOf(err)))
    },
  ).finally(() => {
    if (inflight.get(key) === controller) inflight.delete(key)
  })
}

function nextPage(key: string, params: DeckParams): void {
  const state = decks.get(key)
  if (!state || !wantsNextPage(state)) return
  const epoch = captureEpoch()
  if (!epoch.isCurrent()) return
  const controller = new AbortController()
  inflight.set(`${key}#next`, controller)
  setDeck(key, deckBusy(state))
  const request = baseRequest(params, [...judgedFor(params.recipientKey), ...deckIds(state)], params.interests, state.cursor)
  requestPage(request, params.userId, controller.signal).then(
    ({ page }) => {
      const now = decks.get(key)
      if (!epoch.isCurrent() || !now) return
      setDeck(key, deckAppended(now, page))
    },
    (err: unknown) => {
      const now = decks.get(key)
      if (!epoch.isCurrent() || !now || isAbortError(err)) return
      setDeck(key, deckFailed(now, codeOf(err)))
    },
  ).finally(() => inflight.delete(`${key}#next`))
}

export interface GiftDeck {
  key: string
  state: DeckState
  /** the top card gets its verdict; returns it (the screen saves a like for a person) */
  judge: (verdict: Verdict) => GiftIdea | null
  /** one step back; returns the card and the verdict it had */
  undo: () => { card: GiftIdea | null; verdict: Verdict | null }
  /** "Mehr wie das": resolves with the number of cards put behind the current one */
  moreLike: (card: GiftIdea) => Promise<number>
  retry: () => void
}

export function useGiftDeck(params: DeckParams): GiftDeck {
  const key = deckKey(params)
  const snapshot = useCallback(() => decks.get(key) ?? null, [key])
  const stored = useSyncExternalStore(subscribe, snapshot, snapshot)
  const state = stored ?? loadingDeck()
  const { enabled } = params
  // the latest params for the callbacks and effects below (the key holds everything that decides a deck)
  const latest = useRef(params)
  useLayoutEffect(() => {
    latest.current = params
  })

  // a new key (recipient, interests or budget changed) asks once; a known key shows its kept deck
  useEffect(() => {
    if (enabled && !decks.has(key)) start(key, latest.current)
  }, [key, enabled])

  // back online: the deck on screen that failed asks again by itself (forgetFailedDecks dropped it just before)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined
    const again = () => {
      const now = decks.get(key)
      if (now && now.status !== 'error') return
      decks.delete(key)
      start(key, latest.current)
    }
    window.addEventListener('online', again)
    return () => window.removeEventListener('online', again)
  }, [key, enabled])

  // a few cards left: the next page (up to the deck's cap)
  useEffect(() => {
    if (enabled && stored && wantsNextPage(stored)) nextPage(key, latest.current)
  }, [stored, key, enabled])

  const judge = useCallback(
    (verdict: Verdict) => {
      const now = decks.get(key)
      const card = now ? topCard(now) : null
      if (!now || !card) return null
      judgedFor(latest.current.recipientKey).add(card.id)
      setDeck(key, deckSwiped(now, verdict))
      return card
    },
    [key],
  )

  const undo = useCallback(() => {
    const now = decks.get(key)
    if (!now) return { card: null, verdict: null }
    const result = deckUndone(now)
    if (!result.card) return { card: null, verdict: null }
    judgedFor(latest.current.recipientKey).delete(result.card.id)
    setDeck(key, result.state)
    return { card: result.card, verdict: result.verdict }
  }, [key])

  const moreLike = useCallback(
    async (card: GiftIdea) => {
      const now = decks.get(key)
      if (!now || now.busy) return 0
      const epoch = captureEpoch()
      if (!epoch.isCurrent()) return 0
      const params = latest.current
      const controller = new AbortController()
      inflight.set(`${key}#more`, controller)
      setDeck(key, deckBusy(now))
      const interests = card.interests.length > 0 ? card.interests.slice(0, 2) : params.interests
      try {
        const { page } = await requestPage(baseRequest(params, [...judgedFor(params.recipientKey), ...deckIds(now)], interests, null, []), params.userId, controller.signal)
        const after = decks.get(key)
        if (!epoch.isCurrent() || !after) return 0
        const next = deckSimilarInserted(after, page.items)
        setDeck(key, next)
        return next.cards.length - after.cards.length
      } catch (err) {
        const after = decks.get(key)
        if (epoch.isCurrent() && after && !isAbortError(err)) setDeck(key, deckBusy(after, false))
        return 0
      } finally {
        inflight.delete(`${key}#more`)
      }
    },
    [key],
  )

  const retry = useCallback(() => {
    decks.delete(key)
    start(key, latest.current)
  }, [key])

  return { key, state, judge, undo, moreLike, retry }
}
