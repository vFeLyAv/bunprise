import { ApiError, isRecord, readBytes, withDeadline } from './http'
import type { Clock, Fetch } from './http'

const CACHE_MS = 10 * 60_000
// Minimum spacing of JWKS fetches (random kids cannot amplify traffic); short enough
// that a failed cold-start fetch does not lock everybody out for long.
const REFRESH_MS = 15_000
// When a refresh fails (key service outage), the last good keys stay usable this long past expiry.
// A successful refresh always replaces them, so a revoked key disappears as soon as the JWKS is reachable.
const STALE_GRACE_MS = 60 * 60_000
const MAX_JWKS_BYTES = 64 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const encoder = new TextEncoder()

type Algorithm = 'ES256' | 'RS256'
interface VerificationKey {
  algorithm: Algorithm
  key: CryptoKey
}
interface KeyCache {
  keys: Map<string, VerificationKey>
  expires: number
  lastAttempt: number
  pending?: Promise<void>
}
interface AuthOptions {
  fetch: Fetch
  now?: Clock
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new ApiError('unauthorized')
  }
  const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function decodeObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(decoder.decode(decodeBase64Url(value)))
  if (!isRecord(parsed)) throw new ApiError('unauthorized')
  return parsed
}

async function importVerificationKey(value: unknown): Promise<[string, VerificationKey] | null> {
  try {
    if (!isRecord(value) || typeof value.kid !== 'string' || !value.kid || value.kid.length > 256) {
      return null
    }
    if (value.use !== undefined && value.use !== 'sig') return null
    if (value.key_ops !== undefined
      && (!Array.isArray(value.key_ops) || !value.key_ops.includes('verify'))) return null

    let jwk: JsonWebKey
    let algorithm: Algorithm
    let parameters: { name: string; namedCurve?: string; hash?: string }
    if (value.kty === 'EC' && value.crv === 'P-256'
      && typeof value.x === 'string' && typeof value.y === 'string') {
      algorithm = 'ES256'
      jwk = { kty: 'EC', crv: 'P-256', x: value.x, y: value.y }
      parameters = { name: 'ECDSA', namedCurve: 'P-256' }
    } else if (value.kty === 'RSA' && typeof value.n === 'string' && typeof value.e === 'string') {
      const modulusBytes = decodeBase64Url(value.n).byteLength
      if (modulusBytes < 256 || modulusBytes > 1024) return null
      algorithm = 'RS256'
      jwk = { kty: 'RSA', n: value.n, e: value.e }
      parameters = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    } else {
      return null
    }
    if (value.alg !== undefined && value.alg !== algorithm) return null
    const key = await crypto.subtle.importKey('jwk', jwk, parameters, false, ['verify'])
    return [value.kid, { algorithm, key }]
  } catch {
    // One malformed key must not prevent successful rotation of the rest of the set.
    return null
  }
}

function claimsSubject(claims: Record<string, unknown>, issuer: string, now: number): string {
  const audience = claims.aud
  const validAudience = audience === 'authenticated'
    || (Array.isArray(audience) && audience.every((item) => typeof item === 'string')
      && audience.includes('authenticated'))
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now / 1000 - 30
    || claims.iss !== issuer || !validAudience || claims.role !== 'authenticated' || claims.is_anonymous === true
    || typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 512) {
    throw new ApiError('unauthorized')
  }
  if (claims.nbf !== undefined
    && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now / 1000 + 30)) {
    throw new ApiError('unauthorized')
  }
  return claims.sub
}

/** A verifier owns its isolate-local key cache; only the configured issuer supplies keys. */
export function createAuth(options: AuthOptions) {
  const now = options.now ?? Date.now
  const issuers = new Map<string, KeyCache>()

  async function refresh(issuer: string, cache: KeyCache): Promise<void> {
    if (cache.pending) return cache.pending
    // Count unsuccessful attempts too, so random kids cannot amplify upstream traffic.
    if (now() - cache.lastAttempt < REFRESH_MS) return
    cache.lastAttempt = now()
    cache.pending = withDeadline(3000, async (signal) => {
      const response = await options.fetch(`${issuer}/.well-known/jwks.json`, {
        headers: { Accept: 'application/json' },
        // workerd throws on the "error" redirect mode; 'manual' + the status check below refuses every redirect too
        redirect: 'manual',
        signal,
      })
      if (!response.ok) throw new ApiError('unauthorized')
      const parsed: unknown = JSON.parse(decoder.decode(await readBytes(response, MAX_JWKS_BYTES, signal)))
      if (!isRecord(parsed) || !Array.isArray(parsed.keys) || parsed.keys.length > 32) {
        throw new ApiError('unauthorized')
      }
      const imported = await Promise.all(parsed.keys.map(importVerificationKey))
      const keys = new Map<string, VerificationKey>()
      const duplicates = new Set<string>()
      for (const entry of imported) {
        if (!entry) continue
        if (keys.has(entry[0])) duplicates.add(entry[0])
        keys.set(...entry)
      }
      for (const kid of duplicates) keys.delete(kid)
      cache.keys = keys
      cache.expires = now() + CACHE_MS
    }).finally(() => {
      cache.pending = undefined
    })
    return cache.pending
  }

  return async (request: Request, supabaseUrl: string): Promise<string> => {
    try {
      const authorization = request.headers.get('Authorization')
      if (!authorization || authorization.length > 16_384) throw new ApiError('unauthorized')
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization)
      const token = match?.[1]
      if (!token) throw new ApiError('unauthorized')
      const [encodedHeader, encodedClaims, encodedSignature] = token.split('.')
      if (!encodedHeader || !encodedClaims || !encodedSignature) throw new ApiError('unauthorized')
      const header = decodeObject(encodedHeader)
      if ((header.alg !== 'ES256' && header.alg !== 'RS256')
        || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256
        || header.crit !== undefined || header.b64 !== undefined) throw new ApiError('unauthorized')
      const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`
      const claims = decodeObject(encodedClaims)
      const subject = claimsSubject(claims, issuer, now())
      let cache = issuers.get(issuer)
      if (!cache) {
        // Environment configuration is trusted, but still bound cache growth.
        if (issuers.size >= 4) issuers.delete(issuers.keys().next().value ?? '')
        cache = { keys: new Map(), expires: 0, lastAttempt: -Infinity }
        issuers.set(issuer, cache)
      }
      if (cache.expires <= now() || !cache.keys.has(header.kid)) {
        try {
          await refresh(issuer, cache)
        } catch {
          // Fall through: within the grace period the last good keys keep working.
        }
      }
      const verificationKey = cache.keys.get(header.kid)
      if (cache.expires + STALE_GRACE_MS <= now() || !verificationKey || verificationKey.algorithm !== header.alg) {
        throw new ApiError('unauthorized')
      }
      const valid = await crypto.subtle.verify(
        header.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
        verificationKey.key,
        decodeBase64Url(encodedSignature),
        encoder.encode(`${encodedHeader}.${encodedClaims}`),
      )
      if (!valid) throw new ApiError('unauthorized')
      // Verification and key retrieval may cross the token's expiry boundary.
      claimsSubject(claims, issuer, now())
      return subject
    } catch {
      // Key service failures are fail-closed and indistinguishable from invalid tokens.
      throw new ApiError('unauthorized')
    }
  }
}
