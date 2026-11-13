import type { Target, TargetAndTransition, Transition } from 'motion/react'
import { fade, springs } from '../../ui'

// Motion recipes of the feed (design-system-motion §2): springs move, opacity fades (--dur-m),
// only transform/opacity. Every animation is a plain motion target, so a new state simply
// retargets it from where it is (interruptible).

/** Seconds between two entering elements; the cascade is capped so long feeds do not wait. */
const STAGGER_STEP = 0.045
const STAGGER_MAX_STEPS = 8
const RISE_PX = 16

/** --dur-m (220 ms): skeleton → content crossfade */
export const fadeIn: Transition = { ...fade, duration: 0.22 }

export function staggerDelay(order: number): number {
  return Math.min(Math.max(order, 0), STAGGER_MAX_STEPS) * STAGGER_STEP
}

/** Where an entering card/header starts: a little lower and transparent (only transparent under reduced motion). */
export function enterFrom(reduced: boolean): Target {
  return reduced ? { opacity: 0 } : { opacity: 0, y: RISE_PX }
}

/** The resting state, carrying its own entrance transition (smooth spring + fade, optionally delayed). */
export function enterTo(reduced: boolean, delay = 0): TargetAndTransition {
  return {
    opacity: 1,
    y: 0,
    transition: reduced ? fadeIn : { ...springs.smooth, delay, opacity: { ...fadeIn, delay } },
  }
}

/** Leaving elements fade (and shrink a hair, except under reduced motion). */
export function leave(reduced: boolean): TargetAndTransition {
  return reduced ? { opacity: 0, transition: fade } : { opacity: 0, scale: 0.98, transition: fade }
}
