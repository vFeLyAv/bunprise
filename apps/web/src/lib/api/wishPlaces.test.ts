import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared wishes (lib/api/wishPlaces.ts, 20261027200000) against a mocked supabase client: the arguments, the pinned
// account, the answer checks, and the two "cannot share yet" cases the callers fall back on (no migration: PGRST202 /
// 42883; the database switch off: not_allowed from add_wishes_to_list).
const supabase = { rpc: vi.fn(), auth: { getSession: vi.fn() } }
const headers = vi.fn<(name: string, value: string) => void>()
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import { isFeatureUnavailableError } from './unavailable'
import {
  SharedWishesOffError, addWishesToList, deleteWishEverywhere, dismissReceivedPrompt, isSharedWishesUnavailable,
  removeWishFromList, sharedWishesEnabled,
} from './wishPlaces'

const WISH = '0f8b9c4a-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
const WISH_2 = '2f8b9c4a-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
const LIST = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const OCCASION = '3c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

function answerRpc(result: { data: unknown; error: unknown }) {
  vi.mocked(supabase.rpc).mockReturnValueOnce({
    setHeader: (name: string, value: string) => {
      headers(name, value)
      return Promise.resolve(result)
    },
  } as never)
}
const pgError = (code: string, message: string) => ({ code, message, details: null, hint: null })

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset()
  headers.mockReset()
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'owner-1' }, access_token: 'token-owner-1' } }, error: null } as never)
})

describe('sharedWishesEnabled', () => {
  it('on in the demo and with VITE_SHARED_WISHES=1, off otherwise', () => {
    expect(sharedWishesEnabled({ VITE_DEMO: '1' })).toBe(true)
    expect(sharedWishesEnabled({ VITE_SHARED_WISHES: '1' })).toBe(true)
    expect(sharedWishesEnabled({})).toBe(false)
    expect(sharedWishesEnabled({ VITE_SHARED_WISHES: '0', VITE_DEMO: '0' })).toBe(false)
  })
})

describe('addWishesToList', () => {
  it('ONE call with every wish, the pinned token; returns how many were added', async () => {
    answerRpc({ data: { ok: true, added: 2 }, error: null })
    expect(await addWishesToList(LIST, [WISH, WISH_2], 'owner-1')).toEqual({ added: 2 })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('add_wishes_to_list', { p_list_id: LIST, p_wish_ids: [WISH, WISH_2] })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-owner-1')
  })

  it('the switch off (not_allowed) and a server without the migration: "fall back to moving"', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'not_allowed') })
    const off = await addWishesToList(LIST, [WISH]).catch((e: unknown) => e)
    expect(off).toBeInstanceOf(SharedWishesOffError)
    expect(isSharedWishesUnavailable(off)).toBe(true)
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.add_wishes_to_list') })
    const missing = await addWishesToList(LIST, [WISH]).catch((e: unknown) => e)
    expect(isFeatureUnavailableError(missing, 'shared_wishes')).toBe(true)
    expect(isSharedWishesUnavailable(missing)).toBe(true)
  })

  it('other refusals pass through (not a reason to move); a malformed answer is generic; another account sends nothing', async () => {
    for (const code of ['not_found', 'validation', 'limit_reached', 'consent_required']) {
      answerRpc({ data: null, error: pgError('P0001', code) })
      const err = await addWishesToList(LIST, [WISH]).catch((e: unknown) => e)
      expect(err).toMatchObject({ code })
      expect(isSharedWishesUnavailable(err)).toBe(false)
    }
    answerRpc({ data: { ok: true }, error: null })
    await expect(addWishesToList(LIST, [WISH])).rejects.toMatchObject({ code: 'generic' })
    await expect(addWishesToList(LIST, [WISH], 'owner-2')).rejects.toMatchObject({ code: 'session_expired' })
    expect(supabase.rpc).toHaveBeenCalledTimes(5)
  })
})

describe('removeWishFromList / deleteWishEverywhere / dismissReceivedPrompt', () => {
  it('send exactly their arguments with the pinned token; the answer is { ok }', async () => {
    answerRpc({ data: { ok: true }, error: null })
    await removeWishFromList(WISH, LIST, 'owner-1')
    expect(supabase.rpc).toHaveBeenLastCalledWith('remove_wish_from_list', { p_wish_id: WISH, p_list_id: LIST })
    answerRpc({ data: { ok: true }, error: null })
    await deleteWishEverywhere(WISH, 'owner-1')
    expect(supabase.rpc).toHaveBeenLastCalledWith('delete_wish_everywhere', { p_wish_id: WISH })
    answerRpc({ data: { ok: true }, error: null })
    await dismissReceivedPrompt(OCCASION, 'owner-1')
    expect(supabase.rpc).toHaveBeenLastCalledWith('dismiss_received_prompt', { p_occasion_id: OCCASION })
    expect(headers).toHaveBeenCalledTimes(3)
  })

  it('refusals pass through; malformed answers are generic; 42883 is "not available yet"', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'validation') })
    await expect(removeWishFromList(WISH, LIST)).rejects.toMatchObject({ code: 'validation' })
    answerRpc({ data: { ok: false }, error: null })
    await expect(deleteWishEverywhere(WISH)).rejects.toMatchObject({ code: 'generic' })
    answerRpc({ data: null, error: pgError('42883', 'function public.dismiss_received_prompt(uuid) does not exist') })
    const err = await dismissReceivedPrompt(OCCASION).catch((e: unknown) => e)
    expect(isFeatureUnavailableError(err, 'shared_wishes')).toBe(true)
  })
})
