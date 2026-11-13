// iCalendar (RFC 5545) for Bunprise occasions — "Zum Kalender hinzufügen" (./addToCalendar.ts: the file is made on
// the device). The SAME code lives in workers/edge/src/calendar/ics.ts (the Kalender-Abo feed): the Worker and the
// app are separate workspaces without a shared package, so the file is copied; both copies run the same tests
// (ics.test.ts here, calendarIcs.test.ts there; ics.parity.test.ts checks that the two stay equal). Change both or neither.
//
// What an event says: title, start/end, place, a link back to the occasion and (only the app's own file) the short
// description the host wrote. Never guests, wishes or anything about reservations — the input type has no room for it.
// Times: a timed occasion keeps its own zone (DTSTART;TZID=Europe/Berlin:…) with a VTIMEZONE built from the runtime's
// zone data (Intl) — the real offsets and daylight-saving changes around the events, no rules invented; a zone the
// runtime does not know falls back to UTC (…Z), which every calendar reads correctly too. An all-day occasion is a
// DATE (its day in its own zone; DTEND = the next day, exclusive).

export interface IcsEvent {
  /** the occasion id: UID = <id>@bunprise.de (stable: a second import or the feed updates the same event) */
  id: string
  title: string
  /** ISO instants */
  startsAt: string
  endsAt?: string | null
  /** IANA zone of the occasion */
  tz: string
  allDay: boolean
  place?: string | null
  /** back to the occasion in the app */
  url: string
  /** a short text (the feed sends none of the host's own text) */
  description?: string | null
  /** LAST-MODIFIED */
  updatedAt?: string | null
}

export interface IcsCalendar {
  events: readonly IcsEvent[]
  /** DTSTAMP */
  now: Date
  /** a subscription: calendar name + how often to look again */
  feed?: { name: string; refreshMinutes: number }
}

const DOMAIN = 'bunprise.de'
const MINUTE = 60_000
const DAY = 86_400_000

// ---- text --------------------------------------------------------------------------------------------------------

/** TEXT value (RFC 5545 §3.3.11): backslash, semicolon, comma and line breaks escaped; other control characters out. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function utf8Length(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
}

/** Content line folding (§3.1): at most 75 octets per line, never inside a UTF-8 character; continuation = CRLF + space. */
export function foldLine(line: string): string {
  const out: string[] = []
  let current = ''
  let octets = 0
  let limit = 75
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0) ?? 0)
    if (octets + size > limit) {
      out.push(current)
      current = ''
      octets = 0
      limit = 74 // the leading space counts
    }
    current += char
    octets += size
  }
  out.push(current)
  return out.join('\r\n ')
}

