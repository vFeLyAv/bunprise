import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { captureEpoch, onAccountEnded } from '../../../lib/accountBoundary'
import { removeOccasionPhoto, setOccasionPhoto, type OccasionPhoto } from '../../../lib/api/photos'
import type { OccasionPhotoMeta, OccasionScreen } from '../../../lib/api/types'
import { isAppError, toAppError, type AppError } from '../../../lib/errors'
import { qk } from '../../../lib/queryKeys'
import type { PreparedPhoto } from './pipeline'
import { photoQueryKey } from './queries'

// A cover change on its way to the server — MEMORY ONLY, like the form drafts (../saving.ts): never browser
// storage, keyed by account, forgotten when that account ends in the tab (lib/accountBoundary.ts).
//
//   draft  the photo of a form whose save is still travelling (or failed): the form gets it back with its
//          values when it reopens (the occasion's own draft lives in ../saving.ts);
//   job    after the occasion was saved: the upload / removal itself. The occasion screen shows a job at once
//          (the new photo from memory, a small "uploading" pill) and the edit form shows it read-only.
//          Success: the cover goes into the photo cache under its new version and into the screen, so nothing
//          is downloaded again. Offline: the job waits and is sent again when the browser is back online —
//          as long as the app stays open (a reload forgets it; the screen says so). Another failure: the
//          screen offers "again" or "discard". `not_found` (the occasion is gone): the job just ends.

export type PhotoChange = { kind: 'upload'; photo: PreparedPhoto } | { kind: 'remove' }

/** queued = about to be sent (shown like sending) */
export type PhotoJobStatus = 'queued' | 'sending' | 'offline' | 'failed'

export interface PhotoJob {
  change: PhotoChange
  status: PhotoJobStatus
  error?: AppError
}

/** 'new' for the create form (with the client id the change belongs to), else the occasion id. */
export interface PhotoDraft {
  occasionId: string
  change: PhotoChange
}

const jobs = new Map<string, PhotoJob>()
const clients = new Map<string, QueryClient>()
const drafts = new Map<string, PhotoDraft>()
const listeners = new Set<() => void>()
let waitingForOnline = false

const keyOf = (userId: string, occasionId: string) => `${userId}:${occasionId}`

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ---- drafts (the photo of a form whose save travels) ----------------------------------------------------

export function keepPhotoDraft(userId: string, target: 'new' | (string & {}), draft: PhotoDraft): void {
  drafts.set(keyOf(userId, target), draft)
}

export function peekPhotoDraft(userId: string, target: 'new' | (string & {})): PhotoDraft | undefined {
  return drafts.get(keyOf(userId, target))
}

export function clearPhotoDraft(userId: string, target: 'new' | (string & {})): void {
  drafts.delete(keyOf(userId, target))
}

/** Clears the draft only while it still belongs to `occasionId` (a later form may have kept its own). */
export function clearPhotoDraftOf(userId: string, target: 'new' | (string & {}), occasionId: string): void {
  if (drafts.get(keyOf(userId, target))?.occasionId === occasionId) drafts.delete(keyOf(userId, target))
}

// ---- jobs ---------------------------------------------------------------------------------------------

export function peekPhotoJob(userId: string, occasionId: string): PhotoJob | undefined {
  return jobs.get(keyOf(userId, occasionId))
}

/** The live job of one occasion for this account (undefined = nothing on its way). */
export function usePhotoJob(userId: string, occasionId: string): PhotoJob | undefined {
  const key = keyOf(userId, occasionId)
  return useSyncExternalStore(subscribe, () => jobs.get(key), () => undefined)
}

/** Forget a job (the person discards a failed upload). */
export function discardPhotoJob(userId: string, occasionId: string): void {
  const key = keyOf(userId, occasionId)
  jobs.delete(key)
  clients.delete(key)
  emit()
}

/** The screen's cover meta, set (after an upload) or cleared (after a removal) — the rest is unchanged. */
function withCover(screen: OccasionScreen, photo: OccasionPhotoMeta | null): OccasionScreen {
  return { ...screen, occasion: { ...screen.occasion, photo } }
}

