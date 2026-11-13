// POST /api/email/send through the real router (src/index.ts -> src/email/send.ts), docs/spec/invite-email-design.md §1.
// The database's batch is simulated: signed here with a test secret; Brevo is a fake fetch (no request leaves the test).
import { describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { BREVO_URL, createInviteEmail, readMessage, SENDER } from '../src/email/send'
import { inviteMail } from '../src/email/template'
import { MAIL } from '../src/email/messages'
import { NOW, SUPABASE_URL } from './helpers'

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
const KEY = 'xkeysib-fixture-not-a-real-key'
const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE'   // 43 characters
const TO = 'felix.fixture@example.test'

async function sign(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))).toString('hex')
}

function message(overrides: Record<string, unknown> = {}) {
  return { n: 1, to: TO, lang: 'de', token: TOKEN, ...overrides }
}

function harness(options: { env?: Partial<Env>; status?: (index: number) => number | 'throw'; now?: number } = {}) {
  const outgoing: { url: string; init: RequestInit }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const index = outgoing.length
    outgoing.push({ url: String(input), init: init ?? {} })
    const status = options.status?.(index) ?? 201
    if (status === 'throw') throw new TypeError('network down')
    return new Response(JSON.stringify({ messageId: `<fixture-${index}@smtp-relay.mailin.fr>` }), { status })
  })
  const log = vi.fn()
  const env: Env = {
    SUPABASE_URL, ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
    PUSH_DISPATCH_SECRET: SECRET, BREVO_API_KEY: KEY, ...options.env,
  }
  const now = options.now ?? NOW
  const worker = createWorker({ fetch: fetcher, now: () => now, log })
  const post = async (messages: unknown[], tweak: { ts?: string; secret?: string; sig?: string; prefix?: string; body?: string; contentType?: string; method?: string } = {}) => {
    const ts = tweak.ts ?? String(Math.floor(now / 1000))
    const payload = JSON.stringify({ v: 1, messages })
    const sig = tweak.sig ?? await sign(tweak.secret ?? SECRET, `${tweak.prefix ?? 'invite-email.v1.'}${ts}.${payload}`)
    return worker.fetch(new Request('https://bunprise.de/api/email/send', {
      method: tweak.method ?? 'POST',
      headers: { 'Content-Type': tweak.contentType ?? 'application/json' },
      body: tweak.method === 'GET' ? undefined : tweak.body ?? JSON.stringify({ ts, payload, sig }),
    }), env)
  }
  return { post, outgoing, fetcher, log, env }
}

const brevoBody = (call: { init: RequestInit }) => JSON.parse(String(call.init.body)) as {
  sender: unknown; to: { email: string }[]; subject: string; htmlContent: string; textContent: string; headers: Record<string, string>
}

describe('switched off: no key, nothing sent', () => {
  it('without BREVO_API_KEY (or the signing secret) the answer is 501 and Brevo is never called', async () => {
    for (const env of [{ BREVO_API_KEY: undefined }, { BREVO_API_KEY: '  ' }, { PUSH_DISPATCH_SECRET: undefined }, { PUSH_DISPATCH_SECRET: 'short' }]) {
      const h = harness({ env })
      const response = await h.post([message()])
      expect(response.status, JSON.stringify(env)).toBe(501)
      expect(await response.json()).toEqual({ error: 'not_available' })
      expect(h.fetcher).not.toHaveBeenCalled()
      expect(h.log).toHaveBeenCalledWith({ endpoint: 'email-send', status: 501, duration: 0, sent: 0, retry: 0, failed: 0 })
    }
  })
})

