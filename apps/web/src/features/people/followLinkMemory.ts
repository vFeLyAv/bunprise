import { useSyncExternalStore } from 'react'
import { onAccountEnded } from '../../lib/accountBoundary'

// The follow link handed out in THIS tab, per account — memory only, never browser storage or the URL
// (follows-design §2.9; the pattern of features/occasions/inviteLink.ts). The database keeps only the code's
// hash, so this is the one place it can still be shown: "Teilen" again within the tab shares the SAME link
// instead of creating a new one (at most 5 live links — the 6th switches the oldest off). An account ending
// forgets it immediately, including an in-page switch; the links keep working on the server for 30 days.

export interface RememberedFollowLink {
  url: string
  /** ISO: when the server lets it expire */
  expiresAt: string
}

const links = new Map<string, RememberedFollowLink>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

onAccountEnded(() => {
  links.clear()
  emit()
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function rememberFollowLink(userId: string, link: RememberedFollowLink): void {
  links.set(userId, link)
  emit()
}

/** "Alle Links deaktivieren": the remembered code is dead on the server, so it is forgotten here too. */
export function forgetFollowLink(userId: string): void {
  if (links.delete(userId)) emit()
}

/** The remembered link of this account while it is still valid, else null. */
export function rememberedFollowLink(userId: string, now: number = Date.now()): RememberedFollowLink | null {
  const link = links.get(userId)
  return link && Date.parse(link.expiresAt) > now ? link : null
}

export function useRememberedFollowLink(userId: string): RememberedFollowLink | null {
  return useSyncExternalStore(subscribe, () => rememberedFollowLink(userId), () => null)
}

/** Tests only. */
export function forgetFollowLinksForTests(): void {
  links.clear()
  emit()
}
