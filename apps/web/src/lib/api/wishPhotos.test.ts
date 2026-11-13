import { beforeEach, describe, expect, it, vi } from 'vitest'

// The wish photo wrappers against a mocked supabase client (no network): arguments, the pinned account, the shape
// checks of the answers, the quota error, the "server without the migration" export and the export merge.
const supabase = { rpc: vi.fn(), auth: { getSession: vi.fn() } }
const headers = vi.fn<(name: string, value: string) => void>()
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import { bytesToBase64, isPhotoLimitError } from './photos'
import { deleteWishPhoto, exportMyWishPhotos, getWishPhoto, uploadWishPhoto, withWishPhotos } from './wishPhotos'

const WISH_ID = '0f8b9c4a-1d2e-4f5a-8b6c-7d8e9f0a1b2c'
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

describe('uploadWishPhoto / deleteWishPhoto', () => {
  it('sends the five arguments with the pinned token and returns the new version', async () => {
    answerRpc({ data: { ok: true, updated_at: AT }, error: null })
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9])
    expect(await uploadWishPhoto(WISH_ID, { mime: 'image/jpeg', bytes, width: 800, height: 600 }, 'owner-1')).toEqual({ updated_at: AT })
    expect(supabase.rpc).toHaveBeenCalledWith('set_wish_photo', {
      p_wish_id: WISH_ID, p_mime: 'image/jpeg', p_data_base64: bytesToBase64(bytes), p_width: 800, p_height: 600,
    })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-owner-1')
  })

  it('the quota answer is a PhotoLimitError; not_found stays not_found; another account sends nothing', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'photo_limit') })
    const upload = { mime: 'image/webp' as const, bytes: new Uint8Array(30), width: 1, height: 1 }
    expect(isPhotoLimitError(await uploadWishPhoto(WISH_ID, upload).catch((e: unknown) => e))).toBe(true)
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(uploadWishPhoto(WISH_ID, upload)).rejects.toMatchObject({ code: 'not_found' })
    await expect(uploadWishPhoto(WISH_ID, upload, 'owner-2')).rejects.toMatchObject({ code: 'session_expired' })
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('delete: remove_wish_photo with the wish id; a malformed answer is generic', async () => {
    answerRpc({ data: { ok: true }, error: null })
    await deleteWishPhoto(WISH_ID)
    expect(supabase.rpc).toHaveBeenCalledWith('remove_wish_photo', { p_wish_id: WISH_ID })
    answerRpc({ data: { fine: 1 }, error: null })
    await expect(deleteWishPhoto(WISH_ID)).rejects.toMatchObject({ code: 'generic' })
  })
})

describe('getWishPhoto', () => {
  it('turns the base64 answer into a typed Blob with its meta', async () => {
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 8, 7])
    answerRpc({ data: { mime: 'image/webp', data: bytesToBase64(bytes), width: 480, height: 480, updated_at: AT }, error: null })
    const photo = await getWishPhoto(WISH_ID)
    expect(supabase.rpc).toHaveBeenCalledWith('get_wish_photo', { p_wish_id: WISH_ID })
    expect(photo).toMatchObject({ mime: 'image/webp', width: 480, height: 480, updated_at: AT })
    expect(photo.blob.type).toBe('image/webp')
    expect(new Uint8Array(await photo.blob.arrayBuffer())).toEqual(bytes)
  })

  it('no access / no photo → not_found; a foreign type or a bad size → generic', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(getWishPhoto(WISH_ID)).rejects.toMatchObject({ code: 'not_found' })
    for (const data of [
      { mime: 'image/png', data: 'AAAA', width: 1, height: 1, updated_at: AT },
      { mime: 'image/webp', data: 'AAAA', width: 0, height: 1, updated_at: AT },
      { mime: 'image/webp', data: 'AAAA', width: 1, height: 4096, updated_at: AT },
    ]) {
      answerRpc({ data, error: null })
      await expect(getWishPhoto(WISH_ID)).rejects.toMatchObject({ code: 'generic' })
    }
  })
})

describe('export', () => {
  const entry = { wish_id: WISH_ID, wish_title: 'Kaffeemühle', wishlist_id: 'l-1', mime: 'image/webp', width: 1, height: 1, size_bytes: 3, updated_at: AT, data_base64: 'AAAA' }

  it('keeps well-formed entries; a server without the migration has none', async () => {
    answerRpc({ data: [entry, { wish_id: 7 }], error: null })
    expect(await exportMyWishPhotos()).toEqual([entry])
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.export_my_wish_photos') })
    expect(await exportMyWishPhotos()).toEqual([])
  })

  it('withWishPhotos adds `wish_photos` next to the RPC keys', () => {
    expect(withWishPhotos({ profile: { id: 'p' } }, [entry as never])).toEqual({ profile: { id: 'p' }, wish_photos: [entry] })
    expect(withWishPhotos(null, [])).toBeNull()
  })
})
