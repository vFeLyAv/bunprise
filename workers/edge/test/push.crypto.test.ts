// Web Push crypto (src/push/encrypt.ts, vapid.ts): RFC 8291 Appendix A byte for byte, a round trip through an
// independent receiver, and VAPID JWTs verified with the public key. All keys are generated here or are the RFC's
// published test keys — no real key anywhere.
import { describe, expect, it } from 'vitest'
import { concat, fromBase64Url, toBase64Url, utf8 } from '../src/push/bytes'
import { encryptPayload } from '../src/push/encrypt'
import { createVapidSigner, importVapidKeys } from '../src/push/vapid'
import { vapidFixture } from './pushHelpers'

const b64 = fromBase64Url

/** RFC 8291 Appendix A (checked against Node's crypto independently, 27.10.2026) */
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

function ecdhPrivate(d: string, publicRaw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d, x: toBase64Url(publicRaw.slice(1, 33)), y: toBase64Url(publicRaw.slice(33, 65)),
  }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** The browser's side, written from RFC 8291 §3.4 / RFC 8188 independently of src/push/encrypt.ts. */
async function decrypt(body: Uint8Array<ArrayBuffer>, uaPrivate: CryptoKey, uaPublic: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256))
  const ikm = await hmac(await hmac(auth, shared), concat(utf8('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, utf8('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16)
  const nonce = (await hmac(prk, utf8('Content-Encoding: nonce\0\x01'))).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ciphertext))
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end -= 1
  expect(padded[end]).toBe(2) // last-record delimiter
  return { rs, idlen, plaintext: new TextDecoder().decode(padded.slice(0, end)) }
}

describe('RFC 8291 encryption', () => {
  it('matches Appendix A byte for byte', async () => {
    const asPublic = b64(RFC.asPublic)
    const body = await encryptPayload(b64(RFC.plaintext), b64(RFC.uaPublic), b64(RFC.auth), {
      senderKeys: { privateKey: await ecdhPrivate(RFC.asPrivate, asPublic), publicRaw: asPublic },
      salt: b64(RFC.salt),
    })
    expect(toBase64Url(body)).toBe(RFC.body)
    expect(body.byteLength).toBe(144)
  })

  it('a fresh message round-trips through an independent receiver, with a new key and salt each time', async () => {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey) as ArrayBuffer)
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const text = JSON.stringify({ title: 'Anna lädt dich ein', body: '„Grillabend“ · Tippe, um zu antworten.' })
    const one = await encryptPayload(utf8(text), uaPublic, auth)
    const two = await encryptPayload(utf8(text), uaPublic, auth)
    expect(toBase64Url(one.slice(0, 16))).not.toBe(toBase64Url(two.slice(0, 16)))       // salt
    expect(toBase64Url(one.slice(21, 86))).not.toBe(toBase64Url(two.slice(21, 86)))     // sender key
    const opened = await decrypt(one, ua.privateKey, uaPublic, auth)
    expect(opened).toEqual({ rs: 4096, idlen: 65, plaintext: text })
  })

  it('refuses malformed subscription keys and oversized payloads', async () => {
    const uaPublic = b64(RFC.uaPublic)
    await expect(encryptPayload(utf8('x'), uaPublic.slice(0, 64), b64(RFC.auth))).rejects.toThrow('invalid p256dh')
    await expect(encryptPayload(utf8('x'), uaPublic, b64(RFC.auth).slice(0, 15))).rejects.toThrow('invalid auth secret')
    await expect(encryptPayload(new Uint8Array(4000), uaPublic, b64(RFC.auth))).rejects.toThrow('payload too large')
  })
})

describe('VAPID (RFC 8292)', () => {
  it('signs an ES256 JWT for the push service origin that the public key verifies', async () => {
    const fixture = await vapidFixture()
    const sign = createVapidSigner(await importVapidKeys(fixture.publicKey, fixture.privateKey))
    const now = Date.UTC(2026, 9, 27, 12)
    const header = await sign('https://fcm.googleapis.com/fcm/send/abc:def', now)
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, h, c, s, k] = match!
    expect(k).toBe(fixture.publicKey)
    expect(JSON.parse(new TextDecoder().decode(b64(h!)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(b64(c!)))).toEqual({
      aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://bunprise.de',
    })
    const signature = b64(s!)
    expect(signature.byteLength).toBe(64)
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, fixture.verifyKey, signature, utf8(`${h}.${c}`))).toBe(true)
    // reused for the same origin, a separate token for another push service
    expect(await sign('https://fcm.googleapis.com/wp/other', now + 60_000)).toBe(header)
    expect(await sign('https://web.push.apple.com/QGx', now)).not.toBe(header)
    // renewed after 11 hours
    expect(await sign('https://fcm.googleapis.com/fcm/send/x', now + 11 * 3600_000 + 1000)).not.toBe(header)
  })

  it('refuses malformed keys and a private key that does not belong to the public key', async () => {
    const a = await vapidFixture()
    const b = await vapidFixture()
    await expect(importVapidKeys(a.publicKey, b.privateKey)).rejects.toThrow()
    await expect(importVapidKeys(a.publicKey.slice(0, 80), a.privateKey)).rejects.toThrow('invalid VAPID keys')
    await expect(importVapidKeys(a.publicKey, `${a.privateKey}==`)).rejects.toThrow()
    await expect(importVapidKeys(a.publicKey, a.privateKey)).resolves.toMatchObject({ publicKey: a.publicKey })
  })
})

describe('the key format of scripts/push-keys.mjs', () => {
  it('a pair made the way the script makes it (Node crypto, JWK -> raw point + scalar) imports and signs', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })   // a throwaway test key
    const jwk = privateKey.export({ format: 'jwk' })
    const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')])
    const keys = await importVapidKeys(publicRaw.toString('base64url'), jwk.d!)
    expect(keys.publicKey).toHaveLength(87)
    expect(await createVapidSigner(keys)('https://web.push.apple.com/x', Date.UTC(2026, 9, 27))).toMatch(/^vapid t=.+, k=B/)
  })
})
