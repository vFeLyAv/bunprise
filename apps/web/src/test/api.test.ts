import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { Query } from '@tanstack/react-query'
import type { Tables, TablesInsert } from '../lib/database.types'

// The typed API wrappers against a mocked supabase client: no network, no real project needed.
const supabase = { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() } }
const headers = vi.fn<(name: string, value: string) => void>()
vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import { getOccasionScreen } from '../lib/api/occasions'
import { createInvite, buildInviteUrl, tokenFromHash } from '../lib/api/invites'
import { reserveWish } from '../lib/api/reservations'
import { AppError, toAppError } from '../lib/errors'
import { asGuestWishes, asOwnerWishes, type OccasionScreen } from '../lib/api/types'
import { shouldPersistQuery } from '../lib/query'

const OCCASION_ID = '0f8b9c4a-1d2e-4f5a-8b6c-7d8e9f0a1b2c'

const hostScreen: OccasionScreen = {
  occasion: {
    id: OCCASION_ID,
    title: 'Mias Geburtstag',
    starts_at: '2026-12-12T18:00:00.000Z',
    tz: 'Europe/Berlin',
    all_day: false,
    place_text: 'Bei mir zu Hause',
    description: null,
    created_at: '2026-10-19T10:00:00.000Z',
    host: { id: 'host-1', display_name: 'Mia' },
  },
  viewer: { role: 'host', rsvp: 'going' },
  members: [{ profile_id: 'host-1', display_name: 'Mia', role: 'host', rsvp: 'going' }],
  invite: { active: true, expires_at: '2026-12-19T18:00:00.000Z' },
  wishlist: {
    id: 'wl-1',
    owner_id: 'host-1',
    title: 'Mias Geburtstag',
    wishes: [
      {
        id: 'w-1',
        title: 'Kopfhörer',
        url: null,
        price_cents: 2500,
        currency: 'EUR',
        note: null,
        priority: 2,
        created_at: '2026-10-19T10:05:00.000Z',
        reserved: null,
        reserved_by_me: null,
      },
    ],
  },
}

const guestScreen: OccasionScreen = {
  ...hostScreen,
  viewer: { role: 'member', rsvp: 'none' },
  invite: null,
  wishlist: {
    ...hostScreen.wishlist!,
    wishes: [{ ...hostScreen.wishlist!.wishes[0]!, reserved: true, reserved_by_me: false }],
  },
}

function fakeQuery(queryKey: readonly unknown[], data: unknown, status: 'success' | 'error' = 'success'): Query {
  return { queryKey, state: { status, data } } as unknown as Query
}

/** rpc() returns a builder: the wrappers pin the captured token with setHeader before awaiting it. */
function answerRpc(result: { data: unknown; error: unknown }) {
  vi.mocked(supabase.rpc).mockReturnValueOnce({
    setHeader: (name: string, value: string) => {
      headers(name, value)
      return Promise.resolve(result)
    },
  } as never)
}

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset()
  headers.mockReset()
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'host-1' }, access_token: 'token-host-1' } }, error: null } as never)
})

