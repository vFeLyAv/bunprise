import { beforeEach, describe, expect, it, vi } from 'vitest'

// The profile / banner photo wrappers (20261024120000) against a mocked supabase client (no network): arguments, the
// pinned account, the shape checks of the answers, "a server without the migration" (FeatureUnavailableError, export
// []), the export merge, and the parsers that carry the photo meta (profile card, overview `me`, suggestions).
const supabase = { rpc: vi.fn(), auth: { getSession: vi.fn() } }
const headers = vi.fn<(name: string, value: string) => void>()
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import { asProfile } from './follows.types'
import { asListsOverview, asProfileCard } from './lists.types'
import { bytesToBase64 } from './photos'
import { deleteProfilePhoto, exportMyProfilePhotos, getProfilePhoto, uploadProfilePhoto, withProfilePhotos } from './profilePhotos'
import { isFeatureUnavailableError } from './unavailable'

const PERSON = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f'
const AT = '2026-10-24T10:00:00.123456+00:00'
const META = { width: 512, height: 512, updated_at: AT }

function answerRpc(result: { data: unknown; error: unknown }) {
  vi.mocked(supabase.rpc).mockReturnValueOnce({
    setHeader: (name: string, value: string) => {
      headers(name, value)
      return Promise.resolve(result)
    },
  } as never)
}

const pgError = (code: string, message: string) => ({ code, message, details: null, hint: null })
const UPLOAD = { mime: 'image/webp' as const, bytes: new Uint8Array(30), width: 512, height: 512 }

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset()
  headers.mockReset()
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'me-1' }, access_token: 'token-me-1' } }, error: null } as never)
})

describe('uploadProfilePhoto / deleteProfilePhoto', () => {
  it('sends the kind and the four photo arguments with the pinned token and returns the new version', async () => {
    answerRpc({ data: { ok: true, updated_at: AT }, error: null })
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9])
    expect(await uploadProfilePhoto('banner', { mime: 'image/jpeg', bytes, width: 1600, height: 640 }, 'me-1')).toEqual({ updated_at: AT })
    expect(supabase.rpc).toHaveBeenCalledWith('set_profile_photo', {
      p_kind: 'banner', p_mime: 'image/jpeg', p_data_base64: bytesToBase64(bytes), p_width: 1600, p_height: 640,
    })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-me-1')
  })

  it('validation stays validation; another account sends nothing; a malformed answer is generic', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'validation') })
    await expect(uploadProfilePhoto('avatar', UPLOAD)).rejects.toMatchObject({ code: 'validation' })
    await expect(uploadProfilePhoto('avatar', UPLOAD, 'me-2')).rejects.toMatchObject({ code: 'session_expired' })
    answerRpc({ data: { ok: true }, error: null })
    await expect(uploadProfilePhoto('avatar', UPLOAD)).rejects.toMatchObject({ code: 'generic' })
    expect(supabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('delete: remove_profile_photo with the kind; a malformed answer is generic', async () => {
    answerRpc({ data: { ok: true }, error: null })
    await deleteProfilePhoto('avatar')
    expect(supabase.rpc).toHaveBeenCalledWith('remove_profile_photo', { p_kind: 'avatar' })
    answerRpc({ data: { fine: 1 }, error: null })
    await expect(deleteProfilePhoto('banner')).rejects.toMatchObject({ code: 'generic' })
  })

  it('a server without the migration: a calm FeatureUnavailableError for upload, delete and read ("Das geht bald")', async () => {
    for (const error of [pgError('PGRST202', 'Could not find the function public.set_profile_photo'), pgError('42883', 'function does not exist')]) {
      answerRpc({ data: null, error })
      const err = await uploadProfilePhoto('avatar', UPLOAD).catch((e: unknown) => e)
      expect(isFeatureUnavailableError(err, 'profile_photos')).toBe(true)
      expect(err).toMatchObject({ code: 'generic', feature: 'profile_photos' })
    }
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.remove_profile_photo') })
    expect(isFeatureUnavailableError(await deleteProfilePhoto('avatar').catch((e: unknown) => e), 'profile_photos')).toBe(true)
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.get_profile_photo') })
    expect(isFeatureUnavailableError(await getProfilePhoto(PERSON, 'avatar').catch((e: unknown) => e), 'profile_photos')).toBe(true)
  })
})

