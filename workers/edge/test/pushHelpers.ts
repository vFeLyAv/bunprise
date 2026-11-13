// Fixtures for the Web Push tests (push.crypto.test.ts, push.send.test.ts). Every key is generated here.
import { toBase64Url } from '../src/push/bytes'

/** A VAPID pair in the format the key tool prints (public point, private scalar, base64url), plus its verify key. */
export async function vapidFixture() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)
  return { publicKey: toBase64Url(publicRaw), privateKey: jwk.d!, verifyKey: pair.publicKey }
}

/** A browser subscription's keys (p256dh + auth), as base64url, with the private key to read what was sent. */
export async function subscriptionFixture() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { p256dh: toBase64Url(publicRaw), auth: toBase64Url(auth), publicRaw, authRaw: auth, privateKey: pair.privateKey }
}