describe('the signature', () => {
  it('accepts exactly the database\'s signature over "invite-email.v1.<ts>.<payload>", once, within 2 minutes', async () => {
    const h = harness()
    expect((await h.post([message()])).status).toBe(200)
    const ts = String(Math.floor(NOW / 1000))
    // a push batch signature (no prefix) with the same secret is NOT a mail batch
    expect((await h.post([message()], { prefix: '' })).status).toBe(401)
    expect((await h.post([message()], { prefix: 'push.' })).status).toBe(401)
    expect((await h.post([message()], { secret: `${SECRET}x` })).status).toBe(401)
    expect((await h.post([message()], { ts: String(Number(ts) - 121) })).status).toBe(401)
    expect((await h.post([message()], { ts: String(Number(ts) + 121) })).status).toBe(401)
    expect((await h.post([message()], { sig: 'zz' })).status).toBe(401)
    expect((await h.post([message()], { contentType: 'text/plain' })).status).toBe(415)
    expect((await h.post([message()], { body: 'not json' })).status).toBe(400)
    expect((await h.post([message()], { body: '{"ts":1}' })).status).toBe(400)
    expect((await h.post([], { method: 'GET' })).status).toBe(405)
    expect(h.outgoing).toHaveLength(1)                     // only the first, valid batch reached Brevo
  })

  it('a replay of the same signed batch is refused (this instance and the data centre cache)', async () => {
    const stored = new Map<string, Response>()
    const h = harness()
    const ts = String(Math.floor(NOW / 1000))
    const payload = JSON.stringify({ v: 1, messages: [message()] })
    const body = JSON.stringify({ ts, payload, sig: await sign(SECRET, `invite-email.v1.${ts}.${payload}`) })
    expect((await h.post([], { body })).status).toBe(200)
    expect((await h.post([], { body })).status).toBe(401)
    // another instance (fresh memory) with the shared cache
    const other = harness()
    const store = { match: async (k: string) => stored.get(k), put: async (k: string, r: Response) => { stored.set(k, r) } }
    const a = createInviteEmail({ fetch: other.fetcher, now: () => NOW, log: vi.fn(), replayStore: store })
    const b = createInviteEmail({ fetch: other.fetcher, now: () => NOW, log: vi.fn(), replayStore: store })
    const request = () => new Request('https://bunprise.de/api/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    expect((await a.send(request(), other.env)).status).toBe(200)
    expect((await b.send(request(), other.env)).status).toBe(401)
  })
})

describe('the Brevo request', () => {
  it('one POST per message to api.brevo.com with the key from env, our sender, the neutral German mail and one-click unsubscribe', async () => {
    const h = harness()
    const response = await h.post([message()])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ retry: [], sent: 1, failed: 0 })
    expect(h.outgoing).toHaveLength(1)
    const call = h.outgoing[0]!
    expect(call.url).toBe(BREVO_URL)
    expect(call.url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(call.init.method).toBe('POST')
    expect(call.init.redirect).toBe('manual')
    const headers = new Headers(call.init.headers)
    expect(headers.get('api-key')).toBe(KEY)
    expect(headers.get('content-type')).toBe('application/json')
    const body = brevoBody(call)
    expect(Object.keys(body).sort()).toEqual(['headers', 'htmlContent', 'sender', 'subject', 'textContent', 'to'])
    expect(body.sender).toEqual(SENDER)
    expect(body.sender).toEqual({ name: 'Bunprise', email: 'hello@bunprise.de' })
    expect(body.to).toEqual([{ email: TO }])
    expect(body.subject).toBe('Neue Einladung in Bunprise')
    expect(body.textContent).toContain('Jemand hat dich in Bunprise eingeladen. Öffne die App, um sie zu sehen.')
    expect(body.htmlContent).toContain('Jemand hat dich in Bunprise eingeladen. Öffne die App, um sie zu sehen.')
    const unsubscribe = `https://bunprise.de/api/email/unsubscribe/${TOKEN}?l=de`
    expect(body.headers).toEqual({ 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    expect(body.htmlContent).toContain(`href="${unsubscribe}"`)
    expect(body.textContent).toContain(unsubscribe)
    expect(body.htmlContent).toContain('href="https://bunprise.de/soon"')
    // the German mail carries the short English paragraph (ru / uk people read the German mail)
    expect(body.htmlContent).toContain(MAIL.en.body)
    // no script, no external resource but our own picture
    expect(body.htmlContent).not.toMatch(/<script|<link|@import|url\(/i)
    expect([...body.htmlContent.matchAll(/src="([^"]+)"/g)].map((m) => m[1])).toEqual(['https://bunprise.de/email/pompon-peek.png'])
  })

  it('English for lang "en"; anything else (ru, uk, garbage) reads German', async () => {
    const h = harness()
    await h.post([message({ n: 1, lang: 'en' }), message({ n: 2, lang: 'ru' }), message({ n: 3, lang: 'uk' }), message({ n: 4, lang: 42 })])
    const subjects = h.outgoing.map((c) => brevoBody(c).subject)
    expect(subjects.sort()).toEqual(['Neue Einladung in Bunprise', 'Neue Einladung in Bunprise', 'Neue Einladung in Bunprise', 'New invitation in Bunprise'])
    const en = h.outgoing.map(brevoBody).find((b) => b.subject.startsWith('New'))!
    expect(en.textContent).toContain('Someone invited you on Bunprise. Open the app to see it.')
    expect(en.headers['List-Unsubscribe']).toContain('?l=en>')
    expect(en.htmlContent).not.toContain('Jemand')
  })

  it('the mail is neutral whatever the database sent: extra fields are ignored, the words are the Worker\'s own', async () => {
    const h = harness()
    await h.post([message({ inviter: 'Hanna', title: 'Grillabend', subject: 'Hanna lädt dich ein', html: '<b>x</b>' })])
    const body = brevoBody(h.outgoing[0]!)
    for (const word of ['Hanna', 'Grillabend', '<b>x</b>']) {
      expect(body.htmlContent + body.textContent + body.subject).not.toContain(word)
    }
  })

  it('validates every message: address shape, token, position; at most 10 per batch', async () => {
    for (const bad of [{ to: 'no-at-sign' }, { to: 'a b@example.test' }, { to: 'x@y' }, { to: '<x@example.test>' }, { to: 'a@b.c,d@e.f' },
      { to: `${'a'.repeat(250)}@example.test` }, { to: 42 }, { token: 'short' }, { token: `${TOKEN}x` }, { token: `${TOKEN.slice(0, 42)}!` },
      { n: 0 }, { n: 11 }, { n: 1.5 }]) {
      expect(readMessage(message(bad)), JSON.stringify(bad)).toBeNull()
    }
    const h = harness()
    const response = await h.post([message({ to: 'broken' }), message({ n: 2 })])
    expect(await response.json()).toEqual({ retry: [], sent: 1, failed: 1 })
    expect(h.outgoing).toHaveLength(1)
    const tooMany = await h.post(Array.from({ length: 11 }, (_, i) => message({ n: (i % 10) + 1 })))
    expect(tooMany.status).toBe(400)
  })
})

describe('Brevo\'s answers', () => {
  it('429 / 5xx / network error / timeout -> retry [n]; 400 / 401 / 403 -> failed; 201 / 202 -> sent', async () => {
    const statuses: (number | 'throw')[] = [201, 429, 500, 'throw', 400, 401, 403, 202, 503]
    const h = harness({ status: (i) => statuses[i] ?? 201 })
    const response = await h.post(statuses.map((_, i) => message({ n: i + 1 })).slice(0, 9))
    // messages run in parallel lanes, but each fetch is called in message order
    expect(await response.json()).toEqual({ retry: [2, 3, 4, 9], sent: 2, failed: 3 })
  })

  it('a hanging Brevo request is cut after 8 s and retried', async () => {
    // only the timers: crypto and I/O keep running, so the request can reach Brevo before the clock jumps
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
      const worker = createWorker({ fetch: fetcher, now: () => NOW, log: vi.fn() })
      const ts = String(Math.floor(NOW / 1000))
      const payload = JSON.stringify({ v: 1, messages: [message()] })
      const body = JSON.stringify({ ts, payload, sig: await sign(SECRET, `invite-email.v1.${ts}.${payload}`) })
      const pending = worker.fetch(new Request('https://bunprise.de/api/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
        { SUPABASE_URL, ASSETS: { fetch: vi.fn() }, PUSH_DISPATCH_SECRET: SECRET, BREVO_API_KEY: KEY } as Env)
      for (let i = 0; i < 200 && fetcher.mock.calls.length === 0; i++) await new Promise((done) => setImmediate(done))
      expect(fetcher).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(8_100)
      expect(await (await pending).json()).toEqual({ retry: [1], sent: 0, failed: 0 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('privacy of the logs', () => {
  it('never logs (or prints) the address, the token, the key or what Brevo answered', async () => {
    const printed: string[] = []
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(' ')) }))
    try {
      const h = harness({ status: (i) => (i === 0 ? 201 : i === 1 ? 500 : 400) })
      await h.post([message(), message({ n: 2, to: 'zweite.fixture@example.test' }), message({ n: 3, to: 'dritte.fixture@example.test' })])
      await h.post([message()], { prefix: '' })              // a refused one too
      const logged = JSON.stringify(h.log.mock.calls) + printed.join('\n')
      for (const secret of [TO, 'zweite.fixture', 'dritte.fixture', '@example.test', TOKEN, KEY, SECRET, 'fixture-0@smtp-relay', 'messageId']) {
        expect(logged, secret).not.toContain(secret)
      }
      expect(h.log.mock.calls.map((c) => Object.keys(c[0] as object).sort())).toEqual([
        ['duration', 'endpoint', 'failed', 'retry', 'sent', 'status'], ['duration', 'endpoint', 'failed', 'retry', 'sent', 'status'],
      ])
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('the template escapes what it inserts', () => {
    const mail = inviteMail('de', 'https://bunprise.de"><script>', TOKEN)
    expect(mail.html).not.toContain('"><script>')
    expect(mail.html).toContain('&quot;&gt;&lt;script&gt;')
  })
})
