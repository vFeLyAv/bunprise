import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { demoArtId, type GiftIdea, type GiftIdeasMode, type GiftInterest, type GiftStyle } from '../../lib/api/giftIdeas'
import { toast } from '../../lib/toast'
import { Button, IconForward, IconX, Skeleton, haptic, useBunniesShown, useReducedMotionPref } from '../../ui'
import { IconHeart } from '../wishes/icons'
import { BunnyPeek, type BunnyMood } from '../wishes/BunnyPeek'
import { BUDGET_PRESETS, DEFAULT_BUDGET, suggestBudget } from './budget'
import { BudgetSheet } from './BudgetSheet'
import { CardStack, DeckControls, DeckMessage, DeckSkeleton, type SwipeDirection } from './Deck'
import { cardsFromTop, deckFinished, deckPosition, likedIdeas, topCard } from './deckState'
import { IconBookmark, IconUndo } from './icons'
import { ExplainSheet, InterestSheet } from './InterestSheets'
import { inferInterests } from './interests'
import { inferStyles } from './styles'
import { hasSeenSwipeHint, markSwipeHintSeen } from './swipeHint'
import { firstName } from './labels'
import { OffersSheet } from './OffersSheet'
import {
  choicesFor,
  effectiveInterests,
  forgetLiked,
  likedForMe,
  rememberAddedToList,
  rememberChoices,
  rememberLiked,
  wasAddedToList,
  type RecipientChoices,
} from './session'
import { ShelfSheet } from './ShelfSheet'
import type { LoadedList } from './sources'
import { keepStartInterests, readStartInterests } from './startInterests'
import { forgetIdeaFor, saveIdeaFor, setPersonalize, usePersonalize, useSavedFor } from './storage'
import { useDeckFit } from './useDeckFit'
import { currentLoadSeq, useGiftDeck } from './useGiftDeck'
import { WhyPanel } from './WhyPanel'
import './gifts.css'
import { playsInApp } from '../mascot-ui/inGallery'

// One recipient's ideas: "Warum diese Ideen?" (interests guessed on the device + budget + opt-out), Pompon,
// the finite deck and what was kept. Shared by both modes:
// - "Für jemanden": a like = "Merken für Anna" — kept ON THIS DEVICE (storage.ts), Anna never sees it;
// - "Für mich": a like is kept for this visit, and every card offers "Zu meiner Wunschliste" (the existing
//   wish form, prefilled — AddToWishlistSheet, a lazy chunk).
// Every late answer (deck, wish saved, "Mehr wie das") checks the account epoch before it shows anything.

const AddToWishlistSheet = lazy(() => import('./AddToWishlistSheet'))
const FreeWishes = lazy(() => import('./FreeWishes'))
const MoveMoment = lazy(() => import('../mascot-ui/MoveMoment'))
// "Stöbern nach Thema" (26.10): the row of topic tiles, its own chunk, only once a deck named its shelves
const TopicRow = lazy(() => import('./topics/TopicRow'))

/** The first-time swipe hint stays this long (the nudge takes ≈ 2 s of it), unless a swipe or a tap ends it. */
const SWIPE_HINT_MS = 6500

/** No taste directions (not personalised). */
const NO_STYLES: readonly GiftStyle[] = []

/** Pompon's "Gefunden!" stays this long (counted once the deck is in view) before the bubble makes room. */
const READY_BUBBLE_MS = 3600

/** For someone: the person and the list chosen above (its GiftListRef key — "Noch frei" shows only its wishes). */
export type Recipient = { kind: 'me'; key: 'me' } | { kind: 'person'; key: string; name: string; profileId: string | null; listKey: string }

export interface IdeasSectionProps {
  userId: string
  recipient: Recipient
  /** the recipient's lists (already loaded) */
  lists: readonly LoadedList[]
  /** false while a list is still on its way (Pompon sniffs, nothing is asked yet) */
  listsReady: boolean
}

