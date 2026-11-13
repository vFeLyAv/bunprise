import { onAccountEnded } from '../../lib/accountBoundary'

// "Freunde einladen" (K10): right after creating, the bunny files the new occasion onto the calendar and a
// pill offers to invite friends; it opens the occasion with its invite rows ("Wer kommt") in focus. The wish travels in
// memory, not in the URL (the address bar stays clean — no "#…" next to an invite link), and it is taken
// once: coming back to the screen later (history back from the wish form) does not scroll to the card again.
// Memory only; forgotten when the account ends in this tab.

let pending: string | null = null

/** The calendar's pill: the next opening of this occasion brings its invite rows into view. */
export function requestInviteFocus(occasionId: string): void {
  pending = occasionId
}

/** Pure read (safe in a useState initializer, StrictMode calls those twice). */
export function peekInviteFocus(occasionId: string): boolean {
  return pending === occasionId
}

/** The screen took it (an effect after the first render). */
export function clearInviteFocus(occasionId: string): void {
  if (pending === occasionId) pending = null
}

onAccountEnded(() => {
  pending = null
})
