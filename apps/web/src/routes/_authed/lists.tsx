import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { listsEnabled } from '../../features/lists/flag'
import { prefetchListsOverview } from '../../features/lists/queries'
import { ListsPage } from '../../features/lists/ListsPage'

// The "Wunschlisten" tab (wave 2b, docs/spec/follows-design.md v1.2 §2.2–§2.4; its section 00 wins): the
// profile header with the banner, "Meine · Freunde", ONE RPC (get_lists_overview, memory only). Behind the
// flag (VITE_DEMO / VITE_LISTS, features/lists/flag.ts): off → a calm "Bald verfügbar" and no request at all.

export const Route = createFileRoute('/_authed/lists')({
  // the loader rides in the component's lazy chunk: the shared entry chunk (and the /i budget) does not grow
  codeSplitGroupings: [['loader', 'component']],
  loader: async ({ context }) => {
    if (listsEnabled()) prefetchListsOverview(context.queryClient, context.session.user.id)
    await ensureNamespaces('lists')
  },
  component: ListsRoute,
})

function ListsRoute() {
  const { session } = Route.useRouteContext()
  return <ListsPage userId={session.user.id} />
}
