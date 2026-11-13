import { QueryClient, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getMe = vi.hoisted(() => vi.fn())
vi.mock('../lib/api/profile', () => ({ getMe }))

import { ME_TRUST_MS, hasCurrentConsents, trustedMe } from '../lib/consentGate'
import { Route as ExportRoute } from '../routes/_authed/settings_.export'
import { Route as DeleteRoute } from '../routes/_authed/settings_.delete'

// The guard's consent check (docs/decisions/2026-10-20-guard-me-cache.md): it trusts THIS account's
// last successful get_me for 60 s and otherwise waits for the server and fails closed.
// Invented fixture accounts only.

const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b2'

function me(id = A, overrides: { consents_ok?: boolean; display_name?: string | null } = {}) {
  return {
    profile: { id, display_name: overrides.display_name === undefined ? 'Mia' : overrides.display_name, locale: 'de', onboarding_done_at: null },
    consents_ok: overrides.consents_ok ?? true,
    legal_versions: { terms: 't1', privacy: 'p1', age: 'a1' },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Lets a background fetch settle (its promise is not awaited by the guard). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let client: QueryClient
beforeEach(() => {
  client = new QueryClient()
  getMe.mockReset()
})
afterEach(() => {
  client.clear()
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

/** Moves the clock by `ms` (Date only: timers and performance.now stay real). */
function later(ms: number) {
  const now = Date.now()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now + ms)
}

describe('consent gate: the server decides', () => {
  it('requires current server approval and a non-empty display name', async () => {
    getMe.mockResolvedValueOnce(me())
    await expect(hasCurrentConsents(new QueryClient(), A)).resolves.toBe(true)
    getMe.mockResolvedValueOnce(me(A, { consents_ok: false }))
    await expect(hasCurrentConsents(new QueryClient(), A)).resolves.toBe(false)
    getMe.mockResolvedValueOnce(me(A, { display_name: '  ' }))
    await expect(hasCurrentConsents(new QueryClient(), A)).resolves.toBe(false)
    getMe.mockResolvedValueOnce(me(A, { display_name: null }))
    await expect(hasCurrentConsents(new QueryClient(), A)).resolves.toBe(false)
  })

  it('asks for the session account only and refuses an answer about someone else', async () => {
    getMe.mockResolvedValueOnce(me(B))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledWith(A) // pinned: getMe refuses when another account is current
    await expect(hasCurrentConsents(client, '')).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledTimes(1)
  })

  it('fails closed on server errors when nothing is trusted', async () => {
    getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledTimes(1)
  })

  it('does not leave the route hanging in a paused query when offline', async () => {
    onlineManager.setOnline(false)
    getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledTimes(1)
  })

  it('allows export and deletion without accepting updated terms', () => {
    expect(ExportRoute.options.staticData?.allowWithoutConsent).toBe(true)
    expect(DeleteRoute.options.staticData?.allowWithoutConsent).toBe(true)
  })
})

describe('consent gate: a trusted answer makes screen changes instant', () => {
  it("trusts this account's successful answer for 60 s — no request, also offline", async () => {
    getMe.mockResolvedValueOnce(me())
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true)
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true)
    onlineManager.setOnline(false)
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true)
    expect(getMe).toHaveBeenCalledTimes(1)
    expect(ME_TRUST_MS).toBe(60_000)
  })

  it('a trusted "no" denies at once as well', async () => {
    getMe.mockResolvedValueOnce(me(A, { consents_ok: false }))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledTimes(1)
  })

  it('refreshes in the background once older than 30 s: the screen change does not wait for it', async () => {
    getMe.mockResolvedValueOnce(me())
    await hasCurrentConsents(client, A)
    later(31_000)
    const answer = deferred<ReturnType<typeof me>>()
    getMe.mockReturnValueOnce(answer.promise)
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true) // resolved while get_me is still on its way
    expect(getMe).toHaveBeenCalledTimes(2)
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true)
    expect(getMe).toHaveBeenCalledTimes(2) // one refresh at a time
    answer.resolve(me())
    await settle()
    expect(trustedMe(client, A)).not.toBeNull()
  })

  it('preloads and offline screen changes never send the background refresh', async () => {
    getMe.mockResolvedValueOnce(me())
    await hasCurrentConsents(client, A)
    later(31_000)
    await expect(hasCurrentConsents(client, A, { refresh: false })).resolves.toBe(true)
    onlineManager.setOnline(false)
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true)
    expect(getMe).toHaveBeenCalledTimes(1)
  })
})

describe('consent gate: what is never trusted (the guard waits and denies on error)', () => {
  it("another account's answer", async () => {
    client.setQueryData(['me'], me(B))
    expect(trustedMe(client, A)).toBeNull()
    getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledWith(A)
  })

  it('an answer older than 60 s', async () => {
    getMe.mockResolvedValueOnce(me())
    await hasCurrentConsents(client, A)
    later(ME_TRUST_MS)
    expect(trustedMe(client, A)).toBeNull()
    getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledTimes(2)
  })

  it('an invalidated answer (a profile or legal-record write)', async () => {
    getMe.mockResolvedValueOnce(me(A, { consents_ok: false }))
    await hasCurrentConsents(client, A)
    await client.invalidateQueries({ queryKey: ['me'], refetchType: 'none' })
    expect(trustedMe(client, A)).toBeNull()
    getMe.mockResolvedValueOnce(me())
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true) // the fresh server answer decides
    expect(getMe).toHaveBeenCalledTimes(2)
  })

  it('an answer whose background refresh failed: the failure ends the trust at once', async () => {
    getMe.mockResolvedValueOnce(me())
    await hasCurrentConsents(client, A)
    later(31_000)
    getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(true) // this screen change had a trusted answer
    await settle()
    expect(trustedMe(client, A)).toBeNull() // still inside 60 s, but the last word was an error
    getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(hasCurrentConsents(client, A)).resolves.toBe(false)
    expect(getMe).toHaveBeenCalledTimes(3)
  })

  it('a wiped cache (the account boundary clears it when the shown account ends)', async () => {
    getMe.mockResolvedValueOnce(me())
    await hasCurrentConsents(client, A)
    client.clear()
    expect(trustedMe(client, A)).toBeNull()
  })

  it('a clock that went backwards', async () => {
    getMe.mockResolvedValueOnce(me())
    await hasCurrentConsents(client, A)
    expect(trustedMe(client, A, Date.now() - 1_000)).toBeNull()
  })
})