export function IdeasSection({ userId, recipient, lists, listsReady }: IdeasSectionProps) {
  const { t } = useTranslation('gifts')
  const navigate = useNavigate()
  // the end of the deck: one of the two approved «Переел» variants, picked once per visit (Felix 24.10: "их можно
  // в разных моментах использовать") — a «Хватит», b «Последний кусочек»
  const [doneVariant] = useState<'a' | 'b'>(() => (Math.random() < 0.5 ? 'a' : 'b'))
  const mode: GiftIdeasMode = recipient.kind === 'me' ? 'for_me' : 'for_someone'
  const name = recipient.kind === 'person' ? firstName(recipient.name) : null
  // the list owner's profile id: known once the list is loaded (the people row may not know it yet)
  const profileId = recipient.kind === 'person' ? (lists[0]?.owner.profileId ?? recipient.profileId) : null

  const signals = useMemo(() => lists.flatMap((list) => list.wishes), [lists])
  const inferred = useMemo(() => inferInterests(signals), [signals])
  // the taste of the list (brands, telling words — styles.ts), read here; only a few direction ids are sent
  const tastes = useMemo(() => inferStyles(signals).map((style) => style.id), [signals])
  const suggested = useMemo(() => suggestBudget(signals.map((wish) => wish.priceCents)), [signals])
  const [choices, setChoicesState] = useState<RecipientChoices>(() => {
    const chosen = choicesFor(recipient.key)
    // "Für mich" starts with what the person put into the onboarding's wish box (device only, startInterests.ts),
    // as if added by hand — until this visit changed the interests itself
    if (recipient.kind !== 'me' || chosen.removed.length > 0 || chosen.added.length > 0) return chosen
    return { ...chosen, added: readStartInterests(userId) }
  })
  const personalize = usePersonalize(userId)
  const interests = personalize ? effectiveInterests(inferred.map((interest) => interest.id), choices) : []
  const budget = choices.budget ?? suggested ?? DEFAULT_BUDGET
  const styles = personalize ? tastes : NO_STYLES
  const deck = useGiftDeck({ userId, mode, recipientKey: recipient.key, interests, styles, budget, enabled: listsReady })
  const { state } = deck

  const [exit, setExit] = useState<SwipeDirection>(1)
  const deckSection = useRef<HTMLElement>(null)
  useDeckFit(deckSection)
  const reduced = useReducedMotionPref()
  const bunnies = useBunniesShown()
  // the deck is on screen (its top above the lower third): Pompon's "Gefunden!" is not spent below the fold
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const section = deckSection.current
    if (!section || typeof IntersectionObserver !== 'function') {
      setInView(true)
      return undefined
    }
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { rootMargin: '0px 0px -30% 0px' })
    observer.observe(section)
    return () => observer.disconnect()
  }, [])
  // the first-time swipe hint: 'wait' until it ran (it shows while the deck is ready and in view); seen before on
  // this device = 'done' from the start
  const [swipeHint, setSwipeHint] = useState<'wait' | 'done'>(() => (hasSeenSwipeHint() ? 'done' : 'wait'))
  const endSwipeHint = () => setSwipeHint('done')
  // the line stays in the row after its time to fade out (only on the visit that showed it)
  const [hadSwipeHint] = useState(swipeHint === 'wait')
  const [sheet, setSheet] = useState<null | 'budget' | 'interests' | 'explain' | 'shelf'>(null)
  // the idea of a sheet stays while the sheet slides away (its content must not vanish mid-exit)
  // (opened from the shelf: closing it goes back to the shelf)
  const [offers, setOffers] = useState<{ idea: GiftIdea | null; open: boolean; fromShelf: boolean }>({ idea: null, open: false, fromShelf: false })
  const [add, setAdd] = useState<{ idea: GiftIdea | null; open: boolean }>({ idea: null, open: false })
  const showOffers = (idea: GiftIdea, fromShelf = false) => setOffers({ idea, open: true, fromShelf })
  const hideOffers = () => {
    setOffers((now) => ({ ...now, open: false }))
    if (offers.fromShelf) setSheet('shelf')
  }
  const showAdd = (idea: GiftIdea) => setAdd({ idea, open: true })
  const hideAdd = () => setAdd((now) => ({ ...now, open: false }))
  const [announcement, setAnnouncement] = useState('')
  const [likedMe, setLikedMe] = useState<readonly GiftIdea[]>(() => likedForMe())
  const [, setAddedTick] = useState(0)
  const saved = useSavedFor(userId, profileId)

  function setChoices(next: RecipientChoices) {
    rememberChoices(recipient.key, next)
    setChoicesState(next)
    // a wish-box pick the person took away here stays away on the next visit too
    if (recipient.kind === 'me') keepStartInterests(userId, effectiveInterests(inferred.map((interest) => interest.id), next))
  }

  // ---- Pompon: sniffs while the ideas load, cheers once when a deck arrives while the screen is open ----
  // (a deck kept from earlier in this visit is no news: he just sits there)
  const [openedAt] = useState(() => currentLoadSeq())
  const [quietSeq, setQuietSeq] = useState(0)
  const arrived = state.status === 'ready' && state.cards.length > 0 && state.loadSeq > openedAt
  // "Weniger": the line is a calm hint that stays until the first verdict (no timer, nothing goes by itself)
  const cheer = arrived && state.history.length === 0 && (reduced || quietSeq !== state.loadSeq)
  useEffect(() => {
    if (!arrived || !inView || reduced) return undefined
    const seq = state.loadSeq
    const timer = setTimeout(() => setQuietSeq(seq), READY_BUBBLE_MS)
    return () => clearTimeout(timer)
  }, [arrived, inView, reduced, state.loadSeq])
  // the screen reader hears what Pompon shows: "8 Ideen gefunden", then each verdict
  const live = announcement || (arrived && state.history.length === 0 ? t('gifts.announce_ready', { count: state.cards.length }) : '')

  const loading = !listsReady || state.status === 'loading'
  const finished = deckFinished(state)
  const empty = state.status === 'ready' && state.cards.length === 0
  // the swipe hint runs while a deck is ready and in view, until a swipe, a tap or its time ends it
  const hintOn = swipeHint === 'wait' && !loading && state.status === 'ready' && !finished && !empty && inView
  const mood: BunnyMood = loading ? 'sniff' : cheer ? 'joy' : finished ? 'hello' : 'calm'
  const says = loading
    ? t('gifts.bunny_sniff')
    : state.status === 'error'
      ? t('gifts.bunny_error')
      : empty
        ? t('gifts.bunny_empty')
        : finished
          ? t('gifts.bunny_done')
          : cheer
            ? t('gifts.bunny_ready')
            : null
  // Pompon's "Gefunden!" goes by itself: a copy of this screen leaves it out (it is gone when the tab comes back)
  const readyLine = cheer ? t('gifts.bunny_ready') : null

  // ---- verdicts ----
  function judge(direction: SwipeDirection) {
    setExit(direction)
    endSwipeHint()
    const card = deck.judge(direction === 1 ? 'like' : 'skip')
    if (!card) return
    if (direction === -1) {
      haptic('tap')
      setAnnouncement(nextLine(t('gifts.announce_skip', { title: card.title })))
      return
    }
    haptic('success')
    if (recipient.kind === 'person' && profileId) {
      saveIdeaFor(userId, { profileId, name: recipient.name }, card)
      setAnnouncement(nextLine(t('gifts.announce_saved', { name, title: card.title })))
    } else {
      rememberLiked(card)
      setLikedMe(likedForMe())
      setAnnouncement(nextLine(t('gifts.announce_like', { title: card.title })))
    }
  }

  /** "…, nächste Idee: …" for screen readers (read once, after the verdict). */
  function nextLine(first: string): string {
    const next = topCardAfter()
    return next ? `${first}. ${t('gifts.announce_next', { title: next.title })}` : first
  }

  function topCardAfter(): GiftIdea | null {
    const cards = cardsFromTop(state, 2)
    return cards[1] ?? null
  }

  function undo() {
    const { card, verdict } = deck.undo()
    if (!card) return
    haptic('tap')
    if (verdict === 'like') {
      if (recipient.kind === 'person' && profileId) forgetIdeaFor(userId, profileId, card.id)
      else {
        forgetLiked(card.id)
        setLikedMe(likedForMe())
      }
    }
    setAnnouncement(t('gifts.announce_undo', { title: card.title }))
  }

  async function moreLike(card: GiftIdea) {
    const epoch = captureEpoch()
    const count = await deck.moreLike(card)
    if (!epoch.isCurrent()) return
    if (count > 0) haptic('success')
    toast.info(count > 0 ? t('gifts.more_like_added', { count }) : t('gifts.more_like_none'))
  }

  function onAdded(idea: GiftIdea, result: { title: string; occasionId: string | null; listId: string }) {
    rememberAddedToList(idea.id)
    setAddedTick((n) => n + 1)
    hideAdd()
    haptic('success')
    // the card it came from flies on, liked
    if (topCard(state)?.id === idea.id) judge(1)
    const { occasionId, listId } = result
    toast.success(t('gifts.added_toast', { title: result.title }), {
      actionLabel: t('gifts.added_view'),
      onAction: () =>
        void (occasionId ? navigate({ to: '/occasions/$occasionId', params: { occasionId } }) : navigate({ to: '/lists/$listId', params: { listId } })),
    })
  }

  // ---- the shelf ----
  // Removing a kept idea can be taken back while the shelf is open (it lives only on this device: a slip would
  // lose it): the sheet keeps a "Rückgängig" row at its place (ShelfSheet).
  const [shelfRemoved, setShelfRemoved] = useState<{ idea: GiftIdea; at: number } | null>(null)
  function removeFromShelf(idea: GiftIdea) {
    const at = Math.max(0, shelfIdeas.findIndex((known) => known.id === idea.id))
    if (recipient.kind === 'person' && profileId) forgetIdeaFor(userId, profileId, idea.id)
    else {
      forgetLiked(idea.id)
      setLikedMe(likedForMe())
    }
    setShelfRemoved({ idea, at })
  }
  function undoShelfRemove() {
    if (!shelfRemoved) return
    const { idea, at } = shelfRemoved
    // a kept idea returns with its old time, so it lands at its old place
    const savedAt = 'saved_at' in idea && typeof idea.saved_at === 'number' ? idea.saved_at : undefined
    if (recipient.kind === 'person' && profileId) saveIdeaFor(userId, { profileId, name: recipient.name }, idea, savedAt)
    else {
      rememberLiked(idea, at)
      setLikedMe(likedForMe())
    }
    setShelfRemoved(null)
  }

  // ---- interests ----
  const activeInterests = interests
  function removeInterest(id: GiftInterest) {
    const guessed = inferred.some((interest) => interest.id === id)
    setChoices({
      ...choices,
      removed: guessed ? [...choices.removed.filter((known) => known !== id), id] : choices.removed,
      added: choices.added.filter((known) => known !== id),
    })
  }
  function toggleInterest(id: GiftInterest) {
    if (activeInterests.includes(id)) removeInterest(id)
    else
      setChoices({
        ...choices,
        removed: choices.removed.filter((known) => known !== id),
        added: inferred.some((interest) => interest.id === id) ? choices.added : [...choices.added, id],
      })
  }

  const shelfIdeas: readonly GiftIdea[] = recipient.kind === 'person' && profileId ? saved : likedMe
  const shelfTitle = recipient.kind === 'person' ? t('gifts.shelf_saved', { name }) : t('gifts.shelf_liked')
  const position = deckPosition(state)
  const likeLabel = name ? t('gifts.like_for', { name }) : t('gifts.like')
  const skipLabel = name ? t('gifts.skip_for', { name }) : t('gifts.skip')
  const canUndo = state.history.length > 0
  const demo = state.origin === 'device' || state.cards.some((card) => demoArtId(card.image_url) !== null)
  const likedHere = likedIdeas(state).length
  const addAction = mode === 'for_me' ? showAdd : undefined
  /** the sheet shows the deck's top card (opened from the card, not from the shelf): it can decide it */
  const isDeckTop = (idea: GiftIdea) => !offers.fromShelf && topCard(state)?.id === idea.id
  function decideInSheet(direction: SwipeDirection) {
    setOffers((now) => ({ ...now, open: false }))
    judge(direction)
  }

  let body
  if (loading) body = <DeckSkeleton label={t('gifts.loading')} />
  else if (state.status === 'error') {
    body = (
      <DeckMessage title={t('gifts.error_title')} text={state.error === 'offline' ? t('gifts.error_offline') : state.error === 'rate_limited' ? t('gifts.error_rate_limited') : t('gifts.error_generic')}>
        <Button variant="primary" size="lg" fullWidth onClick={deck.retry}>
          {t('gifts.retry')}
        </Button>
      </DeckMessage>
    )
  } else if (empty) {
    body = (
      <DeckMessage title={t('gifts.empty_title')} text={t('gifts.empty_text')}>
        <Button variant="secondary" size="lg" fullWidth onClick={() => setChoices({ ...choices, budget: BUDGET_PRESETS[BUDGET_PRESETS.length - 1]?.budget ?? null })}>
          {t('gifts.empty_any_budget')}
        </Button>
      </DeckMessage>
    )
  } else if (finished) {
    const summary =
      likedHere === 0 ? t('gifts.done_none') : recipient.kind === 'person' ? t('gifts.done_saved', { count: likedHere, name }) : t('gifts.done_liked', { count: likedHere })
    body = (
      <DeckMessage title={t('gifts.done_title')} text={`${summary} ${t('gifts.done_text')}`} picture={bunnies && playsInApp('overfed', doneVariant) ? <Suspense fallback={null}><MoveMoment kind="overfed" variant={doneVariant} illustration momentClass="response" className="h-full w-full" /></Suspense> : null}>
        {shelfIdeas.length > 0 ? (
          <Button variant="primary" size="lg" fullWidth onClick={() => setSheet('shelf')}>
            {`${shelfTitle} · ${shelfIdeas.length}`}
          </Button>
        ) : null}
        {/* the last verdict can be taken back too (the round undo button left with the deck) */}
        {canUndo ? (
          <Button variant="ghost" size="md" fullWidth icon={<IconUndo size={20} />} onClick={undo}>
            {t('gifts.undo_label')}
          </Button>
        ) : null}
      </DeckMessage>
    )
  } else {
    body = (
      <CardStack
        nudge={hintOn}
        cards={cardsFromTop(state, 3)}
        position={position}
        likeStamp={recipient.kind === 'person' ? t('gifts.stamp_saved') : t('gifts.stamp_like')}
        skipStamp={name ? skipLabel : t('gifts.stamp_skip')}
        hint={name ? t('gifts.card_hint_for', { name }) : t('gifts.card_hint')}
        newIds={state.similar}
        moreBusy={state.busy}
        exitDirection={exit}
        onSwipe={judge}
        onMoreLike={(idea) => void moreLike(idea)}
        onOffers={showOffers}
        {...(addAction ? { onAddToList: addAction, isAddedToList: (idea: GiftIdea) => wasAddedToList(idea.id) } : {})}
      />
    )
  }

  const showControls = !loading && state.status === 'ready' && !finished && !empty

  // ---- the first-time swipe hint (Felix 27.10): once on this device, when the deck is in view ----
  useEffect(() => {
    if (!hintOn) return undefined
    markSwipeHintSeen()
    const timer = setTimeout(() => setSwipeHint('done'), SWIPE_HINT_MS)
    return () => clearTimeout(timer)
  }, [hintOn])
  const hintLine = hadSwipeHint ? { text: t('gifts.swipe_hint', { skip: skipLabel, like: likeLabel }), shown: hintOn } : null

  return (
    <>
      {mode === 'for_someone' && profileId && profileId !== userId && recipient.kind === 'person' ? <Suspense fallback={null}>
        <FreeWishes
          userId={userId}
          profileId={profileId}
          name={name ?? ''}
          listKey={recipient.listKey}
          maxCents={budget.max_cents}
          onAnyBudget={() => setChoices({ ...choices, budget: BUDGET_PRESETS[BUDGET_PRESETS.length - 1]?.budget ?? null })}
        />
      </Suspense> : null}
      {/* the deck first: the ideas are the screen; why they are these ideas follows right below */}
      <section ref={deckSection} aria-label={t('gifts.deck_label')} className="flex flex-col" data-gift-mode={mode} onPointerDownCapture={endSwipeHint}>
        {/* Pompon peeks over the deck: his feet are behind the card's top edge — also over an empty deck ("Hmm, dazu
            finde ich gerade nichts"); the end of the day has its own picture. "Weniger": his line as calm text in
            a place of its own (no overlap with the card, no jump when it goes). */}
        {!finished || empty ? (
          reduced && bunnies ? (
            <div className="mb-2 flex min-h-10 items-end px-5">
              <BunnyPeek mood={mood} says={says} />
            </div>
          ) : (
            <BunnyPeek mood={mood} says={says} momentary={says !== null && says === readyLine} joyScene="surprise" className="relative z-0 -mb-3 pl-5" />
          )
        ) : null}
        <div data-deck-slot="" className="relative z-1">
          {body}
        </div>
        {showControls ? (
          <DeckControls position={position} likeLabel={likeLabel} skipLabel={skipLabel} onLike={() => judge(1)} onSkip={() => judge(-1)} onUndo={undo} canUndo={canUndo} hint={hintLine} />
        ) : null}
        {state.origin === 'device' && !loading ? <p className="mt-3 px-4 text-center t-footnote text-text-2">{t('gifts.device_note')}</p> : null}
        <p role="status" aria-live="polite" className="sr-only">
          {live}
        </p>
      </section>

      {/* "Stöbern nach Thema": below the deck's buttons — the deck stays the main way, the shelves are for browsing */}
      {state.status === 'ready' && state.topics.length > 0 ? (
        <Suspense fallback={null}>
          <TopicRow
            topics={state.topics}
            recipient={recipient.kind === 'person' && profileId ? { kind: 'person', profileId, name: recipient.name } : { kind: 'me' }}
          />
        </Suspense>
      ) : null}

      {listsReady ? (
        <WhyPanel
          interests={interests}
          personalize={personalize}
          budget={budget}
          onInterests={() => setSheet('interests')}
          onBudget={() => setSheet('budget')}
          onPersonalize={(on) => setPersonalize(userId, on)}
          onExplain={() => setSheet('explain')}
        />
      ) : (
        // the list is still on its way: nothing to say about it yet (no "nothing found" while loading)
        <div aria-hidden="true" className="flex flex-col gap-3 rounded-(--r-card) p-4 glass-panel">
          <Skeleton height={20} width="45%" />
          <Skeleton height={14} width="70%" />
          <div className="flex gap-2">
            <Skeleton height={36} width={110} rounded="full" />
            <Skeleton height={36} width={96} rounded="full" />
          </div>
        </div>
      )}

      {shelfIdeas.length > 0 && !finished ? (
        <button
          type="button"
          className="flex min-h-14 items-center gap-3 rounded-lg px-4 text-left glass-panel tr-colors active:bg-fill"
          aria-label={t('gifts.shelf_open', { label: shelfTitle, count: shelfIdeas.length })}
          onPointerDown={() => haptic('tap')}
          onClick={() => setSheet('shelf')}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-text">
            <IconBookmark size={18} />
          </span>
          <span className="t-body font-semibold text-text">{shelfTitle}</span>
          <span className="ml-auto t-body tabular-nums text-text-2">{shelfIdeas.length}</span>
          <IconForward size={18} className="text-text-3" />
        </button>
      ) : null}

      <BudgetSheet open={sheet === 'budget'} budget={budget} suggested={suggested} onChange={(next) => setChoices({ ...choices, budget: next })} onClose={() => setSheet(null)} />
      <InterestSheet open={sheet === 'interests'} active={interests} onToggle={toggleInterest} onClose={() => setSheet(null)} />
      <ExplainSheet
        open={sheet === 'explain'}
        onClose={() => setSheet(null)}
        name={name}
        inferred={inferred.filter((interest) => interests.includes(interest.id))}
        personalize={personalize}
        onPersonalize={(on) => setPersonalize(userId, on)}
        demo={demo}
      />
      <ShelfSheet
        open={sheet === 'shelf'}
        onClose={() => {
          setSheet(null)
          setShelfRemoved(null)
        }}
        title={shelfTitle}
        note={recipient.kind === 'person' ? t('gifts.shelf_note_someone', { name }) : t('gifts.shelf_note_me')}
        ideas={shelfIdeas}
        onOpen={(idea) => {
          setSheet(null)
          showOffers(idea, true)
        }}
        onRemove={removeFromShelf}
        removed={shelfRemoved}
        onUndoRemove={undoShelfRemove}
        {...(addAction
          ? {
              onAddToList: (idea: GiftIdea) => {
                setSheet(null)
                showAdd(idea)
              },
            }
          : {})}
      />
      <OffersSheet
        idea={offers.idea}
        open={offers.open}
        onClose={hideOffers}
        asOf={state.asOf}
        action={
          offers.idea && ((addAction && !wasAddedToList(offers.idea.id)) || isDeckTop(offers.idea)) ? (
            <div className="flex flex-col gap-2">
              {addAction && !wasAddedToList(offers.idea.id) ? (
                <Button
                  size="lg"
                  fullWidth
                  onClick={() => {
                    const idea = offers.idea
                    // on to the wish form: not back to the shelf
                    setOffers((now) => ({ ...now, open: false, fromShelf: false }))
                    if (idea) showAdd(idea)
                  }}
                >
                  {t('gifts.add_to_list')}
                </Button>
              ) : null}
              {/* the deck's two decisions with one tap each (no swipe needed — WCAG 2.5.1): the card flies as if swiped.
                  For someone the save is the main action (the whole name fits), "Nicht für Anna" a quiet line below;
                  for me the wish form is the main action and the two short decisions share one quiet row. */}
              {isDeckTop(offers.idea) ? (
                addAction ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="ghost" size="md" fullWidth icon={<IconX size={18} />} onClick={() => decideInSheet(-1)}>
                      {skipLabel}
                    </Button>
                    <Button variant="ghost" size="md" fullWidth icon={<IconHeart size={18} />} onClick={() => decideInSheet(1)}>
                      {likeLabel}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button size="lg" fullWidth icon={<IconHeart size={20} />} onClick={() => decideInSheet(1)}>
                      {likeLabel}
                    </Button>
                    <Button variant="ghost" size="md" fullWidth icon={<IconX size={18} />} onClick={() => decideInSheet(-1)}>
                      {skipLabel}
                    </Button>
                  </>
                )
              ) : null}
            </div>
          ) : undefined
        }
      />
      {add.idea ? (
        <Suspense fallback={null}>
          <AddToWishlistSheet userId={userId} idea={add.idea} open={add.open} onClose={hideAdd} onAdded={onAdded} />
        </Suspense>
      ) : null}
    </>
  )
}
