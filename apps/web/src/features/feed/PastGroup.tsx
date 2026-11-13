import { useId, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { FeedOccasion } from '../../lib/api/types'
import { IconForward, haptic, useReducedMotionPref, useSpring } from '../../ui'
import type { PersonKey, PersonTone } from '../calendar/people'
import { personKey } from '../calendar/people'
import { FeedCard } from './FeedCard'
import { enterFrom, enterTo, leave, staggerDelay } from './motion'

export interface PastGroupProps {
  /** get_feed().past: ended within the last 30 days, newest first */
  items: FeedOccasion[]
  entrance: boolean
  /** every host's colour (calendar/people.ts assignTones over the whole feed) */
  tones?: ReadonlyMap<PersonKey, PersonTone>
}

/** Newest first; the same start by title (never the server's random id tie — like feed/model byStart). */
const newestFirst = (a: FeedOccasion, b: FeedOccasion) => Date.parse(b.starts_at) - Date.parse(a.starts_at) || a.title.localeCompare(b.title)

/** "Vergangen (30 Tage)", collapsed by default (product-pilot S5); the state lives in memory only. */
export default function PastGroup({ items, entrance, tones }: PastGroupProps) {
  const { t } = useTranslation('feed')
  const [open, setOpen] = useState(false)
  const listId = useId()
  const reduced = useReducedMotionPref()
  const snappy = useSpring('snappy')
  const layout = useSpring('smooth')

  return (
    <m.section
      layout="position"
      transition={{ layout }}
      initial={entrance ? enterFrom(reduced) : false}
      animate={enterTo(reduced, entrance ? staggerDelay(4) : 0)}
      className="mt-8"
    >
      <h2 className="t-headline">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            haptic('select')
            setOpen((value) => !value)
          }}
          className="flex min-h-11 w-full items-center gap-2 rounded-md text-left text-text-2 tr-colors hover:text-text"
        >
          <span className="min-w-0 flex-1">{t('feed.group_past')}</span>
          <span className="t-subhead tabular-nums">{items.length}</span>
          <m.span className="inline-flex" animate={{ rotate: open ? 90 : 0 }} transition={snappy}>
            <IconForward size={18} />
          </m.span>
        </button>
      </h2>
      <ul id={listId} className="m-0 mt-3 flex list-none flex-col gap-3 p-0 empty:mt-0">
        <AnimatePresence initial={false}>
          {open
            ? [...items].sort(newestFirst).map((occasion, index) => (
                <m.li
                  key={occasion.id}
                  layout="position"
                  transition={{ layout }}
                  initial={enterFrom(reduced)}
                  animate={enterTo(reduced, staggerDelay(index))}
                  exit={leave(reduced)}
                >
                  <FeedCard occasion={occasion} past personTone={tones?.get(personKey(occasion))} />
                </m.li>
              ))
            : null}
        </AnimatePresence>
      </ul>
    </m.section>
  )
}
