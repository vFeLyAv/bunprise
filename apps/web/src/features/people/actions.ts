import { useMemo } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { captureEpoch, type AccountEpoch } from '../../lib/accountBoundary'
import {
  blockPerson,
  removeFollower as removeFollowerCall,
  requestFollow,
  respondFollow,
  revokeFollowLinks,
  unblockPerson,
  unfollow as unfollowCall,
} from '../../lib/api/follows'
import { toAppError, type AppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { qk } from '../../lib/queryKeys'
import { toast } from '../../lib/toast'
import { invalidateLists } from '../lists/queries'
import { forgetFollowLink } from './followLinkMemory'
import { scheduleDecline } from './pendingDeclines'
import { invalidatePeople, patchFollowRequestCount } from './queries'

// Every follow action of the people screens, with the account boundary of contract.md §5.5: each one captures
// the epoch when it starts and does NOTHING with its answer — no toast, no cache write, no navigation — once the
// account that asked has ended in this tab (the wrappers already turn a late answer into session_expired and
// never send for an expected account that is not current). Not optimistic: the server decides (shared
// occasion, block, visible request); the screens refetch afterwards. Owner-side texts are static (S9): the same
// sentence whatever the other person may have planned.

export type FollowStatus = 'requested' | 'following'

interface Context {
  queryClient: QueryClient
  userId: string
  t: TFunction<'people'>
}

/** Runs one action for the screen's account; null when it failed or the account ended meanwhile. */
async function act<T>(ctx: Context, send: (epoch: AccountEpoch) => Promise<T>, done: (result: T) => void, onError?: (error: AppError) => boolean): Promise<T | null> {
  const epoch = captureEpoch()
  if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== ctx.userId)) return null
  try {
    const result = await send(epoch)
    if (!epoch.isCurrent()) return null
    done(result)
    return result
  } catch (err) {
    if (!epoch.isCurrent()) return null
    const error = toAppError(err)
    feedback('error')
    if (!onError?.(error)) toast.error(ctx.t(error.key, error.params))
    return null
  } finally {
    if (epoch.isCurrent()) void invalidatePeople(ctx.queryClient).catch(() => undefined)
  }
}

/** Lists of the person may have opened or closed (follow / unfollow / block): refetch them too. */
function refreshLists(ctx: Context): void {
  void invalidateLists(ctx.queryClient).catch(() => undefined)
}

export function createPeopleActions(ctx: Context) {
  const { queryClient, userId, t } = ctx
  return {
    /** "Folgen anfragen" / "Auch folgen" — request_follow; the answer is the same for "waiting" (INV-3). */
    request(profileId: string, name: string): Promise<FollowStatus | null> {
      return act(ctx, () => requestFollow(profileId, userId), (status) => {
        feedback('success')
        toast.success(status === 'following' ? t('people.card.following_now', { name }) : t('people.card.requested_toast', { name }))
        refreshLists(ctx)
      })
    },

    /** "Anfrage zurückziehen" (unfollow on a pending row) — no consents needed: it narrows. */
    withdraw(profileId: string, name: string): Promise<true | null> {
      return act(ctx, async () => {
        await unfollowCall(profileId, userId)
        return true as const
      }, () => {
        toast.info(t('people.card.withdrawn', { name }))
      })
    },

    /** "Nicht mehr folgen" — the giver's own reservations on their lists end (unfollowed). */
    unfollow(profileId: string, name: string): Promise<true | null> {
      return act(ctx, async () => {
        await unfollowCall(profileId, userId)
        return true as const
      }, () => {
        feedback('success')
        toast.info(t('people.giver.unfollowed', { name }))
        refreshLists(ctx)
        void queryClient.invalidateQueries({ queryKey: qk.myReservations() }).catch(() => undefined)
      })
    },

    /** "Annehmen" — respond_follow(…, true); the request dot counts one less. */
    accept(profileId: string): Promise<true | null> {
      return act(ctx, async () => {
        await respondFollow(profileId, true, userId)
        return true as const
      }, () => {
        feedback('success')
        patchFollowRequestCount(queryClient, userId, (count) => count - 1)
      })
    },

    /** "Ablehnen" — hidden at once, the toast says what happens, sent after the 5 s undo (pendingDeclines.ts). */
    decline(profileId: string, name: string): void {
      scheduleDecline({
        profileId,
        userId,
        queryClient,
        text: { declined: t('people.decline.done', { name }), undo: t('people.decline.undo') },
        onError: () => {
          toast.error(t('people.decline.failed'))
        },
      })
    },

    /** "Als Follower entfernen" — the same answer whatever the person had planned (S9). */
    removeFollower(profileId: string, name: string): Promise<true | null> {
      return act(ctx, async () => {
        await removeFollowerCall(profileId, userId)
        return true as const
      }, () => {
        feedback('success')
        toast.info(t('people.remove.done', { name }))
        refreshLists(ctx)
      })
    },

    /**
     * "Blockieren" (and "Ablehnen und blockieren": `declineFirst` — the 30-day silence stays even after an unblock,
     * INV-6). With `revokeLinks` (the switch, on by default) revoke_follow_links() goes out right after block_user
     * with the SAME account — both narrow, neither needs consents.
     */
    block(profileId: string, name: string, options: { revokeLinks: boolean; declineFirst?: boolean }): Promise<true | null> {
      let linksFailed = false
      return act(ctx, async (epoch) => {
        if (options.declineFirst) {
          try {
            await respondFollow(profileId, false, userId)
          } catch (err) {
            // the request is already gone (withdrawn, expired): the block below still goes out
            if (!(toAppError(err).code === 'not_found')) throw err
          }
          if (!epoch.isCurrent()) return true as const // the account ended between the calls: nothing more is sent
        }
        await blockPerson(profileId, userId)
        if (options.revokeLinks && epoch.isCurrent()) {
          try {
            await revokeFollowLinks(userId)
            if (epoch.isCurrent()) forgetFollowLink(userId)
          } catch {
            // The block has already succeeded: refresh its access changes even if this second call failed.
            linksFailed = true
          }
        }
        return true as const
      }, () => {
        feedback(linksFailed ? 'error' : 'success')
        if (linksFailed) toast.error(t('people.block.links_failed', { name }))
        else toast.info(options.revokeLinks ? t('people.block.done_links', { name }) : t('people.block.done', { name }))
        if (options.declineFirst) patchFollowRequestCount(queryClient, userId, (count) => count - 1)
        refreshLists(ctx)
        // a block also ends memberships in each other's occasions: the feed and those screens change
        void queryClient.invalidateQueries({ queryKey: qk.feed() }).catch(() => undefined)
        void queryClient.invalidateQueries({ queryKey: ['occasion'] }).catch(() => undefined)
        void queryClient.invalidateQueries({ queryKey: qk.myReservations() }).catch(() => undefined)
      })
    },

    /** "Aufheben" — gives nothing back. */
    unblock(profileId: string, name: string): Promise<true | null> {
      return act(ctx, async () => {
        await unblockPerson(profileId, userId)
        return true as const
      }, () => {
        toast.info(t('people.unblock.done', { name }))
      })
    },
  }
}

export type PeopleActions = ReturnType<typeof createPeopleActions>

export function usePeopleActions(userId: string): PeopleActions {
  const queryClient = useQueryClient()
  const { t } = useTranslation('people')
  return useMemo(() => createPeopleActions({ queryClient, userId, t }), [queryClient, userId, t])
}
