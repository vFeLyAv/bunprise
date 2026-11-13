// POST /api/push/send — the ONLY way to make this Worker send a push (docs/spec/web-push-design.md §4.2).
// Caller: our database (private.push_dispatch via pg_net, every ~20 s), never the app. The body is
//   { "ts": "<unix seconds>", "payload": "<JSON text>", "sig": "<hex HMAC-SHA256(PUSH_DISPATCH_SECRET, ts + '.' + payload)>" }
// and the payload { "v": 1, "messages": [ ≤ 10 × { n, id, endpoint, p256dh, auth, lang, ttl, kind, inviter, title } ] }
// (n = the message's 1-based position in the batch, id = the device).
// The signature is checked in constant time and must be at most 5 minutes old; a signature is accepted once per
// Worker instance. Every message is validated again (endpoint allow-list, key sizes) — a bug in the database must not
// turn this into a request cannon. Answer: { gone: [device ids the push service called expired], retry: [positions n of
// the MESSAGES that met a busy or unreachable push service (429, 5xx, timeout)], sent, failed } — the database deletes
// the gone devices and queues exactly those messages again (at most two more attempts, private.push_collect; Codex
// code review #4). At most 6 pushes at a time (Cloudflare: 6 open connections), each with its own 8 s from its start. Logs: counts only (no addresses, names, titles or ids).
// GET /api/push/key — the VAPID public key the app subscribes with (public by design), 501 while push is not set up.
import { ApiError, errorResponse, isRecord, json, readBytes, withDeadline } from '../http'
import type { Clock, Fetch } from '../http'
import { fromBase64Url, utf8 } from './bytes'
import { encryptPayload } from './encrypt'
import { pushEndpoint } from './endpoint'
import { invitationNotification, PUSH_LANGS, type PushLang } from './messages'
import { createVapidSigner, importVapidKeys } from './vapid'

export interface PushEnv {
  /** shared with the database (Supabase Vault "push_dispatch_secret"); ≥ 32 characters */
  PUSH_DISPATCH_SECRET?: string
  /** VAPID key pair (base64url): public = 65-byte point, private = 32-byte scalar. Felix generates them. */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** "neutral" = notifications without names and titles (design Р1) */
  PUSH_TEXT?: string
}

export interface PushLogEntry {
  endpoint: 'push-send' | 'push-key'; status: number; duration: number; sent?: number; gone?: number; retry?: number; failed?: number
}
type Outcome = 'sent' | 'gone' | 'retry' | 'failed'

interface Message {
  /** position in the batch (1..10) */
  n: number
  id: string
  url: URL
  p256dh: Uint8Array<ArrayBuffer>
  auth: Uint8Array<ArrayBuffer>
  lang: PushLang
  ttl: number
  inviter: string
  title: string
}

export const MAX_BATCH = 10
/** Cloudflare Workers: at most 6 simultaneous open connections per request (developers.cloudflare.com/workers/platform/limits) */
const PARALLEL = 6
const MAX_BODY = 64 * 1024
/** a signed batch is accepted for 2 minutes (pg_net sends within seconds) */
const MAX_SKEW_S = 120
/** per push service request; the database waits 20 s for the whole batch (net.http_post timeout) */
const PUSH_TIMEOUT_MS = 8_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function decodeKey(value: unknown, length: number): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || value.length > 100) return null
  try {
    const bytes = fromBase64Url(value)
    return bytes.byteLength === length ? bytes : null
  } catch {
    return null
  }
}

/** One message of the signed payload, or null when anything about it is off. */
export function readMessage(value: unknown): Message | null {
  if (!isRecord(value) || value.kind !== 'invitation') return null
  const url = pushEndpoint(value.endpoint)
  const p256dh = decodeKey(value.p256dh, 65)
  const auth = decodeKey(value.auth, 16)
  const id = typeof value.id === 'string' && UUID.test(value.id) ? value.id : null
  const n = typeof value.n === 'number' && Number.isInteger(value.n) && value.n >= 1 && value.n <= MAX_BATCH ? value.n : null
  const lang = (PUSH_LANGS as readonly unknown[]).includes(value.lang) ? value.lang as PushLang : 'de'
  const ttl = typeof value.ttl === 'number' && Number.isInteger(value.ttl) ? Math.min(Math.max(value.ttl, 0), 43_200) : null
  if (!url || !p256dh || p256dh[0] !== 0x04 || !auth || !id || n === null || ttl === null) return null
  if (typeof value.inviter !== 'string' || typeof value.title !== 'string' || value.inviter.length > 200 || value.title.length > 400) return null
  return { n, id, url, p256dh, auth, lang, ttl, inviter: value.inviter, title: value.title }
}

