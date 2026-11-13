import { Suspense, lazy, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import type { FeedScreen, Me } from '../../lib/api/types'
import type { ListsOverview } from '../../lib/api/lists.types'
import { firstSteps, hasSeenHint, markHintSeen, otherHintOnScreen, otherHintShown, showHint, subscribeHints } from '../../lib/hints'
import { useBunniesShown } from '../../ui/motionMode'
import { listsEnabled } from '../lists/flag'
import { comicCardAllowed, demoLaterDay, sessionStart } from './rules'
import { useComicState } from './store'

// Where the comic card may appear on Start (./rules.ts says when): FirstSteps.tsx puts it under the upcoming occasions
// (never above the nearest one) or under the empty state, the month view under the month's agenda. This module is a
// small lazy chunk of its own, loaded only while the card was never closed or opened on this device (lib/hints.ts
// 'story-1'); the card itself (picture, buttons) is fetched only when it shows, and so is the reader's sheet — hosted
// next to the card, so it outlasts the card that opened it.

const ComicStartCard = lazy(() => import('./ComicStartCard'))
const ComicHost = lazy(() => import('./ComicHost').then((mod) => ({ default: mod.ComicHost })))

const subscribeOnline = (notify: () => void) => onlineManager.subscribe(notify)
/** The birthday suggestion's query (= features/birthdays/BirthdayHint.tsx anniversariesKey; not imported: its chunk). */
const anniversaries = (userId: string) => ['anniversaries', userId] as const

export interface ComicStartSlotProps {
  feed: FeedScreen
  /** «Erste Schritte» is shown right now (from FirstSteps); without it the slot asks lib/hints.ts firstSteps() */
  firstStepsVisible?: boolean
  /** the space above the card in its place (only while there is a card) */
  className?: string
  /** Start's list: the birthday suggestion (FirstSteps, after an idle moment) decides first — it comes first */
  afterBirthday?: boolean
}

export function ComicStartSlot({ feed, firstStepsVisible, className, afterBirthday = false }: ComicStartSlotProps) {
  const client = useQueryClient()
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client])
  const me = useSyncExternalStore(subscribe, () => client.getQueryData<Me>(['me']), () => undefined)
  const lists = useSyncExternalStore(subscribe, () => client.getQueryData<ListsOverview>(['lists']), () => undefined)
  const online = useSyncExternalStore(subscribeOnline, () => onlineManager.isOnline(), () => true)
  const bunnies = useBunniesShown()
  const comic = useComicState()
  const othersShown = useSyncExternalStore(subscribeHints, () => otherHintShown('story-1'), () => false)
  const othersOnScreen = useSyncExternalStore(subscribeHints, () => otherHintOnScreen('story-1'), () => false)
  const birthdaySettled = useSyncExternalStore(subscribe, () => {
    const status = client.getQueryState(anniversaries(me?.profile.id ?? ''))?.status
    return status === 'success' || status === 'error'
  }, () => false)
  const [closed, setClosed] = useState(() => hasSeenHint('story-1'))
  const [openedAt] = useState(Date.now)
  const steps = firstStepsVisible ?? firstSteps({
    userId: me?.profile.id ?? '', me, lists, data: feed, now: openedAt, dismissed: hasSeenHint('first-steps'), listsOn: listsEnabled(),
  }).visible
  const allowed = comicCardAllowed({
    sessionStart: sessionStart(),
    onboardingDoneAt: me?.profile.onboarding_done_at,
    firstStepsVisible: steps,
    seen: closed || comic.loaded,
    otherHintThisSession: othersShown,
    otherHintOnScreen: othersOnScreen,
    online,
    bunnies,
    demoLaterDay: demoLaterDay(),
  }) && (!afterBirthday || birthdaySettled)
  // on screen = this session's one optional hint
  useEffect(() => (allowed ? showHint('story-1') : undefined), [allowed])
  if (!allowed) return null
  return (
    <div className={className} data-comic-slot="">
      <Suspense fallback={null}>
        <ComicStartCard onDismiss={() => {
          markHintSeen('story-1')
          setClosed(true)
        }} />
      </Suspense>
    </div>
  )
}

/** The reader's sheet on Start: rendered from the first opening on (its chunk is fetched then). */
export function ComicHostSlot() {
  const comic = useComicState()
  const [opened, setOpened] = useState(false)
  if (comic.open && !opened) setOpened(true)
  if (!opened) return null
  return <Suspense fallback={null}><ComicHost /></Suspense>
}

/** The card in its place and the reader's sheet (FirstSteps, the month view: `lazy(() => import(…))`). */
export default function ComicStart(props: ComicStartSlotProps) {
  return <><ComicStartSlot {...props} /><ComicHostSlot /></>
}
