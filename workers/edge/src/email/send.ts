// The invitation e-mail (docs/spec/invite-email-design.md §1, §7, §10):
//
// POST /api/email/send — the ONLY way to make this Worker send an e-mail. Caller: our database
// (private.invite_email_dispatch via pg_net, once a minute), never the app. The body is
//   { "ts": "<unix seconds>", "payload": "<JSON text>", "sig": "<hex HMAC-SHA256(PUSH_DISPATCH_SECRET, 'invite-email.v1.' + ts + '.' + payload)>" }
// (the same secret as Web Push, its own prefix: a push batch is never a mail batch) and the payload
//   { "v": 1, "messages": [ ≤ 10 × { n, to, lang, token } ] }   (n = 1-based position in the batch)
// Without BREVO_API_KEY (a Worker secret ONLY Felix sets: `npx wrangler secret put BREVO_API_KEY`) or the signing
// secret: 501 at once, nothing is read, nothing is sent. The signature is checked in constant time, at most 2 minutes
// old, accepted once (this instance + caches.default of the data centre). Every message is validated again (address
// shape, language, token) and the mail is built HERE from fixed words (messages.ts, template.ts) — the database sends
// no text. Each mail is one POST to the Brevo HTTP API (https://api.brevo.com/v3/smtp/email), at most 6 at a time,
// 8 s each, never following a redirect. Answer: { retry: [positions n that met 429 / 5xx / timeout], sent, failed } —
// no addresses. Logs: counts only (never an address, a token, the key or a Brevo answer).
//
// GET  /api/email/unsubscribe/<token>?l=de|en — a page with ONE button (no database call: mail scanners open links).
// POST /api/email/unsubscribe/<token>?l=de|en — the button and RFC 8058 one-click (mail apps POST
//   "List-Unsubscribe=One-Click"): public.invite_email_unsubscribe(token) with the PUBLISHABLE key, then "done" or
//   "expired". No sign-in: the token is the permission and can only switch the e-mails off.
import { ApiError, errorResponse, isRecord, json, readBytes, withDeadline } from '../http'
import type { RateLimitBinding } from '../rateLimit'
import type { Clock, Fetch } from '../http'
import { escapeHtml, inviteMail } from './template'
import { mailLang, PAGE, type MailLang } from './messages'

export interface EmailEnv {
  SUPABASE_URL: string
  /** Brevo API key (v3). Set ONLY by Felix: `npx wrangler secret put BREVO_API_KEY -c workers/edge/wrangler.jsonc` */
  BREVO_API_KEY?: string
  /** shared with the database (Supabase Vault "push_dispatch_secret"); ≥ 32 characters — the Web Push secret */
  PUSH_DISPATCH_SECRET?: string
  /** the project's publishable key (the Kalender-Abo's secret); the unsubscribe page calls the database with it */
  SUPABASE_PUBLISHABLE_KEY?: string
  RATE_LIMITER?: RateLimitBinding
}

export interface EmailLogEntry {
  endpoint: 'email-send' | 'email-unsubscribe'; status: number; duration: number; sent?: number; retry?: number; failed?: number
}
type Outcome = 'sent' | 'retry' | 'failed'

interface Message {
  n: number
  to: string
  lang: MailLang
  token: string
}

export const EMAIL_SEND_PATH = '/api/email/send'
export const UNSUBSCRIBE_PREFIX = '/api/email/unsubscribe/'
export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'
export const SENDER = { name: 'Bunprise', email: 'hello@bunprise.de' } as const
export const SIGNATURE_PREFIX = 'invite-email.v1.'
export const MAX_BATCH = 10
const PARALLEL = 6
const MAX_BODY = 64 * 1024
const MAX_SKEW_S = 120
const BREVO_TIMEOUT_MS = 8_000
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const UNSUBSCRIBE_PATH = /^\/api\/email\/unsubscribe\/([A-Za-z0-9_-]{43})$/
/** a plain address (the database checks the same shape): no spaces, no brackets, quotes, commas or semicolons */
const ADDRESS = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/

/** One message of the signed payload, or null when anything about it is off. */
export function readMessage(value: unknown): Message | null {
  if (!isRecord(value)) return null
  const { n, to, lang, token } = value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_BATCH) return null
  if (typeof to !== 'string' || to.length > 254 || !ADDRESS.test(to)) return null
  if (typeof token !== 'string' || !TOKEN.test(token)) return null
  return { n, to, lang: mailLang(lang), token }
}

/** The token of an unsubscribe address, or null. */
export function parseUnsubscribePath(path: string): string | null {
  return UNSUBSCRIBE_PATH.exec(path)?.[1] ?? null
}

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

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>

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

