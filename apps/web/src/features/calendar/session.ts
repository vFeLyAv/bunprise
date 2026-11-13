import { onAccountEnded } from '../../lib/accountBoundary'
import type { YearMonth } from './grid'
import type { PersonKey } from './people'

// In-memory state of Start's month view for this page session — never written to any storage: coming
// back from an occasion (history back, swipe-back) shows the same month, day and people filter again; a
// reload, sign-out or account change starts at today, with everyone shown.

interface CalendarView {
  month: YearMonth
  /** the chosen day, null = the whole month */
  selected: string | null
}

let lastView: CalendarView | null = null
let lastOpenedOccasionId: string | null = null

export function rememberCalendarView(view: CalendarView): void {
  lastView = view
}

export function lastCalendarView(): CalendarView | null {
  return lastView
}

/** Calendar row ↔ occasion hero share a view-transition name (lib/viewTransition.ts), like the feed card. */
export function rememberCalendarOpened(occasionId: string): void {
  lastOpenedOccasionId = occasionId
}

export function lastCalendarOpened(): string | null {
  return lastOpenedOccasionId
}

/** The people filter (null = everyone); person keys are names or ids of people in your own feed. */
let lastFilter: ReadonlySet<PersonKey> | null = null

export function rememberCalendarFilter(filter: ReadonlySet<PersonKey> | null): void {
  lastFilter = filter
}

export function lastCalendarFilter(): ReadonlySet<PersonKey> | null {
  return lastFilter
}

export function resetCalendarSession(): void {
  lastView = null
  lastOpenedOccasionId = null
  lastFilter = null
}

onAccountEnded(resetCalendarSession)
