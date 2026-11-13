import { beforeEach, describe, expect, it, vi } from 'vitest'

// The list cover wrappers against a mocked supabase client (no network): arguments, the pinned account, the shape
// checks of the answers, the quota error, the "server without the migration" error / export and the export merge.
const supabase = { rpc: vi.fn(), auth: { getSession: vi.fn() } }
const headers = vi.fn<(name: string, value: string) => void>()
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import { deleteListPhoto, exportMyListPhotos, getListPhoto, LIST_PHOTOS_PER_OWNER, uploadListPhoto, withListPhotos } from './listPhotos'
import { bytesToBase64, isPhotoLimitError } from './photos'
import { isFeatureUnavailableError } from './unavailable'

const LIST_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
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
const UPLOAD = { mime: 'image/webp' as const, bytes: new Uint8Array(30), width: 960, height: 540 }

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset()
  headers.mockReset()
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'owner-1' }, access_token: 'token-owner-1' } }, error: null } as never)
})

describe('uploadListPhoto / deleteListPhoto', () => {
  it('sends the five arguments with the pinned token and returns the new version', async () => {
    answerRpc({ data: { ok: true, updated_at: AT }, error: null })
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9])
    expect(await uploadListPhoto(LIST_ID, { mime: 'image/jpeg', bytes, width: 800, height: 600 }, 'owner-1')).toEqual({ updated_at: AT })
    expect(supabase.rpc).toHaveBeenCalledWith('set_list_photo', {
      p_list_id: LIST_ID, p_mime: 'image/jpeg', p_data_base64: bytesToBase64(bytes), p_width: 800, p_height: 600,
    })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-owner-1')
    expect(LIST_PHOTOS_PER_OWNER).toBe(30)
  })

  it('the quota answer is a PhotoLimitError; not_found stays not_found; another account sends nothing', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'photo_limit') })
    expect(isPhotoLimitError(await uploadListPhoto(LIST_ID, UPLOAD).catch((e: unknown) => e))).toBe(true)
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(uploadListPhoto(LIST_ID, UPLOAD)).rejects.toMatchObject({ code: 'not_found' })
    await expect(uploadListPhoto(LIST_ID, UPLOAD, 'owner-2')).rejects.toMatchObject({ code: 'session_expired' })
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('delete: remove_list_photo with the list id; a malformed answer is generic', async () => {
    answerRpc({ data: { ok: true }, error: null })
    await deleteListPhoto(LIST_ID)
    expect(supabase.rpc).toHaveBeenCalledWith('remove_list_photo', { p_list_id: LIST_ID })
    answerRpc({ data: { fine: 1 }, error: null })
    await expect(deleteListPhoto(LIST_ID)).rejects.toMatchObject({ code: 'generic' })
  })

  it('a server without the migration: a calm FeatureUnavailableError (PGRST202 / 42883) for upload, delete and read', async () => {
    for (const error of [pgError('PGRST202', 'Could not find the function public.set_list_photo'), pgError('42883', 'function does not exist')]) {
      answerRpc({ data: null, error })
      const err = await uploadListPhoto(LIST_ID, UPLOAD).catch((e: unknown) => e)
      expect(isFeatureUnavailableError(err, 'list_photos')).toBe(true)
      expect(err).toMatchObject({ code: 'generic', feature: 'list_photos' })
    }
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.remove_list_photo') })
    expect(isFeatureUnavailableError(await deleteListPhoto(LIST_ID).catch((e: unknown) => e))).toBe(true)
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.get_list_photo') })
    expect(isFeatureUnavailableError(await getListPhoto(LIST_ID).catch((e: unknown) => e))).toBe(true)
  })
})

describe('getListPhoto', () => {
  it('turns the base64 answer into a typed Blob with its meta', async () => {
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 8, 7])
    answerRpc({ data: { mime: 'image/webp', data: bytesToBase64(bytes), width: 960, height: 540, updated_at: AT }, error: null })
    const photo = await getListPhoto(LIST_ID, 'owner-1')
    expect(supabase.rpc).toHaveBeenCalledWith('get_list_photo', { p_list_id: LIST_ID })
    expect(photo).toMatchObject({ mime: 'image/webp', width: 960, height: 540, updated_at: AT })
    expect(photo.blob.type).toBe('image/webp')
    expect(new Uint8Array(await photo.blob.arrayBuffer())).toEqual(bytes)
  })

  it('no access / no cover → not_found; a foreign type or a bad size → generic', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(getListPhoto(LIST_ID)).rejects.toMatchObject({ code: 'not_found' })
    for (const data of [
      { mime: 'image/png', data: 'AAAA', width: 1, height: 1, updated_at: AT },
      { mime: 'image/webp', data: 'AAAA', width: 0, height: 1, updated_at: AT },
      { mime: 'image/webp', data: 'AAAA', width: 1, height: 4096, updated_at: AT },
    ]) {
      answerRpc({ data, error: null })
      await expect(getListPhoto(LIST_ID)).rejects.toMatchObject({ code: 'generic' })
    }
  })
})

describe('export', () => {
  const entry = {
    wishlist_id: LIST_ID, list_title: 'Geburtstag', occasion_id: null, mime: 'image/webp', width: 960, height: 540, size_bytes: 3,
    updated_at: AT, data_base64: 'AAAA',
  }

  it('keeps well-formed entries; a server without the migration has none', async () => {
    answerRpc({ data: [entry, { wishlist_id: 7 }, { ...entry, mime: 'image/png' }], error: null })
    expect(await exportMyListPhotos()).toEqual([entry])
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.export_my_list_photos') })
    expect(await exportMyListPhotos()).toEqual([])
    answerRpc({ data: null, error: pgError('P0001', 'not_allowed') })
    await expect(exportMyListPhotos()).rejects.toMatchObject({ code: 'not_allowed' })
  })

  it('withListPhotos adds `list_photos` next to the RPC keys', () => {
    expect(withListPhotos({ profile: { id: 'p' } }, [entry as never])).toEqual({ profile: { id: 'p' }, list_photos: [entry] })
    expect(withListPhotos(null, [])).toBeNull()
  })
})
