import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { NewOccasionPage } from '../../features/occasions/NewOccasionPage'

// S6 create an occasion (title + date required; the wishlist is created automatically).

export const Route = createFileRoute('/_authed/occasions/new')({
  loader: () => ensureNamespaces('occasion', 'occasionForm'),
  component: NewOccasionRoute,
})

function NewOccasionRoute() {
  return <NewOccasionPage userId={Route.useRouteContext().session.user.id} />
}
