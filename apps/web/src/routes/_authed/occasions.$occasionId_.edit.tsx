import { createFileRoute } from '@tanstack/react-router'
import { uuidParam } from '../../lib/search'
import { ensureNamespaces } from '../../lib/i18n'
import { prefetchOccasionScreen } from '../../features/occasions/data'
import { EditOccasionPage } from '../../features/occasions/EditOccasionPage'

// S6 edit an occasion (host only). Own screen, not nested in S7 ("_" suffix in the file name).

export const Route = createFileRoute('/_authed/occasions/$occasionId_/edit')({
  // loader travels with the component chunk (see occasions.$occasionId.tsx)
  codeSplitGroupings: [['loader', 'component']],
  params: uuidParam('occasionId'),
  loader: async ({ context, params }) => {
    prefetchOccasionScreen(context.queryClient, params.occasionId)
    await ensureNamespaces('occasion', 'occasionForm')
  },
  component: EditOccasionRoute,
})

function EditOccasionRoute() {
  const { occasionId } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <EditOccasionPage key={occasionId} occasionId={occasionId} userId={session.user.id} />
}
