import { lazy, Suspense } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { FeedOccasion, OccasionPhotoMeta, OccasionScreen } from '../../lib/api/types'
import { qk } from '../../lib/queryKeys'
import type { ThemeId } from '../occasions/covers/themes'

// The occasion's cover on its Start card (Felix 25.10: "lebendiger und verständlicher"). This file is the EAGER
// half and stays tiny (Start is the first screen, budget 200 KB): the box in the card's tint, laid out from the
// first frame when the feed's meta says there is a photo (no layout jump). The lazy half (FeedCoverImage) takes the
// box over: after the first paint and once the card is near the viewport it loads the bytes. No photo, an older
// server (no `photo` key) or a cover that cannot be loaded: the card looks as before / keeps its tint.

const FeedCoverImage = lazy(() => import('./FeedCoverImage'))
// Felix 26.10: no photo, but a stored motif (occasions.cover_theme) — our own picture in the same box (a lazy chunk)
const FeedMotif = lazy(() => import('../occasions/covers/FeedMotif'))

/**
 * The cover meta the card shows: the feed's — unless the occasion screen in this tab knows a newer one (the host
 * just changed the photo there and comes back to Start before the feed refreshed: show the new one at once).
 */
export function coverMetaOf(occasion: FeedOccasion, queryClient: QueryClient): OccasionPhotoMeta | null {
  const screen = queryClient.getQueryState<OccasionScreen>(qk.occasion(occasion.id))
  if (screen?.data && screen.dataUpdatedAt > (queryClient.getQueryState(qk.feed())?.dataUpdatedAt ?? 0)) return screen.data.occasion.photo ?? null
  return occasion.photo ?? null
}

export function FeedCover({ occasionId, meta }: { occasionId: string; meta: OccasionPhotoMeta }) {
  return (
    // "loading" also before the lazy half is there: the launch screen waits for covers marked so (lib/splash.ts)
    <Suspense fallback={<span aria-hidden="true" className="feed-cover" data-state="loading" />}>
      <FeedCoverImage occasionId={occasionId} meta={meta} />
    </Suspense>
  )
}

export function FeedMotifCover({ theme }: { theme: ThemeId }) {
  return (
    <Suspense fallback={<span aria-hidden="true" className="feed-cover" data-state="loading" />}>
      <FeedMotif theme={theme} />
    </Suspense>
  )
}
