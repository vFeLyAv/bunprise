import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'

// The first-time swipe hint of "Ideen" (Felix 27.10: "человек же не знает, что можно свайпать … ненавязчивая
// подсказка"): shown ONCE on this device — the top card nudges left and right a little, a small line says
// "← Nicht für Anna · Merken für Anna →". Remembered as one flag under the active prefix (cleared on sign-out like
// every `bunprise.` key — docs/storage-registry.md). A key of its own on purpose: lib/hints.ts ships with the
// first screen (/soon), and the shell's budget is spent; this module lives in the Ideen chunk.

const KEY = `${ACTIVE_STORAGE_PREFIX}ideasSwipeHint`

export function hasSeenSwipeHint(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // storage unavailable: better no hint than one on every visit
    return true
  }
}

export function markSwipeHintSeen(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* the hint may come once more */
  }
}
