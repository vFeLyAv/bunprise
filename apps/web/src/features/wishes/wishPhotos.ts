import { useQuery, type QueryClient } from '@tanstack/react-query'
import { captureEpoch } from '../../lib/accountBoundary'
import { deleteWishPhoto, getWishPhoto, uploadWishPhoto, type WishPhoto } from '../../lib/api/wishPhotos'
import type { WishPhotoMeta } from '../../lib/api/types'
import { isAppError } from '../../lib/errors'
import type { PreparedPhoto } from '../occasions/photo/pipeline'
import { resetInViewForTests } from './inView'

// The product photo of a wish on screen (lib/api/wishPhotos.ts; privacy: the browser never talks to a shop).
// - Bytes come ONLY from our database (getWishPhoto → Blob → lib/objectUrl.ts object URL, revoked when gone).
// - One cache entry per photo VERSION: ['wishPhoto', wishId, photo.updated_at] — a replaced photo is a new key,
//   an unchanged one is never fetched twice. Memory only (the persisted allow-list is exactly ['feed'],
//   lib/query.ts), and the account boundary clears the whole cache.
// - Lists stay fast: a row asks for its bytes only once it is (nearly) on screen (useInView) and at most
//   MAX_PARALLEL photo requests run at the same time (the rest wait their turn).

export const wishPhotoKey = (wishId: string, version: string) => ['wishPhoto', wishId, version] as const

/** Photo requests running at the same time (a long list never fires 40 RPCs at once). */
export const MAX_PARALLEL = 3
let running = 0
const waiting: Array<() => void> = []

/** Runs `task` when one of the MAX_PARALLEL slots is free. */
export function limited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running += 1
      task().then(resolve, reject).finally(() => {
        running -= 1
        waiting.shift()?.()
      })
    }
    if (running < MAX_PARALLEL) start()
    else waiting.push(start)
  })
}

/** "Not found / no access" is a final answer (the wish simply shows its tile then). */
function isFinal(error: unknown): boolean {
  return isAppError(error, 'not_found') || isAppError(error, 'not_allowed') || isAppError(error, 'forbidden')
}

// (a plain options object: queryOptions() would pull one more tiny shared chunk into the Start screen)
export function wishPhotoQuery(wishId: string, version: string) {
  return {
    queryKey: wishPhotoKey(wishId, version),
    queryFn: () => {
      // pinned to the account this tab shows right now (an answer for another account never lands)
      const { userId } = captureEpoch()
      return limited(() => getWishPhoto(wishId, userId))
    },
    staleTime: Infinity, // a version never changes
    gcTime: 10 * 60_000,
    retry: (failures: number, error: unknown) => !isFinal(error) && failures < 1,
    refetchOnWindowFocus: false,
  }
}

/**
 * The bytes of a wish's photo once `enabled`. `meta` null = no photo (nothing is asked); `undefined` = not known
 * (the edit screen opened by a deep link: REST rows carry no photo meta) → asked once, "not found" = none.
 */
export function useWishPhoto(wishId: string, meta: WishPhotoMeta | null | undefined, enabled = true) {
  return useQuery({
    ...wishPhotoQuery(wishId, meta === undefined ? 'probe' : (meta?.updated_at ?? 'none')),
    enabled: enabled && meta !== null,
  })
}

// ---- "is this row (nearly) on screen?" — one shared IntersectionObserver (inView.ts, shared with shop icons) ----

// a direct re-export: Vite's transform drops an import that is only re-exported (`import { x } … export { x }`)
export { useInView } from './inView'

// ---- saving: what the wish form decided about the photo -----------------------------------------------------

/** keep = nothing to do; upload = the photo read from the link; remove = the person took the saved one away */
export type PhotoIntent = { kind: 'keep' } | { kind: 'upload'; photo: PreparedPhoto } | { kind: 'remove' }

export const KEEP_PHOTO: PhotoIntent = { kind: 'keep' }

/** The photo's meta after a save (undefined = unchanged). */
export type PhotoSaved = { ok: true; photo?: WishPhotoMeta | null } | { ok: false }

/**
 * Applies the form's photo decision AFTER the wish itself was saved (a photo never blocks or loses a wish).
 * An upload seeds the bytes cache under the new version, so the list shows the photo at once (no download).
 * Never throws: `{ ok: false }` = the wish is saved, the photo is not (the page says so calmly).
 */
export async function saveWishPhoto(queryClient: QueryClient, wishId: string, intent: PhotoIntent, userId: string | undefined): Promise<PhotoSaved> {
  if (intent.kind === 'keep') return { ok: true }
  try {
    if (intent.kind === 'remove') {
      await deleteWishPhoto(wishId, userId)
      return { ok: true, photo: null }
    }
    const { photo } = intent
    const epoch = captureEpoch()
    const { updated_at } = await uploadWishPhoto(wishId, photo, userId)
    // a photo for a wish of their own (owner only): a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
    if (epoch.isCurrent()) void import('../sammlung/note').then((m) => m.noteMilestone('wishphoto'), () => undefined)
    const bytes: WishPhoto = { mime: photo.mime, blob: photo.blob, width: photo.width, height: photo.height, updated_at }
    queryClient.setQueryData(wishPhotoKey(wishId, updated_at), bytes)
    return { ok: true, photo: { width: photo.width, height: photo.height, updated_at } }
  } catch {
    return { ok: false }
  }
}

/** Tests only. */
export function resetWishPhotoQueueForTests(): void {
  running = 0
  waiting.length = 0
  resetInViewForTests()
}
