import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { WelcomePage } from '../../features/onboarding/WelcomePage'

// S4 onboarding (product-pilot S4/F3, brief 5.4): at most three steps, the bunny greets by name,
// "Überspringen" visible from the first frame; finishing or skipping records onboarding_done_at.
// The screen (and the lazy mascot) lives in features/onboarding — only the split component chunk
// imports it, the loader stays tiny.

export const Route = createFileRoute('/_authed/welcome')({
  loader: () => ensureNamespaces('onboarding'),
  component: WelcomeRoute,
})

function WelcomeRoute() {
  return <WelcomePage userId={Route.useRouteContext().session.user.id} />
}