describe('typed api wrappers', () => {
  it('getOccasionScreen calls get_occasion_screen with p_occasion_id and returns the screen', async () => {
    answerRpc({ data: hostScreen, error: null })
    const screen = await getOccasionScreen(OCCASION_ID)
    expect(supabase.rpc).toHaveBeenCalledWith('get_occasion_screen', { p_occasion_id: OCCASION_ID })
    expect(headers).toHaveBeenCalledWith('Authorization', 'Bearer token-host-1')
    expect(screen.viewer.role).toBe('host')
    expect(screen.wishlist?.wishes[0]?.reserved).toBeNull()
    expect(screen.wishlist?.wishes[0]).not.toHaveProperty('reserved_by_name')
  })

  it('owner wishes carry no reservation fields at all; guest wishes get real booleans', () => {
    const legacyPayload = hostScreen.wishlist!.wishes.map((wish) => ({ ...wish, reserved_by_name: 'Legacy name' }))
    const [ownerWish] = asOwnerWishes(legacyPayload)
    expect(Object.keys(ownerWish!)).toEqual(expect.not.arrayContaining(['reserved', 'reserved_by_me', 'reserved_by_name']))
    const [guestWish] = asGuestWishes(guestScreen.wishlist!.wishes.map((wish) => ({ ...wish, reserved_by_name: 'Legacy name' })))
    expect(guestWish).toMatchObject({ reserved: true, reserved_by_me: false })
    expect(guestWish).not.toHaveProperty('reserved_by_name')
  })

  it('does not persist profile/consent state, occasion screens or reservations', () => {
    expect(shouldPersistQuery(fakeQuery(['me'], { consents_ok: true }))).toBe(false)
    expect(shouldPersistQuery(fakeQuery(['occasion', OCCASION_ID], hostScreen))).toBe(false)
    expect(shouldPersistQuery(fakeQuery(['myReservations'], []))).toBe(false)
    expect(shouldPersistQuery(fakeQuery(['feed'], undefined, 'error'))).toBe(false)
  })

  it('createInvite unwraps { token } and builds a fragment link', async () => {
    const token = 'a'.repeat(64)
    answerRpc({ data: { token }, error: null })
    await expect(createInvite(OCCASION_ID)).resolves.toBe(token)
    expect(supabase.rpc).toHaveBeenCalledWith('create_invite', { p_occasion_id: OCCASION_ID })
    expect(buildInviteUrl(token)).toMatch(new RegExp(`/i#${token}$`))
    expect(tokenFromHash(`#${token}`)).toBe(token)
    expect(tokenFromHash('')).toBeNull()
  })

  it('database RPC errors become AppError with an errors.* key', async () => {
    answerRpc({ data: null, error: { code: 'P0001', message: 'not_allowed', details: '', hint: '' } })
    await expect(reserveWish('w-1')).rejects.toMatchObject({ name: 'AppError', key: 'errors.not_allowed', code: 'not_allowed' })
  })
})

describe('toAppError', () => {
  it('maps an auth rate limit to errors.rate_limited with minutes', () => {
    const err = toAppError({
      __isAuthError: true,
      name: 'AuthApiError',
      code: 'over_email_send_rate_limit',
      status: 429,
      message: 'For security purposes, you can only request this after 45 seconds.',
    })
    expect(err).toBeInstanceOf(AppError)
    expect(err.key).toBe('errors.rate_limited')
    expect(err.params).toEqual({ minutes: 1 })
  })

  it('logs only key, code and status in DEV — never the server text (Codex review 2, L5); cause stays on the error', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    try {
      const raw = { code: '42501', message: 'permission denied PRIVATE-MARKER', details: 'Key (wish_id)=(PRIVATE-MARKER)', hint: 'PRIVATE-MARKER' }
      const mapped = toAppError(raw)
      expect(debug).toHaveBeenLastCalledWith('[AppError]', { key: 'errors.forbidden', code: '42501' })
      expect(mapped.cause).toBe(raw) // for debugging in code; no screen renders it
      toAppError({ __isAuthError: true, name: 'AuthApiError', code: 'over_request_rate_limit', status: 429, message: 'PRIVATE-MARKER after 30 seconds' })
      expect(debug).toHaveBeenLastCalledWith('[AppError]', { key: 'errors.rate_limited', code: 'over_request_rate_limit', status: 429 })
      toAppError({ code: 'not a code: PRIVATE-MARKER', message: 'x', details: 'PRIVATE-MARKER' })
      expect(debug).toHaveBeenLastCalledWith('[AppError]', { key: 'errors.generic' })
      expect(JSON.stringify(debug.mock.calls)).not.toContain('PRIVATE-MARKER')
    } finally {
      debug.mockRestore()
    }
  })

  it('maps a failed fetch to errors.network and unknown things to errors.generic', () => {
    expect(toAppError(new TypeError('Failed to fetch')).key).toBe('errors.network')
    expect(toAppError('boom').key).toBe('errors.generic')
    expect(toAppError({ code: '42501', message: 'permission denied', details: '', hint: '' }).key).toBe('errors.forbidden')
    expect(toAppError({ code: 'P0001', message: 'validation', details: '', hint: '' }).key).toBe('errors.validation')
  })
})

// compile-time sanity of the hand-written Database type (checked by tsc -b)
expectTypeOf<Tables<'wishes'>['priority']>().toEqualTypeOf<number>()
expectTypeOf<Tables<'profiles'>['onboarding_done_at']>().toEqualTypeOf<string | null>()
expectTypeOf<Tables<'profiles'>>().not.toHaveProperty('last_seen_at')
expectTypeOf<TablesInsert<'occasions'>['host_id']>().toEqualTypeOf<string>()
expectTypeOf<TablesInsert<'occasions'>['all_day']>().toEqualTypeOf<boolean | undefined>()
