// The short friend code (docs/spec/add-friends-design.md §2.2): 8 characters of Crockford Base32 (0–9 and A–Z
// without I, L, O, U) = 40 bits, shown as K7M4-QX2P. People read it aloud and type it, so the input is forgiving:
// lower case, spaces and dashes are fine, I and L read as 1, O as 0 — exactly what the database's
// private.normalize_friend_code() does. Part of the shell (the /f route keeps such a code too): keep it tiny.

/** A canonical friend code: 8 characters, upper case, no dash. */
export const FRIEND_CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{8}$/
export const FRIEND_CODE_LENGTH = 8

/** What a person typed (or a QR carried) → the canonical form; it may still be malformed (check the shape). */
export function normalizeFriendCode(text: string): string {
  return text.toUpperCase().replace(/[\s-]+/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
}

export function isFriendCode(code: string): boolean {
  return FRIEND_CODE_SHAPE.test(code)
}

/** K7M4QX2P → K7M4-QX2P (for the eye; the dash is never part of the code). */
export function formatFriendCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
