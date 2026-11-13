import { http, HttpResponse, type JsonBodyType } from 'msw'
import { DEMO_PEOPLE } from './fixtures'
import { DEMO_SUPABASE_URL, DemoDbError, guarded, invalidBody, raise, readJson } from './rest'
import { localDayAt } from './time'
import type { DemoWorld, MemberRow, OccasionRow } from './world'

// The demo server's Kalender-Abo and birthday suggestion (supabase/migrations/20261027170000_calendar_feed.sql): the five
// RPCs in memory, answering like the database. The feed address is simulated (the demo has no Worker: it does not
// work in a calendar app — the sheet says so). seedDemo gives the first account two PAST occasions of a year ago, so
// Start shows the suggestion: "Mein Geburtstag" (hosted, in 18 days) and "Claras Geburtstag" (a guest, in 25 days).
// They live HERE, not in the shared demo world: a year-old occasion is in no other answer (feed, lists, export
// fixtures of other tests stay as they are); get_anniversary_suggestions reads the world AND them.

const rest = `${DEMO_SUPABASE_URL}/rest/v1`
const DAY = 86_400_000
const LANGS = ['de', 'en', 'ru', 'uk']

export const DEMO_BIRTHDAYS = {
  mine: 'd1e0b000-0000-4000-8000-000000000a01',
  clara: 'd1e0b000-0000-4000-8000-000000000a02',
} as const

interface Feed { token: string; lang: string; created_at: string; last_fetched_at: string | null }

function localDate(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

const dayNo = (day: string) => {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY
}

/** private.next_anniversary: this year or next; 29 February → 28 February in a common year. */
export function nextAnniversary(day: string, today: string): string {
  const [, m = 1, d = 1] = day.split('-').map(Number)
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const candidate = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
    if (dayNo(candidate) >= dayNo(today)) return candidate
  }
  return today
}

export function createDemoCalendar(world: DemoWorld, options: { now?: () => number } = {}) {
  const now = options.now ?? world.internals.clock
  const feeds = new Map<string, Feed>() // profile -> feed
  const pastOnly: { occasion: OccasionRow; member: MemberRow }[] = [] // seedDemo's year-old occasions

  function token(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function status(me: string): JsonBodyType {
    const feed = feeds.get(me)
    return feed ? { active: true, created_at: feed.created_at, last_fetched_at: feed.last_fetched_at, lang: feed.lang }
      : { active: false, created_at: null, last_fetched_at: null, lang: null }
  }

  function anniversaries(me: string): JsonBodyType {
    const t = world.internals
    const at = now()
    const pairs = [
      ...t.members.map((member: MemberRow) => ({ member, occasion: t.occasions.get(member.occasion_id) })),
      ...pastOnly,
    ]
    const rows = pairs.flatMap(({ member: m, occasion }) => {
      const o: OccasionRow | undefined = m.profile_id === me && m.status === 'active' && (m.role === 'host' || m.rsvp !== 'declined')
        ? occasion : undefined
      if (!o || o.cancelled_at !== null) return []
      const theme = o.cover_theme ?? null
      if (theme !== null && theme !== 'birthday' && theme !== 'none') return []
      const starts = Date.parse(o.starts_at)
      if (!(starts < at - 300 * DAY && starts > at - 6 * 365 * DAY)) return []
      if (world.follows.isBlockedPair(me, o.host_id)) return []
      const today = localDate(at, o.tz)
      const anniversary = nextAnniversary(localDate(starts, o.tz), today)
      const days = dayNo(anniversary) - dayNo(today)
      if (days < 14 || days > 28) return []
      return [{
        occasion_id: o.id, title: o.title, starts_at: o.starts_at, tz: o.tz, all_day: o.all_day, cover_theme: theme, role: m.role,
        host_id: o.host_id, host_name: t.nameOf(o.host_id), anniversary, days_ahead: days,
      }]
    })
    // one per host and day (the newest occasion), nearest first, at most 5
    const newest = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      const key = `${row.host_id}:${row.anniversary}`
      const kept = newest.get(key)
      if (!kept || Date.parse(row.starts_at) > Date.parse(kept.starts_at)) newest.set(key, row)
    }
    return [...newest.values()].sort((a, b) => a.days_ahead - b.days_ahead || a.occasion_id.localeCompare(b.occasion_id)).slice(0, 5)
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
      rpc('create_calendar_feed', ['p_lang'], (me, a) => {
        if (!world.internals.hasConsents(me)) throw raise('consent_required')
        if (typeof a.p_lang !== 'string' || !LANGS.includes(a.p_lang)) throw raise('validation')
        const feed: Feed = { token: token(), lang: a.p_lang, created_at: new Date(now()).toISOString(), last_fetched_at: null }
        feeds.set(me, feed)
        return { token: feed.token, created_at: feed.created_at }
      }),
      rpc('get_calendar_feed', [], (me) => status(me)),
      rpc('revoke_calendar_feed', [], (me) => {
        feeds.delete(me)
        return { ok: true }
      }),
      rpc('export_my_calendar_feed', [], (me) => {
        const feed = feeds.get(me)
        return feed ? { created_at: feed.created_at, last_fetched_at: feed.last_fetched_at, lang: feed.lang } : null
      }),
      rpc('get_anniversary_suggestions', [], (me) => anniversaries(me)),
    ]
  }

  /** Two past birthdays of the first demo account (a year ago): its own (in 18 days) and Clara's (in 25 days). */
  function seedDemo(me: string, nowMs: number = now()): void {
    const zone = 'Europe/Berlin'
    const lastYear = (days: number, hour: number) => {
      const ms = localDayAt(nowMs, zone, days, hour, 0)
      const d = new Date(ms)
      d.setUTCFullYear(d.getUTCFullYear() - 1)
      return d.toISOString()
    }
    const mineStarts = new Date(localDayAt(nowMs - 365 * DAY, zone, 18, 0, 0)).toISOString()
    const claraStarts = lastYear(25, 19)
    const created = new Date(nowMs - 400 * DAY).toISOString()
    const occasion = (id: string, host: string, title: string, starts: string, allDay: boolean, theme: string | null): OccasionRow => ({
      id, host_id: host, title, starts_at: starts, ends_at: null, tz: zone, all_day: allDay, place_text: null, description: null,
      cancelled_at: null, created_at: created, updated_at: created, sections: 'wishes', cover_theme: theme,
    })
    const member = (occasionId: string, profileId: string, role: MemberRow['role'], rsvp: MemberRow['rsvp']): MemberRow =>
      ({ occasion_id: occasionId, profile_id: profileId, role, rsvp, status: 'active', invited_via: null, joined_at: created, updated_at: created })
    pastOnly.push(
      { occasion: occasion(DEMO_BIRTHDAYS.mine, me, 'Mein Geburtstag', mineStarts, true, 'birthday'), member: member(DEMO_BIRTHDAYS.mine, me, 'host', 'going') },
      { occasion: occasion(DEMO_BIRTHDAYS.clara, DEMO_PEOPLE.clara.id, 'Claras Geburtstag', claraStarts, false, null), member: member(DEMO_BIRTHDAYS.clara, me, 'member', 'going') },
    )
  }

  return { handlers, seedDemo, feedOf: (me: string) => feeds.get(me) ?? null }
}