function isOffline(): boolean {
  // A failed request can be a server/transport problem while the browser remains online. In that case
  // no future `online` event is guaranteed: expose the ordinary retry action instead of waiting forever.
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function retryWhenOnline(): void {
  if (waitingForOnline || typeof window === 'undefined') return
  waitingForOnline = true
  window.addEventListener(
    'online',
    () => {
      waitingForOnline = false
      for (const [key, job] of jobs) {
        const client = clients.get(key)
        if (job.status !== 'offline' || !client) continue
        const split = key.indexOf(':')
        void send(key.slice(0, split), key.slice(split + 1), client)
      }
    },
    { once: true },
  )
}

async function send(userId: string, occasionId: string, queryClient: QueryClient): Promise<void> {
  const key = keyOf(userId, occasionId)
  const queued = jobs.get(key)
  if (!queued || queued.status === 'sending') return
  const epoch = captureEpoch()
  // the change belongs to the account this tab shows; anything else is not sent at all
  if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
  const job: PhotoJob = { change: queued.change, status: 'sending' }
  jobs.set(key, job)
  clients.set(key, queryClient)
  emit()
  try {
    if (job.change.kind === 'upload') {
      const { photo } = job.change
      const { updated_at } = await setOccasionPhoto(occasionId, photo, userId)
      if (!epoch.isCurrent()) return
      const cover: OccasionPhoto = { mime: photo.mime, blob: photo.blob, width: photo.width, height: photo.height, updated_at }
      // the screen asks for this version next: it is in the cache already (no second download)
      queryClient.setQueryData(photoQueryKey(occasionId, updated_at), cover)
      queryClient.setQueryData<OccasionScreen>(qk.occasion(occasionId), (screen) =>
        screen && withCover(screen, { width: photo.width, height: photo.height, updated_at }))
    } else {
      await removeOccasionPhoto(occasionId, userId)
      if (!epoch.isCurrent()) return
      queryClient.setQueryData<OccasionScreen>(qk.occasion(occasionId), (screen) => screen && withCover(screen, null))
    }
    // done — unless a newer change of the same occasion took the place meanwhile
    if (jobs.get(key) === job) {
      jobs.delete(key)
      clients.delete(key)
      emit()
    }
    void queryClient.invalidateQueries({ queryKey: qk.occasion(occasionId) })
  } catch (err) {
    if (!epoch.isCurrent() || jobs.get(key) !== job) return
    const error = toAppError(err)
    if (isAppError(error, 'not_found') || isAppError(error, 'session_expired') || isAppError(error, 'not_authenticated')) {
      // the occasion is gone (or no longer this account's): nothing left to show or retry
      jobs.delete(key)
      clients.delete(key)
      emit()
      return
    }
    const offline = isOffline()
    jobs.set(key, { change: job.change, status: offline ? 'offline' : 'failed', error })
    emit()
    if (offline) retryWhenOnline()
  }
}

/**
 * The occasion was saved: send its cover change now (pinned to `userId`). A newer change replaces an older
 * one that has not been sent yet.
 */
export function startPhotoJob(userId: string, occasionId: string, change: PhotoChange, queryClient: QueryClient): Promise<void> {
  const key = keyOf(userId, occasionId)
  // an older request that is still on its way may finish first; it then leaves this newer job alone
  jobs.set(key, { change, status: 'queued' })
  clients.set(key, queryClient)
  emit()
  return send(userId, occasionId, queryClient)
}

/** "Nochmal": send a failed or waiting job again. */
export function retryPhotoJob(userId: string, occasionId: string, queryClient: QueryClient): Promise<void> {
  return send(userId, occasionId, queryClient)
}

/** Everything of the account that ended in this tab. */
function forgetAll(): void {
  jobs.clear()
  clients.clear()
  drafts.clear()
  emit()
}

onAccountEnded(forgetAll)

/** Tests only. */
export function resetPhotoUploadsForTests(): void {
  forgetAll()
  waitingForOnline = false
}
