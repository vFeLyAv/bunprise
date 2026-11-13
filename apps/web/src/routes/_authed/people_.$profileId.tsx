import { createFileRoute, redirect } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { uuidParam } from '../../lib/search'
import { listsEnabled } from '../../features/lists/flag'
import { prefetchPerson } from '../../features/people/queries'
import { PersonPage } from '../../features/people/PersonPage'

// A person's card `/people/$profileId` (wave 2b, follows-design §2.8): a pushed screen (the "_" suffix — not
// nested in /people, no tab bar). ONE RPC (get_profile_card): unknown, foreign, blocked — one page. It never shows
// anybody's followers, followings or their numbers. Behind the flag: off → back to Start, no request at all.

export const Route = createFileRoute('/_authed/people_/$profileId')({
  codeSplitGroupings: [['loader', 'component']],
  params: uuidParam('profileId'),
  beforeLoad: () => {
    if (!listsEnabled()) throw redirect({ to: '/soon', replace: true })
  },
  loader: async ({ context, params }) => {
    prefetchPerson(context.queryClient, params.profileId, context.session.user.id)
    await ensureNamespaces('people', 'lists')
  },
  component: PersonRoute,
})

function PersonRoute() {
  const { profileId } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <PersonPage key={profileId} profileId={profileId} userId={session.user.id} />
}
