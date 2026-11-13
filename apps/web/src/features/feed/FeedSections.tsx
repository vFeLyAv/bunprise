import { Suspense, lazy, useId, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { useReducedMotionPref, useSpring } from '../../ui'
import type { PersonKey, PersonTone } from '../calendar/people'
import { personKey } from '../calendar/people'
import { FeedCard } from './FeedCard'
import type { FeedSection, UpcomingGroup } from './model'
import { enterFrom, enterTo, leave, staggerDelay } from './motion'

/**
 * The first open of the day: a friend of Pompon hops across along the top edge of the first card (its feet
 * on the edge, like on a shelf; the cards are frosted glass, so it hops on them, not behind them). The host
 * reaches HOP_BELOW px into the card, its own bottom is the line the feet touch.
 */
const StartSurprise = lazy(() => import('../mascot-ui/StartSurprise'))

const GROUP_TITLE: Record<UpcomingGroup, string> = {
  today: 'feed.group_today',
  week: 'feed.group_week',
  later: 'feed.group_later',
}

export interface FeedSectionsProps {
  sections: FeedSection[]
  /** first presentation in this page session: headers and cards cascade in */
  entrance: boolean
  /** every host's colour (calendar/people.ts assignTones over the whole feed) */
  tones?: ReadonlyMap<PersonKey, PersonTone>
  suppressHop?: boolean
}

/**
 * Heute · In den nächsten Tagen · Später. On the first presentation the headers and cards rise in one after
 * another (smooth spring + fade). Later changes glide: added cards fade in, removed ones fade out and
 * the others move to their new place (layout="position", smooth spring) instead of jumping.
 */
export function FeedSections({ sections, entrance, tones, suppressHop }: FeedSectionsProps) {
  const { t } = useTranslation('feed')
  const reduced = useReducedMotionPref()
  const layout = useSpring('smooth')
  const baseId = useId()
  const firstCard = useRef<HTMLLIElement>(null)
  let order = 0

  return (
    <div className="flex flex-col gap-8">
      <AnimatePresence initial={entrance}>
        {sections.map((section) => {
          const headingId = `${baseId}-${section.group}`
          const headerOrder = order++
          return (
            <m.section
              key={section.group}
              aria-labelledby={headingId}
              layout="position"
              transition={{ layout }}
              initial={enterFrom(reduced)}
              animate={enterTo(reduced, entrance ? staggerDelay(headerOrder) : 0)}
              exit={leave(reduced)}
            >
              <h2 id={headingId} className="mb-3 t-title-2 text-text">
                {t(GROUP_TITLE[section.group])}
              </h2>
              <ul className="relative m-0 flex list-none flex-col gap-3 p-0">
                {headerOrder === 0 && !suppressHop ? (
                  <Suspense fallback={null}><StartSurprise targetRef={firstCard} /></Suspense>
                ) : null}
                <AnimatePresence initial={entrance}>
                  {section.items.map((occasion, index) => {
                    const cardOrder = order++
                    return (
                      <m.li
                        ref={headerOrder === 0 && index === 0 ? firstCard : undefined}
                        key={occasion.id}
                        className="relative z-1"
                        layout="position"
                        transition={{ layout }}
                        initial={enterFrom(reduced)}
                        animate={enterTo(reduced, entrance ? staggerDelay(cardOrder) : 0)}
                        exit={leave(reduced)}
                      >
                        <FeedCard occasion={occasion} personTone={tones?.get(personKey(occasion))} />
                      </m.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            </m.section>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
