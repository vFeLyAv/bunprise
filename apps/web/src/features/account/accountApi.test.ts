import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), getUser: vi.fn(), logout: vi.fn(), signOut: vi.fn(), headers: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ getSupabase: () => Promise.resolve({
  rpc: api.rpc,
  auth: { getSession: api.getSession, getUser: api.getUser, signOut: api.signOut, admin: { signOut: api.logout } },
}) }))
import { deleteMyAccount, exportMyData, downloadJson, getAccountDetails } from '../../lib/api/account'
import { AUTH_STORAGE_KEY, OFFLINE_FEED_KEY, QUERY_CACHE_KEY } from '../../lib/app'
import { queryClient, signOutEverywhere } from '../../lib/query'

let account = 'account-a'
const payload = { profile: { id: 'account-a', display_name: 'Mia' }, wishes: [] }
beforeEach(() => {
  account = 'account-a'
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: account } }))
  api.getSession.mockImplementation(async () => ({ data: { session: { user: { id: account }, access_token: `token-${account}` } }, error: null }))
  api.getUser.mockResolvedValue({ data: { user: { id: 'account-a', email: 'fixture@example.org' } }, error: null })
  api.rpc.mockImplementation((name: string) => ({ setHeader: (header: string, value: string) => {
    api.headers(header, value)
    return Promise.resolve({ data: name === 'delete_my_account' ? { ok: true } : payload, error: null })
  } }))
  api.logout.mockResolvedValue({ error: null })
})
afterEach(() => { queryClient.clear(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('account self-service API', () => {
  it.each(['email', 'google'] as const)('reads the %s login method from the verified account', async (provider) => {
    api.getUser.mockResolvedValueOnce({ data: { user: { id: 'account-a', email: 'fixture@example.org', app_metadata: { provider } } }, error: null })
    expect(await getAccountDetails('account-a')).toMatchObject({ loginMethod: provider, email: 'fixture@example.org' })
    expect(api.getUser).toHaveBeenCalledWith('token-account-a')
  })
  it('pins export and email to one token and checks the exported profile identity', async () => {
    await expect(exportMyData('account-a')).resolves.toEqual({ ...payload, account: { email: 'fixture@example.org' } })
    expect(api.getUser).toHaveBeenCalledWith('token-account-a')
    expect(api.headers).toHaveBeenCalledWith('Authorization', 'Bearer token-account-a')
    api.rpc.mockReturnValueOnce({ setHeader: () => Promise.resolve({ data: { profile: { id: 'account-b' } }, error: null }) })
    await expect(exportMyData('account-a')).rejects.toMatchObject({ code: 'generic' })
  })

  it('rejects partial exports when auth lookup fails even if the data RPC succeeds', async () => {
    api.getUser.mockResolvedValueOnce({ data: { user: null }, error: { __isAuthError: true, code: 'bad_jwt', status: 401 } })
    await expect(exportMyData('account-a')).rejects.toMatchObject({ code: 'session_expired' })
  })

  it('discards an export response after the active account changes', async () => {
    let finish: ((value: unknown) => void) | undefined
    api.rpc.mockReturnValueOnce({ setHeader: () => new Promise((resolve) => { finish = resolve }) })
    const result = exportMyData('account-a')
    await vi.waitFor(() => expect(finish).toBeDefined())
    account = 'account-b'
    finish?.({ data: payload, error: null })
    await expect(result).rejects.toMatchObject({ code: 'session_expired' })
  })

  it('does not clear storage/cache after a failed deletion', async () => {
    api.rpc.mockReturnValueOnce({ setHeader: () => Promise.resolve({ data: null, error: { code: '42501', message: 'denied', details: '' } }) })
    queryClient.setQueryData(['me'], { id: 'account-a' })
    await expect(deleteMyAccount({ expectedUserId: 'account-a', redirectTo: null })).rejects.toBeTruthy()
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).not.toBeNull()
    expect(queryClient.getQueryData(['me'])).toEqual({ id: 'account-a' })
  })

  it('cleans the deleted account only after success and honestly honors redirectTo:null', async () => {
    window.localStorage.setItem(QUERY_CACHE_KEY, 'old-cache')
    window.localStorage.setItem(OFFLINE_FEED_KEY, 'account-a')
    await deleteMyAccount({ expectedUserId: 'account-a', redirectTo: null })
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
    expect(api.signOut).not.toHaveBeenCalled()
    expect(api.logout).not.toHaveBeenCalled()
  })

  it('keeps a replacement account signed in when deletion of A finishes', async () => {
    api.rpc.mockImplementationOnce(() => ({ setHeader: async () => {
      account = 'account-b'
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: account } }))
      queryClient.setQueryData(['me'], { id: account })
      return { data: { ok: true }, error: null }
    } }))
    await deleteMyAccount({ expectedUserId: 'account-a', redirectTo: null })
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain('account-b')
    expect(queryClient.getQueryData(['me'])).toEqual({ id: 'account-b' })
    expect(api.signOut).not.toHaveBeenCalled()
  })

  it('pins logout to A and never clears B if the account changes during the request', async () => {
    let finish: (() => void) | undefined
    api.logout.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const result = signOutEverywhere({ expectedUserId: 'account-a', redirectTo: null })
    await vi.waitFor(() => expect(finish).toBeDefined())
    account = 'account-b'
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: account } }))
    queryClient.setQueryData(['me'], { id: account })
    finish?.()
    await expect(result).rejects.toMatchObject({ code: 'session_expired' })
    expect(api.logout).toHaveBeenCalledWith('token-account-a', 'global')
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain('account-b')
    expect(queryClient.getQueryData(['me'])).toEqual({ id: 'account-b' })
  })

  it('clears the local account when the logout network request fails', async () => {
    api.logout.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await signOutEverywhere({ expectedUserId: 'account-a', redirectTo: null })
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(api.signOut).not.toHaveBeenCalled()
  })

  // round 2: an expired access token whose refresh cannot reach the auth server — the SDK hands out no session
  const unreachable = { data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } }

  it('clears the expected account locally when the SDK cannot hand out a session (auth server unreachable)', async () => {
    window.localStorage.setItem(OFFLINE_FEED_KEY, 'account-a')
    api.getSession.mockResolvedValueOnce(unreachable)
    await signOutEverywhere({ expectedUserId: 'account-a', redirectTo: null })
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
    expect(api.logout).not.toHaveBeenCalled() // no token to send: nothing is revoked on the server then
  })

  it('…but never clears a replacement account, and without an expected account it passes the error on', async () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: 'account-b' } }))
    api.getSession.mockResolvedValueOnce(unreachable)
    await expect(signOutEverywhere({ expectedUserId: 'account-a', redirectTo: null })).rejects.toMatchObject({ code: 'session_expired' })
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain('account-b')

    api.getSession.mockResolvedValueOnce(unreachable)
    await expect(signOutEverywhere({ redirectTo: null })).rejects.toMatchObject({ name: 'AuthRetryableFetchError' })
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain('account-b')
  })

  it('removes temporary download elements and revokes their URLs even if clicking fails', () => {
    vi.useFakeTimers()
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:fixture'); static revokeObjectURL = revoke })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('blocked') })
    expect(() => downloadJson(payload, 'fixture.json')).toThrow('blocked')
    expect(document.querySelector('a[download]')).toBeNull()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:fixture')
  })
})
