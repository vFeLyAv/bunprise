/**
 * motion's global setup follows the app's motion level (src/motion/level.ts):
 *   'full'    → springs as designed (the MotionConfig default transition is the smooth spring);
 *   'reduced' → MotionConfig reducedMotion="always": transform and layout animations are off, opacity and
 *               colour crossfades stay (calmer, nothing moves);
 *   'off'     → motion's global `instantAnimations`: every animation jumps to its end at once (state
 *               changes are instant; the pressed colour of a tap is CSS and stays immediate).
 * The level already includes the system setting, so 'never' under 'full' never overrides a person's OS.
 * <MotionLevelConfig> is mounted once in src/main.tsx around the router (the LazyMotion scopes of the screen
 * groups sit below it, src/motion/MotionScope.tsx); syncMotionGlobals() is called once at boot, right after
 * startMotionLevel().
 */
import type { ReactNode } from 'react'
import { MotionConfig, MotionGlobalConfig } from 'motion/react'
import { getMotionState, subscribeMotionState } from './level'
import { springs } from './springs'
import { useMotionLevel } from './useMotionLevel'

/** Keeps motion's global `instantAnimations` in step with the level (before the first render, then live). */
export function syncMotionGlobals(): () => void {
  const apply = () => {
    MotionGlobalConfig.instantAnimations = getMotionState().level === 'off'
  }
  apply()
  return subscribeMotionState(apply)
}

export function MotionLevelConfig({ children }: { children: ReactNode }) {
  const level = useMotionLevel()
  return (
    <MotionConfig reducedMotion={level === 'full' ? 'never' : 'always'} transition={springs.smooth}>
      {children}
    </MotionConfig>
  )
}
