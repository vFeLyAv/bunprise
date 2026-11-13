import { useSyncExternalStore } from 'react'
import { onAccountEnded } from '../../lib/accountBoundary'

// Open / closed state of the create menu (K5), shared by the tab bar's "+" (the trigger) and the lazy
// menu itself without a React context: the menu chunk loads on first use, the bar never waits for it.
//
// Three phases: 'open' → 'closing' (the menu's exit animation runs: the page is usable again at once,
// but the bar's "+" stays lifted above the fading scrim) → 'closed' (the menu reported the end of its
// exit, or no menu was mounted at all). The bar's "+" is the ONE button the person sees in every phase:
// it turns into "×" and back in place (TabBar.tsx); the menu never draws a second one.

export type CreateMenuPhase = 'closed' | 'open' | 'closing'

/** A mounted menu reports the end of its exit; should that report never come, the phase settles after this. */
const SETTLE_FALLBACK_MS = 1200

let phase: CreateMenuPhase = 'closed'
let entry: 'choose' | 'wish' = 'choose'
let opening = 0
let mounted = 0
let settleTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function clearSettleTimer(): void {
  if (settleTimer !== null) clearTimeout(settleTimer)
  settleTimer = null
}

function setPhase(next: CreateMenuPhase): void {
  if (phase === next) return
  phase = next
  emit()
}

export const createMenu = {
  isOpen: (): boolean => phase === 'open',
  phase: (): CreateMenuPhase => phase,
  entry: (): 'choose' | 'wish' => entry,
  openingKey: (): string => String(opening),
  open(initial: 'choose' | 'wish' = 'choose'): void {
    if (phase !== 'open') opening += 1
    entry = initial
    clearSettleTimer()
    setPhase('open')
  },
  close(): void {
    if (phase !== 'open') return
    if (mounted === 0) {
      setPhase('closed')
      return
    }
    setPhase('closing')
    clearSettleTimer()
    settleTimer = setTimeout(() => createMenu.settled(), SETTLE_FALLBACK_MS)
  },
  /** The menu's exit animation is over (CreateMenu: AnimatePresence onExitComplete). */
  settled(): void {
    if (phase !== 'closing') return
    clearSettleTimer()
    setPhase('closed')
  },
  /** CreateMenu is mounted (its chunk loaded): closing waits for its exit. Returns the detach. */
  attach(): () => void {
    mounted += 1
    let attached = true
    return () => {
      if (!attached) return
      attached = false
      mounted -= 1
      if (mounted === 0) createMenu.settled()
    }
  },
}

/** True while the menu is open (not while it is closing). */
export function useCreateMenuOpen(): boolean {
  return useSyncExternalStore(subscribe, createMenu.isOpen, () => false)
}

/** Distinguishes a fresh opening even if close/open happened before React painted. */
export function useCreateMenuOpening(): string {
  return useSyncExternalStore(subscribe, createMenu.openingKey, () => '0')
}

/** 'open' · 'closing' (exit animation running) · 'closed'. */
export function useCreateMenuPhase(): CreateMenuPhase {
  return useSyncExternalStore(subscribe, createMenu.phase, () => 'closed')
}

/** Tests only: closed, nothing pending. */
export function resetCreateMenuForTests(): void {
  clearSettleTimer()
  phase = 'closed'
  entry = 'choose'
  emit()
}

onAccountEnded(resetCreateMenuForTests)

/** id of the menu's dialog (aria-controls of the "+") */
export const CREATE_MENU_ID = 'bp-create-menu'
