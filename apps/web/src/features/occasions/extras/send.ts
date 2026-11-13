import type { QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { captureEpoch } from '../../../lib/accountBoundary'
import { getOccasionScreen } from '../../../lib/api/occasions'
import { addPotluckItem } from '../../../lib/api/potluck'
import { createWish, moveWish } from '../../../lib/api/wishes'
import { addWishesToList, isSharedWishesUnavailable, sharedWishesEnabled } from '../../../lib/api/wishPlaces'
import { toAppError, type AppError } from '../../../lib/errors'
import { toast } from '../../../lib/toast'
import { invalidateOwnerWishSources } from '../../wishes/wishCache'
import { saveWishPhoto } from '../../wishes/wishPhotos'
import { extrasCount, wishInputOf, type LinkRead, type OccasionExtras, type QuickWish } from './model'

// Saves what was added in the new-occasion form (extras/model.ts) once the server confirmed the occasion
// (features/occasions/actions.ts useCreateOccasion). In order, one request at a time (the lists keep the order of
// the form): the bring-along entries (add_potluck_item, the occasion id is enough), then — when there are wishes —
// the occasion's screen once for the id of its list (the database trigger made it), the typed / linked wishes
// (createWish, their photo after each: saveWishPhoto), the wishes picked from my lists (moveWish — a move, the
// database keeps its rules for the people who give). Then the occasion's screen and the feed load once (the
// create's own refresh, handed in — this module stays away from the shared queries) and my lists, when wishes moved.
// - Wishes wait for the server as everywhere in the app; a link still being read holds its wish up at most
//   READ_WAIT_MS, then it is saved with what is there (the link, the shop's name as its title).
// - Nothing here ever blocks the occasion: it exists already. What did not arrive is said in ONE toast with
//   "Nochmal" (only the missing ones are sent again); a photo that did not arrive is said calmly.
// - Pinned to the account of the create: once it ended in this tab, nothing more is sent and nothing said.
// Owner side: my own wishes and my own list only; nothing of the secret part.
// Shared wishes (20261027200000, VITE_SHARED_WISHES): the picked wishes are ADDED to the new list in one call
// (add_wishes_to_list — the same wish stays in its own list too); a server without the migration or with the database
// switch off falls back to moving them one by one, exactly as before.

/** A link still being read holds its wish up at most this long. */
export const READ_WAIT_MS = 6_000

export interface SendExtrasOptions {
  queryClient: QueryClient
  occasionId: string
  userId: string
  extras: OccasionExtras
  t: TFunction
  /** loads the occasion's screen and the feed once everything is sent (actions.ts: the create's own refresh) */
  refresh: () => Promise<void>
  readWaitMs?: number
}

export interface ExtrasOutcome {
  /** what did not arrive (sent again by "Nochmal") */
  failed: OccasionExtras
  /** the first reason (our own error key) */
  error: AppError | null
  /** wishes that arrived without their photo */
  photosFailed: number
}

async function settledRead(wish: QuickWish, waitMs: number): Promise<LinkRead | null> {
  if (wish.answer || !wish.read) return wish.answer
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs)
  })
  try {
    return await Promise.race([wish.read.catch(() => null), late])
  } finally {
    clearTimeout(timer)
  }
}

/** Sends the extras; null when the account ended on the way (then nothing is reported). */
export async function sendExtras(options: SendExtrasOptions): Promise<ExtrasOutcome | null> {
  const { queryClient, occasionId, userId, extras, readWaitMs = READ_WAIT_MS } = options
  const epoch = captureEpoch()
  if (!epoch.isCurrent()) return null
  const failed: OccasionExtras = { wishes: [], picked: [], items: [] }
  let error: AppError | null = null
  let photosFailed = 0
  const fail = (err: unknown) => {
    error ??= toAppError(err)
  }

  for (const item of extras.items) {
    try {
      await addPotluckItem(occasionId, item.title, false, userId)
    } catch (err) {
      failed.items.push(item)
      fail(err)
    }
    if (!epoch.isCurrent()) return null
  }

  if (extras.wishes.length > 0 || extras.picked.length > 0) {
    let listId: string | null = null
    try {
      // the list's id only — the cache keeps the screen it has (no flash of an empty list); it refreshes at the end
      const screen = await getOccasionScreen(occasionId, userId)
      listId = screen.viewer.role === 'host' ? (screen.wishlist?.id ?? null) : null
      if (!listId) fail(null)
    } catch (err) {
      fail(err)
    }
    if (!epoch.isCurrent()) return null
    for (const wish of extras.wishes) {
      if (!listId) {
        failed.wishes.push(wish)
        continue
      }
      const answer = await settledRead(wish, readWaitMs)
      if (!epoch.isCurrent()) return null
      const ready: QuickWish = { ...wish, answer }
      try {
        const created = await createWish(listId, wishInputOf(ready), userId)
        if (!epoch.isCurrent()) return null
        // a wish of their own is saved: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
        void import('../../sammlung/note').then((m) => m.noteMilestone('wish'), () => undefined)
        const photo = answer?.photo ?? null
        if (photo) {
          const saved = await saveWishPhoto(queryClient, created.id, { kind: 'upload', photo }, userId)
          if (!saved.ok) photosFailed += 1
        }
      } catch (err) {
        failed.wishes.push(ready)
        fail(err)
      }
      if (!epoch.isCurrent()) return null
    }
    let toMove = extras.picked
    if (listId && toMove.length > 0 && sharedWishesEnabled()) {
      try {
        await addWishesToList(listId, toMove.map((picked) => picked.wish.id), userId)
        toMove = []
      } catch (err) {
        // no migration / the switch off: move them like before; anything else: all of them are missing
        if (!isSharedWishesUnavailable(err)) {
          failed.picked.push(...toMove)
          fail(err)
          toMove = []
        }
      }
      if (!epoch.isCurrent()) return null
    }
    for (const picked of toMove) {
      if (!listId) {
        failed.picked.push(picked)
        continue
      }
      try {
        await moveWish(picked.wish.id, listId, userId)
      } catch (err) {
        failed.picked.push(picked)
        fail(err)
      }
      if (!epoch.isCurrent()) return null
    }
  }

  // the occasion's screen and the feed's numbers (the caller's refresh) — and my lists, when wishes left them
  await options.refresh().catch(() => undefined)
  if (extras.picked.length > failed.picked.length) await invalidateOwnerWishSources(queryClient).catch(() => undefined)
  if (!epoch.isCurrent()) return null
  return { failed, error, photosFailed }
}

/** Sends the extras and says what did not arrive — one toast, "Nochmal" sends only the missing ones again. */
export async function sendOccasionExtras(options: SendExtrasOptions): Promise<void> {
  const outcome = await sendExtras(options)
  if (!outcome) return
  const { t } = options
  const missing = extrasCount(outcome.failed)
  if (missing > 0) {
    const reason = outcome.error ? ` ${t(outcome.error.key, outcome.error.params)}` : ''
    toast.error(`${t('occasionForm.extras_failed', { count: missing })}${reason}`, {
      actionLabel: t('common.retry'),
      onAction: () => {
        // only for the same account, and only what is still missing
        if (captureEpoch().userId !== options.userId) return
        void sendOccasionExtras({ ...options, extras: outcome.failed })
      },
    })
  }
  if (outcome.photosFailed > 0) toast.info(t('occasionForm.extras_photo_failed', { count: outcome.photosFailed }))
}