describe('getProfilePhoto', () => {
  it('asks for the person and the kind and turns the base64 answer into a typed Blob with its meta', async () => {
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 8, 7])
    answerRpc({ data: { mime: 'image/webp', data: bytesToBase64(bytes), ...META }, error: null })
    const photo = await getProfilePhoto(PERSON, 'avatar', 'me-1')
    expect(supabase.rpc).toHaveBeenCalledWith('get_profile_photo', { p_profile_id: PERSON, p_kind: 'avatar' })
    expect(photo).toMatchObject({ mime: 'image/webp', ...META })
    expect(new Uint8Array(await photo.blob.arrayBuffer())).toEqual(bytes)
  })

  it('no access / no photo → not_found (one answer); a foreign type or a bad size → generic', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(getProfilePhoto(PERSON, 'banner')).rejects.toMatchObject({ code: 'not_found' })
    for (const data of [
      { mime: 'image/png', data: 'AAAA', width: 1, height: 1, updated_at: AT },
      { mime: 'image/webp', data: 'AAAA', width: 1, height: 4096, updated_at: AT },
    ]) {
      answerRpc({ data, error: null })
      await expect(getProfilePhoto(PERSON, 'avatar')).rejects.toMatchObject({ code: 'generic' })
    }
  })
})

describe('export', () => {
  const entry = { kind: 'avatar', mime: 'image/webp', width: 512, height: 512, size_bytes: 3, updated_at: AT, data_base64: 'AAAA' }

  it('keeps well-formed entries; a server without the migration has none', async () => {
    answerRpc({ data: [entry, { kind: 'cover', mime: 'image/webp', data_base64: 'AAAA' }, { ...entry, mime: 'image/png' }], error: null })
    expect(await exportMyProfilePhotos()).toEqual([entry])
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function public.export_my_profile_photos') })
    expect(await exportMyProfilePhotos()).toEqual([])
    answerRpc({ data: null, error: pgError('P0001', 'not_allowed') })
    await expect(exportMyProfilePhotos()).rejects.toMatchObject({ code: 'not_allowed' })
  })

  it('withProfilePhotos adds `profile_photos` next to the RPC keys', () => {
    expect(withProfilePhotos({ profile: { id: 'p' } }, [entry as never])).toEqual({ profile: { id: 'p' }, profile_photos: [entry] })
    expect(withProfilePhotos(null, [])).toBeNull()
  })
})

describe('the parsers carry the photo meta', () => {
  it('a profile card: both keys, null when absent or malformed (one parser for lists and follows)', () => {
    const card = { id: PERSON, display_name: 'Anna', banner: 'sky', photo: META, banner_photo: { ...META, width: 4096 } }
    expect(asProfileCard(card)).toEqual({ id: PERSON, display_name: 'Anna', banner: 'sky', photo: META, banner_photo: null })
    expect(asProfile({ id: PERSON, display_name: 'Anna', banner: null })).toEqual({ id: PERSON, display_name: 'Anna', banner: null, photo: null, banner_photo: null })
  })

  it('the overview: me keeps the difference "no key" (older server) / null; suggestions get the photo', () => {
    const base = { stats: {}, my_lists: [], following: [], upcoming: [] }
    const withKeys = asListsOverview({ ...base, me: { id: 'me', display_name: 'Mila', banner: null, live_links: 0, photo: META, banner_photo: null },
      suggestions: [{ profile: { id: PERSON, display_name: 'Ben', photo: META }, shared_occasion_title: 'Fest' }] })
    expect(withKeys.me).toMatchObject({ photo: META, banner_photo: null })
    expect(withKeys.suggestions[0]?.profile.photo).toEqual(META)
    const older = asListsOverview({ ...base, me: { id: 'me', display_name: 'Mila', banner: null, live_links: 0 }, suggestions: [] })
    expect('photo' in older.me).toBe(false)
    expect('banner_photo' in older.me).toBe(false)
  })
})
