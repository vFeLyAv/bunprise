import { ACTIVE_STORAGE_PREFIX } from './app'

// The account boundary of one tab (Codex review 2026-10-20, H1–H3). Everything a tab shows belongs to
// ONE account. When that account ends in the tab (another account signs in, it signs out — also in
// another tab), lib/session.ts rebuilds the whole page. This module is part of the shell and imports no
// API code; it holds what feature code needs for its late callbacks:
// - the epoch: +1 whenever a known signed-in account ends in this tab. An action captures it when it
//   starts (`captureEpoch()`) and does nothing with its answer — no toast, cache write, mascot,
//   clipboard/share or navigation — once `isCurrent()` is false;
// - the account the screens were rendered for (reported by the session watcher): feature code passes it
//   to the API wrappers as the expected account, so a request never silently switches accounts;
// - the page state while it is replaced: leaving (full reload) or switching accounts in-app (the
//   reload-loop guard) — hidden and inert either way, and no account screen is rendered (gate closed);
// - "account ended" listeners: feature modules that keep memory outside React and the query cache
//   (save states, form drafts, memory copies of session drafts) forget it when the account ends;
// - the BroadcastChannel that tells the other tabs of this device that an account was cleared here.

/** Channel name (`bunprise.session`; the demo build keeps its own `bunprise.demo.session`). */
export const SESSION_CHANNEL = `${ACTIVE_STORAGE_PREFIX}session`

export interface AccountClearedMessage {
  type: 'account-cleared'
  userId: string
}

let epoch = 0
let rendered: string | null | undefined
let leaving = false

export interface AccountEpoch {
  /** The account the screen belonged to when the action started (undefined while none is known). */
  readonly userId: string | undefined
  /** False once that account ended in this tab or the page is being replaced. */
  isCurrent(): boolean
}

/** Capture when an action starts; check `isCurrent()` before every side effect of its answer. */
export function captureEpoch(): AccountEpoch {
  const captured = epoch
  const userId = typeof rendered === 'string' ? rendered : undefined
  return { userId, isCurrent: () => !leaving && captured === epoch }
}

/** Session watcher: the account this tab shows (null = signed out, undefined = not observed yet). */
export function setRenderedAccount(userId: string | null | undefined): void {
  rendered = userId
}

export function renderedAccount(): string | null | undefined {
  return rendered
}

const endedListeners = new Set<() => void>()

/**
 * Module memory of the shown account (round-2 review): feature modules register what they keep
 * outside React and the query cache, and forget it when that account ends in this tab. The full
 * reload clears module memory anyway; the in-app switch of the reload-loop guard keeps the
 * JavaScript realm, so without this A's module state would shape B's screens. Returns the
 * unsubscribe function (modules register once at load and never unsubscribe).
 */
export function onAccountEnded(listener: () => void): () => void {
  endedListeners.add(listener)
  return () => {
    endedListeners.delete(listener)
  }
}

/** A known signed-in account ended in this tab: every epoch captured before becomes stale. */
export function endAccountEpoch(): void {
  epoch += 1
  for (const listener of Array.from(endedListeners)) {
    try {
      listener()
    } catch {
      /* one module's cleanup never stops the account reset */
    }
  }
}

/** True between the decision to reload and the unload (see markPageLeaving). */
export function isPageLeaving(): boolean {
  return leaving
}

/** Nothing of the page can be seen or used: portals and toasts included (they live in <body>). */
function hidePage(): void {
  try {
    document.documentElement.style.visibility = 'hidden'
    document.body.setAttribute('inert', '')
  } catch {
    /* no document (tests without DOM) */
  }
}

function showPage(): void {
  try {
    document.documentElement.style.visibility = ''
    document.body.removeAttribute('inert')
  } catch {
    /* no document */
  }
}

// ---- the page while it is replaced: a full reload (leaving) or an in-app switch (switching) ---

/** True during an in-app account switch (the reload-loop guard of lib/session.ts). */
let switching = false
/** AccountSwitchGate: notified whenever `switching` or `leaving` changes. */
const switchListeners = new Set<() => void>()

