// Message encryption for Web Push: RFC 8291 (keys) + RFC 8188 "aes128gcm" content coding, WebCrypto only.
// The push service (Google, Apple, Mozilla, Microsoft) sees only the ciphertext; only the browser that created the
// subscription (its private key + auth secret) can read it. One record, record size 4096, a new ECDH key pair and a
// new random salt for every message. Tested against RFC 8291 Appendix A (test/push.crypto.test.ts).
import { concat, utf8 } from './bytes'

export interface SenderKeys {
  /** ECDH private key of the application server for THIS message */
  privateKey: CryptoKey
  /** its public key, uncompressed point (65 bytes, 0x04 || x || y) */
  publicRaw: Uint8Array<ArrayBuffer>
}

export interface EncryptOptions {
  /** tests only: fixed sender keys and salt (RFC 8291 Appendix A) */
  senderKeys?: SenderKeys
  salt?: Uint8Array<ArrayBuffer>
}

const RECORD_SIZE = 4096

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data))
}

async function newSenderKeys(): Promise<SenderKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  return { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer) }
}

/**
 * Encrypts `plaintext` for one subscription.
 * @param uaPublic the subscription's p256dh key (65 bytes)
 * @param authSecret the subscription's auth secret (16 bytes)
 * @returns the request body: header (salt 16 | rs 4 | idlen 1 | keyid 65) || ciphertext
 */
export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  uaPublic: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (uaPublic.byteLength !== 65 || uaPublic[0] !== 0x04) throw new Error('invalid p256dh')
  if (authSecret.byteLength !== 16) throw new Error('invalid auth secret')
  // one record: plaintext + delimiter 0x02 + 16-byte tag must fit into the record size
  if (plaintext.byteLength + 1 + 16 > RECORD_SIZE - 86) throw new Error('payload too large')

  const sender = options.senderKeys ?? await newSenderKeys()
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // the WebCrypto member is called "public" (workers-types spells it $public)
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, sender.privateKey, 256))

  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = await hmac(authSecret, ecdhSecret)
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, sender.publicRaw)
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))
  // RFC 8188 §2.2: PRK = HKDF-Extract(salt, IKM); CEK (16) and NONCE (12) from HKDF-Expand (one block each)
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, utf8('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16)
  const nonce = (await hmac(prk, utf8('Content-Encoding: nonce\0\x01'))).slice(0, 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const padded = concat(plaintext, new Uint8Array([2])) // last (only) record: delimiter 0x02, no padding
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded))

  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = sender.publicRaw.byteLength
  return concat(header, sender.publicRaw, ciphertext)
}