// ---- time --------------------------------------------------------------------------------------------------------

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** A zone name the runtime knows and that is safe as a TZID parameter. */
export function usableZone(tz: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

function wall(ms: number, tz: string): Wall {
  const parts: Record<string, number> = {}
  for (const part of formatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1,
    hour: (parts.hour ?? 0) % 24, minute: parts.minute ?? 0, second: parts.second ?? 0,
  }
}

/** Minutes east of UTC at an instant. */
export function offsetMinutes(ms: number, tz: string): number {
  const w = wall(ms, tz)
  return Math.round((Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000) / MINUTE)
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function wallText(w: Wall): string {
  return `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`
}

function dateText(w: Pick<Wall, 'year' | 'month' | 'day'>): string {
  return `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}`
}

/** 20261104T180000Z */
export function utcText(ms: number): string {
  const d = new Date(Math.floor(ms / 1000) * 1000)
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
}

/** The day after a civil date. */
function nextDay(w: Pick<Wall, 'year' | 'month' | 'day'>): Pick<Wall, 'year' | 'month' | 'day'> {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day) + DAY)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

interface Transition { at: number; from: number; to: number }

/** Offset changes of a zone between two instants (weekly samples, then to the minute). */
export function transitions(tz: string, fromMs: number, toMs: number): Transition[] {
  const found: Transition[] = []
  const step = 7 * DAY
  // whole minutes from here on: every sample and every bisection point is a minute boundary
  const first = Math.floor(fromMs / MINUTE) * MINUTE
  const last = Math.ceil(toMs / MINUTE) * MINUTE
  let previous = first
  let previousOffset = offsetMinutes(previous, tz)
  for (let t = first + step; previous < last; t += step) {
    const at = Math.min(t, last)
    const offset = offsetMinutes(at, tz)
    if (offset !== previousOffset) {
      // the change lies in (previous, at]: find its first minute
      let lo = previous
      let hi = at
      while (hi - lo > MINUTE) {
        const mid = lo + Math.max(MINUTE, Math.floor((hi - lo) / 2 / MINUTE) * MINUTE)
        if (offsetMinutes(mid, tz) === previousOffset) lo = mid
        else hi = mid
      }
      found.push({ at: hi, from: previousOffset, to: offsetMinutes(hi, tz) })
    }
    previous = at
    previousOffset = offset
  }
  return found
}

/** VTIMEZONE lines for a zone, valid from `fromMs` to `toMs` (the events' range with a margin). */
export function vtimezone(tz: string, fromMs: number, toMs: number): string[] {
  const initial = offsetMinutes(fromMs, tz)
  const changes = transitions(tz, fromMs, toMs)
  const first = changes[0]
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`]
  const kind = first && first.to < first.from ? 'DAYLIGHT' : 'STANDARD'
  lines.push(`BEGIN:${kind}`, `DTSTART:${wallText(wall(fromMs, tz))}`, `TZOFFSETFROM:${offsetText(initial)}`, `TZOFFSETTO:${offsetText(initial)}`, `END:${kind}`)
  for (const change of changes) {
    const type = change.to > change.from ? 'DAYLIGHT' : 'STANDARD'
    // DTSTART of an observance = the local time of the change, read with the offset BEFORE it (§3.6.5)
    const before = new Date(change.at + change.from * MINUTE)
    const local: Wall = {
      year: before.getUTCFullYear(), month: before.getUTCMonth() + 1, day: before.getUTCDate(),
      hour: before.getUTCHours(), minute: before.getUTCMinutes(), second: 0,
    }
    lines.push(`BEGIN:${type}`, `DTSTART:${wallText(local)}`, `TZOFFSETFROM:${offsetText(change.from)}`, `TZOFFSETTO:${offsetText(change.to)}`, `END:${type}`)
  }
  lines.push('END:VTIMEZONE')
  return lines
}

// ---- calendar ----------------------------------------------------------------------------------------------------

function validInstant(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** A zone with offsets at all (else the events are written in UTC): UTC itself needs no VTIMEZONE either. */
function zoneFor(event: IcsEvent): string | null {
  if (event.allDay || !usableZone(event.tz)) return null
  return /^(Etc\/)?(UTC|GMT|Zulu|UCT|Universal)$/.test(event.tz) ? null : event.tz
}

/** The whole .ics text (CRLF line ends, folded lines). Events that have no valid start are left out. */
export function buildIcs(calendar: IcsCalendar): string {
  const stamp = utcText(calendar.now.getTime())
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bunprise//Bunprise//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  if (calendar.feed) {
    const refresh = `PT${Math.max(15, Math.round(calendar.feed.refreshMinutes))}M`
    lines.push(`NAME:${escapeText(calendar.feed.name)}`, `X-WR-CALNAME:${escapeText(calendar.feed.name)}`,
      `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`, `X-PUBLISHED-TTL:${refresh}`)
  }

  const events = calendar.events.filter((event) => validInstant(event.startsAt) !== null)
  // one VTIMEZONE per zone, covering its events (a year of margin each side)
  const ranges = new Map<string, [number, number]>()
  for (const event of events) {
    const zone = zoneFor(event)
    if (!zone) continue
    const start = validInstant(event.startsAt) ?? 0
    const end = Math.max(start, validInstant(event.endsAt) ?? start)
    const range = ranges.get(zone)
    ranges.set(zone, range ? [Math.min(range[0], start), Math.max(range[1], end)] : [start, end])
  }
  for (const [zone, [start, end]] of ranges) lines.push(...vtimezone(zone, start - 366 * DAY, end + 366 * DAY))

  for (const event of events) {
    const start = validInstant(event.startsAt) ?? 0
    const endRaw = validInstant(event.endsAt)
    const end = !event.allDay && endRaw !== null && endRaw > start ? endRaw : null
    const zone = zoneFor(event)
    lines.push('BEGIN:VEVENT', `UID:${event.id.replace(/[^A-Za-z0-9-]/g, '')}@${DOMAIN}`, `DTSTAMP:${stamp}`)
    const modified = validInstant(event.updatedAt)
    if (modified !== null) lines.push(`LAST-MODIFIED:${utcText(modified)}`)
    if (event.allDay) {
      const day = wall(start, usableZone(event.tz) ? event.tz : 'UTC')
      lines.push(`DTSTART;VALUE=DATE:${dateText(day)}`, `DTEND;VALUE=DATE:${dateText(nextDay(day))}`)
    } else if (zone) {
      lines.push(`DTSTART;TZID=${zone}:${wallText(wall(start, zone))}`)
      if (end !== null) lines.push(`DTEND;TZID=${zone}:${wallText(wall(end, zone))}`)
    } else {
      lines.push(`DTSTART:${utcText(start)}`)
      if (end !== null) lines.push(`DTEND:${utcText(end)}`)
    }
    lines.push(`SUMMARY:${escapeText(event.title.trim())}`)
    const place = event.place?.trim()
    if (place) lines.push(`LOCATION:${escapeText(place)}`)
    const description = event.description?.trim()
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`)
    if (/^https:\/\/[^\s"<>\\^`{|}]+$/.test(event.url)) lines.push(`URL:${event.url}`)
    lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}
