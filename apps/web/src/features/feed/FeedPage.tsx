import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { toAppError } from '../../lib/errors'
import { feedQuery } from '../../lib/queries'
import { fade, useReducedMotionPref, useSpring } from '../../ui'
import type { TodayControl } from '../calendar/MonthView'
import { assignTones, personKey } from '../calendar/people'
import { FeedFrame, TodayPill, preloadMonthView } from './FeedFrame'
import { FeedSections } from './FeedSections'
import { FeedError, FeedOffline, FeedSkeleton, MonthSkeleton } from './FeedStates'
import { groupUpcoming } from './model'
import { useInviteCount } from '../invitations/dot'
import { markFeedPresented, rememberStartView, wasFeedPresented, whenIdle, type StartView } from './session'

// S5 Start (product-pilot S5/F10): the occasions I host or was invited to — wave 2 in two views, switched in the
// header ("Liste | Monat", the address says which: routes/_authed/soon.tsx):
//   Liste — today · this week · later, plus the collapsed past 30 days (the feed of the pilot);
//   Monat — the month calendar with every person in their own colour (features/calendar/MonthView, a lazy
//           chunk of its own: the list never pays for it; loaded when the browser is idle).
// One RPC (get_feed) through feedQuery() for both; the route loader already put it into the cache.
// SECRECY: neither view shows reservation facts, including a guest’s own count.

const MonthView = lazy(() => import('../calendar/MonthView'))
const FirstSteps = lazy(() => import('./FirstSteps'))
// only a new account (no occasion yet) sees it: kept out of the first screen of everyone else (budget, 25.10)
const FeedEmpty = lazy(() => import('./FeedEmpty'))
const PastGroup = lazy(() => import('./PastGroup'))
// in-app invitations to occasions (features/invitations, behind VITE_INVITES): mounted only while get_me counts some
const InvitationInbox = lazy(() => import('../invitations/InvitationInbox'))

type FeedView = 'list' | 'empty' | 'error' | 'offline' | 'loading'

export interface StartViewProps {
  /** Start's view (wave 2); default the list */
  view?: StartView
  /** the header switch; without it the switch waits (the route's pending skeleton has it too) */
  onViewChange?: (view: StartView) => void
}

/** Route pending component (shown after 150 ms of loading): the same frame with the view's skeleton. */
export function FeedPending({ view = 'list', onViewChange }: StartViewProps) {
  return (
    <FeedFrame view={view} onViewChange={onViewChange}>
      {view === 'month' ? <MonthSkeleton /> : <FeedSkeleton />}
    </FeedFrame>
  )
}

export interface FeedPageProps extends StartViewProps {
  userId?: string
  /** month view, K10: `?created=<occasion id>` — the bunny carries it onto its day */
  created?: string | null
  /** drops `created` from the address once the occasion landed */
  onLandingDone?: () => void
}

export function FeedPage({ userId = '', view = 'list', onViewChange, created = null, onLandingDone }: FeedPageProps) {
  // The loader already tried (and the screen offers "Nochmal"): no second automatic attempt on mount.
  const query = useQuery({ ...feedQuery(), retryOnMount: false })
  const queryClient = useQueryClient()
  const invites = useInviteCount(userId, queryClient)
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  // The cascade plays the first time the feed shows its content in this page session only; coming back
  // from an occasion the cards are simply there (the shared-element transition moves the opened one).
  const [entrance] = useState(() => !wasFeedPresented())
  // the month view's "Heute" lives in the top bar
  const [today, setToday] = useState<TodayControl | null>(null)
  // list → month slides in from the right, month → list from the left
  const [shownView, setShownView] = useState(view)
  const [direction, setDirection] = useState(1)
  if (view !== shownView) {
    setShownView(view)
    setDirection(view === 'month' ? 1 : -1)
  }
  const data = query.data
  // Recomputed on every render (≤ 30 rows): a refetch or focus after midnight regroups by itself.
  const sections = data ? groupUpcoming(data.upcoming) : []
  // every host in their colour — the same as their chips in the month view
  const tones = useMemo(() => assignTones([...(data?.upcoming ?? []), ...(data?.past ?? [])].map(personKey)), [data])

  const state: FeedView = data
    ? sections.length > 0 ? 'list' : 'empty'
    : query.isError ? 'error'
      : query.fetchStatus === 'paused' ? 'offline'
        : 'loading'

  useEffect(() => {
    if (view === 'list' && (state === 'list' || state === 'empty')) markFeedPresented()
  }, [view, state])

  useEffect(() => {
    rememberStartView(view)
  }, [view])

  // the first "Monat" opens at once: its chunk loads while the browser is idle
  useEffect(() => whenIdle(preloadMonthView, 3000), [])

  let content: ReactNode
  switch (state) {
    case 'list':
      content = <FeedSections sections={sections} entrance={entrance} tones={tones} />
      break
    case 'empty':
      content = <Suspense fallback={<FeedSkeleton />}><FeedEmpty /></Suspense>
      break
    case 'error':
      content = <FeedError error={toAppError(query.error)} onRetry={() => void query.refetch()} />
      break
    case 'offline':
      content = <FeedOffline />
      break
    default:
      content = <FeedSkeleton />
  }

  const list = (
    <>
      {invites > 0 && userId ? <Suspense fallback={null}><InvitationInbox userId={userId} count={invites} /></Suspense> : null}
      {data && userId ? <Suspense fallback={content}>
        <FirstSteps userId={userId} data={data}>{(visible) => state === 'empty' && visible ? null : state === 'list'
          ? <FeedSections sections={sections} entrance={entrance} tones={tones} suppressHop={visible} /> : content}</FirstSteps>
      </Suspense> : <>
      {/* Crossfade between states in place: the old one is popped out of the flow while it fades. */}
      <div className="relative">
        <AnimatePresence initial={false} mode="popLayout">
          <m.div
            key={state}
            initial={state === 'list' ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            {content}
          </m.div>
        </AnimatePresence>
      </div>
      </>}
      {data && data.past.length > 0 ? <Suspense fallback={null}><PastGroup items={data.past} entrance={entrance} tones={tones} /></Suspense> : null}
    </>
  )

  const right = view === 'month' ? <TodayPill visible={today?.visible ?? false} onPress={() => today?.go()} /> : undefined

  return (
    <FeedFrame view={view} onViewChange={onViewChange} right={right}>
      {/* the two views swap in place: the leaving one is popped out of the flow while the new one slides in */}
      <div className="relative">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <m.div
            key={view}
            custom={direction}
            variants={{
              enter: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: 28 * dir }),
              shown: { opacity: 1, x: 0 },
              leave: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: -28 * dir }),
            }}
            initial="enter"
            animate="shown"
            exit="leave"
            transition={{ x: smooth, opacity: fade }}
          >
            {view === 'month' ? (
              <Suspense fallback={<MonthSkeleton />}>
                <MonthView created={created} onLandingDone={onLandingDone} onToday={setToday} />
              </Suspense>
            ) : (
              list
            )}
          </m.div>
        </AnimatePresence>
      </div>
    </FeedFrame>
  )
}
