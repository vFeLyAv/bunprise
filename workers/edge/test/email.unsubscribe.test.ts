// GET / POST /api/email/unsubscribe/<token> through the real router (src/email/send.ts), docs/spec/invite-email-design.md §7.
// The database is a fake fetch that plays public.invite_email_unsubscribe(token) behind PostgREST.
import { describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { parseUnsubscribePath } from '../src/email/send'
import { NOW, SUPABASE_URL } from './helpers'

const PUBLISHABLE = 'sb_publishable_fixture'
const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE'

function harness(answer: (token: string) => unknown = () => ({ ok: true }), env: Partial<Env> = {}, status = 200) {
  const calls: { url: string; headers: Headers; body: unknown; redirect?: RequestRedirect }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { p_token: string }
    calls.push({ url: String(input), headers: new Headers(init?.headers), body, redirect: init?.redirect })
    return new Response(JSON.stringify(answer(body.p_token)), { status, headers: { 'Content-Type': 'application/json' } })
  })
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, now: () => NOW, log })
  const full: Env = { SUPABASE_URL, ASSETS: { fetch: vi.fn(async () => new Response('asset')) }, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, ...env }
  const call = (method: string, path = `/api/email/unsubscribe/${TOKEN}?l=de`, init: RequestInit = {}) =>
    worker.fetch(new Request(`https://bunprise.de${path}`, { method, ...init }), full)
  return { call, calls, fetcher, log }
}

describe('GET: a page with one button, no database call (mail scanners open links)', () => {
  it('German and English; the form POSTs to the same address; strict headers', async () => {
    const h = harness()
    const de = await h.call('GET')
    expect(de.status).toBe(200)
    const html = await de.text()
    expect(html).toContain('E-Mails zu Einladungen abbestellen?')
    expect(html).toContain(`<form method="post" action="/api/email/unsubscribe/${TOKEN}?l=de">`)
    expect(html).toContain('>Abbestellen</button>')
    expect(html).not.toMatch(/<script/i)
    expect(de.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(de.headers.get('content-security-policy')).toContain("form-action 'self'")
    expect(de.headers.get('referrer-policy')).toBe('no-referrer')
    expect(de.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(de.headers.get('cache-control')).toBe('no-store')
    const en = await (await h.call('GET', `/api/email/unsubscribe/${TOKEN}?l=en`)).text()
    expect(en).toContain('Unsubscribe from invitation emails?')
    expect(en).toContain('?l=en"')
    expect((await h.call('HEAD')).status).toBe(200)
    expect(h.fetcher).not.toHaveBeenCalled()
  })
})

describe('POST: the button and RFC 8058 one-click', () => {
  it('calls invite_email_unsubscribe with the publishable key only, then "done"', async () => {
    const h = harness()
    const response = await h.call('POST', undefined, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Erledigt')
    expect(h.calls).toEqual([{
      url: `${SUPABASE_URL}/rest/v1/rpc/invite_email_unsubscribe`, headers: expect.any(Headers), body: { p_token: TOKEN }, redirect: 'manual',
    }])
    expect(h.calls[0]!.headers.get('apikey')).toBe(PUBLISHABLE)
    expect(h.calls[0]!.headers.get('authorization')).toBeNull()      // a publishable key is not a bearer
  })

  it('unknown / expired token (null) -> the honest "expired" page; a bad path -> 404 without a database call', async () => {
    const h = harness(() => null)
    const expired = await h.call('POST')
    expect(expired.status).toBe(200)
    expect(await expired.text()).toContain('Dieser Link ist abgelaufen')
    const bad = await h.call('POST', '/api/email/unsubscribe/short?l=de')
    expect(bad.status).toBe(404)
    expect(await h.call('GET', `/api/email/unsubscribe/${TOKEN}x`).then((r) => r.status)).toBe(404)
    expect(h.calls).toHaveLength(1)
    expect(parseUnsubscribePath(`/api/email/unsubscribe/${TOKEN}`)).toBe(TOKEN)
    expect(parseUnsubscribePath(`/api/email/unsubscribe/${TOKEN}/x`)).toBeNull()
  })

  it('without the publishable key: 501 page, nothing called; database down: 502 page', async () => {
    const off = harness(undefined, { SUPABASE_PUBLISHABLE_KEY: undefined })
    const response = await off.call('POST')
    expect(response.status).toBe(501)
    expect(await response.text()).toContain('Gerade nicht möglich')
    expect(off.fetcher).not.toHaveBeenCalled()
    const down = harness(undefined, {}, 503)
    expect((await down.call('POST')).status).toBe(502)
  })

  it('rate-limited per token; other methods 405; the log line has no token', async () => {
    const h = harness()
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) statuses.push((await h.call('POST')).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429])
    expect((await h.call('PUT')).status).toBe(405)
    const logged = JSON.stringify(h.log.mock.calls)
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain(TOKEN.slice(0, 12))
    expect(h.log).toHaveBeenCalledWith({ endpoint: 'email-unsubscribe', status: 200, duration: 0 })
  })
})
