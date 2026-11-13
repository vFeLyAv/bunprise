import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, animate, useIsPresent, useMotionValue, useTransform, type PanInfo } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { GiftIdea } from '../../lib/api/giftIdeas'
import { springs } from '../../motion/springs'
import { IconX, cn, fade, haptic, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { IconHeart } from '../wishes/icons'
import { IdeaCard } from './IdeaCard'
import { IconUndo } from './icons'
import './gifts.css'

// The deck (Felix: "крутить пальцем"): the top card follows the finger and tilts; past the line a light tick
// (haptic 'select') says "letting go decides"; let go → it flies off with the finger's speed (the smooth
// spring), or springs back (the snappy spring). The two cards behind peek out and step up.
// - Right = "Gefällt mir" (for someone: "Merken für Anna"), left = "Nicht für mich" (for someone: "Nicht für
//   Anna") — the stamps on the card say it while it is pulled.
// - The same without a finger (Felix 26.10: no round buttons under the deck): ← / → on the focused card, the two
//   decisions in the card's "Wo erhältlich" sheet, and focus-only buttons for keyboards / screen readers.
// - Motion level: reduced → no tilt, no flight (the card fades); off → instant. The finger still drags
//   (a direct manipulation, not an animation).

/** Past this share of the card's width (or faster than SWIPE_VELOCITY px/s) letting go decides. */
const SWIPE_RATIO = 0.3
const SWIPE_VELOCITY = 520
/** How far a decided card flies (px) */
const FLY_X = 560

export type SwipeDirection = 1 | -1

export interface DeckCardHandlers {
  onAddToList?: (idea: GiftIdea) => void
  isAddedToList?: (idea: GiftIdea) => boolean
  onMoreLike: (idea: GiftIdea) => void
  onOffers: (idea: GiftIdea) => void
}

/** "3 von 8"; `of` is null while a next page may still come (the total is not known yet: "Idee 3") */
export interface DeckPosition {
  at: number
  of: number | null
}

export interface CardStackProps extends DeckCardHandlers {
  /** the top card first (at most three are drawn) */
  cards: readonly GiftIdea[]
  position: DeckPosition
  likeStamp: string
  skipStamp: string
  /** what the two swipe directions mean, for screen readers (mode-aware, like the stamps) */
  hint: string
  newIds: readonly string[]
  moreBusy: boolean
  onSwipe: (direction: SwipeDirection) => void
  /** the direction the last card left in (AnimatePresence `custom`) */
  exitDirection: SwipeDirection
  /** the first-time swipe hint (27.10): the top card nudges left and right once, a little (never under reduced motion) */
  nudge?: boolean
}

const DEPTH_Y = [0, 10, 19] as const
const DEPTH_SCALE = [1, 0.955, 0.91] as const

function StackCard({
  idea,
  depth,
  props,
}: {
  idea: GiftIdea
  depth: number
  props: CardStackProps
}) {
  const { t } = useTranslation('gifts')
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  // a card on its way out keeps its last props: it is no longer the top card for anyone
  const present = useIsPresent()
  const top = depth === 0 && present
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-260, 0, 260], reduced ? [0, 0, 0] : [-11, 0, 11])
  const likeOpacity = useTransform(x, [18, 96], [0, 1])
  const skipOpacity = useTransform(x, [-96, -18], [1, 0])
  const ref = useRef<HTMLElement>(null)
  // the first-time hint: a small left-right nudge of the top card — the stamps peek in, nothing decides
  const nudge = top && props.nudge === true && !reduced
  useEffect(() => {
    if (!nudge) return undefined
    const run = animate(x, [0, -26, 22, 0], { duration: 1.6, delay: 0.6, ease: 'easeInOut', times: [0, 0.3, 0.7, 1] })
    return () => run.stop()
  }, [nudge, x])
  /** past the decision line during this drag (one tick per crossing) */
  const armed = useRef<SwipeDirection | 0>(0)

  function line(): number {
    return (ref.current?.offsetWidth ?? 340) * SWIPE_RATIO
  }

  function onDrag(_event: unknown, info: PanInfo) {
    const past: SwipeDirection | 0 = info.offset.x > line() ? 1 : info.offset.x < -line() ? -1 : 0
    if (past !== armed.current) {
      armed.current = past
      if (past !== 0) haptic('select')
    }
  }

  function onDragEnd(_event: unknown, info: PanInfo) {
    armed.current = 0
    const projected = info.offset.x + info.velocity.x * 0.12
    if (projected > line() || info.velocity.x > SWIPE_VELOCITY) props.onSwipe(1)
    else if (projected < -line() || info.velocity.x < -SWIPE_VELOCITY) props.onSwipe(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      props.onSwipe(1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      props.onSwipe(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      props.onOffers(idea)
    }
  }

  const at = props.position.at + depth
  const label = props.position.of === null ? t('gifts.card_label_open', { at, title: idea.title }) : t('gifts.card_label', { at, of: props.position.of, title: idea.title })
  const step = Math.min(depth, 2)
  return (
    <m.article
      ref={ref}
      className="gift-card"
      data-depth={depth}
      // the copy of the Ideen screen (features/nav/tabCopies.ts) shows the stack at rest, never mid-nudge or
      // mid-flight — the real deck that comes back is at rest (Felix 28.10 «фотки дёргаются»)
      data-copy-rest={`transform:translateY(${DEPTH_Y[step] ?? 26}px) scale(${DEPTH_SCALE[step] ?? 0.91});opacity:1`}
      data-copy-hide={present ? undefined : ''}
      data-grab={top ? '' : undefined}
      tabIndex={top ? 0 : -1}
      inert={!top}
      aria-hidden={top ? undefined : true}
      aria-label={top ? label : undefined}
      aria-describedby={top ? 'gifts-card-hint' : undefined}
      style={{ x, rotate, zIndex: 10 - depth, touchAction: 'pan-y' }}
      drag={top ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.92}
      dragTransition={{ bounceStiffness: springs.snappy.stiffness, bounceDamping: springs.snappy.damping }}
      onDrag={top ? onDrag : undefined}
      onDragEnd={top ? onDragEnd : undefined}
      onKeyDown={top ? onKeyDown : undefined}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: (DEPTH_Y[step] ?? 26) + 12, scale: (DEPTH_SCALE[step] ?? 0.91) - 0.03 }}
      animate={{ opacity: 1, x: 0, rotate: 0, y: DEPTH_Y[step] ?? 26, scale: DEPTH_SCALE[step] ?? 0.91 }}
      exit={reduced ? { opacity: 0, transition: fade } : 'gone'}
      variants={{
        gone: (direction: SwipeDirection) => ({
          x: direction * FLY_X,
          rotate: direction * 18,
          opacity: 0,
          transition: { ...springs.smooth, opacity: { duration: 0.26, delay: 0.08 } },
        }),
      }}
      transition={{ ...smooth, opacity: fade }}
    >
      <IdeaCard
        idea={idea}
        stamps={top ? { like: likeOpacity, skip: skipOpacity } : null}
        likeStamp={props.likeStamp}
        skipStamp={props.skipStamp}
        onAddToList={props.onAddToList ? () => props.onAddToList?.(idea) : null}
        addedToList={props.isAddedToList?.(idea) ?? false}
        onMoreLike={() => props.onMoreLike(idea)}
        moreBusy={props.moreBusy}
        onOffers={() => props.onOffers(idea)}
        isNew={props.newIds.includes(idea.id)}
        interactive={top}
      />
    </m.article>
  )
}

