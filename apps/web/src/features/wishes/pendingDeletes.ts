import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { captureEpoch, type AccountEpoch } from '../../lib/accountBoundary'
import { deleteWish } from '../../lib/api/wishes'
import { toAppError, type AppError } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { invalidateWishViews, removeCachedWish } from './wishCache'

// "Delete with undo" for wishes (pilot-decisions §1: hard delete, the 5-second undo is client-side —
// the request is sent only after the pause). Module-level on purpose: the countdown and the undo
// toast survive leaving the screen, and a screen opened again during the pause still hides the wish.
// Closing the tab within the pause cancels the delete (nothing is lost).
// Secrecy: the flow is identical for every wish; the database ends a reservation by itself.
// Account boundary: the delete belongs to the account that asked for it. If that account ended in
// this tab before the pause is over, nothing is sent; an answer for it after that changes nothing.

export const UNDO_WINDOW_MS = 5_000

interface Entry {
  timer: ReturnType<typeof setTimeout> | null
  toastId: number
  /** true once the request went out: undo is no longer possible */
  sending: boolean
  /** the account (and its epoch) that scheduled the delete */
  epoch: AccountEpoch
  /** several wishes deleted at once (selection mode): one toast, one timer for all of them */
  group?: Group
}

interface Group {
  timer: ReturnType<typeof setTimeout> | null
  ids: readonly string[]
}

const entries = new Map<string, Entry>()
const groups = new Set<Group>()
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<string> = new Set()

function emit(): void {
  snapshot = new Set(entries.keys())
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ReadonlySet<string> {
  return snapshot
}

export interface ScheduleWishDeleteOptions {
  wishId: string
  /** null when the screen does not know its occasion (deep link into the edit form) */
  occasionId: string | null
  queryClient: QueryClient
  /** already translated: toast text and its action label */
  text: { deleted: string; undo: string }
  /** the request failed: the wish shows up again; tell the person */
  onError: (error: AppError) => void
  delayMs?: number
}

/** Hides the wish now, shows the undo toast and deletes it on the server after the pause. */
export function scheduleWishDelete(options: ScheduleWishDeleteOptions): void {
  const { wishId } = options
  if (entries.has(wishId)) return
  const epoch = captureEpoch()
  if (!epoch.isCurrent()) return
  const delay = options.delayMs ?? UNDO_WINDOW_MS
  const toastId = toast.info(options.text.deleted, {
    actionLabel: options.text.undo,
    onAction: () => {
      undoWishDelete(wishId)
    },
    duration: delay,
  })
  const entry: Entry = { timer: null, toastId, sending: false, epoch }
  entry.timer = setTimeout(() => {
    void commit(options, entry)
  }, delay)
  entries.set(wishId, entry)
  emit()
}

async function commit(options: ScheduleWishDeleteOptions, entry: Entry): Promise<void> {
  const { wishId, occasionId, queryClient } = options
  if (entries.get(wishId) !== entry) return
  entry.timer = null
  if (!entry.epoch.isCurrent()) {
    // the account that asked for it is gone from this tab: forget the delete, send nothing
    entries.delete(wishId)
    emit()
    return
  }
  entry.sending = true
  toast.dismiss(entry.toastId)
  try {
    await deleteWish(wishId, entry.epoch.userId)
    if (entry.epoch.isCurrent()) removeCachedWish(queryClient, occasionId, wishId)
  } catch (err) {
    if (entry.epoch.isCurrent()) options.onError(toAppError(err))
  } finally {
    entries.delete(wishId)
    emit()
    if (entry.epoch.isCurrent()) void invalidateWishViews(queryClient, occasionId).catch(() => undefined)
  }
}

export interface ScheduleWishDeletesOptions extends Omit<ScheduleWishDeleteOptions, 'wishId' | 'onError'> {
  wishIds: readonly string[]
  /** some requests failed: those wishes show up again; `failed` of them, the first error */
  onError: (error: AppError, failed: number) => void
}

/**
 * Selection mode (Felix 30.10, request #4): several wishes at once, the same 5-second "Rückgängig" — ONE toast
 * for all of them, one undo brings all of them back. After the pause the deletes go out one after another.
 */
export function scheduleWishDeletes(options: ScheduleWishDeletesOptions): void {
  const ids = [...new Set(options.wishIds)].filter((id) => !entries.has(id))
  if (ids.length === 0) return
  const epoch = captureEpoch()
  if (!epoch.isCurrent()) return
  const delay = options.delayMs ?? UNDO_WINDOW_MS
  const group: Group = { timer: null, ids }
  const toastId = toast.info(options.text.deleted, {
    actionLabel: options.text.undo,
    onAction: () => {
      for (const id of ids) undoWishDelete(id)
    },
    duration: delay,
  })
  group.timer = setTimeout(() => {
    void commitGroup(options, group, epoch, toastId)
  }, delay)
  groups.add(group)
  for (const id of ids) entries.set(id, { timer: null, toastId, sending: false, epoch, group })
  emit()
}

async function commitGroup(options: ScheduleWishDeletesOptions, group: Group, epoch: AccountEpoch, toastId: number): Promise<void> {
  const { occasionId, queryClient } = options
  group.timer = null
  groups.delete(group)
  const live = group.ids.filter((id) => entries.get(id)?.group === group)
  if (live.length === 0) return
  if (!epoch.isCurrent()) {
    // the account that asked for it is gone from this tab: forget the deletes, send nothing
    for (const id of live) entries.delete(id)
    emit()
    return
  }
  for (const id of live) {
    const entry = entries.get(id)
    if (entry) entry.sending = true
  }
  toast.dismiss(toastId)
  let failed = 0
  let firstError: AppError | null = null
  try {
    for (const id of live) {
      if (!epoch.isCurrent()) return // the account ended meanwhile: the rest is not sent
      try {
        await deleteWish(id, epoch.userId)
        if (epoch.isCurrent()) removeCachedWish(queryClient, occasionId, id)
      } catch (err) {
        failed += 1
        firstError ??= toAppError(err)
      }
    }
  } finally {
    for (const id of live) entries.delete(id)
    emit()
  }
  if (!epoch.isCurrent()) return
  void invalidateWishViews(queryClient, occasionId).catch(() => undefined)
  if (failed > 0 && firstError) options.onError(firstError, failed)
}

/** Undo within the pause. False when it is too late (the request is already on its way). */
export function undoWishDelete(wishId: string): boolean {
  const entry = entries.get(wishId)
  if (!entry || entry.sending) return false
  if (entry.timer) clearTimeout(entry.timer)
  entries.delete(wishId)
  const group = entry.group
  if (group && group.ids.some((id) => entries.get(id)?.group === group)) {
    // other wishes of the same selection are still waiting: their toast and timer stay
    emit()
    return true
  }
  if (group?.timer) clearTimeout(group.timer)
  if (group) groups.delete(group)
  toast.dismiss(entry.toastId)
  emit()
  return true
}

export function isWishDeletePending(wishId: string): boolean {
  return entries.has(wishId)
}

/** Ids of wishes waiting for their delete (hidden in every list). */
export function usePendingWishDeletes(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Tests only: forget every pending delete without sending anything. */
export function resetPendingWishDeletes(): void {
  for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer)
  for (const group of groups) if (group.timer) clearTimeout(group.timer)
  groups.clear()
  entries.clear()
  emit()
}
