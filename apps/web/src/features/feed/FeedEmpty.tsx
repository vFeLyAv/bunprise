import { Suspense, lazy, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLink, IconPlus, buttonClass, useBunniesShown, useSpring, useTapScale } from '../../ui'
import { MotionLink } from './MotionLink'

// The empty Start of a new account (no occasion yet) — its own lazy chunk (FeedPage), so the first screen of
// everyone who HAS occasions does not carry it (budget 200 KB, release 25.10). FeedSkeleton bridges the wait.
const BunnyMoment = lazy(() => import('../mascot-ui/BunnyMoment').then((mod) => ({ default: mod.BunnyMoment })))

/** The bunny's host reaches this far below the card's top edge: its paws rest on the card. */
const CARD_OVERLAP_PX = 16

/**
 * Nothing upcoming: the main bunny peeks over the top edge of the empty-state card (the welcome stage's
 * 'peek-once': climbs up with its paws, looks around and stays), one line, one CTA (pilot-decisions §7).
 */
export default function FeedEmpty() {
  const { t } = useTranslation('feed')
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  const card = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bunnies = useBunniesShown()
  return (
    <section aria-labelledby={titleId} className="flex flex-col pt-2">
      {bunnies ? <div className="relative h-44">
        {/* the app's one API for mascot moments (mascot-ui/BunnyMoment, 'peek'): lazy, after the first paint */}
        <Suspense fallback={null}><BunnyMoment
          kind="peek"
          family="screen-host:start"
          calm="still"
          cardRef={card}
          edgeInset={CARD_OVERLAP_PX}
          minSize={120}
          maxSize={160}
          className="pointer-events-none absolute inset-0"
          style={{ bottom: -CARD_OVERLAP_PX }}
        /></Suspense>
      </div> : null}
      <div ref={card} className="glass-panel feed-empty flex flex-col items-center gap-3 rounded-card px-6 pb-6 pt-9 text-center">
        <h2 id={titleId} className="t-title-1 text-text">
          {t('feed.empty_title')}
        </h2>
        <p className="max-w-[32ch] t-body text-text-2">{t('feed.empty')}</p>
        <p className="max-w-[32ch] t-subhead text-text-2">{t('feed.empty_ideas')}</p>
        <MotionLink
          to="/occasions/new"
          className={`${buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })} mt-3`}
          whileTap={tap}
          transition={spring}
        >
          <IconPlus size={20} />
          {t('feed.new_occasion')}
        </MotionLink>
        <p className="mt-1 flex items-center gap-2 t-footnote text-text-2">
          <IconLink size={16} className="shrink-0 text-accent-text" />
          {t('feed.empty_invite_hint')}
        </p>
      </div>
    </section>
  )
}
