import { createFileRoute, redirect } from '@tanstack/react-router'
import { ensureNamespaces } from '../lib/i18n'
import { listsEnabled } from '../features/lists/flag'
import { consumePendingFollow, getPendingFollow, takeFollowFromLink } from '../features/people/pendingFollow'
import { FollowPage } from '../features/people/FollowPage'

// The follow link (public): https://<app>/f#<code> — the code travels in the URL FRAGMENT (follows-design §2.9,
// like /i: pilot-decisions §4), never in the path, so it never reaches a server or a Referer (public/_headers: /f*
// noindex, no-referrer). The guard below keeps it in sessionStorage ('pendingFollow') AND in the address until it is
// used up (add-friends-design §1): Telegram's "Open in browser" takes the address, and a clean /f used to arrive
// there as "Dieser Link funktioniert nicht". A clean /f while a code waits in this tab (back from signing in) shows
// it again. A friend code (the QR of "Mein Code") lands here the same way.
// Opening the link sends nothing: the request goes out only on "Folgen anfragen" after sign-in.
// The flag off (§00 p. 9): the code is dropped, not kept — the page says "Bald verfügbar" and asks nobody anything.
// A light route like /i (its budget): this file and its component import only shell modules.

export const Route = createFileRoute('/f')({
  beforeLoad: ({ location }) => {
    const text = location.hash.replace(/^#/, '').trim()
    if (!listsEnabled()) {
      if (text) {
        consumePendingFollow()
        throw redirect({ to: '/f', replace: true })
      }
      return
    }
    // the newest link wins; garbage leaves the address
    const code = text ? takeFollowFromLink(text) : getPendingFollow()
    if ((code ?? '') !== text) throw redirect(code ? { to: '/f', hash: code, replace: true } : { to: '/f', replace: true })
  },
  loader: () => ensureNamespaces('people'),
  component: FollowPage,
})
