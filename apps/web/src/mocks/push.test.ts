import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fetchPushKey } from '../lib/api/push'
import { createDemoPush } from './push'
import { DEMO_SUPABASE_URL } from './rest'

// The demo's Web Push (src/mocks/push.ts) answers like supabase/migrations/20261027150000_web_push.sql (the SQL itself
// is proven in packages/db-tests/test/push): validation, one account per endpoint, the per-person preference, the
// export without keys, and the fake VAPID key. Invented ids only.

const MILA = '00000000-0000-4000-8000-0000000000aa'
const BEN = '00000000-0000-4000-8000-0000000000bb'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/demo-device'
const KEYS = { p_p256dh: `B${'D'.repeat(86)}`, p_auth: 'ZGVtby1hdXRoLXNlY3JldA', p_lang: 'de', p_consent: 'push-2026-10-27' }

let viewer: string | null = MILA
let push = createDemoPush({ now: () => Date.parse('2026-10-27T10:00:00Z') })
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  viewer = MILA
  push = createDemoPush({ now: () => Date.parse('2026-10-27T10:00:00Z') })
  server.resetHandlers(...push.handlers(() => viewer))
})

async function rpc(name: string, args: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe('demo push', () => {
  it('registers a device, keeps one account per endpoint, forgets it on unsubscribe', async () => {
    expect((await rpc('push_subscribe', { p_endpoint: ENDPOINT, ...KEYS })).body).toEqual({ ok: true, invitations: true })
    expect((await rpc('get_push_settings', { p_endpoint: ENDPOINT })).body).toEqual({ available: true, device: true, invitations: true })
    viewer = BEN
    const taken = await rpc('push_subscribe', { p_endpoint: ENDPOINT, ...KEYS })
    expect(taken.status).toBe(400)
    expect(taken.body).toMatchObject({ code: 'P0001', message: 'push_endpoint_taken' })
    expect((await rpc('push_unsubscribe', { p_endpoint: ENDPOINT })).body).toEqual({ ok: true }) // not Ben's: stays
    viewer = MILA
    expect(push.devicesOf(MILA)).toHaveLength(1)
    await rpc('push_unsubscribe', { p_endpoint: ENDPOINT })
    expect(push.devicesOf(MILA)).toEqual([])
  })

  it('refuses what the database refuses', async () => {
    for (const bad of [{ p_endpoint: 'https://evil.example/x' }, { p_p256dh: 'short' }, { p_auth: 'x' }, { p_lang: 'fr' }, { p_consent: 'ok' }]) {
      const answer = await rpc('push_subscribe', { p_endpoint: ENDPOINT, ...KEYS, ...bad })
      expect(answer.body, JSON.stringify(bad)).toMatchObject({ message: 'validation' })
    }
    expect((await rpc('push_subscribe', { p_endpoint: ENDPOINT })).status).toBe(404) // wrong argument list
  })

  it('the preference and the export (no keys)', async () => {
    await rpc('push_subscribe', { p_endpoint: ENDPOINT, ...KEYS })
    expect((await rpc('set_push_settings', { p_invitations: false })).body).toEqual({ ok: true, invitations: false })
    const out = (await rpc('export_my_push', {})).body
    expect(out).toEqual({
      preferences: { invitations: false },
      devices: [{ endpoint: ENDPOINT, lang: 'de', consent: 'push-2026-10-27', consented_at: '2026-10-27T10:00:00.000Z', created_at: '2026-10-27T10:00:00.000Z' }],
    })
  })

  it('GET /api/push/key: a well-formed fake key, which fetchPushKey accepts; anything else is "not set up"', async () => {
    expect(await fetchPushKey((input, init) => fetch(new URL(String(input), 'http://localhost'), init))).toBe(`B${'D'.repeat(86)}`)
    expect(await fetchPushKey(async () => new Response('{"error":"not_available"}', { status: 501 }))).toBeNull()
    expect(await fetchPushKey(async () => Response.json({ publicKey: 'not-a-key' }))).toBeNull()
  })
})
