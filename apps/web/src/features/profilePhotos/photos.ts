import { useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { captureEpoch, onAccountEnded, renderedAccount } from '../../lib/accountBoundary'
import { deleteProfilePhoto, getProfilePhoto, uploadProfilePhoto, type ProfilePhoto, type ProfilePhotoKind } from '../../lib/api/profilePhotos'
import type { ListsOverview } from '../../lib/api/lists.types'
import type { Me, ProfilePhotoMeta } from '../../lib/api/types'
import { isAppError } from '../../lib/errors'
import { queryKeys } from '../../lib/queryKeys'
import type { PreparedPhoto } from '../occasions/photo/pipeline'
import { limited } from '../wishes/wishPhotos'

// A person's own profile photo and banner photo on screen (lib/api/profilePhotos.ts; the bytes live in OUR database,
// never anywhere else). Same rules as the list covers (features/lists/listCovers.ts):
// - bytes: getProfilePhoto() → Blob → lib/objectUrl.ts. One cache entry per photo VERSION:
//   ['profilePhoto', profileId, kind, photo.updated_at]; MEMORY only (the persisted allow-list is ['feed'], lib/query.ts;
//   the account boundary clears the cache); asked for only when the picture is near the screen, through the same
//   small queue as the wish photos and list covers (MAX_PARALLEL requests at a time).
// - MY change on its way (memory only, forgotten when the account ends in this tab): the new picture shows at once
//   from memory, a removal hides it at once; success seeds the bytes cache under the new version (nothing is
//   downloaded again) and stays as an override, so every place that shows me (tab bar, both headers, the sheets,
//   my own card) agrees even before its own data is fetched again; a failure brings the stored picture back.

export const profilePhotoKey = (profileId: string, kind: ProfilePhotoKind, version: string) => ['profilePhoto', profileId, kind, version] as const

/** "Not found / no access" is final (the person simply shows the initials / the preset banner then). */
function isFinal(error: unknown): boolean {
  return isAppError(error, 'not_found') || isAppError(error, 'not_allowed') || isAppError(error, 'forbidden')
}

// (a plain options object, like wishPhotoQuery)
export function profilePhotoQuery(profileId: string, kind: ProfilePhotoKind, version: string) {
  return {
    queryKey: profilePhotoKey(profileId, kind, version),
    queryFn: () => {
      // pinned to the account this tab shows right now (an answer for another account never lands)
      const { userId } = captureEpoch()
      return limited(() => getProfilePhoto(profileId, kind, userId))
    },
    staleTime: Infinity, // a version never changes
    gcTime: 10 * 60_000,
    retry: (failures: number, error: unknown) => !isFinal(error) && failures < 1,
    refetchOnWindowFocus: false,
  }
}

// ---- my own changes --------------------------------------------------------------------------------------

/**
 * preparing = the picked file is being made small on the device (the old picture stays);
 * upload / remove = on its way to the server; saved = the server confirmed this meta (null = removed).
 */
export type OwnPhotoChange =
  | { kind: 'preparing' }
  | { kind: 'upload'; photo: PreparedPhoto }
  | { kind: 'remove' }
  | { kind: 'saved'; meta: ProfilePhotoMeta | null }

const changes = new Map<string, OwnPhotoChange>()
const listeners = new Set<() => void>()
const slot = (userId: string, kind: ProfilePhotoKind) => `${userId}:${kind}`

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setChange(userId: string, kind: ProfilePhotoKind, change: OwnPhotoChange | null): void {
  if (change) changes.set(slot(userId, kind), change)
  else changes.delete(slot(userId, kind))
  emit()
}

/** My change of this photo (undefined = nothing; `profileId` must be the account this tab shows). */
export function useOwnPhotoChange(profileId: string | null, kind: ProfilePhotoKind): OwnPhotoChange | undefined {
  return useSyncExternalStore(subscribe, () => (profileId ? changes.get(slot(profileId, kind)) : undefined), () => undefined)
}

/** Marks "a picture is being prepared" (right after the pick; the old one stays until it is ready). */
export function markOwnPhotoPreparing(userId: string, kind: ProfilePhotoKind, preparing: boolean): void {
  if (preparing) setChange(userId, kind, { kind: 'preparing' })
  else if (changes.get(slot(userId, kind))?.kind === 'preparing') setChange(userId, kind, null)
}

onAccountEnded(() => {
  changes.clear()
  emit()
})

/** Tests only. */
export function resetOwnPhotoChangesForTests(): void {
  changes.clear()
  emit()
}

/** The own meta in the cached answers that carry it (get_me, the lists overview). */
function applyOwnMeta(queryClient: QueryClient, userId: string, kind: ProfilePhotoKind, meta: ProfilePhotoMeta | null): void {
  const key = kind === 'avatar' ? 'photo' : 'banner_photo'
  const me = queryClient.getQueryState<Me>(queryKeys.me())
  if (me?.data?.profile?.id === userId) {
    queryClient.setQueryData<Me>(queryKeys.me(), { ...me.data, profile: { ...me.data.profile, [key]: meta } }, { updatedAt: me.dataUpdatedAt })
  }
  // ['lists'] = features/lists/queries.ts listsKeys.overview() (not imported: it would pull the lists API into the
  // tab bar's little photo chunk)
  queryClient.setQueryData<ListsOverview>(['lists'], (overview) =>
    overview && overview.me.id === userId ? { ...overview, me: { ...overview.me, [key]: meta } } : overview)
}

export interface OwnPhotoChangeOptions {
  /** the account of the screen: the request is sent for it only */
  userId: string
  kind: ProfilePhotoKind
  queryClient: QueryClient
  change: { kind: 'upload'; photo: PreparedPhoto } | { kind: 'remove' }
  /** the server said no (FeatureUnavailableError, …): the stored picture is back; say why */
  onError: (error: unknown) => void
}

/** Sends a change of my own photo. Resolves true once the server confirmed it. Never throws. */
export async function changeOwnPhoto({ userId, kind, queryClient, change, onError }: OwnPhotoChangeOptions): Promise<boolean> {
  const epoch = captureEpoch()
  if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return false
  const before = changes.get(slot(userId, kind))
  setChange(userId, kind, change)
  try {
    let meta: ProfilePhotoMeta | null = null
    if (change.kind === 'upload') {
      const { photo } = change
      const { updated_at } = await uploadProfilePhoto(kind, photo, userId)
      if (!epoch.isCurrent()) return false
      // their own profile photo / banner photo: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
      void import('../sammlung/note').then((m) => m.noteMilestone(kind === 'avatar' ? 'photo' : 'banner'), () => undefined)
      const bytes: ProfilePhoto = { mime: photo.mime, blob: photo.blob, width: photo.width, height: photo.height, updated_at }
      // every place that shows me asks for this version next: it is in the cache already
      queryClient.setQueryData(profilePhotoKey(userId, kind, updated_at), bytes)
      meta = { width: photo.width, height: photo.height, updated_at }
    } else {
      await deleteProfilePhoto(kind, userId)
      if (!epoch.isCurrent()) return false
    }
    applyOwnMeta(queryClient, userId, kind, meta)
    if (changes.get(slot(userId, kind)) === change) setChange(userId, kind, { kind: 'saved', meta })
    return true
  } catch (err) {
    if (!epoch.isCurrent()) return false
    // back to what was shown before (an earlier confirmed change stays)
    if (changes.get(slot(userId, kind)) === change) setChange(userId, kind, before?.kind === 'saved' ? before : null)
    onError(err)
    return false
  }
}

// ---- what a person shows right now ---------------------------------------------------------------------------

export interface PersonPhotoState {
  /** none = the initials / the preset banner; loading = the bytes are on their way */
  state: 'none' | 'loading' | 'ready' | 'unavailable'
  blob: Blob | null
  /** my change of this picture is on its way */
  busy: boolean
}

const NONE: PersonPhotoState = { state: 'none', blob: null, busy: false }

/** The effective stored meta of a person's photo: for myself my confirmed change wins over the screen's data. */
export function effectiveMeta(change: OwnPhotoChange | undefined, meta: ProfilePhotoMeta | null | undefined): ProfilePhotoMeta | null {
  if (change?.kind === 'saved') return change.meta
  return meta ?? null
}

/**
 * The picture of a person: for myself my change on its way wins (a new photo at once from memory, a removal at once),
 * else the stored photo of `meta` (bytes once `enabled`). `meta` null / undefined = no photo.
 */
export function usePersonPhoto(profileId: string, kind: ProfilePhotoKind, meta: ProfilePhotoMeta | null | undefined, enabled = true): PersonPhotoState {
  const self = profileId === renderedAccount()
  const change = useOwnPhotoChange(self ? profileId : null, kind)
  const local = change?.kind === 'upload' ? change.photo.blob : null
  const removing = change?.kind === 'remove'
  const stored = local || removing ? null : effectiveMeta(change, meta)
  // my own two pictures (avatar, banner) stay for the whole session (Felix 31.10 «мигают фото»): the banner is shown on
  // Profil and Listen only — after 10 minutes elsewhere its bytes were dropped and the tab that came back loaded and
  // faded it in anew. Other people's photos keep the bounded 10 minutes.
  const query = useQuery({
    ...profilePhotoQuery(profileId, kind, stored?.updated_at ?? 'none'),
    ...(self ? { gcTime: Infinity } : {}),
    enabled: enabled && stored !== null,
  })
  const busy = change !== undefined && change.kind !== 'saved'
  if (local) return { state: 'ready', blob: local, busy }
  if (removing || !stored) return busy ? { ...NONE, busy } : NONE
  if (query.data) return { state: 'ready', blob: query.data.blob, busy }
  return { state: query.isError ? 'unavailable' : 'loading', blob: null, busy }
}
