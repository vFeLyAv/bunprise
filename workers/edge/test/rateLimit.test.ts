import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, errorResponse } from '../src/http'
import { createRateLimiter } from '../src/rateLimit'
import type { Endpoint } from '../src/rateLimit'

afterEach(() => vi.useRealTimers())

describe('sliding rate limits', () => {
  it.each<[Endpoint, number]>([['link-preview', 20], ['places', 60]])(
    '%s limits each user to %i requests per minute',
    async (endpoint, limit) => {
      let now = 0
      const check = createRateLimiter({ now: () => now })
      for (let index = 0; index < limit; index++) await check(endpoint, 'user', '1.2.3.4')
      await expect(check(endpoint, 'user', '5.6.7.8'))
        .rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 60 })
      now = 59_001
      await expect(check(endpoint, 'user', '5.6.7.8')).rejects.toMatchObject({ retryAfter: 1 })
      now = 60_000
      await expect(check(endpoint, 'user', '5.6.7.8')).resolves.toBeUndefined()
    },
  )

  it.each<[Endpoint, number]>([['link-preview', 60], ['places', 120]])(
    '%s limits each IP to %i requests despite different users',
    async (endpoint, limit) => {
      const check = createRateLimiter({ now: () => 0 })
      for (let index = 0; index < limit; index++) await check(endpoint, `user-${index}`, '1.2.3.4')
      await expect(check(endpoint, 'another-user', '1.2.3.4'))
        .rejects.toMatchObject({ code: 'rate_limited', retryAfter: 60 })
      await expect(check(endpoint, 'another-user', '5.6.7.8')).resolves.toBeUndefined()
    },
  )

  it.each<[Endpoint, number]>([['link-preview', 60], ['places', 120]])(
    '%s shares the %i-request IP limit across IPv6 addresses in one /64',
    async (endpoint, limit) => {
      const check = createRateLimiter({ now: () => 0 })
      for (let index = 0; index < limit; index++) {
        await check(endpoint, `user-${index}`, `2001:db8:4b40:1f00::${(index + 1).toString(16)}`)
      }
      await expect(check(endpoint, 'another-user', '[2001:0DB8:4B40:1F00:0000:0000:0000:FFFF]'))
        .rejects.toMatchObject({ code: 'rate_limited', retryAfter: 60 })
      await expect(check(endpoint, 'another-user', '2001:db8:4b40:1f01::1')).resolves.toBeUndefined()
    },
  )

  it.each<[Endpoint, number]>([['link-preview', 240], ['places', 480]])(
    '%s limits a /48 to %i requests when clients rotate /64 networks',
    async (endpoint, limit) => {
      const check = createRateLimiter({ now: () => 0 })
      for (let index = 0; index < limit; index++) {
        await check(endpoint, `user-${index}`, `2001:db8:1:${index.toString(16)}::1`)
      }
      await expect(check(endpoint, 'another-user', '2001:0DB8:0001:FFFF:0000:0000:0000:0001'))
        .rejects.toMatchObject({ code: 'rate_limited', retryAfter: 60 })
      await expect(check(endpoint, 'another-user', '2001:db8:2::1')).resolves.toBeUndefined()
    },
  )

  it.each<[Endpoint, number]>([['link-preview', 60], ['places', 120]])(
    '%s counts IPv4-mapped IPv6 toward the same %i-request IPv4 limit',
    async (endpoint, limit) => {
      const check = createRateLimiter({ now: () => 0 })
      const spellings = ['192.0.2.10', '::ffff:192.0.2.10', '[0000:0000:0000:0000:0000:FFFF:C000:020A]']
      for (let index = 0; index < limit; index++) {
        await check(endpoint, `user-${index}`, spellings[index % spellings.length]!)
      }
      await expect(check(endpoint, 'another-user', '::ffff:c000:20a'))
        .rejects.toMatchObject({ code: 'rate_limited', retryAfter: 60 })
      await expect(check(endpoint, 'another-user', '192.0.2.11')).resolves.toBeUndefined()
    },
  )

  it('slides the window instead of resetting all requests on the minute', async () => {
    let now = 0
    const check = createRateLimiter({ now: () => now })
    for (let index = 0; index < 10; index++) await check('link-preview', 'user', '1.2.3.4')
    now = 30_000
    for (let index = 0; index < 10; index++) await check('link-preview', 'user', '1.2.3.4')
    now = 60_000
    for (let index = 0; index < 10; index++) await check('link-preview', 'user', '1.2.3.4')
    await expect(check('link-preview', 'user', '1.2.3.4')).rejects.toMatchObject({ retryAfter: 30 })
  })

  it('keeps endpoint counters separate', async () => {
    const check = createRateLimiter({ now: () => 0 })
    for (let index = 0; index < 20; index++) await check('link-preview', 'user', '1.2.3.4')
    await expect(check('places', 'user', '1.2.3.4')).resolves.toBeUndefined()
  })

  it('reserves local counters before concurrent async operations', async () => {
    const check = createRateLimiter({ now: () => 0 })
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => check('link-preview', 'user', '1.2.3.4')))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(20)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(20)
  })

  it('uses both hashed keys in the optional binding without exposing identifiers', async () => {
    const check = createRateLimiter({ now: () => 0 })
    const binding = { limit: vi.fn(async (_options: { key: string }) => ({ success: true })) }
    await check('places', 'fixture-user', '1.2.3.4', binding)
    expect(binding.limit).toHaveBeenCalledTimes(2)
    const keys = binding.limit.mock.calls.map(([argument]) => argument.key)
    expect(new Set(keys).size).toBe(2)
    for (const key of keys) {
      expect(key).toMatch(/^bunprise:[a-f0-9]{64}$/)
      expect(key).not.toContain('fixture-user')
      expect(key).not.toContain('1.2.3.4')
    }
  })

  it('normalizes the IPv6 binding key to /64 while enforcing the looser /48 quota locally', async () => {
    const check = createRateLimiter({ now: () => 0 })
    const binding = { limit: vi.fn(async (_options: { key: string }) => ({ success: true })) }
    await check('places', 'fixture-user', '2001:db8:4b40:1f00::1', binding)
    await check('places', 'fixture-user', '2001:0DB8:4B40:1F00:0:0:0:FFFF', binding)
    expect(binding.limit).toHaveBeenCalledTimes(4)
    const keys = binding.limit.mock.calls.map(([argument]) => argument.key)
    expect(keys.slice(0, 2).sort()).toEqual(keys.slice(2).sort())
  })

  it('fails closed when the optional binding rejects or fails', async () => {
    const check = createRateLimiter({ now: () => 0 })
    await expect(check('places', 'user', '1.2.3.4', { limit: async () => ({ success: false }) }))
      .rejects.toMatchObject({ code: 'rate_limited', retryAfter: 60 })
    await expect(check('places', 'user', '1.2.3.4', { limit: async () => { throw new Error('private detail') } }))
      .rejects.toMatchObject({ message: 'rate_limited', retryAfter: 60 })
  })

  it('bounds the wait for a nonresponsive optional binding', async () => {
    vi.useFakeTimers()
    const check = createRateLimiter({ now: () => 0 })
    const result = expect(check('places', 'user', '1.2.3.4', {
      limit: () => new Promise<{ success: boolean }>(() => {}),
    })).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 60 })
    await vi.advanceTimersByTimeAsync(1000)
    await result
  })

  it('returns a contract response with Retry-After', async () => {
    const response = errorResponse(new ApiError('rate_limited', 11))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('11')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' })
  })

  it('bounds the user table at 10,000 entries without evicting live limits', async () => {
    let now = 0
    const check = createRateLimiter({ now: () => now })
    for (let index = 0; index < 10_000; index++) {
      await check('places', `user-${index}`, `192.0.2.${Math.floor(index / 100)}`)
    }
    await expect(check('places', 'new-user', '198.51.100.1')).rejects.toMatchObject({ code: 'rate_limited' })
    for (let index = 1; index < 60; index++) {
      await check('places', 'user-0', '198.51.100.1')
    }
    await expect(check('places', 'user-0', '198.51.100.1')).rejects.toMatchObject({ code: 'rate_limited' })
    now = 60_000
    await expect(check('places', 'new-user', '198.51.100.1')).resolves.toBeUndefined()
  })

  it('skips missing IP keys at 10,000 entries while retaining user and known IP limits', async () => {
    const check = createRateLimiter({ now: () => 0 })
    for (let index = 0; index < 120; index++) {
      await check('places', `known-${index}`, '192.0.2.1')
    }
    for (let index = 0; index < 9999; index++) {
      await check('places', `filler-${Math.floor(index / 50)}`, `198.51.${Math.floor(index / 256)}.${index % 256}`)
    }
    const binding = { limit: vi.fn(async (_options: { key: string }) => ({ success: true })) }
    await check('places', 'new-user', '203.0.113.1', binding)
    expect(binding.limit).toHaveBeenCalledTimes(1)
    for (let index = 1; index < 60; index++) {
      await check('places', 'new-user', '203.0.113.1')
    }
    await expect(check('places', 'new-user', '203.0.113.2')).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(check('places', 'unrelated-user', '203.0.113.1')).resolves.toBeUndefined()
    await expect(check('places', 'unrelated-user', '192.0.2.1')).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('retains known /48 limits when a full IP table skips new /64 keys', async () => {
    const check = createRateLimiter({ now: () => 0 })
    for (let index = 0; index < 480; index++) {
      await check('places', `known-${index}`, `2001:db8:1:${Math.floor(index / 120)}::1`)
    }
    // Four /64 counters and one /48 counter share the IP table's 10,000-entry cap.
    for (let index = 0; index < 9995; index++) {
      await check('places', `filler-${Math.floor(index / 50)}`, `198.51.${Math.floor(index / 256)}.${index % 256}`)
    }
    await expect(check('places', 'unrelated-user', '2001:db8:1:ffff::1'))
      .rejects.toMatchObject({ code: 'rate_limited' })
    await expect(check('places', 'unrelated-user', '2001:db8:2:ffff::1')).resolves.toBeUndefined()
  })

  it('bounds the review flood from 122 accounts on one /48 without locking out unrelated users', async () => {
    const check = createRateLimiter({ now: () => 0 })
    let request = 0
    let accepted = 0
    for (let account = 0; account < 122; account++) {
      for (const [endpoint, perUser] of [['places', 60], ['link-preview', 20]] as const) {
        for (let index = 0; index < perUser; index++) {
          const address = `2001:db8:1:${(++request).toString(16)}::1`
          await check(endpoint, `attacker-${account}`, address).then(() => { accepted++ }, () => {})
        }
      }
    }
    expect(accepted).toBe(480 + 240)
    await expect(check('places', 'unrelated-user', '192.0.2.10')).resolves.toBeUndefined()
  })
})