/** The small HTML page of the unsubscribe link (no script, no external resource; CSP allows only our own form). */
export function unsubscribePage(lang: MailLang, kind: 'confirm' | 'done' | 'expired' | 'unavailable', action: string | null, status: number): Response {
  const w = PAGE[lang]
  const e = escapeHtml
  const heading = { confirm: w.confirmHeading, done: w.doneHeading, expired: w.expiredHeading, unavailable: w.unavailableHeading }[kind]
  const body = { confirm: w.confirmBody, done: w.doneBody, expired: w.expiredBody, unavailable: w.unavailableBody }[kind]
  const control = kind === 'confirm' && action
    ? `<form method="post" action="${e(action)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">${e(w.confirmButton)}</button></form>`
    : `<p><a href="/soon">${e(w.openApp)}</a></p>`
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${e(w.title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #F2EBDD; --card: #FFFDF8; --line: #EADFCF; --text: #2A231C; --muted: #62554A; --accent: #984A14; --on-accent: #FFFDF8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0B0B0E; --card: #1C1C1E; --line: #2C2C2E; --text: #F5F5F7; --muted: #A1A1A6; --accent: #F3B676; --on-accent: #2A231C; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 440px; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 28px; padding: 32px 28px; box-sizing: border-box; }
  .brand { margin: 0 0 6px; font-size: 13px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); }
  h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.3; }
  p { margin: 0 0 20px; color: var(--muted); }
  button { min-height: 48px; padding: 12px 28px; border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; cursor: pointer; }
  button:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
<p class="brand">Bunprise</p>
<h1>${e(heading)}</h1>
<p>${e(body)}</p>
${control}
</main>
</body>
</html>`
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  })
}

export function createInviteEmail(deps: {
  fetch: Fetch
  now: Clock
  log: (entry: EmailLogEntry) => void
  replayStore?: ReplayStore | null
  /** the Worker's rate limiter for the unsubscribe page (subject = a hash of the token, never the token) */
  limit?: (subject: string, ip: string, binding?: RateLimitBinding) => Promise<void>
}) {
  const replayStore = deps.replayStore === undefined ? defaultReplayStore() : deps.replayStore
  const hmacKeys = new Map<string, Promise<CryptoKey>>()
  const seen = new Map<string, number>()

  const configured = (env: EmailEnv): env is EmailEnv & { BREVO_API_KEY: string; PUSH_DISPATCH_SECRET: string } =>
    Boolean(env.BREVO_API_KEY?.trim()) && (env.PUSH_DISPATCH_SECRET ?? '').length >= 32

  function hmacKey(secret: string): Promise<CryptoKey> {
    let key = hmacKeys.get(secret)
    if (!key) {
      key = crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
      hmacKeys.clear()
      hmacKeys.set(secret, key)
    }
    return key
  }

  /** The verified payload; throws `unauthorized` for anything not signed by the database just now. */
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
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), hexBytes(sig), utf8(`${SIGNATURE_PREFIX}${ts}.${payload}`))
    if (!ok) throw new ApiError('unauthorized')
    for (const [known, until] of seen) if (until < nowS) seen.delete(known)
    if (seen.has(sig)) throw new ApiError('unauthorized')
    if (seen.size >= 1000) seen.delete(seen.keys().next().value as string)
    seen.set(sig, nowS + MAX_SKEW_S)
    if (replayStore) {
      const key = `https://${ownHost}/api/email/__replay/v1/${sig}`
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

  async function deliver(message: Message, key: string, origin: string): Promise<Outcome> {
    const mail = inviteMail(message.lang, origin, message.token)
    const body = JSON.stringify({
      sender: SENDER,
      to: [{ email: message.to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
      // RFC 2369 + RFC 8058: the mail app's own "unsubscribe" button, one POST to our page
      headers: { 'List-Unsubscribe': `<${mail.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    })
    let response: Response
    try {
      response = await withDeadline(BREVO_TIMEOUT_MS, (signal) => deps.fetch(BREVO_URL, {
        method: 'POST',
        redirect: 'manual',
        signal,
        body,
        headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      }))
    } catch {
      return 'retry'                                    // unreachable or too slow: worth another try
    }
    void response.body?.cancel().catch(() => {})        // Brevo's answer (message id) is not read, never logged
    if (response.status === 429 || response.status >= 500) return 'retry'
    return response.status >= 200 && response.status < 300 ? 'sent' : 'failed'
  }

  async function send(req: Request, env: EmailEnv): Promise<Response> {
    const started = deps.now()
    let response: Response
    let counts: Record<Outcome, number> = { sent: 0, retry: 0, failed: 0 }
    try {
      if (req.method !== 'POST') throw new ApiError('method_not_allowed')
      if (!configured(env)) throw new ApiError('not_available')          // no key: nothing read, nothing sent
      const url = new URL(req.url)
      const payload = await verify(req, env.PUSH_DISPATCH_SECRET, url.hostname)
      if (!isRecord(payload) || payload.v !== 1 || !Array.isArray(payload.messages) || payload.messages.length > MAX_BATCH) {
        throw new ApiError('invalid_request')
      }
      const key = env.BREVO_API_KEY.trim()
      const messages = payload.messages.map(readMessage)
      const results = await inPool(messages, PARALLEL, (message) => message
        ? deliver(message, key, url.origin).catch(() => 'failed' as const)
        : Promise.resolve('failed' as const))
      const retry = new Set<number>()
      results.forEach((result, index) => {
        counts[result] += 1
        const message = messages[index]
        if (result === 'retry' && message) retry.add(message.n)
      })
      response = json({ retry: [...retry], sent: counts.sent, failed: counts.failed })
    } catch (error) {
      counts = { sent: 0, retry: 0, failed: 0 }
      response = errorResponse(error instanceof ApiError ? error : new ApiError('fetch_failed'))
    }
    // counts only: never an address, a token, the key or anything Brevo answered
    deps.log({ endpoint: 'email-send', status: response.status, duration: Math.max(0, deps.now() - started), ...counts })
    return response
  }

  /** public.invite_email_unsubscribe(token) with the publishable key: true = done, false = unknown / expired. */
  async function callUnsubscribe(token: string, env: EmailEnv, key: string, signal?: AbortSignal): Promise<boolean> {
    const base = env.SUPABASE_URL.replace(/\/+$/, '')
    return withDeadline(8000, async (deadline) => {
      const headers = new Headers({ apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' })
      // a legacy anon JWT also wants to be the bearer; a new publishable key (sb_publishable_…) must not be
      if (key.startsWith('eyJ')) headers.set('Authorization', `Bearer ${key}`)
      let answer: Response
      try {
        answer = await deps.fetch(`${base}/rest/v1/rpc/invite_email_unsubscribe`, {
          method: 'POST', headers, body: JSON.stringify({ p_token: token }), signal: deadline, redirect: 'manual',
        })
      } catch {
        throw new ApiError('upstream_unavailable')
      }
      if (!answer.ok || (answer.status >= 300 && answer.status < 400)) throw new ApiError('upstream_unavailable')
      const bytes = await readBytes(answer, 4096, deadline)
      let value: unknown
      try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
      } catch {
        throw new ApiError('upstream_unavailable')
      }
      return isRecord(value) && value.ok === true
    }, signal)
  }

  async function unsubscribe(req: Request, env: EmailEnv): Promise<Response> {
    const started = deps.now()
    const url = new URL(req.url)
    const lang = mailLang(url.searchParams.get('l'))
    const token = parseUnsubscribePath(url.pathname)
    let response: Response
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') throw new ApiError('method_not_allowed')
      if (token === null) {
        response = unsubscribePage(lang, 'expired', null, 404)
      } else if (req.method !== 'POST') {
        // GET changes nothing (scanners open links): the page with one button
        response = unsubscribePage(lang, 'confirm', `${UNSUBSCRIBE_PREFIX}${token}?l=${lang}`, 200)
      } else {
        const key = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
        if (!key) {
          response = unsubscribePage(lang, 'unavailable', null, 501)
        } else {
          const digest = await crypto.subtle.digest('SHA-256', utf8(`unsubscribe:${token}`))
          const subject = Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
          await deps.limit?.(subject, req.headers.get('CF-Connecting-IP') ?? 'unknown', env.RATE_LIMITER)
          const done = await callUnsubscribe(token, env, key, req.signal)
          response = unsubscribePage(lang, done ? 'done' : 'expired', null, 200)
        }
      }
      if (req.method === 'HEAD') response = new Response(null, { status: response.status, headers: response.headers })
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('upstream_unavailable')
      response = apiError.code === 'method_not_allowed' || apiError.code === 'rate_limited'
        ? errorResponse(apiError)
        : unsubscribePage(lang, 'unavailable', null, apiError.status)
    }
    // no token, no address, no IP
    deps.log({ endpoint: 'email-unsubscribe', status: response.status, duration: Math.max(0, deps.now() - started) })
    return response
  }

  return { send, unsubscribe }
}
