import { http, HttpResponse, type JsonBodyType } from 'msw'
import { DEMO_SUPABASE_URL, DemoDbError, guarded, invalidBody, raise, readJson } from './rest'

// The demo server's invitation e-mail (supabase/migrations/20261028000000_invite_email.sql,
// docs/spec/invite-email-design.md): the three RPCs in memory — the switch answers like the database (validation of
// language and consent version, en -> en, everything else -> de, off always works). No mail is ever sent: the demo
// has no Worker and no Brevo; every demo account has a confirmed address.

const rest = `${DEMO_SUPABASE_URL}/rest/v1`

interface OptIn { lang: 'de' | 'en'; consent: string; enabled_at: string }

export function createDemoInviteEmail(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const optIns = new Map<string, OptIn>() // profile -> opt-in

  function set(me: string, a: Record<string, unknown>): JsonBodyType {
    if (typeof a.p_enabled !== 'boolean') throw raise('validation')
    if (!a.p_enabled) {
      optIns.delete(me)
      return { ok: true, enabled: false }
    }
    const { p_lang: lang, p_consent: consent } = a
    if (typeof lang !== 'string' || !['de', 'en', 'ru', 'uk'].includes(lang)
      || typeof consent !== 'string' || !/^invite-email-\d{4}-\d{2}-\d{2}$/.test(consent)) throw raise('validation')
    optIns.set(me, { lang: lang === 'en' ? 'en' : 'de', consent, enabled_at: new Date(now()).toISOString() })
    return { ok: true, enabled: true }
  }

  const exportFor = (me: string): JsonBodyType => {
    const row = optIns.get(me)
    return { enabled: row !== undefined, lang: row?.lang ?? null, consent: row?.consent ?? null, enabled_at: row?.enabled_at ?? null, last_sent_at: null, unsubscribe_links: 0 }
  }

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
      rpc('get_invite_email_settings', [], (me) => ({ available: true, enabled: optIns.has(me), address: true })),
      rpc('set_invite_email', ['p_enabled', 'p_lang', 'p_consent'], set),
      rpc('export_my_invite_email', [], (me) => exportFor(me)),
    ]
  }

  return { handlers, exportFor, optInOf: (me: string) => optIns.get(me) ?? null }
}
