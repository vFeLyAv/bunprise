import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, useParams } from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import type { FeedOccasion, FeedScreen, Me } from '../../lib/api/types'
import type { ListsOverview } from '../../lib/api/lists.types'
import { queryKeys } from '../../lib/queryKeys'
import { AppLayout } from './AppLayout'

// A router with the app's route ids for the signed-in layout: the pathless `_authed` layout renders
// AppLayout, its children are the four top-level screens (wave 2) and a few pushed ones (stubs).

export const USER = 'account-a'
export const OCCASION_ID = '0b7c8a1e-2222-4a5b-9c3d-000000000001'

function Stub({ name }: { name: string }) {
  const params = useParams({ strict: false }) as { occasionId?: string }
  return (
    <main>
      <p>
        {name}
        {params.occasionId ? ` ${params.occasionId}` : ''}
      </p>
    </main>
  )
}

export function feedRow(id: string, title: string, role: FeedOccasion['role'], startsAt: string): FeedOccasion {
  return {
    id, title, starts_at: startsAt, tz: 'Europe/Berlin', all_day: false, place_text: null, role,
    rsvp: role === 'host' ? 'going' : 'none', host_name: role === 'host' ? 'Mila' : 'Anna', member_count: 2, wish_count: 1,
    my_reservation_count: role === 'host' ? null : 0,
  }
}

export function me(userId: string, name: string): Me {
  return {
    profile: { id: userId, display_name: name, locale: 'de', onboarding_done_at: '2026-10-20T08:00:00Z' },
    consents_ok: true,
    legal_versions: { terms: 't', privacy: 'p', age: 'a' },
  }
}

export function renderLayout(path: string, { feed, profile, lists }: { feed?: FeedScreen; profile?: Me; lists?: ListsOverview } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (feed) queryClient.setQueryData(queryKeys.feed(), feed)
  if (profile) queryClient.setQueryData(queryKeys.me(), profile)
  if (lists) queryClient.setQueryData(['lists'], lists)
  const root = createRootRoute({ component: () => <Outlet /> })
  const authed = createRoute({ getParentRoute: () => root, id: '_authed', component: () => <AppLayout userId={USER} queryClient={queryClient} /> })
  const child = (routePath: string, name: string) => createRoute({ getParentRoute: () => authed, path: routePath, component: () => <Stub name={name} /> })
  const routeTree = root.addChildren([
    authed.addChildren([
      child('/soon', 'feed'),
      child('/lists', 'wishlists'),
      child('/lists/$listId/wishes/new', 'new list wish'),
      child('/gifts', 'gift ideas'),
      child('/settings', 'settings'),
      child('/settings/export', 'export'),
      child('/occasions/new', 'new occasion'),
      child('/occasions/$occasionId', 'occasion'),
      child('/occasions/$occasionId/wishes/new', 'new wish'),
    ]),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }), defaultPendingMinMs: 0 })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { router, queryClient, ...view }
}
