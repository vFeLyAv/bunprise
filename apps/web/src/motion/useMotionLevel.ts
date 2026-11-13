/**
 * React access to the app's motion level (src/motion/level.ts, Felix's K9).
 *
 *   const level = useMotionLevel()        // 'full' | 'reduced' | 'off'
 *   const { bunnies, prefs } = useMotionState()
 *
 * Rules every animation follows: 'full' = springs as designed; 'reduced' = calmer (no transform moves, no
 * loops; opacity crossfades stay, mascots show a static pose that fades in); 'off' = no animation at all
 * (state changes are instant, taps still show their pressed colour at once, no mascots).
 */
import { useSyncExternalStore } from 'react'
import { getMotionState, subscribeMotionState, type MotionLevel, type MotionState } from './level'

export type { MotionLevel, MotionPrefs, MotionState } from './level'

export function useMotionState(): MotionState {
  return useSyncExternalStore(subscribeMotionState, getMotionState, getMotionState)
}

export function useMotionLevel(): MotionLevel {
  return useMotionState().level
}
