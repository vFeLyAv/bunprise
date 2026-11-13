import { createFileRoute } from '@tanstack/react-router'
import { uuidParam } from '../../lib/search'
import { ensureNamespaces } from '../../lib/i18n'
import { listsEnabled } from '../../features/lists/flag'
import { prefetchListScreen } from '../../features/lists/queries'
import { ListScreenPage } from '../../features/lists/ListScreenPage'

// A list without an occasion, `/lists/$listId` (follows-design §2.7): a pushed screen (the "_" suffix — not
// nested in the tab, no tab bar). ONE RPC, get_list_screen, by role: the owner branch never carries anything
// about reservations, a follower sees "Reserviert" / "Von dir reserviert". Every refusal is one page.

export const Route = createFileRoute('/_authed/lists_/$listId')({
  codeSplitGroupings: [['loader', 'component']],
  params: uuidParam('listId'),
  loader: async ({ context, params }) => {
    if (listsEnabled()) prefetchListScreen(context.queryClient, params.listId, context.session.user.id)
    await ensureNamespaces('lists', 'wishes')
  },
  component: ListRoute,
})

function ListRoute() {
  const { listId } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <ListScreenPage key={listId} listId={listId} userId={session.user.id} />
}
