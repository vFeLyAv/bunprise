// VAPID (RFC 8292): every request to a push service carries a short ES256 JWT signed with OUR private key; the push
// service accepts messages for a subscription only from the key the browser subscribed with. The keys are Worker
// secrets that Felix generates himself (docs/handoffs/2026-10-27-web-push.md): VAPID_PUBLIC_KEY = the uncompressed
// point (65 bytes, base64url), VAPID_PRIVATE_KEY = the scalar d (32 bytes, base64url) — the format of every web-push
// tool. One JWT per push-service origin is reused for up to 11 hours (exp 12 h; RFC 8292 allows up to 24 h).
import { fromBase64Url, toBase64Url, utf8 } from './bytes'

export interface VapidKeys {
  publicKey: string
  privateKey: CryptoKey
}

export const VAPID_SUBJECT = 'https://bunprise.de'
const LIFETIME_S = 12 * 60 * 60
const REUSE_S = 11 * 60 * 60

/** Throws when the pair is malformed or the private key does not belong to the public key. */
export async function importVapidKeys(publicKey: string, privateKey: string): Promise<VapidKeys> {
  const pub = fromBase64Url(publicKey.trim())
  const d = fromBase64Url(privateKey.trim())
  if (pub.byteLength !== 65 || pub[0] !== 0x04 || d.byteLength !== 32) throw new Error('invalid VAPID keys')
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', ext: false,
    x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33, 65)), d: toBase64Url(d),
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  // a public key that does not belong to d would make every subscription useless: sign once and verify
  const check = utf8('bunprise-vapid-check')
  const verifyKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, check)
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, signature, check)) throw new Error('VAPID keys do not match')
  return { publicKey: toBase64Url(pub), privateKey: key }
}

export function createVapidSigner(keys: VapidKeys, subject = VAPID_SUBJECT) {
  const cache = new Map<string, { token: string; until: number }>()
  return async function authorization(endpoint: string, nowMs: number): Promise<string> {
    const audience = new URL(endpoint).origin
    const now = Math.floor(nowMs / 1000)
    const cached = cache.get(audience)
    if (cached && cached.until > now) return `vapid t=${cached.token}, k=${keys.publicKey}`
    const encode = (value: unknown) => toBase64Url(utf8(JSON.stringify(value)))
    const body = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({ aud: audience, exp: now + LIFETIME_S, sub: subject })}`
    // WebCrypto's ECDSA signature is already the JWS form r || s (64 bytes)
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, utf8(body)))
    const token = `${body}.${toBase64Url(signature)}`
    cache.set(audience, { token, until: now + REUSE_S })
    return `vapid t=${token}, k=${keys.publicKey}`
  }
}
