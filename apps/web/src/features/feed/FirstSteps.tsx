import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { FeedScreen, Me } from '../../lib/api/types'
import type { ListsOverview } from '../../lib/api/lists.types'
import { firstSteps, hasSeenHint, markHintSeen, showHint } from '../../lib/hints'
import { IconX } from '../../ui'
import { useBunniesShown, useMotionAttr } from '../../ui/motionMode'
import { listsEnabled } from '../lists/flag'
import { useStartFirstWish } from '../lists/firstWish'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { FollowLinkSheetHost, openFollowLinkSheet } from '../people/linkSheetHost'
import { whenIdle } from './session'

// the birthday suggestion (features/birthdays, Felix 27.10): its own chunk, mounted once the browser is idle — the
// first time in this page session only: a return to Start shows it with the rest of the screen (Felix 31.10 «мигают
// данные»: it popped in ≈ 100 ms after Start came back, every time, and pushed the cards under it down)
const BirthdayHint = lazy(() => import('../birthdays/BirthdayHint'))
// the comic card «Pompon & Tapsi» and its reader (features/comic): a small chunk of their own, never on Start's lists
const ComicStart = lazy(() => import('../comic/ComicStartSlot'))
let idledOnce = false

const row = 'flex min-h-11 w-full items-center rounded-button px-2 py-2 text-left t-body text-(--accent-text-strong) tr-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent-500'

/** Deferred with the card: navigation pays for neither people sheets nor onboarding selectors. */
export default function FirstSteps({ userId, data, children }: {
  userId: string
  data: FeedScreen
  children: (visible: boolean) => ReactNode
}) {
  const { t } = useTranslation(['feed', 'onboarding'])
  const client = useQueryClient()
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client])
  const me = useSyncExternalStore(subscribe, () => client.getQueryData<Me>(['me']), () => undefined)
  const lists = useSyncExternalStore(subscribe, () => client.getQueryData<ListsOverview>(['lists']), () => undefined)
  const [dismissed, setDismissed] = useState(() => hasSeenHint('first-steps'))
  const [openedAt] = useState(Date.now)
  const card = useRef<HTMLElement>(null)
  const startWish = useStartFirstWish(userId)
  const enabled = listsEnabled()
  const { visible, mine, needsOccasion, needsWish, needsLink } = firstSteps({ userId, me, lists, data, now: openedAt, dismissed, listsOn: enabled })
  // shown in this session: no other optional hint (the comic card) until the next one (lib/hints.ts)
  useEffect(() => (visible ? showHint('first-steps') : undefined), [visible])
  // the comic card «Pompon & Tapsi» (features/comic/rules.ts: never together with this card) under the upcoming
  // occasions — never above the nearest one — or under the empty state, with the reader's sheet. Its chunk is not even
  // fetched once the card was closed or opened on this device; decided once per visit, so an open reader stays.
  const [comicOn] = useState(() => !hasSeenHint('story-1'))
  const linkHost = enabled && me?.profile.id === userId ? <FollowLinkSheetHost userId={userId} /> : null
  // after the first paint, never in its way: the suggestion's chunk and its one RPC wait for an idle moment
  const [idle, setIdle] = useState(idledOnce)
  useEffect(() => (idle ? undefined : whenIdle(() => {
    idledOnce = true
    setIdle(true)
  }, 4000)), [idle])
  const birthday = idle && userId ? <Suspense fallback={null}><BirthdayHint userId={userId} feed={data} /></Suspense> : null
  // Pompon peeks 88 px over the card (not under "Weniger"): that room stays free above the card, so he never
  // covers the hint or the card above; z-2 keeps him over the feed cards (z-1) while they glide
  const bunnies = useBunniesShown()
  const level = useMotionAttr()
  const peeks = bunnies && level !== 'reduced'
  // (the comic card after the others: the birthday suggestion and the link host keep their places in this list)
  if (!visible) return <>
    {children(false)}{birthday}{linkHost}
    {comicOn ? <Suspense fallback={null}><ComicStart feed={data} firstStepsVisible={false} afterBirthday className="mt-8" /></Suspense> : null}
  </>

  return <>
    {children(true)}
    {birthday}
    {data.upcoming.length === 0 ? <div className="mb-5">
      <h2 className="t-title-2 text-text">{t('onb.start_title', { ns: 'onboarding' })}</h2>
      <p className="mt-2 t-callout text-text-2">{t('feed.empty_invite_hint')}</p>
    </div> : null}
    <section ref={card} aria-labelledby="first-steps-title" data-peek={peeks ? '' : undefined}
      className={`glass-panel relative z-2 rounded-card p-4 ${peeks ? 'mb-6 mt-24' : 'my-6'}`}>
      {peeks ? <BunnyMoment kind="peek" once="visit" onceKey="first-steps" calm="hide" cardRef={card}
        minSize={96} maxSize={125} momentClass="illustration"
        className="pointer-events-none absolute -top-22 right-12 h-26 w-28" /> : null}
      <div className="relative flex items-center justify-between gap-2">
        <h2 id="first-steps-title" className="t-title-2 text-text">{t('feed.first_steps_title')}</h2>
        <button type="button" aria-label={t('feed.first_steps_hide')} className="flex size-11 shrink-0 items-center justify-center rounded-full" onClick={() => {
          const headings = [...document.querySelectorAll<HTMLElement>('h1,h2,h3')]
          const heading = headings.find((el) => card.current && !card.current.contains(el) && (card.current.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? headings[0]
          markHintSeen('first-steps')
          setDismissed(true)
          if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
        }}><IconX size={20} /></button>
      </div>
      {needsOccasion ? <Link to="/occasions/new" className={row}>{t('feed.first_steps_occasion')}</Link> : null}
      {needsWish && enabled ? <button type="button" className={row} onClick={startWish}>{t('feed.first_steps_wish')}</button> : null}
      {needsWish && !enabled && mine[0] ? <Link to="/occasions/$occasionId/wishes/new" params={{ occasionId: mine[0].id }} className={row}>{t('feed.first_steps_wish')}</Link> : null}
      {needsLink ? <button type="button" className={row} onClick={() => openFollowLinkSheet()}>{t('feed.first_steps_link')}</button> : null}
    </section>
    {linkHost}
  </>
}
