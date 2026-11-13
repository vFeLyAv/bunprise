import { useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { captureEpoch, onAccountEnded } from '../../lib/accountBoundary'
import { deleteListPhoto, getListPhoto, uploadListPhoto, type ListPhoto } from '../../lib/api/listPhotos'
import type { ListVisibility } from '../../lib/api/lists.types'
import type { ListPhotoMeta } from '../../lib/api/types'
import { isAppError } from '../../lib/errors'
import type { PreparedPhoto } from '../occasions/photo/pipeline'
import { limited } from '../wishes/wishPhotos'
import { invalidateLists, patchOwnCard, updateListScreen, updateOverview } from './queries'

// A list's cover photo on screen (lib/api/listPhotos.ts; the bytes live in OUR database, never anywhere else):
// - bytes: getListPhoto() → Blob → lib/objectUrl.ts (one object URL per Blob, shared by the card and the list's
//   header — so the shared-element transition card → header shows the very same decoded picture). One cache entry
//   per cover VERSION: ['listPhoto', listId, photo.updated_at]; memory only (never persisted, the account boundary
//   clears it); asked for only when a card is near the screen, through the same small queue as the wish photos.
// - a change of MY cover on its way (memory only, forgotten when the account ends in this tab): the new picture
//   shows at once from memory, a removal hides the cover at once; success seeds the cache under the new version
//   (nothing is downloaded again), a failure brings the stored cover back and the caller says why (a calm toast).

export const listPhotoKey = (listId: string, version: string) => ['listPhoto', listId, version] as const

/** "Not found / no access" is final (the card simply shows its symbol then). */
function isFinal(error: unknown): boolean {
  return isAppError(error, 'not_found') || isAppError(error, 'not_allowed') || isAppError(error, 'forbidden')
}

export function listPhotoQuery(listId: string, version: string) {
  return {
    queryKey: listPhotoKey(listId, version),
    queryFn: () => {
      // pinned to the account this tab shows right now
      const { userId } = captureEpoch()
      return limited(() => getListPhoto(listId, userId))
    },
    staleTime: Infinity, // a version never changes
    gcTime: 10 * 60_000,
    retry: (failures: number, error: unknown) => !isFinal(error) && failures < 1,
    refetchOnWindowFocus: false,
  }
}

// ---- my cover changes on their way ----------------------------------------------------------------------

/** preparing = the picked file is being made small on the device (the old cover stays until it is ready) */
export type CoverChange = { kind: 'preparing' } | { kind: 'upload'; photo: PreparedPhoto } | { kind: 'remove' }

const jobs = new Map<string, CoverChange>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setJob(listId: string, change: CoverChange | null): void {
  if (change) jobs.set(listId, change)
  else jobs.delete(listId)
  emit()
}

/** The change of this list's cover on its way (undefined = nothing). */
export function useCoverChange(listId: string): CoverChange | undefined {
  return useSyncExternalStore(subscribe, () => jobs.get(listId), () => undefined)
}

/** Marks the list as "a picture is being prepared" (the menu calls it right after the pick). */
export function markCoverPreparing(listId: string, preparing: boolean): void {
  if (preparing) setJob(listId, { kind: 'preparing' })
  else if (jobs.get(listId)?.kind === 'preparing') setJob(listId, null)
}

/** The cover's meta in every cached place that shows this list (my card in the tab, the list's screen). */
function applyCoverMeta(queryClient: QueryClient, listId: string, photo: ListPhotoMeta | null): void {
  updateOverview(queryClient, (overview) => patchOwnCard(overview, listId, { photo }))
  updateListScreen(queryClient, listId, (screen) => ({ ...screen, list: { ...screen.list, photo } }))
}

export interface CoverChangeOptions {
  listId: string
  /** the account of the screen: the request is sent for it only */
  userId: string
  queryClient: QueryClient
  change: { kind: 'upload'; photo: PreparedPhoto } | { kind: 'remove' }
  /** the server said no (FeatureUnavailableError, PhotoLimitError, …): the stored cover is back; say why */
  onError: (error: unknown) => void
}

/** Sends a cover change (owner only). Resolves true once the server confirmed it. Never throws. */
export async function changeListCover({ listId, userId, queryClient, change, onError }: CoverChangeOptions): Promise<boolean> {
  const epoch = captureEpoch()
  if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return false
  setJob(listId, change)
  try {
    if (change.kind === 'upload') {
      const { photo } = change
      const { updated_at } = await uploadListPhoto(listId, photo, userId)
      if (!epoch.isCurrent()) return false
      const bytes: ListPhoto = { mime: photo.mime, blob: photo.blob, width: photo.width, height: photo.height, updated_at }
      // the card and the header ask for this version next: it is in the cache already
      queryClient.setQueryData(listPhotoKey(listId, updated_at), bytes)
      applyCoverMeta(queryClient, listId, { width: photo.width, height: photo.height, updated_at })
    } else {
      await deleteListPhoto(listId, userId)
      if (!epoch.isCurrent()) return false
      applyCoverMeta(queryClient, listId, null)
    }
    if (jobs.get(listId) === change) setJob(listId, null)
    void invalidateLists(queryClient, listId).catch(() => undefined)
    return true
  } catch (err) {
    if (!epoch.isCurrent()) return false
    if (jobs.get(listId) === change) setJob(listId, null)
    onError(err)
    return false
  }
}

onAccountEnded(() => {
  jobs.clear()
  emit()
})

/** Tests only. */
export function resetCoverChangesForTests(): void {
  jobs.clear()
  emit()
}

// ---- what a list shows as its cover right now ---------------------------------------------------------------

export interface ListCover {
  /** none = the list shows its symbol; loading = the box is there, the bytes are on their way */
  state: 'none' | 'loading' | 'ready' | 'unavailable'
  blob: Blob | null
  /** my change of this cover is on its way */
  busy: boolean
}

const NONE: ListCover = { state: 'none', blob: null, busy: false }

/**
 * Whether the card / header shows the cover box (the photo, or its tinted box while the bytes travel). A cover
 * that could not be read (not found / no access: final until the next overview) shows the list's symbol instead.
 */
export function showsCover(cover: ListCover): boolean {
  return cover.state === 'loading' || cover.state === 'ready'
}

/**
 * The cover of a list: my change on its way wins (a new photo at once from memory, a removal at once), else the
 * stored cover of `meta` (bytes once `enabled`). `meta` null / undefined = the list has no cover.
 */
export function useListCover(listId: string, meta: ListPhotoMeta | null | undefined, enabled = true): ListCover {
  const change = useCoverChange(listId)
  const local = change?.kind === 'upload' ? change.photo.blob : null
  const removing = change?.kind === 'remove'
  const stored = local || removing ? null : (meta ?? null)
  const query = useQuery({ ...listPhotoQuery(listId, stored?.updated_at ?? 'none'), enabled: enabled && stored !== null })
  const busy = change !== undefined
  if (local) return { state: 'ready', blob: local, busy }
  if (removing) return { ...NONE, busy }
  if (!stored) return busy ? { ...NONE, busy } : NONE
  if (query.data) return { state: 'ready', blob: query.data.blob, busy }
  return { state: query.isError ? 'unavailable' : 'loading', blob: null, busy }
}

/** After a confirmed visibility change: the list's screen and my card show it (never optimistic). */
export function applyListVisibility(queryClient: QueryClient, listId: string, visibility: ListVisibility): void {
  updateListScreen(queryClient, listId, (current) => ({ ...current, list: { ...current.list, visibility } }))
  updateOverview(queryClient, (overview) => patchOwnCard(overview, listId, { visibility }))
  void invalidateLists(queryClient, listId).catch(() => undefined)
}
