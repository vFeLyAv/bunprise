/**
 * The app's motion level as the <html> attributes show it, without any motion-library import: lazy chunks
 * that only need the level (the mascot wrapper, the welcome stage) import this file and stay free of motion
 * and the kit barrel (perf audit 2026-10-20 §6.6). ui/motion.ts re-exports it.
 *
 * The store src/motion/level.ts (started in src/main.tsx) writes the attributes:
 *   data-motion  = 'full' | 'reduce' | 'off'   (the resolved level: setting × system × battery)
 *   data-bunnies = 'on' | 'off'                ("Kaninchen zeigen", and never with level 'off')
 * Without the attributes (tests, a page before boot) everything follows the system setting ('auto').
 */
import { useSyncExternalStore } from 'react';

/** The attribute as older code reads it: 'auto' (no attribute: follow the OS) · 'reduce' (also 'off') · 'full'. */
export type MotionMode = 'auto' | 'reduce' | 'full';

/** The resolved level: 'full' · 'reduced' · 'off' (no attribute: 'auto' = follow the OS). */
export type MotionAttr = 'auto' | 'full' | 'reduced' | 'off';

function attr(name: 'motion' | 'bunnies'): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement.dataset[name];
}

/** Reads <html data-motion>; 'off' counts as 'reduce' here; anything else is 'auto' (follow the OS). */
export function getMotionMode(): MotionMode {
  const v = attr('motion');
  if (v === 'reduce' || v === 'off') return 'reduce';
  return v === 'full' ? 'full' : 'auto';
}

/** Reads <html data-motion> as the level. */
export function getMotionAttr(): MotionAttr {
  const v = attr('motion');
  if (v === 'reduce') return 'reduced';
  return v === 'full' || v === 'off' ? v : 'auto';
}

/** Mascots may appear: data-bunnies is not 'off' and the level is not 'off'. */
export function getBunniesShown(): boolean {
  return attr('bunnies') !== 'off' && attr('motion') !== 'off';
}

function subscribeAttrs(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-bunnies'] });
  return () => mo.disconnect();
}

const serverMode = (): MotionMode => 'auto';
const serverAttr = (): MotionAttr => 'auto';
const serverBunnies = (): boolean => true;

/** Live value of <html data-motion> in the older three-way form. */
export function useMotionMode(): MotionMode {
  return useSyncExternalStore(subscribeAttrs, getMotionMode, serverMode);
}

/** Live level from <html data-motion> ('auto' without the attribute). */
export function useMotionAttr(): MotionAttr {
  return useSyncExternalStore(subscribeAttrs, getMotionAttr, serverAttr);
}

/** Live: may mascots appear? */
export function useBunniesShown(): boolean {
  return useSyncExternalStore(subscribeAttrs, getBunniesShown, serverBunnies);
}
