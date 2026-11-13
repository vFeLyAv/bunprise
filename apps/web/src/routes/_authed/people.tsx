import { createFileRoute, redirect } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { compact, optionalEnum } from '../../lib/search'
import { listsEnabled } from '../../features/lists/flag'
import { prefetchPeopleScreen } from '../../features/people/queries'
import { PeoplePage, type PeopleSection } from '../../features/people/PeoplePage'

// "Follower & Anfragen" `/people` (wave 2b, follows-design §2.10): a pushed screen (no tab bar — not in
// features/nav/tabs.ts ROUTE_TABS), ONE RPC (get_people_screen, memory only). `?section=requests|blocked` brings
// that section into view ("2 Anfragen ›" in the lists tab, Profil › "Blockierte Personen").
// Behind the flag (VITE_DEMO / VITE_LISTS, features/lists/flag.ts): off → back to Start, no request at all.

const SECTIONS: readonly PeopleSection[] = ['requests', 'blocked']

export const Route = createFileRoute('/_authed/people')({
  // the loader rides in the component's lazy chunk: the shared entry chunk (and the /i budget) does not grow
  codeSplitGroupings: [['loader', 'component']],
  validateSearch: (search: Record<string, unknown>): { section?: PeopleSection } => compact({ section: optionalEnum(search.section, SECTIONS) }),
  beforeLoad: () => {
    if (!listsEnabled()) throw redirect({ to: '/soon', replace: true })
  },
  loader: async ({ context }) => {
    prefetchPeopleScreen(context.queryClient, context.session.user.id)
    await ensureNamespaces('people', 'lists')
  },
  component: PeopleRoute,
})

function PeopleRoute() {
  const { session } = Route.useRouteContext()
  const { section } = Route.useSearch()
  return <PeoplePage userId={session.user.id} section={section} />
}
