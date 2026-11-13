import type { Transition } from 'motion/react'

// The only three springs in the app (design-system-motion.md 2.1). Adding a fourth needs a
// documented reason there. Mascots use `bouncy`; the MotionConfig default is `smooth`.
// CSS gets the same physics via --ease-* / --dur-* tokens in src/styles/tokens.css.

export const springs = {
  /** button press (scale .97), switches, chips, small show/hide — settles in 280 ms */
  snappy: { type: 'spring', stiffness: 630, damping: 43, mass: 1 },
  /** sheets, gesture return, layout (FLIP), list → detail — settles in 350 ms, no overshoot */
  smooth: { type: 'spring', stiffness: 250, damping: 28, mass: 1 },
  /** success, toast, FAB, flying star, every mascot move — one visible bounce, 480 ms */
  bouncy: { type: 'spring', stiffness: 400, damping: 20, mass: 1 },
} as const satisfies Record<string, Transition>

export type SpringName = keyof typeof springs
