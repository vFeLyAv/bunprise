import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuth } from '../src/auth'

const SUPABASE_URL = 'https://project.supabase.co'
const NOW = 1_800_000_000_000
const paddedRsaJwk = {
  kty: 'RSA', kid: 'standby-rsa', alg: 'RS256', use: 'sig',
  n: `${Buffer.alloc(256, 1).toString('base64url')}==`, e: 'AQAB',
}
let pair: CryptoKeyPair
let jwk: JsonWebKey

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exp: NOW / 1000 + 600,
    iss: `${SUPABASE_URL}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    sub: 'fixture-user',
    ...overrides,
  }
}

async function token(
  payload = claims(),
  header: Record<string, unknown> = { alg: 'ES256', kid: 'es-key', typ: 'JWT' },
  privateKey?: CryptoKey,
): Promise<string> {
  const unsigned = `${encode(header)}.${encode(payload)}`
  const signature = await crypto.subtle.sign(
    header.alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' },
    privateKey ?? pair.privateKey,
    new TextEncoder().encode(unsigned),
  )
  return `${unsigned}.${Buffer.from(signature).toString('base64url')}`
}

function request(jwt: string): Request {
  return new Request('https://bunprise.example/api/places?q=Berlin', {
    headers: { Authorization: `Bearer ${jwt}`, Cookie: 'private=cookie', 'CF-Connecting-IP': '8.8.8.8' },
  })
}

function setup(now: () => number = () => NOW) {
  const fetch = vi.fn(async () => Response.json({ keys: [jwk] }))
  return { fetch, authenticate: createAuth({ fetch, now }) }
}

beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'es-key', alg: 'ES256' }
})

afterEach(() => vi.useRealTimers())

describe('JWT authentication', () => {
  it('verifies ES256 with the public JWKS, caches keys and sends no client headers', async () => {
    const { fetch, authenticate } = setup()
    const jwt = await token()
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, expect.objectContaining({
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    }))
  })

  it('never uses redirect: "error" (workerd throws on it, which locked everybody out)', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const dir = new URL('../src/', import.meta.url)
    const files = (await readdir(dir, { recursive: true })).filter((name) => name.endsWith('.ts'))
    for (const name of files) {
      const text = await readFile(new URL(name.replaceAll('\\', '/'), dir), 'utf8')
      expect(text, name).not.toMatch(/redirect:\s*['"]error['"]/)
    }
  })

  it('accepts authenticated within an audience array and expiration within 30 seconds', async () => {
    const { authenticate } = setup()
    await expect(authenticate(request(await token(claims({
      aud: ['another-audience', 'authenticated'],
      exp: NOW / 1000 - 29,
    }))), SUPABASE_URL)).resolves.toBe('fixture-user')
  })

  it.each([
    ['expired', { exp: NOW / 1000 - 31 }],
    ['at the leeway boundary', { exp: NOW / 1000 - 30 }],
    ['missing expiry', { exp: undefined }],
    ['nonnumeric expiry', { exp: '1800000000' }],
    ['wrong issuer', { iss: 'https://evil.example/auth/v1' }],
    ['wrong audience', { aud: 'anon' }],
    ['substring audience', { aud: 'not-authenticated' }],
    ['wrong role', { role: 'service_role' }],
    ['anonymous authenticated session', { is_anonymous: true }],
    ['missing subject', { sub: undefined }],
    ['empty subject', { sub: ' ' }],
    ['future not-before', { nbf: NOW / 1000 + 31 }],
  ])('rejects %s', async (_label, overrides) => {
    const { authenticate, fetch } = setup()
    await expect(authenticate(request(await token(claims(overrides))), SUPABASE_URL))
      .rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['HS256', 'none', 'ES384', 'RS512'])('rejects unsupported algorithm %s before fetching', async (alg) => {
    const { authenticate, fetch } = setup()
    const jwt = `${encode({ alg, kid: 'es-key' })}.${encode(claims())}.YWJj`
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['', 'not-a-jwt', 'a.b.c', 'a.b.c.d'])('rejects malformed token %s', async (jwt) => {
    const { authenticate } = setup()
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('rejects missing authorization', async () => {
    const { authenticate } = setup()
    await expect(authenticate(new Request('https://bunprise.example/api/places'), SUPABASE_URL))
      .rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('rejects a forged signature and a tampered payload', async () => {
    const { authenticate } = setup()
    const jwt = await token()
    const [header, payload, signature] = jwt.split('.')
    await expect(authenticate(request(`${header}.${payload}.YWJj`), SUPABASE_URL))
      .rejects.toMatchObject({ code: 'unauthorized' })
    await expect(authenticate(request(`${header}.${encode(claims({ sub: 'other-user' }))}.${signature}`), SUPABASE_URL))
      .rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('rejects unimplemented critical JWT extensions', async () => {
    const { authenticate, fetch } = setup()
    const jwt = await token(claims(), { alg: 'ES256', kid: 'es-key', crit: ['custom'], custom: true })
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('supports RS256 public keys and binds each kid to its algorithm', async () => {
    const rsa = await crypto.subtle.generateKey({
      name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
    }, true, ['sign', 'verify'])
    const rsaJwk = { ...await crypto.subtle.exportKey('jwk', rsa.publicKey), kid: 'rsa-key', alg: 'RS256' }
    const fetch = vi.fn(async () => Response.json({ keys: [jwk, rsaJwk] }))
    const authenticate = createAuth({ fetch, now: () => NOW })
    const jwt = await token(claims(), { alg: 'RS256', kid: 'rsa-key' }, rsa.privateKey)
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    const mismatch = await token(claims(), { alg: 'ES256', kid: 'rsa-key' })
    await expect(authenticate(request(mismatch), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('throttles unknown-kid refreshes and picks up a rotated public key after the cooldown', async () => {
    let now = NOW
    const { authenticate, fetch } = setup(() => now)
    await authenticate(request(await token()), SUPABASE_URL)
    const unknown = request(await token(claims(), { alg: 'ES256', kid: 'new-key' }))
    await expect(authenticate(unknown, SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 60_000
    await expect(authenticate(unknown, SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(authenticate(unknown, SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockImplementation(async () => Response.json({ keys: [{ ...jwk, kid: 'new-key' }] }))
    now += 60_000
    await expect(authenticate(unknown, SUPABASE_URL)).resolves.toBe('fixture-user')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('refreshes after ten minutes and does not use revoked keys', async () => {
    let now = NOW
    const { authenticate, fetch } = setup(() => now)
    const jwt = await token(claims({ exp: NOW / 1000 + 3600 }))
    await authenticate(request(jwt), SUPABASE_URL)
    now += 599_999
    await authenticate(request(jwt), SUPABASE_URL)
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockImplementation(async () => Response.json({ keys: [] }))
    now++
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('drops a revoked key after a successful refresh that includes an unusable key', async () => {
    let now = NOW
    const { authenticate, fetch } = setup(() => now)
    const jwt = await token(claims({ exp: NOW / 1000 + 3600 }))
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    fetch.mockImplementation(async () => Response.json({
      keys: [{ ...jwk, kid: 'current-key' }, paddedRsaJwk],
    }))
    now += 10 * 60_000 + 1
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    const current = await token(claims({ exp: NOW / 1000 + 3600 }), { alg: 'ES256', kid: 'current-key' })
    await expect(authenticate(request(current), SUPABASE_URL)).resolves.toBe('fixture-user')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['padded RSA modulus', paddedRsaJwk],
    ['invalid RSA base64url length', { ...paddedRsaJwk, n: 'A' }],
    ['invalid RSA base64url characters', { ...paddedRsaJwk, n: '%' }],
    ['unimportable EC point', { kty: 'EC', kid: 'bad-ec', crv: 'P-256', x: 'AA', y: 'AA' }],
  ])('accepts a usable key when the same JWKS contains a %s', async (_label, unusable) => {
    const fetch = vi.fn(async () => Response.json({ keys: [unusable, jwk] }))
    const authenticate = createAuth({ fetch, now: () => NOW })
    await expect(authenticate(request(await token()), SUPABASE_URL)).resolves.toBe('fixture-user')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('replaces stale keys with an empty set when a successful JWKS contains only unusable keys', async () => {
    let now = NOW
    const { authenticate, fetch } = setup(() => now)
    const jwt = await token(claims({ exp: NOW / 1000 + 3600 }))
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    fetch.mockImplementation(async () => Response.json({ keys: [paddedRsaJwk] }))
    now += 10 * 60_000 + 1
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good keys during a key-service outage, but only for the grace period', async () => {
    let now = NOW
    const { authenticate, fetch } = setup(() => now)
    const jwt = await token(claims({ exp: NOW / 1000 + 3 * 3600 }))
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    fetch.mockImplementation(async () => new Response('down', { status: 503 }))
    now += 10 * 60_000 + 1 // cache expired → refresh fails → stale keys still verify
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    expect(fetch).toHaveBeenCalledTimes(2)
    now += 60 * 60_000 // past expiry + grace → fail closed
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('retries a failed cold-start key fetch after 15 seconds, not a minute', async () => {
    let now = NOW
    const { authenticate, fetch } = setup(() => now)
    fetch.mockImplementationOnce(async () => new Response('down', { status: 503 }))
    const jwt = await token()
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    now += 5_000
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 10_000
    await expect(authenticate(request(jwt), SUPABASE_URL)).resolves.toBe('fixture-user')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shares one JWKS fetch between concurrent callers', async () => {
    const { authenticate, fetch } = setup()
    const jwt = await token()
    await Promise.all(Array.from({ length: 20 }, () => authenticate(request(jwt), SUPABASE_URL)))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['HTTP failure', () => new Response('internal upstream details', { status: 500 })],
    ['redirect', () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/jwks.json' } })],
    ['malformed JSON', () => new Response('private upstream text')],
    ['non-JWKS JSON', () => Response.json({ secret: 'details' })],
    ['oversized body', () => new Response('x'.repeat(65_537))],
    ['duplicate keys', () => Response.json({ keys: [jwk, jwk] })],
  ])('returns only unauthorized for JWKS %s', async (_label, response) => {
    const fetch = vi.fn(async () => response())
    const authenticate = createAuth({ fetch, now: () => NOW })
    await expect(authenticate(request(await token()), SUPABASE_URL))
      .rejects.toMatchObject({ message: 'unauthorized', code: 'unauthorized', status: 401 })
  })

  it('times out a nonresponsive JWKS server, fails closed, and throttles retries', async () => {
    const jwt = await token()
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    const authenticate = createAuth({ fetch, now: () => NOW })
    const result = expect(authenticate(request(jwt), SUPABASE_URL))
      .rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    await vi.advanceTimersByTimeAsync(3000)
    await result
    await expect(authenticate(request(jwt), SUPABASE_URL)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
