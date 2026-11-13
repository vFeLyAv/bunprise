import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { captureEpoch, onAccountEnded, type AccountEpoch } from '../../lib/accountBoundary'
import { respondFollow } from '../../lib/api/follows'
import { toAppError, type AppError } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { invalidatePeople, patchFollowRequestCount } from './queries'

// "Ablehnen" with 5 s "Rückgängig" (follows-design §2.10, like deleting a wish — pilot-decisions §1): the request
// leaves "Anfragen" at once, the toast says what happens (nothing is told to the person, 30 days of silence) and
// offers the undo, and respond_follow(…, false) goes out only after the pause. Module-level on purpose: the pause
// survives leaving the screen. The decline belongs to the account that asked for it — if that account ended in
// this tab before the pause is over, nothing is sent; an answer for it after that changes nothing.

export const DECLINE_UNDO_MS = 5_000

interface Entry {
  timer: ReturnType<typeof setTimeout> | null
  toastId: number
  /** the request is on its way: no undo any more */
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

export interface ScheduleDeclineOptions {
  /** the person whose request is declined */
  profileId: string
  /** the account of the screen (the decline is sent for exactly this account) */
  userId: string
  queryClient: QueryClient
  /** already translated: the toast and its action */
  text: { declined: string; undo: string }
  onError: (error: AppError) => void
  delayMs?: number
}

/** Hides the request now, shows the undo toast and declines it on the server after the pause. */
export function scheduleDecline(options: ScheduleDeclineOptions): void {
  const { profileId } = options
  if (entries.has(profileId)) return
  const epoch = captureEpoch()
  if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== options.userId)) return
  const delay = options.delayMs ?? DECLINE_UNDO_MS
  const toastId = toast.info(options.text.declined, { actionLabel: options.text.undo, onAction: () => void undoDecline(profileId), duration: delay })
  const entry: Entry = { timer: null, toastId, sending: false, epoch }
  entry.timer = setTimeout(() => {
    void commit(options, entry)
  }, delay)
  entries.set(profileId, entry)
  emit()
}

async function commit(options: ScheduleDeclineOptions, entry: Entry): Promise<void> {
  const { profileId, queryClient } = options
  if (entries.get(profileId) !== entry) return
  entry.timer = null
  // the account that declined ended in this tab meanwhile: nothing is sent for it
  if (!entry.epoch.isCurrent()) {
    entries.delete(profileId)
    emit()
    return
  }
  entry.sending = true
  toast.dismiss(entry.toastId)
  const userId = options.userId
  try {
    await respondFollow(profileId, false, userId)
    if (entry.epoch.isCurrent()) patchFollowRequestCount(queryClient, userId, (count) => count - 1)
  } catch (err) {
    if (entry.epoch.isCurrent()) options.onError(toAppError(err))
  } finally {
    // An in-page account switch may already have scheduled a new decline of this person.
    if (entries.get(profileId) === entry) {
      entries.delete(profileId)
      emit()
    }
    if (entry.epoch.isCurrent()) void invalidatePeople(queryClient).catch(() => undefined)
  }
}

/** Undo within the pause; false when the decline is already on its way. */
export function undoDecline(profileId: string): boolean {
  const entry = entries.get(profileId)
  if (!entry || entry.sending) return false
  if (entry.timer) clearTimeout(entry.timer)
  entries.delete(profileId)
  toast.dismiss(entry.toastId)
  emit()
  return true
}

/** Profile ids whose decline waits for its pause (hidden in "Anfragen" and on their card). */
export function usePendingDeclines(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

function clearPendingDeclines(): void {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer)
    toast.dismiss(entry.toastId)
  }
  entries.clear()
  emit()
}

onAccountEnded(clearPendingDeclines)

/** Tests only. */
export const resetPendingDeclines = clearPendingDeclines
