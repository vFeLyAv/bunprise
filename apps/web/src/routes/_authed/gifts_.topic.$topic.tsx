import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { TopicPage } from '../../features/gifts/topics/TopicPage'

// One shelf of "Stöbern nach Thema" (Felix 26.10, docs/design/2026-10-26-ideas-categories.md): `/gifts/topic/$topic`,
// a pushed screen (the "_" suffix — not nested in the tab, no tab bar), opened from the row under the Ideen deck.
// Shell budget (/soon is close to its 200 KB): this definition stays as small as it can — no param parser here; the
// screen itself checks the id (an unknown one gets a calm "not there" page). The screen, its drawings, the game
// animations and the API client live in the split component chunk.

export const Route = createFileRoute('/_authed/gifts_/topic/$topic')({
  loader: () => ensureNamespaces('gifts', 'wishes'),
  component: TopicRoute,
})

function TopicRoute() {
  const { topic } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <TopicPage key={topic} userId={session.user.id} topic={topic} />
}
