import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ fail: true, reads: 0, client: { marker: 'fixture' } }))
vi.mock('./supabaseClient', () => ({
  get supabase() {
    fixture.reads++
    if (fixture.fail) throw new TypeError('Fixture client initialization failed')
    return fixture.client
  },
}))

beforeEach(() => {
  vi.resetModules()
  fixture.fail = true
  fixture.reads = 0
})

describe('lazy client recovery', () => {
  it('retries after a failed initialization and shares the successful client', async () => {
    const { getSupabase } = await import('./supabase')
    const first = getSupabase()
    expect(getSupabase()).toBe(first)
    await expect(first).rejects.toThrow('Fixture client initialization failed')
    fixture.fail = false
    const retry = getSupabase()
    expect(retry).not.toBe(first)
    expect(getSupabase()).toBe(retry)
    await expect(retry).resolves.toBe(fixture.client)
    await expect(getSupabase()).resolves.toBe(fixture.client)
  })

  it('notifies subscribed listeners only when the retry succeeds', async () => {
    const { getSupabase, onClientReady } = await import('./supabase')
    const failed = getSupabase()
    const listener = vi.fn()
    const unsubscribe = onClientReady(listener)
    await expect(failed).rejects.toThrow()
    expect(listener).not.toHaveBeenCalled()
    fixture.fail = false
    await getSupabase()
    expect(listener).toHaveBeenCalledExactlyOnceWith(fixture.client)
    unsubscribe()
  })
})