function emitSwitch(): void {
  for (const listener of switchListeners) listener()
}

/**
 * The page is about to be replaced by a full reload: nothing may start or finish any more, and the
 * previous account's screen (portals and toasts included) is hidden and inert until the new page loads.
 * AccountSwitchGate closes as well (round-2 review): the previous account's screens unmount at once.
 * Mounted (even hidden), any re-render — a network change, a reverted refetch — would rebuild a query
 * that the reset removed and fetch it with the account that is current NOW.
 */
export function markPageLeaving(): void {
  leaving = true
  hidePage()
  emitSwitch()
}

/**
 * The tab moves to another account inside the page (round-1 review: the reload-loop guard path).
 * From now until finishAccountSwitch() the page is hidden and inert — the previous account's screen,
 * its portals and toasts included — and AccountSwitchGate renders no routed screen, so every screen
 * of the next account is built anew (also when it is the same route, e.g. /soon → /soon).
 */
export function startAccountSwitch(): void {
  switching = true
  hidePage()
  emitSwitch()
}

/**
 * The next account's screen has rendered: show the page again. Never while a reload is on its way:
 * then the page stays hidden and the gate closed (no screen is built again for a page that goes).
 */
export function finishAccountSwitch(): void {
  if (!switching || leaving) return
  switching = false
  showPage()
  emitSwitch()
}

/** True while an in-app account switch is in progress. */
export function isAccountSwitching(): boolean {
  return switching
}

/**
 * True while no account screen (routed screens, toast viewport) may be rendered: an in-app account
 * switch, or the page is being replaced (AccountSwitchGate's useSyncExternalStore snapshot).
 */
export function isAccountGateClosed(): boolean {
  return switching || leaving
}

export function subscribeAccountSwitch(listener: () => void): () => void {
  switchListeners.add(listener)
  return () => {
    switchListeners.delete(listener)
  }
}

// ---- other tabs (H3) ------------------------------------------------------------------------

let channel: BroadcastChannel | null = null
const clearedListeners = new Set<(userId: string) => void>()

function isClearedMessage(data: unknown): data is AccountClearedMessage {
  if (typeof data !== 'object' || data === null) return false
  const message = data as Record<string, unknown>
  return message.type === 'account-cleared' && typeof message.userId === 'string' && message.userId !== ''
}

function openChannel(): BroadcastChannel | null {
  if (channel) return channel
  try {
    if (typeof BroadcastChannel !== 'function') return null
    const opened = new BroadcastChannel(SESSION_CHANNEL)
    opened.onmessage = (event: MessageEvent) => {
      if (!isClearedMessage(event.data)) return
      for (const listener of clearedListeners) listener(event.data.userId)
    }
    channel = opened
  } catch {
    channel = null // unavailable: the storage event on the auth key still reports sign-outs (lib/session.ts)
  }
  return channel
}

function closeUnusedChannel(): void {
  if (!channel || clearedListeners.size > 0) return
  try {
    channel.close()
  } catch {
    /* already closed */
  }
  channel = null
}

/**
 * Tell the other tabs of this device that `userId` was signed out or deleted here. Called right
 * before this tab's own reload; a tab that already shows another account ignores it.
 */
export function announceAccountCleared(userId: string): void {
  const open = openChannel()
  try {
    open?.postMessage({ type: 'account-cleared', userId } satisfies AccountClearedMessage)
  } catch {
    /* closed or unavailable: the storage event on the removed auth key remains */
  }
  closeUnusedChannel()
}

/** Announcements of the other tabs (a tab never receives its own). Returns the unsubscribe function. */
export function onAccountCleared(listener: (userId: string) => void): () => void {
  clearedListeners.add(listener)
  openChannel()
  return () => {
    clearedListeners.delete(listener)
    closeUnusedChannel()
  }
}

/** Tests only: a fresh tab (epoch 0, nothing observed, page visible, no switch, channel closed). */
export function resetAccountBoundaryForTests(): void {
  epoch = 0
  rendered = undefined
  leaving = false
  switching = false
  clearedListeners.clear()
  closeUnusedChannel()
  showPage()
}
