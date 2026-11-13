// K10 "the bunny files it for you": after an occasion is created, the bunny carries it onto the calendar.
// Start's month view opens with `?view=month&created=<occasion id>` (features/occasions/actions.ts opens
// /soon?view=month&created=… directly): it shows that occasion's month
// and day, its day cell carries `data-landing`, and the occasion's chip in the cell (`data-landing-chip`) and
// its row stay invisible until the carry animation (mascot-ui/carry.ts, its own lazy chunk — never in the
// month view's chunk) drops the card there.
//
//   - full motion: once the screen has arrived (CARRY_DELAY_MS), the bunny pops out of the tab bar's "+",
//     hops to the cell with the card in its mouth and drops it → dispatchLanded(id) → the chip pops in,
//     the row arrives in the list, then the "Freunde einladen" pill (CalendarPage).
//     Any tap skips to the end (the card lands at once). A show that never reports back: CARRY_SAFETY_MS.
//   - reduced motion: no bunny, no flight — the chip and the row simply fade in once the screen is there.
//   - off: they are just there.
//   - Anyone may also fire the window event below (dispatchLanded) — the chip lands then.

export const CALENDAR_LANDED_EVENT = 'bunprise:calendar-landed'

/** Without a carry animation (reduced / off motion) the chip appears on its own after at most this long. */
export const LANDING_FALLBACK_MS = 0

/** The carry starts once the calendar has arrived (the screen change and the tab bar's rise are over). */
export const CARRY_DELAY_MS = 120

/** A running carry that never reports its landing: the chip appears after this at the latest. */
export const CARRY_SAFETY_MS = 2000

export interface CalendarLandedDetail {
  occasionId: string
}

/** The carry animation has put the occasion onto its day: its chip appears (with a little pop). */
export function dispatchLanded(occasionId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<CalendarLandedDetail>(CALENDAR_LANDED_EVENT, { detail: { occasionId } }))
}

export function onLanded(listener: (occasionId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<CalendarLandedDetail>).detail
    if (detail && typeof detail.occasionId === 'string') listener(detail.occasionId)
  }
  window.addEventListener(CALENDAR_LANDED_EVENT, handler)
  return () => window.removeEventListener(CALENDAR_LANDED_EVENT, handler)
}

/** Where the bunny comes from: the tab bar's "+" (where creating began), else the bottom centre of the screen. */
export function carryOrigin(): DOMRect {
  const plus = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-create-trigger]')
  const rect = plus?.getBoundingClientRect()
  if (rect && rect.width > 0) return rect
  const width = typeof window === 'undefined' ? 390 : window.innerWidth
  const height = typeof window === 'undefined' ? 844 : window.innerHeight
  return new DOMRect(width / 2 - 29, height - 96, 58, 58)
}

/**
 * The carried card's colour (wave 2): a new occasion is always yours, and on Start's month view your occasions
 * wear your colour (the accent, people.ts) — the card flies in it and becomes your chip on the day.
 */
export const CARRY_TINT = 'var(--accent-300)'

/**
 * Plays the carry (full motion only — the caller decides): the bunny brings a card in your colour from
 * `carryOrigin()` to the day cell. Resolves when the card lies on the cell (or the show could not run).
 */
export function carryOntoDay(cell: Element, layer: HTMLElement | null, signal?: AbortSignal): Promise<void> {
  return import('../mascot-ui/carry').then(
    ({ playCarry }) => playCarry({ from: carryOrigin(), to: cell, item: 'card', tint: CARRY_TINT, signal }, layer ?? undefined),
    () => undefined,
  )
}
