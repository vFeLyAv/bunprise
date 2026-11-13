import { useSyncExternalStore } from 'react'
import { onAccountEnded } from '../../lib/accountBoundary'

// The friend code shown in THIS tab ("Mein Code", add-friends-design §2.2), per account — memory only, never browser
// storage or the URL (like followLinkMemory.ts): the database keeps only its hash, so this is the one place it can
// still be shown. Opening "Mein Code" again within the tab shows the SAME code; after a reload a new one is created
// and the older ones keep working (at most 3 live, 24 hours each). An account ending forgets it immediately.

export interface RememberedFriendCode {
  /** canonical, 8 characters */
  code: string
  /** ISO: when the server lets it expire */
  expiresAt: string
}

const codes = new Map<string, RememberedFriendCode>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

onAccountEnded(() => {
  codes.clear()
  emit()
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function rememberFriendCode(userId: string, code: RememberedFriendCode): void {
  codes.set(userId, code)
  emit()
}

/** "Alle Links deaktivieren" switches the codes off on the server: the remembered one is forgotten here too. */
export function forgetFriendCode(userId: string): void {
  if (codes.delete(userId)) emit()
}

/** The remembered code of this account while it is still valid (a minute of margin), else null. */
export function rememberedFriendCode(userId: string, now: number = Date.now()): RememberedFriendCode | null {
  const code = codes.get(userId)
  return code && Date.parse(code.expiresAt) - 60_000 > now ? code : null
}

export function useRememberedFriendCode(userId: string): RememberedFriendCode | null {
  return useSyncExternalStore(subscribe, () => rememberedFriendCode(userId), () => null)
}

/** Tests only. */
export function forgetFriendCodesForTests(): void {
  codes.clear()
  emit()
}
