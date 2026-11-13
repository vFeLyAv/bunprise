import type { Transition } from 'motion/react'
import { instant, springs, useReducedMotionPref } from '../../../ui'

// The one place where the occasion form asks "may things move?": the app's motion level (src/motion/level.ts,
// K9 — the setting "Animationen" × the OS setting × the battery saver), read through the kit's
// useReducedMotionPref() (<html data-motion>, written by the level's store). 'reduced' and 'off' both mean
// `calm` here (no slides, no glides — a short fade stays; 'off' makes even that instant, MotionLevelConfig).

export function useCalmMotion(): boolean {
  return useReducedMotionPref()
}

/** A named spring, or no animation at all when calm. */
export function useFormSpring(name: keyof typeof springs): Transition {
  return useCalmMotion() ? instant : springs[name]
}
