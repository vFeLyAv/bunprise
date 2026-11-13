import { ApiError, isRecord, readBytes, withDeadline } from '../http'
import type { Clock, Fetch } from '../http'
import { buildIcs, type IcsEvent } from './ics'

// GET /api/calendar/<token>.ics — the Kalender-Abo (supabase/migrations/20261027170000_calendar_feed.sql,
// docs/handoffs/2026-10-27-calendar.md). A calendar app (Apple, Google, Outlook) fetches this address without any
// sign-in: the long random token IS the permission. The Worker asks the database with the PUBLISHABLE key only
// (public.calendar_feed(token) is the one function anon may execute; no service-role key exists here) and writes the
// answer as iCalendar. Nothing is cached or stored; the log line has no token, no address and no content (index.ts).
// Switched on by CALENDAR_FEED = "on" together with SUPABASE_PUBLISHABLE_KEY (wrangler.jsonc); otherwise 501.

export interface CalendarEnv {
  SUPABASE_URL: string
  /** the project's publishable key (public, the same as the app's VITE_SUPABASE_PUBLISHABLE_KEY) */
  SUPABASE_PUBLISHABLE_KEY?: string
  /** "on" = the feed answers (only together with the pilot-5 privacy text) */
  CALENDAR_FEED?: string
}

export const CALENDAR_PREFIX = '/api/calendar/'
const TOKEN = /^\/api\/calendar\/([A-Za-z0-9_-]{43})\.ics$/
/** the database's answer is small (≤ 200 occasions × a few hundred bytes); more is refused */
const MAX_ANSWER = 512 * 1024

/** the token of a feed address, or null (then: 404 without asking anybody) */
export function parseFeedPath(path: string): string | null {
  return TOKEN.exec(path)?.[1] ?? null
}

export function calendarFeedOn(env: CalendarEnv): boolean {
  return env.CALENDAR_FEED?.trim() === 'on' && Boolean(env.SUPABASE_PUBLISHABLE_KEY?.trim())
}

/** The words of the file in the person's language (chosen when the address was made). */
const WORDS: Readonly<Record<string, { open: string }>> = {
  de: { open: 'In Bunprise öffnen' },
  en: { open: 'Open in Bunprise' },
  ru: { open: 'Открыть в Bunprise' },
  uk: { open: 'Відкрити в Bunprise' },
}

interface FeedOccasion {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  tz: string
  all_day: boolean
  place_text: string | null
  updated_at: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asOccasion(value: unknown): FeedOccasion | null {
  if (!isRecord(value)) return null
  const { id, title, starts_at, ends_at, tz, all_day, place_text, updated_at } = value
  if (typeof id !== 'string' || !UUID.test(id) || typeof title !== 'string' || typeof starts_at !== 'string'
    || typeof tz !== 'string' || typeof all_day !== 'boolean') return null
  return {
    id, title, starts_at, tz, all_day,
    ends_at: typeof ends_at === 'string' ? ends_at : null,
    place_text: typeof place_text === 'string' ? place_text : null,
    updated_at: typeof updated_at === 'string' ? updated_at : null,
  }
}

/** The ICS text for the database's answer (exported for the tests). */
export function feedIcs(answer: { lang: string; occasions: readonly FeedOccasion[] }, origin: string, now: Date): string {
  const words = WORDS[answer.lang] ?? WORDS.de ?? { open: 'Bunprise' }
  const events: IcsEvent[] = answer.occasions.map((o) => {
    const url = `${origin}/occasions/${o.id}`
    return {
      id: o.id, title: o.title, startsAt: o.starts_at, endsAt: o.ends_at, tz: o.tz, allDay: o.all_day, place: o.place_text,
      url, description: `${words.open}: ${url}`, updatedAt: o.updated_at,
    }
  })
  return buildIcs({ events, now, feed: { name: 'Bunprise', refreshMinutes: 60 } })
}

export function createCalendarFeed(options: { fetch: Fetch; now: Clock }) {
  /** The feed for a token: an .ics Response, or an ApiError (not_found, rate_limited, upstream_unavailable). */
  return async (token: string, origin: string, env: CalendarEnv, signal?: AbortSignal): Promise<Response> => {
    const key = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
    const base = env.SUPABASE_URL.replace(/\/+$/, '')
    const answer = await withDeadline(8000, async (deadline) => {
      const headers = new Headers({ apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' })
      // a legacy anon JWT also wants to be the bearer; a new publishable key (sb_publishable_…) must not be
      if (key.startsWith('eyJ')) headers.set('Authorization', `Bearer ${key}`)
      let response: Response
      try {
        response = await options.fetch(`${base}/rest/v1/rpc/calendar_feed`, {
          method: 'POST', headers, body: JSON.stringify({ p_token: token }), signal: deadline,
          // workerd rejects the "error" redirect mode (see auth.test.ts): never follow; any 3xx is an error below
          redirect: 'manual',
        })
      } catch {
        throw new ApiError('upstream_unavailable')
      }
      if (!response.ok || (response.status >= 300 && response.status < 400)) throw new ApiError('upstream_unavailable')
      const bytes = await readBytes(response, MAX_ANSWER, deadline)
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown
      } catch {
        throw new ApiError('upstream_unavailable')
      }
    }, signal)

    if (answer === null) throw new ApiError('not_found')
    if (!isRecord(answer)) throw new ApiError('upstream_unavailable')
    if (answer.rate_limited === true) throw new ApiError('rate_limited', 300)
    if (typeof answer.lang !== 'string' || !Array.isArray(answer.occasions)) throw new ApiError('upstream_unavailable')
    const occasions = answer.occasions.map(asOccasion).filter((o): o is FeedOccasion => o !== null)
    const body = feedIcs({ lang: answer.lang, occasions }, origin, new Date(options.now()))
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="bunprise.ics"',
        // personal: never in a shared cache; the calendar app asks again on its own schedule
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  }
}
