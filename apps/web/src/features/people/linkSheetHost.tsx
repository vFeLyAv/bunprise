import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react'
import { onAccountEnded } from '../../lib/accountBoundary'

// Who opens the follow-link sheet (follows-design §2.9): the lists tab's [Teilen], a list's ⋯ "Folgen-Link
// teilen", the empty "Freunde" ("Deinen Link teilen") — through features/lists/links.ts — and Profil ›
// Privatsphäre "Mein Code & Link" (one row since 27.10, with "Alle Links deaktivieren"; FollowLinkSheet.tsx shows it QR-first,
// the link below; without the codes "Mein Folgen-Link") — since 27.10 the sheet is
// "Freunde hinzufügen" with three tabs: Link · QR-Code · Code eingeben (add-friends-design §2.1). The sheet itself is a lazy chunk
// (./FollowLinkSheet); a screen that offers it renders <FollowLinkSheetHost userId=… /> once. Tab memory only:
// the open state is dropped when the host leaves the screen and when the account ends in this tab.

/** The sheet's tabs: share a link · show "Mein Code" (QR + short code) · type somebody's code. */
export type FollowSheetTab = 'link' | 'code' | 'enter'

export interface FollowLinkSheetState {
  open: boolean
  /** "Alle Links deaktivieren" too (Profil › Privatsphäre) */
  manage: boolean
  /** the tab it opens on */
  tab: FollowSheetTab
}

const CLOSED: FollowLinkSheetState = { open: false, manage: false, tab: 'link' }
let state: FollowLinkSheetState = CLOSED
const listeners = new Set<() => void>()

function set(next: FollowLinkSheetState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openFollowLinkSheet(options: { manage?: boolean; tab?: FollowSheetTab } = {}): void {
  set({ open: true, manage: options.manage === true, tab: options.tab ?? 'link' })
}

export function closeFollowLinkSheet(): void {
  if (state.open) set({ ...state, open: false })
}

export function useFollowLinkSheetState(): FollowLinkSheetState {
  return useSyncExternalStore(subscribe, () => state, () => CLOSED)
}

onAccountEnded(() => {
  set(CLOSED)
})

const FollowLinkSheet = lazy(() => import('./FollowLinkSheet'))

/** Mount once per screen that offers the link: renders the lazy sheet from its first opening on. */
export function FollowLinkSheetHost({ userId }: { userId: string }) {
  const sheet = useFollowLinkSheetState()
  const [mounted, setMounted] = useState(false)
  if (sheet.open && !mounted) setMounted(true)
  // leaving the screen closes it: another screen never opens with a sheet that was meant here
  useEffect(() => () => closeFollowLinkSheet(), [])
  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <FollowLinkSheet open={sheet.open} manage={sheet.manage} tab={sheet.tab} userId={userId} onClose={closeFollowLinkSheet} />
    </Suspense>
  )
}
