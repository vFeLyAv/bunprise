import { onAccountEnded } from '../../lib/accountBoundary'

// Which catalogue photos were already on screen in this page session (Felix 28.10 «фотки дёргаются, когда я
// перехожу с Ideen на Profil и обратно» + «не держать все фотографии загруженными»):
// - the app keeps NO photo bytes of its own: a photo is a plain path of our Worker ("/api/gift-ideas/img/…"),
//   the browser keeps it in its own HTTP cache (the Worker answers `private, max-age=86400`) and in its memory
//   only while an <img> shows it — the ≤ 3 cards of the deck, plus the copy of the Ideen screen
//   (features/nav/tabCopies.ts) while another tab is open;
// - this module remembers only the ADDRESSES (short strings) of the last SHOWN_PHOTOS_MAX photos that were shown,
//   oldest forgotten first (LRU): such a photo comes back without lazy loading and is decoded with the frame it
//   appears in (`decoding="sync"`) — no empty plate first. A photo forgotten here simply loads as on a first visit.
// Memory only, never persisted, forgotten when the account ends in this tab.

/** The deck shows 3 cards, a shelf sheet a few more: 48 addresses ≈ a few KB, whatever is browsed. */
export const SHOWN_PHOTOS_MAX = 48

// a Map keeps insertion order: the first key is the least recently shown
const shown = new Map<string, true>()

/** This photo has been on screen (its <img> loaded): it is the most recently shown one now. */
export function rememberShownPhoto(url: string | null | undefined): void {
  if (!url) return
  shown.delete(url)
  shown.set(url, true)
  while (shown.size > SHOWN_PHOTOS_MAX) {
    const oldest = shown.keys().next().value
    if (oldest === undefined) break
    shown.delete(oldest)
  }
}

/** Was this photo shown lately in this page session? Then it comes back at once (no lazy load, sync decode). */
export function wasPhotoShown(url: string | null | undefined): boolean {
  return url ? shown.has(url) : false
}

/** How many addresses are remembered (tests: the bound holds). */
export function shownPhotoCount(): number {
  return shown.size
}

export function forgetShownPhotos(): void {
  shown.clear()
}

onAccountEnded(forgetShownPhotos)
