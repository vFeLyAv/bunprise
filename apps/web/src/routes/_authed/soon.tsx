import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { compact, isUuid, optionalEnum } from '../../lib/search'
import { FeedPage, FeedPending } from '../../features/feed/FeedPage'
import { loadFeed } from '../../features/feed/loadFeed'
import type { StartView } from '../../features/feed/session'

// S5 "Start" — the main screen (product-pilot S5/F10, pilot-decisions §6). One RPC (get_feed):
// the loader puts feedQuery() into the cache (never throws, never waits offline), the screen reads
// the same entry with useQuery (docs/contract.md §4; performance-plan 3.2, 4.6).
//
// Wave 2 (Felix 2026-10-20 evening): "Liste | Monat" in the header. The address says which view shows:
// `/soon` = the list (the default, a clean URL), `?view=month` = the month calendar (the former calendar tab;
// /calendar redirects here). `?created=<occasion id>` (K10, with view=month): open that occasion's month and day,
// the bunny carries it onto its cell (features/calendar/landing.ts); dropped once it landed. Anything else is
// dropped. The tab bar's Start link remembers the view you left (features/feed/session.ts).
//
// Code splitting: the loader gets its own small chunk and the pending skeleton shares the screen's chunk, so
// neither the API layer nor the UI kit lands in the shared entry chunk that the invite landing /i also loads
// (its budget: 150 KB gz); the validator below is tiny (lib/search is in the shell anyway). The month view is a
// lazy chunk of its own (FeedPage).

interface StartSearch {
  view?: 'month'
  created?: string
}

export const Route = createFileRoute('/_authed/soon')({
  codeSplitGroupings: [['loader'], ['component', 'pendingComponent']],
  validateSearch: (search: Record<string, unknown>): StartSearch =>
    compact({ view: optionalEnum(search.view, ['month'] as const), created: isUuid(search.created) ? search.created : undefined }),
  loader: ({ context }) => loadFeed(context.queryClient),
  pendingComponent: StartPending,
  component: StartScreen,
})

function useViewSwitch(): [StartView, (view: StartView) => void] {
  const { view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const change = useCallback(
    (next: StartView) => {
      // the screen animates the change itself; the scroll position stays
      void navigate({ search: next === 'month' ? { view: 'month' } : {}, replace: true, viewTransition: false, resetScroll: false })
    },
    [navigate],
  )
  return [view ?? 'list', change]
}

function StartPending() {
  const [view, onViewChange] = useViewSwitch()
  return <FeedPending view={view} onViewChange={onViewChange} />
}

function StartScreen() {
  const { session } = Route.useRouteContext()
  const { created } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [view, onViewChange] = useViewSwitch()
  // the landing happened once: a later visit (back, swipe-back) must not replay it
  const landingDone = useCallback(() => {
    void navigate({ search: { view: 'month' }, replace: true, viewTransition: false, resetScroll: false })
  }, [navigate])
  return (
    <FeedPage
      userId={session.user.id}
      view={view}
      onViewChange={onViewChange}
      created={view === 'month' ? (created ?? null) : null}
      onLandingDone={created ? landingDone : undefined}
    />
  )
}
