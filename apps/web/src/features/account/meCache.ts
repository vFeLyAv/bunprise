import type { QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api/types'
import { queryKeys } from '../../lib/queryKeys'

/**
 * "Name ändern" saved: the name the server just confirmed goes into the cached get_me (['me']) at once. The tab
 * bar's avatar reads its initials from there (features/nav/useMyName.ts) and otherwise kept the old name until
 * the next screen change (QA ACCOUNT-3).
 * Account boundary and the consent guard (lib/consentGate.ts) stay as they were: only a successful answer of
 * THIS account is touched, its timestamp is kept, and an answer that was invalidated (updateMyProfile marks it,
 * so the guard asks the server again) stays invalidated — the patch never extends or restores that trust.
 */
export function patchCachedName(queryClient: QueryClient, userId: string, name: string): void {
  const state = queryClient.getQueryState<Me>(queryKeys.me())
  const me = state?.data
  if (!state || state.status !== 'success' || !me || me.profile?.id !== userId || me.profile.display_name === name) return
  queryClient.setQueryData<Me>(queryKeys.me(), { ...me, profile: { ...me.profile, display_name: name } }, { updatedAt: state.dataUpdatedAt })
  if (state.isInvalidated) void queryClient.invalidateQueries({ queryKey: queryKeys.me(), exact: true, refetchType: 'none' })
}
