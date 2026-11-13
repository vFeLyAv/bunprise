import { useEffect, useState } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { getOccasionPhoto } from '../../../lib/api/photos'
import type { OccasionPhotoMeta } from '../../../lib/api/types'
import { isUnavailable } from '../data'

// The cover's bytes: get_occasion_photo() (the documented second RPC of the occasion screen, lib/api/photos.ts).
// One cache entry per photo VERSION (occasion.photo.updated_at of the screen), so a replaced cover is a new
// key and an unchanged one is never fetched twice. Memory only: the persistence allow-list is the exact
// ['feed'] (lib/query.ts) and the account boundary clears the whole cache.

export const photoQueryKey = (occasionId: string, version: string) => ['occasionPhoto', occasionId, version] as const

export function occasionPhotoQuery(occasionId: string, version: string) {
  return queryOptions({
    queryKey: photoQueryKey(occasionId, version),
    // a wrapper: the optional parameter of getOccasionPhoto is the expected account, not the query context
    queryFn: () => getOccasionPhoto(occasionId),
    staleTime: Infinity, // a version never changes
    gcTime: 10 * 60_000,
    // "not found / no access" is a final answer (the hero simply has no photo then)
    retry: (failures, error) => !isUnavailable(error) && failures < 1,
  })
}

/** The bytes of the screen's cover, once `enabled` (after the screen's first paint). */
export function useOccasionPhoto(occasionId: string, meta: OccasionPhotoMeta | null | undefined, enabled = true) {
  return useQuery({
    ...occasionPhotoQuery(occasionId, meta?.updated_at ?? 'none'),
    enabled: enabled && Boolean(meta),
  })
}

/**
 * false in the first render, true once that frame is on screen (rAF runs right before the paint; the timeout
 * queued from it runs after it): the cover's bytes start only after the screen itself is visible.
 */
export function useAfterFirstPaint(): boolean {
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setPainted(true), 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  return painted
}

// Object URLs of the covers: lib/objectUrl.ts (shared with the wish photos).
export { useObjectUrl } from '../../../lib/objectUrl'
