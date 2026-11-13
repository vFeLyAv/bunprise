import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { GiftsPage } from '../../features/gifts/GiftsPage'

// "Geschenk finden" / Find Gift (wave 2, agent H; replaces agent F's placeholder): a top-level tab screen.
// Ideas for someone whose list I can see, or for me from my own lists — interests guessed on the device,
// invented demo products behind the stable contract of lib/api/giftIdeas.ts.
// Shell budget (the invite landing /i shares the entry chunk): the loader only makes sure the strings are
// there (`gifts`; `wishes` for the prefilled wish form; `nav` for the tab bar) — lib/i18n is in the shell
// anyway. The screen, the deck, the drawings and the API client live in the split component chunk.

export const Route = createFileRoute('/_authed/gifts')({
  loader: () => ensureNamespaces('gifts', 'wishes', 'nav'),
  component: GiftsRoute,
})

function GiftsRoute() {
  const { session } = Route.useRouteContext()
  return <GiftsPage userId={session.user.id} />
}
