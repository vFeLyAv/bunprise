import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'

// «Здесь я буду жить» (Felix 27.10: approved in the mascot gallery): on the onboarding step "Zum Home-Bildschirm"
// Pompon climbs into the app-icon frame ONCE on this device; every later visit of the step shows the still icon.
// One flag under the active prefix (cleared on sign-out like every `bunprise.` key — docs/storage-registry.md).
// A key of its own on purpose: lib/hints.ts ships with the first screen (/soon), whose budget is spent; this module
// lives in the /welcome chunk.

const KEY = `${ACTIVE_STORAGE_PREFIX}homeIconPlayed`

export function hasPlayedHomeIcon(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // storage unavailable: the still icon (never the same show on every visit)
    return true
  }
}

export function markHomeIconPlayed(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* the show may come once more */
  }
}
