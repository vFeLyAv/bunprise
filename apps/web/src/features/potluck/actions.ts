import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { addPotluckItem, claimPotluckItem, deletePotluckItem, renamePotluckItem, unclaimPotluckItem } from '../../lib/api/potluck'
import type { Me as AccountMe, OccasionScreen } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { toast } from '../../lib/toast'
import { withAddedItem, withClaim, withItemId, withoutItem, withRenamedItem, type Me } from './cache'

// What the bring-along list DOES (design §1.3–§1.4):
// - adding, renaming and deleting an entry are optimistic: the screen changes at once and rolls back with a
//   toast if the server says no (our own error keys, never server text);
// - "Ich bring's mit" / "Doch nicht" wait for the server (the button shows its loading state): two people can
//   press at the same moment and the one who was late must never see "Du" for an instant (pilot-decisions §1,
//   the same rule as every "only one may win" action). already_claimed refreshes the screen with a toast.
// Account boundary (lib/accountBoundary.ts): every call is sent for the screen's account and its answer is
// ignored once that account ended in this tab.

export interface PotluckActions {
  add: (title: string, claim: boolean) => void
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  claim: (id: string) => Promise<void>
  unclaim: (id: string) => Promise<void>
  /** the entry whose "Ich bring's mit" / "Doch nicht" is on its way (one at a time) */
  busyId: string | null
}

export function usePotluckActions(occasionId: string, userId: string): PotluckActions {
  const queryClient = useQueryClient()
  const { t } = useTranslation('occasion')
  const [busyId, setBusyId] = useState<string | null>(null)
  const working = useRef(false)
  const key = qk.occasion(occasionId)

  const me = useCallback((): Me => {
    const account = queryClient.getQueryData<AccountMe>(qk.me())
    return { profileId: userId, displayName: account?.profile.id === userId ? account.profile.display_name : null }
  }, [queryClient, userId])

  const failed = useCallback(
    (err: unknown) => {
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
    },
    [t],
  )

  /** One optimistic write: apply, send, roll back to `previous` on failure, refresh in the background. */
  const optimistic = useCallback(
    (change: (screen: OccasionScreen) => OccasionScreen, send: () => Promise<unknown>, after?: (result: unknown) => void) => {
      const epoch = captureEpoch()
      const previous = queryClient.getQueryData<OccasionScreen>(key)
      if (!previous) return
      queryClient.setQueryData<OccasionScreen>(key, change(previous))
      void (async () => {
        try {
          const result = await send()
          if (!epoch.isCurrent()) return
          after?.(result)
        } catch (err) {
          if (!epoch.isCurrent()) return
          queryClient.setQueryData<OccasionScreen>(key, previous)
          failed(err)
        }
        if (epoch.isCurrent()) void queryClient.invalidateQueries({ queryKey: key })
      })()
    },
    [queryClient, key, failed],
  )

  const add = useCallback(
    (title: string, claim: boolean) => {
      const temp = `new-${crypto.randomUUID()}`
      optimistic(
        (screen) => withAddedItem(screen, { id: temp, title, createdAt: new Date().toISOString(), claim }, me()),
        () => addPotluckItem(occasionId, title, claim, userId),
        (result) => {
          const id = (result as { id?: string } | undefined)?.id
          if (id) queryClient.setQueryData<OccasionScreen>(key, (screen) => (screen ? withItemId(screen, temp, id) : screen))
        },
      )
    },
    [optimistic, occasionId, userId, me, queryClient, key],
  )

  const rename = useCallback(
    (id: string, title: string) => optimistic((screen) => withRenamedItem(screen, id, title), () => renamePotluckItem(id, title, userId)),
    [optimistic, userId],
  )

  const remove = useCallback(
    (id: string) => optimistic((screen) => withoutItem(screen, id), () => deletePotluckItem(id, userId)),
    [optimistic, userId],
  )

  /** Server-confirmed: the entry shows "Du" only after the database said yes. */
  const confirmed = useCallback(
    async (id: string, mine: boolean) => {
      if (working.current) return
      working.current = true
      setBusyId(id)
      const epoch = captureEpoch()
      try {
        await (mine ? claimPotluckItem(id, userId) : unclaimPotluckItem(id, userId))
        if (!epoch.isCurrent()) return
        queryClient.setQueryData<OccasionScreen>(key, (screen) => (screen ? withClaim(screen, id, mine ? me() : null) : screen))
      } catch (err) {
        if (!epoch.isCurrent()) return
        failed(err)
      } finally {
        working.current = false
        if (epoch.isCurrent()) {
          setBusyId(null)
          void queryClient.invalidateQueries({ queryKey: key })
        }
      }
    },
    [queryClient, key, userId, me, failed],
  )

  return {
    add,
    rename,
    remove,
    claim: (id) => confirmed(id, true),
    unclaim: (id) => confirmed(id, false),
    busyId,
  }
}
