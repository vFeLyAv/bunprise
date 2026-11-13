import { onAccountEnded } from '../../lib/accountBoundary'
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'

// /f#<code> stays in this tab until the person explicitly asks to follow ("Folgen anfragen") or says
// "Nicht jetzt" after signing in (follows-design §2.9, docs/storage-registry.md "pendingFollow") — the same
// rules as the invite link (features/invite/pending.ts): sessionStorage of the active prefix only (the account
// reset and sign-out clear every such key), the newest link wins, a malformed code drops the older one, and a
// memory copy keeps the link working within this page load when the browser blocks storage.
// The code also stays in the address's fragment until it is used up (add-friends-design §1): "Open in browser" of
// Telegram's in-app browser takes the address — a clean /f found nothing in the new browser. The lazy gate cleans the
// address when it uses the code up (FollowGate.tsx → lib/linkAddress.ts; not here: this module is a first-screen one).
// Two shapes: a follow link's 64 hex, or a short friend code (8 characters, lib/friendCode.ts; the QR of "Mein Code").
// This module is part of the /f route's beforeLoad (the shared entry chunk): keep it tiny, no API imports.

const pendingFollowKey = `${ACTIVE_STORAGE_PREFIX}pendingFollow`
/**
 * A follow link's 64 hex (= FOLLOW_TOKEN_SHAPE in lib/api/follows.types.ts) or a canonical friend code (8 characters,
 * = FRIEND_CODE_SHAPE in lib/friendCode.ts — the QR and "Code eingeben" always carry the canonical form; the forgiving
 * normalisation lives in the lazy sheet, not in this first-screen module).
 */
const CODE_SHAPE = /^(?:[0-9a-f]{64}|[0-9A-HJKMNP-TV-Z]{8})$/
let memoryCode: string | null = null
// The account reset removes the stored code (clearSessionDrafts); its memory copy goes with it.
onAccountEnded(() => {
  memoryCode = null
})

export function setPendingFollow(code: string): void {
  memoryCode = code
  try {
    window.sessionStorage.setItem(pendingFollowKey, code)
  } catch {
    /* storage unavailable: the memory copy serves this page load */
  }
}

export function getPendingFollow(): string | null {
  try {
    return window.sessionStorage.getItem(pendingFollowKey)
  } catch {
    return memoryCode
  }
}

/** Forget this view's code only; a newer link opened in the meantime must survive old callbacks. */
export function consumePendingFollow(expectedCode?: string): string | null {
  const code = getPendingFollow()
  if (expectedCode !== undefined && code !== expectedCode) return null
  memoryCode = null
  try {
    window.sessionStorage.removeItem(pendingFollowKey)
  } catch {
    /* storage unavailable */
  }
  return code
}

/** The code itself when it has one of the two shapes, else null. */
export function followCodeOf(text: string): string | null {
  return CODE_SHAPE.test(text) ? text : null
}

/**
 * The code of a link that was just opened (/f#<code>): the newest link wins. A malformed one (cut off in a
 * chat, a typo) is dropped together with any older link, so the visitor sees "invalid" at once instead of
 * after signing up. Whether the link still works is decided by the server (peek_follow_link / peek_friend_code).
 * Returns the code as it is kept (the address should show exactly that), or null.
 */
export function takeFollowFromLink(text: string): string | null {
  const code = followCodeOf(text)
  if (code) setPendingFollow(code)
  else consumePendingFollow()
  return code
}
