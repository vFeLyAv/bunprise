import type { Ref } from 'react'
import { createLink } from '@tanstack/react-router'
import type { HTMLMotionProps } from 'motion/react'
import * as m from 'motion/react-m'
import { haptic } from '../../ui/haptics'
import { useSpring, useTapScale } from '../../ui/motion'

/**
 * A router <Link> rendered as a motion anchor: real link semantics (intent preloading, open in new
 * tab, view transitions) plus the kit's spring press (`whileTap={useTapScale()}`, `useSpring('snappy')`).
 * The kit's Button/Card/IconButton are <button>s, which cannot carry a navigation target.
 * Not part of the shell bundle by itself: only the screens that import it carry it.
 */
export const MotionLink = createLink(m.a)

type PressAnchorProps = HTMLMotionProps<'a'> & { ref?: Ref<HTMLAnchorElement> }

/** The anchor of PressLink: presses like a kit Button (scale .97, snappy; colour only under reduced motion). */
function PressAnchor({ ref, onPointerDown, ...props }: PressAnchorProps) {
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  return (
    <m.a
      ref={ref}
      whileTap={tap}
      transition={spring}
      onPointerDown={(event) => {
        haptic('tap')
        onPointerDown?.(event)
      }}
      {...props}
    />
  )
}

/** A router link that looks like a button (`className={buttonClass(…)}`) and presses like one. */
export const PressLink = createLink(PressAnchor)
