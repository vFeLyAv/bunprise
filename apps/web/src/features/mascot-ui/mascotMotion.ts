/**
 * How the mascots follow the app's motion level (src/motion/level.ts → <html data-motion / data-bunnies>,
 * read here through ui/motionMode — no store, no motion library in the lazy mascot chunks):
 *   'full'     → the package never reduces ('off');
 *   'reduced'  → the package's reduced mode ('force'): a static pose that fades in, no scenes, no loops;
 *   'off' or "Kaninchen zeigen" off → no mascot at all (`shown` false: nothing is mounted or loaded);
 *   no attribute (tests, before boot) → the package follows the OS itself ('auto').
 */
import type { ReducedMotionMode } from '@bunprise/mascot';
import { useBunniesShown, useMotionAttr, type MotionAttr } from '../../ui/motionMode';

export function packageMotion(level: MotionAttr): ReducedMotionMode {
  if (level === 'full') return 'off';
  if (level === 'reduced' || level === 'off') return 'force';
  return 'auto';
}

export function useMascotMotion(): { reducedMotion: ReducedMotionMode; shown: boolean } {
  const level = useMotionAttr();
  const shown = useBunniesShown();
  return { reducedMotion: packageMotion(level), shown };
}
