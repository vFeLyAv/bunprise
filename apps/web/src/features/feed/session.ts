import { onAccountEnded } from '../../lib/accountBoundary'

// In-memory state of Start (the feed) for this page session — never written to any storage
// (docs/storage-registry.md); a reload, sign-out or account change (also the in-app switch of the
// reload-loop guard, lib/accountBoundary.ts onAccountEnded) starts fresh.

/**
 * Runs `task` when the browser is idle (at the latest after `timeout` ms; without requestIdleCallback after
 * 40 % of it). Returns the cancel. Shared by Start and the tab bar (both preload what the next tap needs).
 */
export function whenIdle(task: () => void, timeout: number): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout })
    return () => window.cancelIdleCallback(id)
  }
  const timer = window.setTimeout(task, timeout * 0.4)
  return () => window.clearTimeout(timer)
}

let presented = false
let lastOpenedOccasionId: string | null = null

/** True once the feed has shown its content in this page session (later visits skip the entrance). */
export function wasFeedPresented(): boolean {
  return presented
}

export function markFeedPresented(): void {
  presented = true
}

/**
 * Shared-element transition feed card ↔ occasion hero (design-system-motion §2.5, pilot-decisions §7).
 * The occasion screen gives its hero the same name. Only the card that was opened carries it, so the
 * other cards are not lifted above the glass top bar during a transition.
 */
export { occasionTransitionName } from '../../lib/viewTransition'

export function rememberOpenedOccasion(occasionId: string): void {
  lastOpenedOccasionId = occasionId
}

/** The card the person came back from keeps the name, so the hero can shrink back into it. */
export function lastOpenedOccasion(): string | null {
  return lastOpenedOccasionId
}

/**
 * Start's view ("Liste | Monat", wave 2): the address says which one is shown (/soon or /soon?view=month); this
 * memory only remembers the last one for the tab bar's Start link, so coming back from another tab shows the
 * view you left (per page session, never stored).
 */
export type StartView = 'list' | 'month'

let startView: StartView = 'list'
const startViewListeners = new Set<() => void>()

export function rememberStartView(view: StartView): void {
  if (view === startView) return
  startView = view
  for (const listener of startViewListeners) listener()
}

export function lastStartView(): StartView {
  return startView
}

export function subscribeStartView(listener: () => void): () => void {
  startViewListeners.add(listener)
  return () => startViewListeners.delete(listener)
}

/** Account ended in this tab; also used by tests. */
export function resetFeedSession(): void {
  presented = false
  lastOpenedOccasionId = null
  rememberStartView('list')
}

onAccountEnded(resetFeedSession)
