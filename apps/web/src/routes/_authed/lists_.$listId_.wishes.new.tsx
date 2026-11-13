import { createFileRoute } from '@tanstack/react-router'
import { uuidParam } from '../../lib/search'
import { ensureNamespaces } from '../../lib/i18n'
import { ListNewWishPage } from '../../features/lists/ListNewWishPage'

// "+ Wunsch" on a list without an occasion (follows-design §2.7): the same link-first WishForm as an
// occasion's list, targeting this list (owner only). Own screen, not nested ("_" suffixes).

export const Route = createFileRoute('/_authed/lists_/$listId_/wishes/new')({
  params: uuidParam('listId'),
  loader: () => ensureNamespaces('wishes', 'lists'),
  component: NewListWishRoute,
})

function NewListWishRoute() {
  const { listId } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <ListNewWishPage key={listId} listId={listId} userId={session.user.id} />
}