/** Runs `work` over `items` with at most `limit` at a time (each task starts — and starts its deadline — in its slot). */
async function inPool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** The Cache API surface used against replays across Worker instances (caches.default); injectable for tests. */
export interface ReplayStore {
  match(request: string): Promise<Response | undefined>
  put(request: string, response: Response): Promise<void>
}

function defaultReplayStore(): ReplayStore | null {
  try {
    return typeof caches === 'undefined' ? null : caches.default
  } catch {
    return null
  }
}

export function createPush(deps: { fetch: Fetch; now: Clock; log: (entry: PushLogEntry) => void; replayStore?: ReplayStore | null }) {
  const replayStore = deps.replayStore === undefined ? defaultReplayStore() : deps.replayStore
  const hmacKeys = new Map<string, Promise<CryptoKey>>()
  const signers = new Map<string, Promise<ReturnType<typeof createVapidSigner>>>()
  /** signatures already accepted by this instance (replay within the 2-minute window); caches.default adds the
   *  other instances of this data centre (best effort: Codex design review #3) */
  const seen = new Map<string, number>()

  function configured(env: PushEnv): env is Required<Pick<PushEnv, 'PUSH_DISPATCH_SECRET' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY'>> & PushEnv {
    return (env.PUSH_DISPATCH_SECRET ?? '').length >= 32 && !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY
  }

  function hmacKey(secret: string): Promise<CryptoKey> {
    let key = hmacKeys.get(secret)
    if (!key) {
      key = crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
      hmacKeys.clear()
      hmacKeys.set(secret, key)
    }
    return key
  }

  function signer(publicKey: string, privateKey: string) {
    const id = `${publicKey}|${privateKey.length}`
    let found = signers.get(id)
    if (!found) {
      found = importVapidKeys(publicKey, privateKey).then((keys) => createVapidSigner(keys))
      found.catch(() => signers.delete(id))
      signers.clear()
      signers.set(id, found)
    }
    return found
  }

  /** The verified payload text; throws `unauthorized` for anything not signed by the database just now. */
  async function verify(req: Request, secret: string, ownHost: string): Promise<unknown> {
    const contentType = req.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') throw new ApiError('unsupported_content')
    const bytes = await withDeadline(5000, (signal) => readBytes(req, MAX_BODY, signal))
    let outer: unknown
    try {
      outer = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
    } catch {
      throw new ApiError('invalid_request')
    }
    if (!isRecord(outer) || typeof outer.ts !== 'string' || typeof outer.payload !== 'string' || typeof outer.sig !== 'string') {
      throw new ApiError('invalid_request')
    }
    const { ts, payload, sig } = outer
    const nowS = Math.floor(deps.now() / 1000)
    if (!/^\d{1,12}$/.test(ts) || Math.abs(nowS - Number(ts)) > MAX_SKEW_S || !/^[0-9a-f]{64}$/.test(sig)) {
      throw new ApiError('unauthorized')
    }
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), hexBytes(sig), utf8(`${ts}.${payload}`))
    if (!ok) throw new ApiError('unauthorized')
    for (const [known, until] of seen) if (until < nowS) seen.delete(known)
    if (seen.has(sig)) throw new ApiError('unauthorized')
    if (seen.size >= 1000) seen.delete(seen.keys().next().value as string)
    seen.set(sig, nowS + MAX_SKEW_S)
    if (replayStore) {
      // a URL of our own host (the Cache API stores per zone); nothing else ever asks for it
      const key = `https://${ownHost}/api/push/__replay/v1/${sig}`
      const known = await replayStore.match(key).catch(() => undefined)
      if (known) throw new ApiError('unauthorized')
      await replayStore.put(key, new Response(null, { headers: { 'Cache-Control': `public, max-age=${MAX_SKEW_S * 2}` } })).catch(() => {})
    }
    try {
      return JSON.parse(payload)
    } catch {
      throw new ApiError('invalid_request')
    }
  }

  async function deliver(message: Message, authorization: (endpoint: string, nowMs: number) => Promise<string>, neutral: boolean): Promise<Outcome> {
    const notification = invitationNotification({ inviter: message.inviter, title: message.title }, message.lang, neutral)
    const body = await encryptPayload(utf8(JSON.stringify(notification)), message.p256dh, message.auth)
    const headers = {
      TTL: String(message.ttl),
      Urgency: 'normal',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      Authorization: await authorization(message.url.href, deps.now()),
    }
    // never follow a redirect: the allow-list is about the address we were given, not where it points to
    let response: Response
    try {
      response = await withDeadline(PUSH_TIMEOUT_MS, (signal) =>
        deps.fetch(message.url.href, { method: 'POST', redirect: 'manual', signal, body, headers }))
    } catch {
      return 'retry' // unreachable or too slow: worth another try
    }
    void response.body?.cancel().catch(() => {})
    if (response.status === 404 || response.status === 410) return 'gone'
    if (response.status === 429 || response.status >= 500) return 'retry'
    return response.status >= 200 && response.status < 300 ? 'sent' : 'failed'
  }

  async function send(req: Request, env: PushEnv): Promise<Response> {
    const started = deps.now()
    let response: Response
    let counts: Record<Outcome, number> = { sent: 0, gone: 0, retry: 0, failed: 0 }
    try {
      if (req.method !== 'POST') throw new ApiError('method_not_allowed')
      if (!configured(env)) throw new ApiError('not_available')
      const payload = await verify(req, env.PUSH_DISPATCH_SECRET, new URL(req.url).hostname)
      if (!isRecord(payload) || payload.v !== 1 || !Array.isArray(payload.messages) || payload.messages.length > MAX_BATCH) {
        throw new ApiError('invalid_request')
      }
      const authorization = await signer(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY).catch(() => {
        throw new ApiError('not_available')
      })
      const neutral = env.PUSH_TEXT?.trim() === 'neutral'
      const messages = payload.messages.map(readMessage)
      const results = await inPool(messages, PARALLEL, (message) => message
        ? deliver(message, authorization, neutral).catch(() => 'failed' as const)
        : Promise.resolve('failed' as const))
      const gone = new Set<string>()
      const retry = new Set<number>()
      results.forEach((result, index) => {
        counts[result] += 1
        const message = messages[index]
        if (result === 'gone' && message) gone.add(message.id)
        if (result === 'retry' && message) retry.add(message.n)
      })
      response = json({ gone: [...gone], retry: [...retry], sent: counts.sent, failed: counts.failed })
    } catch (error) {
      counts = { sent: 0, gone: 0, retry: 0, failed: 0 }
      response = errorResponse(error instanceof ApiError ? error : new ApiError('fetch_failed'))
    }
    deps.log({ endpoint: 'push-send', status: response.status, duration: Math.max(0, deps.now() - started), ...counts })
    return response
  }

  async function key(req: Request, env: PushEnv): Promise<Response> {
    const started = deps.now()
    let response: Response
    try {
      if (req.method !== 'GET') throw new ApiError('method_not_allowed')
      if (!configured(env)) throw new ApiError('not_available')
      // only a pair that imports (and matches) is ever handed out: a wrong key would make every subscription useless
      await signer(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY).catch(() => {
        throw new ApiError('not_available')
      })
      response = json({ publicKey: env.VAPID_PUBLIC_KEY.trim() })
    } catch (error) {
      response = errorResponse(error instanceof ApiError ? error : new ApiError('not_available'))
    }
    deps.log({ endpoint: 'push-key', status: response.status, duration: Math.max(0, deps.now() - started) })
    return response
  }

  return { send, key }
}