export function CardStack(props: CardStackProps) {
  const visible = props.cards.slice(0, 3)
  const topId = visible[0]?.id ?? null
  const hadFocus = useRef(false)
  const deck = useRef<HTMLDivElement>(null)

  // keyboard users stay in the deck: when the focused top card leaves, the next one takes the focus
  useEffect(() => {
    if (!hadFocus.current) return
    hadFocus.current = false
    const next = deck.current?.querySelector<HTMLElement>('.gift-card[data-depth="0"]')
    next?.focus({ preventScroll: true })
  }, [topId])

  return (
    <div
      ref={deck}
      className="gift-deck"
      // a sideways swipe on the deck moves the card, never the tab (features/nav/tabSwipeRules.ts)
      data-swipe-own=""
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).matches('.gift-card[data-depth="0"]')) hadFocus.current = true
      }}
      onBlurCapture={() => {
        // keep the flag through the swap: the effect above reads it right after the top card changed
        requestAnimationFrame(() => {
          if (!deck.current?.contains(document.activeElement)) hadFocus.current = false
        })
      }}
    >
      <p id="gifts-card-hint" className="sr-only">
        {props.hint}
      </p>
      <AnimatePresence initial={false} custom={props.exitDirection}>
        {[...visible].reverse().map((idea) => (
          <StackCard key={idea.id} idea={idea} depth={visible.indexOf(idea)} props={props} />
        ))}
      </AnimatePresence>
    </div>
  )
}

/** The small round undo button under the deck. */
function UndoAction({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: ReactNode }) {
  const tap = useTapScale(0.88)
  const bouncy = useSpring('bouncy')
  return (
    <m.button
      type="button"
      className="gift-action glass-float"
      data-kind="undo"
      data-size="s"
      aria-label={label}
      title={label}
      disabled={disabled}
      whileTap={disabled ? undefined : tap}
      transition={bouncy}
      onPointerDown={() => {
        if (!disabled) haptic('tap')
      }}
      onClick={onPress}
    >
      {children}
    </m.button>
  )
}

