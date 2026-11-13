import { onAccountEnded } from '../../lib/accountBoundary'
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'

// /i#<token> stays in this tab until the person explicitly joins after signing in
// (pilot-decisions §4, §0.15; docs/storage-registry.md "pendingInvite"). sessionStorage only; the
// memory copy keeps the link working within this page load when the browser blocks storage. The token also
// stays in the address's fragment until it is used (add-friends-design §1): "Open in browser" of an in-app browser
// takes the address — a clean /i used to arrive there as an invalid invitation. The lazy JoinGate cleans the address
// when it uses the token (lib/linkAddress.ts; not here: this module is a first-screen one).
// This module is part of the shell (routes/i.tsx beforeLoad): keep it tiny, no API imports.
const pendingInviteKey = `${ACTIVE_STORAGE_PREFIX}pendingInvite`
/** The shape create_invite() returns (= isInviteTokenShape() in lib/api/invites.ts). */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/
let memoryToken: string | null = null
// The account reset removes the stored link (clearSessionDrafts); its memory copy goes with it.
onAccountEnded(() => {
  memoryToken = null
})

export function setPendingInvite(token: string): void {
  memoryToken = token
  try {
    window.sessionStorage.setItem(pendingInviteKey, token)
  } catch {
    /* storage unavailable: the memory copy serves this page load */
  }
}

export function getPendingInvite(): string | null {
  try {
    return window.sessionStorage.getItem(pendingInviteKey)
  } catch {
    return memoryToken
  }
}

/** Returns the token and forgets it (call right before accept_invite). */
export function consumePendingInvite(): string | null {
  const token = getPendingInvite()
  memoryToken = null
  try {
    window.sessionStorage.removeItem(pendingInviteKey)
  } catch {
    /* storage unavailable */
  }
  return token
}

/**
 * The token of a link that was just opened (/i#<token>): the newest link wins. A malformed one
 * (cut off in a chat, typo) is dropped together with any older link, so the visitor sees "invalid"
 * right away instead of after signing up. Validity itself is decided by the server (accept_invite).
 * True when the token was kept (the address may keep showing it).
 */
export function takeInviteFromLink(token: string): boolean {
  const kept = TOKEN_SHAPE.test(token)
  if (kept) setPendingInvite(token)
  else consumePendingInvite()
  return kept
}
