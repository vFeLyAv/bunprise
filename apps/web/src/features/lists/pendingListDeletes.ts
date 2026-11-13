import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { captureEpoch, onAccountEnded, type AccountEpoch } from '../../lib/accountBoundary'
import { deleteList } from '../../lib/api/lists'
import { toAppError, type AppError } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { listsKeys, removeOwnCard, updateOverview } from './queries'

// "Liste löschen" with 5 s "Rückgängig" (follows-design §2.7, like a wish — pilot-decisions §1): the list
// leaves "Meine" at once, the toast offers the undo, the REST delete goes out only after the pause. The
// database ends whatever hung on its wishes by itself (the same answer with or without). Module-level on
// purpose (the pause survives leaving the screen); the delete belongs to the account that asked for it —
// if that account ended in this tab before the pause is over, nothing is sent.

export const LIST_UNDO_MS = 5_000

interface Entry {
  timer: ReturnType<typeof setTimeout> | null
  toastId: number
  sending: boolean
  epoch: AccountEpoch
}

const entries = new Map<string, Entry>()
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

export interface ScheduleListDeleteOptions {
  listId: string
  userId: string
  queryClient: QueryClient
  /** already translated */
  text: { deleted: string; undo: string }
  onError: (error: AppError) => void
  delayMs?: number
}

export function scheduleListDelete(options: ScheduleListDeleteOptions): void {
  const { listId } = options
  if (entries.has(listId)) return
  const epoch = captureEpoch()
  if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== options.userId)) return
  const delay = options.delayMs ?? LIST_UNDO_MS
  const toastId = toast.info(options.text.deleted, { actionLabel: options.text.undo, onAction: () => void undoListDelete(listId), duration: delay })
  const entry: Entry = { timer: null, toastId, sending: false, epoch }
  entry.timer = setTimeout(() => {
    void commit(options, entry)
  }, delay)
  entries.set(listId, entry)
  emit()
}

async function commit(options: ScheduleListDeleteOptions, entry: Entry): Promise<void> {
  const { listId, queryClient } = options
  if (entries.get(listId) !== entry) return
  entry.timer = null
  if (!entry.epoch.isCurrent()) {
    entries.delete(listId)
    emit()
    return
  }
  entry.sending = true
  toast.dismiss(entry.toastId)
  try {
    await deleteList(listId, options.userId)
    if (entry.epoch.isCurrent()) {
      updateOverview(queryClient, (overview) => removeOwnCard(overview, listId))
      queryClient.removeQueries({ queryKey: listsKeys.list(listId), exact: true })
    }
  } catch (err) {
    if (entry.epoch.isCurrent()) options.onError(toAppError(err))
  } finally {
    if (entries.get(listId) === entry) {
      entries.delete(listId)
      emit()
    }
    if (entry.epoch.isCurrent()) void queryClient.invalidateQueries({ queryKey: listsKeys.overview() }).catch(() => undefined)
  }
}

/** Undo within the pause; false when the request is already on its way. */
export function undoListDelete(listId: string): boolean {
  const entry = entries.get(listId)
  if (!entry || entry.sending) return false
  if (entry.timer) clearTimeout(entry.timer)
  entries.delete(listId)
  toast.dismiss(entry.toastId)
  emit()
  return true
}

/** Ids of lists waiting for their delete (hidden in "Meine" and on their screen). */
export function usePendingListDeletes(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

function clearPendingListDeletes(): void {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer)
    toast.dismiss(entry.toastId)
  }
  entries.clear()
  emit()
}

onAccountEnded(clearPendingListDeletes)

/** Tests only. */
export const resetPendingListDeletes = clearPendingListDeletes
