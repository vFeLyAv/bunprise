/**
 * Motion vocabulary of the whole app (design-system-motion.md §2).
 *
 * Exactly three springs: snappy · smooth · bouncy. No fourth one without a
 * spec change. Springs animate transform only; opacity/colour use the CSS
 * durations from tokens.css (--dur-xs … --dur-l).
 *
 * The motion level (src/motion/level.ts, Felix's K9) is on <html data-motion="full|reduce|off">:
 * 'reduce' and 'off' mean transform animations must not move — `useReducedMotionPref()` is true and
 * `useSpring()` returns an instant transition; under 'off' even crossfades are instant (main.tsx sets
 * motion's global `instantAnimations`). Without the attribute the OS setting decides.
 */
import { useReducedMotion } from 'motion/react';
import type { Transition } from 'motion/react';
import { springs, type SpringName } from '../motion/springs';
import { useMotionAttr } from './motionMode';

// The spring values live in ONE file (src/motion/springs.ts); the kit re-exports them.
export { springs, type SpringName };
// The level lives in a motion-free module (the lazy mascot chunk imports it directly).
export { getMotionMode, useMotionMode, getMotionAttr, useMotionAttr, getBunniesShown, useBunniesShown, type MotionMode, type MotionAttr } from './motionMode';

/** Instant: used instead of a spring when motion is reduced. */
export const instant = { duration: 0 } as const satisfies Transition;

/** Crossfade for opacity (= --dur-s / --ease-out). Kept under 'reduced', instant under 'off'. */
export const fade = { duration: 0.16, ease: [0.2, 0.7, 0.3, 1] } as const satisfies Transition;

/** The same springs for CSS `transition` shorthands (duration + linear() easing from tokens.css). */
export const springCss = {
  snappy: 'var(--dur-snappy) var(--ease-snappy)',
  smooth: 'var(--dur-smooth) var(--ease-smooth)',
  bouncy: 'var(--dur-bouncy) var(--ease-bouncy)',
} as const;

/** True when transform animations must not move (§2.8): level 'reduced' or 'off', or the OS asks for it. */
export function useReducedMotionPref(): boolean {
  const system = useReducedMotion();
  const level = useMotionAttr();
  if (level === 'reduced' || level === 'off') return true;
  if (level === 'full') return false;
  return system === true;
}

/** A named spring, or `instant` under reduced motion. */
export function useSpring(name: SpringName): Transition {
  const reduced = useReducedMotionPref();
  return reduced ? instant : springs[name];
}

/** `whileTap` value for pressable things; undefined under reduced motion (only the colour changes then). */
export function useTapScale(scale = 0.97): { scale: number } | undefined {
  const reduced = useReducedMotionPref();
  return reduced ? undefined : { scale };
}
