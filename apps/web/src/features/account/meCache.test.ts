import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Me } from '../../lib/api/types'
import { queryKeys } from '../../lib/queryKeys'
import { patchCachedName } from './meCache'

// QA ACCOUNT-3: after "Name ändern" the tab bar's avatar (it reads the cached get_me) shows the new initials at
// once — without touching another account's answer or what the consent guard trusts (lib/consentGate.ts).

const me = (id: string, name: string): Me => ({ profile: { id, display_name: name, locale: 'de', onboarding_done_at: null }, consents_ok: true } as unknown as Me)

describe('patchCachedName', () => {
  it('writes the confirmed name into this account\'s cached get_me and keeps its timestamp', () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.me(), me('account-a', 'Mila'), { updatedAt: 1_000 })
    patchCachedName(client, 'account-a', 'Zora Quast')
    const state = client.getQueryState<Me>(queryKeys.me())
    expect(state?.data?.profile.display_name).toBe('Zora Quast')
    expect(state?.dataUpdatedAt).toBe(1_000)
    expect(state?.isInvalidated).toBe(false)
  })

  it('an invalidated answer (updateMyProfile marks it) stays invalidated: the guard still asks the server', async () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.me(), me('account-a', 'Mila'), { updatedAt: 1_000 })
    await client.invalidateQueries({ queryKey: queryKeys.me(), exact: true, refetchType: 'none' })
    patchCachedName(client, 'account-a', 'Zora Quast')
    const state = client.getQueryState<Me>(queryKeys.me())
    expect(state?.data?.profile.display_name).toBe('Zora Quast')
    expect(state?.dataUpdatedAt).toBe(1_000)
    expect(state?.isInvalidated).toBe(true)
  })

  it('never touches another account\'s answer, and writes nothing without an answer', () => {
    const client = new QueryClient()
    patchCachedName(client, 'account-a', 'Zora Quast')
    expect(client.getQueryData(queryKeys.me())).toBeUndefined()
    client.setQueryData(queryKeys.me(), me('account-b', 'Ben'))
    patchCachedName(client, 'account-a', 'Zora Quast')
    expect(client.getQueryData<Me>(queryKeys.me())?.profile.display_name).toBe('Ben')
  })
})
