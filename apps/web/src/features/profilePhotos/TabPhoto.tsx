import { useCallback, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Me, ProfilePhotoMeta } from '../../lib/api/types'
import { queryKeys } from '../../lib/queryKeys'
import { AvatarPhoto } from './PersonPhoto'

// The tab bar's Profil avatar with my own photo (a lazy chunk: the tab bar is part of the first screen and its budget,
// features/nav/TabBar.tsx only renders this inside <Suspense fallback={null}> — the initials are there meanwhile).
// The meta comes from the cached get_me (['me'], kept fresh by the _authed guard) — read straight from the cache like
// features/nav/useMyName.ts, so the bar never sends a request of its own; my change on its way wins (photos.ts).

function photoFromMe(me: Me | undefined, userId: string): ProfilePhotoMeta | null {
  return me?.profile?.id === userId ? (me.profile.photo ?? null) : null
}

export default function TabPhoto({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const subscribe = useCallback(
    (listener: () => void) => queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash === JSON.stringify(queryKeys.me())) listener()
    }),
    [queryClient],
  )
  const meta = useSyncExternalStore(subscribe, () => photoFromMe(queryClient.getQueryData<Me>(queryKeys.me()), userId), () => null)
  return <AvatarPhoto profileId={userId} meta={meta} eager />
}
