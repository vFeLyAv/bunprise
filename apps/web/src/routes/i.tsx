import { createFileRoute, redirect } from '@tanstack/react-router'
import { ensureNamespaces } from '../lib/i18n'
import { getPendingInvite, takeInviteFromLink } from '../features/invite/pending'
import { InvitePage } from '../features/invite/InvitePage'

// S10 invite landing (public): https://<app>/i#<token> — the token travels in the URL FRAGMENT
// (pilot-decisions §4), never in the path, so it never reaches a server or a Referer. The guard below keeps it
// in sessionStorage AND in the address until the person joins (add-friends-design §1): "Open in browser" of an
// in-app browser (Telegram …) takes the address — a clean /i used to arrive there as invalid. A malformed token
// leaves the address at once; a clean /i while a token waits in this tab (back from signing in) shows it again.
// The lightest route (budget /i ≤ 150 KB gz, docs/contract.md §10): this file and its component
// import only shell modules. The bunny and the signed-in "Beitreten" screen are separate lazy
// chunks (features/invite/InvitePage.tsx). Opening the link never joins (pilot-decisions §0.15).

export const Route = createFileRoute('/i')({
  beforeLoad: ({ location }) => {
    const shown = location.hash.replace(/^#/, '').trim()
    const token = shown ? (takeInviteFromLink(shown) ? shown : null) : getPendingInvite()
    if ((token ?? '') !== shown) throw redirect(token ? { to: '/i', hash: token, replace: true } : { to: '/i', replace: true })
  },
  loader: () => ensureNamespaces('invite'),
  component: InvitePage,
})
