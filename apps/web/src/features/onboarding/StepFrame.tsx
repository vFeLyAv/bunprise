import { useRef, type ReactNode } from 'react'
import { useDragControls, useIsPresent, type PanInfo, type Transition, type Variants } from 'motion/react'
import * as m from 'motion/react-m'
import { cn, fade, useSpring } from '../../ui'

// One onboarding step as a page that slides (design-system-motion §2): the smooth spring moves it
// (transform only), opacity fades with --dur-m. AnimatePresence (popLayout) keeps the leaving step in
// place while the next one comes in, and every change simply retargets from where a step is — taps in
// quick succession or a finger on a moving step never make it jump. Reduced motion: crossfade only.
// Swipe: the greeting can be swiped forward, later steps back (each step also has buttons).

/** How a step moves: direction of the change and the slide distance (the viewport width in px). */
export interface StepMotion {
  direction: -1 | 0 | 1
  distance: number
}

export type SwipeDirection = 'forward' | 'back'

/** finger travel (incl. 200 ms of momentum) that turns a pull into a page change */
const SWIPE_DISTANCE_PX = 64
const SWIPE_MOMENTUM_S = 0.2
/** pointer travel above which a release counts as a swipe, not a tap */
const TAP_SLOP_PX = 10
/** the first step rises into place under the bunny */
const RISE_PX = 16
/** a sliding step fades with --dur-m (220 ms) while the spring moves it */
const STEP_FADE: Transition = { ...fade, duration: 0.22 }

function stepVariants(reduced: boolean): Variants {
  return {
    enter: ({ direction, distance }: StepMotion) =>
      reduced ? { opacity: 0 } : direction === 0 ? { opacity: 0, y: RISE_PX } : { opacity: 0, x: direction * distance },
    center: { opacity: 1, x: 0, y: 0 },
    exit: ({ direction, distance }: StepMotion) => (reduced ? { opacity: 0 } : { opacity: 0, x: -direction * distance }),
  }
}

export interface StepFrameProps {
  motion: StepMotion
  reduced: boolean
  canForward: boolean
  canBack: boolean
  /** no swiping while the onboarding is being finished */
  locked: boolean
  onSwipe: (direction: SwipeDirection) => void
  children: ReactNode
}

export function StepFrame({ motion, reduced, canForward, canBack, locked, onSwipe, children }: StepFrameProps) {
  const present = useIsPresent()
  const smooth = useSpring('smooth')
  const controls = useDragControls()
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const draggable = !reduced && present && !locked && (canForward || canBack)

  return (
    <m.section
      custom={motion}
      variants={stepVariants(reduced)}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ x: smooth, y: smooth, opacity: STEP_FADE }}
      drag={draggable ? 'x' : false}
      // The drag starts from onPointerDown below, so motion does not force `touch-action: pan-y`:
      // the classes keep vertical scrolling AND pinch-zoom working on the step.
      dragListener={false}
      dragControls={controls}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: canForward ? 0.5 : 0.06, right: canBack ? 0.5 : 0.06 }}
      // the smooth spring's physics for the way back after a short pull (same as the kit's Sheet)
      dragTransition={{ bounceStiffness: 250, bounceDamping: 28 }}
      onDragEnd={(_event: unknown, info: PanInfo) => {
        if (Math.abs(info.offset.y) > Math.abs(info.offset.x)) return
        const projected = info.offset.x + info.velocity.x * SWIPE_MOMENTUM_S
        if (projected <= -SWIPE_DISTANCE_PX && canForward) onSwipe('forward')
        else if (projected >= SWIPE_DISTANCE_PX && canBack) onSwipe('back')
      }}
      onPointerDown={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY }
        if (draggable) controls.start(event)
      }}
      onClickCapture={(event) => {
        // A pull that ends on a button is not a tap on it (keyboard clicks have detail 0).
        const start = pointer.current
        pointer.current = null
        if (!start || event.detail === 0) return
        if (Math.abs(event.clientX - start.x) > TAP_SLOP_PX || Math.abs(event.clientY - start.y) > TAP_SLOP_PX) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      inert={!present}
      aria-hidden={present ? undefined : true}
      className={cn(
        'flex flex-auto flex-col',
        draggable && 'touch-pan-y touch-pinch-zoom select-none',
        !present && 'pointer-events-none',
      )}
    >
      {children}
    </m.section>
  )
}
