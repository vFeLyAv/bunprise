import { Suspense, lazy, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toAppError } from '../../lib/errors'
import type { ListsOverview } from '../../lib/api/lists.types'
import type { ListPhotoMeta } from '../../lib/api/types'
import { Page, TopBar, useReducedMotionPref, type TileTone } from '../../ui'
import { usePageTitle } from '../auth/shared'
import { listsEnabled } from './flag'
import { ListsSoon } from './ListsPage'
import { OwnerListScreen } from './OwnerListScreen'
import { ListLoadError, ListSkeleton, ListUnavailable, useBackToLists } from './parts'
import { usePendingListDeletes } from './pendingListDeletes'
import { isListUnavailable, useListScreen, useListsOverview } from './queries'
import { coverToneOf } from './covers'
import { ListHeroCover } from './ListCover'
import { showsCover, useListCover } from './listCovers'

// `/lists/$listId` (follows-design §2.7): ONE RPC (get_list_screen), two views by role. The owner view is a
// module without any reservation code (OwnerListScreen); the follower view (GuestWishlist with "Ich schenke
// das") is its own lazy chunk — an owner never even loads it. Every refusal — unknown, "Nur ich" of someone
// else, not followed, removed, blocked, deleted (also while its delete waits for the undo) — is one page.

const FollowerListScreen = lazy(() => import('./FollowerListScreen'))

export function ListScreenPage({ listId, userId }: { listId: string; userId: string }) {
  if (!listsEnabled()) return <ListsSoon />
  return <ListScreen listId={listId} userId={userId} />
}

/** The cover of a list the tab already knows (my card, a followed list, "Bald"): the header can show it before the screen arrives. */
function knownCover(overview: ListsOverview | undefined, listId: string): { photo: ListPhotoMeta; tone: TileTone } | null {
  if (!overview) return null
  const cards = [
    ...overview.my_lists,
    ...overview.following.flatMap((person) => person.lists),
    ...overview.upcoming.map((entry) => entry.list),
  ]
  const card = cards.find((entry) => entry.id === listId && entry.photo)
  return card?.photo ? { photo: card.photo, tone: coverToneOf(card.cover_tone, card.id) } : null
}

function ListScreen({ listId, userId }: { listId: string; userId: string }) {
  const { t } = useTranslation('lists')
  const query = useListScreen(listId, userId)
  const reduced = useReducedMotionPref()
  // while the screen loads: the cover the tab already showed, so the tapped card's photo has its header to land in
  const overview = useListsOverview(userId, false).data
  const known = useMemo(() => knownCover(overview, listId), [overview, listId])
  const cover = useListCover(listId, query.data ? null : (known?.photo ?? null))
  const pendingDeletes = usePendingListDeletes()
  const back = useBackToLists()
  // a list's title is private: keep it out of the tab title / browser history
  usePageTitle(t('lists.screen.title'))

  if (pendingDeletes.has(listId) || (query.isError && isListUnavailable(query.error))) return <ListUnavailable />
  const screen = query.data
  if (!screen) {
    const topBar = <TopBar back={{ label: t('common.back'), onClick: back }} />
    return (
      <Page topBar={topBar}>
        {known && showsCover(cover) ? <ListHeroCover cover={cover} tone={known.tone} named={!reduced} /> : null}
        {query.isError && !query.isFetching ? <ListLoadError error={toAppError(query.error)} onRetry={() => void query.refetch()} /> : <ListSkeleton photo={Boolean(known)} />}
      </Page>
    )
  }
  if (screen.viewer.role === 'owner') return <OwnerListScreen screen={screen} userId={userId} />
  return (
    <Suspense fallback={<Page topBar={<TopBar back={{ label: t('common.back'), onClick: back }} />}><ListSkeleton /></Page>}>
      <FollowerListScreen screen={screen} userId={userId} />
    </Suspense>
  )
}
