import { useState } from 'react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { WishPriority } from '../../lib/api/types'
import { cn, useReducedMotionPref, useSpring } from '../../ui'
import './wishes.css'
import './heart.css'

// The heart of "Wie sehr wünschst du es dir?" — ONE drawing for the wish-o-meter's thumb (WishOMeter.tsx) and the
// corner of a wish tile (Felix 23.10: "the heart from the scale, in the corner of the wish"). Its face is the
// level: calm (Kann), happy (Gern), beaming with its tongue out (Unbedingt). Colours: the data-part rules in
// wishes.css read --wish-meter-color, which the holder sets per level (presentation attributes cannot read tokens).

const HEART = 'M16 27.6S3.4 19.7 3.4 11.3C3.4 7.2 6.5 4.4 10.3 4.4c2.5 0 4.6 1.3 5.7 3.3 1.1-2 3.2-3.3 5.7-3.3 3.8 0 6.9 2.8 6.9 6.9 0 8.4-12.6 16.3-12.6 16.3z'

/** The drawing itself (decorative). */
export function HeartGlyph({ level, size }: { level: WishPriority; size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="wish-heart" aria-hidden="true" focusable="false">
      <path data-part="heart" d={HEART} />
      <path data-part="shine" d="M9.6 8.6c.9-1.3 2.3-1.9 3.6-1.7" />
      {level === 1 ? null : (
        <g data-part="blush">
          <ellipse cx={8.9} cy={16.3} rx={1.7} ry={1.05} />
          <ellipse cx={23.1} cy={16.3} rx={1.7} ry={1.05} />
        </g>
      )}
      {level === 1 ? (
        <g data-part="ink">
          <path d="M10.6 13.4q1.5 1.3 3 0" />
          <path d="M18.4 13.4q1.5 1.3 3 0" />
          <path d="M14.4 17.6q1.6 1 3.2 0" />
        </g>
      ) : level === 2 ? (
        <g data-part="ink-fill">
          <circle cx={12.1} cy={13.2} r={1.3} />
          <circle cx={19.9} cy={13.2} r={1.3} />
          <path d="M13.2 16.6h5.6a2.8 2.8 0 0 1-5.6 0z" />
        </g>
      ) : (
        <>
          <g data-part="ink">
            <path d="M10.4 14l1.7-2 1.7 2" />
            <path d="M18.2 14l1.7-2 1.7 2" />
          </g>
          <path data-part="ink-fill" d="M12.3 16.2h7.4a3.7 3.7 0 0 1-7.4 0z" />
          <path data-part="tongue" d="M14.5 18.9a1.5 1.1 0 0 1 3 0" />
        </>
      )}
    </svg>
  )
}

/** The heart's size per level, as on the meter (Kann a little smaller, Unbedingt a little bigger). */
const SIZE: Record<WishPriority, number> = { 1: 21, 2: 24, 3: 27 }

/**
 * "How much" in the wish sheet (Felix 23.10: "like in the list"): the meter's heart on its disc and the word next
 * to it ("Unbedingt") — no hint sentence under it.
 */
export function PriorityLine({ priority }: { priority: WishPriority }) {
  const { t } = useTranslation('wishes')
  return (
    <span className="inline-flex items-center gap-2" data-priority-line={priority}>
      <span className="wish-prio-heart" data-level={priority} aria-hidden="true">
        <HeartGlyph level={priority} size={SIZE[priority]} />
      </span>
      <span className="t-subhead font-semibold text-accent-text">{t(`wish.priority_${priority}`)}</span>
    </span>
  )
}

/**
 * "How much" on a wish tile: the meter's heart on a small round glass disc. When the level changes (the ⋯ → "Wie
 * sehr?") the new face pops in with a little wiggle — "Unbedingt" hops; the first appearance does not animate
 * (the tile's own entrance carries it). The word ("Unbedingt") is said to screen readers.
 */
export function PriorityHeart({ priority, className }: { priority: WishPriority; className?: string }) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  const [shown, setShown] = useState(priority)
  const [changed, setChanged] = useState(false)
  if (priority !== shown) {
    setShown(priority)
    setChanged(true)
  }
  return (
    <span className={cn('wish-prio-heart', className)} data-level={priority}>
      <m.span
        key={priority}
        aria-hidden="true"
        className="grid place-items-center"
        initial={changed && !reduced ? (priority === 3 ? { scale: 0.6, y: -6 } : { scale: 0.7, rotate: priority === 1 ? -10 : 10 }) : false}
        animate={{ scale: 1, y: 0, rotate: 0 }}
        transition={reduced ? { duration: 0 } : bouncy}
      >
        <HeartGlyph level={priority} size={SIZE[priority]} />
      </m.span>
      <span className="sr-only">{t(`wish.priority_${priority}`)}</span>
    </span>
  )
}