/** A decision without a swipe, for keyboards and screen readers: it shows only while it has the focus. */
function QuietVerdict({ kind, label, onPress, children }: { kind: 'skip' | 'like'; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="gift-verdict"
      data-kind={kind}
      onPointerDown={() => haptic('tap')}
      onClick={onPress}
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  )
}

export function DeckControls({
  position,
  likeLabel,
  skipLabel,
  onLike,
  onSkip,
  onUndo,
  canUndo,
  hint = null,
}: {
  position: DeckPosition
  likeLabel: string
  skipLabel: string
  onLike: () => void
  onSkip: () => void
  onUndo: () => void
  canUndo: boolean
  /** the first-time swipe hint line ("← Nicht für Anna · Merken für Anna →"); shown = visible (it fades) */
  hint?: { text: string; shown: boolean } | null
}) {
  const { t } = useTranslation('gifts')
  return (
    // Felix 26.10: no big round ✕ / ♥ under the deck any more — the swipe decides, and the screen was too busy.
    // What stays visible: undo on the left (once there is something to take back) and "3 von 8" on the right.
    // Without a swipe (WCAG 2.5.1): ← / → on the focused card; one tap each in the card's "Wo erhältlich" sheet
    // (IdeasSection); and for keyboards and screen readers the two decisions below, which show while focused.
    <div data-deck-controls="" className="relative flex min-h-12 items-center gap-2 px-1">
      <div className={cn('flex w-12 shrink-0 justify-start', !canUndo && 'invisible')}>
        <UndoAction label={t('gifts.undo_label')} onPress={onUndo} disabled={!canUndo}>
          <IconUndo size={20} />
        </UndoAction>
      </div>
      <div className="flex min-w-0 flex-1 justify-center gap-2">
        {/* the first-time hint: a quiet line, fades in and out (screen readers have the card's hint and the buttons) */}
        {hint ? (
          <p className="gift-swipe-hint" data-shown={hint.shown ? '' : undefined} aria-hidden="true">
            {hint.text}
          </p>
        ) : null}
        <QuietVerdict kind="skip" label={skipLabel} onPress={onSkip}>
          <IconX size={18} strokeWidth={2.6} />
        </QuietVerdict>
        <QuietVerdict kind="like" label={likeLabel} onPress={onLike}>
          <IconHeart size={18} />
        </QuietVerdict>
      </div>
      <div className="flex shrink-0 justify-end" aria-hidden="true">
        <span className="whitespace-nowrap t-caption-1 font-semibold tabular-nums text-text-2">
          {position.of === null ? t('gifts.position_open', { at: position.at }) : t('gifts.position', { at: position.at, of: position.of })}
        </span>
      </div>
    </div>
  )
}

/** The skeleton deck while Pompon sniffs: the card's shape, no spinner. */
export function DeckSkeleton({ label }: { label: string }) {
  return (
    <div className="gift-deck" aria-busy="true" data-swipe-own="">
      <p role="status" className="sr-only">
        {label}
      </p>
      {[2, 1, 0].map((depth) => (
        <div
          key={depth}
          className="gift-card"
          data-depth={depth}
          style={{ transform: `translateY(${DEPTH_Y[depth] ?? 0}px) scale(${DEPTH_SCALE[depth] ?? 1})`, zIndex: 10 - depth }}
        >
          {depth === 0 ? (
            <div className="flex h-full flex-col">
              <div className="skeleton min-h-[170px] flex-1 rounded-none" />
              <div className="flex flex-none flex-col gap-2.5 px-4 pb-3.5 pt-3.5">
                <div className="skeleton h-6 w-4/5" />
                <div className="skeleton h-4 w-2/5" />
                <div className="mt-1 skeleton h-10 w-full" />
                <div className="flex gap-2">
                  <div className="skeleton h-11 w-36 rounded-full" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** The deck's place when there is nothing to swipe: the end of the day, nothing found, an error. */
export function DeckMessage({ title, text, picture, children }: { title: string; text?: string | null; picture?: ReactNode; children?: ReactNode }) {
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  return (
    <m.div
      className="gift-card items-center justify-center gap-3 px-6 text-center"
      style={{ position: 'relative', minHeight: 'min(var(--gift-deck-h), 360px)' }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ ...bouncy, opacity: fade }}
    >
      {/* the picture gets the card's full width and a height of its own (the drawing is 250 × 150 px): never
          cropped, never over the title */}
      {picture ? (
        <div aria-hidden="true" className="-mx-6 -mt-2 h-[150px] shrink-0 self-stretch">
          {picture}
        </div>
      ) : null}
      <h3 className="t-title-2 text-text">{title}</h3>
      {text ? <p className="max-w-[30ch] t-callout text-text-2">{text}</p> : null}
      {children ? <div className="mt-2 flex w-full max-w-xs flex-col gap-2">{children}</div> : null}
    </m.div>
  )
}
