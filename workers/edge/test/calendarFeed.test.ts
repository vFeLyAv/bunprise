import { describe, expect, it, vi } from 'vitest'
import { createWorker } from '../src/index'
import type { Env } from '../src/index'
import { events, one, parseIcs } from './icsValidate'
import { NOW, SUPABASE_URL } from './helpers'

// GET /api/calendar/<token>.ics (src/calendar/feed.ts): switched off without CALENDAR_FEED + the publishable key; asks
// the database ONLY through POST /rest/v1/rpc/calendar_feed with the publishable key (never a service key, never the
// caller's headers); 404 for a malformed or unknown token, 429 for the database's or our own limit, 502 for a broken
// upstream; never caches; the log line carries no token, address or content.

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE'
const PUBLISHABLE = 'sb_publishable_fixture'
const OCCASION = {
  id: 'd1e0b000-0000-4000-8000-0000000000aa', title: 'Annas Geburtstag', starts_at: '2026-11-04T18:00:00.000Z', ends_at: null,
  tz: 'Europe/Berlin', all_day: false, place_text: 'Café am Markt', updated_at: '2026-10-20T08:00:00.000Z',
  // a database that sent more than it should: the Worker writes only the known fields
  wishes: [{ title: 'Kaffeemühle', reserved: true }], description: 'Geheime Notiz',
}

function harness(answer: () => Response = () => Response.json({ lang: 'de', occasions: [OCCASION] }), env: Partial<Env> = {}) {
  const calls: { url: string; init?: RequestInit; headers: Headers }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init, headers: new Headers(init?.headers) })
    return answer()
  })
  const log = vi.fn()
  const worker = createWorker({ fetch: fetcher, now: () => NOW, log })
  const fullEnv: Env = {
    SUPABASE_URL, ASSETS: { fetch: async () => new Response('asset') }, CALENDAR_FEED: 'on', SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, ...env,
  }
  const get = (path = `/api/calendar/${TOKEN}.ics`, init: RequestInit = {}) => worker.fetch(new Request(`https://bunprise.de${path}`, {
    ...init,
    headers: { 'CF-Connecting-IP': '198.51.100.7', Cookie: 'private=1', Authorization: 'Bearer user-token', 'User-Agent': 'Calendar/1.0', ...init.headers },
  }), fullEnv)
  return { get, calls, log, fetcher }
}

describe('Kalender-Abo route', () => {
  it('serves a valid calendar with the publishable key only; no caching; only the known fields', async () => {
    const { get, calls, log } = harness()
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    const text = await response.text()
    const cal = parseIcs(text)
    const [ev] = events(cal)
    expect(one(ev!, 'SUMMARY').value).toBe('Annas Geburtstag')
    expect(one(ev!, 'URL').value).toBe('https://bunprise.de/occasions/d1e0b000-0000-4000-8000-0000000000aa')
    expect(text).not.toMatch(/Kaffeem|reserv|Geheime/i)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/calendar_feed`)
    expect(call.init?.method).toBe('POST')
    expect(JSON.parse(String(call.init?.body))).toEqual({ p_token: TOKEN })
    expect(call.headers.get('apikey')).toBe(PUBLISHABLE)
    // nothing of the caller travels on: no cookie, no user token, no user agent; a new key is no bearer
    expect(call.headers.get('Authorization')).toBeNull()
    expect(call.headers.get('Cookie')).toBeNull()
    expect(call.headers.get('User-Agent')).toBeNull()
    expect(call.init?.redirect).toBe('manual')

    expect(log).toHaveBeenCalledWith({ endpoint: 'calendar-feed', status: 200, duration: 0 })
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
  })

  it('a legacy anon JWT is sent as apikey and bearer', async () => {
    const { get, calls } = harness(undefined, { SUPABASE_PUBLISHABLE_KEY: 'eyJfixture.legacy.key' })
    expect((await get()).status).toBe(200)
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer eyJfixture.legacy.key')
  })

  it('switched off: 501 without asking the database (no switch, or no key)', async () => {
    for (const env of [{ CALENDAR_FEED: undefined }, { CALENDAR_FEED: 'off' }, { SUPABASE_PUBLISHABLE_KEY: undefined }, { SUPABASE_PUBLISHABLE_KEY: ' ' }]) {
      const { get, calls } = harness(undefined, env)
      expect((await get()).status, JSON.stringify(env)).toBe(501)
      expect(calls).toHaveLength(0)
    }
  })

  it('malformed addresses: 404 without asking the database', async () => {
    const { get, calls } = harness()
    for (const path of [`/api/calendar/${TOKEN.slice(1)}.ics`, `/api/calendar/${TOKEN}`, `/api/calendar/${TOKEN}.ics/x`,
      `/api/calendar/${TOKEN.slice(0, 42)}%2F.ics`, '/api/calendar/', `/api/calendar/${TOKEN}x.ics`]) {
      expect((await get(path)).status, path).toBe(404)
    }
    expect(calls).toHaveLength(0)
  })

  it('unknown token (null) → 404; the database limit → 429 with Retry-After; upstream trouble → 502', async () => {
    expect((await harness(() => Response.json(null)).get()).status).toBe(404)
    const limited = await harness(() => Response.json({ rate_limited: true })).get()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('300')
    for (const answer of [() => new Response('oops', { status: 500 }), () => new Response('not json'), () => Response.json({ lang: 'de' }),
      () => Response.json([1, 2]), () => { throw new Error('network') },
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } })]) {
      expect((await harness(answer).get()).status).toBe(502)
    }
  })

  it('GET and HEAD only; HEAD has no body', async () => {
    const { get } = harness()
    expect((await get(undefined, { method: 'POST' })).status).toBe(405)
    const head = await get(undefined, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('our own limit per token: the 7th request in a minute is refused before the database is asked', async () => {
    const { get, calls } = harness()
    for (let i = 0; i < 6; i++) expect((await get()).status).toBe(200)
    const seventh = await get()
    expect(seventh.status).toBe(429)
    expect(calls).toHaveLength(6)
  })
})
