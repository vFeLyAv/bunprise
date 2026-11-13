import { useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCanGoBack, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { captureEpoch, type AccountEpoch } from '../../lib/accountBoundary'
import {
  createOccasion,
  deleteOccasion,
  leaveOccasion,
  newOccasionId,
  removeMember,
  setRsvp,
  updateOccasion,
} from '../../lib/api/occasions'
import type { FeedScreen, Me, OccasionScreen, OccasionSections, Rsvp } from '../../lib/api/types'
import { withSections } from '../potluck/cache'
import { toAppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { occasionScreenQuery } from '../../lib/queries'
import { browserTimeZone } from '../../lib/time'
import { toast } from '../../lib/toast'
import {
  optimisticScreen,
  toOccasionInput,
  movedToAnotherDay,
  withFeedOccasionEdit,
  withNewFeedOccasion,
  withOccasionEdit,
  withRsvp,
  withoutFeedOccasion,
  withoutMember,
  type OccasionFormValues,
} from './form'
import { keepDraft, setSaveState } from './saving'
import type { OccasionExtras } from './extras/model'
import { extrasCount, withPendingItems } from './extras/pending'

// What the occasion screens DO. Creating, editing and RSVP are optimistic (pilot-decisions §7):
// the screen changes at once and rolls back with a toast if the server says no. Deleting,
// leaving and removing a guest wait for the server (loading state in the confirmation sheet).
// Error texts are always our own keys (errors.*), never server messages.
// Account boundary (lib/accountBoundary.ts): every action is sent for the screen's account
// (`userId`) and captures the epoch when it starts. An answer that arrives after that account ended
// in this tab does nothing — no rollback into the cache, no draft, no toast, no navigation.

/** Back like the system gesture when this tab has an earlier in-app entry, otherwise `fallback` (deep link). */
export function useGoBack(fallback: () => void): () => void {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return () => {
    if (canGoBack) router.history.back()
    else fallback()
  }
}

/** Where a just-created occasion is shown (K10): the calendar tab, where the bunny files it onto its day. */
export function isCreatedLanding(location: { pathname: string; search: unknown }, occasionId: string): boolean {
  if (location.pathname === `/occasions/${occasionId}`) return true
  const search = location.search as { created?: unknown } | null
  return location.pathname === '/soon' && search?.created === occasionId
}

/**
 * Create (F4, K10): client id → optimistic screen AND feed row in the cache → the calendar tab opens at
 * once with `?created=<id>`: the bunny carries the new occasion onto its day (features/calendar), then a
 * pill offers "Freunde einladen" (its invite card) → insert in the background.
 * Success: mark "created" (the invite card celebrates) and load the real screen (with its wishlist) + feed.
 * Failure: the optimistic row goes, back to the form with the input kept in memory + toast.
 * `afterSaved` (wave 2, the cover photo): runs once the server confirmed the occasion, for the same account —
 * the photo can only be uploaded to an occasion that exists.
 * `cover` (Felix 26.10, features/occasions/covers): the motif the form showed, or 'none' — sent only when set.
 * `extras` (Felix 26.10, extras/model.ts): wishes and bring-along entries added in the form. The entries show on
 * the optimistic screen at once; everything is saved right after the occasion (extras/send.ts, its own chunk), then
 * the screen, the feed and the lists load once. A failed create keeps them in the draft with the input.
 */
export function useCreateOccasion(userId: string): (values: OccasionFormValues, draftId?: string, afterSaved?: () => void, sections?: OccasionSections, cover?: string | null, extras?: OccasionExtras) => void {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { t } = useTranslation('occasion')
  return useCallback(
    (values: OccasionFormValues, draftId?: string, afterSaved?: () => void, sections?: OccasionSections, cover?: string | null, extras?: OccasionExtras) => {
      const epoch = captureEpoch()
      if (!epoch.isCurrent()) return
      const id = draftId ?? newOccasionId()
      // `sections` goes out only when the bring-along list was chosen (an older database has no such column);
      // `cover_theme` only when the form offered motifs (VITE_COVERS) and one is set (null is the default)
      const input = {
        ...toOccasionInput(values, browserTimeZone()),
        id,
        ...(sections && sections !== 'wishes' ? { sections } : {}),
        ...(cover ? { cover_theme: cover } : {}),
      }
      const me = queryClient.getQueryData<Me>(qk.me())
      const host = { id: userId, display_name: me?.profile.id === userId ? me.profile.display_name : null }
      const createdAt = new Date().toISOString()
      const screen = optimisticScreen(input, host, createdAt)
      const added = extras && extrasCount(extras) > 0 ? extras : undefined
      queryClient.setQueryData<OccasionScreen>(
        qk.occasion(id),
        added?.items.length ? withPendingItems(screen, added.items, { profileId: userId, displayName: host.display_name }, createdAt) : screen,
      )
      const formWishes = added ? added.wishes.length + added.picked.length : 0
      queryClient.setQueryData<FeedScreen>(qk.feed(), (feed) => withNewFeedOccasion(feed, input, host.display_name, formWishes))
      setSaveState(id, 'saving')
      const opening = router.navigate({ to: '/soon', search: { view: 'month', created: id }, replace: true })

      void (async () => {
        try {
          await createOccasion(input, userId)
        } catch (err) {
          if (!epoch.isCurrent()) return
          const error = toAppError(err)
          // 'conflict' = this client id exists already: an earlier attempt with the same draft arrived
          if (error.code !== 'conflict') {
            setSaveState(id, null)
            queryClient.removeQueries({ queryKey: qk.occasion(id), exact: true })
            queryClient.setQueryData<FeedScreen>(qk.feed(), (feed) => withoutFeedOccasion(feed, id))
            keepDraft(userId, 'new', { values, id, ...(sections ? { sections } : {}), ...(added ? { extras: added } : {}) })
            await opening.catch(() => undefined)
            if (!epoch.isCurrent()) return
            // an occasion that does not exist must not stay on screen (its calendar landing or its page):
            // back to the form with the input; elsewhere (the person moved on) the toast offers the form
            if (isCreatedLanding(router.state.location, id)) {
              toast.error(t(error.key, error.params))
              await router.navigate({ to: '/occasions/new', replace: true })
            } else {
              toast.error(t(error.key, error.params), {
                actionLabel: t('common.retry'),
                onAction: () => {
                  void router.navigate({ to: '/occasions/new' })
                },
              })
            }
            return
          }
        }
        if (!epoch.isCurrent()) return
        setSaveState(id, 'created')
        // an occasion of their own is in the calendar: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
        void import('../sammlung/note').then((m) => m.noteMilestone('occasion'), () => undefined)
        afterSaved?.()
        const refresh = async () => {
          await Promise.all([
            // The optimistic cache entry has no queryFn until a screen mounts: explicitly supply it now.
            queryClient.fetchQuery(occasionScreenQuery(id)).catch(() => undefined),
            queryClient.invalidateQueries({ queryKey: qk.feed() }),
          ])
        }
        if (added) {
          // the added wishes and entries are saved first; the screen and the feed then load once (with them)
          const sent = await import('./extras/send')
            .then(({ sendOccasionExtras }) => sendOccasionExtras({ queryClient, occasionId: id, userId, extras: added, t, refresh }))
            .then(() => true, () => false)
          if (sent || !epoch.isCurrent()) return
        }
        await refresh()
      })()
    },
    [queryClient, router, t, userId],
  )
}

/**
 * Edit (S6): the changed fields show on the occasion screen (and in the feed) at once; the update follows.
 * "Runaway date" (pilot-decisions §000 p. 11): when the occasion really moved to another day, Start's month view
 * opens instead and the bunny carries it onto its new day (the K10 landing, `?created=`); otherwise back to the
 * occasion. Failure: the old values come back, the input is kept in memory, and the error toast offers
 * to reopen the form with it. `afterSaved` runs once the server confirmed the update (the cover photo).
 */
export function useUpdateOccasion(userId: string, occasionId: string) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { t } = useTranslation('occasion')
  const leave = useGoBack(() => {
    void router.navigate({ to: '/occasions/$occasionId', params: { occasionId }, replace: true })
  })
  return async (values: OccasionFormValues, timeZone: string, afterSaved?: () => void, sections?: OccasionSections, cover?: string | null): Promise<void> => {
    const epoch = captureEpoch()
    const key = qk.occasion(occasionId)
    await Promise.all([queryClient.cancelQueries({ queryKey: key }), queryClient.cancelQueries({ queryKey: qk.feed() })])
    if (!epoch.isCurrent()) return
    const previous = queryClient.getQueryData<OccasionScreen>(key)
    // `sections` only when the host changed what the occasion offers (the bring-along list, features/potluck);
    // `cover_theme` only when the motif changed (features/occasions/covers; undefined = the stored one stays)
    const input = { ...toOccasionInput(values, timeZone), ...(sections !== undefined ? { sections } : {}), ...(cover !== undefined ? { cover_theme: cover } : {}) }
    if (previous) {
      const edited = withOccasionEdit(previous, input)
      queryClient.setQueryData<OccasionScreen>(key, sections !== undefined ? withSections(edited, sections) : edited)
    }
    queryClient.setQueryData<FeedScreen>(qk.feed(), (feed) => withFeedOccasionEdit(feed, occasionId, input))
    setSaveState(occasionId, 'saving')
    if (previous && movedToAnotherDay(previous.occasion, values)) {
      void router.navigate({ to: '/soon', search: { view: 'month', created: occasionId }, replace: true })
    } else {
      leave()
    }
    try {
      await updateOccasion(occasionId, input, userId)
    } catch (err) {
      // a former account's rollback must never put its screen back into the (new account's) cache
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      if (previous) {
        queryClient.setQueryData<OccasionScreen>(key, previous)
        queryClient.setQueryData<FeedScreen>(qk.feed(), (feed) => withFeedOccasionEdit(feed, occasionId, previous.occasion))
      }
      void queryClient.invalidateQueries({ queryKey: qk.feed() })
      setSaveState(occasionId, null)
      keepDraft(userId, occasionId, { values })
      toast.error(t(error.key, error.params), {
        actionLabel: t('occasion.edit'),
        onAction: () => {
          void router.navigate({ to: '/occasions/$occasionId/edit', params: { occasionId } })
        },
      })
      return
    }
    if (!epoch.isCurrent()) return
    setSaveState(occasionId, null)
    afterSaved?.()
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: qk.feed() }),
    ])
  }
}

