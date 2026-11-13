import { redirect } from '@tanstack/react-router'
import { listsEnabled } from '../lists/flag'
import { getPendingInvite, takeInviteFromLink } from '../invite/pending'
import { followCodeOf, getPendingFollow, takeFollowFromLink } from '../people/pendingFollow'

// Signing in for a link (/login?next=/f or /i, /login/code …): the link's waiting code rides along in the address's
// fragment (add-friends-design §1.2). The in-app browsers of Telegram & co. are where people leave for "Open in
// browser" — Google refuses to sign in there — and that takes the current address: with the code in it, the new
// browser picks the code up here and the sign-up ends on the right screen. The fragment never reaches a server
// (and never goes into `next`: a query does). A lazy chunk of the sign-in routes' beforeLoad: their guards live
// here, not in the route files, so the shell does not carry them (/soon budget, 27.10). Keep it tiny.

const INVITE_SHAPE = /^[0-9a-f]{64}$/

export interface CarriedLink {
  /** the link's own screen */
  path: '/f' | '/i'
  /** its waiting code — what the address should show */
  code: string
}

/**
 * The waiting link a sign-in for `next` is about, or null. A code in the address (`hash`) that this tab does not
 * know yet — the address came from another browser — becomes this tab's waiting code first.
 */
export function carriedLink(next: string | undefined, hash: string): CarriedLink | null {
  const path = next?.split(/[?#]/, 1)[0]
  const shown = hash.replace(/^#/, '')
  if (path === '/f' && listsEnabled()) {
    if (shown && getPendingFollow() === null && followCodeOf(shown)) takeFollowFromLink(shown)
    const code = getPendingFollow()
    return code ? { path, code } : null
  }
  if (path === '/i') {
    if (shown && getPendingInvite() === null && INVITE_SHAPE.test(shown)) takeInviteFromLink(shown)
    const code = getPendingInvite()
    return code ? { path, code } : null
  }
  return null
}

type SignInMode = 'signup' | 'signin'

/**
 * /login's guard. Already signed in — e.g. "Zurück" on the first screen after signing up walks back into the sign-up
 * form: the sign-in screens are done, show the feed, or the link's screen when signing in for a link. Not signed in:
 * the link's code goes into the address, so "Open in browser" works from here too (add-friends-design §1.2).
 */
export function guardLogin(
  signedIn: boolean,
  search: { next?: string; mode?: SignInMode; method?: 'google' | 'apple' | 'email' },
  hash: string,
): void {
  const link = carriedLink(search.next, hash)
  if (signedIn) {
    if (link?.path === '/f') throw redirect({ to: '/f', hash: link.code, replace: true })
    if (link?.path === '/i') throw redirect({ to: '/i', hash: link.code, replace: true })
    throw redirect({ to: '/soon', replace: true })
  }
  if (link && hash.replace(/^#/, '') !== link.code) throw redirect({ to: '/login', search, hash: link.code, replace: true })
}

/**
 * /login/code's guard. Without an attempt in this tab (another browser: "Open in browser") the fragment goes to
 * /login with the person, which picks the code up.
 */
export async function guardCode(search: { next?: string; mode?: SignInMode }, hash: string): Promise<void> {
  const { readEmailAttempt, safeNext } = await import('./flow')
  if (!readEmailAttempt()) {
    const shown = hash.replace(/^#/, '')
    throw redirect({ to: '/login', search: { next: safeNext(search.next), mode: search.mode ?? 'signin', method: 'email' }, hash: shown || undefined, replace: true })
  }
  const link = carriedLink(search.next, hash)
  if (link && hash.replace(/^#/, '') !== link.code) throw redirect({ to: '/login/code', search, hash: link.code, replace: true })
}
