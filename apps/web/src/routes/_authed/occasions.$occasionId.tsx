import { createFileRoute } from '@tanstack/react-router'
import { uuidParam } from '../../lib/search'
import { ensureNamespaces } from '../../lib/i18n'
import { prefetchOccasionScreen } from '../../features/occasions/data'
import { OccasionPage } from '../../features/occasions/OccasionPage'

// S7 occasion screen: one route, two views by role (host / guest), one RPC
// (occasionScreenQuery). Hosts never receive reservation data (data-and-secrecy.md 5.6).

export const Route = createFileRoute('/_authed/occasions/$occasionId')({
  // The loader is split into the component's lazy chunk: the shared entry chunk (and with it the
  // tight /i budget) does not grow; intent preloading still runs it early (feed cards: hover/focus only).
  codeSplitGroupings: [['loader', 'component']],
  params: uuidParam('occasionId'),
  loader: async ({ context, params }) => {
    prefetchOccasionScreen(context.queryClient, params.occasionId)
    await ensureNamespaces('occasion', 'wishes', 'invite')
  },
  component: OccasionRoute,
})

function OccasionRoute() {
  const { occasionId } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <OccasionPage key={occasionId} occasionId={occasionId} userId={session.user.id} />
}
