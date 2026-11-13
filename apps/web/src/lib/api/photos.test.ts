import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cover photo wrappers against a mocked supabase client (no network): arguments, the pinned account,
// the shape checks of the answers, the quota error and the export merge.
const supabase = { rpc: vi.fn(), auth: { getSession: vi.fn() } }
const headers = vi.fn<(name: string, value: string) => void>()
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import {
  PHOTO_LIMITS,
  PhotoLimitError,
  base64ToBytes,
  bytesToBase64,
  exportMyOccasionPhotos,
  getOccasionPhoto,
  isPhotoLimitError,
  removeOccasionPhoto,
  setOccasionPhoto,
  withOccasionPhotos,
} from './photos'

const OCCASION_ID = '0f8b9c4a-1d2e-4f5a-8b6c-7d8e9f0a1b2c'

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
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'host-1' }, access_token: 'token-host-1' } }, error: null } as never)
})

describe('base64 transport', () => {
  it('round-trips every byte value and large buffers (chunked encoding)', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all)
    const big = Uint8Array.from({ length: PHOTO_LIMITS.maxBytes }, (_, i) => (i * 7) % 256)
    const text = bytesToBase64(big)
    expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(text.length).toBe(Math.ceil(PHOTO_LIMITS.maxBytes / 3) * 4) // 546136 — the database's text limit
    expect(base64ToBytes(text)).toEqual(big)
  })
})

describe('setOccasionPhoto', () => {
  it('sends the five arguments with the pinned token and returns the new version', async () => {
    answerRpc({ data: { ok: true, updated_at: '2026-10-20T10:00:00.123456+00:00' }, error: null })
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9])
    const answer = await setOccasionPhoto(OCCASION_ID, { mime: 'image/jpeg', bytes, width: 1600, height: 1067 }, 'host-1')
    expect(answer).toEqual({ updated_at: '2026-10-20T10:00:00.123456+00:00' })
    expect(supabase.rpc).toHaveBeenCalledWith('set_occasion_photo', {
      p_occasion_id: OCCASION_ID, p_mime: 'image/jpeg', p_data_base64: bytesToBase64(bytes), p_width: 1600, p_height: 1067,
    })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-host-1')
  })

  it('the quota answer becomes a PhotoLimitError (code validation), other refusals the usual codes', async () => {
    answerRpc({ data: null, error: pgError('P0001', 'photo_limit') })
    const err = await setOccasionPhoto(OCCASION_ID, { mime: 'image/webp', bytes: new Uint8Array(30), width: 1, height: 1 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PhotoLimitError)
    expect(isPhotoLimitError(err)).toBe(true)
    expect(err).toMatchObject({ code: 'validation', key: 'errors.validation' })
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(setOccasionPhoto(OCCASION_ID, { mime: 'image/webp', bytes: new Uint8Array(30), width: 1, height: 1 })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses another account than the expected one before sending anything', async () => {
    await expect(setOccasionPhoto(OCCASION_ID, { mime: 'image/webp', bytes: new Uint8Array(30), width: 1, height: 1 }, 'someone-else'))
      .rejects.toMatchObject({ code: 'session_expired' })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('removeOccasionPhoto / getOccasionPhoto', () => {
  it('remove: { ok: true } or an error', async () => {
    answerRpc({ data: { ok: true }, error: null })
    await expect(removeOccasionPhoto(OCCASION_ID)).resolves.toBeUndefined()
    expect(supabase.rpc).toHaveBeenCalledWith('remove_occasion_photo', { p_occasion_id: OCCASION_ID })
    answerRpc({ data: { ok: false }, error: null })
    await expect(removeOccasionPhoto(OCCASION_ID)).rejects.toMatchObject({ code: 'generic' })
  })

  it('get: the bytes as a Blob of the stated type; a malformed answer is generic, a refusal not_found', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 250, 251, 252])
    answerRpc({ data: { mime: 'image/webp', data: bytesToBase64(bytes), width: 1600, height: 900, updated_at: 'v1' }, error: null })
    const photo = await getOccasionPhoto(OCCASION_ID)
    expect(photo).toMatchObject({ mime: 'image/webp', width: 1600, height: 900, updated_at: 'v1' })
    expect(photo.blob.type).toBe('image/webp')
    expect(new Uint8Array(await photo.blob.arrayBuffer())).toEqual(bytes)

    for (const data of [
      { mime: 'image/svg+xml', data: 'AAAA', width: 1, height: 1, updated_at: 'v' },
      { mime: 'image/webp', data: 'AAAA', width: 0, height: 1, updated_at: 'v' },
      { mime: 'image/webp', data: 'AAAA', width: 1, height: 4096, updated_at: 'v' },
      { mime: 'image/webp', data: 42, width: 1, height: 1, updated_at: 'v' },
      ['not', 'an', 'object'],
    ]) {
      answerRpc({ data, error: null })
      await expect(getOccasionPhoto(OCCASION_ID)).rejects.toMatchObject({ code: 'generic' })
    }
    answerRpc({ data: null, error: pgError('P0001', 'not_found') })
    await expect(getOccasionPhoto(OCCASION_ID)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('the export of the own covers', () => {
  const cover = {
    occasion_id: OCCASION_ID, occasion_title: 'Gartenfest', mime: 'image/jpeg', width: 10, height: 10,
    size_bytes: 3, updated_at: 'v', data_base64: 'AAAA',
  }

  it('returns the entries; a server without the photo migration (PGRST202) has none', async () => {
    answerRpc({ data: [cover, { broken: true }], error: null })
    await expect(exportMyOccasionPhotos('host-1')).resolves.toEqual([cover])
    answerRpc({ data: null, error: pgError('PGRST202', 'Could not find the function') })
    await expect(exportMyOccasionPhotos('host-1')).resolves.toEqual([])
    answerRpc({ data: null, error: pgError('42501', 'permission denied') })
    await expect(exportMyOccasionPhotos('host-1')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('withOccasionPhotos adds occasion_photos to the file and keeps everything else', () => {
    const data = { format: 'bunprise-export-v1', profile: { id: 'host-1' }, account: { email: null } }
    expect(withOccasionPhotos(data, [cover as never])).toEqual({ ...data, occasion_photos: [cover] })
    expect(withOccasionPhotos(data, [])).toEqual({ ...data, occasion_photos: [] })
  })
})
