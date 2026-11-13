import { DEMO_MODE } from '../../lib/app'

// When the comic card «Pompon & Tapsi» shows on Start — decided with Codex on 26.10
// (docs/design/2026-10-26-manga-episode-1.md «Главный вход — решение»), pure so the tests read like the rules:
//   - never on the first day: first in the first NEW session (page load) on a later calendar day than the onboarding;
//   - only while «Erste Schritte» is not shown (closed, all done or its 14 days over) — and not in the session it was
//     shown / closed in: at most ONE optional hint per session, «Erste Schritte» and every other hint come first
//     (lib/hints.ts); a hint that comes onto the screen after it (the birthday suggestion) makes it step aside;
//   - only online (the reader is not in the offline cache);
//   - "×" or opening it: never again on this device for episode 1 (lib/hints.ts 'story-1', cleared on sign-out);
//   - not while "Kaninchen zeigen" is off (the card is a picture of the mascots; Profil › Über Bunprise still has it).
// Where: under the first section of real occasions (never above the nearest one), under the empty state, and in the
// month view under the month's agenda (features/feed/FeedPage.tsx, features/calendar/MonthView.tsx).

export interface ComicCardInput {
  /** when this page session started (ms; performance.timeOrigin) */
  sessionStart: number
  /** profiles.onboarding_done_at */
  onboardingDoneAt: string | null | undefined
  /** «Erste Schritte» is on Start right now */
  firstStepsVisible: boolean
  /** closed or opened before on this device (lib/hints.ts 'story-1') */
  seen: boolean
  /** another optional hint was shown in this session (lib/hints.ts) */
  otherHintThisSession: boolean
  /** another optional hint is on screen right now */
  otherHintOnScreen: boolean
  online: boolean
  /** "Kaninchen zeigen" (and the motion level is not "Aus") */
  bunnies: boolean
  /** demo only (`?comic=later` on the first address of the demo tab): this session counts as a later day's */
  demoLaterDay?: boolean
}

/** Calendar day in local time as a sortable number (20261031). */
export function localDay(ms: number): number {
  const d = new Date(ms)
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

export function comicCardAllowed(input: ComicCardInput): boolean {
  if (input.seen || !input.online || !input.bunnies || input.firstStepsVisible || input.otherHintOnScreen) return false
  // the demo resets on every reload, so "a later day" and "a new session" cannot happen there: the switch stands in
  if (input.demoLaterDay) return true
  if (input.otherHintThisSession) return false
  const done = Date.parse(input.onboardingDoneAt ?? '')
  return Number.isFinite(done) && localDay(input.sessionStart) > localDay(done)
}

/** When this page session started (a reload is a new session). */
export function sessionStart(): number {
  return typeof performance !== 'undefined' && performance.timeOrigin > 0 ? performance.timeOrigin : Date.now()
}

/**
 * Demo only: the first address of this tab carried `?comic=later` (e.g. http://localhost:5173/?comic=later) — the
 * card may show as soon as «Erste Schritte» is closed, in this very session (docs/handoffs/2026-10-31-comic-in-app.md).
 * Read from the navigation entry, so it survives the app's own redirects. Always false outside the demo build.
 */
export function demoLaterDay(): boolean {
  if (!DEMO_MODE || typeof performance === 'undefined') return false
  try {
    const entry = performance.getEntriesByType('navigation')[0]
    return new URL(entry?.name ?? window.location.href).searchParams.get('comic') === 'later'
  } catch {
    return false
  }
}
