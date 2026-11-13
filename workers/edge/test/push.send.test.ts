// POST /api/push/send and GET /api/push/key through the real router (src/index.ts → src/push/send.ts).
// The database's batch is simulated: signed here with a test secret; the push services are a fake fetch.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { concat, fromBase64Url, utf8 } from '../src/push/bytes'
import { cleanText, invitationNotification } from '../src/push/messages'
import { pushEndpoint } from '../src/push/endpoint'
import { createPush } from '../src/push/send'
import { NOW, SUPABASE_URL } from './helpers'
import { subscriptionFixture, vapidFixture } from './pushHelpers'

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
const SUB_A = '11111111-1111-4111-8111-111111111111'
const SUB_B = '22222222-2222-4222-8222-222222222222'

let vapid: Awaited<ReturnType<typeof vapidFixture>>
let device: Awaited<ReturnType<typeof subscriptionFixture>>
beforeAll(async () => {
  vapid = await vapidFixture()
  device = await subscriptionFixture()
})

async function sign(secret: string, ts: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Buffer.from(await crypto.subtle.sign('HMAC', key, utf8(`${ts}.${payload}`))).toString('hex')
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    n: 1, id: SUB_A, endpoint: 'https://fcm.googleapis.com/fcm/send/fixture-token', p256dh: device.p256dh, auth: device.auth,
    lang: 'de', ttl: 3600, kind: 'invitation', inviter: 'Anna', title: 'Grillabend', ...overrides,
  }
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** What the browser would read (RFC 8291 receiver side). */
async function open(body: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const salt = body.slice(0, 16)
  const asPublic = body.slice(21, 86)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, device.privateKey, 256))
  const ikm = await hmac(await hmac(device.authRaw, shared), concat(utf8('WebPush: info\0'), device.publicRaw, asPublic, new Uint8Array([1])))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, utf8('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16)
  const nonce = (await hmac(prk, utf8('Content-Encoding: nonce\0\x01'))).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(86)))
  return JSON.parse(new TextDecoder().decode(padded.slice(0, padded.lastIndexOf(2))))
}

function harness(options: { env?: Partial<Env>; status?: (url: string) => number; now?: number } = {}) {
  const outgoing: { url: string; init: RequestInit }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    outgoing.push({ url, init: init ?? {} })
    return new Response(null, { status: options.status?.(url) ?? 201 })
  })
  const log = vi.fn()
  const env: Env = {
    SUPABASE_URL, ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
    PUSH_DISPATCH_SECRET: SECRET, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, ...options.env,
  }
  const now = options.now ?? NOW
  const worker = createWorker({ fetch: fetcher, now: () => now, log })
  const post = async (messages: unknown[], tweak: { ts?: string; secret?: string; sig?: string; body?: string; contentType?: string } = {}) => {
    const ts = tweak.ts ?? String(Math.floor(now / 1000))
    const payload = JSON.stringify({ v: 1, messages })
    const sig = tweak.sig ?? await sign(tweak.secret ?? SECRET, ts, payload)
    return worker.fetch(new Request('https://bunprise.de/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': tweak.contentType ?? 'application/json' },
      body: tweak.body ?? JSON.stringify({ ts, payload, sig }),
    }), env)
  }
  const key = () => worker.fetch(new Request('https://bunprise.de/api/push/key'), env)
  return { post, key, outgoing, log, fetcher }
}

