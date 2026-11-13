import type { QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { captureEpoch } from '../../../lib/accountBoundary'
import type { OwnerWish } from '../../../lib/api/types'
import { isFeatureUnavailableError } from '../../../lib/api/unavailable'
import { deleteWish, moveWish, setWishReceived } from '../../../lib/api/wishes'
import { addWishesToList, deleteWishEverywhere, isSharedWishesUnavailable } from '../../../lib/api/wishPlaces'
import { isAppError, toAppError } from '../../../lib/errors'
import { feedback } from '../../../lib/haptics'
import { toast } from '../../../lib/toast'
import { scheduleWishDeletes } from '../pendingDeletes'
import { invalidateSharedWishViews, invalidateWishViews } from '../wishCache'
import type { BulkOutcome, RunMany } from './types'

// The four actions of selection mode (Felix 30.10: Verschieben · Zu anderer Liste hinzufügen · Als erhalten
// markieren · Löschen). OWNER module — every call is one of the existing ones about my own wishes, no new RPC and no
// new migration:
//   Verschieben    move_wish per wish (optimistic, like the ⋯); a wish in several lists does not move (the database
//                  refuses it, the ⋯ does not offer it) — it stays and the toast says so
//   Hinzufügen     add_wishes_to_list once (≤ 50 per call), server-confirmed like "Aus meinen Listen holen"
//   Erhalten       set_wish_received per wish (optimistic)
//   Löschen        the 5-second "Rückgängig" of the single delete, one toast for all; a selection with a wish that
//                  lives in other lists too is confirmed first and then deleted for good (delete_wish_everywhere for
//                  those, the plain delete for the rest) — the ⋯ of such a wish has no undo either
// Every answer the owner sees depends only on the owner's own data.

export interface BulkContext {
  t: TFunction<'wishes'>
  queryClient: QueryClient
  /** the occasion of the screen (its caches), null on a list without an occasion */
  cacheOccasion: string | null
  runMany: RunMany
}

export interface BulkTarget {
  id: string
  title: string
}

/** The wish lives in other lists too (shared wishes, 20261027200000). */
export function isShared(wish: OwnerWish): boolean {
  return (wish.also_in?.length ?? 0) > 0
}

/** add_wishes_to_list takes at most 50 wishes per call. */
const ADD_BATCH = 50

function errorToast(t: TFunction<'wishes'>, err: unknown): void {
  if (isFeatureUnavailableError(err)) {
    toast.info(t('wish.unavailable'))
    return
  }
  const error = toAppError(err)
  toast.error(t(error.key, error.params))
}

/** One toast for the whole selection: all done, some done, or none. */
function report(t: TFunction<'wishes'>, outcome: BulkOutcome, success: string): void {
  const { done, failed } = outcome
  const first = failed[0]
  if (!first) {
    feedback('success')
    toast.success(success)
    return
  }
  feedback('error')
  if (done.length === 0) errorToast(t, first.error)
  else toast.error(t('select.partial', { done: done.length, total: done.length + failed.length }))
}

export async function bulkMove(ctx: BulkContext, wishes: readonly OwnerWish[], target: BulkTarget): Promise<void> {
  const { t } = ctx
  const movable = wishes.filter((wish) => !isShared(wish))
  const skipped = wishes.length - movable.length
  const skippedText = skipped > 0 ? t('select.skipped_shared', { count: skipped }) : ''
  if (movable.length === 0) {
    feedback('warning')
    toast.info(skippedText)
    return
  }
  const outcome = await ctx.runMany(movable, { kind: 'moved' }, (wish, userId) => moveWish(wish.id, target.id, userId))
  if (!outcome) return
  // both lists, the tab's numbers and (an occasion's list) its screen and the feed
  void invalidateWishViews(ctx.queryClient, ctx.cacheOccasion).catch(() => undefined)
  const moved = t('select.moved', { count: outcome.done.length, list: target.title })
  report(t, outcome, skippedText ? `${moved}. ${skippedText}` : moved)
}

export async function bulkReceived(ctx: BulkContext, wishes: readonly OwnerWish[]): Promise<void> {
  const at = new Date().toISOString()
  const outcome = await ctx.runMany(wishes, { kind: 'received', at }, (wish, userId) => setWishReceived(wish.id, true, userId))
  if (!outcome) return
  // wishes of their own marked «Erhalten»: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
  if (outcome.done.length > 0) void import('../../sammlung/note').then((m) => m.noteMilestone('received'), () => undefined)
  // "Erhalten" belongs to the wish: a wish in several lists changes on every screen that shows it
  const invalidate = wishes.some(isShared) ? invalidateSharedWishViews : invalidateWishViews
  void invalidate(ctx.queryClient, ctx.cacheOccasion).catch(() => undefined)
  report(ctx.t, outcome, ctx.t('select.received_done', { count: outcome.done.length }))
}

/** "Zu anderer Liste hinzufügen": the same wishes, also in one of my coming occasions' lists (server-confirmed). */
export async function bulkAdd(ctx: BulkContext, wishes: readonly OwnerWish[], target: BulkTarget): Promise<void> {
  const { t } = ctx
  const epoch = captureEpoch()
  if (!epoch.isCurrent() || wishes.length === 0) return
  const ids = wishes.map((wish) => wish.id)
  let added = 0
  try {
    for (let start = 0; start < ids.length; start += ADD_BATCH) {
      const result = await addWishesToList(target.id, ids.slice(start, start + ADD_BATCH), epoch.userId)
      added += result.added
    }
  } catch (err) {
    if (!epoch.isCurrent()) return
    feedback('error')
    if (isSharedWishesUnavailable(err)) toast.info(t('wish.unavailable'))
    else if (isAppError(err, 'validation')) toast.error(t('select.add_invalid'))
    else errorToast(t, err)
    // an earlier batch may have gone through
    if (added > 0) void invalidateSharedWishViews(ctx.queryClient, ctx.cacheOccasion).catch(() => undefined)
    return
  }
  if (!epoch.isCurrent()) return
  void invalidateSharedWishViews(ctx.queryClient, ctx.cacheOccasion).catch(() => undefined)
  feedback('success')
  toast.success(added === 0 ? t('select.added_none', { list: target.title }) : t('select.added', { count: added, list: target.title }))
}

/** Does deleting this selection need a confirmation first? (a wish in other lists is deleted there too) */
export function deleteNeedsConfirm(wishes: readonly OwnerWish[]): boolean {
  return wishes.some(isShared)
}

/** "Löschen" without shared wishes: hidden at once, one "Rückgängig" toast, the deletes go out after 5 s. */
export function bulkDelete(ctx: BulkContext, wishes: readonly OwnerWish[]): void {
  const { t } = ctx
  if (wishes.length === 0) return
  scheduleWishDeletes({
    wishIds: wishes.map((wish) => wish.id),
    occasionId: ctx.cacheOccasion,
    queryClient: ctx.queryClient,
    text: { deleted: t('select.deleted', { count: wishes.length }), undo: t('wish.undo') },
    onError: (_error, failed) => {
      feedback('error')
      toast.error(t('select.delete_failed', { count: failed }))
    },
  })
}

/** "Löschen" after the confirmation (some wishes live in other lists too): gone everywhere, no undo. */
export async function bulkDeleteConfirmed(ctx: BulkContext, wishes: readonly OwnerWish[]): Promise<void> {
  const outcome = await ctx.runMany(wishes, { kind: 'moved' }, (wish, userId) => (isShared(wish) ? deleteWishEverywhere(wish.id, userId) : deleteWish(wish.id, userId)))
  if (!outcome) return
  void invalidateSharedWishViews(ctx.queryClient, ctx.cacheOccasion).catch(() => undefined)
  report(ctx.t, outcome, ctx.t('select.deleted', { count: outcome.done.length }))
}