/**
 * One server-confirmed action that ends on another screen (delete, leave). It stays busy after
 * success while the navigation runs, so a second tap cannot send it again.
 */
function useLeavingAction(action: () => Promise<void>, after: () => Promise<void>) {
  const { t } = useTranslation('occasion')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const run = async (): Promise<boolean> => {
    if (working.current) return false
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return false
    working.current = true
    setBusy(true)
    try {
      await action()
    } catch (err) {
      working.current = false
      if (!epoch.isCurrent()) return false
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
      setBusy(false)
      return false
    }
    if (!epoch.isCurrent()) return false
    await after()
    return true
  }
  return { busy, run }
}

/** Host deletes the occasion (cascade on the server) → feed. `beforeLeave`: the edit form's leave guard lets it go. */
export function useDeleteOccasion(occasionId: string, userId: string, beforeLeave?: () => void) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { t } = useTranslation('occasion')
  return useLeavingAction(
    () => deleteOccasion(occasionId, userId),
    async () => {
      toast.success(t('occasion.deleted'))
      void queryClient.invalidateQueries({ queryKey: qk.feed() })
      beforeLeave?.()
      await router.navigate({ to: '/soon', replace: true })
    },
  )
}

/** A guest leaves the occasion (the server ends their RSVP and reservations there) → feed. */
export function useLeaveOccasion(occasionId: string, userId: string) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { t } = useTranslation('occasion')
  return useLeavingAction(
    () => leaveOccasion(occasionId, userId),
    async () => {
      toast.success(t('occasion.left'))
      void queryClient.invalidateQueries({ queryKey: qk.feed() })
      void queryClient.invalidateQueries({ queryKey: qk.myReservations() })
      await router.navigate({ to: '/soon', replace: true })
    },
  )
}

