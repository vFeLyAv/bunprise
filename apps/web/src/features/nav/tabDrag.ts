import { useSyncExternalStore } from 'react'
import type { TabGroup } from './tabs'

// The tab bar's pill follows a swipe between the tabs: TabSwipe.tsx (a lazy chunk) writes where each capsule's pill
// is (tabSwipeRules.ts pillPoses), TabBar's Pill reads it. Kept tiny: it sits in the signed-in layout chunk, which
// the first screen loads (budget).

export interface PillPose {
  /** the slot inside the capsule (fractional while moving) */
  slot: number
  opacity: number
  scale: number
}

/** While a swipe is under way: the pill of each capsule that takes part. */
export type TabDrag = Partial<Record<TabGroup, PillPose>>

let current: TabDrag | null = null
const listeners = new Set<() => void>()

export function setTabDrag(next: TabDrag | null): void {
  current = next
  for (const listener of listeners) listener()
}

/** Read during a render: is a swipe under way (the tab bar skips its tap animation when a swipe lands)? */
export function getTabDrag(): TabDrag | null {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTabDrag(): TabDrag | null {
  return useSyncExternalStore(subscribe, getTabDrag, () => null)
}
