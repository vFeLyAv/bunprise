import { createFileRoute, redirect } from '@tanstack/react-router'
import { getLocalSession } from '../lib/supabase'
import { AppLayout } from '../features/nav/AppLayout'

// Pathless layout = the one guard for every personal screen (framework-decision 9.2):
// 1. no session (local check, no network) → /login?next=…
// 2. session but consents missing/outdated → /welcome/profile?next=…
//    Routes opt out of step 2 with `staticData: { allowWithoutConsent: true }`.
// Child routes receive `context.session`.
// The consent check is imported lazily: anonymous visitors never load the API layer.
// Step 2 trusts this account's last successful get_me for 60 s (lib/consentGate.ts,
// docs/decisions/2026-10-20-guard-me-cache.md); preloads never refresh it in the background.
//
// The layout component (wave 1): the floating tab bar on the top-level screens, the create menu and the
// edge-swipe-back (features/nav/AppLayout.tsx). The router plugin splits it into its own lazy chunk: the
// guard above stays in the shared entry, the layout code never reaches anonymous visitors or /i.
// No legal footer on the signed-in screens (pilot-decisions §00.2, Felix 2026-10-20): Impressum,
// Datenschutz and Nutzungsbedingungen are the "Rechtliches" section of the Profil tab instead.

export const Route = createFileRoute('/_authed')({
  staticData: { legalFooter: false },
  beforeLoad: async ({ context, location, matches, preload }) => {
    const session = await getLocalSession()
    if (!session) {
      throw redirect({ to: '/login', search: { next: location.href } })
    }
    const allowWithoutConsent = matches.some((match) => match.staticData.allowWithoutConsent === true)
    if (!allowWithoutConsent) {
      const { hasCurrentConsents } = await import('../lib/consentGate')
      if (!(await hasCurrentConsents(context.queryClient, session.user.id, { refresh: !preload }))) {
        throw redirect({ to: '/welcome/profile', search: { next: location.href } })
      }
    }
    return { session }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { session, queryClient } = Route.useRouteContext()
  return <AppLayout userId={session.user.id} queryClient={queryClient} />
}
