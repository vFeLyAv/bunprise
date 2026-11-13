import { onAccountEnded } from '../../lib/accountBoundary'

// "Wieder feiern?" (the birthday suggestion on Start, features/birthdays): "Neuer Anlass" opens with the title and this
// year's date — nothing else (no photo, place or guests: Felix 27.10, «на события добавляет свое фото, в этом году может
// быть другое место … другие люди»). The wish travels in memory, not in the URL (an occasion title stays out of the
// address bar and the history), and is taken once. Forgotten when the account ends in this tab.

export interface OccasionPrefill {
  title: string
  /** "YYYY-MM-DD" */
  date: string
}

let pending: { userId: string; prefill: OccasionPrefill } | null = null

export function requestOccasionPrefill(userId: string, prefill: OccasionPrefill): void {
  pending = { userId, prefill }
}

/** Pure read (safe in a useState initializer). */
export function peekOccasionPrefill(userId: string): OccasionPrefill | null {
  return pending?.userId === userId ? pending.prefill : null
}

/** The form took it (an effect after the first render). */
export function clearOccasionPrefill(userId: string): void {
  if (pending?.userId === userId) pending = null
}

onAccountEnded(() => {
  pending = null
})
