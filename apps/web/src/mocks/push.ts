import { http, HttpResponse, type JsonBodyType } from 'msw'
import { DEMO_SUPABASE_URL, DemoDbError, guarded, invalidBody, raise, readJson } from './rest'

// The demo server's Web Push (supabase/migrations/20261027150000_web_push.sql, docs/spec/web-push-design.md §10):
// the five RPCs in memory and GET /api/push/key. No browser push API, no Worker, no real notification: the app's
// demo device (features/push/device.ts) registers a fixed fake endpoint, the switches answer like the database
// (validation, push_endpoint_taken, the per-person preference, the export without keys). The demo has no auth
// sessions, so a device counts as "this session" once it is registered by the same account.

const rest = `${DEMO_SUPABASE_URL}/rest/v1`
// the database's one-spelling rules (private.push_endpoint_ok): no dot segments; escapes only in WNS queries, upper case
const PLAIN = /^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*push\.apple\.com)\/[A-Za-z0-9._~:=/-]+$/
const WNS = /^https:\/\/[a-z0-9-]+\.notify\.windows\.com\/[A-Za-z0-9._~/-]*\?(?:[A-Za-z0-9._~=&-]|%2B|%2F|%3D)+$/
const ENDPOINT = { test: (value: string) => !/\/\.{1,2}(?:\/|\?|$)/.test(value) && (PLAIN.test(value) || WNS.test(value)) }

interface Device { profile: string; endpoint: string; lang: string; consent: string; consented_at: string; created_at: string }

export function createDemoPush(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const devices = new Map<string, Device>() // endpoint -> device
  const invitations = new Map<string, boolean>() // profile -> preference (default true)
  const wants = (me: string) => invitations.get(me) ?? true

  function subscribe(me: string, a: Record<string, unknown>): JsonBodyType {
    const { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_lang: lang, p_consent: consent } = a
    if (typeof endpoint !== 'string' || endpoint.length > 1024 || !ENDPOINT.test(endpoint)
      || typeof p256dh !== 'string' || !/^B[A-Za-z0-9_-]{86}$/.test(p256dh)
      || typeof auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(auth)
      || typeof lang !== 'string' || !['de', 'en', 'ru', 'uk'].includes(lang)
      || typeof consent !== 'string' || !/^push-\d{4}-\d{2}-\d{2}$/.test(consent)) throw raise('validation')
    const existing = devices.get(endpoint)
    if (existing && existing.profile !== me) throw new DemoDbError('P0001', 'push_endpoint_taken', 400)
    const at = new Date(now()).toISOString()
    devices.set(endpoint, { profile: me, endpoint, lang, consent, consented_at: at, created_at: existing?.created_at ?? at })
    return { ok: true, invitations: wants(me) }
  }

  const exportFor = (me: string): JsonBodyType => ({
    preferences: { invitations: wants(me) },
    devices: [...devices.values()].filter((d) => d.profile === me)
      .map(({ endpoint, lang, consent, consented_at, created_at }) => ({ endpoint, lang, consent, consented_at, created_at })),
  })

  function handlers(viewer: (request: Request) => string | null) {
    function rpc(name: string, keys: readonly string[], run: (me: string, args: Record<string, unknown>) => JsonBodyType) {
      return http.post(`${rest}/rpc/${name}`, ({ request }) => guarded(async () => {
        const input = (await readJson(request)) ?? {}
        if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalidBody()
        const given = Object.keys(input)
        if (given.length !== keys.length || given.some((key) => !keys.includes(key))) {
          throw new DemoDbError('PGRST202', `Could not find the function public.${name}(${given.join(', ')}) in the schema cache`, 404)
        }
        const me = viewer(request)
        if (!me) throw raise('not_authenticated')
        return HttpResponse.json(run(me, input as Record<string, unknown>))
      }))
    }
    return [
      rpc('push_subscribe', ['p_endpoint', 'p_p256dh', 'p_auth', 'p_lang', 'p_consent'], subscribe),
      rpc('push_unsubscribe', ['p_endpoint'], (me, a) => {
        const device = typeof a.p_endpoint === 'string' ? devices.get(a.p_endpoint) : undefined
        if (device?.profile === me) devices.delete(device.endpoint)
        return { ok: true }
      }),
      rpc('get_push_settings', ['p_endpoint'], (me, a) => ({
        available: true,
        device: typeof a.p_endpoint === 'string' && devices.get(a.p_endpoint)?.profile === me,
        invitations: wants(me),
      })),
      rpc('set_push_settings', ['p_invitations'], (me, a) => {
        if (typeof a.p_invitations !== 'boolean') throw raise('validation')
        invitations.set(me, a.p_invitations)
        return { ok: true, invitations: a.p_invitations }
      }),
      rpc('export_my_push', [], (me) => exportFor(me)),
      // the Worker's public VAPID key: a fixed fake one (the demo never subscribes a real browser)
      http.get('*/api/push/key', () => HttpResponse.json({ publicKey: `B${'D'.repeat(86)}` })),
    ]
  }

  return { handlers, exportFor, devicesOf: (me: string) => [...devices.values()].filter((d) => d.profile === me) }
}