/** Host removes a guest; the server also revokes the occasion's active invite link. */
export function useRemoveMember(occasionId: string, userId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('occasion')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const run = async (profileId: string, name: string): Promise<boolean> => {
    if (working.current) return false
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return false
    working.current = true
    setBusy(true)
    try {
      await removeMember(occasionId, profileId, userId)
    } catch (err) {
      if (!epoch.isCurrent()) return false
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
      return false
    } finally {
      working.current = false
      if (epoch.isCurrent()) setBusy(false)
    }
    if (!epoch.isCurrent()) return false
    queryClient.setQueryData<OccasionScreen>(qk.occasion(occasionId), (screen) => screen && withoutMember(screen, profileId))
    toast.success(t('occasion.member_removed', { name }))
    void queryClient.invalidateQueries({ queryKey: qk.occasion(occasionId) })
    void queryClient.invalidateQueries({ queryKey: qk.feed() })
    return true
  }
  return { busy, run }
}

/**
 * My RSVP (F7): optimistic with rollback. Requests of one occasion run one after the other
 * (mutation scope), so the server keeps the last tap; a failed tap only rolls back while it is
 * still the visible choice, then the screen resyncs with the server.
 */
export function useRsvp(occasionId: string, userId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('occasion')
  const key = qk.occasion(occasionId)
  return useMutation({
    mutationFn: (rsvp: Rsvp) => setRsvp(occasionId, rsvp, userId),
    scope: { id: `rsvp:${occasionId}` },
    onMutate: async (rsvp: Rsvp): Promise<{ epoch: AccountEpoch; previous: Rsvp | undefined }> => {
      const epoch = captureEpoch()
      await queryClient.cancelQueries({ queryKey: key })
      if (!epoch.isCurrent()) return { epoch, previous: undefined }
      const previous = queryClient.getQueryData<OccasionScreen>(key)
      if (previous) queryClient.setQueryData<OccasionScreen>(key, withRsvp(previous, userId, rsvp))
      return { epoch, previous: previous?.viewer.rsvp }
    },
    onError: (err, rsvp, context) => {
      // no rollback, toast or refetch for an account that ended in this tab meanwhile
      if (!context?.epoch.isCurrent()) return
      const current = queryClient.getQueryData<OccasionScreen>(key)
      if (current && context.previous && current.viewer.rsvp === rsvp) {
        queryClient.setQueryData<OccasionScreen>(key, withRsvp(current, userId, context.previous))
      }
      toast.error(t(toAppError(err).key))
      void queryClient.invalidateQueries({ queryKey: key })
    },
    onSuccess: (_data, _rsvp, context) => {
      if (!context.epoch.isCurrent()) return
      void queryClient.invalidateQueries({ queryKey: qk.feed() })
    },
  })
}
