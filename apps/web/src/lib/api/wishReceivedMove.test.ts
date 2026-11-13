import { beforeEach, describe, expect, it, vi } from 'vitest'

// setWishReceived / moveWish (lib/api/wishes.ts, 20261022160000) against a mocked supabase client: the arguments,
// the pinned account, the shape checks of the answers and the calm "noch nicht verfügbar" error of a server without
// the migration (PGRST202 / 42883).
const supabase = { rpc: vi.fn(), auth: { getSession: vi.fn() } }
const headers = vi.fn<(name: string, value: string) => void>()
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import { isFeatureUnavailableError } from './unavailable'
import { moveWish, setWishReceived } from './wishes'

const WISH = '0f8b9c4a-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
const LIST = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const AT = '2026-10-22T10:00:00.123456+00:00'

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

describe('setWishReceived', () => {
  it('marks and un-marks with the pinned token; returns the moment (null when open)', async () => {
    answerRpc({ data: { ok: true, received_at: AT }, error: null })
    expect(await setWishReceived(WISH, true, 'owner-1')).toEqual({ received_at: AT })
    expect(supabase.rpc).toHaveBeenCalledWith('set_wish_received', { p_wish_id: WISH, p_received: true })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-owner-1')
    answerRpc({ data: { ok: true, received_at: null }, error: null })
    expect(await setWishReceived(WISH, false)).toEqual({ received_at: null })
    expect(supabase.rpc).toHaveBeenLastCalledWith('set_wish_received', { p_wish_id: WISH, p_received: false })
  })

  it('not_found stays not_found; a malformed or contradicting answer is generic; another account sends nothing', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(setWishReceived(WISH, true)).rejects.toMatchObject({ code: 'not_found' })
    for (const data of [{ ok: true }, { ok: true, received_at: 5 }, { ok: true, received_at: null }]) {
      answerRpc({ data, error: null })
      await expect(setWishReceived(WISH, true)).rejects.toMatchObject({ code: 'generic' })
    }
    await expect(setWishReceived(WISH, true, 'owner-2')).rejects.toMatchObject({ code: 'session_expired' })
    expect(supabase.rpc).toHaveBeenCalledTimes(4)
  })

  it('a server without the migration: FeatureUnavailableError("wish_received")', async () => {
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.set_wish_received') })
    const err = await setWishReceived(WISH, true).catch((e: unknown) => e)
    expect(isFeatureUnavailableError(err, 'wish_received')).toBe(true)
    expect(isFeatureUnavailableError(err, 'move_wish')).toBe(false)
  })
})

describe('moveWish', () => {
  it('sends the wish and the target list with the pinned token; the answer is { ok }', async () => {
    answerRpc({ data: { ok: true }, error: null })
    await moveWish(WISH, LIST, 'owner-1')
    expect(supabase.rpc).toHaveBeenCalledWith('move_wish', { p_wish_id: WISH, p_target_list_id: LIST })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-owner-1')
  })

  it('not_found and consent_required pass through; a malformed answer is generic; 42883 is "not available yet"', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(moveWish(WISH, LIST)).rejects.toMatchObject({ code: 'not_found' })
    answerRpc({ data: null, error: pgError('P0001', 'consent_required') })
    await expect(moveWish(WISH, LIST)).rejects.toMatchObject({ code: 'consent_required' })
    answerRpc({ data: { moved: 1 }, error: null })
    await expect(moveWish(WISH, LIST)).rejects.toMatchObject({ code: 'generic' })
    answerRpc({ data: null, error: pgError('42883', 'function public.move_wish(uuid, uuid) does not exist') })
    expect(isFeatureUnavailableError(await moveWish(WISH, LIST).catch((e: unknown) => e), 'move_wish')).toBe(true)
    await expect(moveWish(WISH, LIST, 'owner-2')).rejects.toMatchObject({ code: 'session_expired' })
    expect(supabase.rpc).toHaveBeenCalledTimes(4)
  })
})
