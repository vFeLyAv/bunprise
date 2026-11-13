import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../lib/database.types'
import type { Me } from '../lib/api/types'
import { LEGAL_VERSIONS } from '../lib/legal'
import { createDemoHandlers, DEMO_CODE, DEMO_SUPABASE_URL, DEMO_USER_ID } from './handlers'

const server = setupServer()
let client: SupabaseClient<Database>
let clientCount = 0

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => {
  server.resetHandlers(...createDemoHandlers())
  client = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce', storageKey: `demo-test-${clientCount++}` },
  })
})
afterAll(() => server.close())

async function signIn(email = 'demo@example.test') {
  const requested = await client.auth.signInWithOtp({ email })
  expect(requested.error).toBeNull()
  const verified = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  expect(verified.error).toBeNull()
  return verified.data.session!
}

function legalRows(profileId: string, locale: 'de' | 'en' = 'de') {
  return Object.entries(LEGAL_VERSIONS).map(([kind, version]) => ({ profile_id: profileId, kind, version, locale }))
}

async function me(): Promise<Me> {
  const response = await client.rpc('get_me')
  expect(response.error).toBeNull()
  return response.data as unknown as Me
}

describe('local demo auth through the real Supabase client', () => {
  it('does not issue a code or create an account for an unknown existing-account login', async () => {
    const requested = await client.auth.signInWithOtp({ email: 'unknown@example.test', options: { shouldCreateUser: false } })
    expect(requested.error).toBeNull()
    expect(requested.data).toEqual({ user: null, session: null })
    const verified = await client.auth.verifyOtp({ email: 'unknown@example.test', token: DEMO_CODE, type: 'email' })
    expect(verified.error?.code).toBe('otp_expired')
    expect((await client.auth.getSession()).data.session).toBeNull()
    // A subsequent real signup is the first account; the rejected login created nothing.
    expect((await signIn('unknown@example.test')).user.id).toBe(DEMO_USER_ID)
  })

  it('logs into an existing account without replacing its saved profile or locale metadata', async () => {
    const original = await signIn('mila@example.test')
    await client.from('profiles').update({ display_name: 'Mila', locale: 'en' }).eq('id', original.user.id)
    await client.auth.signOut()
    const requested = await client.auth.signInWithOtp({ email: 'mila@example.test', options: { shouldCreateUser: false, data: { locale: 'en' } } })
    expect(requested.error).toBeNull()
    const verified = await client.auth.verifyOtp({ email: 'mila@example.test', token: DEMO_CODE, type: 'email' })
    expect(verified.error).toBeNull()
    expect(verified.data.user?.id).toBe(original.user.id)
    expect(verified.data.user?.user_metadata).toEqual(original.user.user_metadata)
    expect((await me()).profile).toMatchObject({ display_name: 'Mila', locale: 'en' })
  })

  it('requests a code, rejects a wrong code, and reaches the incomplete-profile guard data', async () => {
    const requested = await client.auth.signInWithOtp({ email: 'sam@example.test', options: { data: { locale: 'en' } } })
    expect(requested.error).toBeNull()
    expect(requested.data.session).toBeNull()

    const wrong = await client.auth.verifyOtp({ email: 'sam@example.test', token: '999999', type: 'email' })
    expect(wrong.error?.code).toBe('invalid_credentials')

    const verified = await client.auth.verifyOtp({ email: 'sam@example.test', token: DEMO_CODE, type: 'email' })
    expect(verified.error).toBeNull()
    expect(verified.data.session?.user.id).toBe(DEMO_USER_ID)
    expect((await client.auth.getUser()).data.user?.email).toBe('sam@example.test')

    const me = await client.rpc('get_me')
    expect(me.error).toBeNull()
    expect(me.data).toMatchObject({ profile: { id: DEMO_USER_ID, display_name: null, locale: 'en' }, consents_ok: false })
    expect(Object.keys((me.data as unknown as Me).legal_versions).sort()).toEqual(['age', 'privacy', 'terms'])
  })

  it('consumes each code and rotates refresh tokens; sign-out revokes access', async () => {
    await client.auth.signInWithOtp({ email: 'sam@example.test' })
    const verified = await client.auth.verifyOtp({ email: 'sam@example.test', token: DEMO_CODE, type: 'email' })
    const original = verified.data.session!
    const reused = await client.auth.verifyOtp({ email: 'sam@example.test', token: DEMO_CODE, type: 'email' })
    expect(reused.error?.code).toBe('otp_expired')

    const refreshed = await client.auth.refreshSession()
    expect(refreshed.error).toBeNull()
    expect(refreshed.data.session?.refresh_token).not.toBe(original.refresh_token)
    const oldRefresh = await fetch(`${DEMO_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', body: JSON.stringify({ refresh_token: original.refresh_token }),
    })
    expect(oldRefresh.status).toBe(400)

    const token = refreshed.data.session!.access_token
    expect((await client.auth.signOut()).error).toBeNull()
    const signedOut = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/get_me`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
    })
    expect(signedOut.status).toBe(401)
  })

  it('requires a matching requested email and blocks unfinished backend endpoints', async () => {
    const anonymous = await client.rpc('get_me')
    expect(anonymous.error?.code).toBe('PGRST301')
    await client.auth.signInWithOtp({ email: 'sam@example.test' })
    const otherEmail = await client.auth.verifyOtp({ email: 'other@example.test', token: DEMO_CODE, type: 'email' })
    expect(otherEmail.error?.code).toBe('otp_expired')
    // get_feed belongs to the demo world now (no session → 401); unfinished endpoints stay explicit 501s
    expect((await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/get_feed`, { method: 'POST' })).status).toBe(401)
    // (wave 2b: block_user is served now — blocking is in the UI, mocks/follows.ts; the groundwork table of
    // occasion addresses is still not part of the demo)
    expect((await fetch(`${DEMO_SUPABASE_URL}/rest/v1/occasion_addresses?select=*`)).status).toBe(501)
  })
})

describe('local demo profile, legal records, and account rights', () => {
  it('saves the own profile but enforces public read columns and writable-field grants', async () => {
    const session = await signIn()
    expect((await client.from('profiles').update({ display_name: 'Mila', locale: 'en' }).eq('id', session.user.id)).error).toBeNull()
    expect((await me()).profile).toMatchObject({ id: session.user.id, display_name: 'Mila', locale: 'en', onboarding_done_at: null })
    const publicProfile = await client.from('profiles').select('id, display_name').eq('id', session.user.id).single()
    expect(publicProfile.data).toEqual({ id: session.user.id, display_name: 'Mila' })
    expect((await client.from('profiles').select('locale').eq('id', session.user.id)).error?.code).toBe('42501')
    expect((await client.from('profiles').select('*')).error?.code).toBe('42501')
    const privateReturning = await client.from('profiles').update({ display_name: 'Must not save' }).eq('id', session.user.id).select('locale')
    expect(privateReturning.error?.code).toBe('42501')
    const forgedTimestamp = await client.from('profiles').update({ created_at: '2000-01-01T00:00:00Z' }).eq('id', session.user.id)
    expect(forgedTimestamp.error?.code).toBe('42501')
    expect((await me()).profile.display_name).toBe('Mila')
  })

  it('validates the full untrimmed name without silently truncating Unicode text', async () => {
    const session = await signIn()
    for (const invalid of [' ', ' Mila', 'Mila\nName', 'x'.repeat(41), '🐰'.repeat(41)]) {
      const response = await client.from('profiles').update({ display_name: invalid }).eq('id', session.user.id)
      expect(response.error?.code).toBe('23514')
    }
    expect((await me()).profile.display_name).toBeNull()
    expect((await client.from('profiles').update({ display_name: '🐰'.repeat(40) }).eq('id', session.user.id)).error).toBeNull()
    expect((await me()).profile.display_name).toBe('🐰'.repeat(40))
  })

  it('records current legal versions once with server timestamps and keeps duplicates unchanged', async () => {
    const session = await signIn()
    const versions = await client.from('legal_versions').select('kind, version, published_at')
    expect(versions.error).toBeNull()
    expect(versions.data?.map((version) => version.kind).sort()).toEqual(['age_18plus', 'privacy_notice', 'terms'])
    expect((await me()).consents_ok).toBe(false)
    expect((await client.from('consents').upsert(legalRows(session.user.id), { ignoreDuplicates: true })).error).toBeNull()
    const recorded = await client.from('consents').select('profile_id, kind, version, locale, accepted_at').eq('profile_id', session.user.id)
    expect(recorded.error).toBeNull()
    expect(recorded.data).toHaveLength(3)
    for (const consent of recorded.data ?? []) expect(Number.isFinite(Date.parse(consent.accepted_at))).toBe(true)
    expect((await me()).consents_ok).toBe(true)
    expect((await client.from('consents').upsert(legalRows(session.user.id, 'en'), { ignoreDuplicates: true })).error).toBeNull()
    const repeated = await client.from('consents').select('profile_id, kind, version, locale, accepted_at').eq('profile_id', session.user.id)
    expect(repeated.data).toEqual(recorded.data)
  })

  it('rejects forged legal timestamps, another account, obsolete versions, and partial invalid batches', async () => {
    const session = await signIn()
    const valid = legalRows(session.user.id)
    const invalidBatches = [
      [valid[0]!, { ...valid[1]!, accepted_at: '2000-01-01T00:00:00Z' }],
      [{ ...valid[0]!, profile_id: '4b9b25fc-d51f-42f6-af8c-d55411c31811' }],
      [{ ...valid[0]!, version: 'obsolete-version' }],
      [{ ...valid[0]!, kind: 'privacy' }],
    ]
    for (const batch of invalidBatches) {
      const response = await client.from('consents').upsert(batch, { ignoreDuplicates: true })
      expect(response.error?.code).toBe('42501')
      expect((await client.from('consents').select('kind')).data).toEqual([])
      expect((await me()).consents_ok).toBe(false)
    }
  })

  it('isolates accounts and preserves each profile/journal across sign-out and re-login', async () => {
    const first = await signIn('demo@example.test')
    await client.from('profiles').update({ display_name: 'Mila', locale: 'en' }).eq('id', first.user.id)
    await client.from('consents').upsert(legalRows(first.user.id), { ignoreDuplicates: true })
    await client.auth.signOut()
    const second = await signIn('other@example.test')
    expect(second.user.id).not.toBe(first.user.id)
    expect(await me()).toMatchObject({ profile: { id: second.user.id, display_name: null, locale: 'de' }, consents_ok: false })
    expect((await client.from('consents').select('kind').eq('profile_id', first.user.id)).data).toEqual([])
    expect((await client.from('profiles').update({ display_name: 'Intruder' }).eq('id', first.user.id)).error).toBeNull()
    expect((await me()).profile.display_name).toBeNull()
    const oldBearer = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/get_me`, { method: 'POST', headers: { authorization: `Bearer ${first.access_token}` } })
    expect(oldBearer.status).toBe(401)
    const stalePatch = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/profiles?id=eq.${second.user.id}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${first.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Stale identity' }),
    })
    expect(stalePatch.status).toBe(401)
    expect((await me()).profile.display_name).toBeNull()
    await client.auth.signOut()
    const returned = await signIn('demo@example.test')
    expect(returned.user.id).toBe(first.user.id)
    expect(await me()).toMatchObject({ profile: { display_name: 'Mila', locale: 'en' }, consents_ok: true })
  })

  it('exports only the current account, including its journal, without requiring legal records', async () => {
    const session = await signIn()
    const first = await client.rpc('export_my_data')
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ format: 'bunprise-export-v1', profile: { id: session.user.id, display_name: null }, consents: [], occasions_hosted: [], memberships: [], wishlists: [], reservations_made_by_me: [], blocks: [], reports: [] })
    expect(first.data).not.toHaveProperty('account')
    expect(JSON.stringify(first.data)).not.toContain(session.user.email)
    expect(JSON.stringify(first.data)).not.toContain('last_seen_at')
    await client.from('profiles').update({ display_name: 'Mila' }).eq('id', session.user.id)
    await client.from('consents').upsert(legalRows(session.user.id), { ignoreDuplicates: true })
    const saved = await client.rpc('export_my_data')
    expect(saved.data).toMatchObject({ profile: { display_name: 'Mila', created_at: expect.any(String), updated_at: expect.any(String) }, consents: expect.arrayContaining([{ kind: 'privacy_notice', version: LEGAL_VERSIONS.privacy_notice, locale: 'de', accepted_at: expect.any(String) }]) })
  })

  it('deletes without legal records, revokes old credentials, and re-creates an empty new identity', async () => {
    const before = await signIn()
    const removed = await client.rpc('delete_my_account')
    expect(removed.error).toBeNull()
    expect(removed.data).toEqual({ ok: true })
    expect((await client.auth.getUser(before.access_token)).error).not.toBeNull()
    for (const method of ['get_me', 'export_my_data', 'delete_my_account']) {
      const response = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/${method}`, { method: 'POST', headers: { authorization: `Bearer ${before.access_token}` } })
      expect(response.status).toBe(401)
    }
    const renewed = await signIn()
    expect(renewed.user.id).not.toBe(before.user.id)
    expect(await me()).toMatchObject({ profile: { id: renewed.user.id, display_name: null }, consents_ok: false })
    expect((await client.from('consents').select('kind')).data).toEqual([])
    const refresh = await fetch(`${DEMO_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: before.refresh_token }) })
    expect(refresh.status).toBe(400)
  })

  it('deleting one account preserves the other account and its saved legal records', async () => {
    const first = await signIn('demo@example.test')
    await client.from('profiles').update({ display_name: 'Mila' }).eq('id', first.user.id)
    await client.from('consents').upsert(legalRows(first.user.id), { ignoreDuplicates: true })
    await client.auth.signOut()
    await signIn('other@example.test')
    expect((await client.rpc('delete_my_account')).error).toBeNull()
    await signIn('demo@example.test')
    expect(await me()).toMatchObject({ profile: { id: first.user.id, display_name: 'Mila' }, consents_ok: true })
  })
})