describe('POST /api/push/send', () => {
  it('encrypts, signs and delivers a signed batch; the browser reads exactly the invitation text', async () => {
    const h = harness()
    const res = await h.post([message()])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ gone: [], retry: [], sent: 1, failed: 0 })
    expect(h.outgoing).toHaveLength(1)
    const [out] = h.outgoing
    expect(out!.url).toBe('https://fcm.googleapis.com/fcm/send/fixture-token')
    expect(out!.init.redirect).toBe('manual')
    const headers = new Headers(out!.init.headers)
    expect(headers.get('TTL')).toBe('3600')
    expect(headers.get('Urgency')).toBe('normal')
    expect(headers.get('Content-Encoding')).toBe('aes128gcm')
    expect(headers.get('Authorization')).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`))
    expect(await open(out!.init.body as Uint8Array<ArrayBuffer>)).toEqual({
      title: 'Anna lädt dich ein', body: '„Grillabend“ · Tippe, um zu antworten.', url: '/soon', tag: 'invitation', lang: 'de',
    })
  })

  it('speaks the subscription language, and PUSH_TEXT=neutral names nobody', async () => {
    const h = harness()
    await h.post([message({ lang: 'ru' }), message({ n: 2, id: SUB_B, lang: 'uk', endpoint: 'https://web.push.apple.com/QGxv' })])
    const texts = await Promise.all(h.outgoing.map((o) => open(o.init.body as Uint8Array<ArrayBuffer>)))
    // the pushes go out in parallel: their order is whichever finished first (it flaked under load, 31.10)
    texts.sort((a, b) => String(a.lang).localeCompare(String(b.lang)))
    expect(texts).toEqual([
      { title: 'Anna приглашает тебя', body: '«Grillabend» · Нажми, чтобы ответить.', url: '/soon', tag: 'invitation', lang: 'ru' },
      { title: 'Anna запрошує тебе', body: '«Grillabend» · Торкнися, щоб відповісти.', url: '/soon', tag: 'invitation', lang: 'uk' },
    ])
    const neutral = harness({ env: { PUSH_TEXT: 'neutral' } })
    await neutral.post([message({ lang: 'en' })])
    expect(await open(neutral.outgoing[0]!.init.body as Uint8Array<ArrayBuffer>)).toEqual({
      title: 'New invitation', body: 'Open Bunprise to see it.', url: '/soon', tag: 'invitation', lang: 'en',
    })
  })

  it('reports 404/410 devices as gone, 429/5xx/unreachable as retry, other errors as failed — without stopping the batch', async () => {
    const h = harness({ status: (url) => (url.includes('gone') ? 410 : url.includes('missing') ? 404 : url.includes('busy') ? 503 : url.includes('jwt') ? 403 : 201) })
    const res = await h.post([
      message({ endpoint: 'https://fcm.googleapis.com/fcm/send/gone' }),
      message({ n: 2, id: SUB_B, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/missing' }),
      message({ n: 3, id: '33333333-3333-4333-8333-333333333333', endpoint: 'https://wns2-par02p.notify.windows.com/w/?token=busy' }),
      message({ n: 4, id: '44444444-4444-4444-8444-444444444444' }),
      message({ n: 5, id: '55555555-5555-4555-8555-555555555555', endpoint: 'https://web.push.apple.com/jwt' }),
      // the same device again in this batch (a second invitation): only THIS message is retried, by its position
      message({ n: 6, id: '33333333-3333-4333-8333-333333333333', endpoint: 'https://wns2-par02p.notify.windows.com/w/?token=ok' }),
    ])
    expect(await res.json()).toEqual({ gone: [SUB_A, SUB_B], retry: [3], sent: 2, failed: 1 })
    // the log line has counts only: no address, id, name or title
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'push-send', status: 200, sent: 2, gone: 2, retry: 1, failed: 1 }))
    const line = JSON.stringify(h.log.mock.calls)
    for (const secret of ['fcm.googleapis', 'Anna', 'Grillabend', SUB_A, 'busy']) expect(line).not.toContain(secret)
  })

  it('never contacts an address outside the push services (validated again here, whatever the database sent)', async () => {
    const h = harness()
    const bad = [
      'https://evil.example/fcm/send/x', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:8443/x',
      'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://storage.googleapis.com/x',
      'https://push.apple.com.evil.example/x', 'https://notify.windows.com/x', 'https://127.0.0.1/x', 'https://[::1]/x',
      `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
      // second spellings of one subscription (Codex code review #1)
      'https://fcm.googleapis.com/x/../fcm/send/T', 'https://fcm.googleapis.com/./fcm/send/T', 'https://fcm.googleapis.com/fcm/send/%54',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2b', 'https://wns2-par02p.notify.windows.com/w/?token=%41',
      'https://fcm.googleapis.com/fcm/send/T#x', 'https://fcm.googleapis.com\\fcm/send/T','https://FCM.googleapis.com/fcm/send/T',
      'https://fcm.googleapis.com/fcm/send/a b',
    ]
    const res = await h.post(bad.slice(0, 10).map((endpoint) => message({ endpoint })))
    expect(await res.json()).toEqual({ gone: [], retry: [], sent: 0, failed: 10 })
    expect(h.outgoing).toEqual([])
    for (const endpoint of bad) expect(pushEndpoint(endpoint), endpoint).toBeNull()
    for (const good of ['https://fcm.googleapis.com/wp/abc', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2B%2Fx%3D', 'https://fcm.googleapis.com/fcm/send/cX1:APA91b-x_y']) {
      expect(pushEndpoint(good)?.href, good).toBe(good)
    }
  })

  it('skips malformed messages (keys, kind, id, ttl) and clamps the TTL to 12 hours', async () => {
    const h = harness()
    const res = await h.post([
      message({ p256dh: device.p256dh.slice(0, 80) }), message({ auth: 'short' }), message({ kind: 'reservation' }),
      message({ id: 'not-a-uuid' }), message({ ttl: 1.5 }), message({ inviter: 42 }), message({ n: 11 }),
      message({ ttl: 9_999_999 }),
    ])
    expect(await res.json()).toEqual({ gone: [], retry: [], sent: 1, failed: 7 })
    expect(new Headers(h.outgoing[0]!.init.headers).get('TTL')).toBe('43200')
  })

  it('refuses anything not signed by the database just now: wrong secret, changed payload, stale or future ts, replay', async () => {
    const h = harness()
    const now = Math.floor(NOW / 1000)
    expect((await h.post([message()], { secret: 'another-secret-0123456789abcdef0123456789' })).status).toBe(401)
    expect((await h.post([message()], { ts: String(now - 121) })).status).toBe(401)
    expect((await h.post([message()], { ts: String(now + 121) })).status).toBe(401)
    expect((await h.post([message()], { sig: 'zz' })).status).toBe(401)
    // a signature over another payload
    const ts = String(now)
    const sig = await sign(SECRET, ts, JSON.stringify({ v: 1, messages: [] }))
    const forged = JSON.stringify({ ts, payload: JSON.stringify({ v: 1, messages: [message()] }), sig })
    expect((await h.post([], { body: forged })).status).toBe(401)
    expect(h.outgoing).toEqual([])
    // the same signed request twice: the second is refused
    const payload = JSON.stringify({ v: 1, messages: [message()] })
    const body = JSON.stringify({ ts, payload, sig: await sign(SECRET, ts, payload) })
    expect((await h.post([], { body })).status).toBe(200)
    expect((await h.post([], { body })).status).toBe(401)
    expect(h.outgoing).toHaveLength(1)
  })

  it('refuses wrong content types, bodies and batches larger than 10', async () => {
    const h = harness()
    expect((await h.post([message()], { contentType: 'text/plain' })).status).toBe(415)
    expect((await h.post([], { body: '{not json' })).status).toBe(400)
    expect((await h.post([], { body: JSON.stringify({ ts: 1, payload: '{}', sig: 'a' }) })).status).toBe(400)
    expect((await h.post(Array.from({ length: 11 }, () => message()))).status).toBe(400)
    expect((await h.post([], { body: 'x'.repeat(70 * 1024) })).status).toBe(413)
    expect(h.outgoing).toEqual([])
  })

  it('answers 501 and sends nothing while push is not set up (no secret, short secret, no or broken VAPID pair)', async () => {
    for (const env of [{ PUSH_DISPATCH_SECRET: undefined }, { PUSH_DISPATCH_SECRET: 'short' }, { VAPID_PRIVATE_KEY: undefined },
      { VAPID_PUBLIC_KEY: 'BAAA' }]) {
      const h = harness({ env })
      expect((await h.post([message()])).status, JSON.stringify(env)).toBe(501)
      expect(h.outgoing).toEqual([])
    }
  })
})

describe('GET /api/push/key', () => {
  it('hands out the public key only while the whole pair is set up and matches', async () => {
    const res = await harness().key()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ publicKey: vapid.publicKey })
    expect((await harness({ env: { VAPID_PRIVATE_KEY: undefined } }).key()).status).toBe(501)
    const other = await vapidFixture()
    expect((await harness({ env: { VAPID_PRIVATE_KEY: other.privateKey } }).key()).status).toBe(501)
  })
})

describe('notification text', () => {
  it('is one clean line: no control or bidi characters; names and titles are cut with an ellipsis', () => {
    expect(cleanText('An‮na\n\t Bel\u0000la', 40)).toBe('An na Bel la')
    expect(cleanText('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
    expect(invitationNotification({ inviter: ' ', title: '' }, 'en', false)).toEqual({
      title: 'Someone invites you', body: 'Open Bunprise to see it.', url: '/soon', tag: 'invitation', lang: 'en',
    })
  })

  it('fromBase64Url is strict', () => {
    expect(() => fromBase64Url('ab+c')).toThrow()
    expect(() => fromBase64Url('abc=')).toThrow()
    expect(Array.from(fromBase64Url('AQID'))).toEqual([1, 2, 3])
  })
})

describe('push service unreachable and replays across instances', () => {
  it('an unreachable push service (network error or timeout) is a retry, not a loss', async () => {
    const worker = createWorker({ fetch: async () => { throw new Error('offline') }, now: () => NOW, log: vi.fn() })
    const ts = String(Math.floor(NOW / 1000))
    const payload = JSON.stringify({ v: 1, messages: [message()] })
    const res = await worker.fetch(new Request('https://bunprise.de/api/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts, payload, sig: await sign(SECRET, ts, payload) }),
    }), { SUPABASE_URL, ASSETS: { fetch: vi.fn() }, PUSH_DISPATCH_SECRET: SECRET, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey })
    expect(await res.json()).toEqual({ gone: [], retry: [1], sent: 0, failed: 0 })
  })

  it('a signed batch replayed on ANOTHER instance of the same data centre is refused (Cache API)', async () => {
    const shared = new Map<string, Response>()
    const replayStore = { match: async (key: string) => shared.get(key), put: async (key: string, value: Response) => { shared.set(key, value) } }
    const sent: string[] = []
    const env = { PUSH_DISPATCH_SECRET: SECRET, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }
    const ts = String(Math.floor(NOW / 1000))
    const payload = JSON.stringify({ v: 1, messages: [message()] })
    const body = JSON.stringify({ ts, payload, sig: await sign(SECRET, ts, payload) })
    const request = () => new Request('https://bunprise.de/api/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    for (const expected of [200, 401]) {
      const instance = createPush({
        fetch: async (input) => { sent.push(String(input)); return new Response(null, { status: 201 }) },
        now: () => NOW, log: vi.fn(), replayStore,
      })
      expect((await instance.send(request(), env)).status).toBe(expected)
    }
    expect(sent).toHaveLength(1)
    expect([...shared.keys()]).toEqual([expect.stringMatching(/^https:\/\/bunprise\.de\/api\/push\/__replay\/v1\/[0-9a-f]{64}$/)])
  })
})

it('sends at most 6 pushes at a time (Cloudflare allows 6 open connections); each deadline starts in its slot', async () => {
  let open = 0
  let most = 0
  const fetcher = vi.fn(async () => {
    open += 1
    most = Math.max(most, open)
    await new Promise((resolve) => setTimeout(resolve, 5))
    open -= 1
    return new Response(null, { status: 201 })
  })
  const push = createPush({ fetch: fetcher, now: () => NOW, log: vi.fn(), replayStore: null })
  const ts = String(Math.floor(NOW / 1000))
  const messages = Array.from({ length: 10 }, (_, i) => message({ n: i + 1, endpoint: `https://fcm.googleapis.com/fcm/send/d${i}` }))
  const payload = JSON.stringify({ v: 1, messages })
  const res = await push.send(new Request('https://bunprise.de/api/push/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ts, payload, sig: await sign(SECRET, ts, payload) }),
  }), { PUSH_DISPATCH_SECRET: SECRET, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey })
  expect(await res.json()).toEqual({ gone: [], retry: [], sent: 10, failed: 0 })
  expect(fetcher).toHaveBeenCalledTimes(10)
  expect(most).toBe(6)
})
